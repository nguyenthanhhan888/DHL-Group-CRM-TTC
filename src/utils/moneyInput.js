export function formatMoneyInput(value) {
  const raw = normalizeMoneyInput(value);
  if (raw === '') return '';
  const negative = raw.startsWith('-');
  const digits = raw.replace(/^-/, '');
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${formatted}`;
}

export function parseMoneyInput(value) {
  const raw = normalizeMoneyInput(value);
  return raw === '' ? 0 : Number(raw);
}

export function bindMoneyInputs(container = document) {
  container?.querySelectorAll?.('[data-money-input]').forEach((input) => {
    if (input.dataset.moneyBound === 'true') return;
    input.dataset.moneyBound = 'true';
    input.value = formatMoneyInput(input.value);
    input.addEventListener('input', () => {
      const selection = input.selectionStart ?? input.value.length;
      const digitsAfterCaret = input.value.slice(selection).replace(/\D/g, '').length;
      input.value = formatMoneyInput(input.value);
      let caret = input.value.length;
      for (let remaining = digitsAfterCaret; remaining > 0 && caret > 0; caret -= 1) {
        if (/\d/.test(input.value[caret - 1])) remaining -= 1;
      }
      input.setSelectionRange?.(caret, caret);
      input.dispatchEvent(new CustomEvent('moneychange', { bubbles: true, detail: { value: parseMoneyInput(input.value) } }));
    });
  });
}

function normalizeMoneyInput(value) {
  const text = String(value ?? '').trim();
  const negative = text.startsWith('-');
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  return `${negative ? '-' : ''}${digits}`;
}
