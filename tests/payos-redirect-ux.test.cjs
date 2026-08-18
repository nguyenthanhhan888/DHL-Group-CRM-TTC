const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('registration creates checkout then redirects without inline payment presentation', async () => {
  const [page, card] = await Promise.all([source('src/pages/RegisterPage.js'), source('src/components/PayosResultCard.js')]);
  assert.match(page, /window\.location\.assign\(payment\.checkoutUrl\)/);
  assert.match(page, /fetchPayosStatus\(orderCode, paymentLinkId\)/);
  assert.doesNotMatch(page, /PayosResultCard\s*\(|qrCode|accountNumber|bankName/);
  assert.doesNotMatch(card, /<img|qrCode|accountNumber|accountName|bankName|VietQR/);
});

test('return hints never finalize and completed registration renders kiosk details', async () => {
  const [page, status] = await Promise.all([source('src/pages/RegisterPage.js'), source('api/payos/status.js')]);
  assert.match(page, /payosReturnParams/);
  assert.match(page, /Đang xác nhận thanh toán/);
  assert.match(page, /Thanh toán thành công/);
  assert.match(page, /PaymentKioskList/);
  assert.doesNotMatch(`${page}\n${status}`, /handle_payos_webhook|confirm_crm_payment|update\s+public\./i);
  assert.match(status, /order === 'paid' && payment === 'completed'/);
});

test('public renewal redirects and polls read-only status for at most 30 seconds', async () => {
  const [page, status] = await Promise.all([source('src/pages/LookupPage.js'), source('api/public/renewal-status.js')]);
  assert.match(page, /window\.location\.assign\(data\.checkoutUrl\)/);
  assert.match(page, /attempt < 10/);
  assert.match(page, /setTimeout\(resolve, 3000\)/);
  assert.match(page, /Gia hạn thành công/);
  assert.match(page, /Bạn đã huỷ thanh toán/);
  assert.doesNotMatch(status, /handle_payos_webhook|confirm_crm_payment|update\s+public\./i);
});

test('signed PayOS webhook probe order 123 is ignored before business RPC', async () => {
  const webhook = await source('api/payos/webhook.js');
  const guard = webhook.indexOf('Number(data.orderCode) === 123');
  const rpc = webhook.indexOf("callSupabaseRpc('handle_payos_webhook'");
  assert.ok(guard > 0 && rpc > guard);
  assert.match(webhook, /safeCompareHex\(expectedSignature, signature\)/);
  assert.match(webhook, /ignored: true, test: true/);
});
