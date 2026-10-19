import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Payments reuses the Reports filter structure and preserves its date defaults',()=>{
  const payments=source('src/pages/PaymentsPage.js');
  assert.match(payments,/FilterBar\(\{/);
  assert.match(payments,/className: 'payments-filter-bar'/);
  assert.match(payments,/filter-field filter-field-search/);
  assert.match(payments,/DateRangeFields\(\{ fromId: 'payment-from-date', toId: 'payment-to-date'/);
  assert.match(payments,/const initialRange = vietnamDateRangeYearToDate\(\)/);
  assert.match(payments,/fromDate: initialRange\.from, toDate: initialRange\.to/);
  assert.match(payments,/state\[key\]=event\.target\.value/);
  assert.doesNotMatch(payments,/MutationObserver|DateInput/);
});

test('Job and Payments filters share balanced desktop dates and mobile full-width controls',()=>{
  const css=source('src/styles/app.css');
  assert.match(css,/\.work-item-filter-bar \.filter-field-date,\.payments-filter-bar \.filter-field-date \{[^}]*flex:0 1 152px/);
  assert.match(css,/\.admin-filter-bar :is\(\.form-control, \.filter-select\) \{[^}]*height: 44px[^}]*font-size: 13px/);
  assert.match(css,/@media\(max-width:640px\) \{[^]*\.work-item-filter-bar \.filter-field-date,\.payments-filter-bar \.filter-field-date \{[^}]*flex-basis:100%/);
});
