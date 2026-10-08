import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  `${actionBlock}; return actionButtons;`,
)(registrationFollowup, { canConfirmPayment: true });

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

test('awaiting payment exposes Xác nhận đã nhận tiền and Hủy hồ sơ', () => {
  assert.deepEqual(labels(actionButtons(request('awaiting_payment'))), [
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

test('approved incomplete records show Cần kiểm tra without a recovery button', () => {
  for (const missing of [
    { customer_id: null },
    { kiosk_id: null },
    { payment_id: null },
  ]) {
    const item = request('approved', { metadata: { request_type: 'additional' }, ...missing });
    assert.deepEqual(registrationFollowup(item), { actionable: true, actions: 'needs-review' });
    const markup = actionButtons(item);
    assert.match(markup, /Cần kiểm tra/);
    assert.doesNotMatch(markup, /<button|Hoàn tất lưu/);
  }
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
