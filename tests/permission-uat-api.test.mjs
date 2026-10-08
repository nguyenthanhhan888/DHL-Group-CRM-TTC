import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createPermissionQaBackend,QA_PASSWORD} from './fixtures/permission-qa-backend.mjs';
import {qaUsers,asQaUser} from './fixtures/permission-qa-database.mjs';
import authGuards from '../api/_auth.js';
import {ALL_PERMISSIONS} from '../src/constants/permissions.js';
let qa,admin,selective,zero;
before(async()=>{qa=await createPermissionQaBackend();qa.install();admin=qa.sessionFor('admin').access_token;selective=qa.sessionFor('selective').access_token;zero=qa.sessionFor('zero').access_token;});
after(async()=>qa?.close());
const call=(body,token=admin)=>qa.invoke('/api/user-management',body,token);
const auth=body=>qa.invoke('/api/auth-account',body);
const counts=async()=> (await qa.db.query('select (select count(*) from customers) customers,(select count(*) from kiosks) kiosks,(select count(*) from employees) employees,(select count(*) from payments) payments')).rows[0];
const sync=permissions=>call({action:'sync_permissions',userId:qaUsers.selective,permissions,adminPassword:QA_PASSWORD});
test('real signup/login API creates only Auth/profile/wallet; no CRM entities or permissions',async()=>{
  const before=await counts();
  assert.equal((await auth({action:'create_user_account',username:'qa_signup',password:QA_PASSWORD})).status,200);
  const profile=(await qa.db.query("select * from user_profiles where username='qa_signup'")).rows[0];
  assert.equal(profile.is_system_admin,false);assert.equal(profile.web_access_enabled,true);assert.equal(profile.status,'active');
  assert.equal((await qa.db.query('select * from user_permissions where user_id=$1',[profile.user_id])).rows.length,0);
  assert.deepEqual(await counts(),before);
  const login=await auth({action:'username_login',username:'qa_signup',password:QA_PASSWORD});assert.equal(login.status,200);
  assert.equal((await call({action:'list'},login.data.session.accessToken)).status,403);
  assert.equal((await auth({action:'username_login',username:'qa_disabled',password:QA_PASSWORD})).status,401);
});
test('User API reads fail closed for anonymous/zero; grant and revoke take effect on unchanged JWT',async()=>{
  const before=await counts();
  assert.equal((await call({action:'list'},'')).status,401);
  assert.equal((await call({action:'list'},zero)).status,403);
  assert.equal((await call({action:'list'},selective)).status,403);
  assert.equal((await sync(['user-management'])).status,200);
  const list=await call({action:'list'},selective);assert.equal(list.status,200,JSON.stringify(list));assert.ok(list.data.users.length>=6);
  assert.equal((await call({action:'detail',userId:qaUsers.zero},selective)).status,200);
  assert.equal((await call({action:'update_profile',userId:qaUsers.zero,displayName:'TEST contact edit'},selective)).status,200);
  assert.equal((await call({action:'update_profile',userId:qaUsers.admin,displayName:'unauthorized'},selective)).status,403);
  assert.equal((await sync([])).status,200);
  assert.equal((await call({action:'list'},selective)).status,403);
  assert.equal((await call({action:'update_profile',userId:qaUsers.zero,displayName:'revoked'},selective)).status,403);
  assert.equal((await auth({action:'username_login',username:'qa_selective',password:QA_PASSWORD})).status,200);
  assert.deepEqual(await counts(),before);
});
test('all sensitive User Management actions require active System Admin and password reauthentication',async()=>{
  await sync(['user-management']);
  for(const action of ['sync_permissions','set_locked','reset_password']){
    const request={action,userId:qaUsers.zero,permissions:[],locked:true,newPassword:'Another-Test-Password',amount:10,idempotencyKey:`qa-${action}`,reason:'QA authorization',adminPassword:QA_PASSWORD};
    for(const actor of [zero,selective,qa.sessionFor('disabled').access_token])assert.equal((await call(request,actor)).status,403,`${action} ordinary/disabled denied`);
    assert.equal((await call({...request,adminPassword:'wrong'})).status,403,`${action} wrong admin password`);
    assert.equal((await call({...request,userId:qaUsers.admin})).status,403,`${action} protects admin`);
  }
  assert.equal((await call({action:'adjust_wallet',userId:qaUsers.zero,adminPassword:QA_PASSWORD})).status,400);
  assert.equal((await sync(['invented-key'])).status,400);
  assert.equal((await call({action:'list'})).status,200);
});
test('missing reason does not ban a user or reset password; valid lock blocks stale sessions and unlock restores grants',async()=>{
  await sync(['user-management']);
  for(const action of ['set_locked','reset_password']){
    assert.equal((await call({action,userId:qaUsers.selective,adminPassword:QA_PASSWORD,locked:true,newPassword:'Changed-Password-2026'})).status,400);
    assert.equal(qa.users.get(qaUsers.selective).banned,false);assert.equal(qa.users.get(qaUsers.selective).password,QA_PASSWORD);
  }
  assert.equal((await call({action:'set_locked',userId:qaUsers.selective,adminPassword:QA_PASSWORD,locked:true,reason:'QA lock'})).status,200);
  assert.equal((await call({action:'list'},selective)).status,403);
  await assert.rejects(asQaUser(qa.db,'selective','select get_dashboard_data()'),/quyền|access|permission/i);
  assert.equal((await auth({action:'username_login',username:'qa_selective',password:QA_PASSWORD})).status,401);
  assert.equal((await call({action:'set_locked',userId:qaUsers.selective,adminPassword:QA_PASSWORD,locked:false,reason:'QA unlock'})).status,200);
  assert.equal((await call({action:'list'},selective)).status,200);
  assert.equal((await call({action:'reset_password',userId:qaUsers.selective,adminPassword:QA_PASSWORD,newPassword:'Changed-Password-2026',reason:'QA reset'})).status,200);
  assert.equal((await auth({action:'username_login',username:'qa_selective',password:QA_PASSWORD})).status,401);
  assert.equal((await auth({action:'username_login',username:'qa_selective',password:'Changed-Password-2026'})).status,200);
});
test('disabled canonical admin loses API override on same JWT; reactivation restores it',async()=>{
  await qa.db.query("update user_profiles set status='locked',web_access_enabled=false where user_id=$1",[qaUsers.admin]);
  assert.equal((await call({action:'list'})).status,403);
  await qa.db.query("update user_profiles set status='active',web_access_enabled=true where user_id=$1",[qaUsers.admin]);
  assert.equal((await call({action:'list'})).status,200);
});

