import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateValues,
  isDigits,
  isValidDateOnly,
  isValidPhone,
} from '../src/utils/formValidation.js';

test('validates Vietnamese-compatible phone input without exposing records', () => {
  assert.equal(isValidPhone('0912 345 678'), true);
  assert.equal(isValidPhone('+84 (912) 345-678'), true);
  assert.equal(isValidPhone('abc123'), false);
});

test('requires digit-only Facebook IDs and detects duplicates in one form', () => {
  assert.equal(isDigits(' 123456 '), true);
  assert.equal(isDigits('123a'), false);
  assert.deepEqual([...duplicateValues(['11', '22', '11', '', '22'])].sort(), ['11', '22']);
});

test('validates real date-only values and date ranges can compare lexically', () => {
  assert.equal(isValidDateOnly('2026-02-28'), true);
  assert.equal(isValidDateOnly('2026-02-30'), false);
  assert.equal('2026-07-30' >= '2026-07-01', true);
});
