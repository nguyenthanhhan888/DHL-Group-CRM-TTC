import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Pagination, paginationItems } from '../src/components/Pagination.js';

test('pagination uses compact ranges with ellipsis for many pages', () => {
  assert.deepEqual(paginationItems(1, 12), [1, 2, 3, 4, 'ellipsis', 12]);
  assert.deepEqual(paginationItems(6, 12), [1, 'ellipsis', 5, 6, 7, 'ellipsis', 12]);
  assert.deepEqual(paginationItems(12, 12), [1, 'ellipsis', 9, 10, 11, 12]);
  assert.deepEqual(paginationItems(3, 5), [1, 2, 3, 4, 5]);
});

test('pagination exposes active, disabled, result and page-size states', () => {
  const html = Pagination({ id: 'customers', page: 1, pageSize: 10, total: 253, pageSizeOptions: [10, 25, 50], noun: 'khách hàng' });
  assert.match(html, /aria-current="page">1</);
  assert.match(html, /data-pagination-page="0" disabled/);
  assert.match(html, /253 khách hàng/);
  assert.match(html, /10 \/ trang/);
  assert.match(html, /pagination-mobile-count">1 \/ 26/);
  assert.match(html, /<svg/);
});

test('all server-paginated CRM routes use the shared component', async () => {
  const paths = ['Customers', 'Kiosks', 'Payments', 'Categories', 'BusinessTypes', 'Logs', 'Reports'];
  for (const name of paths) {
    const source = await readFile(new URL(`../src/pages/${name}Page.js`, import.meta.url), 'utf8');
    assert.match(source, /components\/Pagination\.js/);
    assert.doesNotMatch(source, />Trang trước<|>Trang sau</);
  }
});

test('shared spacing tokens and mobile pagination are defined', async () => {
  const css = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  for (const token of ['--space-major: 28px', '--space-card: 20px', '--space-heading: 14px', '--space-form: 16px']) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /\.pagination-mobile-count\s*\{[^}]*display:none/s);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.pagination-mobile-count\s*\{\s*display:inline-block/);
});
