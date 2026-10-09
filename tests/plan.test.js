// Spuštění: node --test
// Většina scénářů používá únor 2027: 20 pracovních dnů, bez svátků, fond 160 h,
// 1. 2. je pondělí ISO týdne 5 (lichý).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, normalizeSettings, settingsWarnings, leaveWarning, arrivalWarning, isoWeek,
  weekParity, scheduledLeave, workedForStay, stayForWorked, buildMonthPlan, fillRecord, fillCandidates,
  rulesFromSettings, switchAnchorMode, timeWarnings, validateOverride, bulkClearFixed, isEmptyOverride,
  applyRuleChange, ruleChangeImpact, isRuleChange, mergeClearFixed, RULES_SINCE_EVER, holidayChangeImpact,
  CORE_WARNING_KEYS,
} from '../js/plan.js';
import {
  dayResult, monthFund, configureHolidays, holidaysEnabled,
} from '../js/calc.js';

const keys = (list) => list.map((m) => m.key);

const H = 60;
const FEB_FUND = 20 * 8 * H;

function settings(patch = {}) {
  // bez ruleVersions, aby se pravidla z patche (fond, přestávka) převzala jako jediná verze
  const { ruleVersions, ...base } = normalizeSettings(DEFAULT_SETTINGS);
  return normalizeSettings({
    ...base,
    ...patch,
    schedule: {
      odd: { ...base.schedule.odd, ...patch.schedule?.odd },
      even: { ...base.schedule.even, ...patch.schedule?.even },
    },
  });
}

function plan({ today = '2027-02-01', records = [], overrides = [], year = 2027, month = 2, ...patch } = {}) {
  return buildMonthPlan({ year, month, today, settings: settings(patch), records, overrides });
}

const total = (p) => p.summary.projected;
const day = (p, date) => p.days.find((d) => d.date === date);
const work = (date, arrival, departure, extra = {}) => ({ date, type: 'work', arrival, departure, ...extra });

test('výchozí nastavení a normalizace', () => {
  const s = normalizeSettings({});
  assert.equal(s.anchorMode, 'arrival');
  assert.equal(s.anchorTime, '06:00');
  assert.equal(s.earliestArrival, '05:00');
  assert.equal(s.latestDeparture, '17:00');
  assert.equal(s.coreStart, '09:00');
  assert.equal(s.coreEnd, '14:00');
  assert.equal(s.dailyFundHours, 8);
  assert.equal(s.maxWorkedHoursPerDay, 10);
  assert.equal(s.parityFlip, false);
  assert.deepEqual(s.schedule.odd[1], { arriveAt: '', leaveAt: '' });
  // kompatibilita: dřívější rozvrh jen s časem odchodu a dřívější startTime
  const legacy = normalizeSettings({ startTime: '06:30', schedule: { odd: { 2: '25:00', 3: '13:30' } } });
  assert.deepEqual(legacy.schedule.odd[3], { arriveAt: '', leaveAt: '13:30' });
  assert.deepEqual(legacy.schedule.odd[2], { arriveAt: '', leaveAt: '' });
  assert.equal(legacy.anchorTime, '06:30');
  assert.equal(normalizeSettings({ startTime: 'nesmysl' }).anchorTime, '06:00');
  assert.deepEqual(normalizeSettings({ schedule: { even: { 1: { arriveAt: '07:00', leaveAt: 'x' } } } }).schedule.even[1], { arriveAt: '07:00', leaveAt: '' });
});

test('přestávka na hranici 6 h a 12 h: nejmenší pobyt pro požadované hodiny', () => {
  assert.equal(workedForStay(6 * H - 1), 6 * H - 1);
  assert.equal(workedForStay(6 * H), 5.5 * H);
  assert.equal(stayForWorked(5.5 * H), 5.5 * H);       // 5:30 pobytu stačí (bez přestávky)
  assert.equal(stayForWorked(6 * H - 1), 6 * H - 1);
  assert.equal(stayForWorked(6 * H), 6.5 * H);         // 6:00 práce → 6:30 pobytu
  assert.equal(stayForWorked(8 * H), 8.5 * H);         // běžný den 8:30
  assert.equal(stayForWorked(11.5 * H), 12.5 * H);     // za hranicí 12 h
  assert.equal(stayForWorked(11 * H), 11.5 * H);
  for (let w = 1; w <= 14 * H; w++) {
    const s = stayForWorked(w);
    assert.ok(workedForStay(s) >= w && (s === 0 || workedForStay(s - 1) < w || s - 1 < w), `w=${w}`);
  }
});

