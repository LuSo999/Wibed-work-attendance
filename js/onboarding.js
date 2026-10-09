// Úvodní průvodce nastavením (7 kroků): jazyk a svátky, pevný příchod/odchod, fond a přestávka,
// dny s pevným odchodem, lichý/sudý týden, zápis docházky a zkratky, hotovo.
// Změny se drží v konceptu a uloží se až tlačítkem Hotovo; Přeskočit jen označí průvodce za dokončený.
import { formatMinutes, describeBreakRule, hoursToMinutes } from './calc.js';
import {
  normalizeSettings, applyRuleChange, isRuleChange, applyExample, samplePlan, isoWeek, weekParity,
  holidayChangeImpact, rulesFromSettings, stayForWorked, RULES_SINCE_EVER, SETTINGS_EXAMPLES, SAMPLE_MONTH,
} from './plan.js';
import { renderImpact } from './plan-view.js';
import { enhanceTimeInputs } from './time24.js';
import {
  t, tr, getLanguage, onLanguageChange, weekdayName, weekdayShort, formatMonthYear, formatDayMonth, LANGUAGES,
} from './i18n.js';
import { $, escapeHtml, todayStr, toast } from './ui.js';

const STEPS = ['welcome', 'anchor', 'rules', 'schedule', 'parity', 'record', 'done'];
const RULE_FIELDS = ['dailyFundHours', 'breakAfterHours', 'breakLengthMinutes'];

let ctx; // { getState, saveSettings, saveApp, saveHolidays, changeLanguage, goToPlan }
let step = 0;
let draft = null; // koncept nastavení plánu (bez pravidel výpočtu)
let draftRules = null; // { dailyFundHours, breakAfterHours, breakLengthMinutes }
let draftHolidays = true;


const field = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
const card = 'rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800';
const muted = 'text-sm text-slate-600 dark:text-slate-300';

/** Koncept s pravidly z konceptu (pro ukázku plánu a uložení). */
const previewSettings = () => applyRuleChange(draft, draftRules, RULES_SINCE_EVER);

function rulesError() {
  const r = draftRules;
  if (!(r.dailyFundHours > 0 && r.dailyFundHours <= 24)) return 'settings.errFund';
  if (!(r.breakAfterHours > 0 && r.breakAfterHours <= 24)) return 'settings.errBreakAfter';
  if (!(Number.isInteger(r.breakLengthMinutes) && r.breakLengthMinutes >= 0)) return 'settings.errBreakLength';
  if (r.breakLengthMinutes >= hoursToMinutes(r.breakAfterHours)) return 'settings.errBreakShorter';
  return null;
}

// ---------------------------------------------------------------------------
// Ukázka plánu na vzorovém měsíci
// ---------------------------------------------------------------------------
function previewHtml() {
  if (rulesError()) return '';
  const { days, summary } = samplePlan(previewSettings());
  const rows = days.map((d) => {
    const fixed = d.kind === 'fixed';
    return `<tr class="border-t border-slate-100 dark:border-slate-800">
      <td class="py-1 pr-2">${escapeHtml(weekdayShort(d.date))} ${escapeHtml(formatDayMonth(d.date))}
        <span class="ml-0.5 rounded px-1 text-[10px] font-bold ${d.parity === 'odd' ? 'bg-amber-200 text-amber-900 dark:bg-amber-800/70 dark:text-amber-100' : 'bg-sky-200 text-sky-900 dark:bg-sky-800/70 dark:text-sky-100'}">${escapeHtml(t(`parity.short.${d.parity}`))}</span></td>
      <td class="tabular py-1 pr-2">${escapeHtml(d.arrival ?? '—')}–${escapeHtml(d.plannedLeave ?? '—')}</td>
      <td class="tabular py-1 pr-2 text-right">${formatMinutes(d.plannedWorked ?? 0)} h</td>
      <td class="py-1 text-xs ${fixed ? 'font-semibold text-violet-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400'}">${escapeHtml(t(fixed ? 'tag.fixedDay' : 'onboarding.preview.computed'))}</td>
    </tr>`;
  }).join('');
  return `
    <div class="${card} mt-4" aria-live="polite">
      <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">${escapeHtml(t('onboarding.preview.title', { month: formatMonthYear(SAMPLE_MONTH.year, SAMPLE_MONTH.month) }))}</p>
      <table class="mt-1 w-full text-sm"><tbody>${rows}</tbody></table>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('onboarding.preview.summary', {
    fund: formatMinutes(summary.fund), average: summary.averageRegular != null ? formatMinutes(summary.averageRegular) : '—',
  }))}</p>
    </div>`;
}

