// UI záložky „Plán“: rozvrh lichého/sudého týdne, nastavení, plán měsíce,
// výjimky dnů a hromadné doplnění docházky. Výpočty dělá čistý modul plan.js.
import {
  DAY_TYPES, DAY_TYPE_LABELS, MONTH_LABELS, formatMinutes, parseTime, weekdayLabel, describeBreakRule,
  hoursToMinutes, toTimeString,
} from './calc.js';
import {
  WEEKDAY_NAMES, PARITY_LABELS, CORE_WARNING, buildMonthPlan, fillCandidates, isoWeek, weekParity,
  normalizeSettings, settingsWarnings, leaveWarning, workedForStay, stayForWorked, rulesFromSettings,
} from './plan.js';
import { enhanceTimeInputs } from './time24.js';
import {
  $, escapeHtml, todayStr, formatDateLong, formatDateShort, toast, confirmDialog, setError,
} from './ui.js';

let ctx; // { getState, saveRecord, saveSettings, saveOverride, deleteOverride, openDayDialog }
const now = new Date();
let planMonth = { y: now.getFullYear(), m: now.getMonth() + 1 };
let weeksKey = '';

const signed = (min) => formatMinutes(min, { sign: true });
/** České skloňování podle počtu: plural(2, ['den', 'dny', 'dnů']). */
const plural = (n, [one, few, many]) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const h = (min) => `${formatMinutes(min)} h`;

// ---------------------------------------------------------------------------
// Odznak týdne (sdílený s přehledem)
// ---------------------------------------------------------------------------
export function weekBadgeHtml(settings, date = todayStr()) {
  const { week } = isoWeek(date);
  const parity = weekParity(date, settings.parityFlip);
  const tone = parity === 'odd'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
    : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200';
  return `
    <span class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${tone}">
      Týden ${week} · ${PARITY_LABELS[parity]}
    </span>
    <button type="button" data-flip-parity class="rounded-full px-3 py-1 text-sm font-medium text-slate-500 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-800" title="Prohodit lichý a sudý týden">⇄ Prohodit</button>`;
}

export async function flipParity() {
  const { settings } = ctx.getState();
  ctx.saveSettings({ ...settings, parityFlip: !settings.parityFlip });
  toast('Lichý a sudý týden prohozeny');
}

// ---------------------------------------------------------------------------
// Rozvrh lichého / sudého týdne
// ---------------------------------------------------------------------------
const fieldCls = 'tabular w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800';

function renderWeeks(settings, avgRegular) {
  const today = todayStr();
  const current = weekParity(today, settings.parityFlip);
  const key = JSON.stringify([settings.schedule, settings.parityFlip, settings.startTime, settings.coreEnd, current]);
  const root = $('#plan-weeks');

  if (key !== weeksKey) {
    weeksKey = key;
    root.innerHTML = ['odd', 'even'].map((week) => `
      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 dark:bg-slate-900 ${week === current ? 'ring-2 ring-indigo-500' : 'ring-slate-200 dark:ring-slate-800'}">
        <div class="mb-2 flex items-center justify-between">
          <h3 class="font-semibold">${week === 'odd' ? 'Lichý' : 'Sudý'} týden</h3>
          ${week === current ? '<span class="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">tento týden</span>' : ''}
        </div>
        <div class="divide-y divide-slate-100 dark:divide-slate-800">
          ${[1, 2, 3, 4, 5].map((day) => `
            <div class="py-2">
              <div class="flex items-center gap-3">
                <span class="w-8 shrink-0 font-medium">${WEEKDAY_NAMES[day].slice(0, 2)}</span>
                <label class="min-w-0 flex-1">
                  <span class="sr-only">${WEEKDAY_NAMES[day]} – odchod (${PARITY_LABELS[week]} týden)</span>
                  <input type="time" data-time24 data-optional data-empty-label="běžný den" data-week="${week}" data-day="${day}" value="${escapeHtml(settings.schedule[week][day])}" class="${fieldCls}">
                </label>
                <span data-hours="${week}-${day}" class="tabular w-20 shrink-0 text-right text-sm"></span>
              </div>
              <p data-warn="${week}-${day}" class="mt-1 text-xs text-amber-700 dark:text-amber-400" hidden></p>
            </div>`).join('')}
        </div>
      </section>`).join('');
    enhanceTimeInputs(root);
  }

  // texty hodin a varování se aktualizují bez překreslení výběrů času
  for (const week of ['odd', 'even']) {
    for (const day of [1, 2, 3, 4, 5]) {
      const leaveAt = settings.schedule[week][day];
      const hoursEl = root.querySelector(`[data-hours="${week}-${day}"]`);
      if (leaveAt) {
        const worked = workedForStay(Math.max(0, parseTime(leaveAt) - parseTime(settings.startTime)), rulesFromSettings(settings));
        hoursEl.innerHTML = `<b>${h(worked)}</b>`;
        hoursEl.title = `Od ${settings.startTime} do ${leaveAt} po odečtení přestávky`;
      } else {
        hoursEl.innerHTML = avgRegular != null
          ? `<span class="text-slate-500 dark:text-slate-400">≈ ${h(avgRegular)}</span>`
          : '<span class="text-slate-400">—</span>';
        hoursEl.title = 'Běžný den – dopočítá se podle měsíce (průměr na běžný den tohoto měsíce)';
      }
      const warn = leaveWarning(leaveAt, settings);
      setError(root.querySelector(`[data-warn="${week}-${day}"]`), warn ? `⚠ Odchod před ${settings.coreEnd} – ${warn.toLowerCase()}` : null);
    }
  }
}