test('ISO týden a parita včetně prohození', () => {
  assert.deepEqual(isoWeek('2027-02-01'), { year: 2027, week: 5 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.equal(weekParity('2027-02-01'), 'odd');
  assert.equal(weekParity('2027-02-08'), 'even');
  assert.equal(weekParity('2027-02-01', true), 'even');
  assert.equal(weekParity('2027-02-08', true), 'odd');
  const s = settings({ schedule: { odd: { 1: '14:30' }, even: { 1: '15:00' } } });
  assert.equal(scheduledLeave('2027-02-01', s), '14:30');
  assert.equal(scheduledLeave('2027-02-08', s), '15:00');
  assert.equal(scheduledLeave('2027-02-01', { ...s, parityFlip: true }), '15:00');
  assert.equal(scheduledLeave('2027-02-06', s), ''); // sobota
});

test('týden přes hranici měsíců: parita podle ISO týdne každého dne', () => {
  // 30. 9. (st) i 1. 10. 2026 (čt) jsou v týdnu 40 = sudý; 5. 10. je týden 41 = lichý
  assert.equal(isoWeek('2026-09-30').week, 40);
  assert.equal(isoWeek('2026-10-01').week, 40);
  const opts = { schedule: { even: { 3: '14:30', 4: '14:30' } }, today: '2026-09-01' };
  const sep = plan({ ...opts, year: 2026, month: 9 });
  const oct = plan({ ...opts, year: 2026, month: 10 });
  assert.equal(day(sep, '2026-09-30').kind, 'fixed');
  assert.equal(day(oct, '2026-10-01').kind, 'fixed');
  assert.equal(day(oct, '2026-10-01').parity, 'even');
  assert.equal(day(oct, '2026-10-08').kind, 'regular'); // čt týdne 41 (lichý)
});

test('pevný odchod: počítá se od kotvy příchodu, nebo od skutečného příchodu; nikdy se neprodlužuje', () => {
  const sched = { schedule: { odd: { 1: '14:30' } } };
  const p1 = plan(sched);
  const d1 = day(p1, '2027-02-01');
  assert.equal(d1.kind, 'fixed');
  assert.equal(d1.plannedLeave, '14:30');
  assert.equal(d1.plannedWorked, 8 * H);              // 06:00–14:30 = 8:30 − 0:30

  // pozdní příchod v 07:00: odchod zůstává 14:30, odpracuje jen 7:00
  const p2 = plan({ ...sched, records: [{ date: '2027-02-01', type: 'work', arrival: '07:00', departure: null }] });
  const d2 = day(p2, '2027-02-01');
  assert.equal(d2.plannedLeave, '14:30');
  assert.equal(d2.plannedWorked, 7 * H);
  assert.equal(d2.arrival, '07:00');
  // chybějící hodina se rozloží na běžné dny a měsíc vyjde na nulu
  assert.equal(total(p2), FEB_FUND);
  assert.equal(p2.summary.deviation, 0);
});

test('rovnoměrné rozložení deficitu po 15 min přes celý měsíc', () => {
  // lichý po a st odchod 14:00 → 4 pevné dny po 7:30 → deficit 2:00 = 8 × 15 min na 16 běžných dnů
  const p = plan({ schedule: { odd: { 1: '14:00', 3: '14:00' } } });
  const regular = p.days.filter((d) => d.kind === 'regular');
  assert.equal(regular.length, 16);
  assert.equal(total(p), FEB_FUND);
  const longer = regular.filter((d) => d.plannedWorked === 8 * H + 15);
  assert.equal(longer.length, 8);
  assert.ok(regular.every((d) => d.plannedWorked === 8 * H || d.plannedWorked === 8 * H + 15));
  // zbytek není nahromaděný na konci měsíce
  const idx = regular.map((d, i) => (d.plannedWorked > 8 * H ? i : null)).filter((i) => i !== null);
  assert.ok(idx[0] <= 1 && idx[idx.length - 1] >= 14, idx.join(','));
  // odchod respektuje přestávku: 8:15 práce → 8:45 pobytu
  assert.equal(longer[0].plannedLeave, '14:45');
});

test('přebytek: běžné dny se rovnoměrně zkrátí, nejvýš na odchod v coreEnd', () => {
  // 2 dny po 10:00 → přebytek 4:00 = 16 × 15 min na 18 zbývajících dnů
  const records = [work('2027-02-01', '06:00', '16:30'), work('2027-02-02', '06:00', '16:30')];
  const p = plan({ today: '2027-02-03', records });
  assert.equal(total(p), FEB_FUND);
  const regular = p.days.filter((d) => d.kind === 'regular');
  assert.equal(regular.filter((d) => d.plannedWorked === 8 * H - 15).length, 16);

  // velký přebytek: 10 dnů po 10:00 → přebytek 20:00, zkrátit lze jen 10 × 0:30
  const many = Array.from({ length: 10 }, (_, i) => work(['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12'][i], '06:00', '16:30'));
  const p2 = plan({ today: '2027-02-15', records: many });
  assert.ok(p2.days.filter((d) => d.kind === 'regular').every((d) => d.plannedLeave === '14:00' && d.plannedWorked === 7.5 * H));
  assert.equal(p2.summary.unbalanced, -15 * H);
  assert.deepEqual(p2.warnings[0], { key: 'plan.warn.surplusArr', params: { hours: '15:00', limit: '14:00' } });
});

test('zbytek pod 15 min: měsíc vyjde přesně na nulu', () => {
  // 06:00–14:37 → 8:07 → přebytek 7 min
  const p = plan({ today: '2027-02-02', records: [work('2027-02-01', '06:00', '14:37')] });
  assert.equal(total(p), FEB_FUND);
  const changed = p.days.filter((d) => d.kind === 'regular' && d.plannedWorked !== 8 * H);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].plannedWorked, 8 * H - 7);
});

