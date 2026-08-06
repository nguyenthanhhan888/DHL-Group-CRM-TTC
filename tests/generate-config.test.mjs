import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const scriptPath = resolve('scripts/generate-config.mjs');

test('production build generates valid browser config from only public Supabase values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dhl-config-'));
  const result = runGenerator(directory, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak',
    PAYOS_API_KEY: 'must-not-leak',
    PAYOS_CHECKSUM_KEY: 'must-not-leak',
  });

  assert.equal(result.status, 0, result.stderr);
  const source = await readFile(join(directory, 'config.js'), 'utf8');
  assert.doesNotMatch(source, /must-not-leak|SERVICE_ROLE|PAYOS/);

  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.DHL_CONFIG)),
    {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
    },
  );
});

test('production build fails clearly when required variables are missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dhl-config-missing-'));
  const result = runGenerator(directory, {});

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_URL/);
  assert.match(result.stderr, /SUPABASE_ANON_KEY/);
});

test('Supabase client reads generated config and local config keeps the same contract', async () => {
  globalThis.window = {
    DHL_CONFIG: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'local-or-generated-key',
    },
    supabase: { createClient() {} },
  };
  const { getSupabaseStatus } = await import('../src/supabase/client.js');
  assert.deepEqual(getSupabaseStatus(), {
    configured: true,
    hasUrl: true,
    hasAnonKey: true,
    hasSdk: true,
  });

  const localSource = await readFile(resolve('config.local.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(localSource, context);
  assert.equal(typeof context.window.DHL_CONFIG.supabaseUrl, 'string');
  assert.equal(typeof context.window.DHL_CONFIG.supabaseAnonKey, 'string');
  assert.ok(context.window.DHL_CONFIG.supabaseUrl);
  assert.ok(context.window.DHL_CONFIG.supabaseAnonKey);
});

function runGenerator(cwd, environment) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    env: {
      PATH: process.env.PATH,
      ...environment,
    },
    encoding: 'utf8',
  });
}
