// UI záložky „Plán“: rozvrh lichého/sudého týdne, nastavení, plán měsíce,
// výjimky dnů a hromadné doplnění docházky. Výpočty dělá čistý modul plan.js.
import {
  DAY_TYPES, DAY_TYPE_LABELS, MONTH_LABELS, formatMinutes, parseTime, weekdayLabel, describeBreakRule,
  hoursToMinutes, toTimeString,
} from './calc.js';
import {
  WEEKDAY_NAMES, PARITY_LABELS, CORE_WARNING, ANCHOR_LABELS, buildMonthPlan, fillCandidates, isoWeek,
  weekParity, normalizeSettings, settingsWarnings, workedForStay, stayForWorked,
  rulesFromSettings, switchAnchorMode, validateOverride, isEmptyOverride, bulkClearFixed, scheduledDay,
  applyRuleChange, isRuleChange, ruleChangeImpact, RULES_SINCE_EVER, NOTE_MAX,
} from './plan.js';
import { enhanceTimeInputs } from './time24.js';
import {
  $, escapeHtml, todayStr, formatDateLong, formatDateShort, toast, confirmDialog, setError,
} from './ui.js';

let ctx; // { getState, saveRecord, saveSettings, saveOverride, deleteOverride, applyOverrides, openDayDialog }
const now = new Date();
let planMonth = { y: now.getFullYear(), m: now.getMonth() + 1 };
let weeksKey = '';
const expandedNotes = new Set(); // rozbalené poznámky v tabulce (mobil)

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
const fieldCls = 'tabular w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800';

/** Konce dne z rozvrhu po doplnění kotvou (minuty nebo null = dopočítá se). */
function scheduleEnds(settings, { arriveAt, leaveAt }) {
  const anchor = parseTime(settings.anchorTime);
  return {
    arr: arriveAt ? parseTime(arriveAt) : settings.anchorMode === 'arrival' ? anchor : null,
    lv: leaveAt ? parseTime(leaveAt) : settings.anchorMode === 'departure' ? anchor : null,
  };
}

function renderWeeks(settings, avgRegular) {
  const today = todayStr();
  const current = weekParity(today, settings.parityFlip);
  const key = JSON.stringify([settings.schedule, settings.parityFlip, settings.anchorMode, settings.anchorTime, current]);
  const root = $('#plan-weeks');
  const arrMode = settings.anchorMode === 'arrival';
  const emptyArr = arrMode ? `${settings.anchorTime} kotva` : 'dopočítat';
  const emptyLv = arrMode ? 'dopočítat' : `${settings.anchorTime} kotva`;

  if (key !== weeksKey) {
    weeksKey = key;
    root.innerHTML = ['odd', 'even'].map((week) => `
      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 dark:bg-slate-900 ${week === current ? 'ring-2 ring-indigo-500' : 'ring-slate-200 dark:ring-slate-800'}">
        <div class="mb-1 flex items-center justify-between">
          <h3 class="font-semibold">${week === 'odd' ? 'Lichý' : 'Sudý'} týden</h3>
          ${week === current ? '<span class="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">tento týden</span>' : ''}
        </div>
        <div class="grid grid-cols-[2rem_1fr_1fr] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span></span><span>Příchod</span><span>Odchod</span>
        </div>
        <div class="divide-y divide-slate-100 dark:divide-slate-800">
          ${[1, 2, 3, 4, 5].map((day) => `
            <div class="py-2">
              <div class="grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
                <span class="font-medium">${WEEKDAY_NAMES[day].slice(0, 2)}</span>
                ${['arriveAt', 'leaveAt'].map((field) => `
                <label class="min-w-0">
                  <span class="sr-only">${WEEKDAY_NAMES[day]} – ${field === 'arriveAt' ? 'příchod' : 'odchod'} (${PARITY_LABELS[week]} týden)</span>
                  <input type="time" data-time24 data-optional data-empty-label="${field === 'arriveAt' ? emptyArr : emptyLv}" data-week="${week}" data-day="${day}" data-field="${field}" value="${escapeHtml(settings.schedule[week][day][field])}" class="${fieldCls}">
                </label>`).join('')}
              </div>
              <p data-hours="${week}-${day}" class="tabular mt-1 pl-10 text-xs"></p>
              <p data-warn="${week}-${day}" class="mt-0.5 pl-10 text-xs text-amber-700 dark:text-amber-400" hidden></p>
            </div>`).join('')}
        </div>
      </section>`).join('');
    enhanceTimeInputs(root);
  }

  // texty hodin a varování se aktualizují bez překreslení výběrů času
  const warnings = settingsWarnings(settings).filter((w) => w.field === 'schedule');
  for (const week of ['odd', 'even']) {
    for (const day of [1, 2, 3, 4, 5]) {
      const { arr, lv } = scheduleEnds(settings, settings.schedule[week][day]);
      const hoursEl = root.querySelector(`[data-hours="${week}-${day}"]`);
      if (arr !== null && lv !== null) {
        const worked = workedForStay(Math.max(0, lv - arr), rulesFromSettings(settings));
        hoursEl.innerHTML = `<span class="font-semibold">pevný den · ${h(worked)}</span>`;
        hoursEl.title = `Od ${toTimeString(arr)} do ${toTimeString(lv)} po odečtení přestávky – den se neprodlužuje`;
      } else {
        const what = arr === null ? 'příchod' : 'odchod';
        hoursEl.innerHTML = `<span class="text-slate-500 dark:text-slate-400">dopočítá se ${what}${avgRegular != null ? ` · ≈ ${h(avgRegular)}` : ''}</span>`;
        hoursEl.title = 'Běžný den – hodiny se dopočítají podle měsíce (průměr na běžný den tohoto měsíce)';
      }
      const w = warnings.filter((x) => x.week === week && x.day === day).map((x) => `⚠ ${x.message}`);
      setError(root.querySelector(`[data-warn="${week}-${day}"]`), w.join(' ') || null);
    }
  }
}

