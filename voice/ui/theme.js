// Lin's look: theme (dark, light or match Windows), contrast and motion. Runs before the page draws so it never flashes.
// Choices are a per-browser convenience kept in localStorage; Lin works the same without them.
(() => {
  'use strict';
  const root = document.documentElement;
  const KEYS = {theme: 'lin-theme', contrast: 'lin-contrast', motion: 'lin-motion', captions: 'lin-captions', sounds: 'lin-sounds'};
  const DEFAULTS = {theme: 'dark', contrast: 'normal', motion: 'full', captions: 'auto', sounds: 'on'};
  const dark = matchMedia('(prefers-color-scheme: dark)'), reduce = matchMedia('(prefers-reduced-motion: reduce)'), more = matchMedia('(prefers-contrast: more)');
  const read = k => { try { return localStorage.getItem(KEYS[k]) || DEFAULTS[k]; } catch { return DEFAULTS[k]; } };
  const write = (k, v) => { try { localStorage.setItem(KEYS[k], v); } catch {} };
  function apply() {
    const theme = read('theme');
    root.dataset.theme = theme;
    root.dataset.themeResolved = theme === 'system' ? (dark.matches ? 'dark' : 'light') : theme;
    root.dataset.contrast = read('contrast') === 'more' || more.matches ? 'more' : 'normal';
    root.dataset.motion = read('motion') === 'calm' || reduce.matches ? 'calm' : 'full';
    root.dataset.captions = read('captions');
    document.dispatchEvent(new CustomEvent('lin:theme', {detail: {...root.dataset}}));
  }
  for (const m of [dark, reduce, more]) m.addEventListener('change', apply);
  window.linTheme = {
    get: k => read(k),
    set(k, v) { if (!(k in KEYS)) return; write(k, v); apply(); },
    resolved: () => root.dataset.themeResolved,
    calm: () => root.dataset.motion === 'calm'
  };
  // Opened again within five minutes: skip the start-up sequence and go straight to the last frame.
  try {
    const last = Number(localStorage.getItem('lin-last-open') || 0);
    root.dataset.reopened = Date.now() - last < 5 * 60 * 1000 ? '1' : '0';
    const mark = () => { try { localStorage.setItem('lin-last-open', String(Date.now())); } catch {} };
    mark(); setInterval(mark, 30000); addEventListener('pagehide', mark);
  } catch { root.dataset.reopened = '0'; }
  apply();
})();
