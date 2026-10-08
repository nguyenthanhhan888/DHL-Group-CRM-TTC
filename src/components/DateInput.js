import { renderIcon } from '../utils/icons.js';
import { isValidDateOnly } from '../utils/formValidation.js';

export function dateDisplay(iso) {
  const [date, time] = String(iso || '').split('T');
  if (!isValidDateOnly(date)) return '';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}${time ? ` ${time.slice(0, 5)}` : ''}`;
}
export function dateIso(display, { withTime = false } = {}) {
  if (!display) return '';
  if (!withTime && /^\d{8}$/.test(display)) display = `${display.slice(0,2)}/${display.slice(2,4)}/${display.slice(4)}`;
  const match = String(display).trim().match(withTime
    ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/
    : /^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const [,day,month,year,hour,minute,second,fraction] = match;
  const date = `${year}-${month}-${day}`;
  if (!isValidDateOnly(date)) return '';
  if (!withTime) return date;
  if (Number(hour)>23 || Number(minute)>59 || Number(second || 0)>59) return '';
  return `${date}T${hour}:${minute}${second ? `:${second}${fraction || ''}` : ''}`;
}

// Preserve the existing ID/name/value (ISO) contract for forms, filters and payloads.
// The visible text field owns validation; a separate native calendar is optional.
export function enhanceDateInput(input) {
  if (input.dataset.dateInputBound === 'true' || input.classList.contains('date-input-native')) return;
  const originalType = input.type, withTime = originalType === 'datetime-local';
  if (!['date','datetime-local'].includes(originalType)) return;
  input.dataset.dateInputBound = 'true';
  const wrapper = document.createElement('span'); wrapper.className = 'date-input-field';
  const display = document.createElement('input');
  display.type = 'text'; display.className = input.className;
  display.placeholder = withTime ? 'DD/MM/YYYY HH:mm' : 'DD/MM/YYYY';
  display.autocomplete = 'off'; display.inputMode = withTime ? 'text' : 'numeric';
  display.dataset.dateDisplay = input.id || input.name || '';
  display.setAttribute('aria-label', `${input.getAttribute('aria-label') || input.closest('label')?.querySelector('span')?.textContent || 'Ngày'} (${display.placeholder})`);
  if (input.id) display.id = `${input.id}-display`;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'date-input-calendar';
  button.innerHTML = renderIcon('calendar'); button.setAttribute('aria-label','Chọn ngày trên lịch');
  const picker = document.createElement('input'); picker.type = originalType; picker.className = 'date-input-native';
  picker.tabIndex = -1; picker.setAttribute('aria-label','Chọn ngày trên lịch');
  input.before(wrapper); wrapper.append(input,display,button,picker);
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  const initial = input.value; input.type = 'hidden';
  let editing = false;
  Object.defineProperty(input,'value',{
    configurable:true,
    get() { return valueDescriptor.get.call(input); },
    set(value) { valueDescriptor.set.call(input,value ?? ''); if (!editing) { display.value = dateDisplay(input.value); display.setCustomValidity(''); picker.value = input.value; } },
  });
  input.value = initial;
  const syncAttributes = () => {
    display.required = input.required; display.disabled = input.disabled; display.readOnly = input.readOnly;
    button.disabled = input.disabled || input.readOnly; picker.disabled = button.disabled;
    picker.min = input.min; picker.max = input.max; picker.step = input.step || (withTime ? 'any' : '1');
    const invalid = input.getAttribute('aria-invalid'); if (invalid) display.setAttribute('aria-invalid',invalid);
  };
  syncAttributes();
  for (const label of input.labels || []) if (label.htmlFor === input.id) label.htmlFor = display.id;
  const validate = () => {
    const value = dateIso(display.value,{withTime});
    const invalid = display.value && (!value || input.min && value < input.min || input.max && value > input.max);
    display.setCustomValidity(invalid ? `Vui lòng nhập ngày hợp lệ theo ${display.placeholder}${input.min || input.max ? ' trong khoảng cho phép' : ''}.` : '');
    display.setAttribute('aria-invalid',String(Boolean(invalid)));
    editing = true; input.value = value; editing = false;
    return !invalid;
  };
  display.addEventListener('input',()=>{ validate(); input.dispatchEvent(new Event('input',{bubbles:true})); });
  display.addEventListener('change',()=>{ if (!validate()) return; if (input.value) display.value=dateDisplay(input.value); input.dispatchEvent(new Event('change',{bubbles:true})); });
  picker.addEventListener('change',()=>{ input.value=picker.value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); });
  button.addEventListener('click',()=>{ picker.value=input.value; try { picker.showPicker(); } catch { picker.focus(); picker.click(); } });
  // Existing forms report errors through their original ISO control.
  const setValidity = input.setCustomValidity.bind(input);
  input.setCustomValidity = message => { setValidity(message); display.setCustomValidity(message); };
  input.checkValidity = () => display.checkValidity();
  input.reportValidity = () => display.reportValidity();
  input.focus = options => display.focus(options);
  new MutationObserver(syncAttributes).observe(input,{attributes:true,attributeFilter:['required','disabled','readonly','min','max','aria-invalid']});
}
let mounted = false;
export function mountDateInputs() {
  if (mounted) return;
  mounted = true;
  document.addEventListener('submit', event => {
    const invalid = [...event.target.querySelectorAll('[data-date-display]')].find(field => !field.disabled && !field.checkValidity());
    if (invalid) { event.preventDefault(); event.stopImmediatePropagation(); invalid.reportValidity(); invalid.focus(); }
  }, true);
  const scan = root => {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const fields = [...root.querySelectorAll('input[type="date"],input[type="datetime-local"]')];
    if (root.matches?.('input[type="date"],input[type="datetime-local"]')) fields.unshift(root);
    fields.forEach(enhanceDateInput);
  };
  scan(document);
  new MutationObserver(records=>{ for (const record of records) for (const node of record.addedNodes) scan(node); }).observe(document.body,{childList:true,subtree:true});
}