function onScheduleChange(e) {
  const input = e.target.closest('input[data-week]');
  if (!input) return;
  const { settings } = ctx.getState();
  const next = normalizeSettings(settings);
  const { week, day, field } = input.dataset;
  next.schedule[week][day] = { ...next.schedule[week][day], [field]: input.value };
  ctx.saveSettings(next);
  const warn = settingsWarnings(next).some((w) => w.field === 'schedule' && w.week === week && String(w.day) === day);
  toast(warn ? 'Uloženo – zkontrolujte upozornění' : 'Rozvrh uložen');
}

// ---------------------------------------------------------------------------
// Nastavení
// ---------------------------------------------------------------------------
const TIME_FIELDS = ['anchorTime', 'earliestArrival', 'latestDeparture', 'coreStart', 'coreEnd'];
const SETTINGS_FIELDS = [...TIME_FIELDS, 'dailyFundHours', 'maxWorkedHoursPerDay', 'breakAfterHours', 'breakLengthMinutes'];
const NUMBER_FIELDS = ['dailyFundHours', 'maxWorkedHoursPerDay', 'breakAfterHours', 'breakLengthMinutes'];

/** Vysvětlení pravidla přestávky s příkladem pro denní fond. */
function breakRuleText(settings) {
  const rules = rulesFromSettings(settings);
  const stay = stayForWorked(rules.DAILY_FUND_MIN, rules);
  return `${describeBreakRule(rules)} Na denní fond ${formatMinutes(rules.DAILY_FUND_MIN)} h je tedy potřeba pobyt ${formatMinutes(stay)} h `
    + (settings.anchorMode === 'arrival'
      ? `(příchod ${settings.anchorTime} → odchod ${toTimeString(Math.min(1439, parseTime(settings.anchorTime) + stay))}). `
      : `(příchod ${toTimeString(Math.max(0, parseTime(settings.anchorTime) - stay))} ← odchod ${settings.anchorTime}). `)
    + 'Pravidlo platí pro výpočet odpracovaných hodin, přesčasů i plánu.';
}

const RULE_FIELDS = ['dailyFundHours', 'breakAfterHours', 'breakLengthMinutes'];

const ruleSummary = (v) => `fond ${formatMinutes(Math.round(v.dailyFundHours * 60))} h, přestávka ${v.breakLengthMinutes} min po ${formatMinutes(Math.round(v.breakAfterHours * 60))} h`;

