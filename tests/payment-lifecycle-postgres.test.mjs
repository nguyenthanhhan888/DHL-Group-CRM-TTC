import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin = '00000000-0000-4000-8000-000000000001';
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const rpc = (name, values = []) => scalar(`select public.${name}(${values.map((_, i) => `$${i+1}`).join(',')})`, values);
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./fixtures/crm-payment-baseline.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260911074545_payment_lifecycle_revenue_business_logs.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
  await db.query("insert into auth.users(id) values($1)", [admin]);
  await db.query("insert into public.user_roles(user_id,username,display_name,role,is_active) values($1,'qa-admin','QA admin','admin',true)", [admin]);
  await db.exec("insert into public.categories(id,name,is_active) values(1,'QA category',true); insert into public.business_types(id,category_id,name,price_per_month,is_active) values(1,1,'QA service',100000,true); insert into public.settings(key,value) values('warning_days','30');");
});
afterEach(async () => { await db.exec('rollback'); });
async function asAdmin() { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]); }
async function register(count = 1, code = null) {
  const data = await rpc('submit_public_registration', [{ facebook_name: 'QA customer', phone: '0900000000' },
    Array.from({length:count}, (_,i) => ({facebook_name:`QA kiosk ${i}`,facebook_id:`999990000${i}`,facebook_link:`https://www.facebook.com/999990000${i}`,business_type_id:1,months:1,discount:0})),null]);
  return rpc('prepare_registration_checkout_v3', [data.kiosks.map(x=>x.request.id), '0900000000', code]);
}
async function order(payment, code, expired = false) {
  const expires = Math.floor(Date.now()/1000)+(expired?-3600:3600);
  const name=payment.registration_batch_id?'record_registration_payos_order':'record_public_renewal_payos_order';
  return rpc(name, [payment.id,code,Number(payment.total_amount),'QA',`https://pay.payos.vn/qa-${code}`,null,`link-${code}`,{expiresAt:expires}]);
}
async function paid(o, reference = `bank-${o.order_code}`) {
  return rpc('handle_payos_webhook', [o.order_code,Number(o.amount),o.payment_link_id,reference,
    {data:{orderCode:o.order_code,amount:Number(o.amount),paymentLinkId:o.payment_link_id,reference}},'verified-by-api',null]);
}
async function existingKiosk() {
  const c = await scalar("insert into public.customers(facebook_name,phone,status) values('QA established','0900000001','active') returning id");
  return scalar("insert into public.kiosks(customer_id,facebook_name,business_type_id,category_id,start_date,end_date,status) values($1,'QA established kiosk',1,1,'2026-01-01',current_date+10,'active') returning id", [c]);
}
async function renewal(kioskId, code = null, nonce='qa-nonce') {
  await rpc('register_public_renewal_authorization',[kioskId,nonce,new Date(Date.now()+600000).toISOString()]);
  return rpc('prepare_public_kiosk_renewal',[kioskId,3,nonce,code]);
}

