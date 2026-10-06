// Drobné pomocné funkce pro práci s DOM.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Dnešní datum v místním čase jako 'YYYY-MM-DD'. */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Aktuální čas jako 'HH:MM'. */
export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const longDate = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });

function utc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 'pondělí 3. března 2025' */
export function formatDateLong(dateStr) {
  return longDate.format(utc(dateStr));
}

/** '3. 3. 2025' */
export function formatDateShort(dateStr) {
  return shortDate.format(utc(dateStr));
}

export function toast(message, kind = 'success') {
  const el = document.createElement('div');
  const colors = kind === 'error'
    ? 'bg-red-600 text-white'
    : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900';
  el.className = `pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg transition-all duration-300 opacity-0 translate-y-2 ${colors}`;
  el.textContent = message;
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-2'));
  setTimeout(() => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 6000 : 2500);
}

/** Potvrzovací dialog → Promise<boolean>. Bez `danger` má potvrzovací tlačítko neutrální barvu. */
export function confirmDialog(text, okLabel = 'Potvrdit', { danger = true } = {}) {
  const dlg = $('#dlg-confirm');
  $('#dlg-confirm-text').textContent = text;
  const ok = $('#dlg-confirm-ok');
  ok.textContent = okLabel;
  ok.classList.toggle('bg-red-600', danger);
  ok.classList.toggle('hover:bg-red-700', danger);
  ok.classList.toggle('bg-indigo-600', !danger);
  ok.classList.toggle('hover:bg-indigo-700', !danger);
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

/** Zobrazí/skryje text chyby v elementu. */
export function setError(el, message) {
  el.textContent = message ?? '';
  el.hidden = !message;
}