function renderPreview() {
  const el = $('#ob-preview');
  if (el) el.innerHTML = previewHtml();
}

// ---------------------------------------------------------------------------
// Kroky
// ---------------------------------------------------------------------------
const heading = (key, params) => `<h2 data-ob-heading tabindex="-1" class="text-xl font-bold outline-none">${escapeHtml(t(key, params))}</h2>`;
const radio = (name, value, checked, label, desc = '') => `
  <label class="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-slate-200 has-[:checked]:bg-indigo-50 has-[:checked]:ring-2 has-[:checked]:ring-indigo-500 dark:ring-slate-700 dark:has-[:checked]:bg-indigo-950/50">
    <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} class="mt-1 h-4 w-4 text-indigo-600">
    <span><span class="block font-medium">${escapeHtml(label)}</span>${desc ? `<span class="block text-sm text-slate-500 dark:text-slate-400">${escapeHtml(desc)}</span>` : ''}</span>
  </label>`;

function stepWelcome() {
  const lang = getLanguage();
  const { records, withdrawals, settings } = ctx.getState();
  const holidays = lang === 'cs' ? '' : `
    <fieldset class="mt-5 space-y-2">
      <legend class="font-semibold">${escapeHtml(t('holidays.askTitle'))}</legend>
      <p class="${muted}">${escapeHtml(t('holidays.askText'))}</p>
      ${radio('ob-holidays', 'keep', draftHolidays, t('holidays.keep'), t('onboarding.welcome.holidaysKeep'))}
      ${radio('ob-holidays', 'off', !draftHolidays, t('holidays.turnOff'), t('onboarding.welcome.holidaysOff'))}
      ${records.length ? '<div id="ob-holiday-impact"></div>' : ''}
    </fieldset>`;
  const html = `
    ${heading('onboarding.welcome.title')}
    <p class="mt-2 ${muted}">${escapeHtml(t('onboarding.welcome.text'))}</p>
    <fieldset class="mt-5 space-y-2">
      <legend class="font-semibold">${escapeHtml(t('lang.label'))}</legend>
      <div class="grid grid-cols-2 gap-2">
        ${LANGUAGES.map((l) => radio('ob-lang', l, l === lang, t(`lang.${l}`))).join('')}
      </div>
    </fieldset>
    ${holidays}`;
  return {
    html,
    after() {
      const el = $('#ob-holiday-impact');
      if (el) {
        const current = ctx.getState().app.czHolidays !== false;
        if (draftHolidays === current) el.hidden = true;
        else renderImpact(el, holidayChangeImpact({ records, withdrawals, settings, enabled: draftHolidays }));
      }
    },
  };
}

function stepAnchor() {
  const examples = Object.keys(SETTINGS_EXAMPLES).map((key) => `
    <div class="${card}">
      <p class="font-semibold">${escapeHtml(t(`onboarding.example.${key}.title`))}</p>
      <p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">${escapeHtml(t(`onboarding.example.${key}.text`))}</p>
      <button type="button" data-ob-example="${key}" class="mt-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/60">${escapeHtml(t('onboarding.example.use'))}</button>
    </div>`).join('');
  return {
    html: `
      ${heading('onboarding.anchor.title')}
      <p class="mt-2 ${muted}">${escapeHtml(t('onboarding.anchor.text'))}</p>
      <fieldset class="mt-4 space-y-2">
        <legend class="sr-only">${escapeHtml(t('settings.anchorKind'))}</legend>
        ${radio('ob-anchor', 'arrival', draft.anchorMode === 'arrival', t('onboarding.anchor.arrival'), t('onboarding.anchor.arrivalDesc'))}
        ${radio('ob-anchor', 'departure', draft.anchorMode === 'departure', t('onboarding.anchor.departure'), t('onboarding.anchor.departureDesc'))}
      </fieldset>
      <label class="mt-3 block max-w-[12rem]"><span class="text-sm font-medium text-slate-600 dark:text-slate-400">${escapeHtml(t(draft.anchorMode === 'arrival' ? 'onboarding.anchor.arrivalTime' : 'onboarding.anchor.departureTime'))}</span>
        <input type="time" data-time24 data-ob-field="anchorTime" value="${escapeHtml(draft.anchorTime)}" class="tabular ${field}"></label>
      <h3 class="mt-6 font-semibold">${escapeHtml(t('onboarding.example.title'))}</h3>
      <p class="text-sm text-slate-500 dark:text-slate-400">${escapeHtml(t('onboarding.example.hint'))}</p>
      <div class="mt-2 grid gap-2 sm:grid-cols-3">${examples}</div>
      <div id="ob-preview"></div>`,
  };
}

