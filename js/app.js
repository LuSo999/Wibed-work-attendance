// Vstupní bod aplikace: kontrola configu, přihlášení, obrazovky a jejich propojení.
import { firebaseConfig } from './firebase-config.js';
import { applyTheme, cycleTheme, getTheme } from './theme.js';
import {
  DAY_TYPES, dayResult, dayFund, holidayName, isWorkday, isAbsenceType, daysInMonth, toDateString,
  monthSummary, bankBalance, validateDay, validateWithdrawal, formatMinutes, parseTime, configureHolidays,
} from './calc.js';
import { buildMonthCsv, downloadCsv } from './csv.js';
import { enhanceTimeInputs, refreshTimeInputs } from './time24.js';
import {
  normalizeSettings, rulesFromSettings, buildMonthPlan, fillRecord, holidayChangeImpact,
} from './plan.js';
import {
  initPlanView, renderPlanView, weekBadgeHtml, flipParity, renderImpact,
} from './plan-view.js';
import {
  t, tr, setLanguage, getLanguage, storedLanguage, onLanguageChange, applyTranslations, LANGUAGES,
  formatMonthYear, weekdayShort,
} from './i18n.js';
import {
  $, $$, escapeHtml, todayStr, nowTime, formatDateLong, formatDateShort, toast,
  confirmDialog, setError,
} from './ui.js';

// ---------------------------------------------------------------------------
// Stav
// ---------------------------------------------------------------------------
const now = new Date();
const DEFAULT_APP = Object.freeze({ czHolidays: true, onboardingDone: false });
const state = {
  user: null,
  records: new Map(), // 'YYYY-MM-DD' → záznam
  withdrawals: [],
  settings: normalizeSettings({}), // users/{uid}/settings/plan
  app: { ...DEFAULT_APP }, // users/{uid}/settings/app
  appLoaded: false, // dorazil stav settings/app ze serveru
  overrides: new Map(), // 'YYYY-MM-DD' → výjimka dne pro plán
  month: { y: now.getFullYear(), m: now.getMonth() + 1 },
  timeTouched: false,
  unsubscribe: null,
};
let auth; // modul auth.js (načte se dynamicky)
let store; // modul store.js

const records = () => [...state.records.values()];
/** Pravidla uživatele – denní fond a přestávka (nastavení plánu, výchozí 8 h a 30 min po 6 h). */
const rules = () => rulesFromSettings(state.settings);
const balance = () => bankBalance(records(), state.withdrawals, rules());

function safeResult(record) {
  try {
    return dayResult(record, rules());
  } catch {
    return null;
  }
}

/** Zůstatek banky bez vlivu daného dne (pro validaci jeho změny). */
function balanceWithout(date) {
  const r = state.records.get(date);
  return balance() - (r ? safeResult(r)?.bankDelta ?? 0 : 0);
}

const signed = (min) => formatMinutes(min, { sign: true });
const toneClass = (min) => (min > 0
  ? 'text-emerald-600 dark:text-emerald-400'
  : min < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400');
const typeLabel = (type) => t(`type.${type}`);

const TYPE_BADGE = {
  work: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  vacation: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  sick: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  doctor: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300',
  comp: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
};
const filledChip = () => `<span class="inline-block rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">${escapeHtml(t('tag.filled'))}</span>`;
const badge = (type) => `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[type] ?? ''}">${escapeHtml(TYPE_BADGE[type] ? typeLabel(type) : type)}</span>`;

// ---------------------------------------------------------------------------
// Obrazovky
// ---------------------------------------------------------------------------
function showScreen(name) {
  for (const s of ['loading', 'setup', 'auth', 'app']) $(`#screen-${s}`).hidden = s !== name;
}

function isConfigured(cfg) {
  return ['apiKey', 'authDomain', 'projectId', 'appId'].every(
    (k) => typeof cfg?.[k] === 'string' && cfg[k].trim() !== '' && !/YOUR_|PLACEHOLDER/i.test(cfg[k]),
  );
}

let setupDetail = null; // zpráva {key, params} pro obrazovku s instrukcí

function showSetup(detail = null) {
  setupDetail = detail;
  setError($('#setup-detail'), detail ? tr(detail) : null);
  showScreen('setup');
}

// ---------------------------------------------------------------------------
// Téma
// ---------------------------------------------------------------------------
const THEME_ICONS = { system: '🖥️', light: '☀️', dark: '🌙' };

function renderThemeButton() {
  const theme = getTheme();
  const btn = $('#btn-theme');
  btn.textContent = THEME_ICONS[theme];
  btn.title = t('theme.title', { name: t(`theme.${theme}`) });
  btn.setAttribute('aria-label', btn.title);
}

// ---------------------------------------------------------------------------
// Jazyk
// ---------------------------------------------------------------------------
const README_URLS = {
  cs: 'https://github.com/LuSo999/Wibed-work-attendance/blob/main/README.cs.md',
  en: 'https://github.com/LuSo999/Wibed-work-attendance/blob/main/README.md',
};

/** Statické texty, odkazy a přepínače podle aktuálního jazyka. */
function renderLanguage() {
  const lang = getLanguage();
  applyTranslations();
  document.title = t('app.title');
  for (const a of $$('[data-readme-link]')) a.href = README_URLS[lang];
  const btn = $('#btn-lang');
  const next = LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length];
  btn.textContent = lang.toUpperCase();
  btn.title = t('lang.switchTo', { name: t(`lang.${next}`) });
  btn.setAttribute('aria-label', btn.title);
  for (const b of $$('[data-set-lang]')) {
    const active = b.dataset.setLang === lang;
    b.classList.toggle('bg-indigo-600', active);
    b.classList.toggle('text-white', active);
    b.setAttribute('aria-pressed', String(active));
  }
  const sel = $('#form-plan-settings').language;
  if (sel) sel.value = lang;
  renderThemeButton();
  renderAuthMode();
  if (setupDetail) setError($('#setup-detail'), tr(setupDetail));
  auth?.setAuthLanguage(lang);
}

