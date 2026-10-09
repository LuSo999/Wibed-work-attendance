/**
 * Plánování docházky na měsíc – čisté výpočty bez DOM a Firebase.
 *
 * Plán se nikam neukládá: vždy se znovu spočítá z nastavení uživatele,
 * výjimek dnů a skutečné docházky. Cílem je, aby měsíc vyšel přesně do fondu
 * (banka přesčasů se do plánu nezahrnuje).
 *
 * Jednotky: minuty (integer), data 'YYYY-MM-DD', časy 'HH:MM'.
 * Hodnoty v hodinách (dailyFundHours, absenceHours, workedHours…) jsou čísla v hodinách.
 */
import {
  DAY_TYPES, isAbsenceType, breakMinutes, parseTime, toTimeString, parseDate, daysInMonth,
  toDateString, isWorkday, holidayName, weekday, monthFund, safeDayResult, hoursToMinutes,
  formatMinutes, rulesForDate, bankBalance, configureHolidays, holidaysEnabled,
} from './calc.js';

/** Krok rozložení deficitu. */
export const PLAN_STEP_MIN = 15;

const WORKDAYS = [1, 2, 3, 4, 5];

/**
 * Zprávy (chyby, varování, popisy změn) se vrací jako {key, params} – překládá je UI.
 * Varování porušení pevné pracovní doby mají klíče z CORE_WARNING_KEYS.
 */
export const CORE_WARNING_KEYS = new Set(['plan.warn.arrivalAfterCore', 'plan.warn.leaveBeforeCore', 'plan.warn.core']);
const msg = (key, params) => (params ? { key, params } : { key });

/** Výchozí nastavení plánu (users/{uid}/settings/plan). */
export const DEFAULT_SETTINGS = Object.freeze({
  /** Kotva plánu: 'arrival' = pevný příchod a dopočítává se odchod, 'departure' = naopak. */
  anchorMode: 'arrival',
  /** Čas kotvy (příchod, resp. odchod). */
  anchorTime: '06:00',
  /** Hranice plánovače v obou režimech. */
  earliestArrival: '05:00',
  latestDeparture: '17:00',
  coreStart: '09:00',
  coreEnd: '14:00',
  dailyFundHours: 8,
  maxWorkedHoursPerDay: 10,
  /** Přestávka: za každých celých breakAfterHours pobytu se odečte breakLengthMinutes. */
  breakAfterHours: 6,
  breakLengthMinutes: 30,
  parityFlip: false,
  /** Rozvrh: pro každý den lichého/sudého týdne volitelný pevný příchod a odchod. */
  schedule: {
    odd: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { arriveAt: '', leaveAt: '' }])),
    even: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { arriveAt: '', leaveAt: '' }])),
  },
});

const validTime = (v, fallback) => (parseTime(v) === null ? fallback : v);
const validHours = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 24 ? Number(v) : fallback);
/** 'HH:MM' → minuty, prázdné/neplatné → null. */
const t = (v) => (v ? parseTime(v) : null);

/** Den rozvrhu: dřívější formát byl jen řetězec s časem odchodu. */
function normalizeScheduleDay(v) {
  if (typeof v === 'string' || v == null) return { arriveAt: '', leaveAt: validTime(v, '') };
  return { arriveAt: validTime(v.arriveAt, ''), leaveAt: validTime(v.leaveAt, '') };
}

/** Nejstarší „platí od“ – verze platná odjakživa. */
export const RULES_SINCE_EVER = '0000-01-01';
const RULE_FIELDS = ['dailyFundHours', 'breakAfterHours', 'breakLengthMinutes'];

/** Platná sada pravidel výpočtu (fond a přestávka); neplatné hodnoty → výchozí. */
function normalizeRuleValues(raw = {}) {
  const d = DEFAULT_SETTINGS;
  // Přestávka musí být kratší než interval, jinak by delší pobyt nedal víc práce.
  let breakAfterHours = validHours(raw.breakAfterHours, d.breakAfterHours);
  let breakLengthMinutes = Number(raw.breakLengthMinutes ?? d.breakLengthMinutes);
  if (!Number.isInteger(breakLengthMinutes) || breakLengthMinutes < 0 || breakLengthMinutes >= hoursToMinutes(breakAfterHours)) {
    breakAfterHours = d.breakAfterHours;
    breakLengthMinutes = d.breakLengthMinutes;
  }
  return { dailyFundHours: validHours(raw.dailyFundHours, d.dailyFundHours), breakAfterHours, breakLengthMinutes };
}

/**
 * Verze pravidel s datem platnosti, seřazené; první platí odjakživa.
 * Starší nastavení bez verzí = jedna verze z hodnot na nejvyšší úrovni.
 */
