// Slovníky a překlady: úplnost (každý klíč v cs i en), použité klíče existují,
// žádné natvrdo napsané české texty mimo slovníky. Spouští se jen v Node (čte soubory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import cs from '../js/i18n/cs.js';
import en from '../js/i18n/en.js';
import {
  t, tr, setLanguage, getLanguage, translator, formatMonthYear, weekdayShort, weekdayName, formatDateShort,
  decimalSeparator, DEFAULT_LANGUAGE, storedLanguage,
} from '../js/i18n.js';
import { DAY_TYPES } from '../js/calc.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const jsFiles = () => readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);

const params = (text) => new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const forms = (entry) => (typeof entry === 'object' ? Object.values(entry) : [entry]);

test('slovníky cs a en mají stejné klíče a parametry', () => {
  const csKeys = Object.keys(cs).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(csKeys.filter((k) => !(k in en)), [], 'chybí v en');
  assert.deepEqual(enKeys.filter((k) => !(k in cs)), [], 'chybí v cs');
  for (const key of csKeys) {
    const a = new Set(forms(cs[key]).flatMap((f) => [...params(f)]));
    const b = new Set(forms(en[key]).flatMap((f) => [...params(f)]));
    assert.deepEqual([...a].sort(), [...b].sort(), `parametry klíče ${key}`);
    assert.equal(typeof cs[key] === 'object', typeof en[key] === 'object', `množné číslo u ${key}`);
  }
});

test('množná čísla mají všechny tvary jazyka', () => {
  for (const [dict, cats] of [[cs, ['one', 'few', 'many', 'other']], [en, ['one', 'other']]]) {
    for (const [key, entry] of Object.entries(dict)) {
      if (typeof entry === 'object') assert.deepEqual(Object.keys(entry).sort(), [...cats].sort(), key);
    }
  }
});

/** Klíče použité v kódu a HTML (řetězce ve tvaru jmenný-prostor.klíč). */
const NAMESPACES = 'app|brand|common|lang|theme|nav|menu|status|setup|auth|type|parity|anchor|holiday|holidays|field|time|error|break|bank|entry|today|month|day|fill|week|schedule|settings|plan|summary|table|legend|tag|ov|bulk|rules|impact|csv|toast';
const KEY_RE = new RegExp(`['"\`]((?:${NAMESPACES})\\.[A-Za-z0-9_.-]+?)['"\`]`, 'g');

test('každý klíč použitý v kódu existuje ve slovnících', () => {
  const used = new Set();
  for (const file of [...jsFiles(), 'index.html']) {
    const src = read(file);
    for (const m of src.matchAll(KEY_RE)) if (!m[1].endsWith('.js')) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-attr)?="([^"]+)"/g)) {
      for (const part of m[1].split(';')) used.add(part.includes(':') ? part.split(':')[1].trim() : part.trim());
    }
  }
  // dynamicky skládané klíče
  for (const type of Object.values(DAY_TYPES)) used.add(`type.${type}`);
  for (const k of ['odd', 'even']) used.add(`parity.${k}`).add(`parity.short.${k}`);
  for (const k of ['system', 'light', 'dark']) used.add(`theme.${k}`);
  for (const k of ['arrival', 'departure']) used.add(`anchor.${k}`);
  for (const k of ['leave', 'arrival', 'both']) used.add(`tag.cleared.${k}`).add(`bulk.${k}`);
  for (const k of ['cs', 'en']) used.add(`lang.${k}`);
  const missing = [...used].filter((k) => /^[a-z]+\.[\w.-]+$/.test(k) && !(k in cs)).sort();
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------
// Kontrola natvrdo napsaných českých textů
// ---------------------------------------------------------------------------
const CZECH = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/;

