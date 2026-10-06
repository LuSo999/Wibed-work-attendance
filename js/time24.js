// 24hodinový výběr času nezávislý na jazyku prohlížeče.
// Nativní <input type="time"> zobrazuje AM/PM podle locale systému, proto se každý
// <input type="time" data-time24> nahradí dvojicí <select> (hodiny : minuty).
// Původní input zůstane jako skrytý nosič hodnoty 'HH:MM' (stejné id/name),
// takže zbytek aplikace s ním pracuje beze změny – čte i nastavuje .value
// a poslouchá událost 'input'.
const pad = (n) => String(n).padStart(2, '0');
const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function options(count, optional) {
  const list = optional ? ['<option value="">--</option>'] : [];
  for (let i = 0; i < count; i++) list.push(`<option value="${pad(i)}">${pad(i)}</option>`);
  return list.join('');
}

function enhance(input) {
  const optional = !input.required && input.hasAttribute('data-optional');
  const label = input.closest('label')?.querySelector('span')?.textContent?.trim() ?? 'Čas';

  const wrap = document.createElement('div');
  wrap.className = `${input.className} flex items-center justify-center gap-0.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30`;
  const selectCls = 'tabular cursor-pointer appearance-none bg-transparent text-center outline-none';
  wrap.innerHTML = `
    <select class="${selectCls}" aria-label="${label} – hodiny">${options(24, optional)}</select>
    <span aria-hidden="true">:</span>
    <select class="${selectCls}" aria-label="${label} – minuty">${options(60, optional)}</select>`;
  const [hours, minutes] = wrap.querySelectorAll('select');

  input.type = 'hidden';
  input.className = '';
  input.after(wrap);

  const sync = () => {
    const [h = '', m = ''] = (valueDesc.get.call(input) || '').split(':');
    hours.value = optional ? h : h || '00';
    minutes.value = optional ? m : m || '00';
  };

  // Programové nastavení .value aktualizuje i oba selecty.
  Object.defineProperty(input, 'value', {
    get() { return valueDesc.get.call(this); },
    set(v) { valueDesc.set.call(this, v ?? ''); sync(); },
  });

  const onChange = (changed, other) => {
    if (optional && changed.value === '') {
      other.value = '';
    } else if (other.value === '') {
      other.value = '00';
    }
    valueDesc.set.call(input, hours.value && minutes.value ? `${hours.value}:${minutes.value}` : '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  hours.addEventListener('change', () => onChange(hours, minutes));
  minutes.addEventListener('change', () => onChange(minutes, hours));

  sync();
}

export function enhanceTimeInputs(root = document) {
  root.querySelectorAll('input[type="time"][data-time24]').forEach(enhance);
}
