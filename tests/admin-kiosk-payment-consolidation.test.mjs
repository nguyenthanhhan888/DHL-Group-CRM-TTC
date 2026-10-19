import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { asQaUser, createPermissionQaDatabase, qaUsers } from './fixtures/permission-qa-database.mjs';

const migrationUrl = new URL('../supabase/migrations/20261019183139_consolidate_admin_kiosk_payment_workflows.sql', import.meta.url);
let db;
let identitySequence;

beforeEach(async () => {
  db = await createPermissionQaDatabase();
  await db.exec(await readFile(migrationUrl, 'utf8'));
  await db.exec("select setval('customers_id_seq',100); select setval('kiosks_id_seq',100)");
  identitySequence = 0;
});

afterEach(async () => db?.close());

const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0];
const dateOnly = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const rpc = async (name, args = [], user = 'admin') => Object.values((await asQaUser(
  db,
  user,
  `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')})`,
  args,
)).rows[0])[0];

function kioskPayload(overrides = {}) {
  identitySequence += 1;
  const facebookId = overrides.facebook_id || `9888800${String(identitySequence).padStart(4, '0')}`;
  return {
    facebook_name: `TEST Kiosk ${facebookId}`,
    facebook_id: facebookId,
    facebook_link: `https://www.facebook.com/${facebookId}`,
    business_type_id: 1,
    months: 1,
    discount: 0,
    ...overrides,
  };
}

async function createRenewalPayment({ months, bonusMonths = 0, currentEnd, originalStart = '2020-01-01' }) {
  const identity = `9777700${String(++identitySequence).padStart(4, '0')}`;
  const kiosk = (await db.query(`
    insert into public.kiosks(
      customer_id, facebook_name, facebook_id, facebook_link,
      business_type_id, category_id, start_date, end_date, status
    ) values (1, $1, $2, $3, 1, 1, $4, $5, 'active') returning *
  `, [`TEST renewal ${identity}`, identity, `https://facebook.com/${identity}`, originalStart, currentEnd])).rows[0];
  const payment = (await db.query(`
    insert into public.payments(
      customer_id, kiosk_id, months, bonus_months, price_per_month,
      discount, total_amount, payment_method, payment_status
    ) values (1, $1, $2, $3, 100000, 0, $4, 'transfer', 'pending') returning *
  `, [kiosk.id, months, bonusMonths, months * 100000])).rows[0];
  return { kiosk, payment };
}

test('manual confirmation uses inclusive 1/3/6/12 month periods and preserves renewal start date', async () => {
  const cases = [
    [1, '2091-02-14'],
    [3, '2091-04-14'],
    [6, '2091-07-14'],
    [12, '2092-01-14'],
  ];

  for (const [months, expectedEnd] of cases) {
    const { kiosk, payment } = await createRenewalPayment({ months, currentEnd: '2091-01-14' });
    const result = await rpc('confirm_payment', [payment.id, `TEST ${months} months`]);
    assert.equal(result.payment.start_date, '2091-01-15');
    assert.equal(result.payment.end_date, expectedEnd);
    assert.equal(dateOnly(await scalar('select start_date from public.kiosks where id=$1', [kiosk.id])), '2020-01-01');
    assert.equal(dateOnly(await scalar('select end_date from public.kiosks where id=$1', [kiosk.id])), expectedEnd);
  }
});

test('manual confirmation handles month-end, leap year, bonus months and duplicate confirmation', async () => {
  const leap = await createRenewalPayment({ months: 1, currentEnd: '2096-01-31' });
  const leapResult = await rpc('confirm_payment', [leap.payment.id, 'TEST leap year']);
  assert.equal(leapResult.payment.start_date, '2096-02-01');
  assert.equal(leapResult.payment.end_date, '2096-02-29');

  const monthEnd = await createRenewalPayment({ months: 1, currentEnd: '2096-03-30' });
  const monthEndResult = await rpc('confirm_payment', [monthEnd.payment.id, 'TEST month end']);
  assert.equal(monthEndResult.payment.start_date, '2096-03-31');
  assert.equal(monthEndResult.payment.end_date, '2096-04-29');

  const bonus = await createRenewalPayment({ months: 1, bonusMonths: 2, currentEnd: '2091-01-14' });
  const bonusResult = await rpc('confirm_payment', [bonus.payment.id, 'TEST bonus']);
  assert.equal(bonusResult.payment.start_date, '2091-01-15');
  assert.equal(bonusResult.payment.end_date, '2091-04-14');

  await assert.rejects(
    () => rpc('confirm_payment', [bonus.payment.id, 'TEST duplicate']),
    error => error.code === '22023',
  );
  assert.equal(dateOnly(await scalar('select end_date from public.payments where id=$1', [bonus.payment.id])), '2091-04-14');

  const legacy = await createRenewalPayment({ months: 1, currentEnd: '2092-05-31' });
  await rpc('confirm_payment', [legacy.payment.id]);
  assert.equal(dateOnly(await scalar('select start_date from public.payments where id=$1', [legacy.payment.id])), '2092-06-01');
  assert.equal(dateOnly(await scalar('select end_date from public.payments where id=$1', [legacy.payment.id])), '2092-06-30');
  assert.equal(Number(await scalar("select count(*) from public.audit_logs where action='confirm'")), 4);
});