/**
 * Změna jazyka uživatelem (horní lišta, přihlášení, nastavení): uloží volbu
 * a u přihlášeného uživatele se zapnutými svátky se zeptá, zda je vypnout.
 */
async function changeLanguage(lang) {
  if (lang === getLanguage()) return;
  setLanguage(lang);
  if (!state.user) return;
  store.saveAppSettings(state.user.uid, { language: lang })
    .catch((e) => toast(t('toast.saveFailed', { error: e.message }), 'error'));
  await askHolidays();
}

/** Po změně jazyka se překreslí vše bez reloadu. */
onLanguageChange(() => {
  renderLanguage();
  refreshTimeInputs();
  typeOptions($('#entry-type'));
  typeOptions($('#form-day').type);
  if (state.user) renderAll();
});

// ---------------------------------------------------------------------------
// České státní svátky (settings/app.czHolidays)
// ---------------------------------------------------------------------------
function applyHolidays() {
  configureHolidays({ enabled: state.app.czHolidays !== false });
}

/** Uloží stav svátků (dialog dopadu už proběhl). */
function saveHolidays(enabled) {
  state.app = { ...state.app, czHolidays: enabled };
  applyHolidays();
  renderAll();
  store.saveAppSettings(state.user.uid, { czHolidays: enabled })
    .catch((e) => toast(t('toast.saveFailed', { error: e.message }), 'error'));
  toast(t(enabled ? 'holidays.onToast' : 'holidays.offToast'));
}

/**
 * Dotaz „Vypnout české státní svátky?“ (Ponechat / Vypnout, předvybrán aktuální stav)
 * s dopadem na banku. Přeskočí se, když by nic nenabízel (svátky už jsou vypnuté).
 */
function askHolidays() {
  if (!state.user || state.app.czHolidays === false) return Promise.resolve();
  const impact = holidayChangeImpact({
    records: records(), withdrawals: state.withdrawals, settings: state.settings, enabled: false,
  });
  renderImpact($('#holidays-impact'), impact);
  const dlg = $('#dlg-holidays');
  dlg.returnValue = '';
  dlg.showModal();
  $('#holidays-keep').focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue === 'off') saveHolidays(false);
      resolve();
    }, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Navigace
// ---------------------------------------------------------------------------
const TABS = {
  overview: 'prehled', month: 'mesic', plan: 'plan', bank: 'banka',
};

