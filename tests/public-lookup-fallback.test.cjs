const test=require('node:test');const assert=require('node:assert/strict');
test('ordinary lookup succeeds when public renewal secret is absent',async()=>{
  process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='service-test';delete process.env.PUBLIC_RENEWAL_TOKEN_SECRET;
  const originalFetch=global.fetch;let call=0;global.fetch=async()=>{call+=1;return{ok:true,json:async()=>call===1?[{id:7}]:[{id:11,facebook_name:'Kiosk A',start_date:'2026-01-01',end_date:'2026-12-31',status:'active',categories:{name:'Dịch vụ'},business_types:{name:'Loại A',price_per_month:100000}}]}};
  const handler=require('../api/public/kiosk-lookup');let status=200;let body;const req={method:'POST',body:{phone:'0888690346'}};const res={setHeader(){},status(value){status=value;return this},json(value){body=value;return value}};
  try{await handler(req,res)}finally{global.fetch=originalFetch}
  assert.equal(status,200);assert.equal(body.success,true);assert.equal(body.kiosks.length,1);assert.equal(body.kiosks[0].kiosk,'Kiosk A');assert.equal(body.kiosks[0].renewalAvailable,false);assert.equal(body.kiosks[0].renewalToken,null);
});
