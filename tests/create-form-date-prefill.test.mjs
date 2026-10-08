import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createDateValue } from '../src/utils/date.js';
import { dateDisplay, dateIso, enhanceDateInput } from '../src/components/DateInput.js';
import { promotionDraft, promotionDateDefaults, promotionPayload, promotionInstant } from '../src/utils/promotionForm.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const now = new Date('2026-10-03T17:00:00Z');

function employeeForm(item, at = now) {
  const source = read('src/pages/EmployeesPage.js');
  const formSource = source.slice(source.indexOf('function openEmployeeForm('), source.indexOf('function confirmLifecycle('));
  let markup;
  const box = vm.createContext({ createDateValue: (record, stored) => createDateValue(record, stored, at),
    escapeHtml: value => String(value ?? ''), Modal: { open: options => { markup = options.body; }, close() {} },
    document: { querySelector: () => ({ addEventListener() {} }), getElementById: () => ({ addEventListener() {} }) } });
  vm.runInContext(formSource, box);
  box.openEmployeeForm(item);
  return markup.match(/name="startDate"[^>]*value="([^"]*)"/)[1];
}

test('actual employee CREATE markup contains Vietnam today; shared display is DD/MM/YYYY', () => {
  assert.equal(employeeForm(), '2026-10-04');
  assert.equal(dateDisplay(employeeForm()), '04/10/2026');
  assert.equal(employeeForm(undefined, new Date('2026-10-03T16:59:59Z')), '2026-10-03');
});

test('employee EDIT markup preserves stored historical and empty dates', () => {
  assert.equal(employeeForm({ id: 1, start_date: '2025-06-15' }), '2025-06-15');
  for (const start_date of [null, undefined, '']) assert.equal(employeeForm({ id: 1, start_date }), '');
});

test('promotion CREATE starts today in Vietnam and retains its existing calculated seven-day expiry', () => {
  const draft = promotionDraft({}, now);
  assert.equal(draft.starts_at, '2026-10-04T00:00');
  assert.equal(dateDisplay(draft.starts_at), '04/10/2026 00:00');
  assert.equal(draft.ends_at, '2026-10-11T00:00');
  assert.equal(draft.start_mode, 'scheduled');
  assert.equal(promotionInstant(promotionPayload(draft).starts_at), '2026-10-03T17:00:00.000Z');
  assert.match(read('src/components/PromotionForm.js'), /name="starts_at"[^>]*value="\$\{draft.starts_at\}"/);
});

test('promotion EDIT preserves stored instants, precision and intentionally unset dates', () => {
  const original = { id: 9, starts_at: '2025-06-15T08:30:45.123456+07:00', ends_at: '2025-06-22T08:30:00+07:00' };
  const payload = promotionPayload(promotionDraft(original, now), original);
  assert.equal(payload.starts_at, original.starts_at); assert.equal(payload.ends_at, original.ends_at);
  const empty = { id: 9, starts_at: null, ends_at: null };
  assert.deepEqual(promotionDateDefaults(empty, now), { starts_at: '', ends_at: '' });
  const emptyPayload = promotionPayload(promotionDraft(empty, now), empty);
  assert.equal(emptyPayload.starts_at, null); assert.equal(emptyPayload.ends_at, null);
});

test('create prefills are identical outside Vietnam, including midnight and New Year boundaries', () => {
  const script = `import {createDateValue} from './src/utils/date.js';import {promotionDateDefaults} from './src/utils/promotionForm.js';console.log(JSON.stringify(['2026-10-03T16:59:59Z','2026-10-03T17:00:00Z','2026-12-31T17:00:00Z'].map(at=>{const now=new Date(at);return [createDateValue(null,null,now),promotionDateDefaults({},now).starts_at]})));`;
  const results = ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Ho_Chi_Minh'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(new Set(results).size, 1);
  assert.deepEqual(JSON.parse(results[0]), [['2026-10-03', '2026-10-03T23:59'], ['2026-10-04', '2026-10-04T00:00'], ['2027-01-01', '2027-01-01T00:00']]);
});

test('shared DateInput shows existing prefill and allows day/month edits while keeping ISO values', () => {
  class Field {
    constructor() { this.dataset = {}; this.classList = { contains: () => false }; this.attributes = {}; this.handlers = {}; this.labels = []; this.children = []; }
    get value() { return this._value || ''; } set value(value) { this._value = value; }
    setAttribute(key, value) { this.attributes[key] = value; } getAttribute(key) { return this.attributes[key]; }
    closest() { return null; } before(wrapper) { this.wrapper = wrapper; } append(...children) { this.children.push(...children); }
    setCustomValidity(message) { this.message = message; } checkValidity() { return !this.message; } reportValidity() { return this.checkValidity(); } focus() {}
    addEventListener(type, handler) { this.handlers[type] = handler; } dispatchEvent() {}
  }
  const keys = ['document', 'HTMLInputElement', 'MutationObserver'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { document: { createElement: () => new Field() }, HTMLInputElement: Field, MutationObserver: class { observe() {} } });
  try {
    const field = new Field(); field.type = 'date'; field.value = employeeForm();
    enhanceDateInput(field);
    const display = field.wrapper.children[1];
    assert.equal(display.value, '04/10/2026'); assert.equal(field.value, '2026-10-04');
    display.value = '20/10/2026'; display.handlers.input(); assert.equal(field.value, '2026-10-20');
    display.value = '20/11/2026'; display.handlers.change(); assert.equal(field.value, '2026-11-20');
    assert.equal(display.value, '20/11/2026');
    const blankEdit = new Field(); blankEdit.type = 'date'; blankEdit.value = ''; enhanceDateInput(blankEdit);
    assert.equal(blankEdit.value, ''); assert.equal(blankEdit.wrapper.children[1].value, '');
  } finally {
    keys.forEach((key, index) => originals[index] ? Object.defineProperty(globalThis, key, originals[index]) : delete globalThis[key]);
  }
});

test('changing the visible date preserves the year and rejects invalid calendar dates', () => {
  assert.equal(dateIso('20/10/2026'), '2026-10-20'); assert.equal(dateIso('20/11/2026'), '2026-11-20');
  assert.equal(dateIso('29/02/2025'), ''); assert.equal(dateIso('29/02/2024'), '2024-02-29');
});

test('Kiosk creation retains its formatted calculated preview without adding an editable date field', () => {
  const source = read('src/components/KioskForm.js');
  assert.match(source, /formatDate\(preview.startDate\)/);
  assert.match(source, /formatDate\(preview.endDate\)/);
  assert.doesNotMatch(source, /type="(?:date|datetime-local)"/);
});