function showTab(tab) {
  if (!TABS[tab]) tab = 'overview';
  for (const k of Object.keys(TABS)) $(`#tab-${k}`).hidden = k !== tab;
  for (const btn of $$('.tab-btn')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('text-indigo-600', active);
    btn.classList.toggle('dark:text-indigo-400', active);
    btn.classList.toggle('bg-indigo-50', active && !btn.closest('.fixed'));
    btn.classList.toggle('dark:bg-indigo-950/50', active && !btn.closest('.fixed'));
    btn.classList.toggle('text-slate-500', !active);
    btn.classList.toggle('dark:text-slate-400', !active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  }
}

function tabFromHash() {
  const key = location.hash.slice(1);
  return Object.keys(TABS).find((k) => TABS[k] === key) ?? 'overview';
}

// ---------------------------------------------------------------------------
// Přehled
// ---------------------------------------------------------------------------
function typeOptions(select) {
  const value = select.value;
  select.innerHTML = Object.values(DAY_TYPES)
    .map((type) => `<option value="${type}">${escapeHtml(typeLabel(type))}</option>`).join('');
  if (value) select.value = value;
}

function dayInfoText(date) {
  const parts = [formatDateLong(date)];
  const holiday = holidayName(date);
  if (holiday) parts.push(t('entry.holiday', { name: t(holiday) }));
  else if (!isWorkday(date)) parts.push(t('common.weekend'));
  if (!isWorkday(date)) parts.push(t('entry.offDayFund'));
  if (isAbsenceType($('#entry-type').value)) parts.push(t('entry.partialHint'));
  return parts.join(' · ');
}

function renderBank() {
  const b = balance();
  for (const id of ['#bank-balance', '#bank-balance-2']) {
    const el = $(id);
    el.textContent = `${signed(b)} h`;
    el.classList.toggle('text-rose-200', b < 0);
  }
  const d = new Date();
  const s = monthSummary(records(), d.getFullYear(), d.getMonth() + 1, state.withdrawals, rules());
  $('#bank-month').textContent = `${signed(s.overtime)} h`;
  $('#bank-fund').textContent = `${formatMinutes(s.fund)} h`;
}

function renderEntry() {
  const date = $('#entry-date').value || todayStr();
  const type = $('#entry-type').value;
  const record = state.records.get(date);
  const isWork = type === DAY_TYPES.WORK;

  $('#entry-day-info').textContent = dayInfoText(date);
  $('#entry-work').hidden = !isWork;
  $('#entry-nonwork').hidden = isWork;
  $('#btn-save-type').textContent = t('entry.saveAs', { type: typeLabel(type) });

  const status = $('#entry-status');
  if (!record) {
    status.innerHTML = `<p class="col-span-full text-slate-500 dark:text-slate-400">${escapeHtml(t('entry.nothing'))}</p>`;
    $('#btn-entry-edit').hidden = true;
    return;
  }
  $('#btn-entry-edit').hidden = false;
  const res = safeResult(record);
  const chip = record.filled ? filledChip() : '';
  if (record.type !== DAY_TYPES.WORK && !res?.partial) {
    const bank = res?.bankDelta ? t('entry.fromBank', { hours: signed(res.bankDelta) }) : '';
    status.innerHTML = `
      <div class="col-span-full flex items-center gap-2">${badge(record.type)}${chip}
        <span class="text-slate-500 dark:text-slate-400">${escapeHtml(t('entry.credited', { hours: formatMinutes(res?.credited ?? 0) }))}${escapeHtml(bank)}</span>
      </div>`;
    return;
  }
  const cell = (label, value, cls = '') => `
    <div><p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtml(label)}</p>
    <p class="tabular text-lg font-semibold ${cls}">${value}</p></div>`;
  status.innerHTML = [
    cell(t('field.arrival'), escapeHtml(record.arrival ?? '—')),
    cell(t('field.departure'), escapeHtml(record.departure ?? '—')),
    cell(t('entry.worked'), res?.complete ? `${formatMinutes(res.worked)} h` : '—'),
    cell(t('entry.overtime'), res?.complete ? `${signed(res.overtime)} h` : '—', res?.complete ? toneClass(res.overtime) : ''),
  ].join('') + (res?.partial || chip
    ? `<p class="col-span-full flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">${res?.partial ? `${badge(record.type)} ${escapeHtml(t('entry.partialCredited', { hours: formatMinutes(res.absence) }))}` : ''}${chip}</p>`
    : '') + (res?.complete && res.break
    ? `<p class="col-span-full text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('entry.stayBreak', { stay: formatMinutes(res.stay), break: formatMinutes(res.break) }))}</p>`
    : '') + (res === null ? `<p class="col-span-full text-xs text-red-600">${escapeHtml(t('entry.invalid'))}</p>` : '');
}

/** Při změně data přepne výběr typu podle uloženého záznamu. */
function syncEntryType() {
  const record = state.records.get($('#entry-date').value);
  // částečná nepřítomnost se zapisuje příchodem/odchodem jako pracovní den
  $('#entry-type').value = record && !safeResult(record)?.partial ? record.type : DAY_TYPES.WORK;
}

function refreshTime() {
  if (!state.timeTouched) $('#entry-time').value = nowTime();
}

/** Uloží záznam dne; vrací null nebo přeloženou chybu. */
function saveRecord(record) {
  const err = validateDay(record, balanceWithout(record.date), rules());
  if (err) return tr(err);
  // Zápis se díky offline cache Firestore projeví okamžitě; chyba (např. pravidla) se ohlásí později.
  store.saveDay(state.user.uid, record).catch((e) => toast(t('toast.saveFailed', { error: e.message }), 'error'));
  return null;
}

async function onClock(kind) {
  const date = $('#entry-date').value;
  const time = $('#entry-time').value;
  const errEl = $('#entry-error');
  if (!date || parseTime(time) === null) return setError(errEl, t('entry.invalidDateTime'));

  const existing = state.records.get(date);
  const partial = existing && safeResult(existing)?.partial;
  const base = existing?.type === DAY_TYPES.WORK || partial
    ? { ...existing, filled: false }
    : { date, type: DAY_TYPES.WORK, arrival: null, departure: null, note: existing?.note ?? '' };

  if (existing && existing.type !== DAY_TYPES.WORK && !partial
    && !(await confirmDialog(t('entry.overwriteType', { type: typeLabel(existing.type) }), t('common.overwrite')))) return;

  const field = kind === 'arrival' ? 'arrival' : 'departure';
  if (base[field] && base[field] !== time
    && !(await confirmDialog(t(kind === 'arrival' ? 'entry.overwriteArrival' : 'entry.overwriteDeparture', { old: base[field], time }), t('common.overwrite')))) return;

  base[field] = time;
  const err = saveRecord(base);
  setError(errEl, err);
  if (err) return;
  toast(t(kind === 'arrival' ? 'entry.arrivalSaved' : 'entry.departureSaved', { time }));
  state.timeTouched = false;
  refreshTime();
}

async function onSaveType() {
  const date = $('#entry-date').value;
  const type = $('#entry-type').value;
  const existing = state.records.get(date);
  if (existing?.type === DAY_TYPES.WORK && (existing.arrival || existing.departure)
    && !(await confirmDialog(t('entry.overwriteTimes'), t('common.overwrite')))) return;
  const err = saveRecord({ date, type, note: existing?.note ?? '' });
  setError($('#entry-error'), err);
  if (!err) toast(t('entry.savedType', { type: typeLabel(type) }));
}

// ---------------------------------------------------------------------------
// Měsíc
// ---------------------------------------------------------------------------
function summaryCard(label, value, sub = '', cls = '') {
  return `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtml(label)}</p>
      <p class="tabular mt-1 text-xl font-bold ${cls}">${value}</p>
      ${sub ? `<p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(sub)}</p>` : ''}
    </div>`;
}

