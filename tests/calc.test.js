// Spuštění: node --test tests/
// V prohlížeči: tests/run.html (import map nahradí node:test a node:assert shimem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES, DAY_TYPES, parseTime, formatMinutes, parseDate, breakMinutes, stayMinutes,
  workedMinutes, dayResult, isWorkday, holidayName, easterSunday, czechHolidays,
  workdaysInMonth, monthFund, monthSummary, bankBalance, validateWithdrawal, validateDay,
  hoursToMinutes, formatHoursDecimal, toRules, describeBreakRule, rulesForDate,
} from '../js/calc.js';
import { buildMonthCsv } from '../js/csv.js';

const H = 60;

test('RULES obsahují výchozí pravidla', () => {
  assert.equal(RULES.DAILY_FUND_MIN, 480);
  assert.equal(RULES.BREAK_INTERVAL_MIN, 360);
  assert.equal(RULES.BREAK_MIN, 30);
});

test('parseTime / formatMinutes', () => {
  assert.equal(parseTime('07:05'), 425);
  assert.equal(parseTime('7:05'), 425);
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime('12:60'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(null), null);
  assert.equal(formatMinutes(90), '1:30');
  assert.equal(formatMinutes(-15), '-0:15');
  assert.equal(formatMinutes(90, { sign: true }), '+1:30');
  assert.equal(formatMinutes(-15, { sign: true }), '−0:15');
  assert.equal(formatMinutes(0, { sign: true }), '+0:00');
  assert.equal(formatHoursDecimal(510), '8,50');
});

test('parseDate validuje datum', () => {
  assert.deepEqual(parseDate('2024-02-29'), { y: 2024, m: 2, d: 29 });
  assert.equal(parseDate('2023-02-29'), null);
  assert.equal(parseDate('2024-13-01'), null);
  assert.equal(parseDate('nonsense'), null);
});

test('přestávka: floor(pobyt / 6 h) * 30 min', () => {
  assert.equal(breakMinutes(0), 0);
  assert.equal(breakMinutes(6 * H - 1), 0);
  assert.equal(breakMinutes(6 * H), 30);
  assert.equal(breakMinutes(12 * H - 1), 30);
  assert.equal(breakMinutes(12 * H), 60);
  assert.equal(breakMinutes(18 * H), 90);
});

test('pobyt a odpracováno', () => {
  assert.equal(stayMinutes('08:00', '16:30'), 8.5 * H);
  assert.equal(workedMinutes('08:00', '16:30'), 8 * H);
  assert.equal(workedMinutes('08:00', '13:59'), 5 * H + 59);
  assert.equal(workedMinutes('08:00', '14:00'), 5.5 * H);
  assert.equal(workedMinutes('08:00', null), null);
  assert.throws(() => stayMinutes('16:00', '08:00'), RangeError);
});

test('pracovní den: přesčas kladný, nulový i záporný', () => {
  const day = '2025-03-03'; // pondělí
  assert.equal(dayResult({ date: day, type: 'work', arrival: '07:00', departure: '15:30' }).overtime, 0);
  const plus = dayResult({ date: day, type: 'work', arrival: '07:00', departure: '17:00' });
  assert.equal(plus.stay, 10 * H);
  assert.equal(plus.break, 30);
  assert.equal(plus.worked, 9.5 * H);
  assert.equal(plus.overtime, 1.5 * H);
  assert.equal(plus.bankDelta, 1.5 * H);
  const minus = dayResult({ date: day, type: 'work', arrival: '07:00', departure: '15:00' });
  assert.equal(minus.worked, 7.5 * H);
  assert.equal(minus.overtime, -30);
});

test('rozpracovaný den (bez odchodu) se nepočítá', () => {
  const r = dayResult({ date: '2025-03-03', type: 'work', arrival: '07:00', departure: null });
  assert.equal(r.complete, false);
  assert.equal(r.overtime, 0);
  assert.equal(r.credited, 0);
});

test('víkend a svátek: celá odpracovaná doba je přesčas', () => {
  const sat = dayResult({ date: '2025-03-01', type: 'work', arrival: '08:00', departure: '12:00' });
  assert.equal(sat.fund, 0);
  assert.equal(sat.overtime, 4 * H);
  const holiday = dayResult({ date: '2025-12-24', type: 'work', arrival: '08:00', departure: '14:00' });
  assert.equal(holiday.overtime, 5.5 * H);
});

