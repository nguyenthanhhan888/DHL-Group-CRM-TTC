export function formatCurrency(value) {
  return `${formatVndNumber(value)} VNĐ`;
}

export function formatVndNumber(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number.isFinite(amount) ? amount : 0);
}

export function parseCurrencyInput(value, { allowNegative = false } = {}) {
  const negative = allowNegative && String(value ?? '').trim().startsWith('-');
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? Number(digits) * (negative ? -1 : 1) : 0;
}

export function bindCurrencyInput(input, { allowNegative = false } = {}) {
  if (!input || input.dataset.currencyBound === 'true') return;
  input.dataset.currencyBound = 'true';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.placeholder = '0';
  ensureCurrencyShell(input);
  if (input.value && parseCurrencyInput(input.value, { allowNegative }) !== 0) {
    input.value = formatVndNumber(parseCurrencyInput(input.value, { allowNegative }));
  } else if (input.value === '0') {
    input.value = '';
  }
  input.addEventListener('input', () => {
    const selection = input.selectionStart ?? input.value.length;
    const digitsAfterCaret = input.value.slice(selection).replace(/\D/g, '').length;
    const negative = allowNegative && input.value.trim().startsWith('-');
    const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    input.value = digits ? `${negative ? '-' : ''}${formatVndNumber(Number(digits))}` : (negative ? '-' : '');
    let caret = input.value.length;
    for (let remaining = digitsAfterCaret; remaining > 0 && caret > 0; caret -= 1) {
      if (/\d/.test(input.value[caret - 1])) remaining -= 1;
    }
    input.setSelectionRange?.(caret, caret);
  });
}

function ensureCurrencyShell(input) {
  const parent = input.parentElement;
  if (!parent || typeof document === 'undefined') return;
  if (parent.classList?.contains('money-input-shell')) {
    if (!parent.querySelector('.money-input-suffix')) parent.insertAdjacentHTML('beforeend', '<span class="money-input-suffix" aria-hidden="true">VNĐ</span>');
    return;
  }
  const shell = document.createElement('span');
  shell.className = 'money-input-shell';
  parent.insertBefore(shell, input);
  shell.append(input, Object.assign(document.createElement('span'), { className: 'money-input-suffix', textContent: 'VNĐ' }));
  shell.lastElementChild?.setAttribute('aria-hidden', 'true');
}