function normalizeRuleVersions(raw) {
  const list = Array.isArray(raw.ruleVersions) && raw.ruleVersions.length
    ? raw.ruleVersions.map((v) => ({ from: parseDate(v?.from) ? v.from : RULES_SINCE_EVER, ...normalizeRuleValues(v) }))
    : [{ from: RULES_SINCE_EVER, ...normalizeRuleValues(raw) }];
  list.sort((a, b) => a.from.localeCompare(b.from));
  list[0].from = RULES_SINCE_EVER;
  // stejné datum platnosti → platí poslední zadaná
  return list.filter((v, i) => i === list.length - 1 || list[i + 1].from !== v.from);
}

/** Doplní chybějící nebo neplatné hodnoty nastavení výchozími. */
export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const schedule = { odd: {}, even: {} };
  for (const week of ['odd', 'even']) {
    for (const day of WORKDAYS) schedule[week][day] = normalizeScheduleDay(raw.schedule?.[week]?.[day]);
  }
  const ruleVersions = normalizeRuleVersions(raw);
  // hodnoty na nejvyšší úrovni = aktuálně platná (poslední) verze
  const { dailyFundHours, breakAfterHours, breakLengthMinutes } = ruleVersions[ruleVersions.length - 1];
  return {
    anchorMode: raw.anchorMode === 'departure' ? 'departure' : 'arrival',
    // startTime = dřívější název pro čas příchodu
    anchorTime: validTime(raw.anchorTime ?? raw.startTime, d.anchorTime),
    earliestArrival: validTime(raw.earliestArrival, d.earliestArrival),
    latestDeparture: validTime(raw.latestDeparture, d.latestDeparture),
    coreStart: validTime(raw.coreStart, d.coreStart),
    coreEnd: validTime(raw.coreEnd, d.coreEnd),
    dailyFundHours,
    maxWorkedHoursPerDay: validHours(raw.maxWorkedHoursPerDay, d.maxWorkedHoursPerDay),
    breakAfterHours,
    breakLengthMinutes,
    ruleVersions,
    parityFlip: Boolean(raw.parityFlip),
    schedule,
  };
}

/** Denní fond v minutách z nastavení. */
export function dailyFundMinutes(settings) {
  return hoursToMinutes(settings.dailyFundHours);
}

const toCalcRules = (v) => ({
  DAILY_FUND_MIN: hoursToMinutes(v.dailyFundHours),
  BREAK_INTERVAL_MIN: hoursToMinutes(v.breakAfterHours),
  BREAK_MIN: v.breakLengthMinutes,
});

/**
 * Pravidla pro calc.js z nastavení: aktuální hodnoty na nejvyšší úrovni
 * a verze s datem platnosti (calc.rulesForDate vybere verzi podle dne).
 */
export function rulesFromSettings(settings) {
  const versions = (settings.ruleVersions?.length ? settings.ruleVersions : [{ from: RULES_SINCE_EVER, ...settings }])
    .map((v) => ({ from: v.from, ...toCalcRules(v) }));
  const { from, ...current } = versions[versions.length - 1];
  return { ...current, versions };
}

/**
 * Změna pravidel výpočtu s datem platnosti: verze od `from` dál se nahradí novou.
 * from = RULES_SINCE_EVER přepíše pravidla zpětně pro všechna data.
 */
export function applyRuleChange(settings, patch, from = RULES_SINCE_EVER) {
  const s = normalizeSettings(settings);
  const current = s.ruleVersions[s.ruleVersions.length - 1];
  const values = normalizeRuleValues({ ...current, ...patch });
  const kept = s.ruleVersions.filter((v) => v.from < from);
  return normalizeSettings({ ...s, ruleVersions: [...kept, { from, ...values }] });
}

/** Mění patch pravidla výpočtu (fond nebo přestávku)? */
export function isRuleChange(settings, patch) {
  return RULE_FIELDS.some((f) => f in patch && Number(patch[f]) !== Number(settings[f]));
}

/**
 * Dopad změny pravidel na historii: zůstatek banky před a po a počet uzavřených
 * dnů, jejichž výsledek se změní.
 */
export function ruleChangeImpact({ records, withdrawals = [], settings, next }) {
  const before = rulesFromSettings(normalizeSettings(settings));
  const after = rulesFromSettings(normalizeSettings(next));
  return historyImpact(records, withdrawals, { rules: before }, { rules: after });
}

/**
 * Dopad zapnutí/vypnutí státních svátků na historii (svátky platí vždy zpětně).
 * Konfiguraci svátků v calc.js dočasně přepne a vrátí do původního stavu.
 */
export function holidayChangeImpact({ records, withdrawals = [], settings, enabled }) {
  const rules = rulesFromSettings(normalizeSettings(settings));
  return historyImpact(records, withdrawals, { rules, holidays: holidaysEnabled() }, { rules, holidays: Boolean(enabled) });
}