function renderRuleHistory(settings) {
  const el = $('#rule-history');
  const versions = settings.ruleVersions ?? [];
  el.hidden = versions.length < 2;
  el.innerHTML = versions.length < 2 ? '' : `<li class="font-medium">Platnost pravidel:</li>${versions.map((v) => `
    <li>${v.from === RULES_SINCE_EVER ? 'původně' : `od ${formatDateShort(v.from)}`}: ${escapeHtml(ruleSummary(v))}</li>`).join('')}`;
}

function renderSettingsForm(settings) {
  const f = $('#form-plan-settings');
  renderRuleHistory(settings);
  for (const name of SETTINGS_FIELDS) {
    if (document.activeElement !== f[name]) f[name].value = settings[name];
  }
  f.anchorMode.value = settings.anchorMode;
  $('#anchor-hint').textContent = settings.anchorMode === 'arrival'
    ? `Běžný den začíná v ${settings.anchorTime}, odchod se dopočítá a při napracování posouvá (nejpozději ${settings.latestDeparture}).`
    : `Běžný den končí v ${settings.anchorTime}, příchod se dopočítá a při napracování posouvá dřív (nejdříve ${settings.earliestArrival}).`;
  $('#break-rule-text').textContent = breakRuleText(settings);
  const warnings = settingsWarnings(settings).filter((w) => w.field !== 'schedule');
  const el = $('#plan-settings-warnings');
  el.innerHTML = warnings.map((w) => `<li>⚠ ${escapeHtml(w.message)}</li>`).join('');
  el.hidden = !warnings.length;
}

async function onAnchorModeChange() {
  const f = $('#form-plan-settings');
  const { settings } = ctx.getState();
  const mode = f.anchorMode.value;
  const { settings: next, changes } = switchAnchorMode(settings, mode);
  if (!changes.length) return;
  const ok = await confirmDialog(`Přepnout pevný čas na „${ANCHOR_LABELS[mode]}“? Co se změní:\n\n${changes.map((c) => `• ${c}`).join('\n')}`, 'Přepnout', { danger: false });
  if (!ok) {
    f.anchorMode.value = settings.anchorMode;
    return;
  }
  ctx.saveSettings(next);
  toast(`Pevný čas: ${ANCHOR_LABELS[mode].toLowerCase()} v ${next.anchorTime}`);
}

function onSettingsChange(e) {
  const f = $('#form-plan-settings');
  if (!e.target.name) return;
  if (e.target.name === 'anchorMode') {
    onAnchorModeChange();
    return;
  }
  const { settings } = ctx.getState();
  const raw = { ...settings };
  for (const name of TIME_FIELDS) raw[name] = f[name].value;
  for (const name of NUMBER_FIELDS) raw[name] = f[name].valueAsNumber;
  const breakErr = !(raw.dailyFundHours > 0 && raw.dailyFundHours <= 24) ? 'Denní fond musí být 0,25–24 h.'
    : !(raw.breakAfterHours > 0 && raw.breakAfterHours <= 24) ? 'Interval přestávky musí být 0,25–24 h.'
    : !(Number.isInteger(raw.breakLengthMinutes) && raw.breakLengthMinutes >= 0) ? 'Délka přestávky musí být celý počet minut (0 = bez přestávky).'
      : raw.breakLengthMinutes >= hoursToMinutes(raw.breakAfterHours) ? 'Přestávka musí být kratší než interval, po kterém se odečítá.'
        : null;
  setError($('#break-rule-error'), breakErr);
  if (breakErr) return;
  // Fond a přestávka mění výpočet historie → jen přes potvrzení s datem platnosti.
  const rulePatch = Object.fromEntries(RULE_FIELDS.map((k) => [k, raw[k]]));
  if (isRuleChange(settings, rulePatch)) {
    openRulesDialog(settings, rulePatch);
    return;
  }
  for (const k of RULE_FIELDS) raw[k] = settings[k];
  const next = normalizeSettings(raw);
  ctx.saveSettings(next);
  const warns = settingsWarnings(next).filter((w) => w.field !== 'schedule');
  toast(warns.length ? 'Uloženo – zkontrolujte upozornění' : 'Nastavení uloženo');
}