function renderMonth() {
  const { y, m } = state.month;
  $('#month-title').textContent = formatMonthYear(y, m);
  const s = monthSummary(records(), y, m, state.withdrawals, rules());
  $('#month-summary').innerHTML = [
    summaryCard(t('month.fund'), `${formatMinutes(s.fund)} h`, t('month.workdays', { count: s.workdays })),
    summaryCard(t('month.worked'), `${formatMinutes(s.credited)} h`, t('month.workedSub', { hours: formatMinutes(s.worked) })),
    summaryCard(t('month.overtime'), `${signed(s.overtime)} h`, t('month.perMonth'), toneClass(s.overtime)),
    summaryCard(t('month.used'), `${formatMinutes(s.used)} h`, t('type.comp')),
  ].join('');
  const pct = s.fund ? Math.min(100, Math.round((s.credited / s.fund) * 100)) : 0;
  $('#month-progress').style.width = `${pct}%`;
  $('#month-progress-text').textContent = `${formatMinutes(s.credited)} / ${formatMinutes(s.fund)} h (${pct} %)`;

  const today = todayStr();
  const items = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = toDateString(y, m, d);
    const r = state.records.get(date);
    const off = !isWorkday(date);
    const holiday = holidayName(date);
    const res = r ? safeResult(r) : null;
    let middle = '';
    let right = '';
    if (r) {
      const times = `<span class="tabular">${escapeHtml(r.arrival ?? '—')} – ${escapeHtml(r.departure ?? '…')}</span>`;
      if (r.type === DAY_TYPES.WORK) middle = times;
      else if (res?.partial) middle = `${r.arrival ? `${times} ` : ''}${badge(r.type)} <span class="tabular text-xs">${formatMinutes(res.absence)} h</span>`;
      else middle = badge(r.type);
      if (r.filled) middle += ` ${filledChip()}`;
      if (res === null) {
        right = `<span class="text-xs text-red-600">${escapeHtml(t('month.invalid'))}</span>`;
      } else if (res.complete) {
        right = `<span class="tabular font-semibold">${formatMinutes(res.credited)}</span>
          <span class="tabular block text-xs ${toneClass(res.bankDelta)}">${res.bankDelta ? signed(res.bankDelta) : '±0:00'}</span>`;
      } else {
        right = `<span class="text-xs text-amber-600 dark:text-amber-400">${escapeHtml(t('month.inProgress'))}</span>`;
      }
    }
    const note = [holiday ? t(holiday) : '', r?.note].filter(Boolean).map(escapeHtml).join(' · ');
    items.push(`
      <li>
        <button type="button" data-date="${date}" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 ${off ? 'bg-slate-50/70 dark:bg-slate-950/40' : ''}">
          <span class="w-12 shrink-0 text-center ${date === today ? 'rounded-lg bg-indigo-600 py-1 text-white' : ''}">
            <span class="block text-xs ${date === today ? '' : off ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}">${escapeHtml(weekdayShort(date))}</span>
            <span class="tabular block font-bold">${d}.</span>
          </span>
          <span class="min-w-0 flex-1 text-sm">
            ${middle || `<span class="text-slate-400 dark:text-slate-600">${off ? '' : '—'}</span>`}
            ${note ? `<span class="block truncate text-xs text-slate-500 dark:text-slate-400">${note}</span>` : ''}
          </span>
          <span class="shrink-0 text-right text-sm">${right}</span>
        </button>
      </li>`);
  }
  $('#month-days').innerHTML = items.join('');
}

function shiftMonth(delta) {
  let { y, m } = state.month;
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  state.month = { y, m };
  renderMonth();
}

function exportMonth() {
  const { y, m } = state.month;
  const csv = buildMonthCsv(records(), state.withdrawals, y, m, rules(), { lang: getLanguage() });
  downloadCsv(csv, `${t('csv.filename')}-${y}-${String(m).padStart(2, '0')}.csv`);
}

// ---------------------------------------------------------------------------
// Dialog úpravy dne
// ---------------------------------------------------------------------------
let dialogDate = null;
let dialogFilled = false; // příznak „doplněno“ – ruční úprava časů ho zruší

