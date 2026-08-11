import { escapeHtml } from '../utils/html.js';
import { PublicContactLinks } from './PublicSupport.js';
import { PublicLogo } from './PublicLogo.js';
import { PUBLIC_BRAND } from '../config/organization.js';

const links = [
  ['home', 'Trang chủ'],
  ['register', 'Đăng ký Kiosk'],
  ['legacy-registration', 'Bổ sung Kiosk'],
  ['lookup', 'Tra cứu Kiosk'],
];

export function PublicLayout({ route = 'home', content = '' } = {}) {
  return `
    <div class="public-site">
      <header class="portal-header">
        <div class="portal-nav-wrap">
          <a class="portal-brand" href="#/home" aria-label="${PUBLIC_BRAND.name}">
            ${PublicLogo()}
          </a>
          <button class="portal-theme-button" type="button" aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối" data-public-theme-toggle><span aria-hidden="true">◐</span></button>
          <button class="portal-menu-button" type="button" aria-label="Mở menu" aria-expanded="false" data-public-menu>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
          <nav class="portal-nav" aria-label="Điều hướng chính" data-public-nav>
            ${links.map(([key, label]) => navLink(key, label, route)).join('')}
            <a href="${PUBLIC_BRAND.contacts.groups.primary}" target="_blank" rel="noopener noreferrer">Group chính</a>
            ${navLink('login', 'Đăng nhập / Đăng ký', route, 'portal-login-link')}
          </nav>
        </div>
      </header>
      <main class="portal-main" data-public-outlet><div class="public-content-container">${content}</div></main>
      ${PublicFooter()}
    </div>
    <div class="modal-overlay hidden" data-modal-overlay><div class="modal" data-modal role="dialog" aria-modal="true" aria-labelledby="app-modal-title"><div class="modal-header"><h3 id="app-modal-title" data-modal-title></h3><button class="modal-close" type="button" data-modal-close>✕</button></div><div class="modal-body" data-modal-body></div></div></div>
    <div class="toast-container" data-toast-container aria-live="polite"></div>`;
}

export function bindPublicLayout(root) {
  const button = root.querySelector('[data-public-menu]');
  const nav = root.querySelector('[data-public-nav]');
  button?.addEventListener('click', () => {
    const open = nav?.classList.toggle('open');
    document.body.classList.toggle('public-menu-open', Boolean(open));
    button.setAttribute('aria-expanded', String(Boolean(open)));
    button.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
  });
  nav?.addEventListener('click', () => {
    closePublicMenu(nav, button);
  });
  document.addEventListener('click', (event) => {
    if (nav?.classList.contains('open') && !event.target.closest('.portal-nav-wrap')) closePublicMenu(nav, button);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePublicMenu(nav, button);
  });
  const themeButton = root.querySelector('[data-public-theme-toggle]');
  updateThemeButton(themeButton);
  themeButton?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('dhlThemePreference', next);
    updateThemeButton(themeButton);
  });
}

function updateThemeButton(button) {
  if (!button) return;
  const light = document.documentElement.dataset.theme === 'light';
  button.setAttribute('aria-label', light ? 'Đổi sang giao diện tối' : 'Đổi sang giao diện sáng');
  button.querySelector('span').textContent = light ? '☾' : '☀';
}

export function PublicFooter() {
  return `<footer class="portal-footer">
    <div class="portal-footer-grid">
      <div><strong>${PUBLIC_BRAND.name}</strong><p>Cổng Kiosk chính thức của cộng đồng.</p></div>
      <div><strong>Liên kết nhanh</strong><a href="#/register">Đăng ký Kiosk</a><a href="#/legacy-registration">Bổ sung Kiosk</a><a href="#/lookup">Tra cứu Kiosk</a></div>
      <div><strong>Kênh chính thức</strong><a href="${PUBLIC_BRAND.contacts.groups.primary}" target="_blank" rel="noopener noreferrer">Facebook · Group chính</a><a href="${PUBLIC_BRAND.contacts.groups.secondary}" target="_blank" rel="noopener noreferrer">Facebook · Group phụ</a><a href="${PUBLIC_BRAND.contacts.groups.recruitment}" target="_blank" rel="noopener noreferrer">Facebook · Group tuyển dụng</a></div>
      <div><strong>Hỗ trợ</strong>${PublicContactLinks({ compact: true })}</div>
    </div><div class="portal-footer-bottom">© ${new Date().getFullYear()} DHL Group · ${PUBLIC_BRAND.communityName}</div>
  </footer>`;
}

function closePublicMenu(nav, button) {
  nav?.classList.remove('open');
  button?.setAttribute('aria-expanded', 'false');
  button?.setAttribute('aria-label', 'Mở menu');
  document.body.classList.remove('public-menu-open');
}

function navLink(key, label, route, className = '') {
  const active = key === route;
  return `<a class="${escapeHtml(className)} ${active ? 'active' : ''}" href="#/${key}" ${active ? 'aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
}
