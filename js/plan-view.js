// UI záložky „Plán“: rozvrh lichého/sudého týdne, nastavení, plán měsíce,
// výjimky dnů a hromadné doplnění docházky. Výpočty dělá čistý modul plan.js.
import {
  DAY_TYPES, formatMinutes, parseTime, describeBreakRule, hoursToMinutes, toTimeString,
} from './calc.js';
import {
  CORE_WARNING_KEYS, buildMonthPlan, fillCandidates, isoWeek,
  weekParity, normalizeSettings, settingsWarnings, workedForStay, stayForWorked,
  rulesFromSettings, switchAnchorMode, validateOverride, isEmptyOverride, bulkClearFixed, scheduledDay,
  applyRuleChange, isRuleChange, ruleChangeImpact, holidayChangeImpact, RULES_SINCE_EVER, NOTE_MAX, canEditOverride,
} from './plan.js';
import { enhanceTimeInputs } from './time24.js';
import {
  t, tr, weekdayName, weekdayShort, formatMonthYear, onLanguageChange,
} from './i18n.js';
import {
  $, escapeHtml, todayStr, formatDateLong, formatDateShort, toast, confirmDialog, setError,
} from './ui.js';

let ctx; // { getState, saveRecord, saveSettings, saveOverride, deleteOverride, applyOverrides, openDayDialog, changeLanguage, saveHolidays }
const now = new Date();
let planMonth = { y: now.getFullYear(), m: now.getMonth() + 1 };
let weeksKey = '';
const expandedNotes = new Set(); // rozbalené poznámky v tabulce (mobil)

const signed = (min) => formatMinutes(min, { sign: true });
const h = (min) => `${formatMinutes(min)} h`;
const typeLabel = (type) => t(`type.${type}`);
const parityLabel = (parity) => t(`parity.${parity}`);

