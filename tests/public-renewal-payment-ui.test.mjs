import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renderPayosQr } from '../src/components/PayosResultCard.js';
import { renewalConfirmationCard, renewalPaymentCard } from '../src/pages/LookupPage.js';

const require = createRequire(import.meta.url);
const { normalizeQr, normalizeTransfer } = require('../api/public/renew-kiosk.js');
const { publicRenewalPeriod } = require('../api/public/_renewal-period.js');

test('raw PayOS VietQR payload is normalized and never used directly as img src', () => {
  const payload = '00020101021238570010A00000072701270006970422011312345678901230208QR1234565303704';
  assert.deepEqual(normalizeQr(payload), { format: 'payload', value: payload });
  const html = renderPayosQr({ format: 'payload', value: payload });
  assert.doesNotMatch(html, new RegExp(`<img[^>]+src=["']${payload}`));
  assert.match(html, /api\.qrserver\.com\/v1\/create-qr-code/);
  assert.match(html, new RegExp(encodeURIComponent(payload)));
});

test('valid image QR sources remain supported without exposing secrets', () => {
  const source = 'data:image/png;base64,ZmFrZQ==';
  assert.deepEqual(normalizeQr(source), { format: 'image', value: source });
  assert.match(renderPayosQr({ format: 'image', value: source }), /src="data:image\/png;base64,ZmFrZQ=="/);
});

test('pending card distinguishes current and proposed expiry and never claims completion', () => {
  const html = renewalPaymentCard({ kiosk: 'Phạm Thị Hoa', amount: 300000, qr: null, checkoutUrl: 'https://pay.payos.vn/example' }, 0, {
    months: 1, currentExpiry: '2026-08-14', proposedExpiry: '2026-09-14',
  });
  assert.match(html, /Ngày hết hạn hiện tại/);
  assert.match(html, /Ngày hết hạn dự kiến/);
  assert.match(html, /Đang chờ thanh toán/);
  assert.match(html, /chỉ được áp dụng sau khi PayOS xác nhận/);
  assert.doesNotMatch(html, /Kiosk đã được gia hạn|Ngày hết hạn mới/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test('confirmation card shows authoritative lookup price, allowed durations, and period preview', () => {
  const html = renewalConfirmationCard({ kiosk:'Kiosk A',pricePerMonth:300000,endDate:'2026-08-14',renewalPeriods:{1:{proposedExpiry:'2026-09-14'}} },0,1);
  assert.match(html,/300\.000 VNĐ \/ tháng/);
  for(const months of [1,3,6,12])assert.match(html,new RegExp(`value="${months}"`));
  assert.match(html,/14\/09\/2026/);
  assert.match(html,/Tạm tính/);
  assert.match(html,/Thành tiền/);
  assert.match(html,/Tiếp tục thanh toán/);
  assert.doesNotMatch(html,/discount|promotion|giảm giá/i);
});

test('manual transfer uses fields from the same PayOS response and makes amount and description copyable', () => {
  const transfer=normalizeTransfer({accountNumber:'VQR123',accountName:'DHL GROUP',bankName:'MB',description:'DHL123'},300000,'DHL123');
  const html=renewalPaymentCard({kiosk:'Kiosk A',amount:300000,qr:null,transfer},0,{months:1,currentExpiry:'2026-08-14',proposedExpiry:'2026-09-14'});
  assert.equal(transfer.accountNumber,'VQR123');
  assert.match(html,/Hoặc chuyển khoản thủ công/i);
  assert.match(html,/data-copy-text="VQR123"/);
  assert.match(html,/data-copy-text="300\.000 VNĐ"/);
  assert.match(html,/data-copy-text="DHL123"/);
  assert.match(html,/chuyển đúng số tiền và nội dung/);
});

test('public renewal period preserves remaining time and follows inclusive calendar months', () => {
  assert.deepEqual(publicRenewalPeriod('2026-08-14', 1, '2026-08-12'), {
    startDate: '2026-08-15', proposedExpiry: '2026-09-14',
  });
  assert.deepEqual(publicRenewalPeriod('2026-08-01', 1, '2026-08-12'), {
    startDate: '2026-08-12', proposedExpiry: '2026-09-11',
  });
});

test('countdown, terminal-state, retry, theme, and mobile contracts remain present', async () => {
  const [page, css, status] = await Promise.all([
    readFile(new URL('../src/pages/LookupPage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8'),
    readFile(new URL('../api/public/renewal-status.js', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /remaining<=300/);
  assert.match(page, /data-renew-stale-actions[^]*classList\.add\('hidden'\)/);
  assert.match(page, /Tạo mã thanh toán mới/);
  assert.match(page, /await createRenewal\(index,months\)/);
  assert.match(status, /currentExpiry/);
  assert.match(status, /proposedExpiry/);
  assert.match(status, /newExpiry: completed \?/);
  assert.doesNotMatch(status,/handle_payos_webhook|payment_status\s*=\s*['"]completed/);
  assert.match(css, /\.public-renew-payment-card[^}]*var\(--bg-surface\)/);
  assert.match(css, /@media\(max-width:768px\)[^}]*\.public-renew-payment-card/s);
  assert.match(css, /width:min\(100%,240px\)/);
});

test('desktop manual transfer uses wide payment columns and stable field cards', async () => {
  const [page,css]=await Promise.all([
    readFile(new URL('../src/pages/LookupPage.js',import.meta.url),'utf8'),
    readFile(new URL('../src/styles/app.css',import.meta.url),'utf8'),
  ]);
  assert.match(page,/public-renew-payment-columns/);
  assert.match(page,/public-renew-qr-column/);
  assert.match(page,/public-transfer-field/);
  assert.match(page,/is-full/);
  assert.match(css,/@media\(min-width:1024px\)[^}]*\.portal-page\.narrow\.public-lookup-page/s);
  assert.match(css,/grid-template-columns:minmax\(280px,\.9fr\) minmax\(420px,1\.1fr\)/);
  assert.match(css,/\.public-manual-transfer dl\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.public-transfer-field\.is-full\{grid-column:1\/-1\}/);
});

test('manual transfer values wrap normally and copy controls cannot squeeze them', async () => {
  const css=await readFile(new URL('../src/styles/app.css',import.meta.url),'utf8');
  const transferCss=css.slice(css.indexOf('.public-manual-transfer'),css.indexOf('.public-renew-success'));
  assert.match(transferCss,/grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(transferCss,/white-space:normal/);
  assert.match(transferCss,/word-break:normal/);
  assert.match(transferCss,/overflow-wrap:break-word/);
  assert.doesNotMatch(transferCss,/word-break:break-all/);
  assert.match(transferCss,/width:112px;min-width:112px;white-space:nowrap/);
});

test('manual transfer remains stacked and tap-friendly through 768px', async () => {
  const css=await readFile(new URL('../src/styles/app.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:768px\)[^]*\.public-manual-transfer dl\{grid-template-columns:1fr\}/);
  assert.match(css,/@media\(max-width:768px\)[^]*\.public-manual-transfer dd\{grid-template-columns:1fr/);
  assert.match(css,/@media\(max-width:768px\)[^]*\.public-manual-transfer \.compact-button\{width:100%;min-width:0\}/);
  assert.match(css,/\.public-manual-transfer[^}]*border-top:1px solid var\(--border-soft\)/);
  assert.doesNotMatch(css,/\.public-manual-transfer[^}]*#[0-9a-f]{3,8}/i);
});
