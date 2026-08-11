import { getOrganizationSetting } from '../config/organization.js';
import { escapeHtml } from '../utils/html.js';

const ADMIN_FANPAGE_URL = 'https://www.facebook.com/admin.dc.adayroi/';
const MAIN_GROUP_URL = 'https://www.facebook.com/groups/1145443782801316';
const SUB_GROUP_URL = 'https://www.facebook.com/groups/dienchaugroup888';
const RECRUITMENT_GROUP_URL = 'https://www.facebook.com/groups/320237372898775';

const OFFICIAL_LINKS = [
  {
    label: 'Nhóm chính',
    name: 'Diễn Châu - À Đây Rồi (DHL) ✅',
    setting: 'group_url',
    fallbackUrl: MAIN_GROUP_URL,
  },
  {
    label: 'Nhóm phụ',
    name: 'Diễn Châu - À Đây Rồi (DHL - Nhóm phụ)',
    setting: 'sub_group_url',
    fallbackUrl: SUB_GROUP_URL,
  },
  {
    label: 'Nhóm tuyển dụng',
    name: 'Diễn Châu - À Đây Rồi (DHL - Tuyển Dụng)',
    setting: 'recruitment_group_url',
    fallbackUrl: RECRUITMENT_GROUP_URL,
  },
  {
    label: 'Fanpage Admin',
    name: 'Admin Diễn Châu - À Đây Rồi',
    setting: 'fanpage_url',
    fallbackUrl: ADMIN_FANPAGE_URL,
  },
];

