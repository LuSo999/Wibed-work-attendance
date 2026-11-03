/**
 * Čisté výpočty pracovní doby – bez závislosti na DOM a Firebase.
 *
 * Všechny časové hodnoty jsou v CELÝCH MINUTÁCH (integer), data jako řetězce
 * 'YYYY-MM-DD', časy jako 'HH:MM'. Díky tomu nevznikají chyby zaokrouhlení
 * ani posuny kvůli časovým pásmům.
 */

/** Pravidla pracovní doby – jediné místo, kde se nastavují. */
export const RULES = Object.freeze({
  /** Denní fond pracovní doby (8 h). */
  DAILY_FUND_MIN: 8 * 60,
  /** Za každý celý tento interval pobytu se odečte přestávka (6 h). */
  BREAK_INTERVAL_MIN: 6 * 60,
  /** Délka povinné přestávky za každý celý interval (30 min). */
  BREAK_MIN: 30,
});

/**
 * Pravidla uživatele: RULES s případně přepsanými hodnotami.
 * Přijímá objekt {DAILY_FUND_MIN?, BREAK_INTERVAL_MIN?, BREAK_MIN?}, samotné číslo
 * (= denní fond v minutách, zpětná kompatibilita) nebo nic (= výchozí RULES).
 */
export function toRules(rules) {
  if (rules === undefined || rules === null) return RULES;
  if (typeof rules === 'number') return { ...RULES, DAILY_FUND_MIN: rules };
  if (rules.versions?.length) return rulesForDate(rules);
  return { ...RULES, ...rules };
}

/**
 * Pravidla platná pro datum. Verzovaná pravidla mají tvar
 * { versions: [{ from: 'YYYY-MM-DD', DAILY_FUND_MIN, BREAK_INTERVAL_MIN, BREAK_MIN }, …] }
 * seřazená podle `from`; platí poslední verze s from ≤ datum (bez data = aktuální).
 * Starší dny se tak počítají podle pravidel, která tehdy platila.
 */
export function rulesForDate(rules, date) {
  if (!rules?.versions?.length) return toRules(rules);
  let pick = rules.versions[0];
  for (const v of rules.versions) {
    if (date === undefined || v.from <= date) pick = v;
  }
  const { from, ...values } = pick;
  return { ...RULES, ...values };
}

/**
 * Popis pravidla přestávky jako zpráva {key, params} (překládá UI),
 * např. „Za každých celých 6:00 h pobytu se odečte 30 min přestávky.“
 */
export function describeBreakRule(rules) {
  const r = toRules(rules);
  if (!r.BREAK_MIN) return { key: 'break.none' };
  return { key: 'break.rule', params: { interval: formatMinutes(r.BREAK_INTERVAL_MIN), minutes: r.BREAK_MIN } };
}

/** Typy dnů. */
export const DAY_TYPES = Object.freeze({
  WORK: 'work',
  VACATION: 'vacation',
  SICK: 'sick',
  DOCTOR: 'doctor',
  /** Náhradní volno – čerpá celý denní fond z banky přesčasů. */
  COMP: 'comp',
});

/** Nepracovní typy, které se započítají do fondu, ale netvoří přesčas. */
const CREDITED_TYPES = new Set([DAY_TYPES.VACATION, DAY_TYPES.SICK, DAY_TYPES.DOCTOR]);

// ---------------------------------------------------------------------------
// Čas a datum
// ---------------------------------------------------------------------------

/** 'HH:MM' → minuty od půlnoci; neplatný vstup → null. */
export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minuty od půlnoci → 'HH:MM'. */
export function toTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Doba v minutách → 'H:MM'. Se `sign: true` vždy přidá znaménko (+1:30, −0:15).
 * Záporné hodnoty používají znak minus (U+2212) jen v `sign` režimu pro UI;
 * v ostatních případech obyčejný '-' (vhodné pro CSV).
 */
export function formatMinutes(minutes, { sign = false } = {}) {
  const abs = Math.abs(Math.round(minutes));
  const text = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  if (minutes < 0) return (sign ? '−' : '-') + text;
  return sign ? `+${text}` : text;
}

/** Minuty → desetinné hodiny jako text se zvoleným oddělovačem ('8,50' / '8.50'). */
export function formatHoursDecimal(minutes, separator = ',') {
  return (minutes / 60).toFixed(2).replace('.', separator);
}

