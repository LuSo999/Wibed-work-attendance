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
  formatMinutes,
} from './calc.js';

/** Krok rozložení deficitu. */
export const PLAN_STEP_MIN = 15;

const WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKDAY_NAMES = { 1: 'Pondělí', 2: 'Úterý', 3: 'Středa', 4: 'Čtvrtek', 5: 'Pátek' };
export const CORE_WARNING = 'Porušuješ pevnou pracovní dobu.';

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

export const ANCHOR_LABELS = { arrival: 'Příchod', departure: 'Odchod' };

const validTime = (v, fallback) => (parseTime(v) === null ? fallback : v);
const validHours = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 24 ? Number(v) : fallback);
/** 'HH:MM' → minuty, prázdné/neplatné → null. */
const t = (v) => (v ? parseTime(v) : null);

/** Den rozvrhu: dřívější formát byl jen řetězec s časem odchodu. */
function normalizeScheduleDay(v) {
  if (typeof v === 'string' || v == null) return { arriveAt: '', leaveAt: validTime(v, '') };
  return { arriveAt: validTime(v.arriveAt, ''), leaveAt: validTime(v.leaveAt, '') };
}

/** Doplní chybějící nebo neplatné hodnoty nastavení výchozími. */
export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const schedule = { odd: {}, even: {} };
  for (const week of ['odd', 'even']) {
    for (const day of WORKDAYS) schedule[week][day] = normalizeScheduleDay(raw.schedule?.[week]?.[day]);
  }
  // Přestávka musí být kratší než interval, jinak by delší pobyt nedal víc práce.
  let breakAfterHours = validHours(raw.breakAfterHours, d.breakAfterHours);
  let breakLengthMinutes = Number(raw.breakLengthMinutes ?? d.breakLengthMinutes);
  if (!Number.isInteger(breakLengthMinutes) || breakLengthMinutes < 0 || breakLengthMinutes >= hoursToMinutes(breakAfterHours)) {
    breakAfterHours = d.breakAfterHours;
    breakLengthMinutes = d.breakLengthMinutes;
  }
  return {
    anchorMode: raw.anchorMode === 'departure' ? 'departure' : 'arrival',
    // startTime = dřívější název pro čas příchodu
    anchorTime: validTime(raw.anchorTime ?? raw.startTime, d.anchorTime),
    earliestArrival: validTime(raw.earliestArrival, d.earliestArrival),
    latestDeparture: validTime(raw.latestDeparture, d.latestDeparture),
    coreStart: validTime(raw.coreStart, d.coreStart),
    coreEnd: validTime(raw.coreEnd, d.coreEnd),
    dailyFundHours: validHours(raw.dailyFundHours, d.dailyFundHours),
    maxWorkedHoursPerDay: validHours(raw.maxWorkedHoursPerDay, d.maxWorkedHoursPerDay),
    breakAfterHours,
    breakLengthMinutes,
    parityFlip: Boolean(raw.parityFlip),
    schedule,
  };
}

/** Denní fond v minutách z nastavení. */
export function dailyFundMinutes(settings) {
  return hoursToMinutes(settings.dailyFundHours);
}

/** Pravidla pro calc.js (fond a přestávka) z nastavení uživatele. */
export function rulesFromSettings(settings) {
  return {
    DAILY_FUND_MIN: dailyFundMinutes(settings),
    BREAK_INTERVAL_MIN: hoursToMinutes(settings.breakAfterHours),
    BREAK_MIN: settings.breakLengthMinutes,
  };
}

// ---------------------------------------------------------------------------
// Varování (upozornění, ne zákazy)
// ---------------------------------------------------------------------------

/** Varování pro odchod před koncem pevné pracovní doby. */
export function leaveWarning(leaveAt, settings) {
  if (!leaveAt || parseTime(leaveAt) === null) return null;
  return parseTime(leaveAt) < parseTime(settings.coreEnd) ? CORE_WARNING : null;
}

/** Varování pro příchod po začátku pevné pracovní doby. */
export function arrivalWarning(arrival, settings) {
  if (!arrival || parseTime(arrival) === null) return null;
  return parseTime(arrival) > parseTime(settings.coreStart) ? CORE_WARNING : null;
}

/**
 * Varování pro konkrétní příchod a odchod (minuty, null = neznámý):
 * pevná pracovní doba a hranice plánovače. Jen upozornění.
 */
