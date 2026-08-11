import test from 'node:test';
import assert from 'node:assert/strict';
import { PayosResultCard } from '../src/components/PayosResultCard.js';

test('PayosResultCard renders bank transfer details for inline payment', () => {
  const html = PayosResultCard({
    amountLabel: '100.000 đ',
    accountName: 'NGUYEN THANH HAN',
    accountNumber: 'VQRQALCDW2290',
    bankName: 'MB',
    checkoutUrl: 'https://pay.payos.vn/example',
    description: 'DHLTOPUP',
    orderCode: 123456,
    paymentLinkId: 'plink_123',
    qrCode: '000201010212',
  });

  assert.match(html, /<code>MB<\/code>/);
  assert.match(html, /NGUYEN THANH HAN/);
  assert.match(html, /VQRQALCDW2290/);
  assert.match(html, /DHLTOPUP/);
  assert.match(html, /data-copy-text="VQRQALCDW2290"/);
  assert.match(html, /Mở trang thanh toán/);
  assert.doesNotMatch(html, /Mã thanh toán/);
  assert.doesNotMatch(html, /Mã tham chiếu/);
  assert.match(html, /data-payos-payment-link-id="plink_123"/);
});

test('PayosResultCard reads transfer details from VietQR payload when PayOS omits them', () => {
  const html = PayosResultCard({
    amountLabel: '200.000 đ',
    checkoutUrl: 'https://pay.payos.vn/example',
    description: 'DHLTOPUP',
    orderCode: 1786296818645457,
    paymentLinkId: 'technical-payment-link-id',
    qrCode: '00020101021238450010A000000727012700069704220113VQRQALCDW34265916NGUYEN THANH HAN62120808DHLTOPUP',
  });

  assert.match(html, /<code>MB<\/code>/);
  assert.match(html, /NGUYEN THANH HAN/);
  assert.match(html, /VQRQALCDW3426/);
  assert.match(html, /200\.000 đ/);
  assert.match(html, /DHLTOPUP/);
  assert.doesNotMatch(html, /Mã thanh toán/);
  assert.doesNotMatch(html, /Mã tham chiếu/);
  assert.match(html, /data-payos-payment-link-id="technical-payment-link-id"/);
});