// Rozvrh a jeho popisky se po změně jazyka překreslí celé.
onLanguageChange(() => { weeksKey = ''; });

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
      ${escapeHtml(t('week.badge', { week, parity: parityLabel(parity) }))}
    </span>
    <button type="button" data-flip-parity class="rounded-full px-3 py-1 text-sm font-medium text-slate-500 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-800" title="${escapeHtml(t('week.flipTitle'))}">⇄ ${escapeHtml(t('week.flip'))}</button>`;
}

export async function flipParity() {
  const { settings } = ctx.getState();
  ctx.saveSettings({ ...settings, parityFlip: !settings.parityFlip });
  toast(t('week.flipped'));
}

// ---------------------------------------------------------------------------
// Dopad změny na historii (sdílený dialog pravidel a dotaz na svátky)
// ---------------------------------------------------------------------------
/** Vykreslí dopad změny: zůstatek banky před → po a počet dotčených uzavřených dnů. */
export function renderImpact(el, impact) {
  const changed = impact.affectedDays > 0 || impact.balanceAfter !== impact.balanceBefore;
  el.className = `mt-3 rounded-xl px-3 py-2 text-sm ${changed ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`;
  el.innerHTML = `${escapeHtml(t(changed ? 'impact.changed' : 'impact.unchanged'))}<br>
    ${escapeHtml(t('impact.balance'))} <b class="tabular">${signed(impact.balanceBefore)} h → ${signed(impact.balanceAfter)} h</b><br>
    ${escapeHtml(t('impact.days'))} <b class="tabular">${impact.affectedDays}</b>`;
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
  const anchorLabel = t('schedule.anchorLabel', { time: settings.anchorTime });
  const emptyArr = arrMode ? anchorLabel : t('schedule.compute');
  const emptyLv = arrMode ? t('schedule.compute') : anchorLabel;

  if (key !== weeksKey) {
    weeksKey = key;
    root.innerHTML = ['odd', 'even'].map((week) => `
      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 dark:bg-slate-900 ${week === current ? 'ring-2 ring-indigo-500' : 'ring-slate-200 dark:ring-slate-800'}">
        <div class="mb-1 flex items-center justify-between">
          <h3 class="font-semibold">${escapeHtml(t(week === 'odd' ? 'schedule.oddWeek' : 'schedule.evenWeek'))}</h3>
          ${week === current ? `<span class="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">${escapeHtml(t('schedule.thisWeek'))}</span>` : ''}
        </div>
        <div class="grid grid-cols-[2rem_1fr_1fr] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span></span><span>${escapeHtml(t('field.arrival'))}</span><span>${escapeHtml(t('field.departure'))}</span>
        </div>
        <div class="divide-y divide-slate-100 dark:divide-slate-800">
          ${[1, 2, 3, 4, 5].map((day) => `
            <div class="py-2">
              <div class="grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
                <span class="font-medium">${escapeHtml(weekdayName(day).slice(0, 2))}</span>
                ${['arriveAt', 'leaveAt'].map((field) => `
                <label class="min-w-0">
                  <span class="sr-only">${escapeHtml(t(field === 'arriveAt' ? 'schedule.srArrival' : 'schedule.srDeparture', { day: weekdayName(day), parity: parityLabel(week) }))}</span>
                  <input type="time" data-time24 data-optional data-empty-label="${escapeHtml(field === 'arriveAt' ? emptyArr : emptyLv)}" data-week="${week}" data-day="${day}" data-field="${field}" value="${escapeHtml(settings.schedule[week][day][field])}" class="${fieldCls}">
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
        hoursEl.innerHTML = `<span class="font-semibold">${escapeHtml(t('schedule.fixedDay', { hours: h(worked) }))}</span>`;
        hoursEl.title = t('schedule.fixedDayTitle', { from: toTimeString(arr), to: toTimeString(lv) });
      } else {
        const what = t(arr === null ? 'schedule.computeArrival' : 'schedule.computeLeave');
        const avg = avgRegular != null ? ` · ≈ ${h(avgRegular)}` : '';
        hoursEl.innerHTML = `<span class="text-slate-500 dark:text-slate-400">${escapeHtml(what + avg)}</span>`;
        hoursEl.title = t('schedule.regularTitle');
      }
      const w = warnings.filter((x) => x.week === week && x.day === day).map((x) => `⚠ ${tr(x.message)}`);
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
  toast(t(warn ? 'toast.savedCheckWarnings' : 'schedule.saved'));
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
  const anchor = parseTime(settings.anchorTime);
  const example = settings.anchorMode === 'arrival'
    ? t('settings.breakExampleArr', { arrival: settings.anchorTime, leave: toTimeString(Math.min(1439, anchor + stay)) })
    : t('settings.breakExampleDep', { arrival: toTimeString(Math.max(0, anchor - stay)), leave: settings.anchorTime });
  return t('settings.breakText', {
    rule: describeBreakRule(rules), fund: formatMinutes(rules.DAILY_FUND_MIN), stay: formatMinutes(stay), example,
  });
}

const RULE_FIELDS = ['dailyFundHours', 'breakAfterHours', 'breakLengthMinutes'];

const ruleSummary = (v) => t('rules.summary', {
  fund: formatMinutes(Math.round(v.dailyFundHours * 60)), minutes: v.breakLengthMinutes, after: formatMinutes(Math.round(v.breakAfterHours * 60)),
});

function renderRuleHistory(settings) {
  const el = $('#rule-history');
  const versions = settings.ruleVersions ?? [];
  el.hidden = versions.length < 2;
  el.innerHTML = versions.length < 2 ? '' : `<li class="font-medium">${escapeHtml(t('rules.history'))}</li>${versions.map((v) => `
    <li>${escapeHtml(v.from === RULES_SINCE_EVER ? t('rules.originally') : t('rules.since', { date: formatDateShort(v.from) }))}: ${escapeHtml(ruleSummary(v))}</li>`).join('')}`;
}

function renderSettingsForm(settings) {
  const f = $('#form-plan-settings');
  renderRuleHistory(settings);
  for (const name of SETTINGS_FIELDS) {
    if (document.activeElement !== f[name]) f[name].value = settings[name];
  }
  f.anchorMode.value = settings.anchorMode;
  f.czHolidays.checked = ctx.getState().app?.czHolidays !== false;
  $('#anchor-hint').textContent = settings.anchorMode === 'arrival'
    ? t('settings.anchorHintArr', { time: settings.anchorTime, limit: settings.latestDeparture })
    : t('settings.anchorHintDep', { time: settings.anchorTime, limit: settings.earliestArrival });
  $('#break-rule-text').textContent = breakRuleText(settings);
  const warnings = settingsWarnings(settings).filter((w) => w.field !== 'schedule');
  const el = $('#plan-settings-warnings');
  el.innerHTML = warnings.map((w) => `<li>⚠ ${escapeHtml(tr(w.message))}</li>`).join('');
  el.hidden = !warnings.length;
}

async function onAnchorModeChange() {
  const f = $('#form-plan-settings');
  const { settings } = ctx.getState();
  const mode = f.anchorMode.value;
  const { settings: next, changes } = switchAnchorMode(settings, mode);
  if (!changes.length) return;
  const text = t('settings.switchConfirm', { mode: t(`anchor.${mode}`), changes: changes.map((c) => `• ${tr(c)}`).join('\n') });
  const ok = await confirmDialog(text, t('settings.switch'), { danger: false });
  if (!ok) {
    f.anchorMode.value = settings.anchorMode;
    return;
  }
  ctx.saveSettings(next);
  toast(t('settings.switched', { mode: t(`anchor.${mode}`).toLowerCase(), time: next.anchorTime }));
}

function onSettingsChange(e) {
  const f = $('#form-plan-settings');
  if (!e.target.name) return;
  if (e.target.name === 'language') {
    ctx.changeLanguage(e.target.value);
    return;
  }
  if (e.target.name === 'czHolidays') {
    openHolidaysDialog(e.target.checked);
    return;
  }
  if (e.target.name === 'anchorMode') {
    onAnchorModeChange();
    return;
  }
  const { settings } = ctx.getState();
  const raw = { ...settings };
  for (const name of TIME_FIELDS) raw[name] = f[name].value;
  for (const name of NUMBER_FIELDS) raw[name] = f[name].valueAsNumber;
  const breakErr = !(raw.dailyFundHours > 0 && raw.dailyFundHours <= 24) ? 'settings.errFund'
    : !(raw.breakAfterHours > 0 && raw.breakAfterHours <= 24) ? 'settings.errBreakAfter'
    : !(Number.isInteger(raw.breakLengthMinutes) && raw.breakLengthMinutes >= 0) ? 'settings.errBreakLength'
      : raw.breakLengthMinutes >= hoursToMinutes(raw.breakAfterHours) ? 'settings.errBreakShorter'
        : null;
  setError($('#break-rule-error'), breakErr ? t(breakErr) : null);
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
  toast(t(warns.length ? 'toast.savedCheckWarnings' : 'settings.saved'));
}

// ---------------------------------------------------------------------------
// Změna pravidel výpočtu – ochrana historie (fond, přestávka, státní svátky)
// ---------------------------------------------------------------------------
let rulesChange = null; // { kind: 'rules', settings, patch } | { kind: 'holidays', enabled }

function rulesDialogNext() {
  const f = $('#form-rules');
  const from = f.scope.value === 'all' ? RULES_SINCE_EVER : f.from.value || todayStr();
  return applyRuleChange(rulesChange.settings, rulesChange.patch, from);
}

function updateRulesDialog() {
  if (!rulesChange) return;
  const { records, withdrawals, settings } = ctx.getState();
  const f = $('#form-rules');
  f.from.disabled = f.scope.value === 'all';
  const impact = rulesChange.kind === 'holidays'
    ? holidayChangeImpact({ records, withdrawals, settings, enabled: rulesChange.enabled })
    : ruleChangeImpact({ records, withdrawals, settings: rulesChange.settings, next: rulesDialogNext() });
  renderImpact($('#rules-impact'), impact);
}

/** Otevře dialog dopadu; onOk se zavolá jen po potvrzení, onCancel jinak. */
function showRulesDialog({ title, text, scoped, onOk, onCancel }) {
  $('#rules-title').textContent = title;
  $('#rules-change-text').textContent = text;
  $('#rules-scope').hidden = !scoped;
  const f = $('#form-rules');
  f.scope.value = 'from';
  f.from.value = todayStr();
  updateRulesDialog();
  const dlg = $('#dlg-rules');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') onOk();
    else onCancel();
    rulesChange = null;
  }, { once: true });
}

