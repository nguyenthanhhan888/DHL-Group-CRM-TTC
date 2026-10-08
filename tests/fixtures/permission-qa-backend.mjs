// Local transport fixture only: application API handlers and PostgreSQL guards are real.
// Auth provider emulation issues synthetic sessions; never accepts or contacts Production.
import { createPermissionQaDatabase, asQaUser, qaUsers } from './permission-qa-database.mjs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const handlers={
  '/api/facebook-id':require('../../api/facebook-id.js'),
  '/api/payos/create-registration-payment':require('../../api/payos/create-registration-payment.js'),
  '/api/public/kiosk-lookup':require('../../api/public/kiosk-lookup.js'),
  '/api/public/renew-kiosk':require('../../api/public/renew-kiosk.js'),
  '/api/payos/status':require('../../api/payos/status.js'),
  '/api/payos/webhook':require('../../api/payos/webhook.js'),
  '/api/auth-account':require('../../api/auth-account.js'),
  '/api/user-management':require('../../api/user-management.js'),
  '/api/payos/create-payment':require('../../api/payos/create-payment.js'),
};
const identifier=value=>{if(!/^[a-z_][a-z_0-9]*$/i.test(value))throw Error(`Invalid SQL identifier: ${value}`);return `"${value}"`;};
const split=value=>{let depth=0,start=0,parts=[];for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&!depth){parts.push(value.slice(start,i));start=i+1;}}parts.push(value.slice(start));return parts.filter(Boolean);};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
export const QA_PASSWORD='Local-QA-Only-2026!';

