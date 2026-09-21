import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin = '00000000-0000-4000-8000-000000000401';
const normal = '00000000-0000-4000-8000-000000000402';
const editor = '00000000-0000-4000-8000-000000000403';
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const rpc = (name, values = []) => scalar(`select public.${name}(${values.map((_, index) => `$${index + 1}`).join(',')})`, values);

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./fixtures/crm-payment-baseline.sql', import.meta.url), 'utf8'));
  await db.exec('alter table auth.users add column email text');
  await db.exec(await readFile(new URL('../supabase/migrations/20260828182110_create_unified_user_access_foundation.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260914113000_create_public_homepage_content.sql', import.meta.url), 'utf8'));
});

after(async () => db?.close());

beforeEach(async () => {
  await db.exec(`reset role;
    delete from public.featured_businesses;
    delete from public.user_permissions where user_id in ('${admin}','${normal}','${editor}');
    delete from public.user_profiles where user_id in ('${admin}','${normal}','${editor}');
    delete from auth.users where id in ('${admin}','${normal}','${editor}');`);
  await db.query('insert into auth.users(id) values($1),($2),($3)', [admin, normal, editor]);
  await db.query(`insert into public.user_profiles(user_id,username,display_name,status,web_access_enabled,is_system_admin)
    values ($1,'home-admin','Home Admin','active',true,true),($2,'normal-home','Normal User','active',true,false),($3,'home-editor','Content Editor','active',true,false)`, [admin, normal, editor]);
  await db.query("insert into public.user_permissions(user_id,permission) values($1,'homepage-content')", [editor]);
  await setActor(admin);
});

async function setActor(userId) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec('set role authenticated');
}

function business(name, displayOrder, extra = {}) {
  return { name, category: 'Ẩm thực', enabled: true, displayOrder, ...extra };
}

test('anonymous public homepage returns seeded safe content without authentication', async () => {
  await db.exec('reset role; set role anon');
  const data = await rpc('get_public_homepage_content');
  assert.equal(data.content.heroTitle, 'Diễn Châu – À Đây Rồi');
  assert.deepEqual(data.content.zaloContacts.map((item) => item.label), ['0888 680 346', '0888 640 346']);
  assert.equal(data.content.hotlineNumber, '0333015337');
  assert.equal(Object.hasOwn(data.content, 'updated_by'), false);
});

test('public businesses honor enabled, visibility window and display order', async () => {
  await rpc('save_featured_business', [business('Thứ hai', 20)]);
  await rpc('save_featured_business', [business('Thứ nhất', 10)]);
  await rpc('save_featured_business', [business('Đang ẩn', 1, { enabled: false })]);
  await rpc('save_featured_business', [business('Chưa tới lịch', 2, { visibilityStart: '2099-01-01T00:00:00Z' })]);
  await rpc('save_featured_business', [business('Đã hết lịch', 3, { visibilityEnd: '2020-01-01T00:00:00Z' })]);
  await db.exec('reset role; set role anon');
  const data = await rpc('get_public_homepage_content');
  assert.deepEqual(data.featuredBusinesses.map((item) => item.name), ['Thứ nhất', 'Thứ hai']);
});

test('System Admin and permitted editor can CRUD while normal user is denied', async () => {
  const created = await rpc('save_featured_business', [business('Cửa hàng A', 5)]);
  assert.equal(created.name, 'Cửa hàng A');
  await setActor(editor);
  const edited = await rpc('save_featured_business', [{ ...business('Cửa hàng B', 6), id: created.id }]);
  assert.equal(edited.name, 'Cửa hàng B');
  assert.equal((await rpc('get_homepage_admin_data')).featuredBusinesses.length, 1);
  await rpc('archive_featured_business', [created.id]);
  assert.equal((await rpc('get_homepage_admin_data')).featuredBusinesses.length, 0);
  await setActor(normal);
  assert.equal(await scalar('select count(*)::int from public.featured_businesses'), 0);
  await assert.rejects(() => rpc('get_homepage_admin_data'), /Không có quyền/);
  await assert.rejects(() => rpc('save_featured_business', [business('Không hợp lệ', 1)]), /Không có quyền/);
});

test('permitted editor can update Hero, rules and contact while public receives only whitelisted fields', async () => {
  await setActor(editor);
  const content = {
    heroTitle: 'Trang chủ mới', heroSubtitle: 'Mô tả mới', heroImageUrl: '/images/cover.PNG',
    heroGroupCtaLabel: 'Vào Group', heroGroupCtaUrl: 'https://example.com/group',
    heroKioskCtaLabel: 'Đăng ký ngay', heroKioskCtaRoute: '#/register', postingRules: 'Quy tắc một',
    zaloContacts: [{ label: 'Zalo Admin', url: 'https://zalo.me/123', secret: 'không công khai' }],
    hotlineLabel: '0123 456 789', hotlineNumber: '0123456789', fanpageLabel: 'Fanpage', fanpageUrl: 'https://example.com/fanpage',
    communityLinks: [{ key: 'primary', name: 'Group chính', url: 'https://example.com/main', enabled: true, display_order: 10, secret: 'không công khai' }],
    sectionVisibility: { featured_businesses: true, kiosk_services: true, posting_rules: true, community_links: true, contact: true },
    sectionOrder: ['featured_businesses', 'kiosk_services', 'posting_rules', 'community_links', 'contact'],
  };
  const saved = await rpc('save_homepage_content', [content]);
  assert.equal(saved.hero_title, 'Trang chủ mới');
  await db.exec('reset role; set role anon');
  const published = await rpc('get_public_homepage_content');
  assert.equal(published.content.heroTitle, 'Trang chủ mới');
  assert.equal(published.content.postingRules, 'Quy tắc một');
  assert.equal(Object.hasOwn(published.content.zaloContacts[0], 'secret'), false);
  assert.equal(Object.hasOwn(published.content.communityLinks[0], 'secret'), false);
});

test('anonymous callers cannot mutate homepage content', async () => {
  await db.exec('reset role; set role anon');
  await assert.rejects(() => rpc('save_featured_business', [business('Public write', 1)]), /permission denied/i);
  await assert.rejects(() => rpc('save_homepage_content', [{}]), /permission denied/i);
});