test('nepracovní typy: započtou 8 h, netvoří přesčas', () => {
  for (const type of [DAY_TYPES.VACATION, DAY_TYPES.SICK, DAY_TYPES.DOCTOR]) {
    const r = dayResult({ date: '2025-03-03', type });
    assert.equal(r.credited, 8 * H, type);
    assert.equal(r.overtime, 0, type);
    assert.equal(r.bankDelta, 0, type);
  }
  // o víkendu se nic nezapočítá
  assert.equal(dayResult({ date: '2025-03-01', type: 'vacation' }).credited, 0);
});

test('náhradní volno: započte 8 h a čerpá 8 h z banky', () => {
  const r = dayResult({ date: '2025-03-03', type: DAY_TYPES.COMP });
  assert.equal(r.credited, 8 * H);
  assert.equal(r.overtime, 0);
  assert.equal(r.bankDelta, -8 * H);
});

test('Velikonoce a svátky ČR', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(holidayName('2025-04-18'), 'Velký pátek');
  assert.equal(holidayName('2025-04-21'), 'Velikonoční pondělí');
  assert.equal(holidayName('2025-04-22'), null);
  assert.equal(czechHolidays(2025).size, 13);
  assert.equal(czechHolidays(2015).size, 12); // před zavedením Velkého pátku
  assert.equal(isWorkday('2025-11-17'), false);
  assert.equal(isWorkday('2025-11-18'), true);
  assert.equal(isWorkday('2025-11-15'), false); // sobota
});

test('měsíční fond: pracovní dny * 8 h bez víkendů a svátků', () => {
  assert.equal(workdaysInMonth(2025, 3), 21); // březen 2025 bez svátků
  assert.equal(workdaysInMonth(2025, 4), 20); // 22 po–pá − Velký pátek − Velikonoční pondělí
  assert.equal(workdaysInMonth(2025, 12), 20); // 23 po–pá − 24., 25., 26.
  assert.equal(workdaysInMonth(2024, 2), 21); // přestupný únor
  assert.equal(workdaysInMonth(2026, 10), 21); // 22 po–pá − 28. 10.
  assert.equal(monthFund(2025, 3), 21 * 8 * H);
});

const records = [
  { date: '2025-03-03', type: 'work', arrival: '07:00', departure: '17:00' }, // +1:30
  { date: '2025-03-04', type: 'work', arrival: '07:00', departure: '15:00' }, // −0:30
  { date: '2025-03-05', type: 'vacation' },                                   // 0
  { date: '2025-03-06', type: 'comp' },                                       // banka −8:00
  { date: '2025-03-07', type: 'work', arrival: '07:00', departure: null },    // rozpracováno
  { date: '2025-03-08', type: 'work', arrival: '08:00', departure: '12:00' }, // sobota +4:00
  { date: '2025-02-28', type: 'work', arrival: '06:00', departure: '20:00' }, // únor +5:00
];
const withdrawals = [
  { date: '2025-03-10', minutes: 60 },
  { date: '2025-02-10', minutes: 30 },
];

test('souhrn měsíce', () => {
  const s = monthSummary(records, 2025, 3, withdrawals);
  assert.equal(s.workdays, 21);
  assert.equal(s.fund, 21 * 8 * H);
  assert.equal(s.worked, 9.5 * H + 7.5 * H + 4 * H);
  assert.equal(s.credited, 9.5 * H + 7.5 * H + 8 * H + 8 * H + 4 * H);
  assert.equal(s.overtime, 1.5 * H - 30 + 4 * H);
  assert.equal(s.used, 8 * H + 60);
});

test('banka přesčasů: přesčasy − náhradní volno − výběry', () => {
  // +1:30 −0:30 −8:00 +4:00 +5:00 (únor: 14 h pobytu − 1 h přestávka − 8 h) − 1:00 − 0:30
  assert.equal(bankBalance(records, withdrawals), 90 - 30 - 480 + 240 + 300 - 60 - 30);
  assert.equal(bankBalance([], []), 0);
  // neplatný záznam (odchod před příchodem) nerozbije výpočet
  assert.equal(bankBalance([{ date: '2025-03-03', type: 'work', arrival: '17:00', departure: '08:00' }]), 0);
});

test('validace výběru z banky', () => {
  assert.equal(validateWithdrawal(60, 120), null);
  assert.equal(validateWithdrawal(120, 120), null);
  assert.match(validateWithdrawal(121, 120), /Nelze vybrat/);
  assert.match(validateWithdrawal(0, 120), /kladný/);
  assert.match(validateWithdrawal(NaN, 120), /kladný/);
  assert.equal(hoursToMinutes('1.5'), 90);
});

