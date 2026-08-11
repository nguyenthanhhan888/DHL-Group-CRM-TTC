const test = require('node:test');
const assert = require('node:assert/strict');

test('VND formatter and parser keep raw integer values', async () => {
  const { formatCurrency, formatVndNumber, parseCurrencyInput } = await import('../src/utils/currency.js');
  assert.equal(formatCurrency(0), '0 VNĐ');
  assert.equal(formatCurrency(80_000), '80.000 VNĐ');
  assert.equal(formatCurrency(1_000_000), '1.000.000 VNĐ');
  assert.equal(formatVndNumber(80_000), '80.000');
  assert.equal(parseCurrencyInput(''), 0);
  assert.equal(parseCurrencyInput('080000'), 80_000);
  assert.equal(parseCurrencyInput('1.000.000'), 1_000_000);
  assert.equal(parseCurrencyInput('-80.000', { allowNegative: true }), -80_000);
});

test('currency input stays empty and never keeps a leading zero', async () => {
  const { bindCurrencyInput } = await import('../src/utils/currency.js');
  let onInput;
  const input = {
    value: '0', placeholder: '', type: 'number', inputMode: '', autocomplete: '', dataset: {},
    addEventListener(type, handler) { if (type === 'input') onInput = handler; },
  };
  bindCurrencyInput(input);
  assert.equal(input.value, '');
  assert.equal(input.placeholder, '0');
  input.value = '8'; onInput(); assert.equal(input.value, '8');
  input.value = '080000'; onInput(); assert.equal(input.value, '80.000');
  input.value = '1000000'; onInput(); assert.equal(input.value, '1.000.000');
  input.value = ''; onInput(); assert.equal(input.value, '');
});
