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
  startTime: '06:00',
  coreStart: '09:00',
  coreEnd: '14:00',
  dailyFundHours: 8,
  maxWorkedHoursPerDay: 10,
  parityFlip: false,
  schedule: {
    odd: { 1: '', 2: '', 3: '', 4: '', 5: '' },
    even: { 1: '', 2: '', 3: '', 4: '', 5: '' },
  },
});

const validTime = (v, fallback) => (parseTime(v) === null ? fallback : v);
const validHours = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 24 ? Number(v) : fallback);

/** Doplní chybějící nebo neplatné hodnoty nastavení výchozími. */
export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const schedule = { odd: {}, even: {} };
  for (const week of ['odd', 'even']) {
    for (const day of WORKDAYS) {
      const v = raw.schedule?.[week]?.[day];
      schedule[week][day] = parseTime(v) === null ? '' : v;
    }
  }
  return {
    startTime: validTime(raw.startTime, d.startTime),
    coreStart: validTime(raw.coreStart, d.coreStart),
    coreEnd: validTime(raw.coreEnd, d.coreEnd),
    dailyFundHours: validHours(raw.dailyFundHours, d.dailyFundHours),
    maxWorkedHoursPerDay: validHours(raw.maxWorkedHoursPerDay, d.maxWorkedHoursPerDay),
    parityFlip: Boolean(raw.parityFlip),
    schedule,
  };
}

/** Denní fond v minutách z nastavení. */
export function dailyFundMinutes(settings) {
  return hoursToMinutes(settings.dailyFundHours);
}

// ---------------------------------------------------------------------------
// Varování (upozornění, ne zákazy)
// ---------------------------------------------------------------------------

/** Varování pro pevný odchod před koncem pevné pracovní doby. */
export function leaveWarning(leaveAt, settings) {
  if (!leaveAt || parseTime(leaveAt) === null) return null;
  return parseTime(leaveAt) < parseTime(settings.coreEnd) ? CORE_WARNING : null;
}

/** Varování pro příchod po začátku pevné pracovní doby. */
export function arrivalWarning(arrival, settings) {
  if (!arrival || parseTime(arrival) === null) return null;
  return parseTime(arrival) > parseTime(settings.coreStart) ? CORE_WARNING : null;
}

