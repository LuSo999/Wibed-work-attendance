/**
 * Export měsíce do CSV pro Excel: UTF-8 s BOM, oddělovač středník, konce řádků CRLF.
 * Hlavičky, typy dnů a desetinný oddělovač podle jazyka (cs čárka, en tečka).
 * buildMonthCsv je čistá funkce (testovatelná v Node), downloadCsv pracuje s DOM.
 * Texty bere výhradně ze slovníků (js/i18n/*.js).
 */
import {
  daysInMonth, toDateString, holidayName, dayResult, monthSummary, formatMinutes, formatHoursDecimal,
} from './calc.js';
import {
  translator, weekdayShort, formatMonthYear, decimalSeparator, DEFAULT_LANGUAGE,
} from './i18n.js';

const BOM = '\uFEFF';
const SEP = ';';

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values) {
  return values.map(cell).join(SEP);
}

/** Datum v CSV: cs 'DD.MM.YYYY', en 'YYYY-MM-DD' (ISO, Excel ho rozpozná). */
const csvDate = (date, lang) => (lang === 'cs' ? date.split('-').reverse().join('.') : date);

/**
 * Text CSV (včetně BOM) pro zvolený měsíc.
 * @param {object} [options] { lang: 'cs' | 'en' } – jazyk hlaviček a formát čísel (výchozí čeština)
 */
export function buildMonthCsv(records, withdrawals, y, m, rules = undefined, { lang = DEFAULT_LANGUAGE } = {}) {
  const t = translator(lang);
  const dec = decimalSeparator(lang);
  const byDate = new Map(records.map((r) => [r.date, r]));
  const lines = [];
  lines.push(row([
    'csv.date', 'csv.day', 'csv.type', 'csv.arrival', 'csv.departure', 'csv.stay', 'csv.break',
    'csv.worked', 'csv.overtime', 'csv.overtimeHours', 'csv.note',
  ].map((k) => t(k))));

  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = toDateString(y, m, d);
    const r = byDate.get(date);
    if (!r) continue;
    let res;
    try {
      res = dayResult(r, rules);
    } catch {
      res = null;
    }
    const holiday = holidayName(date);
    const typeLabel = t(`type.${r.type}`);
    const absenceNote = res?.partial ? `${typeLabel} ${formatMinutes(res.absence)} h` : '';
    const note = [r.filled ? t('tag.filled') : '', absenceNote, r.note, holiday ? t(holiday) : ''].filter(Boolean).join(' | ');
    lines.push(row([
      csvDate(date, lang),
      weekdayShort(date, lang),
      typeLabel,
      r.arrival ?? '',
      r.departure ?? '',
      res?.stay != null ? formatMinutes(res.stay) : '',
      res?.stay != null ? formatMinutes(res.break) : '',
      res ? formatMinutes(res.credited) : '',
      res ? formatMinutes(res.bankDelta) : '',
      res ? formatHoursDecimal(res.bankDelta, dec) : '',
      note,
    ]));
  }

  const monthPrefix = `${y}-${String(m).padStart(2, '0')}-`;
  const monthWithdrawals = withdrawals.filter((w) => w.date?.startsWith(monthPrefix));
  if (monthWithdrawals.length) {
    lines.push('');
    lines.push(row([t('csv.withdrawals')]));
    lines.push(row([t('csv.date'), t('csv.hours'), t('csv.note')]));
    for (const w of [...monthWithdrawals].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push(row([csvDate(w.date, lang), formatMinutes(w.minutes), w.note ?? '']));
    }
  }

  const s = monthSummary(records, y, m, withdrawals, rules);
  lines.push('');
  lines.push(row([t('csv.summary', { month: formatMonthYear(y, m, lang) })]));
  lines.push(row([t('csv.workdays'), s.workdays]));
  lines.push(row([t('csv.fund'), formatMinutes(s.fund)]));
  lines.push(row([t('csv.credited'), formatMinutes(s.credited)]));
  lines.push(row([t('csv.monthOvertime'), formatMinutes(s.overtime)]));
  lines.push(row([t('csv.used'), formatMinutes(s.used)]));

  return BOM + lines.join('\r\n') + '\r\n';
}

/** Stáhne CSV jako soubor (jen v prohlížeči). */
export function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
