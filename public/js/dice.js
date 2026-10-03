// dice.js — short animated d20/dN overlay
let overlay = null;

export function showDice(sides, result, label = '') {
  hideDice();
  overlay = document.createElement('div');
  overlay.className = 'dice-overlay';
  overlay.innerHTML = `
    <div class="dice-box">
      <div class="die-face">${result}</div>
      <div class="die-label">d${sides}${label ? ' · ' + label : ''}</div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(hideDice, 900);
}

export function hideDice() {
  if (overlay) { overlay.remove(); overlay = null; }
}

// convenience: animate then resolve (fixedResult accepts predetermined server rolls)
export function rollAnimated(sides, label, fixedResult = null) {
  const result = fixedResult != null ? fixedResult : (1 + Math.floor(Math.random() * sides));
  showDice(sides, result, label);
  return new Promise(resolve => setTimeout(() => resolve(result), 850));
}