test('all 26 API permission guards read live canonical grants; zero/revoke/disabled deny without refreshing JWT',async()=>{
  const req={headers:{authorization:`Bearer ${selective}`}};
  for(const permission of ALL_PERMISSIONS){
    await sync([]);await assert.rejects(()=>authGuards.requirePermission(req,permission),e=>e.status===403);
    await sync([permission]);assert.equal((await authGuards.requirePermission(req,permission)).user.id,qaUsers.selective);
    const unrelated=ALL_PERMISSIONS.find(p=>p!==permission);await assert.rejects(()=>authGuards.requirePermission(req,unrelated),e=>e.status===403);
    await sync([]);await assert.rejects(()=>authGuards.requirePermission(req,permission),e=>e.status===403);
  }
});

test('PayOS service entrypoint rejects disabled wallet and zero-permission CRM callers before order/provider mutation',async()=>{
  for(const key of ['PAYOS_CLIENT_ID','PAYOS_API_KEY','PAYOS_CHECKSUM_KEY'])process.env[key]='local-qa-only';
  const before=(await qa.db.query('select count(*)::int n from payos_orders')).rows[0].n;
  const payload={amount:10000,orderCode:998877,description:'QA',returnUrl:'https://qa.invalid/return',cancelUrl:'https://qa.invalid/cancel'};
  const disabled=qa.sessionFor('disabled').access_token;
  assert.equal((await qa.invoke('/api/payos/create-payment',{...payload,purpose:'wallet_topup',walletUserId:qaUsers.disabled},disabled)).status,403);
  assert.equal((await qa.invoke('/api/payos/create-payment',{...payload,purpose:'crm_payment',paymentId:1},zero)).status,403);
  assert.equal((await qa.db.query('select count(*)::int n from payos_orders')).rows[0].n,before);
});