// ---------------------------------------------------------------------------
// Změna pravidel výpočtu – ochrana historie
// ---------------------------------------------------------------------------
let rulesChange = null; // { settings, patch }

function rulesDialogNext() {
  const f = $('#form-rules');
  const from = f.scope.value === 'all' ? RULES_SINCE_EVER : f.from.value || todayStr();
  return applyRuleChange(rulesChange.settings, rulesChange.patch, from);
}

function updateRulesDialog() {
  const { records, withdrawals } = ctx.getState();
  const f = $('#form-rules');
  f.from.disabled = f.scope.value === 'all';
  const next = rulesDialogNext();
  const impact = ruleChangeImpact({ records, withdrawals, settings: rulesChange.settings, next });
  const el = $('#rules-impact');
  const changed = impact.affectedDays > 0 || impact.balanceAfter !== impact.balanceBefore;
  el.className = `mt-3 rounded-xl px-3 py-2 text-sm ${changed ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`;
  el.innerHTML = `${changed ? '⚠ Změna přepočítá uzavřené dny.' : 'Uzavřené dny se nezmění.'}<br>
    Zůstatek banky: <b class="tabular">${signed(impact.balanceBefore)} h → ${signed(impact.balanceAfter)} h</b><br>
    Dotčené uzavřené dny: <b class="tabular">${impact.affectedDays}</b>`;
}