function stepRules() {
  const r = draftRules;
  const rules = rulesFromSettings(previewSettings());
  const err = rulesError();
  const hasRecords = ctx.getState().records.length > 0;
  return {
    html: `
      ${heading('onboarding.rules.title')}
      <p class="mt-2 ${muted}">${escapeHtml(t('onboarding.rules.text'))}</p>
      <div class="mt-4 grid grid-cols-3 gap-3">
        <label class="block"><span class="text-sm font-medium text-slate-600 dark:text-slate-400">${escapeHtml(t('settings.dailyFund'))}</span>
          <input type="number" min="0.25" max="24" step="0.25" inputmode="decimal" data-ob-rule="dailyFundHours" value="${r.dailyFundHours}" class="tabular ${field}"></label>
        <label class="block"><span class="text-sm font-medium text-slate-600 dark:text-slate-400">${escapeHtml(t('settings.breakAfter'))}</span>
          <input type="number" min="0.25" max="24" step="0.25" inputmode="decimal" data-ob-rule="breakAfterHours" value="${r.breakAfterHours}" class="tabular ${field}"></label>
        <label class="block"><span class="text-sm font-medium text-slate-600 dark:text-slate-400">${escapeHtml(t('settings.breakLength'))}</span>
          <input type="number" min="0" max="600" step="5" inputmode="numeric" data-ob-rule="breakLengthMinutes" value="${r.breakLengthMinutes}" class="tabular ${field}"></label>
      </div>
      <p id="ob-rules-text" class="mt-3 ${muted}">${err ? '' : escapeHtml(t('onboarding.rules.explain', {
    rule: describeBreakRule(rules), fund: formatMinutes(rules.DAILY_FUND_MIN), stay: formatMinutes(stayForWorked(rules.DAILY_FUND_MIN, rules)),
  }))}</p>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('onboarding.rules.defaults'))}${hasRecords ? ` ${escapeHtml(t('onboarding.rules.fromToday'))}` : ''}</p>
      <p id="ob-rules-error" class="mt-2 text-sm text-red-600 dark:text-red-400" ${err ? '' : 'hidden'}>${err ? escapeHtml(t(err)) : ''}</p>
      <div id="ob-preview"></div>`,
  };
}

function stepSchedule() {
  const rows = [1, 2, 3, 4, 5].map((day) => `
    <tr class="border-t border-slate-100 dark:border-slate-800">
      <th scope="row" class="py-1.5 pr-2 text-left font-medium">${escapeHtml(weekdayName(day))}</th>
      ${['odd', 'even'].map((week) => `
      <td class="py-1.5 pl-1"><label class="block"><span class="sr-only">${escapeHtml(t('schedule.srDeparture', { day: weekdayName(day), parity: t(`parity.${week}`) }))}</span>
        <input type="time" data-time24 data-optional data-empty-label-key="onboarding.schedule.none" data-ob-week="${week}" data-ob-day="${day}" value="${escapeHtml(draft.schedule[week][day].leaveAt)}" class="tabular w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"></label></td>`).join('')}
    </tr>`).join('');
  return {
    html: `
      ${heading('onboarding.schedule.title')}
      <p class="mt-2 ${muted}">${escapeHtml(t('onboarding.schedule.text'))}</p>
      <table class="mt-3 w-full text-sm">
        <thead><tr class="text-xs uppercase text-slate-500 dark:text-slate-400"><th></th>
          <th class="pb-1 pl-1 text-left font-semibold">${escapeHtml(t('schedule.oddWeek'))} (${escapeHtml(t('parity.short.odd'))})</th>
          <th class="pb-1 pl-1 text-left font-semibold">${escapeHtml(t('schedule.evenWeek'))} (${escapeHtml(t('parity.short.even'))})</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('onboarding.schedule.later'))}</p>
      <div id="ob-preview"></div>`,
  };
}