function openRulesDialog(settings, patch) {
  rulesChange = { kind: 'rules', settings, patch };
  const cur = settings.ruleVersions[settings.ruleVersions.length - 1];
  showRulesDialog({
    title: t('rules.title'),
    text: `${ruleSummary(cur)} → ${ruleSummary({ ...cur, ...patch })}`,
    scoped: true,
    onOk() {
      const f = $('#form-rules');
      ctx.saveSettings(rulesDialogNext());
      const from = f.scope.value === 'all' ? t('rules.savedRetro') : t('rules.since', { date: formatDateShort(f.from.value || todayStr()) });
      toast(t('rules.saved', { from }));
    },
    onCancel() {
      renderSettingsForm(ctx.getState().settings); // vrátí pole na uložené hodnoty
      toast(t('rules.cancelled'));
    },
  });
}

/** Zapnutí/vypnutí státních svátků z nastavení – vždy zpětně, jen po potvrzení dopadu. */
function openHolidaysDialog(enabled) {
  rulesChange = { kind: 'holidays', enabled };
  showRulesDialog({
    title: t(enabled ? 'holidays.enableTitle' : 'holidays.disableTitle'),
    text: t('holidays.retroText'),
    scoped: false,
    onOk: () => ctx.saveHolidays(enabled),
    onCancel() {
      renderSettingsForm(ctx.getState().settings);
      toast(t('rules.cancelled'));
    },
  });
}