test('částečný lékař: 6 h práce + 2 h lékař = 8 h, přesčas 0', () => {
  const r = dayResult({ date: '2027-02-01', type: 'doctor', absenceHours: 2, arrival: '06:00', departure: '12:30' });
  assert.equal(r.worked, 6 * H);
  assert.equal(r.absence, 2 * H);
  assert.equal(r.credited, 8 * H);
  assert.equal(r.overtime, 0);
  assert.equal(r.bankDelta, 0);
  // bez absenceHours = původní chování (celý den)
  assert.equal(dayResult({ date: '2027-02-01', type: 'doctor' }).credited, 8 * H);
  // samotná nepřítomnost přesčas netvoří; 06:00–12:00 = 5:30 práce → −0:30
  assert.equal(dayResult({ date: '2027-02-01', type: 'doctor', absenceHours: 2, arrival: '06:00', departure: '12:00' }).overtime, -30);
  // částečné náhradní volno čerpá hodiny z banky
  assert.equal(dayResult({ date: '2027-02-01', type: 'comp', absenceHours: 2, arrival: '06:00', departure: '12:30' }).bankDelta, -2 * H);
  // v plánu: výjimka lékař 2 h → běžný den s cílem 6 h, odchod 12:30
  const p = plan({ overrides: [{ date: '2027-02-03', absenceType: 'doctor', absenceHours: 2 }] });
  const d = day(p, '2027-02-03');
  assert.equal(d.plannedWorked, 6 * H);
  assert.equal(d.plannedLeave, '12:30');
  assert.equal(total(p), FEB_FUND);
  // částečná nepřítomnost v den s pevným odchodem: nepřítomnost proběhne před odchodem,
  // pracovní blok se o ni zkrátí (06:00 + 3 h → 09:00–13:30 = 4:30 práce + 3 h lékař)
  const p2 = plan({
    schedule: { odd: { 3: '13:30' } },
    overrides: [{ date: '2027-02-03', absenceType: 'doctor', absenceHours: 3 }],
  });
  const d2 = day(p2, '2027-02-03');
  assert.equal(d2.kind, 'fixed');
  assert.equal(d2.arrival, '09:00');
  assert.equal(d2.plannedWorked, 4.5 * H);
  assert.equal(d2.credited, 7.5 * H);
  assert.equal(d2.plannedLeave, '13:30');
});

test('doplnění docházky', () => {
  const s = settings();
  assert.deepEqual(fillRecord('2027-02-01', undefined, s), {
    date: '2027-02-01', type: 'work', arrival: '06:00', departure: '14:30', absenceHours: null, note: '', filled: true,
  });
  // existující příchod se zachová
  assert.equal(fillRecord('2027-02-01', work('2027-02-01', '07:15', null), s).departure, '15:45');
  // částečný lékař 2 h → 6 h práce → pobyt 6:30
  const doc = fillRecord('2027-02-01', { date: '2027-02-01', type: 'doctor', absenceHours: 2, arrival: '08:00' }, s);
  assert.equal(doc.departure, '14:30');
  assert.equal(doc.absenceHours, 2);
  assert.equal(dayResult(doc).overtime, 0);
  // uzavřený den ani víkend se nedoplňují
  assert.equal(fillRecord('2027-02-01', work('2027-02-01', '06:00', '14:00'), s), null);
  assert.equal(fillRecord('2027-02-06', undefined, s), null);
  // celodenní výjimka → záznam nepřítomnosti
  assert.equal(fillRecord('2027-02-01', undefined, s, { date: '2027-02-01', absenceType: 'vacation' }).type, 'vacation');
  // hromadně: proběhlé pracovní dny bez uzavřeného záznamu
  const list = fillCandidates({
    year: 2027, month: 2, today: '2027-02-04', settings: s, records: [work('2027-02-02', '06:00', '15:00')], overrides: [],
  });
  assert.deepEqual(list.map((x) => x.date), ['2027-02-01', '2027-02-03']);
  assert.ok(list.every((x) => x.record.filled === true));
});

test('dovolená uprostřed měsíce je pevný den, ostatní dny zůstávají na 8 h', () => {
  const p = plan({ overrides: [{ date: '2027-02-10', absenceType: 'vacation' }] });
  const d = day(p, '2027-02-10');
  assert.equal(d.kind, 'absence');
  assert.equal(d.credited, 8 * H);
  assert.equal(total(p), FEB_FUND);
  assert.ok(p.days.filter((x) => x.kind === 'regular').every((x) => x.plannedWorked === 8 * H));
  assert.equal(p.summary.regularDays, 19);
});

test('výjimka dne: pevné hodiny a pevný odchod, ostatní dny se dopočítají', () => {
  const p = plan({ overrides: [{ date: '2027-02-02', workedHours: 4 }] });
  const d = day(p, '2027-02-02');
  assert.equal(d.kind, 'override');
  assert.equal(d.plannedWorked, 4 * H);
  assert.equal(d.plannedLeave, '10:00');
  assert.equal(total(p), FEB_FUND);
  assert.equal(p.days.filter((x) => x.kind === 'regular' && x.plannedWorked === 8 * H + 15).length, 16);

  const p2 = plan({ overrides: [{ date: '2027-02-02', leaveAt: '13:00' }] });
  const d2 = day(p2, '2027-02-02');
  assert.equal(d2.kind, 'fixed');
  assert.equal(d2.plannedWorked, 6.5 * H);           // 7:00 pobytu − 0:30
  assert.equal(d2.warnings[0].key, 'plan.warn.leaveBeforeCore');
  assert.ok(CORE_WARNING_KEYS.has(d2.warnings[0].key));
  assert.equal(total(p2), FEB_FUND);
});