/** Všechna varování nastavení: [{field, week?, day?, message}]. */
export function settingsWarnings(settings) {
  const list = [];
  if (arrivalWarning(settings.startTime, settings)) {
    list.push({ field: 'startTime', message: `Příchod ${settings.startTime} je po začátku pevné pracovní doby (${settings.coreStart}). ${CORE_WARNING}` });
  }
  if (parseTime(settings.coreEnd) <= parseTime(settings.coreStart)) {
    list.push({ field: 'coreEnd', message: 'Konec pevné pracovní doby musí být po jejím začátku.' });
  }
  for (const week of ['odd', 'even']) {
    for (const day of WORKDAYS) {
      const leaveAt = settings.schedule[week][day];
      if (leaveWarning(leaveAt, settings)) {
        list.push({ field: 'schedule', week, day, message: `Odchod ${leaveAt} je před koncem pevné pracovní doby (${settings.coreEnd}). ${CORE_WARNING}` });
      }
    }
  }
  return list;
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

/** Pevný odchod z rozvrhu pro datum ('' = běžný den). */
export function scheduledLeave(dateStr, settings) {
  const wd = weekday(dateStr);
  if (wd < 1 || wd > 5) return '';
  return settings.schedule[weekParity(dateStr, settings.parityFlip)][wd] || '';
}

// ---------------------------------------------------------------------------
// Převody pobyt ↔ odpracováno
// ---------------------------------------------------------------------------

/** Odpracováno z pobytu (pobyt − přestávka). */
export function workedForStay(stay) {
  return stay > 0 ? stay - breakMinutes(stay) : 0;
}

/**
 * Nejmenší pobyt, který dá alespoň `worked` odpracovaných minut.
 * Převod je kvůli přestávce nemonotónní (6:00 pobytu = 5:30 práce),
 * proto se hledá nejmenší vyhovující pobyt.
 */
export function stayForWorked(worked) {
  if (!(worked > 0)) return 0;
  let stay = worked;
  while (workedForStay(stay) < worked) stay++;
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
 * @param {object} p.settings      normalizované nastavení
 * @param {Array}  p.records       záznamy docházky
 * @param {Array}  [p.overrides]   výjimky dnů {date, absenceType, absenceHours, leaveAt, workedHours}
 * @returns {{days: Array, summary: object, warnings: string[]}}
 *
 * Druhy dnů (day.kind):
 *   'done'     proběhlý den se skutečností       'filled'   doplněná docházka
 *   'missing'  proběhlý pracovní den bez záznamu 'absence'  celodenní nepřítomnost
 *   'fixed'    pevný odchod                       'override' výjimka s pevnými hodinami
 *   'regular'  běžný (dopočítávaný) den          'off'      víkend / svátek
 */
export function buildMonthPlan({ year, month, today, settings, records, overrides = [] }) {
  const s = normalizeSettings(settings);
  const fundDay = dailyFundMinutes(s);
  const maxWorked = hoursToMinutes(s.maxWorkedHoursPerDay);
  const start = parseTime(s.startTime);
  const coreEnd = parseTime(s.coreEnd);
  const recMap = new Map(records.map((r) => [r.date, r]));
  const ovMap = new Map(overrides.map((o) => [o.date, o]));
  const days = [];

  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = toDateString(year, month, d);
    const rec = recMap.get(date);
    const ov = ovMap.get(date) ?? null;
    const workday = isWorkday(date);
    const res = rec ? safeDayResult(rec, fundDay) : null;
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
      continue;
    }
    const absMin = absence?.minutes ?? 0;
    const arrival = rec?.arrival ? parseTime(rec.arrival) : start;
    day.arrival = toTimeString(arrival);
    day.absence = absMin;
    day.actualArrival = Boolean(rec?.arrival);
    if (day.actualArrival) {
      const w = arrivalWarning(rec.arrival, s);
      if (w) day.warnings.push(`Příchod ${rec.arrival} je po začátku pevné pracovní doby. ${w}`);
    }

    const leaveAt = ov?.leaveAt || scheduledLeave(date, s);
    const fixedWorked = ov?.workedHours != null && ov.workedHours !== '' ? hoursToMinutes(ov.workedHours) : null;

    if (fixedWorked !== null) {
      day.kind = 'override';
      day.plannedWorked = fixedWorked;
    } else if (leaveAt) {
      // Pevný odchod se nemění; částečná nepřítomnost proto musí proběhnout před ním
      // a pracovní blok začíná až po ní (není-li zaznamenaný skutečný příchod).
      const workStart = day.actualArrival ? arrival : arrival + absMin;
      day.arrival = toTimeString(Math.min(workStart, 1439));
      day.kind = 'fixed';
      day.fixedLeave = leaveAt;
      day.plannedWorked = workedForStay(Math.max(0, parseTime(leaveAt) - workStart));
      day.plannedLeave = leaveAt;
      const w = leaveWarning(leaveAt, s);
      if (w) day.warnings.push(`Odchod ${leaveAt} je před koncem pevné pracovní doby (${s.coreEnd}). ${w}`);
      if (parseTime(leaveAt) <= workStart) day.warnings.push('Pevný odchod je dříve než příchod.');
    } else {
      day.kind = 'regular';
      const latestWorked = workedForStay(1439 - arrival); // odchod nejpozději 23:59
      const cap = Math.min(maxWorked, latestWorked);
      const base = Math.min(Math.max(0, fundDay - absMin), cap);
      const fromCore = workedForStay(Math.max(0, coreEnd - arrival));
      day.base = base;
      day.min = absMin > 0 ? 0 : Math.min(fromCore, base);
      day.max = Math.max(cap, base);
      day.plannedWorked = base;
    }
  }

  // Deficit = fond − (skutečnost + pevné dny + základy běžných dnů)
  const fund = monthFund(year, month, fundDay);
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

  for (const x of days) {
    if (x.kind === 'regular' || (x.kind === 'override' && x.plannedLeave === null && x.plannedWorked !== null)) {
      const leave = parseTime(x.arrival) + stayForWorked(x.plannedWorked);
      x.plannedLeave = leave <= 1439 ? toTimeString(leave) : null;
      if (leave > 1439) x.warnings.push('Plánovaný odchod by byl po půlnoci.');
      if (x.kind === 'regular' && x.plannedLeave && parseTime(x.plannedLeave) < coreEnd && x.absence === 0) {
        x.warnings.push(`Odchod před koncem pevné pracovní doby. ${CORE_WARNING}`);
      }
    }
    if (x.plannedWorked !== null && x.kind !== 'absence') x.credited = x.plannedWorked + x.absence;
  }

  // Souhrn
  const upcomingDays = days.filter((x) => x.plannedWorked !== null);
  const worked = days.filter((x) => x.plannedWorked === null).reduce((sum, x) => sum + x.credited, 0);
  const planRemaining = upcomingDays.reduce((sum, x) => sum + x.credited, 0);
  const projected = worked + planRemaining;
  const regularWorked = regular.reduce((sum, x) => sum + x.plannedWorked, 0);
  const warnings = [];
  if (unbalanced > 0) {
    warnings.push(`Měsíc nelze vyrovnat: chybí ${formatMinutes(unbalanced)} h (běžné dny jsou na maximu, pevné dny se neprodlužují).`);
  } else if (unbalanced < 0) {
    warnings.push(`Měsíc nelze vyrovnat: přebývá ${formatMinutes(-unbalanced)} h (běžné dny nelze zkrátit pod odchod v ${s.coreEnd}).`);
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
 * Odchod = příchod (nebo startTime) + nejmenší pobyt pro (fond − nepřítomnost).
 * Vrací nový záznam s filled: true, nebo null, není-li co doplnit.
 */
export function fillRecord(date, record, settings, override = null) {
  const s = normalizeSettings(settings);
  const fundDay = dailyFundMinutes(s);
  const res = record ? safeDayResult(record, fundDay) : null;
  if (res?.complete || !isWorkday(date)) return null;

  const absence = absenceOf(record, fundDay) ?? absenceOf(override, fundDay);
  const note = record?.note ?? '';
  if (absence && absence.minutes === null) {
    return { date, type: absence.type, arrival: null, departure: null, absenceHours: null, note, filled: true };
  }
  const absMin = absence?.minutes ?? 0;
  const arrival = record?.arrival ?? s.startTime;
  const departure = parseTime(arrival) + stayForWorked(fundDay - absMin);
  if (departure > 1439) return null;
  return {
    date,
    type: absence?.type ?? DAY_TYPES.WORK,
    arrival,
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