test('PayOS mode creates one durable pending intent and retries return the same records', async () => {
  const payload = kioskPayload();
  const args = [1, payload, 'payos', 'test-payos-idempotency-0001', null];
  const first = await rpc('admin_create_existing_customer_kiosk', args);
  const retry = await rpc('admin_create_existing_customer_kiosk', args);

  assert.equal(first.reused, false);
  assert.equal(retry.reused, true);
  assert.equal(retry.kiosk.id, first.kiosk.id);
  assert.equal(retry.payment.id, first.payment.id);
  assert.equal(first.kiosk.status, 'pending');
  assert.equal(first.payment.payment_status, 'pending');
  assert.equal(first.payment.payment_method, 'transfer');
  assert.equal(first.request.status, 'pending');
  assert.equal(Number(await scalar('select count(*) from public.payos_orders')), 0);
  assert.equal(Number(await scalar('select count(*) from public.kiosks where facebook_id=$1', [payload.facebook_id])), 1);
  assert.equal(Number(await scalar('select count(*) from public.payments where kiosk_id=$1', [first.kiosk.id])), 1);

  await assert.rejects(
    () => rpc('admin_create_existing_customer_kiosk', [1, payload, 'payos', 'test-payos-idempotency-0002', null]),
    error => error.code === '23505',
  );
  assert.equal(Number(await scalar('select count(*) from public.kiosks where facebook_id=$1', [payload.facebook_id])), 1);
});

test('external-paid mode confirms and activates in the same RPC exactly once', async () => {
  const payload = kioskPayload({ months: 3 });
  const args = [1, payload, 'external_paid', 'test-external-idempotency-01', 'TEST bank receipt checked'];
  const first = await rpc('admin_create_existing_customer_kiosk', args);
  const retry = await rpc('admin_create_existing_customer_kiosk', args);

  assert.equal(first.reused, false);
  assert.equal(retry.reused, true);
  assert.equal(first.payment.payment_status, 'completed');
  assert.equal(first.payment.payment_method, 'external');
  assert.equal(first.kiosk.status, 'active');
  assert.equal(first.request.status, 'approved');
  assert.equal(first.request.requested_start_date, first.payment.start_date);
  assert.equal(first.request.requested_end_date, first.payment.end_date);
  assert.equal(
    await scalar("select (end_date = (start_date + make_interval(months=>3) - interval '1 day')::date) from public.payments where id=$1", [first.payment.id]),
    true,
  );
  assert.equal(Number(await scalar("select count(*) from public.audit_logs where action='create_external_paid' and record_id=$1", [String(first.kiosk.id)])), 1);
  assert.equal(Number(await scalar('select count(*) from public.payments where kiosk_id=$1', [first.kiosk.id])), 1);
});

test('payment permission and required external evidence are enforced before mutation', async () => {
  await db.query("insert into public.user_permissions(user_id,permission) values ($1,'customers'),($1,'kiosks')", [qaUsers.selective]);
  const before = Number(await scalar('select count(*) from public.kiosks'));
  await assert.rejects(
    () => rpc('admin_create_existing_customer_kiosk', [1, kioskPayload(), 'payos', 'test-permission-key-0001', null], 'selective'),
    error => error.code === '42501',
  );
  await assert.rejects(
    () => rpc('admin_create_existing_customer_kiosk', [1, kioskPayload(), 'payos', 'test-anon-key-00000001', null], null),
    error => error.code === '42501',
  );
  await assert.rejects(
    () => rpc('admin_create_existing_customer_kiosk', [1, kioskPayload(), 'external_paid', 'test-evidence-key-000001', '']),
    error => error.code === '22023',
  );
  assert.equal(Number(await scalar('select count(*) from public.kiosks')), before);

  await db.query("insert into public.user_permissions(user_id,permission) values ($1,'payments')", [qaUsers.selective]);
  const allowed = await rpc('admin_create_existing_customer_kiosk', [
    1,
    kioskPayload(),
    'payos',
    'test-selective-allowed-01',
    null,
  ], 'selective');
  assert.equal(allowed.payment.payment_status, 'pending');
});

test('a failure after confirmation rolls back Kiosk, Payment, Request and audit together', async () => {
  await db.exec(`
    create function public.qa_fail_final_kiosk_audit() returns trigger language plpgsql as $$
    begin
      if new.action = 'create_external_paid' then raise exception 'TEST forced mid-transaction failure'; end if;
      return new;
    end $$;
    create trigger qa_fail_final_kiosk_audit
      before insert on public.audit_logs
      for each row execute function public.qa_fail_final_kiosk_audit();
  `);
  const before = {
    kiosks: Number(await scalar('select count(*) from public.kiosks')),
    payments: Number(await scalar('select count(*) from public.payments')),
    requests: Number(await scalar('select count(*) from public.registration_requests')),
    audits: Number(await scalar('select count(*) from public.audit_logs')),
  };

  await assert.rejects(
    () => rpc('admin_create_existing_customer_kiosk', [
      1,
      kioskPayload(),
      'external_paid',
      'test-rollback-idempotency-01',
      'TEST received cash',
    ]),
    /TEST forced mid-transaction failure/,
  );

  assert.deepEqual({
    kiosks: Number(await scalar('select count(*) from public.kiosks')),
    payments: Number(await scalar('select count(*) from public.payments')),
    requests: Number(await scalar('select count(*) from public.registration_requests')),
    audits: Number(await scalar('select count(*) from public.audit_logs')),
  }, before);
});

test('frontend exposes both modes and calls only the consolidated RPC', async () => {
  const [form, service] = await Promise.all([
    readFile(new URL('../src/components/KioskForm.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/RegistrationService.js', import.meta.url), 'utf8'),
  ]);
  assert.match(form, /value="payos"/);
  assert.match(form, /value="external_paid"/);
  assert.match(form, /Ghi chú đối soát/);
  assert.match(form, /PayosService\.createCrmPayment/);
  assert.match(form, /kioskPeriodEnd\(preview\.startDate, preview\.months\)/);
  assert.match(service, /rpc\('admin_create_existing_customer_kiosk'/);
  assert.match(service, /idempotency_key_input/);
  assert.doesNotMatch(service, /rpc\('submit_existing_customer_kiosk'/);
});