test('nevyrovnatelný měsíc: varování s chybějícími hodinami, přelití přes strop', () => {
  // 10 proběhlých dnů bez záznamu, strop 8:30 → zbývajících 10 dnů unese jen +5:00
  const p = plan({ today: '2027-02-15', maxWorkedHoursPerDay: 8.5 });
  assert.equal(p.summary.missingDays, 10);
  assert.ok(p.days.filter((d) => d.kind === 'regular').every((d) => d.plannedWorked === 8.5 * H));
  assert.equal(p.summary.unbalanced, 75 * H);
  assert.equal(p.warnings[0].key, 'plan.warn.shortArr');
  assert.equal(p.warnings[0].params.hours, '75:00');
  assert.deepEqual(p.warnings[1], { key: 'plan.warn.missingDays', params: { count: 10 } });

  // strop 8:15 a výjimka 2 h → deficit 6:00, 19 dnů unese 19 × 0:15 → chybí 1:15
  const p2 = plan({ maxWorkedHoursPerDay: 8.25, overrides: [{ date: '2027-02-02', workedHours: 2 }] });
  assert.ok(p2.days.filter((d) => d.kind === 'regular').every((d) => d.plannedWorked === 8 * H + 15));
  assert.equal(p2.warnings[0].params.hours, '1:15');
});

test('varování při odchodu před coreEnd a příchodu po coreStart (jen upozornění)', () => {
  const s = settings({ anchorTime: '09:30', schedule: { odd: { 2: '13:00' }, even: { 5: '14:00' } } });
  assert.deepEqual(leaveWarning('13:59', s), { key: 'plan.warn.core' });
  assert.equal(leaveWarning('14:00', s), null);
  assert.deepEqual(arrivalWarning('09:01', s), { key: 'plan.warn.core' });
  assert.equal(arrivalWarning('09:00', s), null);
  const w = settingsWarnings(s);
  assert.equal(w.length, 2);
  assert.ok(w.some((x) => x.field === 'anchorTime' && x.message.key === 'plan.warn.arrivalAfterCore'));
  assert.ok(w.some((x) => x.field === 'schedule' && x.week === 'odd' && x.day === 2));
  // nastavení s varováním se dá normálně použít pro plán
  assert.equal(plan({ anchorTime: '09:30', schedule: { odd: { 2: '13:00' } } }).summary.fund, FEB_FUND);
});

test('nastavitelný denní fond se promítne do fondu měsíce i přesčasu', () => {
  assert.equal(monthFund(2027, 2, 7.5 * H), 20 * 7.5 * H);
  assert.equal(dayResult(work('2027-02-01', '06:00', '14:00'), 7.5 * H).overtime, 0);
  const p = plan({ dailyFundHours: 7.5 });
  assert.equal(total(p), 20 * 7.5 * H);
  assert.equal(day(p, '2027-02-01').plannedLeave, '14:00');
});

test('vlastní pravidlo přestávky v plánu a doplnění', () => {
  // výchozí
  const def = rulesFromSettings(settings());
  assert.deepEqual([def.DAILY_FUND_MIN, def.BREAK_INTERVAL_MIN, def.BREAK_MIN], [480, 360, 30]);
  assert.equal(def.versions.length, 1);
  // 45 min po každých 6 h → běžný den 8:45 pobytu
  const s45 = settings({ breakLengthMinutes: 45 });
  const r45 = rulesFromSettings(s45);
  assert.equal(stayForWorked(8 * H, r45), 8 * H + 45);
  assert.equal(workedForStay(6 * H, r45), 5.25 * H);
  const p = plan({ breakLengthMinutes: 45 });
  assert.equal(day(p, '2027-02-01').plannedLeave, '14:45');
  assert.equal(total(p), FEB_FUND);
  assert.equal(fillRecord('2027-02-01', undefined, s45).departure, '14:45');
  // bez přestávky → 8 h pobytu
  assert.equal(day(plan({ breakLengthMinutes: 0 }), '2027-02-01').plannedLeave, '14:00');
  // přestávka po 4,5 h → 8 h práce = 8:30 pobytu (1 přestávka), 9 h práce = 10:00 pobytu (2 přestávky)
  const r45h = rulesFromSettings(settings({ breakAfterHours: 4.5 }));
  assert.equal(stayForWorked(8 * H, r45h), 8.5 * H);
  assert.equal(stayForWorked(9 * H, r45h), 10 * H);
  // neplatné pravidlo (přestávka ≥ interval) → výchozí hodnoty
  const bad = normalizeSettings({ breakAfterHours: 0.5, breakLengthMinutes: 30 });
  assert.equal(bad.breakAfterHours, 6);
  assert.equal(bad.breakLengthMinutes, 30);
  assert.equal(normalizeSettings({ breakLengthMinutes: 12.5 }).breakLengthMinutes, 30);
});

// ---------------------------------------------------------------------------
// Kotva příchod / odchod
// ---------------------------------------------------------------------------
const DEP = { anchorMode: 'departure', anchorTime: '14:30' };
const regularDays = (p) => p.days.filter((d) => d.kind === 'regular');

test('kotva odchodu: odchod pevný, příchod se dopočítá', () => {
  const p = plan(DEP);
  const d = day(p, '2027-02-01');
  assert.equal(d.kind, 'regular');
  assert.equal(d.flex, 'arrival');
  assert.equal(d.arrival, '06:00');
  assert.equal(d.plannedLeave, '14:30');
  assert.equal(total(p), FEB_FUND);
  // kotva příchodu: totéž zrcadlově
  const a = day(plan(), '2027-02-01');
  assert.equal(a.flex, 'leave');
  assert.equal(a.arrival, '06:00');
  assert.equal(a.plannedLeave, '14:30');
});

