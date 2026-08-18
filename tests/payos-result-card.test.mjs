import test from 'node:test';
import assert from 'node:assert/strict';
import { PayosResultCard } from '../src/components/PayosResultCard.js';

test('PayosResultCard exposes only checkout and optional link copy actions', () => {
  const html = PayosResultCard({
    amountLabel: '100.000 đ', accountName: 'SECRET NAME', accountNumber: 'SECRET ACCOUNT',
    bankName: 'MB', checkoutUrl: 'https://pay.payos.vn/example', description: 'SECRET DESCRIPTION',
    orderCode: 123456, paymentLinkId: 'plink_123', qrCode: '000201010212',
  });
  assert.match(html, /Mở PayOS/);
  assert.match(html, /Sao chép link thanh toán/);
  assert.match(html, /data-payos-payment-link-id="plink_123"/);
  for (const secret of ['SECRET NAME', 'SECRET ACCOUNT', 'SECRET DESCRIPTION', '000201010212', '100.000 đ']) assert.doesNotMatch(html, new RegExp(secret));
  assert.doesNotMatch(html, /<img|Ngân hàng|Số tài khoản|Nội dung chuyển khoản/);
});
