// hud-patch.js — keyed DOM reconciliation for the delve HUD.
//
// The delve HUD (side panel, core HUD, encounter tools, quest tracker, initiative
// ribbon, inventory modal) used to be rebuilt with innerHTML on every state/aux
// update (describe/portrait/poll). A button held down during such a rebuild was
// detached before mouseup, so the browser never fired its click — the deterministic
// lost-click path recorded in t11-description-click-race.json (V1b round 7).
//
// This module re-renders into a detached fragment and then patches the live tree:
// nodes carrying an identity key (data-act / data-hud / data-card / …) are reused
// when the fresh tree contains the same key, so still-valid buttons keep their node,
// their listeners, keyboard focus and any pointer press in progress; attributes,
// text and children are synced to the fresh render. Unmatched nodes are adopted
// fresh, leftovers removed — a real state change still converges exactly to what
// the template renders, and a disabled control is never kept pressable.

/** Attributes that make an element identifiable across HUD renders. */
const IDENTITY_ATTRS = [
  'data-act', 'data-classact', 'data-quickslot', 'data-scene-open', 'data-cast',
  'data-delve-inv-equip', 'data-delve-inv-unequip', 'data-delve-inv-use',
  'data-item', 'data-target-id', 'data-card', 'data-hud'
];

const IDENTITY_SELECTOR = IDENTITY_ATTRS.map(a => '[' + a + ']').join(',') + ',[id]';

/** Our own listener marker must survive patching; see wireSide users. */
const WIRED_ATTR = 'data-wired';

/**
 * Stable identity of an element across renders, or null when it is generic.
 * @param {Element} el
 * @returns {string | null}
 */
function identityKey(el) {
  if (!(el instanceof Element)) return null;
  if (el.id) return el.tagName + '#' + el.id;
  const parts = [];
  for (const attr of IDENTITY_ATTRS) {
    const v = el.getAttribute(attr);
    if (v != null && v !== '') parts.push(attr + '=' + v);
  }
  return parts.length ? el.tagName + '[' + parts.join('][') + ']' : null;
}

/**
 * Loose signature used to positionally match generic (unkeyed) nodes.
 * @param {Node} node
 * @returns {string}
 */
function signatureOf(node) {
  if (node.nodeType === 3) return '#text';
  if (node.nodeType !== 1) return '#' + node.nodeType;
  const el = /** @type {Element} */ (node);
  const cls = el.getAttribute('class');
  return el.tagName + (cls ? '.' + cls.trim().split(/\s+/).sort().join('.') : '');
}

/**
 * Index every keyed element under the given roots (before patching), so a node
 * that has been moved to another HUD host (action grid → coreHud) can still be
 * found and re-anchored where the fresh render wants it.
 * @param {Element[]} roots
 * @returns {Map<string, Element[]>}
 */
function collectPool(roots) {
  const pool = new Map();
  for (const root of roots) {
    if (!root) continue;
    root.querySelectorAll(IDENTITY_SELECTOR).forEach(el => {
      const key = /** @type {string} */ (identityKey(el));
      if (!key) return;
      const list = pool.get(key);
      if (list) list.push(el); else pool.set(key, [el]);
    });
  }
  return pool;
}

/**
 * Patch the attributes/properties of a reused live node up to the fresh render.
 * @param {Element} live
 * @param {Element} fresh
 */
function patchAttributes(live, fresh) {
  for (const attr of Array.from(fresh.attributes)) {
    if (attr.name === WIRED_ATTR) continue;
    if (live.getAttribute(attr.name) !== attr.value) {
      live.setAttribute(attr.name, attr.value);
      if (attr.name === 'value' && live instanceof HTMLInputElement && document.activeElement !== live) {
        live.value = attr.value;
      }
    }
  }
  for (const attr of Array.from(live.attributes)) {
    if (attr.name === WIRED_ATTR) continue;
    if (!fresh.hasAttribute(attr.name)) {
      live.removeAttribute(attr.name);
      if (attr.name === 'disabled' && live instanceof HTMLButtonElement) live.disabled = false;
    }
  }
  if (live instanceof HTMLButtonElement) live.disabled = fresh.hasAttribute('disabled');
}

/**
 * Patch the children of `live` to match the children of `fresh`, reusing keyed and
 * positionally-equivalent live nodes. `pool` is the shared cross-root key index.
 * @param {Element} live
 * @param {Element | DocumentFragment} fresh
 * @param {Map<string, Element[]>} pool
 */