test('kotva odchodu: napracování posunem příchodu dřív', () => {
  // výjimka 4 h → deficit 4:00 = 16 × 15 min na 19 běžných dnů
  const p = plan({ ...DEP, overrides: [{ date: '2027-02-02', workedHours: 4 }] });
  assert.equal(total(p), FEB_FUND);
  const reg = regularDays(p);
  assert.ok(reg.every((d) => d.plannedLeave === '14:30'));
  assert.equal(reg.filter((d) => d.arrival === '05:45').length, 16);
  assert.equal(reg.filter((d) => d.arrival === '06:00').length, 3); // 19 běžných dnů − 16
  // výjimka s pevnými hodinami v režimu odchodu: odchod v kotvě, příchod dopočten
  const o = day(p, '2027-02-02');
  assert.equal(o.plannedLeave, '14:30');
  assert.equal(o.arrival, '10:30');
});

test('den s oběma pevnými časy je plně pevný v obou režimech', () => {
  const sched = { schedule: { odd: { 3: { arriveAt: '07:00', leaveAt: '13:00' } } } };
  for (const extra of [{}, DEP]) {
    const p = plan({ ...sched, ...extra });
    const d = day(p, '2027-02-03');
    assert.equal(d.kind, 'fixed');
    assert.equal(d.arrival, '07:00');
    assert.equal(d.plannedLeave, '13:00');
    assert.equal(d.plannedWorked, 5.5 * H);          // 6:00 pobytu − 0:30
    assert.equal(total(p), FEB_FUND);
    assert.ok(keys(d.warnings).includes('plan.warn.leaveBeforeCore'));
  }
});

test('den s jedním pevným časem: na straně kotvy plně pevný, jinak se druhý konec dopočítá', () => {
  // režim příchodu + jen odchod 14:00 → příchod z kotvy, plně pevný (dřívější chování)
  const a = day(plan({ schedule: { odd: { 1: '14:00' } } }), '2027-02-01');
  assert.equal(a.kind, 'fixed');
  assert.equal(a.plannedWorked, 7.5 * H);
  // režim příchodu + jen příchod 07:30 → odchod se dopočítá (posouvá)
  const b = day(plan({ schedule: { odd: { 1: { arriveAt: '07:30' } } } }), '2027-02-01');
  assert.equal(b.kind, 'regular');
  assert.equal(b.arrival, '07:30');
  assert.equal(b.plannedLeave, '16:00');
  // režim odchodu + jen odchod 13:00 → příchod se dopočítá, ale nejdříve 05:00
  const p = plan({ ...DEP, schedule: { odd: { 1: '13:00' } } });
  const c = day(p, '2027-02-01');
  assert.equal(c.kind, 'regular');
  assert.equal(c.flex, 'arrival');
  assert.equal(c.arrival, '05:00');                   // 13:00 − 8:30 = 04:30 → strop 05:00
  assert.equal(c.plannedWorked, 7.5 * H);
  assert.equal(total(p), FEB_FUND);                   // chybějící 0:30 se přelije na ostatní dny
  // režim odchodu + jen příchod 07:00 → odchod v kotvě, plně pevný
  const e = day(plan({ ...DEP, schedule: { odd: { 1: { arriveAt: '07:00' } } } }), '2027-02-01');
  assert.equal(e.kind, 'fixed');
  assert.equal(e.plannedLeave, '14:30');
  assert.equal(e.plannedWorked, 7 * H);
});

test('přepnutí režimu: převod kotvy a popis změn', () => {
  const s = settings({ schedule: { odd: { 1: '14:30', 2: { arriveAt: '07:00' }, 3: { arriveAt: '07:00', leaveAt: '15:00' } } } });
  const { settings: dep, changes } = switchAnchorMode(s, 'departure');
  assert.equal(dep.anchorMode, 'departure');
  assert.equal(dep.anchorTime, '14:30');              // 06:00 + 8:30 pobytu
  assert.deepEqual(changes[0], { key: 'plan.switch.toDeparture', params: { time: '14:30', old: '06:00', stay: '8:30' } });
  assert.deepEqual(keys(changes), ['plan.switch.toDeparture', 'plan.switch.shiftArrival', 'plan.switch.onlyLeaveToDep', 'plan.switch.onlyArriveToDep', 'plan.switch.both']);
  assert.ok(changes.slice(2).every((c) => c.params.count === 1));
  // zpět
  const back = switchAnchorMode(dep, 'arrival');
  assert.equal(back.settings.anchorTime, '06:00');
  assert.equal(switchAnchorMode(s, 'arrival').changes.length, 0);
  // stejný měsíc v obou režimech: běžné dny mají stejné hodiny
  const pa = buildMonthPlan({ year: 2027, month: 2, today: '2027-02-01', settings: s, records: [] });
  const pd = buildMonthPlan({ year: 2027, month: 2, today: '2027-02-01', settings: dep, records: [] });
  assert.equal(day(pa, '2027-02-04').plannedWorked, day(pd, '2027-02-04').plannedWorked);
  // pondělí lichého týdne: v režimu příchodu pevné, v režimu odchodu dopočítávané
  assert.equal(day(pa, '2027-02-01').kind, 'fixed');
  assert.equal(day(pd, '2027-02-01').kind, 'regular');
});

test('dnešek se skutečným příchodem: použije se a druhý konec se dopočítá', () => {
  const rec = [{ date: '2027-02-01', type: 'work', arrival: '06:20', departure: null }];
  // režim příchodu: odchod = 06:20 + pobyt
  const a = day(plan({ records: rec }), '2027-02-01');
  assert.equal(a.arrival, '06:20');
  assert.equal(a.plannedLeave, '14:50');
  assert.equal(a.actualArrival, true);
  // režim odchodu: odchod zůstává v kotvě, hodiny dne se z příchodu dopočítají
  const p = plan({ ...DEP, records: rec });
  const d = day(p, '2027-02-01');
  assert.equal(d.kind, 'fixed');
  assert.equal(d.arrival, '06:20');
  assert.equal(d.plannedLeave, '14:30');
  assert.equal(d.plannedWorked, 7 * H + 40);
  assert.equal(total(p), FEB_FUND);
});