function dialogRecord() {
  const f = $('#form-day');
  const absence = isAbsenceType(f.type.value) && f.absenceHours.value !== '';
  return {
    date: dialogDate,
    type: f.type.value,
    arrival: f.arrival.value || null,
    departure: f.departure.value || null,
    absenceHours: absence ? f.absenceHours.valueAsNumber : null,
    filled: dialogFilled,
    note: f.note.value,
  };
}

function updateDialog() {
  const rec = dialogRecord();
  const res0 = safeResult(rec);
  $('#dlg-day-absence').hidden = rec.type === DAY_TYPES.WORK;
  $('#dlg-day-times').hidden = rec.type !== DAY_TYPES.WORK && !res0?.partial;
  $('#dlg-day-filled').hidden = !dialogFilled;
  $('#dlg-day-fill').hidden = !isWorkday(dialogDate) || dialogDate > todayStr();
  const err = validateDay(rec, balanceWithout(dialogDate), rules());
  setError($('#dlg-day-error'), err ? tr(err) : null);
  $('#dlg-day-save').disabled = Boolean(err);
  const res = err ? null : res0;
  let text = t('day.fund', { hours: formatMinutes(dayFund(dialogDate, rules())) });
  if (res && (rec.type === DAY_TYPES.WORK || res.partial) && res.complete) {
    text = t('day.calc', { stay: formatMinutes(res.stay), break: formatMinutes(res.break), worked: formatMinutes(res.worked) })
      + (res.partial ? t('day.calcAbsence', { type: typeLabel(rec.type).toLowerCase(), hours: formatMinutes(res.absence) }) : '')
      + t('day.calcOvertime', { hours: signed(res.overtime) });
  } else if (res && rec.type !== DAY_TYPES.WORK && !res.partial) {
    text = t('day.creditedOnly', { hours: formatMinutes(res.credited) })
      + (res.bankDelta ? t('day.fromBank', { hours: signed(res.bankDelta) }) : t('day.noOvertime'));
  }
  $('#dlg-day-preview').textContent = text;
}

function dialogSubtitle(date) {
  const holiday = holidayName(date);
  if (holiday) return t(holiday);
  return t(isWorkday(date) ? 'day.workday' : 'common.weekendDay');
}

function openDayDialog(date) {
  dialogDate = date;
  const r = state.records.get(date);
  const f = $('#form-day');
  f.type.value = r?.type ?? DAY_TYPES.WORK;
  f.arrival.value = r?.arrival ?? '';
  f.departure.value = r?.departure ?? '';
  f.absenceHours.value = r?.absenceHours ?? '';
  f.note.value = r?.note ?? '';
  dialogFilled = Boolean(r?.filled);
  $('#dlg-day-title').textContent = formatDateLong(date);
  $('#dlg-day-sub').textContent = dialogSubtitle(date);
  $('#dlg-day-delete').hidden = !r;
  updateDialog();
  $('#dlg-day').showModal();
}

/** „Doplnit docházku“ v dialogu: nastaví odchod tak, aby den vyšel přesně do fondu. */
function fillDialog() {
  const current = dialogRecord();
  const base = { ...current, departure: null };
  const rec = fillRecord(dialogDate, base, state.settings, state.overrides.get(dialogDate));
  if (!rec) return setError($('#dlg-day-error'), t('fill.impossible'));
  const f = $('#form-day');
  f.type.value = rec.type;
  f.absenceHours.value = rec.absenceHours ?? '';
  f.arrival.value = rec.arrival ?? '';
  f.departure.value = rec.departure ?? '';
  dialogFilled = true;
  updateDialog();
}

// ---------------------------------------------------------------------------
// Plán – karta „Dnes“ a odznak týdne
// ---------------------------------------------------------------------------
function todayPlanDay() {
  const d = new Date();
  const plan = buildMonthPlan({
    year: d.getFullYear(), month: d.getMonth() + 1, today: todayStr(), settings: state.settings, records: records(), overrides: [...state.overrides.values()],
  });
  return plan.days.find((x) => x.date === todayStr());
}

function renderTodayPlan() {
  $('#overview-week').innerHTML = weekBadgeHtml(state.settings);
  const d = todayPlanDay();
  const title = $('#today-plan-title');
  const sub = $('#today-plan-sub');
  const btn = $('#btn-use-plan');
  btn.hidden = true;
  // poznámka z plánu (výjimka dne) – oddělená od poznámky v docházce
  const note = state.overrides.get(todayStr())?.note?.trim();
  $('#today-plan-note').textContent = note ? `📝 ${note}` : '';
  $('#today-plan-note').hidden = !note;
  if (!d || (!d.workday && !d.record)) {
    title.textContent = t('today.noWork');
    sub.textContent = d?.holiday ? t(d.holiday) : t('common.weekend');
  } else if (d.plannedWorked === null) {
    title.textContent = t('today.done', { hours: formatMinutes(d.credited) });
    sub.textContent = d.record?.departure ? t('today.leftAt', { time: d.record.departure }) : (d.type ? typeLabel(d.type) : '');
  } else if (d.kind === 'absence') {
    title.textContent = t('today.absence', { type: typeLabel(d.type) });
    sub.textContent = t('common.wholeDay');
  } else if (d.plannedLeave && d.arrival) {
    const how = t(d.kind === 'fixed' ? 'today.howFixed' : d.kind === 'override' ? 'today.howOverride' : 'today.howRegular');
    // před příchodem nabídne plánovaný příchod, po něm plánovaný odchod
    const next = d.actualArrival ? 'departure' : 'arrival';
    title.textContent = next === 'arrival'
      ? t('today.planBoth', { arrival: d.arrival, leave: d.plannedLeave })
      : t('today.planLeave', { leave: d.plannedLeave });
    sub.textContent = [
      t('today.hoursWork', { hours: formatMinutes(d.plannedWorked) }),
      d.actualArrival ? t('today.arrivedAt', { time: d.arrival }) : '',
      how,
    ].filter(Boolean).join(' · ');
    btn.hidden = false;
    btn.dataset.time = next === 'arrival' ? d.arrival : d.plannedLeave;
    btn.dataset.next = next;
  } else {
    title.textContent = t('today.cannotPlan');
    sub.textContent = tr(d.warnings[0]);
  }
}