/** Obsah řetězcových literálů (bez komentářů a regulárních výrazů) v JS zdrojáku. */
function stringLiterals(src) {
  const out = [];
  const templates = []; // hloubka závorek uvnitř ${…} pro vnořené šablony
  let i = 0;
  let last = ''; // poslední významný znak kódu
  let word = ''; // poslední slovo (kvůli regex po return/typeof…)
  const readTemplate = (start) => {
    let j = start;
    let text = '';
    while (j < src.length) {
      if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; continue; }
      if (src[j] === '`') { out.push(text); return j + 1; }
      if (src[j] === '$' && src[j + 1] === '{') { out.push(text); templates.push(0); return j + 2; }
      text += src[j++];
    }
    return j;
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; continue; }
        text += src[j++];
      }
      out.push(text);
      i = j + 1;
      last = 'a';
      continue;
    }
    if (c === '`') { i = readTemplate(i + 1); last = 'a'; continue; }
    if (c === '/') {
      const regexAllowed = !last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || ['return', 'typeof', 'case'].includes(word);
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length && (src[j] !== '/' || inClass)) {
          if (src[j] === '\\') j++;
          else if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          j++;
        }
        i = j + 1;
        while (/[a-z]/.test(src[i])) i++;
        last = 'a';
        continue;
      }
    }
    if (templates.length) {
      if (c === '{') templates[templates.length - 1]++;
      if (c === '}') {
        if (templates[templates.length - 1] === 0) { templates.pop(); i = readTemplate(i + 1); last = 'a'; continue; }
        templates[templates.length - 1]--;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      word = m[0];
      i += word.length;
      last = 'a';
      continue;
    }
    if (!/\s/.test(c)) { last = c; word = ''; }
    i++;
  }
  return out;
}

test('tokenizer najde texty v řetězcích, ne v komentářích a regexech', () => {
  const found = stringLiterals("// komentář č\nconst a = 'ahoj'; /* ř */ const r = /[\"';]/; const b = `x ${c ? 'ž' : `y${'š'}`} z`;");
  assert.deepEqual(found, ['ahoj', 'x ', 'ž', 'y', 'š', '', ' z']);
});

test('v kódu mimo slovníky nejsou natvrdo napsané české texty', () => {
  const offenders = [];
  for (const file of jsFiles()) {
    for (const text of stringLiterals(read(file))) {
      if (CZECH.test(text)) offenders.push(`${file}: ${text.trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('v index.html nejsou natvrdo napsané české texty', () => {
  const html = read('index.html')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    // metadata v <head> zůstávají ve výchozím jazyce (jako manifest); titulek se překládá za běhu
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/<meta name="(description|apple-mobile-web-app-title)"[^>]*>/g, '');
  const lines = html.split('\n').filter((line) => CZECH.test(line)).map((l) => l.trim());
  assert.deepEqual(lines, []);
});

// ---------------------------------------------------------------------------
// Chování překladu
// ---------------------------------------------------------------------------
test('výchozí jazyk je čeština, t() s parametry a množným číslem', () => {
  assert.equal(DEFAULT_LANGUAGE, 'cs');
  assert.equal(storedLanguage(), 'cs'); // v Node bez localStorage
  assert.equal(getLanguage(), 'cs');
  assert.equal(t('entry.arrivalSaved', { time: '07:00' }), 'Příchod 07:00 uložen');
  assert.equal(t('month.workdays', { count: 1 }), '1 pracovní den');
  assert.equal(t('month.workdays', { count: 3 }), '3 pracovní dny');
  assert.equal(t('month.workdays', { count: 21 }), '21 pracovních dní');
  assert.equal(t('neexistujici.klic'), 'neexistujici.klic');
  // vnořená zpráva jako parametr
  assert.equal(tr({ key: 'settings.breakText', params: { rule: { key: 'break.none' }, fund: '8:00', stay: '8:00', example: '' } }).startsWith('Přestávka se neodečítá'), true);
  assert.equal(tr(null), '');
});

test('setLanguage přepne překlady a formáty', () => {
  setLanguage('en', { persist: false });
  try {
    assert.equal(getLanguage(), 'en');
    assert.equal(t('month.workdays', { count: 1 }), '1 work day');
    assert.equal(t('month.workdays', { count: 3 }), '3 work days');
    assert.equal(t('holiday.goodFriday'), 'Good Friday');
    assert.equal(formatMonthYear(2025, 3), 'March 2025');
    assert.equal(weekdayShort('2025-03-03'), 'Mon');
    assert.equal(weekdayName(1), 'Monday');
    assert.equal(decimalSeparator(), '.');
  } finally {
    setLanguage('cs', { persist: false });
  }
  assert.equal(formatMonthYear(2025, 3), 'Březen 2025');
  assert.equal(weekdayShort('2025-03-04'), 'Út');
  assert.equal(weekdayName(5), 'Pátek');
  assert.equal(formatDateShort('2025-03-03'), '3. 3. 2025');
  assert.equal(decimalSeparator(), ',');
  assert.equal(translator('en')('type.comp'), 'Time off in lieu');
  assert.equal(translator('xx')('type.comp'), 'Náhradní volno');
  // neplatný jazyk = čeština
  setLanguage('de', { persist: false });
  assert.equal(getLanguage(), 'cs');
});
