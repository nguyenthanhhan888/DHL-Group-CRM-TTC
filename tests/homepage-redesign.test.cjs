const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const home = read('src/pages/HomePage.js');
const admin = read('src/pages/HomepageContentPage.js');
const service = read('src/services/HomepageContentService.js');
const app = read('src/app.js');
const layout = read('src/components/PublicLayout.js');
const permissions = read('shared/permissions.js');
const migration = read('supabase/migrations/20260914113000_create_public_homepage_content.sql');
const css = read('src/styles/app.css');

test('public homepage is an anonymous data-backed route with loading, empty and error states', () => {
  assert.match(app, /PUBLIC_ROUTES = new Set\(\['home'/);
  assert.match(home, /HomepageContentService\.getPublic\(\)/);
  assert.match(home, /homepage-loading/);
  assert.match(home, /homepage-empty/);
  assert.match(home, /homepage-error/);
  assert.doesNotMatch(home, /0888 680 346|0333 015 337|1145443782801316/);
});

test('hero, featured businesses and rules render in the body while official channels render in the shared footer', () => {
  for (const contract of ['heroTitle', 'heroSubtitle', 'heroImageUrl', 'featuredBusinesses', 'postingRules']) {
    assert.match(home, new RegExp(contract));
  }
  for (const contract of ['communityLinks', 'zaloContacts', 'hotlineNumber', 'fanpageUrl']) {
    assert.match(layout, new RegExp(contract));
  }
  assert.match(home, /data-fallback-image/);
  assert.match(home, /target=\"_blank\" rel=\"noopener noreferrer\"/);
  assert.match(layout, /tel:/);
});

test('public layout preserves service routes while homepage body stays focused', () => {
  assert.match(layout, /'register', 'Đăng ký Kiosk'/);
  assert.match(layout, /'legacy-registration', 'Bổ sung Kiosk'/);
  assert.match(layout, /'lookup', 'Tra cứu Kiosk'/);
  assert.match(layout, /navLink\('login'/);
  assert.doesNotMatch(home.match(/function renderHomepage[\s\S]*?function renderHero/)?.[0] || '', /renderKioskServices|renderCommunityLinks|renderContact/);
  assert.doesNotMatch(home, /RegistrationService|PaymentService|PayOS/);
});

test('Admin editor provides content controls and featured-business CRUD', () => {
  for (const value of ['Hero', 'Quy tắc đăng bài', 'Liên hệ Admin', 'Hệ thống cộng đồng', 'Hiển thị và thứ tự section', 'Doanh nghiệp nổi bật']) {
    assert.match(admin, new RegExp(value));
  }
  assert.match(service, /save_homepage_content/);
  assert.match(service, /save_featured_business/);
  assert.match(service, /archive_featured_business/);
  assert.match(admin, /data-business-action=\"toggle\"/);
});

test('homepage permission protects route, rows and mutation RPCs', () => {
  assert.match(permissions, /HOMEPAGE_CONTENT: 'homepage-content'/);
  assert.match(permissions, /'homepage-content': PERMISSIONS\.HOMEPAGE_CONTENT/);
  assert.match(migration, /has_user_permission\('homepage-content'\)/);
  assert.match(migration, /revoke all on function public\.save_homepage_content\(jsonb\) from public, anon/);
  assert.match(migration, /revoke all on function public\.save_featured_business\(jsonb\) from public, anon/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on table public\.featured_businesses to authenticated/i);
});

test('homepage layout has desktop and mobile grids without fixed viewport width', () => {
  assert.match(css, /\.featured-business-grid\{display:grid/);
  assert.match(css, /@media\(max-width:960px\)[\s\S]*\.featured-business-grid\{grid-template-columns:repeat\(2/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.featured-business-grid,[\s\S]*grid-template-columns:1fr/);
  // Match a width declaration, not a responsive max-width media query.
  assert.doesNotMatch(css.match(/\/\* Official community homepage[\s\S]*$/)?.[0] || '', /(?:^|[;{])\s*width:\s*1[2-9][0-9]{2}px/);
});