function openRulesDialog(settings, patch) {
  rulesChange = { settings, patch };
  const cur = settings.ruleVersions[settings.ruleVersions.length - 1];
  $('#rules-change-text').textContent = `${ruleSummary(cur)} → ${ruleSummary({ ...cur, ...patch })}`;
  const f = $('#form-rules');
  f.scope.value = 'from';
  f.from.value = todayStr();
  updateRulesDialog();
  const dlg = $('#dlg-rules');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      const next = rulesDialogNext();
      ctx.saveSettings(next);
      const from = f.scope.value === 'all' ? 'zpětně pro všechna data' : `od ${formatDateShort(f.from.value || todayStr())}`;
      toast(`Pravidla uložena (${from})`);
    } else {
      renderSettingsForm(ctx.getState().settings); // vrátí pole na uložené hodnoty
      toast('Změna pravidel zrušena');
    }
    rulesChange = null;
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Plán měsíce
// ---------------------------------------------------------------------------
const ROW_STYLE = {
  done: { row: '', label: 'proběhlo', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  filled: { row: 'bg-teal-50/70 dark:bg-teal-950/30', label: 'doplněno', chip: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200' },
  missing: { row: 'bg-rose-50/70 dark:bg-rose-950/30', label: 'chybí záznam', chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200' },
  absence: { row: 'bg-sky-50/70 dark:bg-sky-950/30', label: 'nepřítomnost', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200' },
  fixed: { row: 'bg-violet-50/70 dark:bg-violet-950/30', label: 'pevný den', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200' },
  override: { row: 'bg-amber-50/70 dark:bg-amber-950/30', label: 'výjimka', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200' },
  regular: { row: 'bg-indigo-50/60 dark:bg-indigo-950/30', label: 'plánováno', chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200' },
  cleared: { row: '', label: '', chip: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  off: { row: 'text-slate-400 dark:text-slate-600', label: '', chip: '' },
};

/** Styl řádku: výjimka má přednost (kromě proběhlých dnů). */
function styleKey(d) {
  if (d.override && d.plannedWorked !== null) return 'override';
  return d.kind;
}

const chip = (key, text = ROW_STYLE[key].label) => `<span class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ROW_STYLE[key].chip}">${escapeHtml(text)}</span>`;

/** Který konec dne je pevný z rozvrhu/výjimky. */
function fixedLabel(d) {
  if (d.explicitArrival && d.explicitLeave) return 'pevné časy';
  if (d.explicitLeave) return 'pevný odchod';
  if (d.explicitArrival) return 'pevný příchod';
  return null;
}

const CLEARED_LABELS = { leave: 'bez pevného odchodu', arrival: 'bez pevného příchodu', both: 'bez pevných časů' };
const NOTE_ICON = '📝';

function typeText(d) {
  if (!d.workday && d.kind === 'off') return d.holiday ? escapeHtml(d.holiday) : 'víkend';
  const parts = [];
  if (d.clearedFixed) parts.push(chip('cleared', CLEARED_LABELS[d.clearedFixed]));
  if (d.note) parts.push(`<button type="button" data-toggle-note="${d.date}" class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ROW_STYLE.override.chip}" title="${escapeHtml(d.note)}">${NOTE_ICON} poznámka</button>`);
  if (d.type && d.type !== DAY_TYPES.WORK) {
    parts.push(escapeHtml(DAY_TYPE_LABELS[d.type]) + (d.absence && d.absence < d.credited ? ` ${formatMinutes(d.absence)} h` : ''));
  }
  const fixed = fixedLabel(d);
  if (d.kind === 'fixed') parts.push(chip(styleKey(d), styleKey(d) === 'fixed' ? fixed ?? (d.actualArrival ? 'dnešní příchod' : 'pevný den') : undefined));
  else parts.push(chip(styleKey(d)));
  if (fixed && (d.kind !== 'fixed' || styleKey(d) !== 'fixed')) parts.push(chip('fixed', fixed));
  return parts.join(' ');
}

/** Příchod/odchod: skutečnost normálně, plán tlumeně. */
function timeCell(actual, planned) {
  if (actual) return `<span>${escapeHtml(actual)}</span>`;
  if (planned) return `<span class="italic text-slate-400 dark:text-slate-500" title="plán">${planned}</span>`;
  return '';
}

function actualText(d) {
  if (!d.record) return d.kind === 'missing' ? '<span class="text-rose-600 dark:text-rose-400">—</span>' : '';
  return d.plannedWorked === null && d.actual != null ? `<b>${formatMinutes(d.actual)}</b>` : '';
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
        <td class="whitespace-nowrap px-2 py-2"><span class="tabular">${dayNum}.</span> <span class="text-[11px] text-slate-500 dark:text-slate-400">${weekdayLabel(d.date)}</span>
          <span class="ml-0.5 rounded px-1 text-[10px] font-bold ${d.parity === 'odd' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'}" title="Týden ${d.week} · ${PARITY_LABELS[d.parity]}">${d.parity === 'odd' ? 'L' : 'S'}</span></td>
        <td class="px-1 py-2 text-xs">${typeText(d)}${warn}</td>
        <td class="tabular whitespace-nowrap px-1.5 py-2 text-right">${timeCell(d.record?.arrival, d.plannedWorked !== null ? d.arrival : null)}</td>
        <td class="tabular whitespace-nowrap px-1.5 py-2 text-right">${timeCell(d.record?.departure, d.plannedWorked !== null ? d.plannedLeave : null)}</td>
        <td class="tabular whitespace-nowrap px-1.5 py-2 text-right">${d.plannedWorked !== null && d.kind !== 'absence' ? formatMinutes(d.plannedWorked) : ''}</td>
        <td class="tabular whitespace-nowrap px-1.5 py-2 text-right">${actualText(d)}</td>
      </tr>${d.note ? `
      <tr data-note-for="${d.date}" class="${expandedNotes.has(d.date) ? '' : 'hidden'} md:table-row ${ROW_STYLE[key].row}">
        <td colspan="6" class="px-2 pb-2 pt-0 text-xs text-amber-800 dark:text-amber-300">${NOTE_ICON} ${escapeHtml(d.note)}</td>
      </tr>` : ''}`;
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
  const clearArr = f.clearArrival.checked && !f.clearArrival.disabled;
  const clearLv = f.clearLeave.checked && !f.clearLeave.disabled;
  return {
    date: overrideDate,
    absenceType: f.absenceType.value || null,
    absenceHours: f.absenceType.value && f.absenceHours.value !== '' ? f.absenceHours.valueAsNumber : null,
    arriveAt: f.arriveAt.value || null,
    leaveAt: f.leaveAt.value || null,
    workedHours: f.workedHours.value !== '' ? f.workedHours.valueAsNumber : null,
    clearFixed: clearArr && clearLv ? 'both' : clearArr ? 'arrival' : clearLv ? 'leave' : null,
    note: f.note.value,
  };
}

function updateOverrideDialog() {
  const f = $('#form-override');
  const ov = overrideFromForm();
  $('#ov-absence-hours').hidden = !ov.absenceType;
  $('#ov-note-count').textContent = `${f.note.value.length}/${NOTE_MAX}`;
  const { settings } = ctx.getState();
  const { error, warnings } = validateOverride(ov, settings);
  setError($('#ov-error'), error);
  $('#ov-save').disabled = Boolean(error);
  const w = $('#ov-warnings');
  w.innerHTML = warnings.map((x) => `<li>⚠ ${escapeHtml(x)}</li>`).join('');
  w.hidden = !warnings.length;

  if (!error) {
    const plan = currentPlan(isEmptyOverride(ov) ? { date: overrideDate, remove: true } : ov);
    const d = plan.days.find((x) => x.date === overrideDate);
    const parts = [];
    if (d.kind === 'absence') parts.push(`Celý den ${DAY_TYPE_LABELS[d.type].toLowerCase()} (${h(d.credited)})`);
    else if (d.plannedWorked !== null) parts.push(`Plán: ${h(d.plannedWorked)} práce${d.absence ? ` + ${h(d.absence)} nepřítomnost` : ''}, ${d.arrival ?? '—'}–${d.plannedLeave ?? '—'}${d.kind === 'regular' ? ' (dopočítáno)' : ''}`);
    parts.push(plan.summary.unbalanced ? plan.warnings[0] : 'Měsíc vyjde na nulu.');
    $('#ov-preview').textContent = parts.join(' · ');
  }
}

export function openOverrideDialog(date) {
  overrideDate = date;
  const { overrides, settings } = ctx.getState();
  const ov = overrides.find((o) => o.date === date);
  const f = $('#form-override');
  f.absenceType.value = ov?.absenceType ?? '';
  f.absenceHours.value = ov?.absenceHours ?? '';
  f.arriveAt.value = ov?.arriveAt ?? '';
  f.leaveAt.value = ov?.leaveAt ?? '';
  f.workedHours.value = ov?.workedHours ?? '';
  f.note.value = ov?.note ?? '';
  // zrušit lze jen pevný čas, který rozvrh pro tento den má
  const sched = scheduledDay(date, settings);
  for (const [field, name, key] of [['arriveAt', 'clearArrival', 'arrival'], ['leaveAt', 'clearLeave', 'leave']]) {
    const has = Boolean(sched[field]);
    f[name].disabled = !has;
    f[name].checked = has && (ov?.clearFixed === key || ov?.clearFixed === 'both');
    $(`#${name === 'clearArrival' ? 'ov-clear-arrival' : 'ov-clear-leave'}-time`).textContent = has ? `(${sched[field]})` : '(rozvrh ho nemá)';
    $(`#${name === 'clearArrival' ? 'ov-clear-arrival' : 'ov-clear-leave'}-wrap`).classList.toggle('opacity-50', !has);
  }
  const schedText = [sched.arriveAt && `příchod ${sched.arriveAt}`, sched.leaveAt && `odchod ${sched.leaveAt}`].filter(Boolean).join(', ');
  $('#ov-schedule').textContent = `Rozvrh: ${schedText || 'bez pevných časů'} · kotva: ${settings.anchorMode === 'arrival' ? 'příchod' : 'odchod'} ${settings.anchorTime}`;
  $('#ov-title').textContent = formatDateLong(date);
  const { week } = isoWeek(date);
  $('#ov-sub').textContent = `Výjimka dne · týden ${week} (${PARITY_LABELS[weekParity(date, settings.parityFlip)]})`;
  $('#ov-delete').hidden = !ov;
  updateOverrideDialog();
  $('#dlg-override').showModal();
}

// ---------------------------------------------------------------------------
// Hromadné zrušení pevných časů (s vrácením jedním krokem)
// ---------------------------------------------------------------------------
let lastBulk = null; // { ops, text }

function bulkClearOps() {
  const f = $('#form-bulk-clear');
  const { settings, overrides } = ctx.getState();
  return bulkClearFixed({ from: f.from.value, to: f.to.value, what: f.what.value, today: todayStr(), settings, overrides });
}

function updateBulkClear() {
  const f = $('#form-bulk-clear');
  const ops = f.from.value && f.to.value && f.from.value <= f.to.value ? bulkClearOps() : [];
  $('#bulk-clear-preview').textContent = ops.length
    ? `Dotčené dny (${ops.length}): ${ops.map((o) => formatDateShort(o.date)).join(', ')}`
    : 'V rozsahu není žádný dnešní ani budoucí pracovní den s tímto pevným časem v rozvrhu.';
  $('#bulk-clear-ok').disabled = !ops.length;
}

function openBulkClear() {
  const f = $('#form-bulk-clear');
  const today = todayStr();
  f.from.value = today;
  const last = new Date(Date.UTC(planMonth.y, planMonth.m, 0)).toISOString().slice(0, 10);
  f.to.value = last < today ? today : last;
  updateBulkClear();
  const dlg = $('#dlg-bulk-clear');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const ops = bulkClearOps();
    if (!ops.length) return;
    ctx.applyOverrides(ops.map((o) => ({ date: o.date, data: o.after })));
    const what = { leave: 'pevný odchod', arrival: 'pevný příchod', both: 'pevné časy' }[f.what.value];
    lastBulk = { ops, text: `Zrušen ${what} pro ${ops.length} ${plural(ops.length, ['den', 'dny', 'dnů'])} (${formatDateShort(f.from.value)} – ${formatDateShort(f.to.value)}).` };
    renderBulkUndo();
  }, { once: true });
}

function renderBulkUndo() {
  $('#bulk-undo').hidden = !lastBulk;
  if (lastBulk) $('#bulk-undo-text').textContent = lastBulk.text;
}

function undoBulk() {
  if (!lastBulk) return;
  ctx.applyOverrides(lastBulk.ops.map((o) => ({ date: o.date, data: o.before })));
  toast('Hromadné zrušení vráceno');
  lastBulk = null;
  renderBulkUndo();
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
  $('#btn-bulk-clear').addEventListener('click', openBulkClear);
  $('#form-bulk-clear').addEventListener('input', updateBulkClear);
  $('#form-bulk-clear').addEventListener('change', updateBulkClear);
  $('#btn-bulk-undo').addEventListener('click', undoBulk);
  $('#btn-bulk-undo-close').addEventListener('click', () => { lastBulk = null; renderBulkUndo(); });
  $('#form-rules').addEventListener('change', updateRulesDialog);
  $('#form-rules').addEventListener('input', updateRulesDialog);
  $('#plan-table').addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle-note]');
    if (toggle) {
      // poznámka se na mobilu rozbalí pod řádkem (na desktopu je vidět vždy)
      const date = toggle.dataset.toggleNote;
      if (expandedNotes.has(date)) expandedNotes.delete(date); else expandedNotes.add(date);
      $(`[data-note-for="${date}"]`)?.classList.toggle('hidden', !expandedNotes.has(date));
      return;
    }
    if (e.target.closest('[data-note-for]')) return;
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
    if (validateOverride(ov, ctx.getState().settings).error) {
      e.preventDefault();
      return;
    }
    if (isEmptyOverride(ov)) {
      ctx.deleteOverride(overrideDate);
      toast('Výjimka zrušena – den je podle rozvrhu');
      return;
    }
    ctx.saveOverride(ov);
    toast(validateOverride(ov, ctx.getState().settings).warnings.length ? 'Výjimka uložena – zkontrolujte upozornění' : 'Výjimka uložena');
  });
  $('#ov-delete').addEventListener('click', async () => {
    const date = overrideDate;
    $('#dlg-override').close();
    if (!(await confirmDialog(`Zrušit výjimku pro ${formatDateShort(date)}? Den se vrátí do stavu podle rozvrhu (smaže se i poznámka k plánu).`, 'Zrušit výjimku'))) return;
    ctx.deleteOverride(date);
    toast('Výjimka zrušena – den je podle rozvrhu');
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