/** 'YYYY-MM-DD' → {y, m (1–12), d}; neplatný vstup → null. */
export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** (y, m 1–12, d) → 'YYYY-MM-DD'. */
export function toDateString(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Klíč měsíce 'YYYY-MM'. */
export function monthKey(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Den v týdnu 0 = neděle … 6 = sobota. */
export function weekday(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Velikonoční neděle (gregoriánský kalendář, anonymní algoritmus). */
export function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toDateString(y, month, day);
}

function addDays(dateStr, delta) {
  const { y, m, d } = parseDate(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return toDateString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Pevné státní svátky ČR: 'MM-DD' → klíč názvu ve slovníku. */
const FIXED_HOLIDAYS = {
  '01-01': 'holiday.newYear',
  '05-01': 'holiday.labourDay',
  '05-08': 'holiday.victoryDay',
  '07-05': 'holiday.cyrilMethodius',
  '07-06': 'holiday.janHus',
  '09-28': 'holiday.statehood',
  '10-28': 'holiday.independence',
  '11-17': 'holiday.freedom',
  '12-24': 'holiday.christmasEve',
  '12-25': 'holiday.christmasDay',
  '12-26': 'holiday.stStephen',
};

/** Státní svátky ČR pro rok: Map<'YYYY-MM-DD', klíč názvu> (bez ohledu na nastavení). */
export function czechHolidays(y) {
  const map = new Map();
  for (const [md, key] of Object.entries(FIXED_HOLIDAYS)) map.set(`${y}-${md}`, key);
  const easter = easterSunday(y);
  // Velký pátek je státním svátkem od roku 2016.
  if (y >= 2016) map.set(addDays(easter, -2), 'holiday.goodFriday');
  map.set(addDays(easter, 1), 'holiday.easterMonday');
  return map;
}

const holidayCache = new Map();

/**
 * Konfigurace svátků na úrovni modulu (nastavení uživatele czHolidays).
 * Vypnuté svátky = všechny výpočty se chovají, jako by svátky neexistovaly.
 */
const holidayConfig = { enabled: true };

export function configureHolidays({ enabled = true } = {}) {
  holidayConfig.enabled = Boolean(enabled);
}

export function holidaysEnabled() {
  return holidayConfig.enabled;
}

/** Klíč názvu svátku pro datum (např. 'holiday.goodFriday'), nebo null (i při vypnutých svátcích). */
export function holidayName(dateStr) {
  if (!holidayConfig.enabled) return null;
  const y = Number(dateStr.slice(0, 4));
  if (!holidayCache.has(y)) holidayCache.set(y, czechHolidays(y));
  return holidayCache.get(y).get(dateStr) ?? null;
}

/** Pracovní den = po–pá a není státní svátek. */
export function isWorkday(dateStr) {
  const wd = weekday(dateStr);
  return wd !== 0 && wd !== 6 && holidayName(dateStr) === null;
}

/**
 * Fond konkrétního dne (denní fond v pracovní den, jinak 0).
 * @param {object|number} [rules] pravidla uživatele (viz toRules), výchozí RULES
 */
export function dayFund(dateStr, rules) {
  return isWorkday(dateStr) ? rulesForDate(rules, dateStr).DAILY_FUND_MIN : 0;
}

// ---------------------------------------------------------------------------
// Denní výpočty
// ---------------------------------------------------------------------------

/** Povinná přestávka: floor(pobyt / interval) * délka (výchozí 6 h a 30 min). */
export function breakMinutes(stayMinutes, rules) {
  const r = toRules(rules);
  if (!(stayMinutes > 0) || !(r.BREAK_INTERVAL_MIN > 0)) return 0;
  return Math.floor(stayMinutes / r.BREAK_INTERVAL_MIN) * r.BREAK_MIN;
}

/**
 * Pobyt mezi příchodem a odchodem v minutách.
 * Vrací null, pokud některý čas chybí; vyhodí chybu, je-li odchod před příchodem.
 */
export function stayMinutes(arrival, departure) {
  const a = parseTime(arrival);
  const d = parseTime(departure);
  if (a === null || d === null) return null;
  if (d < a) throw new RangeError('error.departureBeforeArrival');
  return d - a;
}

/** Odpracováno = pobyt − přestávka (null, pokud den není uzavřený). */
export function workedMinutes(arrival, departure, rules) {
  const stay = stayMinutes(arrival, departure);
  return stay === null ? null : stay - breakMinutes(stay, rules);
}

/** Je typ dne nepřítomnost (vše kromě pracovního dne)? */
export function isAbsenceType(type) {
  return CREDITED_TYPES.has(type) || type === DAY_TYPES.COMP;
}

/**
 * Minuty nepřítomnosti započtené do dne, nebo null pro celodenní nepřítomnost.
 * Částečná nepřítomnost = vyplněné absenceHours menší než fond dne.
 */
export function partialAbsenceMinutes(record, fund) {
  if (!isAbsenceType(record.type) || record.absenceHours == null || record.absenceHours === '') return null;
  const minutes = hoursToMinutes(record.absenceHours);
  return minutes < fund ? Math.max(0, minutes) : null;
}

/**
 * Výsledek jednoho dne.
 *
 * Částečná nepřítomnost (typ nepřítomnosti + absenceHours < fond): započte se
 * odpracováno + nepřítomnost, přesčas = (odpracováno + nepřítomnost) − fond.
 * U náhradního volna se hodiny nepřítomnosti navíc čerpají z banky.
 *
 * @param {{date: string, type?: string, arrival?: string|null, departure?: string|null, absenceHours?: number|null}} record
 * @param {object|number} [rules] pravidla uživatele (viz toRules), výchozí RULES
 * @returns {{
 *   fund: number,       // fond dne (0 o víkendu/svátku)
 *   stay: number|null,  // pobyt (jen pokud jsou zadané časy)
 *   break: number,      // odečtená přestávka
 *   worked: number,     // skutečně odpracováno
 *   absence: number,    // započtená nepřítomnost
 *   credited: number,   // započteno do plnění fondu (odpracováno + nepřítomnost)
 *   overtime: number,   // denní přesčas (může být záporný)
 *   bankDelta: number,  // změna banky přesčasů (přesčas, u náhradního volna minus čerpání)
 *   complete: boolean,  // false = rozpracovaný den (chybí odchod)
 *   partial: boolean,   // částečná nepřítomnost
 * }}
 */
export function dayResult(record, allRules) {
  const rules = rulesForDate(allRules, record.date);
  const fund = dayFund(record.date, rules);
  const type = record.type ?? DAY_TYPES.WORK;
  const empty = {
    fund, stay: null, break: 0, worked: 0, absence: 0, credited: 0, overtime: 0, bankDelta: 0, complete: true, partial: false,
  };
  const partialAbsence = partialAbsenceMinutes({ ...record, type }, fund);

  if (isAbsenceType(type) && partialAbsence === null) {
    // celodenní nepřítomnost (původní chování)
    return { ...empty, absence: fund, credited: fund, bankDelta: type === DAY_TYPES.COMP ? -fund : 0 };
  }

  const absence = partialAbsence ?? 0;
  const drawn = type === DAY_TYPES.COMP ? absence : 0;
  const stay = stayMinutes(record.arrival, record.departure);
  if (stay === null) {
    return { ...empty, absence, credited: absence, bankDelta: -drawn, complete: false, partial: partialAbsence !== null };
  }
  const brk = breakMinutes(stay, rules);
  const worked = stay - brk;
  const credited = worked + absence;
  const overtime = credited - fund;
  return {
    fund, stay, break: brk, worked, absence, credited, overtime, bankDelta: overtime - drawn, complete: true, partial: partialAbsence !== null,
  };
}

/** Bezpečná varianta dayResult – neplatný záznam se počítá jako prázdný. */
export function safeDayResult(record, rules) {
  try {
    return dayResult(record, rules);
  } catch {
    return {
      fund: dayFund(record.date, rules), stay: null, break: 0, worked: 0, absence: 0, credited: 0, overtime: 0, bankDelta: 0, complete: false, partial: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Měsíc a banka
// ---------------------------------------------------------------------------

/** Počet pracovních dnů v měsíci (bez víkendů a svátků). */
export function workdaysInMonth(y, m) {
  let count = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    if (isWorkday(toDateString(y, m, d))) count++;
  }
  return count;
}

/** Měsíční fond = součet denních fondů pracovních dnů (fond se může během měsíce změnit). */
export function monthFund(y, m, rules) {
  let sum = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) sum += dayFund(toDateString(y, m, d), rules);
  return sum;
}

/**
 * Souhrn měsíce.
 * @param {Array} records   záznamy docházky (libovolné; filtrují se podle data)
 * @param {Array} withdrawals výběry z banky {date, minutes}
 * @param {object|number} [rules] pravidla uživatele (viz toRules)
 */
export function monthSummary(records, y, m, withdrawals = [], rules = undefined) {
  const prefix = `${monthKey(y, m)}-`;
  let credited = 0;
  let worked = 0;
  let overtime = 0;
  let compUsed = 0;
  for (const r of records) {
    if (!r.date?.startsWith(prefix)) continue;
    const res = safeDayResult(r, rules);
    credited += res.credited;
    worked += res.worked;
    overtime += res.overtime;
    if ((r.type ?? DAY_TYPES.WORK) === DAY_TYPES.COMP) compUsed += res.absence;
  }
  const withdrawn = withdrawals
    .filter((w) => w.date?.startsWith(prefix))
    .reduce((sum, w) => sum + (w.minutes || 0), 0);
  const fund = monthFund(y, m, rules);
  return {
    workdays: workdaysInMonth(y, m),
    fund,
    worked,
    credited,
    overtime,
    /** Čerpáno z banky (náhradní volno + ruční výběry). */
    used: compUsed + withdrawn,
    /** Rozdíl plnění fondu (započteno − fond). */
    fundDiff: credited - fund,
  };
}

/**
 * Zůstatek banky přesčasů v minutách.
 * @param {object} [options] { month: 'YYYY-MM' } – jen dny a výběry daného měsíce
 *   (bez přenosu přesčasů mezi měsíci); bez month = celá historie
 */
export function bankBalance(records, withdrawals = [], rules = undefined, { month = null } = {}) {
  const inPeriod = (date) => !month || (typeof date === 'string' && date.startsWith(`${month}-`));
  const earned = records.filter((r) => inPeriod(r.date)).reduce((sum, r) => sum + safeDayResult(r, rules).bankDelta, 0);
  const withdrawn = withdrawals.filter((w) => inPeriod(w.date)).reduce((sum, w) => sum + (w.minutes || 0), 0);
  return earned - withdrawn;
}

/**
 * Kontrola výběru z banky. Vrací null, je-li vše v pořádku, jinak chybu {key, params}.
 */
export function validateWithdrawal(minutes, balance) {
  if (!Number.isFinite(minutes) || minutes <= 0) return { key: 'error.withdrawPositive' };
  if (minutes > balance) {
    return { key: 'error.withdrawOverBalance', params: { amount: formatMinutes(minutes), balance: formatMinutes(balance) } };
  }
  return null;
}

/**
 * Kontrola záznamu dne před uložením. Vrací null nebo chybu {key, params}.
 * @param {object} record     nový záznam
 * @param {number} balanceWithoutDay zůstatek banky bez vlivu tohoto dne
 * @param {object|number} [rules] pravidla uživatele (viz toRules)
 */
export function validateDay(record, balanceWithoutDay = Infinity, rules = undefined) {
  if (!parseDate(record.date)) return { key: 'error.invalidDate' };
  const type = record.type ?? DAY_TYPES.WORK;
  if (!Object.values(DAY_TYPES).includes(type)) return { key: 'error.unknownType' };
  const fund = dayFund(record.date, rules);
  if (isAbsenceType(type) && record.absenceHours != null && record.absenceHours !== '') {
    const h = Number(record.absenceHours);
    if (!Number.isFinite(h) || h <= 0) return { key: 'error.absenceHoursPositive' };
  }
  const partial = partialAbsenceMinutes({ ...record, type }, fund);
  if (type === DAY_TYPES.WORK || partial !== null) {
    if (record.arrival && parseTime(record.arrival) === null) return { key: 'error.invalidArrival' };
    if (record.departure && parseTime(record.departure) === null) return { key: 'error.invalidDeparture' };
    if (record.departure && !record.arrival) return { key: 'error.arrivalFirst' };
    if (record.arrival && record.departure && parseTime(record.departure) < parseTime(record.arrival)) {
      return { key: 'error.departureBeforeArrival' };
    }
  }
  if (type === DAY_TYPES.COMP) {
    const need = partial ?? fund;
    if (need > balanceWithoutDay) {
      return { key: 'error.compMissing', params: { missing: formatMinutes(need - Math.max(0, balanceWithoutDay)) } };
    }
  }
  return null;
}

/** Hodiny (číslo, např. 1.5) → celé minuty. */
export function hoursToMinutes(hours) {
  return Math.round(Number(hours) * 60);
}