export function OfficialCommunityCard({ id = 'official-community' } = {}) {
  return `
    <section class="official-community-card" aria-labelledby="${escapeHtml(id)}-title">
      <img
        class="official-community-cover"
        src="images/cover.PNG"
        alt="Ảnh bìa nhóm Diễn Châu - À Đây Rồi"
        loading="eager"
      />
      <div class="official-community-content">
        <h2 id="${escapeHtml(id)}-title">Thông tin cộng đồng chính thức</h2>
        <p>Hãy sử dụng đúng các kênh dưới đây để đăng ký, gửi bill và liên hệ Ban quản trị.</p>
        <div class="official-community-links">
          ${OFFICIAL_LINKS.map(renderOfficialLink).join('')}
        </div>
        <div class="official-community-contacts">
          <h3>${publicIcon('phone')} Thông tin liên hệ</h3>
          <div class="official-community-contact-group">
            <strong>${publicIcon('message')} Zalo hỗ trợ</strong>
            <div>
              <a href="https://zalo.me/0888690346" target="_blank" rel="noopener noreferrer">0888 690 346</a>
              <a href="https://zalo.me/0888640346" target="_blank" rel="noopener noreferrer">0888 640 346</a>
            </div>
          </div>
          <div class="official-community-contact-group">
            <strong>${publicIcon('phone')} Hotline</strong>
            <div>
              <a href="tel:0333015337">0333 015 337</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderOfficialLink(item) {
  const configuredUrl = getOrganizationSetting(item.setting).trim();
  const href = safeHttpUrl(configuredUrl) || item.fallbackUrl || '';
  const value = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>`
    : `<span>${escapeHtml(item.name)} <small class="muted-text">(đang cập nhật liên kết)</small></span>`;
  return `
    <div class="official-community-link">
      <span>${escapeHtml(item.label)}</span>
      ${value}
    </div>
  `;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const PUBLIC_PORTAL_LINKS = {
  mainGroup: MAIN_GROUP_URL,
  subGroup: SUB_GROUP_URL,
  jobsGroup: RECRUITMENT_GROUP_URL,
  fanpage: ADMIN_FANPAGE_URL,
};

export function PublicLayout({ route = 'home', content = '' } = {}) {
  return `<div class="public-site">${PublicHeader({ route })}<main class="public-main" data-route-outlet>${content}</main>${PublicFooter()}</div>
  <div class="modal-overlay hidden" data-modal-overlay><div class="modal" data-modal role="dialog" aria-modal="true" aria-labelledby="app-modal-title"><div class="modal-header"><h3 id="app-modal-title" data-modal-title></h3><button class="modal-close" type="button" data-modal-close aria-label="Đóng">${publicIcon('close')}</button></div><div class="modal-body" data-modal-body></div></div></div><div class="toast-container" data-toast-container aria-live="polite"></div>`;
}

export function PublicHeader({ route = '' } = {}) {
  return `<header class="public-navbar"><div class="public-navbar-inner">
    ${publicBrand()}
    <button class="public-menu-button" type="button" aria-label="Mở menu" aria-expanded="false" aria-controls="public-navigation" data-public-menu-button><span data-public-menu-icon>${publicIcon('menu')}</span></button>
    <button class="public-nav-scrim" type="button" tabindex="-1" aria-label="Đóng menu" data-public-menu-scrim></button>
    <nav class="public-nav-links" id="public-navigation" aria-label="Điều hướng chính" data-public-menu>
      <div class="public-drawer-brand">${publicBrand()}</div>
      <div class="public-nav-primary">${publicNavLink('home','Trang chủ',route)}${publicNavLink('register','Đăng ký Kiosk',route)}${publicNavLink('legacy-registration','Bổ sung Kiosk',route)}${publicNavLink('tra-cuu-kiosk','Tra cứu Kiosk',route)}</div>
      <div class="public-nav-actions"><a class="public-nav-external" href="${PUBLIC_PORTAL_LINKS.mainGroup}" target="_blank" rel="noopener noreferrer">Group chính ${publicIcon('external')}</a><a class="public-nav-login ${route === 'login' ? 'active' : ''}" href="#/login" ${route === 'login' ? 'aria-current="page"' : ''}>Đăng nhập</a></div>
    </nav>
  </div></header>`;
}

let cleanupPublicNavigation = () => {};
export function bindPublicNavigation(root = document) {
  cleanupPublicNavigation();
  const button = root?.querySelector?.('[data-public-menu-button]');
  const menu = root?.querySelector?.('[data-public-menu]');
  const scrim = root?.querySelector?.('[data-public-menu-scrim]');
  if (!button || !menu) return cleanupPublicNavigation;
  const setOpen = (open) => {
    menu.classList.toggle('open', open);
    scrim?.classList.toggle('open', open);
    document.body.classList.toggle('public-menu-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    const icon = button.querySelector('[data-public-menu-icon]');
    if (icon) icon.innerHTML = publicIcon(open ? 'close' : 'menu');
  };
  const toggle = () => setOpen(!menu.classList.contains('open'));
  const close = () => setOpen(false);
  const onKeydown = (event) => { if (event.key === 'Escape') { close(); button.focus(); } };
  button.addEventListener('click', toggle);
  scrim?.addEventListener('click', close);
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
  document.addEventListener('keydown', onKeydown);
  cleanupPublicNavigation = () => {
    setOpen(false);
    button.removeEventListener('click', toggle);
    scrim?.removeEventListener('click', close);
    menu.querySelectorAll('a').forEach((link) => link.removeEventListener('click', close));
    document.removeEventListener('keydown', onKeydown);
  };
  return cleanupPublicNavigation;
}

export function PublicFooter() {
  return `<footer class="public-footer"><div class="public-footer-grid">
    <div class="public-footer-intro"><a class="public-footer-brand" href="#/home">Diễn Châu - À Đây Rồi (DHL)</a><p>Cổng thông tin chính thức hỗ trợ đăng ký, bổ sung và tra cứu Kiosk của cộng đồng.</p><span class="public-footer-trust">${publicIcon('shield')} Chỉ sử dụng các kênh được liệt kê trên trang này.</span></div>
    <div><h2>Liên kết nhanh</h2>${publicFooterLink('#/home','Trang chủ','home')}${publicFooterLink('#/register','Đăng ký Kiosk','store')}${publicFooterLink('#/legacy-registration','Bổ sung Kiosk','refresh')}${publicFooterLink('#/tra-cuu-kiosk','Tra cứu Kiosk','search')}${publicFooterLink('#/login','Đăng nhập','login')}</div>
    <div><h2>Các kênh chính thức</h2>${publicExternalLink(PUBLIC_PORTAL_LINKS.mainGroup,'Group chính','facebook')}${publicExternalLink(PUBLIC_PORTAL_LINKS.subGroup,'Group phụ','facebook')}${publicExternalLink(PUBLIC_PORTAL_LINKS.jobsGroup,'Group tuyển dụng','users')}${publicExternalLink(PUBLIC_PORTAL_LINKS.fanpage,'Fanpage Admin','facebook')}</div>
    <div><h2>Liên hệ Ban quản trị</h2>${publicExternalLink('https://zalo.me/0888690346','Zalo 0888690346','message')}${publicExternalLink('https://zalo.me/0888640346','Zalo 0888640346','message')}<a href="tel:0333015337">${publicIcon('phone')}<span>Hotline 0333 015 337</span></a></div>
  </div><div class="public-footer-bottom"><span>© ${new Date().getFullYear()} Diễn Châu - À Đây Rồi (DHL)</span><span>Thông tin trên cổng được cung cấp để hỗ trợ thành viên cộng đồng.</span></div></footer>`;
}

export function PublicSupportBlock({ title = 'Bạn cần hỗ trợ?' } = {}) {
  return `<aside class="public-support-block"><div class="public-support-icon" aria-hidden="true">${publicIcon('headphones')}</div><div class="public-support-copy"><span class="public-eyebrow">Hỗ trợ trực tiếp</span><h2>${title}</h2><p>Zalo 0888690346 · 0888640346 — Hotline 0333 015 337</p></div><div class="public-support-actions"><a class="btn-primary link-button" href="https://zalo.me/0888690346" target="_blank" rel="noopener noreferrer">${publicIcon('message')} Nhắn Zalo</a><a class="btn-secondary link-button" href="tel:0333015337">${publicIcon('phone')} Gọi hotline</a><a class="btn-secondary link-button" href="${PUBLIC_PORTAL_LINKS.fanpage}" target="_blank" rel="noopener noreferrer">${publicIcon('facebook')} Fanpage Admin</a></div></aside>`;
}

export function PublicHomePage() {
  return `<section class="public-hero" id="public-content"><div class="public-hero-copy"><span class="public-eyebrow">Cổng cộng đồng chính thức</span><h1 class="public-brand-headline"><span>Diễn Châu - À Đây Rồi</span><span class="public-brand-separator">${publicIcon('link')}</span><span>DHL</span></h1><p class="public-hero-lead">Cổng đăng ký, bổ sung và tra cứu Kiosk chính thức của cộng đồng.</p><div class="public-hero-actions"><a class="btn-primary link-button" href="#/register">Đăng ký Kiosk ${publicIcon('arrow')}</a><a class="btn-secondary link-button" href="#/tra-cuu-kiosk">${publicIcon('search')} Tra cứu Kiosk</a></div><div class="public-trust-line"><span>${publicIcon('check')} Quy trình rõ ràng</span><span>${publicIcon('shield')} Thanh toán PayOS</span><span>${publicIcon('headphones')} Hỗ trợ trực tiếp</span></div></div><div class="public-hero-panel"><div class="public-hero-logo"><img src="images/cover.PNG" alt="Ảnh bìa cộng đồng Diễn Châu - À Đây Rồi" width="1942" height="809"></div><div class="public-hero-caption"><span class="public-official-mark">${publicIcon('check-circle')}</span><div><strong>Cộng đồng Diễn Châu - À Đây Rồi</strong><small>Kênh thông tin và hỗ trợ chính thức của DHL</small></div><a href="${PUBLIC_PORTAL_LINKS.mainGroup}" target="_blank" rel="noopener noreferrer" aria-label="Mở Group chính">${publicIcon('external')}</a></div></div></section>
  <section class="public-section public-services" aria-labelledby="public-services-title"><div class="public-section-heading"><span class="public-eyebrow">Dịch vụ trực tuyến</span><h2 id="public-services-title">Chọn đúng nhu cầu của bạn</h2><p>Ba dịch vụ Kiosk chính được tổ chức theo quy trình hiện có của Ban quản trị.</p></div><div class="public-feature-grid">${publicFeature('store','Đăng ký Kiosk','Đăng ký Kiosk mới và tiếp tục luồng thanh toán tự động hiện có.','#/register','Bắt đầu đăng ký',true)}${publicFeature('refresh','Bổ sung Kiosk','Cung cấp lại dữ liệu cho Kiosk đã đăng ký trước đây nhưng chưa có trên hệ thống mới.','#/legacy-registration','Bổ sung thông tin')}${publicFeature('search','Tra cứu Kiosk','Kiểm tra thời hạn và trạng thái bằng số điện thoại đã đăng ký.','#/tra-cuu-kiosk','Tra cứu ngay')}</div><div class="public-secondary-service"><span>${publicIcon('users')}</span><div><strong>Tương tác chéo dành cho thành viên</strong><p>Đăng nhập để sử dụng các tính năng tài khoản và tương tác cộng đồng.</p></div><a href="#/login">Đăng nhập ${publicIcon('arrow')}</a></div></section>
  <section class="public-section public-community-section"><div class="public-section-heading"><span class="public-eyebrow">Kết nối cộng đồng</span><h2>Các kênh chính thức</h2><p>Hãy kiểm tra đúng tên và liên kết trước khi trao đổi hoặc gửi thông tin.</p></div><div class="public-channel-grid">${publicChannel('Group chính','Kênh sinh hoạt chính của cộng đồng.',PUBLIC_PORTAL_LINKS.mainGroup)}${publicChannel('Group phụ','Kênh cộng đồng bổ sung.',PUBLIC_PORTAL_LINKS.subGroup)}${publicChannel('Group tuyển dụng','Thông tin việc làm và tuyển dụng.',PUBLIC_PORTAL_LINKS.jobsGroup)}${publicChannel('Fanpage Admin','Thông tin chính thức từ Ban quản trị.',PUBLIC_PORTAL_LINKS.fanpage)}</div></section>${PublicSupportBlock({title:'Liên hệ Ban quản trị DHL'})}`;
}

function publicBrand(){return `<a class="public-brand" href="#/home" aria-label="Diễn Châu - À Đây Rồi - Trang chủ"><span class="public-brand-mark"><img src="logo/photo_2026-08-03_06-31-15.jpg" alt="" width="64" height="46"></span><span><strong>Diễn Châu - À Đây Rồi</strong><small>Cổng cộng đồng DHL</small></span></a>`;}
function publicNavLink(route,label,current){return `<a href="#/${route}" class="${route===current?'active':''}" ${route===current?'aria-current="page"':''}>${label}</a>`;}
function publicFooterLink(href,label,icon){return `<a href="${href}">${publicIcon(icon)}<span>${label}</span></a>`;}
function publicExternalLink(href,label,icon='external'){return `<a href="${href}" target="_blank" rel="noopener noreferrer">${publicIcon(icon)}<span>${label}</span><span class="public-footer-external">${publicIcon('external')}</span></a>`;}
function publicFeature(icon,title,text,href,cta,featured=false){return `<article class="public-feature-card ${featured?'featured':''}"><span class="public-card-icon">${publicIcon(icon)}</span><h3>${title}</h3><p>${text}</p><a href="${href}">${cta} ${publicIcon('arrow')}</a></article>`;}
function publicChannel(title,text,href){return `<article class="public-channel-card"><span class="public-channel-icon">${publicIcon('facebook')}</span><div><h3>${title}</h3><p>${text}</p></div><a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Mở ${title}">${publicIcon('external')}</a></article>`;}

export function publicIcon(name) {
  const paths = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    external: '<path d="M15 4h5v5M10 14 20 4M20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5ZM20 14h-3v6h2a1 1 0 0 0 1-1v-5Z"/>',
    phone: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-2-2 2c-3.5-1.5-6.5-4.5-8-8l2-2-2-4Z"/>',
    message: '<path d="M21 12a8 8 0 0 1-8 8H6l-4 2 2-5a9 9 0 1 1 17-5Z"/>',
    store: '<path d="M3 10h18l-2-6H5l-2 6Z"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.2-1L20 12M4 12l2.7 5a7 7 0 0 0 11.2-1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    facebook: '<path d="M14 8h3V4h-3a5 5 0 0 0-5 5v3H6v4h3v5h4v-5h3l1-4h-4V9a1 1 0 0 1 1-1Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
    login: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
  };
  return `<svg class="public-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
}