test('stropy: nejdřívější příchod, nejpozdější odchod, max. hodiny', () => {
  // nejpozdější odchod 15:00 v režimu příchodu → max. pobyt 9:00 = 8:30 práce
  const p1 = plan({ latestDeparture: '15:00', today: '2027-02-15' });
  assert.ok(regularDays(p1).every((d) => d.plannedLeave === '15:00' && d.plannedWorked === 8.5 * H));
  assert.equal(p1.warnings[0].key, 'plan.warn.shortArr');
  assert.equal(p1.warnings[0].params.limit, '15:00');
  // nejdřívější příchod 05:45 v režimu odchodu → max. 8:45 pobytu = 8:15 práce
  const p2 = plan({ ...DEP, earliestArrival: '05:45', today: '2027-02-15' });
  assert.ok(regularDays(p2).every((d) => d.arrival === '05:45' && d.plannedWorked === 8 * H + 15));
  assert.equal(p2.warnings[0].key, 'plan.warn.shortDep');
  assert.equal(p2.warnings[0].params.limit, '05:45');
  // max. hodiny: strop 8:30 i při volných hranicích
  const p3 = plan({ ...DEP, maxWorkedHoursPerDay: 8.5, earliestArrival: '03:00', today: '2027-02-15' });
  assert.ok(regularDays(p3).every((d) => d.plannedWorked === 8.5 * H && d.arrival === '05:30'));
  // pevný čas mimo hranice → upozornění, ne zákaz
  assert.ok(keys(timeWarnings(4 * H, null, settings())).includes('plan.warn.beforeEarliest'));
  assert.ok(keys(timeWarnings(null, 18 * H, settings())).includes('plan.warn.afterLatest'));
});

test('nevyrovnatelný měsíc v režimu odchodu (přebytek i nedostatek)', () => {
  // přebytek: zkracuje se posunem příchodu nejvýš na coreStart 09:00
  const many = ['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12']
    .map((date) => ({ date, type: 'work', arrival: '05:00', departure: '17:00' }));
  const p = plan({ ...DEP, today: '2027-02-15', records: many });
  assert.ok(regularDays(p).every((d) => d.arrival === '09:00'));
  assert.equal(p.warnings[0].key, 'plan.warn.surplusDep');
  assert.equal(p.warnings[0].params.limit, '09:00');
  // nedostatek
  const p2 = plan({ ...DEP, today: '2027-02-22' });
  assert.ok(p2.summary.unbalanced > 0);
  assert.equal(p2.warnings[0].key, 'plan.warn.shortDep');
});

test('doplnění docházky v režimu odchodu dopočítá příchod zpět od kotvy', () => {
  const dep = settings(DEP);
  const r = fillRecord('2027-02-01', undefined, dep);
  assert.equal(r.arrival, '06:00');
  assert.equal(r.departure, '14:30');
  // zaznamenaný příchod má přednost
  assert.equal(fillRecord('2027-02-01', { date: '2027-02-01', type: 'work', arrival: '07:00' }, dep).departure, '15:30');
  // pevný odchod z rozvrhu
  assert.equal(fillRecord('2027-02-01', undefined, settings({ ...DEP, schedule: { odd: { 1: '13:30' } } })).arrival, '05:00');
});

// ---------------------------------------------------------------------------
// Výjimky: jiný čas, zrušení pevného času z rozvrhu, hromadné akce, poznámky
// ---------------------------------------------------------------------------
const MON_WED_14 = { schedule: { odd: { 1: '14:00', 3: '14:00' } } };

test('výjimka s jiným odchodem než rozvrh', () => {
  const p = plan({ schedule: { odd: { 1: '14:30' } }, overrides: [{ date: '2027-02-01', leaveAt: '15:30' }] });
  const d = day(p, '2027-02-01');
  assert.equal(d.kind, 'fixed');
  assert.equal(d.plannedLeave, '15:30');
  assert.equal(d.plannedWorked, 9 * H);
  assert.equal(total(p), FEB_FUND);
});

test('zrušení pevného času z rozvrhu: den je běžný a podílí se na deficitu', () => {
  const base = plan(MON_WED_14);                       // 4 pevné dny po 7:30 → deficit 2:00
  assert.equal(day(base, '2027-02-01').kind, 'fixed');
  const p = plan({ ...MON_WED_14, overrides: [{ date: '2027-02-01', clearFixed: 'leave' }] });
  const d = day(p, '2027-02-01');
  assert.equal(d.kind, 'regular');
  assert.equal(d.clearedFixed, 'leave');
  assert.equal(d.explicitLeave, false);
  assert.equal(total(p), FEB_FUND);
  // deficit 1:30 (3 pevné dny) se rozloží na 17 běžných dnů včetně odblokovaného pondělí
  assert.equal(regularDays(p).length, 17);
  assert.equal(regularDays(p).filter((x) => x.plannedWorked === 8 * H + 15).length, 6);
  // clearFixed ruší jen rozvrh, ne kotvu: příchod zůstává 06:00
  assert.equal(d.arrival, '06:00');
  // zrušení pevného příchodu u dne bez pevného příchodu nic nemění
  assert.equal(day(plan({ ...MON_WED_14, overrides: [{ date: '2027-02-01', clearFixed: 'arrival' }] }), '2027-02-01').kind, 'fixed');
});

