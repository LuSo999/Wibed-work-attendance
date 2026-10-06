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

/** Typy dnů. */
export const DAY_TYPES = Object.freeze({
  WORK: 'work',
  VACATION: 'vacation',
  SICK: 'sick',
  DOCTOR: 'doctor',
  /** Náhradní volno – čerpá celý denní fond z banky přesčasů. */
  COMP: 'comp',
});

export const DAY_TYPE_LABELS = Object.freeze({
  work: 'Pracovní',
  vacation: 'Dovolená',
  sick: 'Nemoc',
  doctor: 'Lékař',
  comp: 'Náhradní volno',
});

/** Nepracovní typy, které se započítají do fondu, ale netvoří přesčas. */
const CREDITED_TYPES = new Set([DAY_TYPES.VACATION, DAY_TYPES.SICK, DAY_TYPES.DOCTOR]);

const WEEKDAY_LABELS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

export const MONTH_LABELS = [
  'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
  'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec',
];

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

/** Minuty → desetinné hodiny jako text s čárkou ('8,50'). */
export function formatHoursDecimal(minutes) {
  return (minutes / 60).toFixed(2).replace('.', ',');
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

export function weekdayLabel(dateStr) {
  return WEEKDAY_LABELS[weekday(dateStr)];
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

const FIXED_HOLIDAYS = {
  '01-01': 'Den obnovy samostatného českého státu, Nový rok',
  '05-01': 'Svátek práce',
  '05-08': 'Den vítězství',
  '07-05': 'Den slovanských věrozvěstů Cyrila a Metoděje',
  '07-06': 'Den upálení mistra Jana Husa',
  '09-28': 'Den české státnosti',
  '10-28': 'Den vzniku samostatného československého státu',
  '11-17': 'Den boje za svobodu a demokracii',
  '12-24': 'Štědrý den',
  '12-25': '1. svátek vánoční',
  '12-26': '2. svátek vánoční',
};

/** Státní svátky ČR pro rok: Map<'YYYY-MM-DD', název>. */
export function czechHolidays(y) {
  const map = new Map();
  for (const [md, name] of Object.entries(FIXED_HOLIDAYS)) map.set(`${y}-${md}`, name);
  const easter = easterSunday(y);
  // Velký pátek je státním svátkem od roku 2016.
  if (y >= 2016) map.set(addDays(easter, -2), 'Velký pátek');
  map.set(addDays(easter, 1), 'Velikonoční pondělí');
  return map;
}

const holidayCache = new Map();

/** Název svátku pro datum, nebo null. */
export function holidayName(dateStr) {
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
 * @param {number} [dailyFund] denní fond v minutách (nastavení uživatele, výchozí RULES)
 */
export function dayFund(dateStr, dailyFund = RULES.DAILY_FUND_MIN) {
  return isWorkday(dateStr) ? dailyFund : 0;
}

// ---------------------------------------------------------------------------
// Denní výpočty
// ---------------------------------------------------------------------------

/** Povinná přestávka: floor(pobyt / 6 h) * 30 min. */
export function breakMinutes(stayMinutes) {
  if (!(stayMinutes > 0)) return 0;
  return Math.floor(stayMinutes / RULES.BREAK_INTERVAL_MIN) * RULES.BREAK_MIN;
}

/**
 * Pobyt mezi příchodem a odchodem v minutách.
 * Vrací null, pokud některý čas chybí; vyhodí chybu, je-li odchod před příchodem.
 */
export function stayMinutes(arrival, departure) {
  const a = parseTime(arrival);
  const d = parseTime(departure);
  if (a === null || d === null) return null;
  if (d < a) throw new RangeError('Odchod nemůže být dříve než příchod.');
  return d - a;
}

/** Odpracováno = pobyt − přestávka (null, pokud den není uzavřený). */
export function workedMinutes(arrival, departure) {
  const stay = stayMinutes(arrival, departure);
  return stay === null ? null : stay - breakMinutes(stay);
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
 * @param {number} [dailyFund] denní fond v minutách (výchozí RULES)
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
export function dayResult(record, dailyFund = RULES.DAILY_FUND_MIN) {
  const fund = dayFund(record.date, dailyFund);
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
  const brk = breakMinutes(stay);
  const worked = stay - brk;
  const credited = worked + absence;
  const overtime = credited - fund;
  return {
    fund, stay, break: brk, worked, absence, credited, overtime, bankDelta: overtime - drawn, complete: true, partial: partialAbsence !== null,
  };
}

/** Bezpečná varianta dayResult – neplatný záznam se počítá jako prázdný. */
export function safeDayResult(record, dailyFund = RULES.DAILY_FUND_MIN) {
  try {
    return dayResult(record, dailyFund);
  } catch {
    return {
      fund: dayFund(record.date, dailyFund), stay: null, break: 0, worked: 0, absence: 0, credited: 0, overtime: 0, bankDelta: 0, complete: false, partial: false,
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

/** Měsíční fond = pracovní dny * denní fond. */
export function monthFund(y, m, dailyFund = RULES.DAILY_FUND_MIN) {
  return workdaysInMonth(y, m) * dailyFund;
}

/**
 * Souhrn měsíce.
 * @param {Array} records   záznamy docházky (libovolné; filtrují se podle data)
 * @param {Array} withdrawals výběry z banky {date, minutes}
 * @param {number} [dailyFund] denní fond v minutách
 */
export function monthSummary(records, y, m, withdrawals = [], dailyFund = RULES.DAILY_FUND_MIN) {
  const prefix = `${monthKey(y, m)}-`;
  let credited = 0;
  let worked = 0;
  let overtime = 0;
  let compUsed = 0;
  for (const r of records) {
    if (!r.date?.startsWith(prefix)) continue;
    const res = safeDayResult(r, dailyFund);
    credited += res.credited;
    worked += res.worked;
    overtime += res.overtime;
    if ((r.type ?? DAY_TYPES.WORK) === DAY_TYPES.COMP) compUsed += res.absence;
  }
  const withdrawn = withdrawals
    .filter((w) => w.date?.startsWith(prefix))
    .reduce((sum, w) => sum + (w.minutes || 0), 0);
  const fund = monthFund(y, m, dailyFund);
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

/** Celkový zůstatek banky přesčasů v minutách. */
export function bankBalance(records, withdrawals = [], dailyFund = RULES.DAILY_FUND_MIN) {
  const earned = records.reduce((sum, r) => sum + safeDayResult(r, dailyFund).bankDelta, 0);
  const withdrawn = withdrawals.reduce((sum, w) => sum + (w.minutes || 0), 0);
  return earned - withdrawn;
}

/**
 * Kontrola výběru z banky. Vrací null, je-li vše v pořádku, jinak text chyby.
 */
export function validateWithdrawal(minutes, balance) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Zadejte kladný počet hodin.';
  if (minutes > balance) {
    return `Nelze vybrat ${formatMinutes(minutes)} h – zůstatek banky je jen ${formatMinutes(balance)} h.`;
  }
  return null;
}

/**
 * Kontrola záznamu dne před uložením. Vrací null nebo text chyby.
 * @param {object} record     nový záznam
 * @param {number} balanceWithoutDay zůstatek banky bez vlivu tohoto dne
 * @param {number} [dailyFund] denní fond v minutách
 */
export function validateDay(record, balanceWithoutDay = Infinity, dailyFund = RULES.DAILY_FUND_MIN) {
  if (!parseDate(record.date)) return 'Neplatné datum.';
  const type = record.type ?? DAY_TYPES.WORK;
  if (!Object.values(DAY_TYPES).includes(type)) return 'Neznámý typ dne.';
  const fund = dayFund(record.date, dailyFund);
  if (isAbsenceType(type) && record.absenceHours != null && record.absenceHours !== '') {
    const h = Number(record.absenceHours);
    if (!Number.isFinite(h) || h <= 0) return 'Počet hodin nepřítomnosti musí být kladné číslo.';
  }
  const partial = partialAbsenceMinutes({ ...record, type }, fund);
  if (type === DAY_TYPES.WORK || partial !== null) {
    if (record.arrival && parseTime(record.arrival) === null) return 'Neplatný čas příchodu.';
    if (record.departure && parseTime(record.departure) === null) return 'Neplatný čas odchodu.';
    if (record.departure && !record.arrival) return 'Nejdříve zadejte příchod.';
    if (record.arrival && record.departure && parseTime(record.departure) < parseTime(record.arrival)) {
      return 'Odchod nemůže být dříve než příchod.';
    }
  }
  if (type === DAY_TYPES.COMP) {
    const need = partial ?? fund;
    if (need > balanceWithoutDay) {
      return `Na náhradní volno chybí v bance přesčasů ${formatMinutes(need - Math.max(0, balanceWithoutDay))} h.`;
    }
  }
  return null;
}

/** Hodiny (číslo, např. 1.5) → celé minuty. */
export function hoursToMinutes(hours) {
  return Math.round(Number(hours) * 60);
}
