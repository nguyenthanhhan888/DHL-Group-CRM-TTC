const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/20260811231519_fix_public_renewal_service_role_authorization.sql');

test('renewal authorization uses canonical verified JWT role claim', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /coalesce\(auth\.jwt\(\)\s*->>\s*'role',\s*''\)\s*<>\s*'service_role'/i);
  assert.doesNotMatch(sql, /request\.jwt\.claim\.role/);
});

test('anon and authenticated cannot execute while service_role can', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to (?:anon|authenticated)/i);
});

test('renewal authorization expiry remains bounded to 15 minutes', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /expires_at_input\s*<=\s*now\(\)/i);
  assert.match(sql, /expires_at_input\s*>\s*now\(\)\s*\+\s*interval '15 minutes'/i);
});

test('server RPC helper selects the service credential for renewal authorization', async () => {
  const [lookup, helper] = await Promise.all([
    readFile(path.join(root, 'api/public/kiosk-lookup.js'), 'utf8'),
    readFile(path.join(root, 'api/payos/_utils.js'), 'utf8'),
  ]);
  assert.match(lookup, /register_public_renewal_authorization[\s\S]*serviceRole:true/);
  assert.match(helper, /process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*requireEnv\('SUPABASE_SERVICE_KEY'\)/);
  assert.match(helper, /useServiceRole\s*\?\s*getSupabaseServiceConfig\(\)\s*:\s*getSupabaseUserConfig\(\)/);
});

test('safe RPC diagnostics preserve useful fields and redact secrets', () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-for-test';
  process.env.PUBLIC_RENEWAL_TOKEN_SECRET = 'renewal-secret-for-test';
  const { safeAuthorizationRpcError } = require('../api/public/kiosk-lookup');
  assert.deepEqual(safeAuthorizationRpcError({ code: '42501', message: 'permission denied', details: 'role check failed', hint: 'Use service_role' }), {
    code: '42501', message: 'permission denied', details: 'role check failed', hint: 'Use service_role',
  });
  const redacted = safeAuthorizationRpcError({ message: 'service-role-secret-for-test', details: 'nonce=abc', hint: 'phone leaked' });
  assert.equal(redacted.message, '[REDACTED]');
  assert.equal(redacted.details, '[REDACTED]');
  assert.equal(redacted.hint, '[REDACTED]');
});