test('hromadné zrušení pevných časů v rozsahu a vrácení jedním krokem', () => {
  const sched = { schedule: { odd: { 1: '14:00', 3: '14:00' }, even: { 2: { arriveAt: '07:00', leaveAt: '15:00' } } } };
  const existing = [{ date: '2027-02-09', note: 'zubař v 7:00' }];
  const ops = bulkClearFixed({ from: '2027-02-01', to: '2027-02-12', what: 'leave', today: '2027-02-03', settings: settings(sched), overrides: existing });
  // jen dnešní/budoucí pracovní dny, které pevný odchod v rozvrhu mají
  assert.deepEqual(ops.map((o) => o.date), ['2027-02-03', '2027-02-09']);
  assert.equal(ops[0].before, null);
  assert.deepEqual(ops[1].after, { date: '2027-02-09', note: 'zubař v 7:00', clearFixed: 'leave' });
  const applied = [...existing.filter((o) => !ops.some((x) => x.date === o.date)), ...ops.map((o) => o.after)];
  const p = plan({ ...sched, today: '2027-02-03', overrides: applied });
  assert.equal(day(p, '2027-02-03').kind, 'regular');
  assert.equal(day(p, '2027-02-09').kind, 'regular');  // příchod 07:00 zůstává pevný, odchod se dopočítá
  assert.equal(day(p, '2027-02-09').arrival, '07:00');
  assert.equal(day(p, '2027-02-09').note, 'zubař v 7:00');
  assert.equal(total(p), FEB_FUND);
  // vrácení: obnoví se stav „before“
  const undone = ops.map((o) => o.before).filter(Boolean);
  const p2 = plan({ ...sched, today: '2027-02-03', overrides: undone });
  assert.equal(day(p2, '2027-02-03').kind, 'fixed');
  assert.equal(day(p2, '2027-02-09').kind, 'fixed');
  // opakované spuštění nic nezmění; 'arrival' doplní jen dny s pevným příchodem
  assert.equal(bulkClearFixed({ from: '2027-02-01', to: '2027-02-12', what: 'leave', today: '2027-02-03', settings: settings(sched), overrides: applied }).length, 0);
  const arrOps = bulkClearFixed({ from: '2027-02-01', to: '2027-02-12', what: 'arrival', today: '2027-02-03', settings: settings(sched), overrides: applied });
  assert.deepEqual(arrOps.map((o) => [o.date, o.after.clearFixed]), [['2027-02-09', 'both']]);
  assert.equal(mergeClearFixed('leave', 'arrival'), 'both');
  assert.equal(mergeClearFixed(null, null), null);
});

test('zrušení výjimky vrátí den do stavu podle rozvrhu', () => {
  const ov = { date: '2027-02-01', leaveAt: '16:00', clearFixed: 'leave', note: 'porada' };
  assert.equal(day(plan({ ...MON_WED_14, overrides: [ov] }), '2027-02-01').plannedLeave, '16:00');
  const back = day(plan({ ...MON_WED_14, overrides: [] }), '2027-02-01');
  assert.equal(back.kind, 'fixed');
  assert.equal(back.plannedLeave, '14:00');
  assert.equal(back.note, '');
  assert.equal(isEmptyOverride({ date: '2027-02-01', note: '  ' }), true);
  assert.equal(isEmptyOverride({ date: '2027-02-01', clearFixed: 'leave' }), false);
  assert.equal(isEmptyOverride({ date: '2027-02-01', note: 'x' }), false);
});

test('validace výjimky: odchod po příchodu, poznámka, upozornění', () => {
  const s = settings({ schedule: { odd: { 1: '14:30' } } });
  assert.equal(validateOverride({ date: '2027-02-01', arriveAt: '10:00', leaveAt: '09:00' }, s).error.key, 'plan.error.leaveBeforeArrival');
  // pevný příchod z výjimky po odchodu z rozvrhu
  assert.deepEqual(validateOverride({ date: '2027-02-01', arriveAt: '15:00' }, s).error, { key: 'plan.error.leaveBeforeArrival', params: { leave: '14:30', arrival: '15:00' } });
  // po zrušení pevného odchodu je stejný příchod v pořádku
  assert.equal(validateOverride({ date: '2027-02-01', arriveAt: '15:00', clearFixed: 'leave' }, s).error, null);
  assert.deepEqual(validateOverride({ date: '2027-02-01', note: 'x'.repeat(201) }, s).error, { key: 'plan.error.noteTooLong', params: { max: 200 } });
  assert.equal(validateOverride({ date: '2027-02-01', note: 'x'.repeat(200) }, s).error, null);
  assert.equal(validateOverride({ date: '2027-02-01', clearFixed: 'nic' }, s).error.key, 'plan.error.clearFixed');
  assert.equal(validateOverride({ date: '2027-02-01', arriveAt: '25:00' }, s).error.key, 'error.invalidArrival');
  // odchod před coreEnd je jen upozornění
  const v = validateOverride({ date: '2027-02-01', leaveAt: '12:00' }, s);
  assert.equal(v.error, null);
  assert.equal(v.warnings[0].key, 'plan.warn.leaveBeforeCore');
  assert.deepEqual(v.warnings[0].params, { time: '12:00', core: '14:00' });
});

