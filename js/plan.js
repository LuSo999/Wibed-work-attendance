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
  formatMinutes, rulesForDate, bankBalance, configureHolidays, holidaysEnabled, dayFund,
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
  /**
   * Pevnost kotvy: 'hard' = kotva drží (dřívější chování), 'soft' = kotvu lze posunout, když měsíc
   * jinak nejde vyrovnat, 'off' = kotva se nepoužívá, běžné dny mají jen cílové hodiny.
   */
  anchorStrength: 'hard',
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
  /**
   * Přenášet přesčasy mezi měsíci: true = banka je součet celé historie, false = každý měsíc
   * začíná na nule (zůstatek = přesčasy a čerpání jen v daném měsíci).
   */
  carryOverOvertime: true,
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

/** Pevnost kotvy v nastavení; výjimka dne smí jen uvolnit ('soft' | 'off'). */
export const ANCHOR_STRENGTHS = ['hard', 'soft', 'off'];
export const RELAX_VALUES = ['soft', 'off'];

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
    // nastavení bez pole (starší data) = pevná kotva
    anchorStrength: ANCHOR_STRENGTHS.includes(raw.anchorStrength) ? raw.anchorStrength : 'hard',
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
    // nastavení bez pole (starší data) = přenos zapnutý
    carryOverOvertime: raw.carryOverOvertime !== false,
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
export function ruleChangeImpact({ records, withdrawals = [], settings, next, asOf = null }) {
  const before = rulesFromSettings(normalizeSettings(settings));
  const after = rulesFromSettings(normalizeSettings(next));
  return historyImpact(records, withdrawals, { rules: before }, { rules: after }, balanceMonth(settings, asOf));
}

/**
 * Období zůstatku banky: bez přenosu přesčasů měsíc data ('YYYY-MM'), jinak null (celá historie).
 * @param {object} settings nastavení plánu
 * @param {string|null} date 'YYYY-MM-DD' (typicky dnešek nebo datum výběru)
 */
export function balanceMonth(settings, date) {
  if (normalizeSettings(settings).carryOverOvertime || !date) return null;
  return date.slice(0, 7);
}

/**
 * Dopad zapnutí/vypnutí státních svátků na historii (svátky platí vždy zpětně).
 * Konfiguraci svátků v calc.js dočasně přepne a vrátí do původního stavu.
 */
export function holidayChangeImpact({ records, withdrawals = [], settings, enabled, asOf = null }) {
  const rules = rulesFromSettings(normalizeSettings(settings));
  return historyImpact(records, withdrawals, { rules, holidays: holidaysEnabled() }, { rules, holidays: Boolean(enabled) }, balanceMonth(settings, asOf));
}

