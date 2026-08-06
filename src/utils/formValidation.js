export function isValidPhone(value) {
  return /^\+?\d{9,15}$/.test(String(value || '').replace(/[\s().-]/g, ''));
}

export function isDigits(value) {
  return /^\d+$/.test(String(value || '').trim());
}

export function duplicateValues(values) {
  const seen = new Set();
  return new Set(values.map((value) => String(value || '').trim()).filter(Boolean)
    .filter((value) => seen.has(value) || !seen.add(value)));
}

export function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function setInlineError(control, message = '') {
  if (!control) return false;
  let error = control.closest('.form-group')?.querySelector('.field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'field-error';
    control.closest('.form-group')?.append(error);
  }
  error.textContent = message;
  error.classList.toggle('hidden', !message);
  control.setAttribute('aria-invalid', String(Boolean(message)));
  control.setCustomValidity?.(message);
  return !message;
}