function stepParity() {
  const today = todayStr();
  const { week } = isoWeek(today);
  const parity = weekParity(today, draft.parityFlip);
  return {
    html: `
      ${heading('onboarding.parity.title')}
      <p class="mt-2 ${muted}">${escapeHtml(t('onboarding.parity.text'))}</p>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${parity === 'odd' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'}">
          ${escapeHtml(t('week.badge', { week, parity: t(`parity.${parity}`) }))}</span>
        <button type="button" data-ob-flip class="rounded-xl px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800" aria-pressed="${draft.parityFlip}">⇄ ${escapeHtml(t('week.flipTitle'))}</button>
      </div>
      <p class="mt-3 ${muted}">${escapeHtml(t(draft.parityFlip ? 'onboarding.parity.flipped' : 'onboarding.parity.iso'))}</p>
      <p class="mt-3 ${muted}">${escapeHtml(t('onboarding.parity.badges'))}</p>`,
  };
}

function stepRecord() {
  const items = ['buttons', 'more', 'undo', 'today', 'shortcuts', 'offline'];
  return {
    html: `
      ${heading('onboarding.record.title')}
      <ul class="mt-3 space-y-2">
        ${items.map((k) => `<li class="${card} text-sm"><span class="font-semibold">${escapeHtml(t(`onboarding.record.${k}.title`))}</span>
          <span class="block text-slate-600 dark:text-slate-300">${escapeHtml(t(`onboarding.record.${k}.text`))}</span></li>`).join('')}
      </ul>`,
  };
}

function stepDone() {
  const s = previewSettings();
  const fixedDays = ['odd', 'even'].reduce((n, w) => n + [1, 2, 3, 4, 5].filter((d) => s.schedule[w][d].leaveAt).length, 0);
  const summary = [
    t(s.anchorMode === 'arrival' ? 'onboarding.done.anchorArrival' : 'onboarding.done.anchorDeparture', { time: s.anchorTime }),
    t('onboarding.done.rules', { fund: formatMinutes(hoursToMinutes(s.dailyFundHours)), minutes: s.breakLengthMinutes, after: formatMinutes(hoursToMinutes(s.breakAfterHours)) }),
    t('onboarding.done.fixedDays', { count: fixedDays }),
    t(draftHolidays ? 'onboarding.done.holidaysOn' : 'onboarding.done.holidaysOff'),
  ];
  return {
    html: `
      ${heading('onboarding.done.title')}
      <p class="mt-2 ${muted}">${escapeHtml(t('onboarding.done.text'))}</p>
      <ul class="mt-3 list-inside list-disc space-y-1 text-sm">${summary.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      <button type="button" data-ob-plan class="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700">${escapeHtml(t('onboarding.done.openPlan'))}</button>
      <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t('onboarding.done.again'))}</p>`,
  };
}

const RENDER = {
  welcome: stepWelcome, anchor: stepAnchor, rules: stepRules, schedule: stepSchedule, parity: stepParity, record: stepRecord, done: stepDone,
};

// ---------------------------------------------------------------------------
// Vykreslení a navigace
// ---------------------------------------------------------------------------
function render({ focus = true } = {}) {
  const name = STEPS[step];
  const { html, after } = RENDER[name]();
  const body = $('#ob-body');
  body.innerHTML = html;
  enhanceTimeInputs(body);
  renderPreview();
  after?.();
  // ukazatel kroků: text + body (aktuální krok má aria-current, není jen barvou)
  $('#ob-step-text').textContent = t('onboarding.stepOf', { step: step + 1, total: STEPS.length });
  $('#ob-steps').innerHTML = STEPS.map((s, i) => `
    <li class="flex-1"><span class="block h-1.5 rounded-full ${i <= step ? 'bg-indigo-600 dark:bg-indigo-400' : 'bg-slate-200 dark:bg-slate-700'}" ${i === step ? 'aria-current="step"' : ''}></span>
      <span class="sr-only">${escapeHtml(t(`onboarding.stepName.${s}`))}${i < step ? ` (${escapeHtml(t('onboarding.stepDone'))})` : ''}</span></li>`).join('');
  $('#ob-back').hidden = step === 0;
  $('#ob-skip').hidden = step === STEPS.length - 1;
  $('#ob-next').textContent = t(step === STEPS.length - 1 ? 'onboarding.finish' : 'onboarding.next');
  $('#ob-next').disabled = name === 'rules' && Boolean(rulesError());
  if (focus) body.querySelector('[data-ob-heading]')?.focus();
}

function go(delta) {
  step = Math.min(STEPS.length - 1, Math.max(0, step + delta));
  render();
  $('#dlg-onboarding').scrollTop = 0;
}