function patchInto(live, fresh, pool) {
  const have = Array.from(live.childNodes);
  const unconsumed = new Set(have);
  const sigSeen = new Map();
  let placed = 0;
  for (const want of Array.from(fresh.childNodes)) {
    let node = null;
    if (want.nodeType === 1) {
      const key = /** @type {string} */ (identityKey(/** @type {Element} */ (want)));
      if (key) {
        const candidates = pool.get(key);
        if (candidates && candidates.length) {
          node = /** @type {Element} */ (candidates.shift());
          unconsumed.delete(node);
        }
      } else {
        const sig = signatureOf(want);
        const nth = sigSeen.get(sig) || 0;
        sigSeen.set(sig, nth + 1);
        let seen = 0;
        for (const h of have) {
          if (!unconsumed.has(h) || h.nodeType !== 1 || signatureOf(h) !== sig) continue;
          if (seen === nth) { node = h; break; }
          seen++;
        }
        if (node) unconsumed.delete(node);
      }
    } else if (want.nodeType === 3) {
      for (const h of have) {
        if (unconsumed.has(h) && h.nodeType === 3) { node = h; unconsumed.delete(h); break; }
      }
    }
    if (!node) node = live.ownerDocument.importNode(want, true);
    const ref = live.childNodes[placed] || null;
    if (ref !== node) live.insertBefore(node, ref);
    placed++;
    if (want.nodeType === 1 && node.nodeType === 1) {
      patchAttributes(/** @type {Element} */ (node), /** @type {Element} */ (want));
      patchInto(/** @type {Element} */ (node), /** @type {Element} */ (want), pool);
    } else if (node.nodeType === 3 && want.nodeType === 3 && node.nodeValue !== want.nodeValue) {
      node.nodeValue = want.nodeValue;
    }
  }
  // Leftovers are stale (state removed them). A descendant patch may already have
  // re-anchored one of these elsewhere, so only remove nodes still standing here.
  for (const h of unconsumed) {
    if (h.parentNode === live) h.remove();
  }
}

/**
 * Patch `live`'s children to match `html`, reusing keyed nodes found in `live`
 * and in `extraRoots` (the sibling HUD hosts a layout may have moved nodes into).
 *
 * Nodes that currently live directly inside a host (action grid in coreHud, scene
 * buttons in encounterTools, quest card in the tracker) are patched IN PLACE and
 * their fresh counterparts are removed from the incoming tree first: Chromium drops
 * a pending click when the pressed node is detached — even if it is re-inserted
 * before mouseup — so a held button must never move across an auxiliary rebuild.
 * @param {Element} live container whose children are reconciled
 * @param {string} html fresh render of that container's content
 * @param {Element[]} [extraRoots] additional live roots supplying reusable nodes
 * @returns {{ focusRestored: boolean, keptInHosts: Element[] }} keptInHosts lists the
 *   host-resident nodes that still belong where they are (layout cleanup keeps them)
 */
export function patchHud(live, html, extraRoots = []) {
  const hosts = extraRoots.filter(r => r);
  const roots = [live, ...hosts];
  const pool = collectPool(roots);
  const active = document.activeElement;
  const activeKey = active instanceof Element && roots.some(r => r.contains(active))
    ? identityKey(active) : null;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const inPlace = [];
  const keptInHosts = [];
  const hostResident = new Map();
  for (const [key, list] of pool) {
    for (const el of list) {
      if (hosts.some(h => el.parentElement === h)) {
        const entries = hostResident.get(key);
        if (entries) entries.push(el); else hostResident.set(key, [el]);
      }
    }
  }
  if (hostResident.size) {
    tpl.content.querySelectorAll(IDENTITY_SELECTOR).forEach(fresh => {
      const key = identityKey(fresh);
      if (!key) return;
      const candidates = hostResident.get(key);
      if (!candidates || !candidates.length) return;
      const liveNode = /** @type {Element} */ (candidates.shift());
      inPlace.push([liveNode, fresh]);
      keptInHosts.push(liveNode);
      fresh.remove();
    });
  }
  try {
    patchInto(live, tpl.content, pool);
    for (const [liveNode, freshNode] of inPlace) {
      patchAttributes(liveNode, freshNode);
      patchInto(liveNode, freshNode, pool);
    }
  } catch (error) {
    // Reconciliation must never leave a half-patched HUD: converge the plain way.
    // A dropped press/focus after this fallback is exactly what the CDP regression
    // asserts against, so the failure stays visible in verification.
    console.error('hud-patch fell back to full rebuild:', error);
    live.innerHTML = html;
  }
  let focusRestored = false;
  if (activeKey && active instanceof Element && !active.isConnected) {
    for (const root of roots) {
      const candidates = root.querySelectorAll(IDENTITY_SELECTOR);
      for (const el of candidates) {
        if (identityKey(el) === activeKey && !el.hasAttribute('disabled')) {
          /** @type {HTMLElement} */ (el).focus({ preventScroll: true });
          focusRestored = true;
          break;
        }
      }
      if (focusRestored) break;
    }
  }
  return { focusRestored, keptInHosts };
}
