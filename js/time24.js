// 24hodinový výběr času nezávislý na jazyku prohlížeče.
// Nativní <input type="time"> zobrazuje AM/PM podle locale systému, proto se každý
// <input type="time" data-time24> nahradí tlačítkem, které otevře vlastní výběr
// (mřížka hodin 00–23, mřížka minut po 5 + jemné ±1 min, psaní číslicemi z klávesnice).
// Původní input zůstane jako skrytý nosič hodnoty 'HH:MM' (stejné id/name),
// takže zbytek aplikace s ním pracuje beze změny – čte i nastavuje .value
// a poslouchá událost 'input'.
const pad = (n) => String(n).padStart(2, '0');
const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

const CLOCK_ICON = `<svg class="h-[1em] w-[1em] shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 7v5l3 2"/></svg>`;

// ---------------------------------------------------------------------------
// Sdílený dialog výběru
// ---------------------------------------------------------------------------
let dlg;
const picker = { input: null, h: 0, m: 0, mode: 'h', optional: false, typed: '' };

const cellBase = 'tabular rounded-xl py-2.5 text-base font-semibold';
const cellIdle = 'bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-indigo-900/60 dark:hover:text-indigo-200';
const cellActive = 'bg-indigo-600 text-white shadow-sm';
const partBase = 'tabular rounded-2xl px-3 py-1';
const partIdle = 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300';
const partActive = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300';

function buildDialog() {
  dlg = document.createElement('dialog');
  dlg.className = 'w-[calc(100%-2rem)] max-w-xs rounded-3xl bg-white p-0 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100';
  dlg.innerHTML = `
    <div class="p-5">
      <p data-el="label" class="text-center text-sm font-medium text-slate-500 dark:text-slate-400"></p>
      <div class="mt-2 flex items-center justify-center text-5xl font-bold">
        <button type="button" data-part="h" class="${partBase}"></button>
        <span class="pb-1 text-slate-300 dark:text-slate-600">:</span>
        <button type="button" data-part="m" class="${partBase}"></button>
      </div>
      <div data-el="fine" class="mt-2 flex justify-center gap-2">
        <button type="button" data-step="-1" class="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">−1 min</button>
        <button type="button" data-step="1" class="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">+1 min</button>
      </div>
      <p data-el="hint" class="mt-2 text-center text-xs text-slate-400 dark:text-slate-500"></p>
      <div data-el="grid" class="mt-3 grid gap-1.5"></div>
      <div class="mt-5 flex items-center gap-1">
        <button type="button" data-act="now" class="rounded-xl px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/50">Teď</button>
        <button type="button" data-act="clear" class="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">Vymazat</button>
        <button type="button" data-act="cancel" class="ml-auto rounded-xl px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800">Zrušit</button>
        <button type="button" data-act="ok" class="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">OK</button>
      </div>
    </div>`;
  document.body.append(dlg);

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) return dlg.close(); // klik na pozadí
    const btn = e.target.closest('button');
    if (!btn) return;
    picker.typed = '';
    if (btn.dataset.part) {
      picker.mode = btn.dataset.part;
    } else if (btn.dataset.step) {
      picker.m = (picker.m + Number(btn.dataset.step) + 60) % 60;
      picker.mode = 'm';
    } else if (btn.dataset.cell !== undefined) {
      const v = Number(btn.dataset.cell);
      if (picker.mode === 'h') {
        picker.h = v;
        picker.mode = 'm';
      } else {
        picker.m = v;
      }
    } else if (btn.dataset.act === 'now') {
      const d = new Date();
      picker.h = d.getHours();
      picker.m = d.getMinutes();
    } else if (btn.dataset.act === 'clear') {
      return commit('');
    } else if (btn.dataset.act === 'cancel') {
      return dlg.close();
    } else if (btn.dataset.act === 'ok') {
      return commit(`${pad(picker.h)}:${pad(picker.m)}`);
    }
    render();
  });

  // Psaní z klávesnice: 4 číslice = HHMM, Enter potvrdí.
  dlg.addEventListener('keydown', (e) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      picker.typed = (picker.typed + e.key).slice(-4);
      const t = picker.typed;
      if (t.length <= 2) {
        picker.h = Math.min(23, Number(t));
        picker.mode = t.length === 2 ? 'm' : 'h';
      } else {
        picker.m = Math.min(59, Number(t.slice(2)));
        picker.mode = 'm';
      }
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(`${pad(picker.h)}:${pad(picker.m)}`);
    }
  });
}