/** Porovná výsledky uzavřených dnů a banky ve dvou konfiguracích {rules, holidays?}. */
function historyImpact(records, withdrawals, before, after) {
  const was = holidaysEnabled();
  const run = ({ rules, holidays = was }) => {
    configureHolidays({ enabled: holidays });
    return { days: records.map((r) => safeDayResult(r, rules)), balance: bankBalance(records, withdrawals, rules) };
  };
  try {
    const a = run(before);
    const b = run(after);
    const affectedDays = a.days.filter((x, i) => x.complete && (x.credited !== b.days[i].credited || x.bankDelta !== b.days[i].bankDelta)).length;
    return { balanceBefore: a.balance, balanceAfter: b.balance, affectedDays };
  } finally {
    configureHolidays({ enabled: was });
  }
}

// ---------------------------------------------------------------------------
// Varování (upozornění, ne zákazy)
// ---------------------------------------------------------------------------

/** Varování pro odchod před koncem pevné pracovní doby. */
export function leaveWarning(leaveAt, settings) {
  if (!leaveAt || parseTime(leaveAt) === null) return null;
  return parseTime(leaveAt) < parseTime(settings.coreEnd) ? msg('plan.warn.core') : null;
}

/** Varování pro příchod po začátku pevné pracovní doby. */
export function arrivalWarning(arrival, settings) {
  if (!arrival || parseTime(arrival) === null) return null;
  return parseTime(arrival) > parseTime(settings.coreStart) ? msg('plan.warn.core') : null;
}

/**
 * Varování pro konkrétní příchod a odchod (minuty, null = neznámý):
 * pevná pracovní doba a hranice plánovače. Jen upozornění.
 */
export function timeWarnings(arrival, leave, settings, { skipCore = false } = {}) {
  const list = [];
  const a = arrival === null ? null : toTimeString(arrival);
  const l = leave === null ? null : toTimeString(leave);
  if (!skipCore && a && arrivalWarning(a, settings)) list.push(msg('plan.warn.arrivalAfterCore', { time: a, core: settings.coreStart }));
  if (!skipCore && l && leaveWarning(l, settings)) list.push(msg('plan.warn.leaveBeforeCore', { time: l, core: settings.coreEnd }));
  if (a && arrival < parseTime(settings.earliestArrival)) list.push(msg('plan.warn.beforeEarliest', { time: a, limit: settings.earliestArrival }));
  if (l && leave > parseTime(settings.latestDeparture)) list.push(msg('plan.warn.afterLatest', { time: l, limit: settings.latestDeparture }));
  if (a && l && leave <= arrival) list.push(msg('plan.warn.leaveNotAfterArrival'));
  return list;
}

/** Všechna varování nastavení: [{field, week?, day?, message}]. */
export function settingsWarnings(settings) {
  const list = [];
  const anchor = parseTime(settings.anchorTime);
  const anchorArr = settings.anchorMode === 'arrival' ? anchor : null;
  const anchorLv = settings.anchorMode === 'departure' ? anchor : null;
  for (const message of timeWarnings(anchorArr, anchorLv, settings)) list.push({ field: 'anchorTime', message });
  if (parseTime(settings.coreEnd) <= parseTime(settings.coreStart)) {
    list.push({ field: 'coreEnd', message: msg('plan.warn.coreOrder') });
  }
  if (parseTime(settings.latestDeparture) <= parseTime(settings.earliestArrival)) {
    list.push({ field: 'latestDeparture', message: msg('plan.warn.boundsOrder') });
  }
  for (const week of ['odd', 'even']) {
    for (const day of WORKDAYS) {
      const { arriveAt, leaveAt } = settings.schedule[week][day];
      for (const message of timeWarnings(t(arriveAt), t(leaveAt), settings)) {
        list.push({ field: 'schedule', week, day, message });
      }
    }
  }
  return list;
}

/**
 * Přepnutí kotvy: vrátí nové nastavení a popis změn pro upozornění uživatele.
 * Čas kotvy se převede tak, aby běžný den zůstal stejný
 * (příchod 06:00 ↔ odchod 14:30 při fondu 8 h a přestávce 30 min).
 */
export function switchAnchorMode(settings, mode) {
  const s = normalizeSettings(settings);
  if (mode === s.anchorMode) return { settings: s, changes: [] };
  const rules = rulesFromSettings(s);
  const stay = stayForWorked(rules.DAILY_FUND_MIN, rules);
  const old = parseTime(s.anchorTime);
  const converted = mode === 'departure' ? Math.min(1439, old + stay) : Math.max(0, old - stay);
  const next = { ...s, anchorMode: mode, anchorTime: toTimeString(converted) };
  const toDep = mode === 'departure';
  const count = (pred) => ['odd', 'even'].reduce((n, w) => n + WORKDAYS.filter((d) => pred(s.schedule[w][d])).length, 0);
  const onlyLeave = count((x) => x.leaveAt && !x.arriveAt);
  const onlyArrive = count((x) => x.arriveAt && !x.leaveAt);
  const both = count((x) => x.arriveAt && x.leaveAt);
  const p = { time: next.anchorTime, old: s.anchorTime, stay: formatMinutes(stay) };
  const changes = [
    msg(toDep ? 'plan.switch.toDeparture' : 'plan.switch.toArrival', p),
    toDep
      ? msg('plan.switch.shiftArrival', { limit: s.earliestArrival })
      : msg('plan.switch.shiftLeave', { limit: s.latestDeparture }),
  ];
  if (onlyLeave) {
    changes.push(msg(toDep ? 'plan.switch.onlyLeaveToDep' : 'plan.switch.onlyLeaveToArr', { ...p, count: onlyLeave }));
  }
  if (onlyArrive) {
    changes.push(msg(toDep ? 'plan.switch.onlyArriveToDep' : 'plan.switch.onlyArriveToArr', { ...p, count: onlyArrive }));
  }
  if (both) changes.push(msg('plan.switch.both', { count: both }));
  return { settings: next, changes };
}

