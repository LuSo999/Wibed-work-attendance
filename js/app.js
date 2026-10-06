// Vstupní bod aplikace: kontrola configu, přihlášení, obrazovky a jejich propojení.
import { firebaseConfig } from './firebase-config.js';
import { applyTheme, cycleTheme, getTheme } from './theme.js';
import {
  DAY_TYPES, DAY_TYPE_LABELS, MONTH_LABELS, dayResult, dayFund, holidayName, isWorkday,
  isAbsenceType, weekdayLabel, daysInMonth, toDateString, monthSummary, bankBalance,
  validateDay, validateWithdrawal, formatMinutes, parseTime,
} from './calc.js';
import { buildMonthCsv, downloadCsv } from './csv.js';
import { enhanceTimeInputs } from './time24.js';
import {
  normalizeSettings, rulesFromSettings, buildMonthPlan, fillRecord,
} from './plan.js';
import {
  initPlanView, renderPlanView, weekBadgeHtml, flipParity,
} from './plan-view.js';
import {
  $, $$, escapeHtml, todayStr, nowTime, formatDateLong, formatDateShort, toast,
  confirmDialog, setError,
} from './ui.js';

// ---------------------------------------------------------------------------
// Stav
// ---------------------------------------------------------------------------
const now = new Date();
const state = {
  user: null,
  records: new Map(), // 'YYYY-MM-DD' → záznam
  withdrawals: [],
  settings: normalizeSettings({}), // users/{uid}/settings/plan
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

const TYPE_BADGE = {
  work: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  vacation: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  sick: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  doctor: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300',
  comp: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
};
const FILLED_CHIP = '<span class="inline-block rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">doplněno</span>';
const badge = (type) => `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[type] ?? ''}">${escapeHtml(DAY_TYPE_LABELS[type] ?? type)}</span>`;

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

function showSetup(detail) {
  setError($('#setup-detail'), detail);
  showScreen('setup');
}

// ---------------------------------------------------------------------------
// Téma
// ---------------------------------------------------------------------------
const THEME_ICONS = { system: '🖥️', light: '☀️', dark: '🌙' };
const THEME_NAMES = { system: 'podle systému', light: 'světlý', dark: 'tmavý' };

function renderThemeButton() {
  const t = getTheme();
  const btn = $('#btn-theme');
  btn.textContent = THEME_ICONS[t];
  btn.title = `Motiv: ${THEME_NAMES[t]} (kliknutím přepnete)`;
}

// ---------------------------------------------------------------------------
// Navigace
// ---------------------------------------------------------------------------
const TABS = {
  overview: 'prehled', month: 'mesic', plan: 'plan', bank: 'banka',
};

function showTab(tab) {
  if (!TABS[tab]) tab = 'overview';
  for (const t of Object.keys(TABS)) $(`#tab-${t}`).hidden = t !== tab;
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
  return Object.keys(TABS).find((t) => TABS[t] === key) ?? 'overview';
}

// ---------------------------------------------------------------------------
// Přehled
// ---------------------------------------------------------------------------
function typeOptions(select) {
  select.innerHTML = Object.values(DAY_TYPES)
    .map((t) => `<option value="${t}">${escapeHtml(DAY_TYPE_LABELS[t])}</option>`).join('');
}

function dayInfoText(date) {
  const parts = [formatDateLong(date)];
  const holiday = holidayName(date);
  if (holiday) parts.push(`státní svátek – ${holiday}`);
  else if (!isWorkday(date)) parts.push('víkend');
  if (!isWorkday(date)) parts.push('fond 0 h, odpracovaná doba je celá přesčas');
  if (isAbsenceType($('#entry-type').value)) parts.push('část dne nastavíte v „Upravit den podrobně“');
  return parts.join(' · ');
}

function renderBank() {
  const b = balance();
  for (const id of ['#bank-balance', '#bank-balance-2']) {
    const el = $(id);
    el.textContent = `${signed(b)} h`;
    el.classList.toggle('text-rose-200', b < 0);
  }
  const t = new Date();
  const s = monthSummary(records(), t.getFullYear(), t.getMonth() + 1, state.withdrawals, rules());
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
  $('#btn-save-type').textContent = `Uložit den jako „${DAY_TYPE_LABELS[type]}“`;

  const status = $('#entry-status');
  if (!record) {
    status.innerHTML = '<p class="col-span-full text-slate-500 dark:text-slate-400">Pro tento den zatím není nic zapsáno.</p>';
    $('#btn-entry-edit').hidden = true;
    return;
  }
  $('#btn-entry-edit').hidden = false;
  const res = safeResult(record);
  const filledChip = record.filled ? FILLED_CHIP : '';
  if (record.type !== DAY_TYPES.WORK && !res?.partial) {
    status.innerHTML = `
      <div class="col-span-full flex items-center gap-2">${badge(record.type)}${filledChip}
        <span class="text-slate-500 dark:text-slate-400">započteno ${formatMinutes(res?.credited ?? 0)} h${res?.bankDelta ? `, z banky ${signed(res.bankDelta)} h` : ''}</span>
      </div>`;
    return;
  }
  const cell = (label, value, cls = '') => `
    <div><p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">${label}</p>
    <p class="tabular text-lg font-semibold ${cls}">${value}</p></div>`;
  status.innerHTML = [
    cell('Příchod', escapeHtml(record.arrival ?? '—')),
    cell('Odchod', escapeHtml(record.departure ?? '—')),
    cell('Odpracováno', res?.complete ? `${formatMinutes(res.worked)} h` : '—'),
    cell('Přesčas', res?.complete ? `${signed(res.overtime)} h` : '—', res?.complete ? toneClass(res.overtime) : ''),
  ].join('') + (res?.partial || filledChip
    ? `<p class="col-span-full flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">${res?.partial ? `${badge(record.type)} ${formatMinutes(res.absence)} h započteno` : ''}${filledChip}</p>`
    : '') + (res?.complete && res.break
    ? `<p class="col-span-full text-xs text-slate-500 dark:text-slate-400">Pobyt ${formatMinutes(res.stay)} h, odečtena přestávka ${formatMinutes(res.break)} h.</p>`
    : '') + (res === null ? '<p class="col-span-full text-xs text-red-600">Záznam je neplatný (odchod před příchodem) – opravte ho.</p>' : '');
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

function saveRecord(record) {
  const err = validateDay(record, balanceWithout(record.date), rules());
  if (err) return err;
  // Zápis se díky offline cache Firestore projeví okamžitě; chyba (např. pravidla) se ohlásí později.
  store.saveDay(state.user.uid, record).catch((e) => toast(`Uložení se nezdařilo: ${e.message}`, 'error'));
  return null;
}

async function onClock(kind) {
  const date = $('#entry-date').value;
  const time = $('#entry-time').value;
  const errEl = $('#entry-error');
  if (!date || parseTime(time) === null) return setError(errEl, 'Zadejte platné datum a čas.');

  const existing = state.records.get(date);
  const partial = existing && safeResult(existing)?.partial;
  const base = existing?.type === DAY_TYPES.WORK || partial
    ? { ...existing, filled: false }
    : { date, type: DAY_TYPES.WORK, arrival: null, departure: null, note: existing?.note ?? '' };

  if (existing && existing.type !== DAY_TYPES.WORK && !partial
    && !(await confirmDialog(`Den je zapsán jako „${DAY_TYPE_LABELS[existing.type]}“. Přepsat na pracovní den?`, 'Přepsat'))) return;

  const field = kind === 'arrival' ? 'arrival' : 'departure';
  const label = kind === 'arrival' ? 'příchod' : 'odchod';
  if (base[field] && base[field] !== time
    && !(await confirmDialog(`Přepsat ${label} ${base[field]} na ${time}?`, 'Přepsat'))) return;

  base[field] = time;
  const err = saveRecord(base);
  setError(errEl, err);
  if (err) return;
  toast(`${kind === 'arrival' ? 'Příchod' : 'Odchod'} ${time} uložen`);
  state.timeTouched = false;
  refreshTime();
}

async function onSaveType() {
  const date = $('#entry-date').value;
  const type = $('#entry-type').value;
  const existing = state.records.get(date);
  if (existing?.type === DAY_TYPES.WORK && (existing.arrival || existing.departure)
    && !(await confirmDialog('Den obsahuje příchod/odchod. Přepsat?', 'Přepsat'))) return;
  const err = saveRecord({ date, type, note: existing?.note ?? '' });
  setError($('#entry-error'), err);
  if (!err) toast(`Uloženo: ${DAY_TYPE_LABELS[type]}`);
}

// ---------------------------------------------------------------------------
// Měsíc
// ---------------------------------------------------------------------------
function summaryCard(label, value, sub = '', cls = '') {
  return `
    <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">${label}</p>
      <p class="tabular mt-1 text-xl font-bold ${cls}">${value}</p>
      ${sub ? `<p class="text-xs text-slate-500 dark:text-slate-400">${sub}</p>` : ''}
    </div>`;
}

function renderMonth() {
  const { y, m } = state.month;
  $('#month-title').textContent = `${MONTH_LABELS[m - 1]} ${y}`;
  const s = monthSummary(records(), y, m, state.withdrawals, rules());
  $('#month-summary').innerHTML = [
    summaryCard('Fond', `${formatMinutes(s.fund)} h`, `${s.workdays} pracovních dní`),
    summaryCard('Odpracováno', `${formatMinutes(s.credited)} h`, `z toho práce ${formatMinutes(s.worked)} h`),
    summaryCard('Přesčas', `${signed(s.overtime)} h`, 'za měsíc', toneClass(s.overtime)),
    summaryCard('Čerpáno', `${formatMinutes(s.used)} h`, 'náhradní volno'),
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
      if (r.filled) middle += ` ${FILLED_CHIP}`;
      if (res === null) {
        right = '<span class="text-xs text-red-600">neplatné</span>';
      } else if (res.complete) {
        right = `<span class="tabular font-semibold">${formatMinutes(res.credited)}</span>
          <span class="tabular block text-xs ${toneClass(res.bankDelta)}">${res.bankDelta ? signed(res.bankDelta) : '±0:00'}</span>`;
      } else {
        right = '<span class="text-xs text-amber-600 dark:text-amber-400">probíhá</span>';
      }
    }
    const note = [holiday, r?.note].filter(Boolean).map(escapeHtml).join(' · ');
    items.push(`
      <li>
        <button type="button" data-date="${date}" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 ${off ? 'bg-slate-50/70 dark:bg-slate-950/40' : ''}">
          <span class="w-12 shrink-0 text-center ${date === today ? 'rounded-lg bg-indigo-600 py-1 text-white' : ''}">
            <span class="block text-xs ${date === today ? '' : off ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}">${weekdayLabel(date)}</span>
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
  const csv = buildMonthCsv(records(), state.withdrawals, y, m, rules());
  downloadCsv(csv, `dochazka-${y}-${String(m).padStart(2, '0')}.csv`);
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
  setError($('#dlg-day-error'), err);
  $('#dlg-day-save').disabled = Boolean(err);
  const res = err ? null : res0;
  let text = `Fond dne ${formatMinutes(dayFund(dialogDate, rules()))} h`;
  if (res && (rec.type === DAY_TYPES.WORK || res.partial) && res.complete) {
    text = `Pobyt ${formatMinutes(res.stay)} h − přestávka ${formatMinutes(res.break)} h = ${formatMinutes(res.worked)} h`
      + `${res.partial ? ` + ${DAY_TYPE_LABELS[rec.type].toLowerCase()} ${formatMinutes(res.absence)} h` : ''} · přesčas ${signed(res.overtime)} h`;
  } else if (res && rec.type !== DAY_TYPES.WORK && !res.partial) {
    text = `Započteno ${formatMinutes(res.credited)} h${res.bankDelta ? ` · z banky ${signed(res.bankDelta)} h` : ' · bez přesčasu'}`;
  }
  $('#dlg-day-preview').textContent = text;
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
  $('#dlg-day-sub').textContent = holidayName(date) ?? (isWorkday(date) ? 'Pracovní den' : 'Víkend');
  $('#dlg-day-delete').hidden = !r;
  updateDialog();
  $('#dlg-day').showModal();
}

/** „Doplnit docházku“ v dialogu: nastaví odchod tak, aby den vyšel přesně do fondu. */
function fillDialog() {
  const current = dialogRecord();
  const base = { ...current, departure: null };
  const rec = fillRecord(dialogDate, base, state.settings, state.overrides.get(dialogDate));
  if (!rec) return setError($('#dlg-day-error'), 'Den nelze doplnit (odchod by vyšel po půlnoci).');
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
  const t = new Date();
  const plan = buildMonthPlan({
    year: t.getFullYear(), month: t.getMonth() + 1, today: todayStr(), settings: state.settings, records: records(), overrides: [...state.overrides.values()],
  });
  return plan.days.find((d) => d.date === todayStr());
}

function renderTodayPlan() {
  $('#overview-week').innerHTML = weekBadgeHtml(state.settings);
  const d = todayPlanDay();
  const title = $('#today-plan-title');
  const sub = $('#today-plan-sub');
  const btn = $('#btn-use-plan');
  btn.hidden = true;
  if (!d || (!d.workday && !d.record)) {
    title.textContent = 'Dnes se podle plánu nepracuje';
    sub.textContent = d?.holiday ?? 'víkend';
  } else if (d.plannedWorked === null) {
    title.textContent = `Dnes hotovo: ${formatMinutes(d.credited)} h`;
    sub.textContent = d.record?.departure ? `odchod ${d.record.departure}` : DAY_TYPE_LABELS[d.type] ?? '';
  } else if (d.kind === 'absence') {
    title.textContent = `Dnes: ${DAY_TYPE_LABELS[d.type]}`;
    sub.textContent = 'celý den';
  } else if (d.plannedLeave) {
    title.textContent = `Dnes: plánovaný odchod v ${d.plannedLeave}`;
    const how = d.kind === 'fixed' ? 'pevný odchod' : d.kind === 'override' ? 'výjimka' : 'dopočteno do fondu';
    sub.textContent = `${formatMinutes(d.plannedWorked)} h práce · příchod ${d.arrival}${d.actualArrival ? '' : ' (plán)'} · ${how}`;
    btn.hidden = false;
    btn.dataset.leave = d.plannedLeave;
  } else {
    title.textContent = 'Dnes nelze naplánovat odchod';
    sub.textContent = d.warnings[0] ?? '';
  }
}

function usePlan() {
  const leave = $('#btn-use-plan').dataset.leave;
  if (!leave) return;
  $('#entry-date').value = todayStr();
  syncEntryType();
  $('#entry-time').value = leave;
  state.timeTouched = true;
  renderEntry();
  toast(`Čas nastaven na ${leave} – potvrďte tlačítkem Odchod`);
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
  setError($('#withdraw-error'), err);
  $('#btn-withdraw').disabled = Boolean(err) || f.hours.value === '' || !f.date.value || balance() <= 0;
  if (balance() <= 0 && !err) setError($('#withdraw-error'), 'Banka přesčasů je prázdná – není co vybrat.');
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
    ? `<button type="button" data-edit-date="${it.date}" class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Upravit den">✎</button>`
    : `<button type="button" data-delete-id="${escapeHtml(it.id)}" class="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40" title="Smazat výběr">✕</button>`}
    </li>`).join('')
    : '<li class="px-5 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Zatím žádné čerpání.</li>';
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

function setupAuthScreen() {
  const form = $('#form-auth');
  const errEl = $('#auth-error');
  const infoEl = $('#auth-info');
  const submit = $('#btn-auth-submit');

  const setMode = (reg) => {
    registerMode = reg;
    submit.textContent = reg ? 'Vytvořit účet' : 'Přihlásit se';
    $('#btn-auth-toggle').textContent = reg ? 'Už mám účet' : 'Vytvořit účet';
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
    if (!email) return setError(errEl, 'Vyplňte e-mail, na který pošleme odkaz pro obnovu hesla.');
    try {
      await auth.resetPassword(email);
      setError(infoEl, 'Pokud účet existuje, poslali jsme na e-mail odkaz pro obnovu hesla.');
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

function onUser(user) {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.user = user;
  state.records = new Map();
  state.withdrawals = [];
  state.settings = normalizeSettings({});
  state.overrides = new Map();

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
    onError(err) {
      toast(err.code === 'permission-denied'
        ? 'Přístup k datům odepřen – zkontrolujte nasazení firestore.rules.'
        : `Chyba databáze: ${err.message}`, 'error');
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
    const t = new Date();
    state.month = { y: t.getFullYear(), m: t.getMonth() + 1 };
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
    toast('Den uložen');
  });
  $('#dlg-day-delete').addEventListener('click', async () => {
    const date = dialogDate;
    $('#dlg-day').close();
    if (!(await confirmDialog(`Smazat záznam pro ${formatDateShort(date)}?`, 'Smazat'))) return;
    store.deleteDay(state.user.uid, date).catch((err) => toast(`Smazání se nezdařilo: ${err.message}`, 'error'));
    toast('Záznam smazán');
  });

  // Banka
  const wf = $('#form-withdraw');
  wf.addEventListener('input', updateWithdrawForm);
  wf.addEventListener('submit', (e) => {
    e.preventDefault();
    const minutes = withdrawMinutes();
    const err = !wf.date.value ? 'Zadejte datum.' : validateWithdrawal(minutes, balance());
    if (err) return setError($('#withdraw-error'), err);
    store.addWithdrawal(state.user.uid, { date: wf.date.value, minutes, note: wf.note.value })
      .catch((er) => toast(`Uložení se nezdařilo: ${er.message}`, 'error'));
    toast(`Vybráno ${formatMinutes(minutes)} h z banky`);
    wf.hours.value = '';
    wf.note.value = '';
    updateWithdrawForm();
  });
  $('#bank-history').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete-id]');
    const edit = e.target.closest('[data-edit-date]');
    if (edit) openDayDialog(edit.dataset.editDate);
    if (!del) return;
    if (!(await confirmDialog('Smazat tento výběr? Hodiny se vrátí do banky.', 'Smazat'))) return;
    store.deleteWithdrawal(state.user.uid, del.dataset.deleteId)
      .catch((err) => toast(`Smazání se nezdařilo: ${err.message}`, 'error'));
    toast('Výběr smazán');
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
  applyTheme();
  renderThemeButton();
  enhanceTimeInputs();
  $('#btn-theme').addEventListener('click', () => { cycleTheme(); renderThemeButton(); });
  registerServiceWorker();

  if (!isConfigured(firebaseConfig)) return showSetup();

  try {
    [auth, store] = await Promise.all([import('./auth.js'), import('./store.js')]);
  } catch (err) {
    console.error(err);
    return showSetup(`Firebase se nepodařilo inicializovat: ${err.message}. Zkontrolujte hodnoty v js/firebase-config.js a připojení k internetu.`);
  }

  setupAuthScreen();
  bindAppEvents();
  initPlanView({
    getState: () => ({
      settings: state.settings, records: records(), overrides: [...state.overrides.values()],
    }),
    saveRecord,
    openDayDialog,
    saveSettings: (s) => store.saveSettings(state.user.uid, s)
      .catch((e) => toast(`Uložení nastavení se nezdařilo: ${e.message}`, 'error')),
    saveOverride: (o) => store.saveOverride(state.user.uid, o)
      .catch((e) => toast(`Uložení výjimky se nezdařilo: ${e.message}`, 'error')),
    deleteOverride: (date) => store.deleteOverride(state.user.uid, date)
      .catch((e) => toast(`Smazání výjimky se nezdařilo: ${e.message}`, 'error')),
  });
  auth.watchUser(onUser);
}

main();
