import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createPermissionQaDatabase,asQaUser,qaUsers} from './fixtures/permission-qa-database.mjs';
const folder=new URL('../supabase/migrations/',import.meta.url);
const migration=readFileSync(new URL(readdirSync(folder).find(x=>x.endsWith('_remove_ttc_crm_surface.sql')),folder),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../docs/qa/stabilization-consolidation/removal-manifest.json',import.meta.url)));
let db,beforeData,beforeFunctions;
const crmTables=['customers','kiosks','payments','expenses','promotions','registration_requests','registration_batches','employees','wallets','wallet_ledger','user_facebook_accounts','user_profiles'];
const snapshot=async()=>Object.fromEntries(await Promise.all(crmTables.map(async name=>[name,(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from public.${name} t`)).rows[0].data])));
const stableFunctions=async()=>(await db.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and (p.proname like '%payos%' or p.proname like '%dashboard%' or p.proname in ('get_reports_data_filtered','write_ttc_audit','get_admin_notification_feed','get_registration_actionable_summary')) order by 1,2,3")).rows;
before(async()=>{db=await createPermissionQaDatabase({applyStabilization:false});beforeData=await snapshot();beforeFunctions=await stableFunctions();});
after(async()=>db?.close());
test('cleanup fails closed for an unaudited PL/pgSQL consumer and rolls back',async()=>{
 await db.exec("create function public.qa_unknown_consumer() returns bigint language plpgsql as $$begin return (select count(*) from public.ttc_tasks); end$$");
 await assert.rejects(()=>db.exec(migration),/retained function public.qa_unknown_consumer/);
 await db.exec('rollback');
 assert.ok((await db.query("select to_regclass('public.ttc_tasks') as value")).rows[0].value);
 await db.exec('drop function public.qa_unknown_consumer()');
});
test('cleanup fails closed for unreviewed scheduled TTC job',async()=>{
 await db.exec("create schema cron;create table cron.job(jobname text,command text);insert into cron.job values('test TTC worker','select public.enqueue_ttc_verify_job(1)')");
 await assert.rejects(()=>db.exec(migration),/scheduled job test TTC worker/);await db.exec('rollback');
 await db.exec('drop table cron.job;drop schema cron');
});
test('forward cleanup removes only catalogued TTC tables/RPCs/permissions',async()=>{
 await db.exec(migration);
 for(const name of manifest.tables)assert.equal((await db.query('select to_regclass($1) value',['public.'+name])).rows[0].value,null,name);
 for(const signature of manifest.functions){const [schema,name]=signature.split('(')[0].split('.');assert.equal((await db.query('select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname=$1 and p.proname=$2',[schema,name])).rows[0].n,0,name);}
 assert.equal((await db.query('select count(*)::int n from app_permissions where permission=any($1)',[manifest.permissions])).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from app_permissions where permission='notifications'")).rows[0].n,1);
 assert.deepEqual(await snapshot(),beforeData);
 assert.deepEqual(await stableFunctions(),beforeFunctions);
});
test('profile update and CRM reports work with TTC tables absent; profile no longer creates wallets',async()=>{
 const walletCount=(await db.query('select count(*)::int n from wallets')).rows[0].n;
 const profile=(await asQaUser(db,'zero',"select ensure_my_user_profile('TEST zero','0900000000',null,'{}'::jsonb,'qa_zero') as data")).rows[0].data;
 assert.equal(profile.profile.display_name,'TEST zero');assert.equal(profile.wallet,null);
 assert.equal((await db.query('select count(*)::int n from wallets')).rows[0].n,walletCount);
 const app=(await asQaUser(db,'zero','select get_current_app_profile() as data')).rows[0].data;assert.equal(app.wallet,null);
 await assert.doesNotReject(()=>asQaUser(db,'admin',"select get_reports_data_filtered(p_report_type=>'revenue',p_start_date=>'2026-01-01',p_end_date=>'2026-10-04')"));
 await assert.doesNotReject(()=>asQaUser(db,'admin','select get_dashboard_data()'));
});