// ---------------------------------------------------------------------------
// Plán měsíce
// ---------------------------------------------------------------------------
const ROW_STYLE = {
  done: { row: '', label: 'legend.done', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  filled: { row: 'bg-teal-50/70 dark:bg-teal-950/30', label: 'legend.filled', chip: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200' },
  missing: { row: 'bg-rose-50/70 dark:bg-rose-950/30', label: 'legend.missing', chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200' },
  absence: { row: 'bg-sky-50/70 dark:bg-sky-950/30', label: 'legend.absence', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200' },
  fixed: { row: 'bg-violet-50/70 dark:bg-violet-950/30', label: 'tag.fixedDay', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200' },
  override: { row: 'bg-amber-50/70 dark:bg-amber-950/30', label: 'legend.override', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200' },
  regular: { row: 'bg-indigo-50/60 dark:bg-indigo-950/30', label: 'legend.regular', chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200' },
  cleared: { row: '', label: '', chip: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  off: { row: 'text-slate-400 dark:text-slate-600', label: '', chip: '' },
};

/** Styl řádku: výjimka má přednost (kromě proběhlých dnů). */
function styleKey(d) {
  if (d.override && d.plannedWorked !== null) return 'override';
  return d.kind;
}

const chip = (key, text = t(ROW_STYLE[key].label)) => `<span class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ROW_STYLE[key].chip}">${escapeHtml(text)}</span>`;

/** Který konec dne je pevný z rozvrhu/výjimky (klíč štítku). */
function fixedLabel(d) {
  if (d.explicitArrival && d.explicitLeave) return t('tag.fixedTimes');
  if (d.explicitLeave) return t('tag.fixedLeave');
  if (d.explicitArrival) return t('tag.fixedArrival');
  return null;
}

const NOTE_ICON = '📝';

function typeText(d) {
  if (!d.workday && d.kind === 'off') return escapeHtml(d.holiday ? t(d.holiday) : t('common.weekend'));
  const parts = [];
  if (d.clearedFixed) parts.push(chip('cleared', t(`tag.cleared.${d.clearedFixed}`)));
  if (d.note) parts.push(`<button type="button" data-toggle-note="${d.date}" class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ROW_STYLE.override.chip}" title="${escapeHtml(d.note)}">${NOTE_ICON} ${escapeHtml(t('tag.note'))}</button>`);
  if (d.type && d.type !== DAY_TYPES.WORK) {
    parts.push(escapeHtml(typeLabel(d.type)) + (d.absence && d.absence < d.credited ? ` ${formatMinutes(d.absence)} h` : ''));
  }
  const fixed = fixedLabel(d);
  if (d.kind === 'fixed') parts.push(chip(styleKey(d), styleKey(d) === 'fixed' ? fixed ?? t(d.actualArrival ? 'tag.todayArrival' : 'tag.fixedDay') : undefined));
  else parts.push(chip(styleKey(d)));
  if (fixed && (d.kind !== 'fixed' || styleKey(d) !== 'fixed')) parts.push(chip('fixed', fixed));
  return parts.join(' ');
}

/** Příchod/odchod: skutečnost normálně, plán tlumeně. */
function timeCell(actual, planned) {
  if (actual) return `<span>${escapeHtml(actual)}</span>`;
  if (planned) return `<span class="italic text-slate-400 dark:text-slate-500" title="${escapeHtml(t('table.planned'))}">${planned}</span>`;
  return '';
}

function actualText(d) {
  if (!d.record) return d.kind === 'missing' ? '<span class="text-rose-600 dark:text-rose-400">—</span>' : '';
  return d.plannedWorked === null && d.actual != null ? `<b>${formatMinutes(d.actual)}</b>` : '';
}

/** Celý popis dne do tooltipu řádku. */
function rowTitle(d) {
  const r = d.record;
  const parts = [t('week.badge', { week: d.week, parity: parityLabel(d.parity) })];
  if (r?.arrival) parts.push(t('table.actualTimes', { from: r.arrival, to: r.departure ?? '…' }));
  if (d.plannedLeave) parts.push(t('table.plannedTimes', { arrival: d.arrival, leave: d.plannedLeave }));
  return [...parts, ...d.warnings.map(tr)].join(' · ');
}

function summaryCard(label, value, sub = '', cls = '') {
  return `
    <div class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p class="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtml(label)}</p>
      <p class="tabular mt-0.5 text-lg font-bold ${cls}">${value}</p>
      ${sub ? `<p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtml(sub)}</p>` : ''}
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
  $('#plan-month-title').textContent = formatMonthYear(planMonth.y, planMonth.m);
  const devTone = s.deviation === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  $('#plan-summary').innerHTML = [
    summaryCard(t('summary.fund'), h(s.fund)),
    summaryCard(t('summary.worked'), h(s.worked), t('summary.workedSub')),
    summaryCard(t('summary.remaining'), h(s.planRemaining)),
    summaryCard(t('summary.projected'), h(s.projected), t('summary.projectedSub')),
    summaryCard(t('summary.deviation'), `${signed(s.deviation)} h`, t('summary.deviationSub'), devTone),
    summaryCard(t('summary.average'), s.averageRegular != null ? h(s.averageRegular) : '—', t('summary.averageSub', { count: s.regularDays })),
  ].join('');

  const warnEl = $('#plan-warnings');
  warnEl.innerHTML = plan.warnings.map((w) => `<li>⚠ ${escapeHtml(tr(w))}</li>`).join('');
  warnEl.hidden = !plan.warnings.length;

  const candidates = fillCandidatesFor();
  const bulk = $('#btn-bulk-fill');
  bulk.hidden = !candidates.length;
  bulk.textContent = t('fill.bulkButton', { count: candidates.length });

  const today = todayStr();
  $('#plan-table tbody').innerHTML = plan.days.map((d) => {
    const key = styleKey(d);
    const dayNum = Number(d.date.slice(8));
    const warnLabel = t(d.warnings.some((w) => CORE_WARNING_KEYS.has(w.key)) ? 'table.warnCore' : 'table.warn');
    const warn = d.warnings.length ? `<span class="block text-[11px] text-amber-700 dark:text-amber-400">⚠ ${escapeHtml(warnLabel)}</span>` : '';
    const parityShort = t(`parity.short.${d.parity}`);
    return `
      <tr data-plan-date="${d.date}" title="${escapeHtml(rowTitle(d))}" class="cursor-pointer border-t border-slate-100 hover:brightness-95 dark:border-slate-800 ${ROW_STYLE[key].row} ${d.date === today ? 'font-semibold outline outline-2 -outline-offset-2 outline-indigo-500' : ''}">
        <td class="whitespace-nowrap px-2 py-2"><span class="tabular">${dayNum}.</span> <span class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtml(weekdayShort(d.date))}</span>
          <span class="ml-0.5 rounded px-1 text-[10px] font-bold ${d.parity === 'odd' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'}" title="${escapeHtml(t('week.badge', { week: d.week, parity: parityLabel(d.parity) }))}">${escapeHtml(parityShort)}</span></td>
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
  if (!rec.arrival) return typeLabel(rec.type);
  const abs = rec.absenceHours ? ` + ${typeLabel(rec.type).toLowerCase()} ${formatMinutes(Math.round(rec.absenceHours * 60))} h` : '';
  return `${rec.arrival}–${rec.departure}${abs}`;
}

function openBulkFill() {
  const list = fillCandidatesFor();
  if (!list.length) return;
  $('#fill-list').innerHTML = list.map((c) => `
    <li class="flex items-center justify-between gap-3 py-2">
      <span>${formatDateShort(c.date)} <span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(weekdayShort(c.date))}</span></span>
      <span class="tabular text-right font-medium">${escapeHtml(describeFill(c.record))}${c.before?.arrival ? `<span class="block text-[11px] font-normal text-slate-500">${escapeHtml(t('fill.arrivalKept'))}</span>` : ''}</span>
    </li>`).join('');
  $('#fill-count').textContent = t('fill.count', { count: list.length });
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
    if (errors.length) toast(t('fill.someFailed', { errors: errors.join('; ') }), 'error');
    else toast(t('fill.done', { count: list.length }));
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
  setError($('#ov-error'), error ? tr(error) : null);
  $('#ov-save').disabled = Boolean(error);
  const w = $('#ov-warnings');
  w.innerHTML = warnings.map((x) => `<li>⚠ ${escapeHtml(tr(x))}</li>`).join('');
  w.hidden = !warnings.length;

  if (!error) {
    const plan = currentPlan(isEmptyOverride(ov) ? { date: overrideDate, remove: true } : ov);
    const d = plan.days.find((x) => x.date === overrideDate);
    const parts = [];
    if (d.kind === 'absence') parts.push(t('ov.previewAbsence', { type: typeLabel(d.type).toLowerCase(), hours: h(d.credited) }));
    else if (d.plannedWorked !== null) {
      parts.push(t('ov.previewPlan', {
        hours: h(d.plannedWorked),
        absence: d.absence ? t('ov.previewPlanAbsence', { hours: h(d.absence) }) : '',
        from: d.arrival ?? '—',
        to: d.plannedLeave ?? '—',
        computed: d.kind === 'regular' ? t('ov.previewComputed') : '',
      }));
    }
    parts.push(plan.summary.unbalanced ? tr(plan.warnings[0]) : t('ov.previewBalanced'));
    $('#ov-preview').textContent = parts.join(' · ');
  }
}

function absenceOptions() {
  const select = $('#form-override').absenceType;
  const value = select.value;
  select.innerHTML = `<option value="">${escapeHtml(t('ov.noAbsence'))}</option>${
    [DAY_TYPES.VACATION, DAY_TYPES.SICK, DAY_TYPES.DOCTOR, DAY_TYPES.COMP]
      .map((type) => `<option value="${type}">${escapeHtml(typeLabel(type))}</option>`).join('')}`;
  select.value = value;
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
  for (const [field, name] of [['arriveAt', 'clearArrival'], ['leaveAt', 'clearLeave']]) {
    const key = name === 'clearArrival' ? 'arrival' : 'leave';
    const has = Boolean(sched[field]);
    f[name].disabled = !has;
    f[name].checked = has && (ov?.clearFixed === key || ov?.clearFixed === 'both');
    $(`#ov-clear-${key}-time`).textContent = has ? `(${sched[field]})` : t('ov.notInSchedule');
    $(`#ov-clear-${key}-wrap`).classList.toggle('opacity-50', !has);
  }
  const schedText = [
    sched.arriveAt && t('ov.schedArrival', { time: sched.arriveAt }),
    sched.leaveAt && t('ov.schedLeave', { time: sched.leaveAt }),
  ].filter(Boolean).join(', ');
  $('#ov-schedule').textContent = t('ov.schedule', {
    schedule: schedText || t('ov.noFixedTimes'), anchor: t(`anchor.${settings.anchorMode}`).toLowerCase(), time: settings.anchorTime,
  });
  $('#ov-title').textContent = formatDateLong(date);
  const { week } = isoWeek(date);
  $('#ov-sub').textContent = t('ov.sub', { week, parity: parityLabel(weekParity(date, settings.parityFlip)) });
  $('#ov-delete').hidden = !ov;
  updateOverrideDialog();
  $('#dlg-override').showModal();
}

// ---------------------------------------------------------------------------
// Hromadné zrušení pevných časů (s vrácením jedním krokem)
// ---------------------------------------------------------------------------
let lastBulk = null; // { ops, what, from, to }

function bulkClearOps() {
  const f = $('#form-bulk-clear');
  const { settings, overrides } = ctx.getState();
  return bulkClearFixed({ from: f.from.value, to: f.to.value, what: f.what.value, today: todayStr(), settings, overrides });
}

function updateBulkClear() {
  const f = $('#form-bulk-clear');
  const ops = f.from.value && f.to.value && f.from.value <= f.to.value ? bulkClearOps() : [];
  $('#bulk-clear-preview').textContent = ops.length
    ? t('bulk.preview', { count: ops.length, dates: ops.map((o) => formatDateShort(o.date)).join(', ') })
    : t('bulk.none');
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
    lastBulk = { ops, what: f.what.value, from: f.from.value, to: f.to.value };
    renderBulkUndo();
  }, { once: true });
}

function renderBulkUndo() {
  $('#bulk-undo').hidden = !lastBulk;
  if (lastBulk) {
    $('#bulk-undo-text').textContent = t('bulk.done', {
      what: t(`bulk.${lastBulk.what}`), count: lastBulk.ops.length, from: formatDateShort(lastBulk.from), to: formatDateShort(lastBulk.to),
    });
  }
}

function undoBulk() {
  if (!lastBulk) return;
  ctx.applyOverrides(lastBulk.ops.map((o) => ({ date: o.date, data: o.before })));
  toast(t('bulk.undone'));
  lastBulk = null;
  renderBulkUndo();
}

// ---------------------------------------------------------------------------
// Inicializace a vykreslení
// ---------------------------------------------------------------------------
export function initPlanView(context) {
  ctx = context;
  absenceOptions();
  onLanguageChange(absenceOptions);

  $('#plan-weeks').addEventListener('change', onScheduleChange);
  $('#form-plan-settings').addEventListener('change', onSettingsChange);
  $('#form-plan-settings').addEventListener('submit', (e) => e.preventDefault());
  $('#btn-plan-prev').addEventListener('click', () => shiftPlanMonth(-1));
  $('#btn-plan-next').addEventListener('click', () => shiftPlanMonth(1));
  $('#btn-plan-today').addEventListener('click', () => {
    const d = new Date();
    planMonth = { y: d.getFullYear(), m: d.getMonth() + 1 };
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
    if (canEditOverride(d, todayStr())) openOverrideDialog(date);
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
      toast(t('ov.deleted'));
      return;
    }
    ctx.saveOverride(ov);
    toast(t(validateOverride(ov, ctx.getState().settings).warnings.length ? 'ov.savedWarnings' : 'ov.saved'));
  });
  $('#ov-delete').addEventListener('click', async () => {
    const date = overrideDate;
    $('#dlg-override').close();
    if (!(await confirmDialog(t('ov.confirmDelete', { date: formatDateShort(date) }), t('ov.delete')))) return;
    ctx.deleteOverride(date);
    toast(t('ov.deleted'));
  });
}

export function renderPlanView() {
  const { settings } = ctx.getState();
  $('#plan-week').innerHTML = weekBadgeHtml(settings);
  // průměr běžného dne aktuálního měsíce pro rozvrh
  const d = new Date();
  const { records, overrides } = ctx.getState();
  const cur = buildMonthPlan({ year: d.getFullYear(), month: d.getMonth() + 1, today: todayStr(), settings, records, overrides });
  renderWeeks(settings, cur.summary.averageRegular);
  renderSettingsForm(settings);
  renderMonthPlan();
  renderBulkUndo();
  if ($('#dlg-override').open) updateOverrideDialog();
}
