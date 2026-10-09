// Drobné pomocné funkce pro práci s DOM.
import { t } from './i18n.js';

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

// Formátování dat podle jazyka (Intl) – viz i18n.js.
export { formatDateLong, formatDateShort } from './i18n.js';

/**
 * Krátké oznámení dole na obrazovce (nezabírá místo v rozložení).
 * S `action` přidá malý odkaz (např. „Zpět“) a oznámení zmizí po `duration` ms (výchozí 8 s).
 */
export function toast(message, kind = 'success', { action = null, duration = null } = {}) {
  const el = document.createElement('div');
  const colors = kind === 'error'
    ? 'bg-red-600 text-white'
    : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900';
  el.className = `pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg transition-all duration-300 opacity-0 translate-y-2 ${colors}`;
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  const hide = () => {
    el.classList.add('opacity-0');
    setTimeout(() => el.remove(), 300);
  };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shrink-0 text-xs font-semibold underline underline-offset-2 opacity-80 hover:opacity-100';
    btn.textContent = `↶ ${action.label}`;
    btn.addEventListener('click', () => {
      action.onClick();
      hide();
    }, { once: true });
    el.append(btn);
  }
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-2'));
  setTimeout(hide, duration ?? (action ? 8000 : kind === 'error' ? 6000 : 2500));
}

/** Potvrzovací dialog → Promise<boolean>. Bez `danger` má potvrzovací tlačítko neutrální barvu. */
export function confirmDialog(text, okLabel = t('common.confirm'), { danger = true } = {}) {
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
