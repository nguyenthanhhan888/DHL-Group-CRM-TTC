const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const API_ROOT = path.join(ROOT, 'api');

test('Vercel Hobby deployment has at most 12 physical function entrypoints', () => {
  const functions = javascriptFiles(API_ROOT)
    .filter((file) => !path.basename(file).startsWith('_'));

  assert.equal(functions.length, 12);
  assert.equal(existsSync(path.join(API_ROOT, 'staff.js')), false);
});

test('legacy /api/staff is rewritten to the user-management compatibility branch', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rewrite = config.rewrites?.find((item) => item.source === '/api/staff');

  assert.deepEqual(rewrite, {
    source: '/api/staff',
    destination: '/api/user-management?compat=staff',
  });
  assert.equal(existsSync(path.join(ROOT, 'server/api/staff-compat.js')), true);
});

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(file);
    return entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}
