import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALL_PERMISSIONS,ROUTE_PERMISSIONS,canAccessPermission,canAccessRoute,accessFingerprint} from '../src/constants/permissions.js';
import {NAV_SECTIONS} from '../src/constants/navigation.js';
import {createRouter} from '../src/router/index.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const filterNavItems=new Function('canAccessPermission',`return (${app.slice(app.indexOf('function filterNavItems('),app.indexOf('\nfunction isProfileAllowed('))})`)(canAccessPermission);
const active=permissions=>({user_id:'qa',status:'active',web_access_enabled:true,is_system_admin:false,permissions});
const nav=profile=>NAV_SECTIONS.flatMap(s=>filterNavItems(s.items,profile,r=>canAccessRoute(profile,r)));
for(const permission of ALL_PERMISSIONS)test(`UI ${permission}: real nav filter + router allow grant, deny zero/revoke, isolate other keys`,()=>{
  const zero=active([]),allowed=active([permission]);
  const expectedRoutes=Object.keys(ROUTE_PERMISSIONS).filter(route=>ROUTE_PERMISSIONS[route]===permission);
  assert.equal(canAccessPermission(allowed,permission),true);
  for(const other of ALL_PERMISSIONS.filter(x=>x!==permission))assert.equal(canAccessPermission(allowed,other),false);
  for(const item of nav(allowed).filter(x=>!nav(zero).some(y=>y.route===x.route))){
    assert.ok(item.permission===permission||expectedRoutes.includes(item.route)||(permission==='homepage-content'&&item.route==='settings'));
  }
  for(const route of expectedRoutes){
    let current=zero,rendered=0,handler;
    globalThis.window={location:{hash:`#/${route}`},addEventListener:(_,fn)=>{handler=fn;}};
    const outlet={innerHTML:''};
    createRouter({outlet,routes:{[route]:()=>{rendered++;return '<p>protected</p>';},user:()=>'<p>personal</p>'},defaultRoute:'user',canAccess:r=>canAccessRoute(current,r)}).start();
    assert.equal(rendered,0);assert.equal(window.location.hash,'#/user');
    current=allowed;window.location.hash=`#/${route}`;handler();assert.equal(rendered,1);
    current=zero;handler();assert.equal(rendered,1);assert.equal(window.location.hash,'#/user');
  }
  assert.deepEqual(nav(active([])),nav(zero));
});
test('admin override requires active web profile; Promotions has no ordinary permission; personal area remains available',()=>{
  const admin={...active([]),is_system_admin:true};
  for(const route of Object.keys(ROUTE_PERMISSIONS).concat('promotions')){
    assert.ok(canAccessRoute(admin,route));
    assert.equal(canAccessRoute({...admin,status:'locked'},route),false);
    assert.equal(canAccessRoute({...admin,web_access_enabled:false},route),false);
  }
  assert.equal(canAccessRoute(active(ALL_PERMISSIONS),'promotions'),false);
  assert.equal(canAccessRoute(active([]),'user'),true);
  assert.equal(canAccessRoute(active(['homepage-content']),'settings'),true);
});
test('refresh fingerprint changes for each authorization dimension, not permission order or display name',()=>{
  const base=active(['reports','expenses']);
  assert.equal(accessFingerprint(base),accessFingerprint({...base,display_name:'New name',permissions:['expenses','reports']}));
  for(const patch of [{user_id:'other'},{status:'locked'},{web_access_enabled:false},{is_system_admin:true},{permissions:['expenses']}])assert.notEqual(accessFingerprint(base),accessFingerprint({...base,...patch}));
});

test('stopped CRM router cannot redirect public login or issue page work after logout/access invalidation',()=>{
  let handler,removed,loads=0;
  globalThis.window={location:{hash:'#/logs'},addEventListener:(_,fn)=>{handler=fn;},removeEventListener:(_,fn)=>{removed=fn;}};
  const page=()=>'<p>Logs</p>';page.afterRender=()=>{loads++;};
  const router=createRouter({outlet:{innerHTML:''},routes:{logs:page},defaultRoute:'logs'});
  router.start();assert.equal(loads,1);router.stop();assert.equal(removed,handler);
  window.location.hash='#/login';handler();assert.equal(window.location.hash,'#/login');assert.equal(loads,1);
});