test('poznámka výjimky přežije přepočet plánu', () => {
  const ov = { date: '2027-02-15', note: 'Vyzvednout Aničku', clearFixed: 'leave' };
  const p1 = plan({ ...MON_WED_14, overrides: [ov] });
  // jiné záznamy změní deficit i plán dne, poznámka zůstává
  const p2 = plan({ ...MON_WED_14, today: '2027-02-03', overrides: [ov], records: [work('2027-02-01', '06:00', '17:00'), work('2027-02-02', '06:00', '17:00')] });
  assert.equal(day(p1, '2027-02-15').note, 'Vyzvednout Aničku');
  assert.equal(day(p2, '2027-02-15').note, 'Vyzvednout Aničku');
  assert.notEqual(day(p1, '2027-02-15').plannedWorked, day(p2, '2027-02-15').plannedWorked);
});

test('změna pravidel: verze s datem platnosti a dopad na banku', () => {
  const s = settings();
  const records = ['2027-02-01', '2027-02-02', '2027-02-03'].map((d) => work(d, '06:00', '14:30'));
  assert.equal(isRuleChange(s, { breakLengthMinutes: 45 }), true);
  assert.equal(isRuleChange(s, { breakLengthMinutes: 30 }), false);
  assert.equal(isRuleChange(s, { maxWorkedHoursPerDay: 9 }), false);
  // zpětně: všechny 3 dny o 15 min méně
  const all = applyRuleChange(s, { breakLengthMinutes: 45 }, RULES_SINCE_EVER);
  assert.equal(all.ruleVersions.length, 1);
  assert.deepEqual(ruleChangeImpact({ records, settings: s, next: all }), { balanceBefore: 0, balanceAfter: -45, affectedDays: 3 });
  // od 3. 2.: starší dny podle původních pravidel
  const fromWed = applyRuleChange(s, { breakLengthMinutes: 45 }, '2027-02-03');
  assert.equal(fromWed.ruleVersions.length, 2);
  assert.equal(fromWed.breakLengthMinutes, 45);       // aktuální = poslední verze
  assert.deepEqual(ruleChangeImpact({ records, settings: s, next: fromWed }), { balanceBefore: 0, balanceAfter: -15, affectedDays: 1 });
  // fond 7,5 h od 15. 2.: fond měsíce = 10 dnů × 8 h + 10 dnů × 7,5 h
  const fund75 = applyRuleChange(s, { dailyFundHours: 7.5 }, '2027-02-15');
  const p = buildMonthPlan({ year: 2027, month: 2, today: '2027-02-01', settings: fund75, records: [] });
  assert.equal(p.summary.fund, 10 * 8 * H + 10 * 7.5 * H);
  assert.equal(total(p), p.summary.fund);
  assert.equal(day(p, '2027-02-12').plannedLeave, '14:30');
  assert.equal(day(p, '2027-02-15').plannedLeave, '14:00');
  // novější změna s dřívějším datem nahradí pozdější verze
  const again = applyRuleChange(fund75, { breakLengthMinutes: 45 }, '2027-02-10');
  assert.deepEqual(again.ruleVersions.map((v) => [v.from, v.dailyFundHours, v.breakLengthMinutes]), [[RULES_SINCE_EVER, 8, 30], ['2027-02-10', 7.5, 45]]);
  // uložené nastavení bez verzí (starší formát) = jedna verze z hodnot nastavení
  assert.deepEqual(normalizeSettings({ breakLengthMinutes: 45 }).ruleVersions, [{ from: RULES_SINCE_EVER, dailyFundHours: 8, breakAfterHours: 6, breakLengthMinutes: 45 }]);
});

// ---------------------------------------------------------------------------
// Plán se zapnutými a vypnutými českými svátky
// ---------------------------------------------------------------------------
test('plán: svátek je volno, po vypnutí svátků běžný pracovní den', () => {
  // prosinec 2027: 23 po–pá; svátky v pracovní dny jen 24. (pá), 25. a 26. jsou víkend
  const on = buildMonthPlan({ year: 2027, month: 12, today: '2027-12-01', settings: settings(), records: [] });
  assert.equal(day(on, '2027-12-24').kind, 'off');
  assert.equal(day(on, '2027-12-24').holiday, 'holiday.christmasEve');
  assert.equal(on.summary.fund, 22 * 8 * H);
  const was = holidaysEnabled();
  configureHolidays({ enabled: false });
  try {
    const off = buildMonthPlan({ year: 2027, month: 12, today: '2027-12-01', settings: settings(), records: [] });
    assert.equal(day(off, '2027-12-24').kind, 'regular');
    assert.equal(day(off, '2027-12-24').holiday, null);
    assert.equal(off.summary.fund, 23 * 8 * H);
    assert.equal(off.summary.projected, off.summary.fund);
  } finally {
    configureHolidays({ enabled: was });
  }
});

test('dopad vypnutí svátků na banku a uzavřené dny (konfigurace se vrátí)', () => {
  const recs = [
    { date: '2025-12-24', type: 'work', arrival: '08:00', departure: '12:00' }, // svátek: +4:00, bez svátku −4:00
    { date: '2025-12-23', type: 'work', arrival: '06:00', departure: '14:30' }, // beze změny
  ];
  const impact = holidayChangeImpact({ records: recs, settings: settings(), enabled: false });
  assert.deepEqual(impact, { balanceBefore: 4 * H, balanceAfter: -4 * H, affectedDays: 1 });
  assert.equal(holidaysEnabled(), true);
  // zpětné zapnutí při vypnutých svátcích
  configureHolidays({ enabled: false });
  try {
    assert.deepEqual(holidayChangeImpact({ records: recs, settings: settings(), enabled: true }), { balanceBefore: -4 * H, balanceAfter: 4 * H, affectedDays: 1 });
    assert.equal(holidaysEnabled(), false);
  } finally {
    configureHolidays({ enabled: true });
  }
});
