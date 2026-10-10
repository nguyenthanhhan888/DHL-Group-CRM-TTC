import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { isLegacyRequest, registrationFollowup } from '../src/utils/registrationFollowup.js';

const pageSource = fs.readFileSync(new URL('../src/pages/RegistrationRequestsPage.js', import.meta.url), 'utf8');
const actionBlock = pageSource.slice(
  pageSource.indexOf('function actionButtons(item)'),
  pageSource.indexOf('\nfunction handleAction'),
);
const actionButtons = new Function(
  'registrationFollowup',
  'state',
  'escapeHtml',
  `${actionBlock}; return actionButtons;`,
)(registrationFollowup, { canConfirmPayment: true }, value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'));

const request = (status, overrides = {}) => ({
  id: 1,
  status,
  metadata: {},
  customer_id: 10,
  kiosk_id: 20,
  payment_id: 30,
  total_amount: 100,
  registration_batch_id: null,
  ...overrides,
});

function labels(markup) {
  return [...markup.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1].trim());
}

test('normal pending exposes only Duyệt and Từ chối', () => {
  const markup = actionButtons(request('pending'));
  assert.deepEqual(labels(markup), ['Duyệt', 'Từ chối']);
  assert.match(markup, /data-request-action="approve"/);
  assert.match(markup, /data-request-action="reject"/);
});

for (const workflow of ['legacy', 'additional']) {
  test(`${workflow} pending exposes the same Duyệt and Từ chối vocabulary`, () => {
    const item = request('pending', { metadata: { request_type: workflow } });
    assert.equal(isLegacyRequest(item), true);
    const markup = actionButtons(item);
    assert.deepEqual(labels(markup), ['Duyệt', 'Từ chối']);
    assert.match(markup, /data-request-action="legacy-approve"/);
    assert.match(markup, /data-request-action="legacy-cancel"/);
  });
}

test('awaiting payment exposes PayOS, external confirmation and cancellation', () => {
  assert.deepEqual(labels(actionButtons(request('awaiting_payment'))), [
    'Tạo/Mở PayOS',
    'Xác nhận đã nhận tiền',
    'Hủy hồ sơ',
  ]);
});

test('approved complete and terminal records expose no normal action', () => {
  const complete = request('approved', { metadata: { request_type: 'legacy' } });
  assert.equal(registrationFollowup(complete).actions, 'none');
  assert.equal(actionButtons(complete), '—');
  for (const status of ['rejected', 'cancelled']) {
    assert.equal(registrationFollowup(request(status)).actions, 'none');
    assert.equal(actionButtons(request(status)), '—');
  }
});

test('approved incomplete records explain each missing relationship and offer inspection only', () => {
  for (const workflow of ['legacy', 'additional']) {
    for (const [missing, reason] of [
      [{ customer_id: null }, 'Thiếu liên kết Khách hàng'],
      [{ kiosk_id: null }, 'Thiếu liên kết Kiosk'],
      [{ payment_id: null }, 'Thiếu giao dịch thanh toán'],
    ]) {
      const item = request('approved', { metadata: { request_type: workflow }, ...missing });
      assert.deepEqual(registrationFollowup(item), { actionable: true, actions: 'needs-review', reasons: [reason], bucket: 'needs-action' });
      const markup = actionButtons(item);
      assert.match(markup, /Cần kiểm tra/);
      assert.ok(markup.includes(`<li>${reason}</li>`));
      assert.deepEqual(labels(markup), ['Kiểm tra']);
      assert.match(markup, /data-request-action="inspect"/);
    }
  }
});

test('multiple missing relationships display every reason; zero amount needs no payment', () => {
  const item = request('approved', { metadata: { source: 'legacy' }, customer_id: null, kiosk_id: null, payment_id: null });
  const markup = actionButtons(item);
  for (const reason of registrationFollowup(item).reasons) assert.ok(markup.includes(`<li>${reason}</li>`));
  assert.equal((markup.match(/<li>/g) || []).length, 3);
  assert.deepEqual(labels(markup), ['Kiểm tra']);
  assert.equal(actionButtons(request('approved', { metadata: { source: 'additional' }, total_amount: 0, payment_id: null })), '—');
});

test('automated pre-checkout records are hidden; successful checkout is awaiting payment', () => {
  for (const overrides of [{ metadata: { workflow: 'public_payos' } }, { registration_batch_id: 9 }]) {
    const item = request('pending', overrides);
    assert.deepEqual(registrationFollowup(item), { actionable: false, actions: 'none', bucket: 'hidden' });
    assert.equal(actionButtons(item), '—');
    const materialized = { ...item, payos_checkout_created: true, payment_status: 'pending' };
    assert.deepEqual(registrationFollowup(materialized), { actionable: false, actions: 'awaiting-payment', bucket: 'awaiting-payment' });
  }
});