function render() {
  const q = (sel) => dlg.querySelector(sel);
  const [hBtn, mBtn] = [q('[data-part="h"]'), q('[data-part="m"]')];
  hBtn.textContent = pad(picker.h);
  mBtn.textContent = pad(picker.m);
  hBtn.className = `${partBase} ${picker.mode === 'h' ? partActive : partIdle}`;
  mBtn.className = `${partBase} ${picker.mode === 'm' ? partActive : partIdle}`;
  hBtn.setAttribute('aria-pressed', picker.mode === 'h');
  mBtn.setAttribute('aria-pressed', picker.mode === 'm');
  q('[data-act="clear"]').hidden = !picker.optional;
  q('[data-el="hint"]').textContent = picker.mode === 'h' ? 'Vyberte hodinu' : 'Vyberte minuty';

  const grid = q('[data-el="grid"]');
  const values = picker.mode === 'h'
    ? Array.from({ length: 24 }, (_, i) => i)
    : Array.from({ length: 12 }, (_, i) => i * 5);
  const current = picker.mode === 'h' ? picker.h : picker.m;
  grid.style.gridTemplateColumns = `repeat(${picker.mode === 'h' ? 6 : 4}, minmax(0, 1fr))`;
  grid.innerHTML = values.map((v) => `
    <button type="button" data-cell="${v}" class="${cellBase} ${v === current ? cellActive : cellIdle}">${pad(v)}</button>`).join('');
}

function commit(value) {
  const input = picker.input;
  dlg.close();
  if (value === valueDesc.get.call(input)) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function openPicker(input, label, optional) {
  if (!dlg) buildDialog();
  const value = valueDesc.get.call(input);
  let [h, m] = value ? value.split(':').map(Number) : [NaN, NaN];
  if (Number.isNaN(h)) {
    const d = new Date();
    h = d.getHours();
    m = Math.round(d.getMinutes() / 5) * 5 % 60;
  }
  Object.assign(picker, { input, h, m, mode: 'h', optional, typed: '' });
  dlg.querySelector('[data-el="label"]').textContent = label;
  render();
  dlg.showModal();
  dlg.querySelector('[data-act="ok"]').focus();
}

// ---------------------------------------------------------------------------
// Nahrazení inputů
// ---------------------------------------------------------------------------
function enhance(input) {
  const optional = input.hasAttribute('data-optional');
  const label = input.closest('label')?.querySelector('span')?.textContent?.trim() ?? 'Čas';

  const field = document.createElement('button');
  field.type = 'button';
  field.className = `${input.className} flex items-center justify-between gap-2 text-left focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30`;
  field.setAttribute('aria-haspopup', 'dialog');
  field.innerHTML = `<span class="tabular"></span>${CLOCK_ICON}`;
  const text = field.querySelector('span');

  input.type = 'hidden';
  input.className = '';
  input.after(field);

  const sync = () => {
    const v = valueDesc.get.call(input);
    text.textContent = v || '--:--';
    text.classList.toggle('text-slate-400', !v);
    field.setAttribute('aria-label', `${label}: ${v || 'nezadáno'}`);
  };

  // Programové nastavení .value aktualizuje i zobrazení.
  Object.defineProperty(input, 'value', {
    get() { return valueDesc.get.call(this); },
    set(v) { valueDesc.set.call(this, v ?? ''); sync(); },
  });

  field.addEventListener('click', (e) => {
    e.preventDefault(); // tlačítko uvnitř <label> by jinak klik zdvojilo
    openPicker(input, label, optional);
  });
  sync();
}

export function enhanceTimeInputs(root = document) {
  root.querySelectorAll('input[type="time"][data-time24]').forEach(enhance);
}
