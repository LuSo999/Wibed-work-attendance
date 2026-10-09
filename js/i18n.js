// Dvojjazyčnost: slovníky klíč → text s parametry {name}, množná čísla přes Intl.PluralRules,
// data, měsíce, dny a čísla přes Intl podle jazyka. Výchozí jazyk je VŽDY čeština
// (bez detekce z navigator.language). Modul funguje i v Node (testy) – DOM a localStorage
// používá jen, pokud existují.
import cs from './i18n/cs.js';
import en from './i18n/en.js';

export const DICTIONARIES = { cs, en };
export const LANGUAGES = ['cs', 'en'];
export const DEFAULT_LANGUAGE = 'cs';
const LOCALES = { cs: 'cs-CZ', en: 'en-GB' };
const STORAGE_KEY = 'language';

let current = DEFAULT_LANGUAGE;
const listeners = new Set();

const isLanguage = (lang) => LANGUAGES.includes(lang);

/** Jazyk uložený v prohlížeči (nebo výchozí čeština). */
export function storedLanguage() {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLanguage(v) ? v : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function getLanguage() {
  return current;
}

export function getLocale(lang = current) {
  return LOCALES[lang] ?? LOCALES[DEFAULT_LANGUAGE];
}

/** Přepne jazyk, uloží volbu do localStorage, nastaví <html lang> a upozorní posluchače. */
export function setLanguage(lang, { persist = true } = {}) {
  const next = isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  if (persist) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch { /* soukromé okno – volba platí jen do zavření */ }
  }
  const changed = next !== current;
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (changed) for (const fn of listeners) fn(next);
  return changed;
}

/** Posluchač změny jazyka; vrací funkci pro odhlášení. */
export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const pluralRules = new Map();
function pluralCategory(lang, count) {
  if (!pluralRules.has(lang)) pluralRules.set(lang, new Intl.PluralRules(getLocale(lang)));
  return pluralRules.get(lang).select(count);
}

/** Hodnota parametru: zpráva {key, params} se přeloží, ostatní se převede na text. */
function paramText(value, lang) {
  if (value && typeof value === 'object' && typeof value.key === 'string') return translate(lang, value.key, value.params);
  return value === null || value === undefined ? '' : String(value);
}

function translate(lang, key, params = {}) {
  let entry = DICTIONARIES[lang]?.[key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key];
  if (entry === undefined) return key;
  if (typeof entry === 'object') {
    const count = Number(params.count ?? 0);
    entry = entry[pluralCategory(lang, count)] ?? entry.other ?? entry.many ?? entry.one;
  }
  return entry.replace(/\{(\w+)\}/g, (m, name) => (name in params ? paramText(params[name], lang) : m));
}

/** Text pro klíč v aktuálním jazyce; množné číslo podle params.count. */
export function t(key, params) {
  return translate(current, key, params);
}

/** Překladač pevně svázaný s jazykem (např. pro export CSV nebo testy). */
export function translator(lang) {
  return (key, params) => translate(isLanguage(lang) ? lang : DEFAULT_LANGUAGE, key, params);
}

/** Přeloží zprávu z čistých funkcí ({key, params}), text nechá beze změny. */
export function tr(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  return t(message.key, message.params);
}

// ---------------------------------------------------------------------------
// Data, dny, měsíce a čísla přes Intl
// ---------------------------------------------------------------------------
const formatters = new Map();
function fmt(lang, kind, options) {
  const k = `${lang}|${kind}`;
  if (!formatters.has(k)) formatters.set(k, new Intl.DateTimeFormat(getLocale(lang), { timeZone: 'UTC', ...options }));
  return formatters.get(k);
}

function utc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 'pondělí 3. března 2025' / 'Monday 3 March 2025' */
export function formatDateLong(dateStr, lang = current) {
  return fmt(lang, 'long', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(utc(dateStr));
}

/** '3. 3. 2025' / '03/03/2025' */
export function formatDateShort(dateStr, lang = current) {
  return fmt(lang, 'short', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(utc(dateStr));
}

/** Zkratka dne v týdnu: 'Po' / 'Mon'. */
export function weekdayShort(dateStr, lang = current) {
  const text = fmt(lang, 'wd', { weekday: 'short' }).format(utc(dateStr)).replace('.', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Název dne podle čísla 1 = pondělí … 5 = pátek (případně 0/7 = neděle). */
export function weekdayName(day, lang = current) {
  // 4. 1. 2027 je pondělí, 3. 1. neděle
  const text = fmt(lang, 'wdl', { weekday: 'long' }).format(new Date(Date.UTC(2027, 0, 3 + (day % 7 || 7))));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 'Leden 2025' / 'January 2025' (samostatný tvar měsíce). */
export function formatMonthYear(y, m, lang = current) {
  const month = fmt(lang, 'month', { month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${y}`;
}

/** Číslo podle jazyka (desetinná čárka/tečka). */
export function formatNumber(value, options = {}, lang = current) {
  return new Intl.NumberFormat(getLocale(lang), options).format(value);
}

/** Desetinný oddělovač jazyka (cs ',', en '.'). */
export function decimalSeparator(lang = current) {
  return formatNumber(1.5, {}, lang).replace(/\d/g, '');
}

// ---------------------------------------------------------------------------
// Statické texty v HTML
// ---------------------------------------------------------------------------
/**
 * Přeloží prvky s atributy:
 *   data-i18n="klíč"                → textContent
 *   data-i18n-attr="title:klíč;aria-label:klíč2" → atributy
 */
export function applyTranslations(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}