test('unpaid registration is retained but absent from business Kiosk list and dashboard', async () => {
  await register(2);
  assert.equal(await scalar('select count(*) from public.kiosks'),2);
  assert.equal(await scalar('select count(*) from public.registered_kiosks'),0);
  assert.equal(await scalar("select count(*) from public.kiosk_lifecycle where registration_state='unpaid'"),2);
  await asAdmin();
  const dashboard=await rpc('get_dashboard_data',[2026,9]);
  assert.equal(dashboard.summary.totalKiosks,0);
  assert.equal((await rpc('get_kiosk_status_data')).totalRows,0);
});
test('cancelled registration is absent even though compatibility kiosk remains inactive', async () => {
  const batch=await register(); await asAdmin();
  await rpc('admin_cancel_awaiting_registration',[batch.items[0].requestId,'QA cancellation']);
  assert.equal(await scalar('select count(*) from public.registered_kiosks'),0);
  assert.equal(await scalar('select registration_state from public.kiosk_lifecycle'),'cancelled');
});
test('expired QR regeneration preserves request, Customer, Kiosks and business payment', async () => {
  const batch=await register(2);const old=await order(batch.payment,10001,true);
  const again=await rpc('prepare_registration_checkout_v3',[batch.items.map(x=>x.requestId),'0900000000',null]);
  const fresh=await order(again.payment,10002);
  assert.equal(again.payment.id,batch.payment.id);
  assert.equal(await scalar('select count(*) from public.customers'),1);
  assert.equal(await scalar('select count(*) from public.kiosks'),2);
  assert.equal(await scalar('select count(*) from public.payments'),1);
  assert.equal(await scalar('select status from public.payos_orders where id=$1',[old.id]),'expired');
  assert.equal(await scalar('select superseded_by_order_id from public.payos_orders where id=$1',[old.id]),fresh.id);
});
test('duplicate webhook activates a batch and recognizes its money only once', async () => {
  const batch=await register(2);const o=await order(batch.payment,11001);
  const first=await paid(o);assert.equal(first.reconciliation_required,undefined);
  assert.equal(first.already_processed,false);
  assert.equal((await paid(o)).already_processed,true);
  assert.equal(await scalar('select count(*) from public.registered_kiosks'),2);
  assert.equal(Number(await scalar("select sum(total_amount) from public.payments where payment_status='completed'")),200000);
  assert.equal(await scalar("select count(*) from public.audit_logs where action='confirm_payos_batch'"),1);
});
test('old expired QR can complete intent; money on new QR is retained without a second activation', async () => {
  const batch=await register();const old=await order(batch.payment,12001,true);const fresh=await order(batch.payment,12002);
  assert.equal((await paid(old)).already_processed,false);
  assert.equal(await scalar('select count(*) from public.registered_kiosks'),1);
  assert.equal((await paid(fresh)).reconciliation_required,true);
  assert.equal(Number(await scalar("select sum(total_amount) from public.payments where payment_status='completed'")),100000);
  assert.equal(await scalar("select count(*) from public.payos_webhook_events where status='failed'"),1);
  assert.equal((await paid(old)).already_processed,true);
});
test('wrong paymentLinkId fails safe and retains signed evidence', async () => {
  const batch=await register();const o=await order(batch.payment,13001);
  const result=await paid({...o,payment_link_id:'wrong-link'});
  assert.equal(result.reconciliation_required,true);
  assert.equal(await scalar("select reconciliation_reason from public.payos_orders"),'PAYMENT_LINK_MISMATCH');
  assert.equal(await scalar("select payment_status from public.payments"),'pending');
});
test('unpaid renewal and same-token retry keep expiry and one pending transaction', async () => {
  const id=await existingKiosk(); const old=await scalar('select end_date::text from public.kiosks where id=$1',[id]);
  const first=await renewal(id);
  const retry=await rpc('prepare_public_kiosk_renewal',[id,3,'qa-nonce',null]);
  assert.equal(first.payment.id,retry.payment.id);
  assert.equal(await scalar('select end_date::text from public.kiosks where id=$1',[id]),old);
  assert.equal(await scalar("select count(*) from public.payments where payment_status='completed'"),0);
});
test('paid renewal extends expiry once and editing an older paid note cannot replay its period', async () => {
  const id=await existingKiosk();const expected=await scalar("select ((end_date+1)+interval '3 months'-interval '1 day')::date::text from public.kiosks where id=$1",[id]);
  const {payment}=await renewal(id);const o=await order(payment,14001);assert.equal((await paid(o)).already_processed,false);
  await db.exec('set constraints all immediate');
  assert.equal(await scalar('select end_date::text from public.kiosks where id=$1',[id]),expected);
  await paid(o);
  assert.equal(await scalar('select end_date::text from public.kiosks where id=$1',[id]),expected);
  assert.equal(Number(await scalar('select total_paid from public.customers')),300000);
});
test('renewal uses the existing coupon engine and records usage exactly once', async () => {
  await db.exec("insert into public.promotions(code,name,discount_type,discount_value,scope_type) values('QA10','QA discount','percentage',10,'all')");
  const id=await existingKiosk();const {payment}=await renewal(id,'QA10');
  assert.equal(Number(payment.total_amount),270000);assert.equal(Number(payment.discount),30000);
  const o=await order(payment,15001);const result=await paid(o);assert.equal(result.reconciliation_required,undefined);
  await paid(o);
  assert.equal(await scalar('select count(*) from public.promotion_usages'),1);
});
test('bonus-month renewal extends service months without inflating money', async () => {
  await db.exec("insert into public.promotions(code,name,discount_type,discount_value,scope_type) values('QABONUS','QA bonus','bonus_months',1,'all')");
  const id=await existingKiosk();const expected=await scalar("select ((end_date+1)+interval '4 months'-interval '1 day')::date::text from public.kiosks where id=$1",[id]);
  const {payment}=await renewal(id,'QABONUS');assert.equal(payment.bonus_months,1);assert.equal(Number(payment.total_amount),300000);
  await paid(await order(payment,16001));await db.exec('set constraints all immediate');
  assert.equal(await scalar('select end_date::text from public.kiosks where id=$1',[id]),expected);
});
test('Vietnam month boundary: dashboard, report rows, summary and monthly chart agree', async () => {
  const id=await existingKiosk();const customer=await scalar('select customer_id from public.kiosks where id=$1',[id]);
  for(const [created,confirmed,amount] of [
    ['2026-08-31T16:59:59Z','2026-08-31T16:59:59Z',100000],
    ['2026-08-31T17:00:00Z','2026-08-31T17:00:00Z',200000],
    ['2026-08-31T18:09:01Z','2026-08-31T18:09:57Z',600000],
    ['2026-09-01T00:00:00Z','2026-08-15T00:00:00Z',300000],
    ['2026-09-30T17:00:00Z','2026-09-30T17:00:00Z',400000],
  ]) {
    const p=await scalar('insert into public.payments(customer_id,kiosk_id,months,price_per_month,total_amount,created_at) values($1,$2,1,$3,$3,$4) returning id',[customer,id,amount,created]);
    await db.exec("select set_config('app.payment_workflow_action','confirm',true)");
    await db.query("update public.payments set payment_status='completed',confirmed_at=$2 where id=$1",[p,confirmed]);
  }
  await asAdmin();
  for(const tz of ['UTC','Europe/Berlin','America/New_York','Asia/Ho_Chi_Minh']) {
    await db.query("select set_config('TimeZone',$1,true)",[tz]);
    const d=await rpc('get_dashboard_data',[2026,9]);
    const r=await rpc('get_reports_data',['revenue','2026-09-01','2026-09-30']);
    const sum=Number(await scalar("select sum(total_amount) from public.payment_business_dates where revenue_date>='2026-09-01' and revenue_date<'2026-10-01'"));
    assert.equal(sum,800000);assert.equal(d.summary.revenueThisMonth,sum);
    assert.equal(d.charts.monthlyRevenue[8].total,sum);assert.equal(r.summary.totalRevenue,sum);
    assert.equal(r.rows.reduce((v,x)=>v+Number(x.totalAmount),0),sum);
    const ps=await rpc('get_payment_summary',[null,'completed',null,null,'2026-09-01','2026-09-30']);
    assert.equal(ps.totalRevenue,sum);
  }
});
test('one registration produces one default business event; technical audit remains available', async () => {
  await register(2);await asAdmin();
  const business=await rpc('get_audit_logs');
  assert.equal(business.rows.length,1);assert.equal(business.rows[0].action,'registration_pending');
  const technical=await rpc('get_audit_logs',[null,null,null,null,null,null,true,1,50]);
  assert.ok(technical.total>business.total);
  assert.ok(technical.rows.some(x=>x.legacy_log_id));
  const activity=await rpc('get_audit_logs',[null,null,'business:registration',null,null,null,false,1,10]);
  assert.equal(activity.total,1);
});

