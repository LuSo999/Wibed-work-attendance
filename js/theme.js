// Dark / Light mode: 'system' (výchozí) respektuje nastavení OS, volba se pamatuje.
const KEY = 'theme';
const ORDER = ['system', 'light', 'dark'];
const media = window.matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function getTheme() {
  return stored();
}

export function applyTheme(theme = stored()) {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f172a' : '#4f46e5');
}

/** Přepne na další režim v pořadí systém → světlý → tmavý a vrátí ho. */
export function cycleTheme() {
  const next = ORDER[(ORDER.indexOf(stored()) + 1) % ORDER.length];
  try {
    localStorage.setItem(KEY, next);
  } catch { /* soukromé okno – volba platí jen do zavření */ }
  applyTheme(next);
  return next;
}

media.addEventListener('change', () => applyTheme());