// ---------------------------------------------------------------------------
// ISO týden a parita
// ---------------------------------------------------------------------------

/** ISO 8601 týden: {year, week}. */
export function isoWeek(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // po = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // čtvrtek téhož týdne
  const year = date.getUTCFullYear();
  const week = 1 + Math.floor((date - Date.UTC(year, 0, 1)) / 86_400_000 / 7);
  return { year, week };
}

/** Parita týdne dne: 'odd' | 'even' (parityFlip prohodí). */
export function weekParity(dateStr, parityFlip = false) {
  const odd = isoWeek(dateStr).week % 2 === 1;
  return odd !== Boolean(parityFlip) ? 'odd' : 'even';
}

/** Pevné časy z rozvrhu pro datum: {arriveAt, leaveAt} ('' = nezadáno). */
export function scheduledDay(dateStr, settings) {
  const wd = weekday(dateStr);
  if (wd < 1 || wd > 5) return { arriveAt: '', leaveAt: '' };
  return normalizeScheduleDay(settings.schedule[weekParity(dateStr, settings.parityFlip)][wd]);
}

/** Pevný odchod z rozvrhu pro datum ('' = nezadáno). */
export function scheduledLeave(dateStr, settings) {
  return scheduledDay(dateStr, settings).leaveAt;
}

// ---------------------------------------------------------------------------
// Převody pobyt ↔ odpracováno
// ---------------------------------------------------------------------------

/** Odpracováno z pobytu (pobyt − přestávka). */
export function workedForStay(stay, rules) {
  return stay > 0 ? stay - breakMinutes(stay, rules) : 0;
}

/**
 * Nejmenší pobyt, který dá alespoň `worked` odpracovaných minut.
 * Převod je kvůli přestávce nemonotónní (6:00 pobytu = 5:30 práce),
 * proto se hledá nejmenší vyhovující pobyt.
 */
export function stayForWorked(worked, rules) {
  if (!(worked > 0)) return 0;
  let stay = worked;
  // pojistka: při přestávce kratší než interval se cíl vždy najde do dvojnásobku
  while (workedForStay(stay, rules) < worked && stay < worked * 2 + 1440) stay++;
  return stay;
}

// ---------------------------------------------------------------------------
// Rovnoměrné rozložení
// ---------------------------------------------------------------------------

/** Indexy k prvků rovnoměrně rozprostřených v poli délky n. */
function spreadIndices(n, k) {
  return Array.from({ length: k }, (_, i) => Math.floor(((i + 0.5) * n) / k));
}

/**
 * Rozdělí `units` jednotek mezi dny s kapacitami `caps` co nejrovnoměrněji.
 * Zbytek po rovnoměrném dělení jde na dny rozprostřené přes celé období.
 * Vrací {alloc, left}.
 */
function distribute(units, caps) {
  const alloc = caps.map(() => 0);
  let left = units;
  while (left > 0) {
    const eligible = caps.map((c, i) => i).filter((i) => caps[i] - alloc[i] > 0);
    if (!eligible.length) break;
    const per = Math.floor(left / eligible.length);
    if (per > 0) {
      for (const i of eligible) {
        const give = Math.min(per, caps[i] - alloc[i]);
        alloc[i] += give;
        left -= give;
      }
    } else {
      for (const idx of spreadIndices(eligible.length, left)) alloc[eligible[idx]] += 1;
      left = 0;
    }
  }
  return { alloc, left };
}

// ---------------------------------------------------------------------------
// Plán měsíce
// ---------------------------------------------------------------------------

/** Nepřítomnost dne ze záznamu nebo výjimky: {type, minutes|null (celý den)} nebo null. */
function absenceOf(source, fund) {
  const type = source?.absenceType ?? source?.type;
  if (!source || !isAbsenceType(type)) return null;
  const h = source.absenceHours;
  if (h == null || h === '') return { type, minutes: null };
  const minutes = hoursToMinutes(h);
  return { type, minutes: minutes >= fund ? null : Math.max(0, minutes) };
}

const CLEAR_VALUES = ['arrival', 'leave', 'both'];
const clearsArrival = (c) => c === 'arrival' || c === 'both';
const clearsLeave = (c) => c === 'leave' || c === 'both';