function onScheduleChange(e) {
  const input = e.target.closest('input[data-week]');
  if (!input) return;
  const { settings } = ctx.getState();
  const next = normalizeSettings(settings);
  next.schedule[input.dataset.week][input.dataset.day] = input.value;
  ctx.saveSettings(next);
  const warn = leaveWarning(input.value, next);
  toast(warn ? `Uloženo – ${warn.toLowerCase()}` : 'Rozvrh uložen');
}

// ---------------------------------------------------------------------------
// Nastavení
// ---------------------------------------------------------------------------
const SETTINGS_FIELDS = ['startTime', 'coreStart', 'coreEnd', 'dailyFundHours', 'maxWorkedHoursPerDay', 'breakAfterHours', 'breakLengthMinutes'];
const NUMBER_FIELDS = ['dailyFundHours', 'maxWorkedHoursPerDay', 'breakAfterHours', 'breakLengthMinutes'];

/** Vysvětlení pravidla přestávky s příkladem pro denní fond. */
function breakRuleText(settings) {
  const rules = rulesFromSettings(settings);
  const stay = stayForWorked(rules.DAILY_FUND_MIN, rules);
  return `${describeBreakRule(rules)} Na denní fond ${formatMinutes(rules.DAILY_FUND_MIN)} h je tedy potřeba pobyt ${formatMinutes(stay)} h `
    + `(příchod ${settings.startTime} → odchod ${toTimeString(Math.min(1439, parseTime(settings.startTime) + stay))}). `
    + 'Pravidlo platí pro výpočet odpracovaných hodin, přesčasů i plánu.';
}

function renderSettingsForm(settings) {
  const f = $('#form-plan-settings');
  for (const name of SETTINGS_FIELDS) {
    if (document.activeElement !== f[name]) f[name].value = settings[name];
  }
  $('#break-rule-text').textContent = breakRuleText(settings);
  const warnings = settingsWarnings(settings).filter((w) => w.field !== 'schedule');
  const el = $('#plan-settings-warnings');
  el.innerHTML = warnings.map((w) => `<li>⚠ ${escapeHtml(w.message)}</li>`).join('');
  el.hidden = !warnings.length;
}