/** Porovná výsledky uzavřených dnů a banky ve dvou konfiguracích {rules, holidays?}; month = zůstatek jen za měsíc. */
function historyImpact(records, withdrawals, before, after, month = null) {
  const was = holidaysEnabled();
  const run = ({ rules, holidays = was }) => {
    configureHolidays({ enabled: holidays });
    return { days: records.map((r) => safeDayResult(r, rules)), balance: bankBalance(records, withdrawals, rules, { month }) };
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

/**
 * Rozloží `amount` minut na dny rovnoměrně po 15 min (sign > 0 přidává, < 0 ubírá) až po mez
 * `limit(day)`; zbytek pod 15 min dostane den nejblíže středu, který ho ještě unese.
 * Mění day.plannedWorked, vrací minuty, které se nevešly.
 */
function spread(list, amount, sign, limit) {
  const room = (x) => Math.max(0, sign > 0 ? limit(x) - x.plannedWorked : x.plannedWorked - limit(x));
  const caps = list.map((x) => Math.floor(room(x) / PLAN_STEP_MIN));
  const { alloc, left } = distribute(Math.floor(amount / PLAN_STEP_MIN), caps);
  list.forEach((x, i) => { x.plannedWorked += sign * alloc[i] * PLAN_STEP_MIN; });
  let rest = (amount % PLAN_STEP_MIN) + left * PLAN_STEP_MIN;
  if (rest > 0) {
    const mid = (list.length - 1) / 2;
    const order = list.map((x, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    for (const i of order) {
      const give = Math.min(room(list[i]), rest);
      list[i].plannedWorked += sign * give;
      rest -= give;
      if (!rest) break;
    }
  }
  return rest;
}

/** Nejkratší pobyt aspoň `minStay`, který dá aspoň `worked` odpracovaných minut. */
function stayCovering(worked, rules, minStay) {
  let stay = Math.max(minStay, stayForWorked(worked, rules));
  while (workedForStay(stay, rules) < worked && stay < 1440) stay++;
  return stay;
}

/**
 * Časy dne s uvolněnou kotvou (2. průchod). Přebytek: den drží celou povinnou dobu a kotevní konec
 * se posune k ní (příchod později / odchod dřív). Nedostatek: druhý konec zůstane z 1. průchodu
 * (na hranici) a kotevní konec se posune ven (příchod dřív / odchod později).
 */
function relaxEnds(x, sign) {
  const { coreStart, coreEnd } = x.bounds;
  const pass1Stay = stayForWorked(x.pass1, x.rules);
  const stay = sign < 0 ? stayCovering(x.plannedWorked, x.rules, coreEnd - coreStart) : stayForWorked(x.plannedWorked, x.rules);
  if (x.flex === 'leave') {
    // kotva = příchod
    x.relaxedLeave = sign < 0 ? coreEnd : x.fixedTime + pass1Stay;
    x.relaxedArrival = x.relaxedLeave - stay;
  } else {
    // kotva = odchod
    x.relaxedArrival = sign < 0 ? coreStart : x.fixedTime - pass1Stay;
    x.relaxedLeave = x.relaxedArrival + stay;
  }
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
  // konec doplněný kotvou (jen ten se dá uvolnit; skutečný příchod, výjimka a rozvrh zůstávají pevné)
  let anchored = null;
  if (s.anchorMode === 'arrival' && arr === null) {
    arr = parseTime(s.anchorTime);
    anchored = 'arrival';
  } else if (s.anchorMode === 'departure' && lv === null) {
    lv = parseTime(s.anchorTime);
    anchored = 'leave';
  }
  return {
    arr, lv, actualArrival: actualArr !== null, explicitArrival, explicitLeave, cleared, schedule: sched, anchored,
  };
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
  if (ov.anchorStrength != null && !RELAX_VALUES.includes(ov.anchorStrength)) return { error: msg('plan.error.anchorStrength'), warnings };
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
    && !ov.clearFixed && !ov.anchorStrength && !(ov.note ?? '').trim();
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
 * Hromadné uvolnění kotvy v rozsahu dat: výjimky anchorStrength ('soft' | 'off') pro dnešní
 * a budoucí pracovní dny, jejichž jeden konec určuje kotva (ne rozvrh). Ostatní pole výjimek zůstávají.
 * Vrací [{date, before, after}] – before umožní akci jedním krokem vrátit.
 */
export function bulkRelaxAnchor({ from, to, strength, today, settings, overrides = [] }) {
  if (!parseDate(from) || !parseDate(to) || !RELAX_VALUES.includes(strength)) return [];
  const s = normalizeSettings(settings);
  const ovMap = new Map(overrides.map((o) => [o.date, o]));
  const ops = [];
  let date = from < today ? today : from;
  for (let i = 0; date <= to && i < 400; i++, date = addDaysStr(date, 1)) {
    if (!isWorkday(date)) continue;
    const before = ovMap.get(date) ?? null;
    // jen dny, kde kotva určuje konec a druhý konec není pevný (plně pevné dny z rozvrhu se neuvolňují)
    const ends = dayEnds(date, s, { override: before });
    const relaxable = ends.anchored === 'arrival' ? !ends.explicitLeave : ends.anchored === 'leave' && !ends.explicitArrival;
    if (!relaxable || before?.anchorStrength === strength) continue;
    ops.push({ date, before, after: { ...(before ?? {}), date, anchorStrength: strength } });
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
      // pevnost kotvy: výjimka dne > nastavení; jen když pevný konec doplnila kotva
      day.anchorStrength = ends.anchored ? (RELAX_VALUES.includes(ov?.anchorStrength) ? ov.anchorStrength : s.anchorStrength) : 'hard';
      // nejkratší den pokrývá celou povinnou dobu (po odečtení přestávky podle pravidla)
      const coreMin = absMin > 0 ? 0 : workedForStay(Math.max(0, coreEnd - coreStart), dayRules);
      const windowMax = Math.min(maxWorked, workedForStay(Math.max(0, latest - Math.max(0, earliest)), dayRules));
      if (day.anchorStrength === 'off') {
        // kotva vypnutá: jen cílové hodiny v mezích povinné doby, maxima a hranic (časy se neplánují)
        day.window = { arriveBy: s.coreStart, leaveFrom: s.coreEnd };
        const base = Math.min(Math.max(0, fundDay - absMin), windowMax);
        day.base = base;
        day.min = Math.min(coreMin, base);
        day.max = Math.max(windowMax, base);
        day.plannedWorked = base;
      } else {
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
        if (day.anchorStrength === 'soft') {
          // meze pro 2. průchod: celá povinná doba / celé okno mezi hranicemi
          day.relaxMin = Math.min(coreMin, day.min);
          day.relaxMax = Math.max(windowMax, day.max);
          day.bounds = { earliest: Math.max(0, earliest), latest, coreStart, coreEnd };
        }
      }
    }
  }

  // Deficit = fond − (skutečnost + pevné dny + základy běžných dnů)
  const fund = monthFund(year, month, rules);
  const regular = days.filter((x) => x.kind === 'regular');
  const totalCredited = () => days.reduce((sum, x) => sum + (x.plannedWorked !== null && x.kind !== 'absence' ? x.plannedWorked + x.absence : x.credited), 0);
  const deficit = fund - totalCredited();
  let unbalanced = deficit;

  if (deficit !== 0 && regular.length) {
    // 1. průchod: posun nefixovaného konce v mezích dne (min/max)
    const sign = Math.sign(deficit);
    unbalanced = sign * spread(regular, Math.abs(deficit), sign, (x) => (sign > 0 ? x.max : x.min)) || 0;
    // 2. průchod (kotva „kolem“): zbytek se rozloží posunem kotevního konce až na hranici povinné doby
    //    (přebytek), resp. až na nejdřívější příchod / nejpozdější odchod (nedostatek)
    const soft = regular.filter((x) => x.anchorStrength === 'soft');
    if (unbalanced !== 0 && soft.length) {
      for (const x of soft) x.pass1 = x.plannedWorked;
      const limit = (x) => (sign > 0 ? x.relaxMax : x.relaxMin);
      unbalanced = sign * spread(soft, Math.abs(unbalanced), sign, limit) || 0;
      for (const x of soft) {
        if (x.plannedWorked === x.pass1) continue;
        x.relaxed = true;
        relaxEnds(x, sign);
      }
    }
  }

  // Časy příchodu a odchodu, varování
  for (const x of days) {
    if (x.plannedWorked === null || x.kind === 'absence') continue;
    if (x.window) {
      // kotva vypnutá: místo časů povolené okno a cílové hodiny
      x.arrival = null;
      x.plannedLeave = null;
      x.credited = x.plannedWorked + x.absence;
      continue;
    }
    if (x.relaxed) {
      x.plannedArrivalMin = x.relaxedArrival;
      x.plannedLeaveMin = x.relaxedLeave;
    } else if (x.kind === 'regular' || x.kind === 'override') {
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

/**
 * Doporučení „Měsíc nelze vyrovnat kvůli pevné kotvě. Uvolnit na zbývající dny?“
 *
 * Vrací null, pokud je měsíc vyrovnaný. Jinak spočítá plán s výjimkami anchorStrength: 'soft'
 * pro zbývající běžné dny s pevnou kotvou a porovná zbytek:
 *   { helps: true, before, after, balanced, changed: [datum…], ops: [{date, before, after}] }
 *   { helps: false, reason: 'noDays' | 'noEffect' | 'alreadyRelaxed', before }
 * (before/after = nevyrovnané minuty, balanced = o kolik minut se měsíc přiblíží k nule).
 */
export function anchorRelaxSuggestion({ year, month, today, settings, records, overrides = [] }) {
  const plan = buildMonthPlan({ year, month, today, settings, records, overrides });
  const before = plan.summary.unbalanced;
  if (!before) return null;
  const s = normalizeSettings(settings);
  const regular = plan.days.filter((d) => d.kind === 'regular');
  const candidates = regular.filter((d) => d.anchorStrength === 'hard' && dayEnds(d.date, s, { override: d.override, record: d.record }).anchored);
  if (!candidates.length) {
    // kotva zbývajících dnů už je uvolněná → není co nabízet; jinak zbývají jen pevné dny
    return { helps: false, reason: regular.some((d) => d.anchorStrength !== 'hard') ? 'alreadyRelaxed' : 'noDays', before };
  }
  const ops = candidates.map((d) => ({ date: d.date, before: d.override ?? null, after: { ...(d.override ?? {}), date: d.date, anchorStrength: 'soft' } }));
  const changedOvs = new Map(ops.map((o) => [o.date, o.after]));
  const next = buildMonthPlan({
    year, month, today, settings, records, overrides: [...overrides.filter((o) => !changedOvs.has(o.date)), ...changedOvs.values()],
  });
  const after = next.summary.unbalanced;
  if (Math.abs(after) >= Math.abs(before)) return { helps: false, reason: 'noEffect', before };
  const changed = next.days.filter((d) => d.relaxed).map((d) => d.date);
  return {
    helps: true, before, after, balanced: Math.abs(before) - Math.abs(after), changed, ops,
  };
}

// ---------------------------------------------------------------------------
// Úvodní průvodce: příklady nastavení a ukázka plánu
// ---------------------------------------------------------------------------

/** Vzorový měsíc pro ukázku plánu: únor 2027 (20 pracovních dnů, bez svátků, 1. 2. je pondělí lichého týdne). */
export const SAMPLE_MONTH = Object.freeze({ year: 2027, month: 2, today: '2027-02-01' });

const emptyWeek = () => Object.fromEntries(WORKDAYS.map((d) => [d, { arriveAt: '', leaveAt: '' }]));
const withLeave = (days, time) => ({ ...emptyWeek(), ...Object.fromEntries(days.map((d) => [d, { arriveAt: '', leaveAt: time }])) });

/**
 * Příklady pro průvodce („Použít tento příklad“). Mění kotvu, hranice a rozvrh,
 * pravidla výpočtu (fond, přestávka) nechávají beze změny. Texty jsou ve slovnících (onboarding.example.*).
 */
export const SETTINGS_EXAMPLES = Object.freeze({
  // vyzvedávání dítěte ze školky: pevný odchod 14:00, v lichém týdnu po + st, v sudém út + čt
  kindergarten: { anchorMode: 'arrival', anchorTime: '06:00', schedule: { odd: withLeave([1, 3], '14:00'), even: withLeave([2, 4], '14:00') } },
  // dojíždění na pevný spoj: každý den pevný odchod 15:10, příchod se dopočítá (nejdříve 05:30)
  commute: { anchorMode: 'departure', anchorTime: '15:10', earliestArrival: '05:30', schedule: { odd: emptyWeek(), even: emptyWeek() } },
  // běžná pracovní doba bez pevných dnů: příchod 07:00, odchod se dopočítá
  regular: { anchorMode: 'arrival', anchorTime: '07:00', schedule: { odd: emptyWeek(), even: emptyWeek() } },
});

/** Nastavení po použití příkladu (pravidla výpočtu zůstávají). */
export function applyExample(settings, key) {
  const example = SETTINGS_EXAMPLES[key];
  if (!example) return normalizeSettings(settings);
  return normalizeSettings({ ...normalizeSettings(settings), ...example });
}

/** Ukázka plánu na vzorovém měsíci (bez docházky): prvních `days` pracovních dnů a souhrn. */
export function samplePlan(settings, { days = 10 } = {}) {
  const { year, month, today } = SAMPLE_MONTH;
  const plan = buildMonthPlan({ year, month, today, settings, records: [], overrides: [] });
  return { days: plan.days.filter((d) => d.workday).slice(0, days), summary: plan.summary, warnings: plan.warnings };
}

// ---------------------------------------------------------------------------
// Karta „Dnes“: vynulování banky a postup dne
// ---------------------------------------------------------------------------

/**
 * Odchod, při kterém dnešní den vynuluje banku přesčasů.
 *
 * Cílová odpracovaná doba = denní fond − nepřítomnost dne − zůstatek banky (bez dnešního
 * rozpracovaného dne, včetně výběrů); u náhradního volna se jeho hodiny čerpají z banky,
 * proto se od cíle neodečítají. Odchod = příchod + stayForWorked(cíl).
 * Příchod je skutečný, jinak plánovaný (estimated = odhad). Překročení hranic je jen varování.
 *
 * @param {object} p
 * @param {string} p.date            'YYYY-MM-DD'
 * @param {object} p.settings        nastavení plánu (pravidla a hranice)
 * @param {number} p.balance         zůstatek banky v minutách bez dnešního dne
 * @param {string|null} p.arrival    příchod 'HH:MM' (skutečný nebo plánovaný)
 * @param {boolean} [p.estimated]    příchod je jen plánovaný
 * @param {number} [p.absenceMinutes] částečná nepřítomnost dne
 * @param {string|null} [p.absenceType] typ nepřítomnosti (u 'comp' se hodiny čerpají z banky)
 * @param {string|null} [p.fixedLeave] pevný plánovaný odchod dne → spočítá i banku po něm
 * @returns {{fund, target, arrival, estimated, leave: string|null,
 *   status: 'noArrival'|'leaveNow'|'earlier'|'stay'|'even', bankAfterFixed: number|null, warnings: Array}}
 */
export function bankZeroing({
  date, settings, balance, arrival = null, estimated = false, absenceMinutes = 0, absenceType = null, fixedLeave = null,
}) {
  const s = normalizeSettings(settings);
  const rules = rulesForDate(rulesFromSettings(s), date);
  const fund = dayFund(date, rules);
  const drawn = absenceType === DAY_TYPES.COMP ? absenceMinutes : 0;
  const target = fund - absenceMinutes + drawn - balance;
  const arr = arrival ? parseTime(arrival) : null;
  const result = {
    fund, target, arrival: arr === null ? null : arrival, estimated: Boolean(estimated) && arr !== null, leave: null, status: 'noArrival', bankAfterFixed: null, warnings: [],
  };
  if (arr === null) return result;
  const leave = target <= 0 ? arr : arr + stayForWorked(target, rules);
  result.status = target <= 0 ? 'leaveNow' : balance > 0 ? 'earlier' : balance < 0 ? 'stay' : 'even';
  if (leave > 1439) {
    result.warnings.push(msg('plan.warn.leaveAfterMidnight'));
  } else {
    result.leave = toTimeString(leave);
    result.warnings.push(...timeWarnings(null, leave, s));
  }
  const fixed = fixedLeave ? parseTime(fixedLeave) : null;
  if (fixed !== null) {
    const worked = workedForStay(Math.max(0, fixed - arr), rules);
    result.bankAfterFixed = balance + worked + absenceMinutes - drawn - fund;
  }
  return result;
}

/**
 * Postup dne ke fondu.
 *
 * - worked: odpracováno od příchodu do teď podle pravidla přestávky (na hranici intervalu
 *   se přestávka odečte celá, číslo proto skočí dolů),
 * - percent (ukazatel): je-li znám plánovaný odchod, podíl uplynulého pobytu z plánovaného
 *   pobytu (odchod − příchod), 0–100 – s časem nikdy neklesá; jinak worked / goal, ale nejméně
 *   minPercent (volající předá poslední vykreslenou hodnotu stejného dne, aby ukazatel neklesl),
 * - breakNote: zpráva {key, params} o přestávce – před jejím odečtením kdy se odečte, potom kolik
 *   je v čísle započteno (null, pokud pravidlo přestávku nemá),
 * - remaining: minuty do plánovaného odchodu (záporné = po něm).
 *
 * @param {object} p { date, settings, arrival 'HH:MM', now (minuty od půlnoci), absenceMinutes,
 *   leave 'HH:MM'|null, minPercent }
 */
export function dayProgress({
  date, settings, arrival, now, absenceMinutes = 0, leave = null, minPercent = 0,
}) {
  const rules = rulesForDate(rulesFromSettings(normalizeSettings(settings)), date);
  const arr = parseTime(arrival);
  const lv = leave ? parseTime(leave) : null;
  const goal = Math.max(0, dayFund(date, rules) - absenceMinutes);
  const remaining = lv === null ? null : lv - now;
  if (arr === null) return { worked: 0, goal, percent: 0, remaining, breakNote: null };

  // příchod „v budoucnu“ (např. po půlnoci) = zatím žádný pobyt
  const stay = Math.max(0, now - arr);
  const worked = workedForStay(stay, rules);
  const clamp = (v) => Math.min(100, Math.max(0, Math.round(v)));
  const percent = lv !== null && lv > arr
    ? clamp((stay / (lv - arr)) * 100)
    : Math.max(clamp(goal > 0 ? (worked / goal) * 100 : 100), Math.min(100, minPercent));

  let breakNote = null;
  if (rules.BREAK_MIN > 0 && rules.BREAK_INTERVAL_MIN > 0) {
    const deducted = breakMinutes(stay, rules);
    if (deducted > 0) {
      breakNote = msg('progress.breakIncluded', { minutes: formatMinutes(deducted) });
    } else {
      const at = arr + rules.BREAK_INTERVAL_MIN;
      const params = { minutes: formatMinutes(rules.BREAK_MIN), after: formatMinutes(rules.BREAK_INTERVAL_MIN) };
      breakNote = at <= 1439
        ? msg('progress.breakPending', { ...params, time: toTimeString(at) })
        : msg('progress.breakPendingNoTime', params);
    }
  }
  return { worked, goal, percent, remaining, breakNote };
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