export function timeWarnings(arrival, leave, settings, { skipCore = false } = {}) {
  const list = [];
  const a = arrival === null ? null : toTimeString(arrival);
  const l = leave === null ? null : toTimeString(leave);
  if (!skipCore && a && arrivalWarning(a, settings)) list.push(`Příchod ${a} je po začátku pevné pracovní doby (${settings.coreStart}). ${CORE_WARNING}`);
  if (!skipCore && l && leaveWarning(l, settings)) list.push(`Odchod ${l} je před koncem pevné pracovní doby (${settings.coreEnd}). ${CORE_WARNING}`);
  if (a && arrival < parseTime(settings.earliestArrival)) list.push(`Příchod ${a} je před nejdřívějším příchodem (${settings.earliestArrival}).`);
  if (l && leave > parseTime(settings.latestDeparture)) list.push(`Odchod ${l} je po nejpozdějším odchodu (${settings.latestDeparture}).`);
  if (a && l && leave <= arrival) list.push('Odchod musí být po příchodu.');
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
    list.push({ field: 'coreEnd', message: 'Konec pevné pracovní doby musí být po jejím začátku.' });
  }
  if (parseTime(settings.latestDeparture) <= parseTime(settings.earliestArrival)) {
    list.push({ field: 'latestDeparture', message: 'Nejpozdější odchod musí být po nejdřívějším příchodu.' });
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
  const changes = [
    `Pevný bude ${toDep ? 'odchod' : 'příchod'} v ${next.anchorTime} (běžný den ${formatMinutes(stay)} h pobytu, dosud ${toDep ? 'příchod' : 'odchod'} ${s.anchorTime}).`,
    toDep
      ? `Napracovávat se bude posunem příchodu dřív, nejdříve však v ${s.earliestArrival}.`
      : `Napracovávat se bude posunem odchodu, nejpozději do ${s.latestDeparture}.`,
  ];
  if (onlyLeave) {
    changes.push(toDep
      ? `Dny jen s pevným odchodem (${onlyLeave}×): příchod už nebude ${s.anchorTime}, ale bude se dopočítávat – tyto dny začnou napracovávat.`
      : `Dny jen s pevným odchodem (${onlyLeave}×): příchod bude v kotvě ${next.anchorTime} a den bude plně pevný.`);
  }
  if (onlyArrive) {
    changes.push(toDep
      ? `Dny jen s pevným příchodem (${onlyArrive}×): odchod bude v kotvě ${next.anchorTime} a den bude plně pevný.`
      : `Dny jen s pevným příchodem (${onlyArrive}×): odchod už nebude ${s.anchorTime}, ale bude se dopočítávat.`);
  }
  if (both) changes.push(`Dny s oběma pevnými časy (${both}×) se nemění.`);
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

export const PARITY_LABELS = { odd: 'lichý', even: 'sudý' };

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
 * @returns {{days: Array, summary: object, warnings: string[]}}
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
  const fundDay = rules.DAILY_FUND_MIN;
  const maxWorked = hoursToMinutes(s.maxWorkedHoursPerDay);
  const anchor = parseTime(s.anchorTime);
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
    const day = {
      date,
      week,
      parity: weekParity(date, s.parityFlip),
      workday,
      holiday: holidayName(date),
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
      warnings: [],
    };
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

    // Konce dne: skutečný příchod > výjimka > rozvrh > kotva; druhý konec se dopočítá.
    const sched = scheduledDay(date, s);
    const actualArr = rec?.arrival ? parseTime(rec.arrival) : null;
    day.actualArrival = actualArr !== null;
    let arr = actualArr ?? t(ov?.arriveAt) ?? t(sched.arriveAt);
    let lv = t(ov?.leaveAt) ?? t(sched.leaveAt);
    day.explicitArrival = arr !== null && actualArr === null;
    day.explicitLeave = lv !== null;
    if (s.anchorMode === 'arrival') arr ??= anchor;
    else lv ??= anchor;

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
      day.plannedWorked = workedForStay(Math.max(0, lv - workStart), rules);
      day.plannedArrivalMin = workStart;
      day.plannedLeaveMin = lv;
    } else {
      // Běžný den: jeden konec pevný, druhý se posouvá v hranicích.
      day.kind = 'regular';
      day.flex = lv === null ? 'leave' : 'arrival';
      day.fixedTime = day.flex === 'leave' ? arr : lv;
      const maxStay = day.flex === 'leave' ? latest - arr : lv - Math.max(0, earliest);
      const coreStay = day.flex === 'leave' ? coreEnd - arr : lv - coreStart;
      const cap = Math.min(maxWorked, workedForStay(Math.max(0, maxStay), rules));
      const base = Math.min(Math.max(0, fundDay - absMin), cap);
      day.base = base;
      day.min = absMin > 0 ? 0 : Math.min(workedForStay(Math.max(0, coreStay), rules), base);
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
      const stay = stayForWorked(x.plannedWorked, rules);
      x.plannedArrivalMin = x.flex === 'leave' ? x.fixedTime : x.fixedTime - stay;
      x.plannedLeaveMin = x.flex === 'leave' ? x.fixedTime + stay : x.fixedTime;
    }
    const a = x.plannedArrivalMin;
    const l = x.plannedLeaveMin;
    x.arrival = a >= 0 && a <= 1439 ? toTimeString(a) : null;
    x.plannedLeave = l >= 0 && l <= 1439 ? toTimeString(l) : null;
    if (a < 0) x.warnings.push('Plánovaný příchod by byl před půlnocí předchozího dne.');
    if (l > 1439) x.warnings.push('Plánovaný odchod by byl po půlnoci.');
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
    warnings.push(`Měsíc nelze vyrovnat: chybí ${formatMinutes(unbalanced)} h (běžné dny narážejí na max. ${formatMinutes(maxWorked)} h/den `
      + `nebo na ${depMode ? `nejdřívější příchod ${s.earliestArrival}` : `nejpozdější odchod ${s.latestDeparture}`}; pevné dny se neprodlužují).`);
  } else if (unbalanced < 0) {
    warnings.push(`Měsíc nelze vyrovnat: přebývá ${formatMinutes(-unbalanced)} h (běžné dny nelze zkrátit pod ${depMode ? `příchod v ${s.coreStart}` : `odchod v ${s.coreEnd}`}).`);
  }
  const missing = days.filter((x) => x.kind === 'missing').length;
  if (missing) warnings.push(`${missing} proběhlých pracovních dnů nemá záznam – započítávají se jako 0 h.`);

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
  const rules = rulesFromSettings(s);
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
  const sched = scheduledDay(date, s);
  let arrival;
  let departure;
  if (record?.arrival || s.anchorMode === 'arrival') {
    // známý příchod (záznam, výjimka, rozvrh nebo kotva) + pobyt
    arrival = t(record?.arrival) ?? t(override?.arriveAt) ?? t(sched.arriveAt) ?? parseTime(s.anchorTime);
    departure = arrival + stay;
  } else {
    // kotva odchodu: příchod se dopočítá zpět od odchodu
    departure = t(override?.leaveAt) ?? t(sched.leaveAt) ?? parseTime(s.anchorTime);
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
