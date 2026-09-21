import { escapeHtml } from '../utils/html.js';
import { PublicLogo } from './PublicLogo.js';
import { PUBLIC_BRAND } from '../config/organization.js';
import { renderIcon } from '../utils/icons.js';
import { syncThemeLogos } from '../utils/themeLogo.js';

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
            ${PublicLogo({ className: 'public-header-logo' })}
          </a>
          <button class="portal-theme-button" type="button" aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối" data-public-theme-toggle><span aria-hidden="true">${renderIcon('moon')}</span></button>
          <button class="portal-menu-button" type="button" aria-label="Mở menu" aria-expanded="false" data-public-menu>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
          <nav class="portal-nav" aria-label="Điều hướng chính" data-public-nav>
            ${links.map(([key, label]) => navLink(key, label, route)).join('')}
            ${navLink('login', 'Đăng nhập / Đăng ký', route, 'portal-login-link')}
          </nav>
        </div>
      </header>
      <main class="portal-main" data-public-outlet><div class="public-content-container">${content}</div></main>
      ${PublicFooter()}
    </div>
    <div class="modal-overlay hidden" data-modal-overlay><div class="modal" data-modal role="dialog" aria-modal="true" aria-labelledby="app-modal-title"><div class="modal-header"><h3 id="app-modal-title" data-modal-title></h3><button class="modal-close" type="button" data-modal-close aria-label="Đóng"><span aria-hidden="true">${renderIcon('x')}</span></button></div><div class="modal-body" data-modal-body></div></div></div>
    <div class="toast-container" data-toast-container aria-live="polite"></div>`;
}

export function bindPublicLayout(root) {
  syncThemeLogos(undefined, root);
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
    syncThemeLogos(next, root);
    localStorage.setItem('dhlThemePreference', next);
    window.dispatchEvent(new CustomEvent('dhl:themechange', { detail: { theme: next } }));
    updateThemeButton(themeButton);
  });
}

function updateThemeButton(button) {
  if (!button) return;
  const light = document.documentElement.dataset.theme === 'light';
  button.setAttribute('aria-label', light ? 'Đổi sang giao diện tối' : 'Đổi sang giao diện sáng');
  button.querySelector('span').innerHTML = renderIcon(light ? 'moon' : 'sun');
}

export function PublicFooter() {
  return `<footer class="portal-footer">
    <div class="portal-footer-grid">
      <div><strong data-public-community-name>${PUBLIC_BRAND.name}</strong><p>Cổng Kiosk chính thức của cộng đồng.</p></div>
      <div class="portal-footer-quick-links"><strong>Liên kết nhanh</strong><a href="#/register"><span class="portal-footer-action-icon is-register">${renderIcon('user-plus')}</span><span>Đăng ký Kiosk</span></a><a href="#/legacy-registration"><span class="portal-footer-action-icon is-additional">${renderIcon('plus')}</span><span>Bổ sung Kiosk</span></a><a href="#/lookup"><span class="portal-footer-action-icon is-lookup">${renderIcon('search')}</span><span>Tra cứu Kiosk</span></a></div>
      <div><strong>Kênh chính thức</strong><div data-public-official-channels></div></div>
    </div><div class="portal-footer-bottom">© ${new Date().getFullYear()} DHL Group · ${PUBLIC_BRAND.communityName}</div>
  </footer>`;
}

export function applyPublicHomepageContent(content = {}, root = document) {
  const links = Array.isArray(content.communityLinks) ? content.communityLinks : [];
  const channelRows = deduplicateChannels([
    ...links.filter((item) => item?.enabled !== false).map((item) => ({
      icon: socialIcon(item.key === 'primary' ? content.heroGroupCtaUrl || item.url : item.url), label: item.name,
      url: safeUrl(item.key === 'primary' ? content.heroGroupCtaUrl || item.url : item.url),
    })),
    { icon: socialIcon(content.fanpageUrl), label: content.fanpageLabel, url: safeUrl(content.fanpageUrl) },
    ...(Array.isArray(content.zaloContacts) ? content.zaloContacts.map((item) => ({ icon: 'zalo', label: item.label, url: safeUrl(item.url) })) : []),
    { icon: 'phone', label: content.hotlineLabel, url: phoneUrl(content.hotlineNumber) },
  ].filter((item) => item.label && item.url));
  root.querySelectorAll('[data-public-community-name]').forEach((node) => { node.textContent = content.heroTitle || PUBLIC_BRAND.name; });
  root.querySelectorAll('[data-public-official-channels]').forEach((node) => {
    node.innerHTML = channelRows.length
      ? channelRows.map((item, index) => `<a class="portal-channel-row${index && channelGroup(item.icon) !== channelGroup(channelRows[index - 1].icon) ? ' portal-channel-row--group-start' : ''}" href="${escapeHtml(item.url)}" ${item.icon === 'phone' ? '' : 'target="_blank" rel="noopener noreferrer"'}>${officialChannelIcon(item.icon)}<span>${escapeHtml(item.label)}</span></a>`).join('')
      : '<p class="portal-footer-empty">Kênh chính thức đang được cập nhật.</p>';
  });
}

function officialChannelIcon(icon) {
  const assets = { facebook: './images/icon-facebook.svg', messenger: './images/icon-messenger.svg', zalo: './images/icon-zalo.png' };
  return assets[icon]
    ? `<img class="portal-channel-icon" src="${assets[icon]}" width="22" height="22" alt="" aria-hidden="true">`
    : renderIcon('phone');
}

function socialIcon(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return /(^|\.)(m\.me|messenger\.com)$/.test(host) ? 'messenger' : 'facebook';
  } catch { return 'facebook'; }
}

function channelGroup(icon) { return ['facebook', 'messenger'].includes(icon) ? 'facebook' : icon; }

function deduplicateChannels(rows) {
  const seen = new Set();
  return rows.filter((item) => {
    const key = String(item.url || '').replace(/\/$/, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeUrl(value) { try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function phoneUrl(value) { const number = String(value || '').replace(/[^0-9+]/g, ''); return number ? `tel:${number}` : ''; }

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