function onSettingsChange(e) {
  const f = $('#form-plan-settings');
  if (!e.target.name) return;
  const { settings } = ctx.getState();
  const raw = { ...settings };
  for (const name of ['startTime', 'coreStart', 'coreEnd']) raw[name] = f[name].value;
  for (const name of NUMBER_FIELDS) raw[name] = f[name].valueAsNumber;
  const breakErr = !(raw.breakAfterHours > 0 && raw.breakAfterHours <= 24) ? 'Interval přestávky musí být 0,25–24 h.'
    : !(Number.isInteger(raw.breakLengthMinutes) && raw.breakLengthMinutes >= 0) ? 'Délka přestávky musí být celý počet minut (0 = bez přestávky).'
      : raw.breakLengthMinutes >= hoursToMinutes(raw.breakAfterHours) ? 'Přestávka musí být kratší než interval, po kterém se odečítá.'
        : null;
  setError($('#break-rule-error'), breakErr);
  if (breakErr) return;
  const next = normalizeSettings(raw);
  ctx.saveSettings(next);
  const warns = settingsWarnings(next).filter((w) => w.field !== 'schedule');
  toast(warns.length ? 'Uloženo – zkontrolujte upozornění' : 'Nastavení uloženo');
}

// ---------------------------------------------------------------------------
// Plán měsíce
// ---------------------------------------------------------------------------
const ROW_STYLE = {
  done: { row: '', label: 'proběhlo', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  filled: { row: 'bg-teal-50/70 dark:bg-teal-950/30', label: 'doplněno', chip: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200' },
  missing: { row: 'bg-rose-50/70 dark:bg-rose-950/30', label: 'chybí záznam', chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200' },
  absence: { row: 'bg-sky-50/70 dark:bg-sky-950/30', label: 'nepřítomnost', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200' },
  fixed: { row: 'bg-violet-50/70 dark:bg-violet-950/30', label: 'pevný odchod', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200' },
  override: { row: 'bg-amber-50/70 dark:bg-amber-950/30', label: 'výjimka', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200' },
  regular: { row: 'bg-indigo-50/60 dark:bg-indigo-950/30', label: 'plánováno', chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200' },
  off: { row: 'text-slate-400 dark:text-slate-600', label: '', chip: '' },
};

/** Styl řádku: výjimka má přednost (kromě proběhlých dnů). */
function styleKey(d) {
  if (d.override && d.plannedWorked !== null) return 'override';
  return d.kind;
}

const chip = (key, text = ROW_STYLE[key].label) => `<span class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ROW_STYLE[key].chip}">${escapeHtml(text)}</span>`;

function typeText(d) {
  if (!d.workday && d.kind === 'off') return d.holiday ? escapeHtml(d.holiday) : 'víkend';
  const parts = [];
  if (d.type && d.type !== DAY_TYPES.WORK) {
    parts.push(escapeHtml(DAY_TYPE_LABELS[d.type]) + (d.absence && d.absence < d.credited ? ` ${formatMinutes(d.absence)} h` : ''));
  }
  parts.push(chip(styleKey(d)));
  if (d.kind === 'fixed' && d.override) parts.push(chip('fixed'));
  return parts.join(' ');
}

function actualText(d) {
  const r = d.record;
  if (!r) return d.kind === 'missing' ? '<span class="text-rose-600 dark:text-rose-400">—</span>' : '';
  if (d.plannedWorked === null && d.actual != null) return `<b>${formatMinutes(d.actual)}</b>`;
  return r.arrival ? `<span class="text-slate-500 dark:text-slate-400">${escapeHtml(r.arrival)}–</span>` : '';
}

/** Celý popis dne do tooltipu řádku. */
function rowTitle(d) {
  const r = d.record;
  const parts = [`Týden ${d.week} · ${PARITY_LABELS[d.parity]}`];
  if (r?.arrival) parts.push(`skutečnost ${r.arrival}–${r.departure ?? '…'}`);
  if (d.plannedLeave) parts.push(`plán: příchod ${d.arrival}, odchod ${d.plannedLeave}`);
  return [...parts, ...d.warnings].join(' · ');
}

function summaryCard(label, value, sub = '', cls = '') {
  return `
    <div class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">${label}</p>
      <p class="tabular mt-0.5 text-lg font-bold ${cls}">${value}</p>
      ${sub ? `<p class="text-[11px] text-slate-500 dark:text-slate-400">${sub}</p>` : ''}
    </div>`;
}

function currentPlan(overridesPatch = null) {
  const { settings, records, overrides } = ctx.getState();
  let ovs = overrides;
  if (overridesPatch) ovs = [...overrides.filter((o) => o.date !== overridesPatch.date), ...(overridesPatch.remove ? [] : [overridesPatch])];
  return buildMonthPlan({ year: planMonth.y, month: planMonth.m, today: todayStr(), settings, records, overrides: ovs });
}

function renderMonthPlan() {
  const plan = currentPlan();
  const { summary: s } = plan;
  $('#plan-month-title').textContent = `${MONTH_LABELS[planMonth.m - 1]} ${planMonth.y}`;
  const devTone = s.deviation === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  $('#plan-summary').innerHTML = [
    summaryCard('Fond', h(s.fund)),
    summaryCard('Odpracováno', h(s.worked), 'skutečnost'),
    summaryCard('Plán zbývá', h(s.planRemaining)),
    summaryCard('Předpoklad', h(s.projected), 'konec měsíce'),
    summaryCard('Odchylka', `${signed(s.deviation)} h`, 'od fondu', devTone),
    summaryCard('Průměr', s.averageRegular != null ? h(s.averageRegular) : '—', `na běžný den (${s.regularDays})`),
  ].join('');

  const warnEl = $('#plan-warnings');
  warnEl.innerHTML = plan.warnings.map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('');
  warnEl.hidden = !plan.warnings.length;

  const candidates = fillCandidatesFor();
  const bulk = $('#btn-bulk-fill');
  bulk.hidden = !candidates.length;
  bulk.textContent = `Doplnit docházku (${candidates.length} ${plural(candidates.length, ['den', 'dny', 'dnů'])})`;

  const today = todayStr();
  $('#plan-table tbody').innerHTML = plan.days.map((d) => {
    const key = styleKey(d);
    const dayNum = Number(d.date.slice(8));
    const warnLabel = d.warnings.some((w) => w.includes(CORE_WARNING)) ? 'pevná doba' : 'upozornění';
    const warn = d.warnings.length ? `<span class="block text-[11px] text-amber-700 dark:text-amber-400">⚠ ${warnLabel}</span>` : '';
    return `
      <tr data-plan-date="${d.date}" title="${escapeHtml(rowTitle(d))}" class="cursor-pointer border-t border-slate-100 hover:brightness-95 dark:border-slate-800 ${ROW_STYLE[key].row} ${d.date === today ? 'font-semibold outline outline-2 -outline-offset-2 outline-indigo-500' : ''}">
        <td class="whitespace-nowrap px-2 py-2"><span class="tabular">${dayNum}.</span> <span class="text-[11px] text-slate-500 dark:text-slate-400">${weekdayLabel(d.date)}</span></td>
        <td class="px-1 py-2 text-center"><span class="rounded px-1 text-[11px] font-bold ${d.parity === 'odd' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'}" title="Týden ${d.week} · ${PARITY_LABELS[d.parity]}">${d.parity === 'odd' ? 'L' : 'S'}</span></td>
        <td class="px-1 py-2 text-xs">${typeText(d)}${warn}</td>
        <td class="tabular whitespace-nowrap px-2 py-2 text-right">${d.plannedWorked !== null && d.kind !== 'absence' ? formatMinutes(d.plannedWorked) : ''}</td>
        <td class="tabular whitespace-nowrap px-2 py-2 text-right">${d.plannedLeave ? `<b>${d.plannedLeave}</b>` : ''}</td>
        <td class="tabular whitespace-nowrap px-2 py-2 text-right">${actualText(d)}</td>
      </tr>`;
  }).join('');
}

function shiftPlanMonth(delta) {
  let { y, m } = planMonth;
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  planMonth = { y, m };
  renderMonthPlan();
}

// ---------------------------------------------------------------------------
// Hromadné doplnění docházky
// ---------------------------------------------------------------------------
function fillCandidatesFor() {
  const { settings, records, overrides } = ctx.getState();
  return fillCandidates({ year: planMonth.y, month: planMonth.m, today: todayStr(), settings, records, overrides });
}

function describeFill(rec) {
  if (!rec.arrival) return DAY_TYPE_LABELS[rec.type];
  const abs = rec.absenceHours ? ` + ${DAY_TYPE_LABELS[rec.type].toLowerCase()} ${formatMinutes(Math.round(rec.absenceHours * 60))} h` : '';
  return `${rec.arrival}–${rec.departure}${abs}`;
}

function openBulkFill() {
  const list = fillCandidatesFor();
  if (!list.length) return;
  $('#fill-list').innerHTML = list.map((c) => `
    <li class="flex items-center justify-between gap-3 py-2">
      <span>${formatDateShort(c.date)} <span class="text-xs text-slate-500 dark:text-slate-400">${weekdayLabel(c.date)}</span></span>
      <span class="tabular text-right font-medium">${escapeHtml(describeFill(c.record))}${c.before?.arrival ? '<span class="block text-[11px] font-normal text-slate-500">příchod zachován</span>' : ''}</span>
    </li>`).join('');
  $('#fill-count').textContent = `Vytvoří se ${list.length} ${plural(list.length, ['záznam označený', 'záznamy označené', 'záznamů označených'])} „doplněno“. Každý den vyjde přesně do fondu.`;
  const dlg = $('#dlg-fill');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const errors = [];
    for (const c of list) {
      const err = ctx.saveRecord(c.record);
      if (err) errors.push(`${formatDateShort(c.date)}: ${err}`);
    }
    if (errors.length) toast(`Některé dny se nedoplnily – ${errors.join('; ')}`, 'error');
    else toast(`Doplněno: ${list.length} ${plural(list.length, ['den', 'dny', 'dnů'])}`);
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Výjimka dne
// ---------------------------------------------------------------------------
let overrideDate = null;

function overrideFromForm() {
  const f = $('#form-override');
  return {
    date: overrideDate,
    absenceType: f.absenceType.value || null,
    absenceHours: f.absenceType.value && f.absenceHours.value !== '' ? f.absenceHours.valueAsNumber : null,
    leaveAt: f.leaveAt.value || null,
    workedHours: f.workedHours.value !== '' ? f.workedHours.valueAsNumber : null,
    note: f.note.value,
  };
}

function updateOverrideDialog() {
  const ov = overrideFromForm();
  $('#ov-absence-hours').hidden = !ov.absenceType;
  const { settings } = ctx.getState();
  const warns = [];
  const lw = leaveWarning(ov.leaveAt, settings);
  if (lw) warns.push(`Odchod ${ov.leaveAt} je před koncem pevné pracovní doby (${settings.coreEnd}). ${lw}`);
  if (ov.leaveAt && ov.workedHours != null) warns.push('Jsou zadané pevné hodiny i pevný odchod – použijí se pevné hodiny.');
  let err = null;
  if (ov.absenceHours != null && !(ov.absenceHours > 0)) err = 'Počet hodin nepřítomnosti musí být kladný.';
  if (ov.workedHours != null && !(ov.workedHours >= 0 && ov.workedHours <= 24)) err = 'Pevné hodiny musí být 0–24.';
  setError($('#ov-error'), err);
  $('#ov-save').disabled = Boolean(err);
  const w = $('#ov-warnings');
  w.innerHTML = warns.map((x) => `<li>⚠ ${escapeHtml(x)}</li>`).join('');
  w.hidden = !warns.length;

  if (!err) {
    const empty = !ov.absenceType && !ov.leaveAt && ov.workedHours == null;
    const plan = currentPlan(empty ? { date: overrideDate, remove: true } : ov);
    const d = plan.days.find((x) => x.date === overrideDate);
    const parts = [];
    if (d.kind === 'absence') parts.push(`Celý den ${DAY_TYPE_LABELS[d.type].toLowerCase()} (${h(d.credited)})`);
    else if (d.plannedWorked !== null) parts.push(`Plán: ${h(d.plannedWorked)} práce${d.absence ? ` + ${h(d.absence)} nepřítomnost` : ''}, odchod ${d.plannedLeave ?? '—'}`);
    parts.push(plan.summary.unbalanced ? plan.warnings[0] : 'Měsíc vyjde na nulu.');
    $('#ov-preview').textContent = parts.join(' · ');
  }
}

export function openOverrideDialog(date) {
  overrideDate = date;
  const { overrides } = ctx.getState();
  const ov = overrides.find((o) => o.date === date);
  const f = $('#form-override');
  f.absenceType.value = ov?.absenceType ?? '';
  f.absenceHours.value = ov?.absenceHours ?? '';
  f.leaveAt.value = ov?.leaveAt ?? '';
  f.workedHours.value = ov?.workedHours ?? '';
  f.note.value = ov?.note ?? '';
  $('#ov-title').textContent = formatDateLong(date);
  const { week } = isoWeek(date);
  $('#ov-sub').textContent = `Výjimka dne · týden ${week} (${PARITY_LABELS[weekParity(date, ctx.getState().settings.parityFlip)]})`;
  $('#ov-delete').hidden = !ov;
  updateOverrideDialog();
  $('#dlg-override').showModal();
}

// ---------------------------------------------------------------------------
// Inicializace a vykreslení
// ---------------------------------------------------------------------------
export function initPlanView(context) {
  ctx = context;
  const absenceSelect = $('#form-override').absenceType;
  absenceSelect.innerHTML = `<option value="">— bez nepřítomnosti —</option>${
    [DAY_TYPES.VACATION, DAY_TYPES.SICK, DAY_TYPES.DOCTOR, DAY_TYPES.COMP]
      .map((t) => `<option value="${t}">${escapeHtml(DAY_TYPE_LABELS[t])}</option>`).join('')}`;

  $('#plan-weeks').addEventListener('change', onScheduleChange);
  $('#form-plan-settings').addEventListener('change', onSettingsChange);
  $('#form-plan-settings').addEventListener('submit', (e) => e.preventDefault());
  $('#btn-plan-prev').addEventListener('click', () => shiftPlanMonth(-1));
  $('#btn-plan-next').addEventListener('click', () => shiftPlanMonth(1));
  $('#btn-plan-today').addEventListener('click', () => {
    const t = new Date();
    planMonth = { y: t.getFullYear(), m: t.getMonth() + 1 };
    renderMonthPlan();
  });
  $('#btn-bulk-fill').addEventListener('click', openBulkFill);
  $('#plan-table').addEventListener('click', (e) => {
    const row = e.target.closest('[data-plan-date]');
    if (!row) return;
    const date = row.dataset.planDate;
    const d = currentPlan().days.find((x) => x.date === date);
    if (date >= todayStr() && d.workday && !(d.record && d.plannedWorked === null)) openOverrideDialog(date);
    else ctx.openDayDialog(date);
  });

  const ovForm = $('#form-override');
  ovForm.addEventListener('input', updateOverrideDialog);
  ovForm.addEventListener('change', updateOverrideDialog);
  ovForm.addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    const ov = overrideFromForm();
    if (!ov.absenceType && !ov.leaveAt && ov.workedHours == null) {
      ctx.deleteOverride(overrideDate);
      toast('Výjimka odstraněna');
      return;
    }
    ctx.saveOverride(ov);
    toast(leaveWarning(ov.leaveAt, ctx.getState().settings) ? 'Výjimka uložena – porušuješ pevnou pracovní dobu' : 'Výjimka uložena');
  });
  $('#ov-delete').addEventListener('click', async () => {
    const date = overrideDate;
    $('#dlg-override').close();
    if (!(await confirmDialog(`Odstranit výjimku pro ${formatDateShort(date)}?`, 'Odstranit'))) return;
    ctx.deleteOverride(date);
    toast('Výjimka odstraněna');
  });
}

export function renderPlanView() {
  const { settings } = ctx.getState();
  $('#plan-week').innerHTML = weekBadgeHtml(settings);
  // průměr běžného dne aktuálního měsíce pro rozvrh
  const t = new Date();
  const { records, overrides } = ctx.getState();
  const cur = buildMonthPlan({ year: t.getFullYear(), month: t.getMonth() + 1, today: todayStr(), settings, records, overrides });
  renderWeeks(settings, cur.summary.averageRegular);
  renderSettingsForm(settings);
  renderMonthPlan();
  if ($('#dlg-override').open) updateOverrideDialog();
}