test('validace dne', () => {
  assert.equal(validateDay({ date: '2025-03-03', type: 'work', arrival: '08:00', departure: '16:30' }), null);
  assert.match(validateDay({ date: '2025-03-03', type: 'work', arrival: '16:00', departure: '08:00' }), /dříve/);
  assert.match(validateDay({ date: '2025-03-03', type: 'work', arrival: null, departure: '08:00' }), /příchod/);
  assert.match(validateDay({ date: '2025-02-30', type: 'work' }), /datum/);
  assert.match(validateDay({ date: '2025-03-03', type: 'comp' }, 100), /chybí/);
  assert.equal(validateDay({ date: '2025-03-03', type: 'comp' }, 480), null);
  assert.equal(validateDay({ date: '2025-03-01', type: 'comp' }, 0), null); // víkend nic nečerpá
});

test('CSV: BOM, středník, CRLF, escapování', () => {
  const csv = buildMonthCsv(
    [...records, { date: '2025-03-11', type: 'work', arrival: '08:00', departure: '16:30', note: 'Porada; "důležitá"' }],
    withdrawals, 2025, 3,
  );
  assert.ok(csv.startsWith('﻿Datum;Den;Typ;'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes('03.03.2025;Po;Pracovní;07:00;17:00;10:00;0:30;9:30;1:30;1,50;'));
  assert.ok(csv.includes('06.03.2025;Čt;Náhradní volno;;;;;8:00;-8:00;-8,00;'));
  assert.ok(csv.includes('"Porada; ""důležitá"""'));
  assert.ok(!csv.includes('28.02.2025'));
  assert.ok(csv.includes('Fond;168:00'));
});

test('nastavitelné pravidlo přestávky (výchozí beze změny)', () => {
  assert.equal(toRules().BREAK_MIN, 30);
  assert.equal(toRules(450).DAILY_FUND_MIN, 450);          // číslo = denní fond (zpětná kompatibilita)
  assert.equal(toRules(450).BREAK_INTERVAL_MIN, 360);
  const r = { BREAK_INTERVAL_MIN: 4.5 * H, BREAK_MIN: 45 };
  assert.equal(breakMinutes(4.5 * H - 1, r), 0);
  assert.equal(breakMinutes(4.5 * H, r), 45);
  assert.equal(breakMinutes(9 * H, r), 90);
  assert.equal(workedMinutes('08:00', '17:00', r), 7.5 * H);
  const res = dayResult({ date: '2025-03-03', type: 'work', arrival: '07:00', departure: '16:00' }, r);
  assert.equal(res.break, 90);
  assert.equal(res.overtime, -30);
  // bez přestávky
  assert.equal(dayResult({ date: '2025-03-03', type: 'work', arrival: '07:00', departure: '15:00' }, { BREAK_MIN: 0 }).overtime, 0);
  assert.match(describeBreakRule(), /každých celých 6:00 h pobytu se odečte 30 min/);
  assert.match(describeBreakRule({ BREAK_MIN: 0 }), /neodečítá/);
  // bez pravidel = původní výsledky
  assert.equal(bankBalance(records, withdrawals), bankBalance(records, withdrawals, {}));
});

test('verzovaná pravidla: starší dny podle původních pravidel', () => {
  const rules = {
    versions: [
      { from: '0000-01-01', DAILY_FUND_MIN: 480, BREAK_INTERVAL_MIN: 360, BREAK_MIN: 30 },
      { from: '2025-03-10', DAILY_FUND_MIN: 450, BREAK_INTERVAL_MIN: 360, BREAK_MIN: 45 },
    ],
  };
  assert.equal(rulesForDate(rules, '2025-03-09').BREAK_MIN, 30);
  assert.equal(rulesForDate(rules, '2025-03-10').BREAK_MIN, 45);
  assert.equal(toRules(rules).DAILY_FUND_MIN, 450);          // bez data = aktuální
  const day = (date) => dayResult({ date, type: 'work', arrival: '07:00', departure: '15:30' }, rules);
  assert.equal(day('2025-03-07').overtime, 0);                 // 8:30 − 0:30 − 8:00
  assert.equal(day('2025-03-11').overtime, 15);                // 8:30 − 0:45 − 7:30
  // fond března: 5 dnů po 8 h (3.–7.) + 16 dnů po 7:30
  assert.equal(monthFund(2025, 3, rules), 5 * 480 + 16 * 450);
  assert.equal(monthFund(2025, 3), 21 * 480);
});