export async function createPermissionQaBackend({providerFetch=null,facebookFetch=null}={}){
  const db=await createPermissionQaDatabase(),users=new Map(),tokens=new Map(),refreshes=new Map(),calls=[];
  const qaIp='qa-'+randomUUID();
  let queue=Promise.resolve(),baseUrl='http://permission-qa.invalid',originalFetch;
  const enqueue=work=>{const result=queue.then(work);queue=result.catch(()=>{});return result;};
  for(const [name,id] of Object.entries(qaUsers))users.set(id,{id,aud:'authenticated',role:'authenticated',email:`${name}@qa.invalid`,password:QA_PASSWORD,banned:name==='disabled',app_metadata:{},user_metadata:{},created_at:'2026-09-01T00:00:00Z'});
  const publicUser=user=>{const {password,banned,...safe}=user;return safe;};
  function sessionFor(id){
    const user=users.get(qaUsers[id]||id);if(!user)throw Error('Unknown QA user');
    const exp=Math.floor(Date.now()/1000)+3600,nonce=randomUUID();
    const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,role:'authenticated',aud:'authenticated',aal:'aal1',exp,jti:nonce}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.qa-signature';
    tokens.set(token,user.id);refreshes.set(nonce,user.id);
    return {access_token:token,refresh_token:nonce,token_type:'bearer',expires_in:3600,expires_at:exp,user:publicUser(user)};
  }
  async function auth(path,method,body,token,service){
    if(path.startsWith('/auth/v1/admin/')&&!service)return json({message:'Service role required'},403);
    if(path==='/auth/v1/admin/users'&&method==='POST'){
      if([...users.values()].some(x=>x.email===body.email))return json({message:'Email already exists',code:'email_exists'},422);
      const user={id:randomUUID(),aud:'authenticated',role:'authenticated',email:body.email,password:body.password,banned:false,app_metadata:body.app_metadata||{},user_metadata:body.user_metadata||{},created_at:new Date().toISOString()};
      await enqueue(()=>db.query('insert into auth.users(id,email) values($1,$2)',[user.id,user.email]));users.set(user.id,user);return json(publicUser(user));
    }
    if(path.startsWith('/auth/v1/admin/users/')){
      const id=path.split('/').at(-1),user=users.get(id);if(!user)return json({message:'Unknown user'},404);
      if(method==='PUT'){if(body.password)user.password=body.password;if(body.ban_duration)user.banned=body.ban_duration!=='none';}
      if(method==='DELETE'){await enqueue(()=>db.query('delete from auth.users where id=$1',[id]));users.delete(id);}
      return json(publicUser(user));
    }
    if(path==='/auth/v1/token'){
      const user=body.refresh_token?users.get(refreshes.get(body.refresh_token)):[...users.values()].find(x=>x.email===body.email&&x.password===body.password);
      if(!user||user.banned)return json({message:'Invalid login credentials'},400);
      user.last_sign_in_at=new Date().toISOString();return json(sessionFor(user.id));
    }
    if(path==='/auth/v1/logout'){tokens.delete(token);return json({});}
    if(path==='/auth/v1/user'){const user=users.get(tokens.get(token));return user?json(publicUser(user)):json({message:'Invalid session'},401);}
    return json({message:`Unknown QA Auth endpoint ${path}`},404);
  }
  function projection(select,table,alias='t'){
    return split(select||'*').map(raw=>{
      const part=raw.trim();
      if(part==='*')return `${alias}.*`;
      const relation=part.match(/^(\w+)(?:!\w+)?\((.*)\)$/);
      if(relation){
        const [,target,fields]=relation,child=`r_${target}`;
        const many={user_profiles:{wallets:'user_id',user_facebook_accounts:'user_id'},promotions:{promotion_categories:'promotion_id',promotion_business_types:'promotion_id',promotion_usages:'promotion_id'}};
        const foreign=many[table]?.[target];
        if(foreign){const key=table==='user_profiles'?'user_id':'id';return `(select coalesce(jsonb_agg(to_jsonb(n)),'[]') from (select ${projection(fields,target,child)} from public.${identifier(target)} ${child} where ${child}.${identifier(foreign)}=${alias}.${identifier(key)}) n) as ${identifier(target)}`;}
        const fk={customers:'customer_id',kiosks:'kiosk_id',categories:'category_id',business_types:'business_type_id'}[target];
        if(!fk)throw Error(`Unsupported QA relationship ${table}.${target}`);
        return `(select to_jsonb(n) from (select ${projection(fields,target,child)} from public.${identifier(target)} ${child} where ${child}.id=${alias}.${identifier(fk)}) n) as ${identifier(target)}`;
      }
      return `${alias}.${identifier(part)}`;
    }).join(',');
  }
  async function rest(url,method,body,token,service,headers){
    const user=tokens.get(token)||null,role=service?'service_role':user?'authenticated':'anon';
    const run=(sql,values=[])=>asQaUser(db,user,sql,values,{role});
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const name=url.pathname.split('/').at(-1),args=method==='GET'?Object.fromEntries(url.searchParams):body||{},keys=Object.keys(args);
      const metadata=(await db.query('select proretset from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',['public',name])).rows;
      const query=`public.${identifier(name)}(${keys.map((key,i)=>`${identifier(key)}=>$${i+1}`).join(',')})`;
      const result=await run(metadata[0]?.proretset?`select * from ${query}`:`select ${query} as data`,keys.map(k=>args[k]));
      return json(metadata[0]?.proretset?result.rows:result.rows[0]?.data);
    }
    const table=url.pathname.split('/').at(-1),params=url.searchParams,values=[],bind=value=>{values.push(value);return `$${values.length}`;};
    const conditions=[];
    for(const [key,value] of params){
      if(['select','order','offset','limit','on_conflict','columns'].includes(key))continue;
      if(key==='or'){
        const alternatives=value.slice(1,-1).split(',').map(item=>{const [field,op,...parts]=item.split('.'),val=parts.join('.'),column=`t.${identifier(field)}`;if(op==='is'&&val==='null')return `${column} is null`;if(op==='eq')return `${column}=${bind(val)}`;if(op==='neq')return `${column}<>${bind(val)}`;if(op!=='ilike')throw Error('Unsupported QA OR');return `${column} ilike ${bind(val.replaceAll('*','%'))}`;});
        conditions.push(`(${alternatives.join(' or ')})`);continue;
      }
      const dot=value.indexOf('.'),op=value.slice(0,dot),val=value.slice(dot+1),column=`t.${identifier(key)}`;
      if(op==='in')conditions.push(`${column} in (${val.slice(1,-1).split(',').map(bind).join(',')})`);
      else if(op==='is'&&['null','true','false'].includes(val))conditions.push(`${column} is ${val}`);
      else if(op==='not'&&val==='is.null')conditions.push(`${column} is not null`);
      else if(op==='not'&&val.startsWith('eq.'))conditions.push(`${column}<>${bind(val.slice(3))}`);
      else {const operators={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',ilike:'ilike'};if(!operators[op])throw Error(`Unsupported QA filter ${op}`);conditions.push(`${column} ${operators[op]} ${bind(op==='ilike'?val.replaceAll('*','%'):val)}`);}
    }
    const where=conditions.length?` where ${conditions.join(' and ')}`:'',name=`public.${identifier(table)}`;
    let result,total;
    if(method==='GET'||method==='HEAD'){
      total=Number((await run(`select count(*) as n from ${name} t${where}`,values)).rows[0].n);
      const order=params.get('order')?` order by ${params.get('order').split(',').map(item=>{const [key,dir]=item.split('.');return `t.${identifier(key)} ${dir==='desc'?'desc':'asc'}`;}).join(',')}`:'';
      const range=` limit ${Math.min(1000,Math.max(1,Number(params.get('limit')||1000)))} offset ${Math.max(0,Number(params.get('offset')||0))}`;
      result=await run(`select ${projection(params.get('select'),table)} from ${name} t${where}${order}${range}`,values);
    }else if(method==='DELETE')result=await run(`delete from ${name} t${where} returning *`,values);
    else if(method==='PATCH'){
      const sets=Object.entries(body).map(([key,value])=>`${identifier(key)}=${bind(value)}`);
      result=await run(`update ${name} t set ${sets.join(',')}${where} returning *`,values);
    }else if(method==='POST'){
      const rows=Array.isArray(body)?body:[body],keys=Object.keys(rows[0]),entries=rows.map(row=>`(${keys.map(k=>bind(row[k])).join(',')})`);
      result=await run(`insert into ${name}(${keys.map(identifier).join(',')}) values ${entries.join(',')} returning *`,values);
    }else throw Error('Unsupported QA REST method');
    let data=result.rows;
    // PostgREST emits SQL DATE as YYYY-MM-DD; PGlite's default parser returns Date.
    for(const field of result.fields.filter(field=>field.dataTypeID===1082)) for(const row of data) {
      if(row[field.name] instanceof Date) row[field.name]=row[field.name].toISOString().slice(0,10);
    }
    if(headers.get('accept')?.includes('vnd.pgrst.object')){if(data.length!==1)return json({message:'Expected one row',code:'PGRST116'},406);data=data[0];}
    return json(data,200,{'Content-Range':`0-${Math.max(0,result.rows.length-1)}/${total??result.rows.length}`});
  }
  async function fetchFixture(input,init={}){
    const url=new URL(typeof input==='string'?input:input.url),method=init.method||'GET',headers=new Headers(init.headers||{}),token=(headers.get('authorization')||'').replace(/^Bearer /i,'');
    if(url.origin==='https://id.traodoisub.com' && facebookFetch) return facebookFetch(url,init);
    const body=init.body?JSON.parse(init.body):{};
    if(url.origin==='https://api-merchant.payos.vn' && providerFetch) return providerFetch(url,init);
    if(url.origin!==new URL(baseUrl).origin)throw Error(`QA prevents external requests: ${url.origin}`);
    const service=token==='qa-service-only';calls.push({path:url.pathname,method,actor:tokens.get(token)|| (service?'service_role':'anon'),body});
    try{
      if(url.pathname.startsWith('/auth/v1/'))return await auth(url.pathname,method,body,token,service);
      if(url.pathname.startsWith('/rest/v1/'))return await enqueue(()=>rest(url,method,body,token,service,headers));
      throw Error(`Unknown QA path ${url.pathname}`);
    }catch(error){return json({message:error.message,code:error.code,hint:error.hint,details:error.detail},error.code==='42501'?(token?403:401):400);}
  }
  function install(url=baseUrl){baseUrl=url;process.env.SUPABASE_URL=url;process.env.SUPABASE_ANON_KEY='qa-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='qa-service-only';originalFetch=globalThis.fetch;globalThis.fetch=fetchFixture;}
  async function invoke(path,body,token='',query={},method='POST'){
    const req={method,headers:{authorization:token?`Bearer ${token}`:'','x-forwarded-for':qaIp},body,query,socket:{remoteAddress:'qa-local'}};
    let status=200,data;const responseHeaders={};
    const res={setHeader:(k,v)=>{responseHeaders[k]=v;},status(code){status=code;return this;},json(value){data=value;return this;}};
    await handlers[path](req,res);return {status,data,headers:responseHeaders};
  }
  return {db,users,calls,tokens,sessionFor,fetch:fetchFixture,install,invoke,enqueue,async close(){if(originalFetch)globalThis.fetch=originalFetch;await queue;await db.close();}};
}
