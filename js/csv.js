/**
 * Export měsíce do CSV pro Excel: UTF-8 s BOM, oddělovač středník, konce řádků CRLF.
 * buildMonthCsv je čistá funkce (testovatelná v Node), downloadCsv pracuje s DOM.
 */
import {
  DAY_TYPE_LABELS, MONTH_LABELS, daysInMonth, toDateString, weekdayLabel, holidayName,
  dayResult, monthSummary, formatMinutes, formatHoursDecimal,
} from './calc.js';

const BOM = '﻿';
const SEP = ';';

function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values) {
  return values.map(cell).join(SEP);
}

/** Text CSV (včetně BOM) pro zvolený měsíc. */
export function buildMonthCsv(records, withdrawals, y, m, dailyFund = undefined) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const lines = [];
  lines.push(row([
    'Datum', 'Den', 'Typ', 'Příchod', 'Odchod', 'Pobyt', 'Přestávka',
    'Odpracováno', 'Přesčas', 'Přesčas (h)', 'Poznámka',
  ]));

  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = toDateString(y, m, d);
    const r = byDate.get(date);
    if (!r) continue;
    let res;
    try {
      res = dayResult(r, dailyFund);
    } catch {
      res = null;
    }
    const holiday = holidayName(date);
    const absenceNote = res?.partial ? `${DAY_TYPE_LABELS[r.type]} ${formatMinutes(res.absence)} h` : '';
    const note = [r.filled ? 'doplněno' : '', absenceNote, r.note, holiday].filter(Boolean).join(' | ');
    lines.push(row([
      date.split('-').reverse().join('.'),
      weekdayLabel(date),
      DAY_TYPE_LABELS[r.type] ?? r.type,
      r.arrival ?? '',
      r.departure ?? '',
      res?.stay != null ? formatMinutes(res.stay) : '',
      res?.stay != null ? formatMinutes(res.break) : '',
      res ? formatMinutes(res.credited) : '',
      res ? formatMinutes(res.bankDelta) : '',
      res ? formatHoursDecimal(res.bankDelta) : '',
      note,
    ]));
  }

  const monthPrefix = `${y}-${String(m).padStart(2, '0')}-`;
  const monthWithdrawals = withdrawals.filter((w) => w.date?.startsWith(monthPrefix));
  if (monthWithdrawals.length) {
    lines.push('');
    lines.push(row(['Výběry z banky přesčasů']));
    lines.push(row(['Datum', 'Hodiny', 'Poznámka']));
    for (const w of [...monthWithdrawals].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push(row([w.date.split('-').reverse().join('.'), formatMinutes(w.minutes), w.note ?? '']));
    }
  }

  const s = monthSummary(records, y, m, withdrawals, dailyFund);
  lines.push('');
  lines.push(row([`Souhrn ${MONTH_LABELS[m - 1]} ${y}`]));
  lines.push(row(['Pracovní dny', s.workdays]));
  lines.push(row(['Fond', formatMinutes(s.fund)]));
  lines.push(row(['Odpracováno (vč. započtených dnů)', formatMinutes(s.credited)]));
  lines.push(row(['Přesčas za měsíc', formatMinutes(s.overtime)]));
  lines.push(row(['Čerpáno z banky', formatMinutes(s.used)]));

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
