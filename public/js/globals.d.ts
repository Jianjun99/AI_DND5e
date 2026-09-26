// globals.d.ts — the SPA's shared window/document expandos, declared in one place
// so checkJs accepts them. Add new cross-file globals here, with a comment saying
// who writes them and who reads them.

// The vendored Three.js build is imported by absolute URL in the browser and has
// no type declarations; declaring it as any keeps the 2.5D renderer type-checked
// without stubbing the whole library.
declare module '/vendor/three.module.js';

interface Window {
  /** rules catalog published by app.js after /api/content loads; read by views */
  __rules: Record<string, any>;
  /** e2e test seam written by play.js (camera / follow / boardCount / playerTile / modelState) */
  __dndDebug: Record<string, any>;
  /** Safari's legacy audio constructor; sfx.js and tts.js fall back to it */
  webkitAudioContext: typeof AudioContext;
  /** tooltip.js — touch listeners bound once per session */
  __dndTooltipTouchBound: boolean;
  /** tooltip.js — auto-dismiss timer for tapped tooltips */
  __dndTooltipTimer: ReturnType<typeof setTimeout> | undefined;
}

interface Document {
  /** legacy fallback read by tooltip.js when a caller passes no rules catalog */
  __rules: Record<string, any>;
}

interface Element {
  /** tooltip.js — guards double-binding of hover listeners */
  _hasTooltip: boolean;
}
