import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createDateValue } from '../src/utils/date.js';
import { enhanceDateInput } from '../src/components/DateInput.js';

const source = readFileSync(new URL('../src/components/KioskEditForm.js', import.meta.url), 'utf8');
const now = new Date('2026-10-08T17:00:00Z');

function formDates(kiosk = null, at = now) {
  const box = vm.createContext({
    createDateValue: (record, stored) => createDateValue(record, stored, at),
    escapeHtml: value => String(value ?? ''), FacebookIdResolverFields: () => '', kiosk,
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export async function', 'async function'), box);
  vm.runInContext('state = { kiosk, isEdit: Boolean(kiosk?.id) };', box);
  const markup = box.renderForm();
  return ['start', 'end'].map(kind => markup.match(new RegExp(`id="kiosk-edit-${kind}-date"[^>]*value="([^"]*)"`))[1]);
}

test('CREATE Kiosk prefills both dates with Vietnam today in ISO', () => {
  assert.match(source, /import \{ createDateValue \} from '..\/utils\/date.js'/);
  assert.deepEqual(formDates(), ['2026-10-09', '2026-10-09']);
  assert.deepEqual(formDates(null, new Date('2026-10-08T16:59:59Z')), ['2026-10-08', '2026-10-08']);
  assert.deepEqual(formDates({ facebook_name: 'Draft' }), ['2026-10-09', '2026-10-09']);
});

test('EDIT Kiosk preserves both stored dates, including intentionally empty dates', () => {
  assert.deepEqual(formDates({ id: 1, start_date: '2025-06-15', end_date: '2027-01-01' }), ['2025-06-15', '2027-01-01']);
  for (const empty of [null, undefined, '']) assert.deepEqual(formDates({ id: 1, start_date: empty, end_date: empty }), ['', '']);
});

test('visible DateInput receives the CREATE prefill rather than only a placeholder', () => {
  class Field {
    constructor() { this.dataset = {}; this.classList = { contains: () => false }; this.attributes = {}; this.labels = []; this.children = []; }
    get value() { return this._value || ''; } set value(value) { this._value = value; }
    setAttribute(key, value) { this.attributes[key] = value; } getAttribute(key) { return this.attributes[key]; }
    closest() { return null; } before(wrapper) { this.wrapper = wrapper; } append(...children) { this.children.push(...children); }
    setCustomValidity(message) { this.message = message; } addEventListener() {}
  }
  const keys = ['document', 'HTMLInputElement', 'MutationObserver'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { document: { createElement: () => new Field() }, HTMLInputElement: Field, MutationObserver: class { observe() {} } });
  try {
    for (const [index, value] of formDates().entries()) {
      const field = new Field(); field.type = 'date'; field.value = value;
      enhanceDateInput(field);
      assert.equal(field.value, '2026-10-09');
      assert.equal(field.wrapper.children[1].value, '09/10/2026');
    }
  } finally {
    keys.forEach((key, index) => originals[index] ? Object.defineProperty(globalThis, key, originals[index]) : delete globalThis[key]);
  }
});

test('Kiosk CREATE dates are independent of machine timezone at Vietnam midnight and New Year', () => {
  const script = `import vm from 'node:vm'; import {createDateValue} from './src/utils/date.js';
    const source = ${JSON.stringify(source)};
    const formDates = ${formDates.toString()};
    console.log(JSON.stringify(['2026-10-08T16:59:59Z','2026-10-08T17:00:00Z','2026-12-31T17:00:00Z'].map(at => formDates(null, new Date(at)))));`;
  for (const TZ of ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Ho_Chi_Minh']) {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../', import.meta.url), env: { ...process.env, TZ }, encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(result), [['2026-10-08', '2026-10-08'], ['2026-10-09', '2026-10-09'], ['2027-01-01', '2027-01-01']], TZ);
  }
});
