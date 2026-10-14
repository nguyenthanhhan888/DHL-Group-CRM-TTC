import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fetchLegacyPublicCatalog,
  filterLegacyBusinessTypes,
  startLegacyBackgroundInitialization,
} from '../src/pages/LegacyRegistrationPage.js';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function publicCatalogServices({ categories = [], businessTypes = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    categoryService: {
      async listPublicActive() {
        calls.push('categories:public');
        if (fail) throw new Error('catalog unavailable');
        return { data: categories };
      },
      async listActive() {
        throw new Error('authenticated category service must not be called');
      },
    },
    businessTypeService: {
      async listPublicActive() {
        calls.push('business-types:public');
        return { data: businessTypes };
      },
      async listActive() {
        throw new Error('authenticated business-type service must not be called');
      },
    },
  };
}

test('logged-out Legacy catalog loading uses only public category services', async () => {
  const services = publicCatalogServices({
    categories: [{ id: 2, name: 'Y tế' }, { id: 1, name: 'Ăn uống' }],
    businessTypes: [
      { id: 21, category_id: 2, name: 'Phòng khám' },
      { id: 11, category_id: 1, name: 'Nhà hàng' },
    ],
  });
  const result = await fetchLegacyPublicCatalog(services);

  assert.deepEqual(services.calls, ['categories:public', 'business-types:public']);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.categories.map(({ id }) => id), [1, 2]);
});

test('Legacy catalog distinguishes empty data from loading and failure', async () => {
  const empty = publicCatalogServices();
  assert.equal((await fetchLegacyPublicCatalog(empty)).status, 'empty');

  const failed = publicCatalogServices({ fail: true });
  await assert.rejects(fetchLegacyPublicCatalog(failed), /catalog unavailable/);
});

test('a failed public catalog request can be retried successfully', async () => {
  let attempt = 0;
  const categoryService = {
    async listPublicActive() {
      attempt += 1;
      if (attempt === 1) throw new Error('temporary failure');
      return { data: [{ id: 1, name: 'Dịch vụ' }] };
    },
  };
  const businessTypeService = {
    async listPublicActive() {
      return { data: [{ id: 10, category_id: 1, name: 'Tư vấn' }] };
    },
  };

  await assert.rejects(
    fetchLegacyPublicCatalog({ categoryService, businessTypeService }),
    /temporary failure/,
  );
  const retried = await fetchLegacyPublicCatalog({ categoryService, businessTypeService });
  assert.equal(retried.status, 'success');
  assert.equal(attempt, 2);
});

test('catalog initialization is independent when public settings are slow or fail', async () => {
  let releaseSettings;
  const slowSettings = new Promise((resolve) => { releaseSettings = resolve; });
  const events = [];
  const slowRun = startLegacyBackgroundInitialization({
    catalogTask: async () => { events.push('catalog:start'); events.push('catalog:success'); },
    settingsTask: async () => { events.push('settings:start'); await slowSettings; events.push('settings:success'); },
    zaloTask: () => events.push('zalo:bound'),
  });

  await slowRun.catalogPromise;
  assert.deepEqual(events, ['catalog:start', 'catalog:success', 'settings:start']);
  releaseSettings();
  await slowRun.settingsPromise;
  assert.deepEqual(events, [
    'catalog:start', 'catalog:success', 'settings:start', 'settings:success', 'zalo:bound',
  ]);

  let failedSettingsZaloCalls = 0;
  const failedRun = startLegacyBackgroundInitialization({
    catalogTask: async () => 'catalog-success',
    settingsTask: async () => { throw new Error('settings unavailable'); },
    zaloTask: () => { failedSettingsZaloCalls += 1; },
  });
  assert.equal(await failedRun.catalogPromise, 'catalog-success');
  await failedRun.settingsPromise;
  assert.equal(failedSettingsZaloCalls, 1);
});

test('category dependency exposes only matching services', () => {
  const types = [
    { id: 10, category_id: 1, name: 'A' },
    { id: 20, category_id: 2, name: 'B' },
    { id: 11, category_id: '1', name: 'C' },
  ];
  assert.deepEqual(filterLegacyBusinessTypes(types, 1).map(({ id }) => id), [10, 11]);
  assert.deepEqual(filterLegacyBusinessTypes(types, 3), []);
});

test('Legacy UI has terminal catalog states, Retry, dependencies and multi-Kiosk controls', async () => {
  const [page, settings, css] = await Promise.all([
    source('src/pages/LegacyRegistrationPage.js'),
    source('src/services/SettingsService.js'),
    source('src/styles/app.css'),
  ]);

  assert.match(page, /LegacyRegistrationPage\.afterRender = function/);
  assert.doesNotMatch(page, /LegacyRegistrationPage\.afterRender = async function/);
  assert.match(page, /startLegacyBackgroundInitialization\(\)/);
  assert.match(settings, /getPublicSettings\(\)[\s\S]*requirePublicSupabaseClient\(\)/);
  for (const state of ['loading', 'success', 'empty', 'error']) {
    assert.match(page, new RegExp(`${state}:`));
  }
  assert.match(page, /data-legacy-catalog-retry/);
  assert.match(page, /categorySelect\.disabled = state\.catalogStatus !== 'success'/);
  assert.match(page, /select\.disabled = !categoryId \|\| !items\.length/);
  assert.match(page, /renderBusinessTypeSelect\(card, categorySelect\.value, selectedBusinessType\)/);
  assert.match(page, /id="legacy-add-kiosk"/);
  assert.match(page, /data-remove-kiosk/);
  assert.match(page, /state\.mode = event\.target\.value/);
  assert.match(page, /renderKioskCard\(\)/);
  assert.match(page, /Số tiền đã thanh toán/);
  assert.match(page, /Ngày đăng ký/);
  assert.match(page, /Ngày hết hạn/);

  assert.match(css, /\.legacy-registration-v3 \.legacy-kiosk-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.legacy-registration-v3 \.legacy-kiosk-card \.form-group\{[^}]*gap:9px/);
  assert.match(css, /@media\(max-width:620px\)[^{]*\{[^}]*[\s\S]*?\.legacy-registration-v3 \.legacy-kiosk-grid\{grid-template-columns:1fr/);
});
