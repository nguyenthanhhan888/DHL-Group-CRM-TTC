import { requireSupabaseClient, runQuery } from './BaseService.js';

export const PromotionService = {
  list() { return runQuery(requireSupabaseClient().from('promotions').select('*,promotion_categories(category_id,categories(id,name,is_active)),promotion_business_types(business_type_id,business_types(id,name,is_active,category_id)),promotion_usages(id,customer_id,subtotal_before_discount,discount_amount,final_amount,total_bonus_months)').order('created_at',{ascending:false})); },
  save(payload, categoryIds = [], businessTypeIds = [], id = null) { return runQuery(requireSupabaseClient().rpc('admin_save_promotion',{promotion_id_input:id,promotion_input:normalize(payload),category_ids_input:categoryIds.map(Number),business_type_ids_input:businessTypeIds.map(Number)})); },
  setActive(id,isActive) { return runQuery(requireSupabaseClient().from('promotions').update({is_active:isActive}).eq('id',id).select().single()); },
  deleteUnused(id) { return runQuery(requireSupabaseClient().rpc('admin_delete_unused_promotion',{promotion_id_input:id})); },
};

function normalize(value={}) {
  const nullableNumber=(key)=>value[key]===''||value[key]==null?null:Number(value[key]);
  return { code:String(value.code||'').trim().toUpperCase(),name:String(value.name||'').trim(),description:String(value.description||'').trim()||null,discount_type:value.discount_type,discount_value:Number(value.discount_value),max_discount_amount:value.discount_type==='percentage'?nullableNumber('max_discount_amount'):null,minimum_order_amount:nullableNumber('minimum_order_amount'),minimum_kiosk_count:nullableNumber('minimum_kiosk_count'),minimum_months:nullableNumber('minimum_months'),starts_at:toVietnamInstant(value.starts_at),ends_at:toVietnamInstant(value.ends_at),usage_limit_total:nullableNumber('usage_limit_total'),usage_limit_per_customer:nullableNumber('usage_limit_per_customer'),scope_type:value.scope_type||'all',is_active:value.is_active!==false};
}
function toVietnamInstant(value){return value?new Date(`${value}:00+07:00`).toISOString():null;}
