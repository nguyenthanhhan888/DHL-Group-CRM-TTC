import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path,import.meta.url),'utf8');
export const promotionQaActor='00000000-0000-4000-8000-000000000901';
export async function createPromotionQaDatabase() {
  const db=new PGlite();
  await db.exec(await read('./crm-payment-baseline.sql'));
  await db.exec("set time zone 'UTC'");
  const engine=await read('../../supabase/migrations/20260824170000_create_discount_promotion_engine_v1.sql');
  await db.exec(engine.slice(engine.indexOf('create or replace function public.preview_registration_promotion('),engine.indexOf('create or replace function public.prepare_registration_batch_for_payos(')));
  await db.exec('alter table auth.users add column if not exists email text');
  for(const name of ['20260819000500_include_warning_days_in_public_settings','20260824203533_fix_promotion_save_ambiguous_columns','20260824204309_fix_promotion_rls_admin_authorization','20260828182110_create_unified_user_access_foundation','20260911074545_payment_lifecycle_revenue_business_logs','20260912100000_enforce_unified_crm_permissions'])await db.exec(await read(`../../supabase/migrations/${name}.sql`));
  // The schema-only fixture omits these existing production SELECT grants.
  await db.exec('grant select on public.categories,public.business_types to authenticated');
  await db.query('insert into auth.users(id) values($1)',[promotionQaActor]);
  await db.query("insert into public.user_roles(user_id,username,display_name,role,is_active) values($1,'promotion-qa','Quản trị kiểm thử','admin',true)",[promotionQaActor]);
  await db.query("insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin) values($1,'promotion-qa','Quản trị kiểm thử','active',true,true) on conflict(user_id) do update set web_access_enabled=true,status='active',is_system_admin=true",[promotionQaActor]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[promotionQaActor]);
  await db.exec("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  for(let n=1;n<=24;n++){
    await db.query('insert into public.categories(id,name,is_active) values($1,$2,$3)',[n,n===1?'Ẩm thực':`Danh mục ${n} · Dịch vụ và sản phẩm địa phương`,n!==24]);
    await db.query('insert into public.business_types(id,category_id,name,price_per_month,is_active) values($1,$1,$2,100000,$3)',[n,`Loại hình ${n} · Cửa hàng và dịch vụ phục vụ khách hàng`,n!==24]);
  }
  const rows=[
    {code:'TIMED20',name:'Ưu đãi đăng ký và gia hạn',discount_type:'percentage',discount_value:20,max_discount_amount:300000,minimum_order_amount:0,starts_at:'2020-01-01T03:12:45.123456+00:00',ends_at:'2099-12-31T16:59:42.654321+00:00',scope_type:'all'},
    {code:'UNLIMITED100',name:'Tri ân khách hàng không giới hạn',discount_type:'fixed_amount',discount_value:100000,starts_at:null,ends_at:null,scope_type:'all'},
    {code:'BONUS2',name:'Tặng thời gian sử dụng cho nhiều ngành nghề',discount_type:'bonus_months',discount_value:2,minimum_months:3,starts_at:'2020-01-01T00:00:00Z',ends_at:null,scope_type:'category'},
    {code:'PAUSED',name:'Chương trình đang tạm dừng',discount_type:'percentage',discount_value:10,starts_at:null,ends_at:'2099-12-31T16:59:00Z',scope_type:'business_type',is_active:false},
  ];
  for(const row of rows)await db.query('select public.admin_save_promotion(null,$1,$2,$3)',[row,row.scope_type==='category'?Array.from({length:24},(_,i)=>i+1):[],row.scope_type==='business_type'?[1,24]:[]]);
  await db.exec('begin; set role authenticated');
  return db;
}