/** Sloučí dvě hodnoty clearFixed ('arrival' + 'leave' = 'both'). */
export function mergeClearFixed(a, b) {
  const arr = clearsArrival(a) || clearsArrival(b);
  const lv = clearsLeave(a) || clearsLeave(b);
  return arr && lv ? 'both' : arr ? 'arrival' : lv ? 'leave' : null;
}

/**
 * Konce dne (minuty): skutečný příchod > výjimka (arriveAt/leaveAt) >
 * rozvrh (pokud ho výjimka nezrušila přes clearFixed) > kotva. Druhý konec null = dopočítá se.
 * clearFixed ruší jen časy z rozvrhu, ne kotvu z nastavení.
 */
export function dayEnds(date, settings, { override = null, record = null } = {}) {
  const s = settings;
  const sched = scheduledDay(date, s);
  const clear = override?.clearFixed ?? null;
  const actualArr = record?.arrival ? parseTime(record.arrival) : null;
  let arr = actualArr ?? t(override?.arriveAt) ?? (clearsArrival(clear) ? null : t(sched.arriveAt));
  let lv = t(override?.leaveAt) ?? (clearsLeave(clear) ? null : t(sched.leaveAt));
  const explicitArrival = arr !== null && actualArr === null;
  const explicitLeave = lv !== null;
  // zrušený pevný čas, který rozvrh skutečně měl (a výjimka ho nenahradila)
  const cleared = mergeClearFixed(
    clearsArrival(clear) && sched.arriveAt && !override?.arriveAt && actualArr === null ? 'arrival' : null,
    clearsLeave(clear) && sched.leaveAt && !override?.leaveAt ? 'leave' : null,
  );
  if (s.anchorMode === 'arrival') arr ??= parseTime(s.anchorTime);
  else lv ??= parseTime(s.anchorTime);
  return { arr, lv, actualArrival: actualArr !== null, explicitArrival, explicitLeave, cleared, schedule: sched };
}

export const NOTE_MAX = 200;

/**
 * Kontrola výjimky dne: {error, warnings}. Odchod musí být po příchodu;
 * porušení pevné doby a hranic je jen upozornění.
 */
export function validateOverride(ov, settings) {
  const s = normalizeSettings(settings);
  const warnings = [];
  if ((ov.note ?? '').length > NOTE_MAX) return { error: msg('plan.error.noteTooLong', { max: NOTE_MAX }), warnings };
  if (ov.clearFixed != null && !CLEAR_VALUES.includes(ov.clearFixed)) return { error: msg('plan.error.clearFixed'), warnings };
  if (ov.absenceType && ov.absenceHours != null && ov.absenceHours !== '' && !(Number(ov.absenceHours) > 0)) {
    return { error: msg('error.absenceHoursPositive'), warnings };
  }
  if (ov.workedHours != null && ov.workedHours !== '' && !(Number(ov.workedHours) >= 0 && Number(ov.workedHours) <= 24)) {
    return { error: msg('plan.error.workedHours'), warnings };
  }
  for (const [field, key] of [['arriveAt', 'error.invalidArrival'], ['leaveAt', 'error.invalidDeparture']]) {
    if (ov[field] && parseTime(ov[field]) === null) return { error: msg(key), warnings };
  }
  const { arr, lv } = dayEnds(ov.date, s, { override: ov });
  const fixedHours = ov.workedHours != null && ov.workedHours !== '';
  if (!fixedHours && arr !== null && lv !== null && lv <= arr) {
    return { error: msg('plan.error.leaveBeforeArrival', { leave: toTimeString(lv), arrival: toTimeString(arr) }), warnings };
  }
  warnings.push(...timeWarnings(ov.arriveAt ? arr : null, ov.leaveAt ? lv : null, s).filter((w) => w.key !== 'plan.warn.leaveNotAfterArrival'));
  if (fixedHours && ov.arriveAt && ov.leaveAt) warnings.push(msg('plan.warn.hoursAndTimes'));
  return { error: null, warnings };
}

/**
 * Lze den v plánu upravit výjimkou? Jen dnešní a budoucí pracovní den bez uzavřené docházky;
 * proběhlé dny (a uzavřený dnešek) se upravují v docházce.
 */
export function canEditOverride(day, today) {
  return Boolean(day) && day.date >= today && day.workday && day.plannedWorked !== null;
}

/** Je výjimka prázdná (nic nemění)? Takovou je lepší smazat. */
export function isEmptyOverride(ov) {
  return !ov.absenceType && !ov.arriveAt && !ov.leaveAt && (ov.workedHours == null || ov.workedHours === '')
    && !ov.clearFixed && !(ov.note ?? '').trim();
}

