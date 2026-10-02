// Isolated PostgreSQL engine. Auth shims identify synthetic test users only.
// The authorization functions, policies and grants below are the audited production definitions.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const ident = value => `"${String(value).replaceAll('"','""')}"`;
export const qaUsers = Object.freeze({
  admin: '00000000-0000-4000-8000-000000001001',
  zero: '00000000-0000-4000-8000-000000001002',
  selective: '00000000-0000-4000-8000-000000001003',
  disabled: '00000000-0000-4000-8000-000000001004',
  legacy: '00000000-0000-4000-8000-000000001005',
});
export async function createPermissionQaDatabase({ applyFix = true, applyFinalFix = true } = {}) {
  const db = new PGlite();
  await db.exec(await read('./crm-payment-baseline.sql'));
  await db.exec("alter table auth.users add column if not exists email text; set time zone 'UTC'");
  const files = (await readdir(new URL('../../supabase/migrations/', import.meta.url))).filter(x=>x.endsWith('.sql')).sort();
  await db.exec(await read('../../supabase/migrations/20260828182110_create_unified_user_access_foundation.sql'));
  for (const name of files.filter(x=>x>='20260911074545' && x<='20260921221551_independent_employees_expense_attribution.sql')) {
    await db.exec(await read(`../../supabase/migrations/${name}`));
  }
  const audit = JSON.parse(await read('../../docs/qa/user-permissions-v1/production-authorization-audit.json'))[0].audit;
  // The older baseline lacks some functions; load the real definitions, never mock a guard.
  await db.exec('set check_function_bodies=off');
  const functions = audit.functions.filter(f=>!f.definition.includes('LANGUAGE c\n'));
  for (const f of functions) await db.exec(f.definition);
  await db.exec('set check_function_bodies=on');
  for (const table of audit.tables) {
    const name=`public.${ident(table.name)}`;
    await db.exec(`revoke all on ${name} from public,anon,authenticated; grant all on ${name} to service_role`);
    if (table.kind==='r') {
      await db.exec(`alter table ${name} ${table.rls?'enable':'disable'} row level security`);
      const policies = await db.query('select policyname from pg_policies where schemaname=$1 and tablename=$2',['public',table.name]);
      for (const p of policies.rows) await db.exec(`drop policy ${ident(p.policyname)} on ${name}`);
    }
    for (const role of ['anon','authenticated']) {
      const privileges=Object.keys(table[role]).filter(k=>table[role][k]);
      if(privileges.length) await db.exec(`grant ${privileges.join(',')} on ${name} to ${role}`);
    }
  }
  for (const p of audit.policies.filter(x=>x.schemaname==='public')) {
    await db.exec(`create policy ${ident(p.policyname)} on public.${ident(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(ident).join(',')} ${p.qual?`using (${p.qual})`:''} ${p.with_check?`with check (${p.with_check})`:''}`);
  }
  for (const f of functions) {
    const signature=`${ident(f.schema)}.${ident(f.name)}(${f.args})`;
    await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role`);
    const roles=['anon','authenticated','service_role'].filter(role=>f[role]);
    if(roles.length) await db.exec(`grant execute on function ${signature} to ${roles.join(',')}`);
  }
  await db.exec('grant usage on schema public,auth to anon,authenticated,service_role; grant usage on schema private to authenticated,service_role; grant usage,select on all sequences in schema public to authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role');
  for(const [persona,id] of Object.entries(qaUsers)) {
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${persona}@qa.invalid`]);
    await db.query("insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin) values($1,$2,$3,$4,$5,$6)",[id,`qa_${persona}`,`TEST ${persona}`,persona==='disabled'?'locked':'active',persona!=='disabled',persona==='admin']);
  }
  // A leftover legacy admin must not override revoked canonical access.
  await db.query("insert into public.user_roles(user_id,username,display_name,role,is_active) values($1,'qa_legacy','TEST legacy','admin',true)",[qaUsers.legacy]);
  await db.exec("insert into public.categories(id,name) values(1,'Danh mục TEST'); insert into public.business_types(id,category_id,name,price_per_month) values(1,1,'Dịch vụ TEST',100000); insert into public.customers(id,facebook_name,phone,status) values(1,'Khách hàng TEST','0900000001','active'); insert into public.kiosks(id,customer_id,facebook_name,facebook_id,business_type_id,category_id,start_date,end_date,status) values(1,1,'Kiosk TEST','9999990001',1,1,'2020-01-01','2099-12-31','active')");
  if(applyFix) for(const name of files.filter(x=>x.endsWith('_finalize_user_permission_boundaries.sql'))) await db.exec(await read(`../../supabase/migrations/${name}`));
  if(applyFix && applyFinalFix) for(const name of files.filter(x=>x.endsWith('_finalize_crm_registration_checkout.sql'))) await db.exec(await read(`../../supabase/migrations/${name}`));
  return db;
}

// Each call uses a real SQL role and an unchanged user ID (stale JWT scenarios).
export async function asQaUser(db, user, sql, values = [], { role = user ? 'authenticated' : 'anon' } = {}) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[qaUsers[user]||user||'',JSON.stringify({role,sub:qaUsers[user]||user||null})]);
    await db.exec(`set local role ${ident(role)}`);
    const result=await db.query(sql,values);
    await db.exec('commit'); return result;
  } catch(error) { await db.exec('rollback'); throw error; }
}