/** Uloží koncept (Hotovo). Pravidla výpočtu se při existující docházce mění až od dneška. */
function finish({ openPlan = false } = {}) {
  const { settings, records, app } = ctx.getState();
  const current = normalizeSettings(settings);
  let next = normalizeSettings({ ...draft, ruleVersions: current.ruleVersions });
  if (isRuleChange(current, draftRules)) {
    next = applyRuleChange(next, draftRules, records.length ? todayStr() : RULES_SINCE_EVER);
  }
  ctx.saveSettings(next);
  if (draftHolidays !== (app.czHolidays !== false)) ctx.saveHolidays(draftHolidays);
  ctx.saveApp({ onboardingDone: true });
  $('#dlg-onboarding').close();
  toast(t('onboarding.saved'));
  if (openPlan) ctx.goToPlan();
}

/** Přeskočit (nebo zavřít): nic se neuloží kromě příznaku, že průvodce proběhl. */
function skip() {
  ctx.saveApp({ onboardingDone: true });
  $('#dlg-onboarding').close();
  toast(t('onboarding.skipped'));
}

function onInput(e) {
  const el = e.target;
  if (el.name === 'ob-lang' && el.checked) {
    ctx.changeLanguage(el.value, { ask: false }); // dotaz na svátky je přímo v tomto kroku
    return;
  }
  if (el.name === 'ob-holidays' && el.checked) {
    draftHolidays = el.value === 'keep';
    render({ focus: false });
    return;
  }
  if (el.name === 'ob-anchor' && el.checked) {
    draft = normalizeSettings({ ...draft, anchorMode: el.value });
    render({ focus: false });
    return;
  }
  if (el.dataset.obField) draft = normalizeSettings({ ...draft, [el.dataset.obField]: el.value });
  if (el.dataset.obWeek) {
    const { obWeek: week, obDay: day } = el.dataset;
    draft.schedule[week][day] = { ...draft.schedule[week][day], leaveAt: el.value };
  }
  if (el.dataset.obRule) {
    draftRules = { ...draftRules, [el.dataset.obRule]: el.valueAsNumber };
    const err = rulesError();
    const errEl = $('#ob-rules-error');
    errEl.hidden = !err;
    errEl.textContent = err ? t(err) : '';
    $('#ob-next').disabled = Boolean(err);
    if (!err) {
      const rules = rulesFromSettings(previewSettings());
      $('#ob-rules-text').textContent = t('onboarding.rules.explain', {
        rule: describeBreakRule(rules), fund: formatMinutes(rules.DAILY_FUND_MIN), stay: formatMinutes(stayForWorked(rules.DAILY_FUND_MIN, rules)),
      });
    }
  }
  renderPreview();
}

export function initOnboarding(context) {
  ctx = context;
  const dlg = $('#dlg-onboarding');
  $('#ob-next').addEventListener('click', () => (step === STEPS.length - 1 ? finish() : go(1)));
  $('#ob-back').addEventListener('click', () => go(-1));
  $('#ob-skip').addEventListener('click', skip);
  $('#ob-body').addEventListener('change', onInput);
  $('#ob-body').addEventListener('input', (e) => { if (e.target.dataset.obRule) onInput(e); });
  $('#ob-body').addEventListener('click', (e) => {
    const example = e.target.closest('[data-ob-example]');
    if (example) {
      draft = applyExample(draft, example.dataset.obExample);
      render({ focus: false });
      toast(t('onboarding.example.applied', { name: t(`onboarding.example.${example.dataset.obExample}.title`) }));
      return;
    }
    if (e.target.closest('[data-ob-flip]')) {
      draft = { ...draft, parityFlip: !draft.parityFlip };
      render({ focus: false });
      return;
    }
    if (e.target.closest('[data-ob-plan]')) finish({ openPlan: true });
  });
  // Escape = přeskočit (průvodce jde kdykoli znovu spustit otazníkem v horní liště)
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    skip();
  });
  onLanguageChange((lang) => {
    if (!dlg.open) return;
    // v češtině se na svátky neptáme – volba se vrátí na uložený stav
    if (lang === 'cs') draftHolidays = ctx.getState().app.czHolidays !== false;
    render({ focus: false });
  });
}

/** Otevře průvodce s konceptem z aktuálního nastavení. */
export function openOnboarding() {
  const { settings, app } = ctx.getState();
  draft = normalizeSettings(settings);
  draftRules = Object.fromEntries(RULE_FIELDS.map((k) => [k, draft[k]]));
  draftHolidays = app.czHolidays !== false;
  step = 0;
  render();
  $('#dlg-onboarding').showModal();
  $('#ob-body').querySelector('[data-ob-heading]')?.focus();
}