function usePlan() {
  const { time, next } = $('#btn-use-plan').dataset;
  if (!time) return;
  $('#entry-date').value = todayStr();
  syncEntryType();
  $('#entry-time').value = time;
  state.timeTouched = true;
  renderEntry();
  toast(t('today.timeSet', { time, button: t(next === 'arrival' ? 'entry.arrival' : 'entry.departure') }));
}

// ---------------------------------------------------------------------------
// Banka
// ---------------------------------------------------------------------------
function withdrawMinutes() {
  const v = $('#form-withdraw').hours.valueAsNumber;
  return Number.isFinite(v) ? Math.round(v * 60) : NaN;
}

function updateWithdrawForm() {
  const f = $('#form-withdraw');
  const minutes = withdrawMinutes();
  const err = f.hours.value === '' ? null : validateWithdrawal(minutes, balance());
  setError($('#withdraw-error'), err ? tr(err) : null);
  $('#btn-withdraw').disabled = Boolean(err) || f.hours.value === '' || !f.date.value || balance() <= 0;
  if (balance() <= 0 && !err) setError($('#withdraw-error'), t('bank.empty'));
}

function renderBankHistory() {
  const items = [
    ...state.withdrawals.map((w) => ({ date: w.date, minutes: w.minutes, note: w.note, id: w.id })),
    ...records().filter((r) => r.type === DAY_TYPES.COMP).map((r) => ({
      date: r.date, minutes: safeResult(r)?.absence ?? 0, note: r.note, comp: true,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  $('#bank-history').innerHTML = items.length ? items.map((it) => `
    <li class="flex items-center gap-3 px-5 py-3">
      <div class="min-w-0 flex-1">
        <p class="font-medium">${formatDateShort(it.date)} ${it.comp ? badge('comp') : ''}</p>
        ${it.note ? `<p class="truncate text-sm text-slate-500 dark:text-slate-400">${escapeHtml(it.note)}</p>` : ''}
      </div>
      <span class="tabular font-semibold text-rose-600 dark:text-rose-400">−${formatMinutes(it.minutes)} h</span>
      ${it.comp
    ? `<button type="button" data-edit-date="${it.date}" class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="${escapeHtml(t('bank.editDay'))}">✎</button>`
    : `<button type="button" data-delete-id="${escapeHtml(it.id)}" class="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40" title="${escapeHtml(t('bank.deleteWithdrawal'))}">✕</button>`}
    </li>`).join('')
    : `<li class="px-5 py-6 text-center text-sm text-slate-500 dark:text-slate-400">${escapeHtml(t('bank.noHistory'))}</li>`;
}

// ---------------------------------------------------------------------------
// Vykreslení všeho po změně dat
// ---------------------------------------------------------------------------
function renderAll() {
  renderBank();
  renderTodayPlan();
  renderEntry();
  renderMonth();
  renderPlanView();
  renderBankHistory();
  updateWithdrawForm();
  if ($('#dlg-day').open) updateDialog();
}

// ---------------------------------------------------------------------------
// Přihlášení
// ---------------------------------------------------------------------------
let registerMode = false;

function renderAuthMode() {
  $('#btn-auth-submit').textContent = t(registerMode ? 'auth.register' : 'auth.login');
  $('#btn-auth-toggle').textContent = t(registerMode ? 'auth.haveAccount' : 'auth.register');
}

function setupAuthScreen() {
  const form = $('#form-auth');
  const errEl = $('#auth-error');
  const infoEl = $('#auth-info');
  const submit = $('#btn-auth-submit');

  const setMode = (reg) => {
    registerMode = reg;
    renderAuthMode();
    form.password.autocomplete = reg ? 'new-password' : 'current-password';
    setError(errEl, null);
  };

  $('#btn-auth-toggle').addEventListener('click', () => setMode(!registerMode));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(errEl, null);
    setError(infoEl, null);
    submit.disabled = true;
    try {
      const { email, password } = form;
      if (registerMode) await auth.registerEmail(email.value.trim(), password.value);
      else await auth.loginEmail(email.value.trim(), password.value);
    } catch (err) {
      setError(errEl, auth.authErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });

  $('#btn-auth-reset').addEventListener('click', async () => {
    setError(errEl, null);
    setError(infoEl, null);
    const email = form.email.value.trim();
    if (!email) return setError(errEl, t('auth.resetNeedEmail'));
    try {
      await auth.resetPassword(email);
      setError(infoEl, t('auth.resetSent'));
    } catch (err) {
      setError(errEl, auth.authErrorMessage(err));
    }
  });

  $('#btn-google').addEventListener('click', async () => {
    setError(errEl, null);
    try {
      await auth.loginGoogle();
    } catch (err) {
      setError(errEl, auth.authErrorMessage(err));
    }
  });

  auth.checkRedirectResult().catch((err) => setError(errEl, auth.authErrorMessage(err)));
}

/** Stav settings/app ze snapshotu: jazyk, svátky a jednorázový dotaz po prvním přihlášení. */
function onAppSettings({ exists, data, fromCache }) {
  const prevHolidays = state.app.czHolidays;
  state.app = { ...DEFAULT_APP, ...data, czHolidays: data.czHolidays !== false };
  if (exists && LANGUAGES.includes(data.language) && data.language !== getLanguage()) setLanguage(data.language);
  applyHolidays();
  if (prevHolidays !== state.app.czHolidays || !state.appLoaded) renderAll();
  if (fromCache || state.appLoaded) return;
  state.appLoaded = true;
  if (!exists) {
    // První přihlášení bez settings/app: uloží jazyk z prohlížeče a jednorázově
    // se zeptá na svátky, pokud uživatel nepoužívá češtinu.
    const lang = getLanguage();
    store.saveAppSettings(state.user.uid, { language: lang, czHolidays: true })
      .catch((e) => toast(t('toast.saveFailed', { error: e.message }), 'error'));
    if (lang !== 'cs') askHolidays();
  }
}

function onUser(user) {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.user = user;
  state.records = new Map();
  state.withdrawals = [];
  state.settings = normalizeSettings({});
  state.overrides = new Map();
  state.app = { ...DEFAULT_APP };
  state.appLoaded = false;
  applyHolidays();

  if (!user) {
    $('#form-auth').reset();
    showScreen('auth');
    return;
  }

  const btn = $('#btn-user');
  if (user.photoURL) {
    btn.innerHTML = `<img src="${escapeHtml(user.photoURL)}" alt="" class="h-full w-full object-cover" referrerpolicy="no-referrer">`;
  } else {
    btn.textContent = (user.displayName || user.email || '?').trim()[0].toUpperCase();
  }
  $('#user-email').textContent = user.email ?? user.displayName ?? '';

  state.unsubscribe = store.subscribe(user.uid, {
    onAttendance(list) {
      state.records = new Map(list.map((r) => [r.date, { type: DAY_TYPES.WORK, ...r }]));
      renderAll();
    },
    onBank(list) {
      state.withdrawals = list;
      renderAll();
    },
    onSettings(data) {
      state.settings = normalizeSettings(data);
      renderAll();
    },
    onOverrides(list) {
      state.overrides = new Map(list.map((o) => [o.date, o]));
      renderAll();
    },
    onAppSettings,
    onError(err) {
      toast(err.code === 'permission-denied' ? t('toast.permissionDenied') : t('toast.dbError', { error: err.message }), 'error');
    },
  });

  $('#entry-date').value = todayStr();
  $('#form-withdraw').date.value = todayStr();
  syncEntryType();
  refreshTime();
  renderAll();
  showTab(tabFromHash());
  showScreen('app');
}

// ---------------------------------------------------------------------------
// Události
// ---------------------------------------------------------------------------
function bindLanguageEvents() {
  $('#btn-lang').addEventListener('click', () => {
    const lang = getLanguage();
    changeLanguage(LANGUAGES[(LANGUAGES.indexOf(lang) + 1) % LANGUAGES.length]);
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-set-lang]');
    if (btn) changeLanguage(btn.dataset.setLang);
  });
}

function bindAppEvents() {
  for (const btn of $$('.tab-btn')) {
    btn.addEventListener('click', () => {
      history.replaceState(null, '', `#${TABS[btn.dataset.tab]}`);
      showTab(btn.dataset.tab);
    });
  }
  window.addEventListener('hashchange', () => showTab(tabFromHash()));

  // Uživatelské menu
  $('#btn-user').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#user-menu').hidden = !$('#user-menu').hidden;
  });
  document.addEventListener('click', () => { $('#user-menu').hidden = true; });
  $('#btn-logout').addEventListener('click', () => auth.logout());

  // Přehled
  typeOptions($('#entry-type'));
  $('#entry-date').addEventListener('change', () => {
    if (!$('#entry-date').value) $('#entry-date').value = todayStr();
    syncEntryType();
    setError($('#entry-error'), null);
    renderEntry();
  });
  $('#entry-type').addEventListener('change', () => { setError($('#entry-error'), null); renderEntry(); });
  $('#entry-time').addEventListener('input', () => { state.timeTouched = true; });
  $('#btn-now').addEventListener('click', () => { state.timeTouched = false; refreshTime(); });
  $('#btn-arrival').addEventListener('click', () => onClock('arrival'));
  $('#btn-departure').addEventListener('click', () => onClock('departure'));
  $('#btn-save-type').addEventListener('click', onSaveType);
  $('#btn-entry-edit').addEventListener('click', () => openDayDialog($('#entry-date').value));
  $('#btn-use-plan').addEventListener('click', usePlan);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-flip-parity]')) flipParity();
  });
  setInterval(refreshTime, 15_000);

  // Měsíc
  $('#btn-month-prev').addEventListener('click', () => shiftMonth(-1));
  $('#btn-month-next').addEventListener('click', () => shiftMonth(1));
  $('#btn-month-today').addEventListener('click', () => {
    const d = new Date();
    state.month = { y: d.getFullYear(), m: d.getMonth() + 1 };
    renderMonth();
  });
  $('#btn-export').addEventListener('click', exportMonth);
  $('#month-days').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (btn) openDayDialog(btn.dataset.date);
  });

  // Dialog dne
  const dayForm = $('#form-day');
  typeOptions(dayForm.type);
  dayForm.addEventListener('input', (e) => {
    if (e.target.name !== 'note') dialogFilled = false; // ruční úprava ruší „doplněno“
    updateDialog();
  });
  $('#dlg-day-fill').addEventListener('click', fillDialog);
  dayForm.addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    const err = saveRecord(dialogRecord());
    if (err) {
      e.preventDefault();
      setError($('#dlg-day-error'), err);
      return;
    }
    toast(t('day.saved'));
  });
  $('#dlg-day-delete').addEventListener('click', async () => {
    const date = dialogDate;
    $('#dlg-day').close();
    if (!(await confirmDialog(t('day.confirmDelete', { date: formatDateShort(date) }), t('common.delete')))) return;
    store.deleteDay(state.user.uid, date).catch((err) => toast(t('toast.deleteFailed', { error: err.message }), 'error'));
    toast(t('day.deleted'));
  });

  // Banka
  const wf = $('#form-withdraw');
  wf.addEventListener('input', updateWithdrawForm);
  wf.addEventListener('submit', (e) => {
    e.preventDefault();
    const minutes = withdrawMinutes();
    const err = !wf.date.value ? { key: 'error.dateRequired' } : validateWithdrawal(minutes, balance());
    if (err) return setError($('#withdraw-error'), tr(err));
    store.addWithdrawal(state.user.uid, { date: wf.date.value, minutes, note: wf.note.value })
      .catch((er) => toast(t('toast.saveFailed', { error: er.message }), 'error'));
    toast(t('bank.withdrawn', { hours: formatMinutes(minutes) }));
    wf.hours.value = '';
    wf.note.value = '';
    updateWithdrawForm();
  });
  $('#bank-history').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete-id]');
    const edit = e.target.closest('[data-edit-date]');
    if (edit) openDayDialog(edit.dataset.editDate);
    if (!del) return;
    if (!(await confirmDialog(t('bank.confirmDelete'), t('common.delete')))) return;
    store.deleteWithdrawal(state.user.uid, del.dataset.deleteId)
      .catch((err) => toast(t('toast.deleteFailed', { error: err.message }), 'error'));
    toast(t('bank.deleted'));
  });

  // Offline indikátor
  const updateOnline = () => { $('#offline-badge').hidden = navigator.onLine; };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err));
  }
}

