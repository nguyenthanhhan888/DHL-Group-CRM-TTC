import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Facebook help uses a dedicated responsive modal and readable step hierarchy', async () => {
  const [resolver, css] = await Promise.all([
    read('src/components/FacebookIdResolver.js'),
    read('src/styles/app.css'),
  ]);
  assert.match(resolver, /className: 'modal-facebook-help'/);
  assert.equal((resolver.match(/class="fb-help-step"/g) || []).length, 5);
  assert.match(resolver, /fb-help-intro/);
  assert.match(css, /\.modal-facebook-help\s*\{\s*width:min\(620px,100%\)/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.modal-facebook-help\s*\{\s*width:calc\(100% - 8px\)/);
  assert.match(css, /\.fb-help-example code\s*\{[^}]*overflow-wrap:anywhere/s);
});

test('public checkbox and radio labels distinguish checked, unchecked and disabled states', async () => {
  const css = await read('src/styles/app.css');
  assert.match(css, /\.public-site \.checkbox-field[\s\S]*color:var\(--text-secondary\)/);
  assert.match(css, /\.public-site \.checkbox-field:has\(input:checked\)[\s\S]*color:var\(--text-primary\)/);
  assert.match(css, /\.public-site \.checkbox-field:has\(input:disabled\)[\s\S]*color:var\(--text-disabled\)/);
  assert.match(css, /\.public-site \.checkbox-field a[\s\S]*color:var\(--text-link\)/);
  assert.match(css, /accent-color:var\(--primary\)/);
});

test('public polish leaves resolver and PayOS contracts untouched', async () => {
  const [resolver, register, lookup] = await Promise.all([
    read('src/components/FacebookIdResolver.js'),
    read('src/pages/RegisterPage.js'),
    read('src/pages/LookupPage.js'),
  ]);
  assert.match(resolver, /FacebookIdService\.resolve/);
  assert.match(register, /fetchPayosStatus\(orderCode, paymentLinkId\)/);
  assert.match(register, /RegistrationService\.submitWithPayos/);
  assert.match(lookup, /PublicLookupService\.createRenewal/);
  assert.match(lookup, /PublicLookupService\.renewalStatus/);
  assert.doesNotMatch(`${resolver}\n${register}\n${lookup}`, /python http\.server|501 POST/i);
});
