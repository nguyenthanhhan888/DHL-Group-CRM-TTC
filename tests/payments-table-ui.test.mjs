import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { paymentConfirmerLabel } from '../src/pages/PaymentsPage.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Payments exposes the approved eight-column compact table', async () => {
  const page = await read('src/pages/PaymentsPage.js');
  const columns = page.slice(page.indexOf('const PAYMENT_COLUMNS'), page.indexOf('const PAYMENT_STATUSES'));
  for (const label of [
    'STT',
    'Kiosk / Khách hàng',
    'Dịch vụ / Kỳ hạn',
    'Thanh toán',
    'Trạng thái',
    'Người xác nhận',
    'Thời gian',
    'Thao tác',
  ]) assert.match(columns, new RegExp(label.replace('/', '\\/')));
  assert.equal((columns.match(/\{ label:/g) || []).length, 8);
  assert.doesNotMatch(columns, /Ngày ghi nhận|Hành động|Giảm giá|Giá\/tháng/);
  assert.match(page, /fromLabel: 'Từ ngày', toLabel: 'Đến ngày'/);
  assert.doesNotMatch(page, /<summary>Khác<\/summary>/);
  assert.doesNotMatch(page, /\(VN\)|giờ VN/);
  assert.match(page, /data-payment-menu-trigger aria-haspopup="menu" aria-expanded="false"/);
  assert.match(page, /const startIndex = \(state\.page - 1\) \* state\.pageSize/);
  assert.match(page, /const rowNumber = startIndex \+ index \+ 1/);
  assert.match(page, /function positionPaymentMenu/);
  assert.match(page, /event\.key === 'Escape'/);
  assert.match(page, /\['ArrowDown', 'ArrowUp'\]/);
  assert.match(page, /class="payment-desktop-cell payment-card-index"/);
  assert.match(page, /class="payment-desktop-cell payment-card-party"/);
  assert.match(page, /class="payment-desktop-cell payment-card-actions"/);
  assert.match(page, /class="payment-mobile-card" colspan="\$\{PAYMENT_COLUMNS\.length\}"/);
  assert.match(page, /class="payment-mobile-index"[^>]*href="\$\{detailHref\}"/);
  assert.match(page, /class="payment-mobile-status"/);
  assert.match(page, /class="payment-mobile-actions"/);
  assert.doesNotMatch(page, /aria-label="Mở thao tác thanh toán \$\{escapeHtml\(payment\.id\)\}"/);
});

test('confirmer labels distinguish CRM people, PayOS and historical records without UUID output', () => {
  const uuid = '2f6345d8-6b46-4ae9-97a7-a905a52f5370';
  assert.deepEqual(paymentConfirmerLabel({
    payment_status: 'completed',
    confirmed_by: uuid,
    confirmer_profile: { display_name: 'Nguyễn An' },
  }), { primary: 'Nguyễn An', secondary: 'Xác nhận thủ công', kind: 'person' });
  assert.equal(paymentConfirmerLabel({ payment_status: 'completed', payos_order_code: 123 }).primary, 'PayOS tự động');
  assert.equal(paymentConfirmerLabel({ payment_status: 'completed', payment_method: 'legacy' }).primary, 'Quy trình Legacy');
  assert.equal(paymentConfirmerLabel({ payment_status: 'completed', confirmed_by: uuid }).primary, 'Tài khoản CRM cũ');
  assert.equal(paymentConfirmerLabel({ payment_status: 'pending' }).primary, 'Chưa xác nhận');
  assert.doesNotMatch(JSON.stringify(paymentConfirmerLabel({ payment_status: 'completed', confirmed_by: uuid })), new RegExp(uuid));
});

test('Payments resolves confirmer profiles in a read-only batch and has mobile cards', async () => {
  const [service, css] = await Promise.all([
    read('src/services/PaymentService.js'),
    read('src/styles/app.css'),
  ]);
  assert.match(service, /from\('user_profiles'\)[\s\S]*select\('user_id,display_name,username,email'\)[\s\S]*\.in\('user_id', userIds\)/);
  assert.match(css, /\.payments-summary\s*\{[\s\S]*?margin: 18px 0 20px/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.payments-table thead \{ display:none; \}/);
  assert.match(css, /\.payment-action-dropdown \{ position:fixed; z-index:260/);
  assert.match(css, /\.payment-primary-link \{[^}]*color:var\(--text-link\)[^}]*font-weight:800[^}]*text-decoration:none/);
  assert.match(css, /\.payment-party small a \{[^}]*color:var\(--text-muted\)[^}]*font-weight:400[^}]*text-decoration:none/);
  assert.match(css, /\.payment-primary-link:focus-visible,\.payment-party small a:focus-visible/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.payments-table td\.payment-desktop-cell \{ display:none; \}/);
  assert.match(css, /\.payments-table td\.payment-mobile-card \{[^}]*width:100%[^}]*min-width:0[^}]*display:block/);
  assert.match(css, /\.payment-mobile-header \{[^}]*grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.payment-mobile-section \{[^}]*display:block/);
  assert.match(css, /\.payment-mobile-card \.payment-primary-link \{[^}]*word-break:normal[^}]*overflow-wrap:break-word/);
  assert.doesNotMatch(css, /\.payment-mobile-card[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(css, /\.payments-table tr \{[^}]*grid-template-columns:repeat\(12/);
  assert.match(css, /\.payment-action-trigger \{ width:44px; height:44px/);
  assert.match(css, /\.payments-table tr>td\[colspan\]:not\(\.payment-mobile-card\) \{[^}]*display:block/);
});