function addDaysStr(dateStr, delta) {
  const { y, m, d } = parseDate(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return toDateString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Hromadné zrušení pevných časů z rozvrhu v rozsahu dat (jen dnešní a budoucí
 * pracovní dny, které v rozvrhu daný pevný čas mají).
 * Vrací [{date, before, after}] – before umožní akci jedním krokem vrátit.
 */
export function bulkClearFixed({ from, to, what, today, settings, overrides = [] }) {
  if (!parseDate(from) || !parseDate(to) || !CLEAR_VALUES.includes(what)) return [];
  const s = normalizeSettings(settings);
  const ovMap = new Map(overrides.map((o) => [o.date, o]));
  const ops = [];
  let date = from < today ? today : from;
  for (let i = 0; date <= to && i < 400; i++, date = addDaysStr(date, 1)) {
    if (!isWorkday(date)) continue;
    const sched = scheduledDay(date, s);
    const relevant = mergeClearFixed(clearsArrival(what) && sched.arriveAt ? 'arrival' : null, clearsLeave(what) && sched.leaveAt ? 'leave' : null);
    if (!relevant) continue;
    const before = ovMap.get(date) ?? null;
    const clearFixed = mergeClearFixed(before?.clearFixed, relevant);
    if (before && before.clearFixed === clearFixed) continue;
    ops.push({ date, before, after: { ...(before ?? {}), date, clearFixed } });
  }
  return ops;
}

/**
 * Spočítá plán měsíce.
 *
 * @param {object} p
 * @param {number} p.year
 * @param {number} p.month         1–12
 * @param {string} p.today         'YYYY-MM-DD'
 * @param {object} p.settings      nastavení uživatele
 * @param {Array}  p.records       záznamy docházky
 * @param {Array}  [p.overrides]   výjimky dnů {date, absenceType, absenceHours, arriveAt, leaveAt, workedHours}
 * @returns {{days: Array, summary: object, warnings: Array<{key, params}>}}
 *
 * Každý dnešní/budoucí pracovní den má příchod a odchod. Prázdný konec na straně
 * kotvy (anchorMode) se doplní kotvou, druhý se dopočítá. Den s oběma konci je pevný.
 *
 * Druhy dnů (day.kind):
 *   'done'     proběhlý den se skutečností       'filled'   doplněná docházka
 *   'missing'  proběhlý pracovní den bez záznamu 'absence'  celodenní nepřítomnost
 *   'fixed'    oba konce pevné (hodiny dané)     'override' výjimka s pevnými hodinami
 *   'regular'  běžný den – jeden konec se posouvá 'off'      víkend / svátek
 * day.flex = 'arrival' | 'leave' určuje posouvaný konec běžného dne.
 */
export function buildMonthPlan({ year, month, today, settings, records, overrides = [] }) {
  const s = normalizeSettings(settings);
  const rules = rulesFromSettings(s);
  const maxWorked = hoursToMinutes(s.maxWorkedHoursPerDay);
  const earliest = parseTime(s.earliestArrival);
  const latest = Math.min(1439, parseTime(s.latestDeparture));
  const coreStart = parseTime(s.coreStart);
  const coreEnd = parseTime(s.coreEnd);
  const recMap = new Map(records.map((r) => [r.date, r]));
  const ovMap = new Map(overrides.map((o) => [o.date, o]));
  const days = [];

  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = toDateString(year, month, d);
    const rec = recMap.get(date);
    const ov = ovMap.get(date) ?? null;
    const workday = isWorkday(date);
    const res = rec ? safeDayResult(rec, rules) : null;
    const { week } = isoWeek(date);
    // pravidla platná pro tento den (verze s datem platnosti)
    const dayRules = rulesForDate(rules, date);
    const fundDay = dayRules.DAILY_FUND_MIN;
    const day = {
      date,
      week,
      parity: weekParity(date, s.parityFlip),
      workday,
      holiday: holidayName(date), // klíč svátku ve slovníku nebo null
      record: rec ?? null,
      override: ov,
      type: rec?.type ?? ov?.absenceType ?? (workday ? DAY_TYPES.WORK : null),
      kind: 'off',
      arrival: rec?.arrival ?? null,
      absence: 0,
      plannedWorked: null,
      plannedLeave: null,
      actual: res && (res.complete || res.credited) ? res.credited : null,
      credited: 0,
      note: ov?.note?.trim() || '',
      warnings: [],
    };
    Object.defineProperty(day, 'rules', { value: dayRules }); // pro převody, mimo výstup
    days.push(day);

    const upcoming = date >= today;

    // 1) Uzavřený záznam (minulý, dnešní i předem zadaný) = skutečnost.
    if (res?.complete) {
      day.credited = res.credited;
      day.absence = res.absence;
      day.kind = rec.filled ? 'filled' : (isAbsenceType(rec.type) && !res.partial && workday ? 'absence' : 'done');
      continue;
    }
    if (!workday) {
      day.credited = res?.credited ?? 0;
      continue;
    }
    // 2) Proběhlý pracovní den bez uzavřeného záznamu.
    if (!upcoming) {
      day.kind = 'missing';
      day.credited = res?.credited ?? 0;
      continue;
    }

    // 3) Dnešek a budoucí dny.
    const absence = absenceOf(rec, fundDay) ?? absenceOf(ov, fundDay);
    if (absence) day.type = absence.type;
    if (absence && absence.minutes === null) {
      day.kind = 'absence';
      day.absence = fundDay;
      day.credited = fundDay;
      day.plannedWorked = 0;
      day.arrival = null;
      continue;
    }
    const absMin = absence?.minutes ?? 0;
    day.absence = absMin;

    // Konce dne: skutečný příchod > výjimka > rozvrh (nezrušený) > kotva; druhý konec se dopočítá.
    const ends = dayEnds(date, s, { override: ov, record: rec });
    const actualArr = ends.actualArrival ? ends.arr : null;
    const { arr, lv } = ends;
    day.actualArrival = ends.actualArrival;
    day.explicitArrival = ends.explicitArrival;
    day.explicitLeave = ends.explicitLeave;
    day.clearedFixed = ends.cleared;

    const fixedWorked = ov?.workedHours != null && ov.workedHours !== '' ? hoursToMinutes(ov.workedHours) : null;

    if (fixedWorked !== null) {
      // Výjimka s pevnými hodinami: posouvá se konec na opačné straně než kotva.
      day.kind = 'override';
      day.plannedWorked = fixedWorked;
      day.flex = arr !== null && (lv === null || s.anchorMode === 'arrival') ? 'leave' : 'arrival';
      day.fixedTime = day.flex === 'leave' ? arr : lv;
    } else if (arr !== null && lv !== null) {
      // Oba konce pevné. Částečná nepřítomnost proběhne uvnitř okna (před prací),
      // pracovní blok se o ni zkrátí – není-li zaznamenaný skutečný příchod.
      const workStart = actualArr !== null ? arr : arr + absMin;
      day.kind = 'fixed';
      day.plannedWorked = workedForStay(Math.max(0, lv - workStart), dayRules);
      day.plannedArrivalMin = workStart;
      day.plannedLeaveMin = lv;
    } else {
      // Běžný den: jeden konec pevný, druhý se posouvá v hranicích.
      day.kind = 'regular';
      day.flex = lv === null ? 'leave' : 'arrival';
      day.fixedTime = day.flex === 'leave' ? arr : lv;
      const maxStay = day.flex === 'leave' ? latest - arr : lv - Math.max(0, earliest);
      const coreStay = day.flex === 'leave' ? coreEnd - arr : lv - coreStart;
      const cap = Math.min(maxWorked, workedForStay(Math.max(0, maxStay), dayRules));
      const base = Math.min(Math.max(0, fundDay - absMin), cap);
      day.base = base;
      day.min = absMin > 0 ? 0 : Math.min(workedForStay(Math.max(0, coreStay), dayRules), base);
      day.max = Math.max(cap, base);
      day.plannedWorked = base;
    }
  }

  // Deficit = fond − (skutečnost + pevné dny + základy běžných dnů)
  const fund = monthFund(year, month, rules);
  const regular = days.filter((x) => x.kind === 'regular');
  const totalCredited = () => days.reduce((sum, x) => sum + (x.plannedWorked !== null && x.kind !== 'absence' ? x.plannedWorked + x.absence : x.credited), 0);
  const deficit = fund - totalCredited();
  let unbalanced = 0;

  if (deficit !== 0 && regular.length) {
    const sign = Math.sign(deficit);
    const amount = Math.abs(deficit);
    const caps = regular.map((x) => Math.floor((sign > 0 ? x.max - x.base : x.base - x.min) / PLAN_STEP_MIN));
    const { alloc, left } = distribute(Math.floor(amount / PLAN_STEP_MIN), caps);
    regular.forEach((x, i) => { x.plannedWorked += sign * alloc[i] * PLAN_STEP_MIN; });
    // Zbytek pod 15 min dostane den nejblíže středu, který ho ještě unese → přesně na nulu.
    let rest = (amount % PLAN_STEP_MIN) + left * PLAN_STEP_MIN;
    if (rest > 0) {
      const mid = (regular.length - 1) / 2;
      const order = regular.map((x, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const i of order) {
        const x = regular[i];
        const room = sign > 0 ? x.max - x.plannedWorked : x.plannedWorked - x.min;
        const give = Math.min(room, rest);
        x.plannedWorked += sign * give;
        rest -= give;
        if (!rest) break;
      }
    }
    unbalanced = sign * rest;
  } else {
    unbalanced = deficit;
  }

  // Časy příchodu a odchodu, varování
  for (const x of days) {
    if (x.plannedWorked === null || x.kind === 'absence') continue;
    if (x.kind === 'regular' || x.kind === 'override') {
      const stay = stayForWorked(x.plannedWorked, x.rules);
      x.plannedArrivalMin = x.flex === 'leave' ? x.fixedTime : x.fixedTime - stay;
      x.plannedLeaveMin = x.flex === 'leave' ? x.fixedTime + stay : x.fixedTime;
    }
    const a = x.plannedArrivalMin;
    const l = x.plannedLeaveMin;
    x.arrival = a >= 0 && a <= 1439 ? toTimeString(a) : null;
    x.plannedLeave = l >= 0 && l <= 1439 ? toTimeString(l) : null;
    if (a < 0) x.warnings.push(msg('plan.warn.arrivalBeforeMidnight'));
    if (l > 1439) x.warnings.push(msg('plan.warn.leaveAfterMidnight'));
    x.warnings.push(...timeWarnings(x.arrival ? a : null, x.plannedLeave ? l : null, s, { skipCore: x.absence > 0 }));
    x.credited = x.plannedWorked + x.absence;
  }

  // Souhrn
  const upcomingDays = days.filter((x) => x.plannedWorked !== null);
  const worked = days.filter((x) => x.plannedWorked === null).reduce((sum, x) => sum + x.credited, 0);
  const planRemaining = upcomingDays.reduce((sum, x) => sum + x.credited, 0);
  const projected = worked + planRemaining;
  const regularWorked = regular.reduce((sum, x) => sum + x.plannedWorked, 0);
  const warnings = [];
  const depMode = s.anchorMode === 'departure';
  if (unbalanced > 0) {
    warnings.push(msg(depMode ? 'plan.warn.shortDep' : 'plan.warn.shortArr', {
      hours: formatMinutes(unbalanced), max: formatMinutes(maxWorked), limit: depMode ? s.earliestArrival : s.latestDeparture,
    }));
  } else if (unbalanced < 0) {
    warnings.push(msg(depMode ? 'plan.warn.surplusDep' : 'plan.warn.surplusArr', {
      hours: formatMinutes(-unbalanced), limit: depMode ? s.coreStart : s.coreEnd,
    }));
  }
  const missing = days.filter((x) => x.kind === 'missing').length;
  if (missing) warnings.push(msg('plan.warn.missingDays', { count: missing }));

  return {
    days,
    warnings,
    summary: {
      fund,
      worked,
      planRemaining,
      projected,
      deviation: projected - fund,
      unbalanced,
      regularDays: regular.length,
      averageRegular: regular.length ? Math.round(regularWorked / regular.length) : null,
      missingDays: missing,
    },
  };
}

// ---------------------------------------------------------------------------
// Doplnění docházky
// ---------------------------------------------------------------------------

/**
 * Vytvoří záznam, se kterým den vyjde přesně do fondu.
 * Pobyt = nejmenší pobyt pro (fond − nepřítomnost). V režimu kotvy „příchod“ (nebo při
 * zaznamenaném příchodu) se dopočítá odchod, v režimu „odchod“ se dopočítá příchod.
 * Vrací nový záznam s filled: true, nebo null, není-li co doplnit.
 */
export function fillRecord(date, record, settings, override = null) {
  const s = normalizeSettings(settings);
  const rules = rulesForDate(rulesFromSettings(s), date);
  const fundDay = rules.DAILY_FUND_MIN;
  const res = record ? safeDayResult(record, rules) : null;
  if (res?.complete || !isWorkday(date)) return null;

  const absence = absenceOf(record, fundDay) ?? absenceOf(override, fundDay);
  const note = record?.note ?? '';
  if (absence && absence.minutes === null) {
    return { date, type: absence.type, arrival: null, departure: null, absenceHours: null, note, filled: true };
  }
  const absMin = absence?.minutes ?? 0;
  const stay = stayForWorked(fundDay - absMin, rules);
  const ends = dayEnds(date, s, { override, record });
  let arrival;
  let departure;
  if (ends.actualArrival || s.anchorMode === 'arrival' || ends.explicitArrival) {
    // známý příchod (záznam, výjimka, rozvrh nebo kotva) + pobyt
    arrival = ends.arr ?? parseTime(s.anchorTime);
    departure = arrival + stay;
  } else {
    // kotva odchodu: příchod se dopočítá zpět od odchodu
    departure = ends.lv;
    arrival = departure - stay;
  }
  if (arrival < 0 || departure > 1439) return null;
  return {
    date,
    type: absence?.type ?? DAY_TYPES.WORK,
    arrival: toTimeString(arrival),
    departure: toTimeString(departure),
    absenceHours: absence ? absMin / 60 : null,
    note,
    filled: true,
  };
}

/** Proběhlé pracovní dny měsíce bez uzavřeného záznamu a jejich doplnění. */
export function fillCandidates({ year, month, today, settings, records, overrides = [] }) {
  const recMap = new Map(records.map((r) => [r.date, r]));
  const ovMap = new Map(overrides.map((o) => [o.date, o]));
  const list = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = toDateString(year, month, d);
    if (date >= today) break;
    const filled = fillRecord(date, recMap.get(date), settings, ovMap.get(date));
    if (filled) list.push({ date, before: recMap.get(date) ?? null, record: filled });
  }
  return list;
}