test('new QR wins, then old expired QR money is retained for review only', async () => {
  const batch = await register(); const old = await order(batch.payment, 18001, true); const fresh = await order(batch.payment, 18002);
  await paid(fresh);
  assert.equal((await paid(old)).reconciliation_required, true);
  assert.equal(await scalar("select count(*) from public.audit_logs where action='confirm_payos_batch'"), 1);
  assert.equal(await scalar("select count(*) from public.payos_webhook_events"), 2);
  assert.equal(Number(await scalar('select total_paid from public.customers')), 100000);
});

test('expired renewal wins once; new QR and extra bank reference cannot extend or count twice', async () => {
  const id = await existingKiosk(); const { payment } = await renewal(id);
  const old = await order(payment, 19001, true); const fresh = await order(payment, 19002);
  await paid(old); await db.exec('set constraints all immediate');
  const expiry = await scalar('select end_date::text from public.kiosks where id=$1', [id]);
  assert.equal((await paid(fresh)).reconciliation_required, true);
  assert.equal((await paid(old, 'second-bank-transfer')).reconciliation_required, true);
  assert.equal(await scalar('select end_date::text from public.kiosks where id=$1', [id]), expiry);
  assert.equal(Number(await scalar('select total_paid from public.customers')), 300000);
  assert.equal(await scalar('select count(*) from public.payos_webhook_events'), 3);
  assert.equal(await scalar("select count(*) from public.audit_logs where action='renewal_paid'"), 1);
});

test('manual coupon renewal uses the same evaluator and usage ledger', async () => {
  await db.exec("insert into public.promotions(code,name,discount_type,discount_value,scope_type) values('QAFIXED','QA fixed','fixed_amount',50000,'all')");
  const id = await existingKiosk(); await asAdmin();
  const preview = await rpc('preview_renewal_promotion', [id, 3, 'QAFIXED']);
  assert.equal(Number(preview.finalAmount), 250000);
  const result = await rpc('admin_manual_renew_kiosk', [id, 3, '2026-09-11', 300000, 0, null, 'cash', 'QA manual coupon', 'QAFIXED']);
  assert.equal(result.payment.payment_status, 'completed');
  assert.equal(Number(result.payment.total_amount), 250000);
  assert.equal(result.payment.payment_method, 'cash');
  assert.equal(await scalar('select count(*) from public.promotion_usages'), 1);
});

test('checkout status sync never completes service and preserves late-payable mapping', async () => {
  const batch = await register(); const o = await order(batch.payment, 20001, true);
  await rpc('sync_payos_order_status', [o.order_code, { orderCode: o.order_code, amount: Number(o.amount), id: o.payment_link_id, status: 'EXPIRED', amountPaid: 0 }]);
  assert.equal(await scalar('select payment_status from public.payments'), 'pending');
  assert.equal(await scalar('select count(*) from public.registered_kiosks'), 0);
  assert.equal((await paid(o)).already_processed, false);
  assert.equal(await scalar('select count(*) from public.registered_kiosks'), 1);
});