async function main() {
  // Výchozí jazyk je čeština; jinak poslední volba uložená v prohlížeči.
  setLanguage(storedLanguage(), { persist: false });
  applyTheme();
  enhanceTimeInputs();
  renderLanguage();
  bindLanguageEvents();
  $('#btn-theme').addEventListener('click', () => { cycleTheme(); renderThemeButton(); });
  registerServiceWorker();

  if (!isConfigured(firebaseConfig)) return showSetup();

  try {
    [auth, store] = await Promise.all([import('./auth.js'), import('./store.js')]);
  } catch (err) {
    console.error(err);
    return showSetup({ key: 'setup.initFailed', params: { error: err.message } });
  }
  auth.setAuthLanguage(getLanguage());

  setupAuthScreen();
  bindAppEvents();
  initPlanView({
    getState: () => ({
      settings: state.settings, records: records(), overrides: [...state.overrides.values()], withdrawals: state.withdrawals, app: state.app,
    }),
    saveRecord,
    openDayDialog,
    changeLanguage,
    saveHolidays,
    saveSettings: (s) => store.saveSettings(state.user.uid, s)
      .catch((e) => toast(t('toast.settingsFailed', { error: e.message }), 'error')),
    saveOverride: (o) => store.saveOverride(state.user.uid, o)
      .catch((e) => toast(t('toast.overrideFailed', { error: e.message }), 'error')),
    deleteOverride: (date) => store.deleteOverride(state.user.uid, date)
      .catch((e) => toast(t('toast.overrideDeleteFailed', { error: e.message }), 'error')),
    applyOverrides: (ops) => store.applyOverrides(state.user.uid, ops)
      .catch((e) => toast(t('toast.overridesFailed', { error: e.message }), 'error')),
  });
  auth.watchUser(onUser);
}

main();