test('Kiểm tra click opens and closes read-only details without invoking any service or mutation flow', () => {
  const item = request('approved', { facebook_name: '<script>unsafe</script>', metadata: { source: 'legacy' }, customer_id: null, kiosk_id: null, payment_id: null });
  const dialogs = [];
  let closeHandler, closed = false;
  const forbidden = () => { assert.fail('Inspection must not call a service or mutation flow'); };
  const box = vm.createContext({
    registrationFollowup,
    escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    StatusBadge: (status, { labels }) => labels[status],
    Modal: { open: dialog => dialogs.push(dialog), close: () => { closed = true; } },
    document: { querySelector: selector => {
      assert.equal(selector, '[data-operation-close]');
      return { addEventListener: (event, handler) => { assert.equal(event, 'click'); closeHandler = handler; } };
    } },
    RegistrationRequestService: new Proxy({}, { get: forbidden }),
    item,
  });
  vm.runInContext(pageSource.replace(/^import .*;\n/gm, '').replace('export function RegistrationRequestsPage', 'function RegistrationRequestsPage'), box);
  vm.runInContext('state.rows = [item];', box);
  Object.assign(box, { runLegacyReviewAction: forbidden, openExternalComplete: forbidden, openAwaitingCancel: forbidden, loadRequests: forbidden });
  box.handleAction({ target: { closest: () => ({ dataset: { requestAction: 'inspect', requestId: '1' } }) } });
  assert.equal(dialogs.length, 1);
  const { body } = dialogs[0];
  assert.match(body, /#1/);
  assert.match(body, /Đã duyệt/);
  assert.match(body, /&lt;script&gt;unsafe/);
  assert.doesNotMatch(body, /<script>|customer_id|kiosk_id|payment_id|data-operation-confirm|<input|<textarea/);
  for (const reason of registrationFollowup(item).reasons) assert.ok(body.includes(reason));
  assert.match(body, /Đối chiếu hồ sơ/);
  assert.deepEqual(labels(body), ['Đóng']);
  closeHandler();
  assert.equal(closed, true);
  assert.equal(vm.runInContext('state.busyId', box), null);
  item.status = 'cancelled';
  box.openInspection(item);
  assert.equal(dialogs.length, 1);
});

test('page briefly explains the distinct human-work badge count', () => {
  assert.match(pageSource, /Số trên mục Hồ sơ Kiosk đếm các hồ sơ đang cần xử lý hoặc kiểm tra dữ liệu/);
  assert.match(pageSource, /Mỗi hồ sơ chỉ tính một lần/);
});

test('unknown workflow values are not broadened into the additional flow', () => {
  assert.equal(isLegacyRequest(request('pending', { metadata: { request_type: 'legacy-copy' } })), false);
  assert.equal(isLegacyRequest(request('pending', { metadata: { source: 'additional-copy' } })), false);
});

test('page keeps existing service/RPC routing while removing old visible labels', () => {
  assert.match(pageSource, /RegistrationRequestService\.approve\(item\.id\)/);
  assert.match(pageSource, /RegistrationRequestService\.reject\(item\.id, reason\)/);
  assert.match(pageSource, /RegistrationRequestService\.reviewLegacy\(item\.id, 'approve'\)/);
  assert.match(pageSource, /RegistrationRequestService\.reviewLegacy\(item\.id, 'cancel', reason\)/);
  assert.match(pageSource, /RegistrationRequestService\.completeExternal\(id, value\)/);
  assert.match(pageSource, /RegistrationRequestService\.cancelAwaiting\(id, value\)/);
  assert.match(pageSource, /PayosService\.createCrmPayment/);
  for (const label of ['Duyệt hồ sơ', 'Duyệt & lưu', 'Hoàn tất lưu', 'Ghi nhận tiền ngoài PayOS']) {
    assert.doesNotMatch(pageSource, new RegExp(label));
  }
});

test('forward migration accepts only legacy/additional and preserves the RPC body', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.registration_requests(metadata jsonb);
      create function public.review_public_legacy_registration_request(
        request_id_input bigint, action_input text, reason_input text default null
      ) returns jsonb language plpgsql as $function$
      declare request_record public.registration_requests%rowtype;
      begin
        request_record.metadata := jsonb_build_object(
          'request_type', action_input,
          'source', reason_input
        );
        if request_record.metadata->>'request_type' <> 'legacy' then
          raise exception 'unsupported workflow';
        end if;
        return jsonb_build_object('business_marker', 'unchanged');
      end;
      $function$;
    `);
    const migration = fs.readFileSync(
      new URL('../supabase/migrations/20261008174357_accept_additional_registration_review.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    for (const [type, source] of [['legacy', null], ['additional', null], [null, 'additional']]) {
      const result = await db.query(
        'select review_public_legacy_registration_request(1,$1,$2) data',
        [type, source],
      );
      assert.equal(result.rows[0].data.business_marker, 'unchanged');
    }
    await assert.rejects(
      () => db.query("select review_public_legacy_registration_request(1,'other',null)"),
      /unsupported workflow/,
    );
  } finally {
    await db.close();
  }
});
