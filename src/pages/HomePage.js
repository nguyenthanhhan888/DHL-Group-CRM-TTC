import { HomepageContentService } from '../services/HomepageContentService.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { applyPublicHomepageContent } from '../components/PublicLayout.js';

const SECTION_KEYS = ['featured_businesses', 'posting_rules'];

export function HomePage() {
  return `<div class="portal-home homepage-official" data-homepage-root>
    <div class="homepage-loading" role="status" aria-live="polite">
      <span class="homepage-loading-hero"></span><span class="homepage-loading-line"></span>
      <span class="homepage-loading-line short"></span><span class="homepage-loading-cards"></span>
      <span class="sr-only">Đang tải trang chủ cộng đồng...</span>
    </div>
  </div>`;
}

HomePage.afterRender = () => loadHomepage();

async function loadHomepage() {
  const root = document.querySelector('[data-homepage-root]');
  if (!root) return;
  try {
    const data = await HomepageContentService.getPublic();
    if (!document.body.contains(root)) return;
    root.innerHTML = renderHomepage(data);
    bindImageFallbacks(root);
    applyPublicHomepageContent(data?.content);
  } catch (error) {
    root.innerHTML = `<section class="homepage-error" role="alert"><span aria-hidden="true">${renderIcon('warning')}</span><div><h1>Chưa tải được trang chủ</h1><p>${escapeHtml(error?.message || 'Vui lòng thử lại sau ít phút.')}</p><button class="btn-secondary" type="button" data-homepage-retry>Thử lại</button></div></section>`;
    root.querySelector('[data-homepage-retry]')?.addEventListener('click', loadHomepage);
  }
}

function renderHomepage(data = {}) {
  const content = data.content || {};
  const visibility = content.sectionVisibility || {};
  const sections = {
    featured_businesses: () => renderFeaturedBusinesses(data.featuredBusinesses || []),
    posting_rules: () => renderPostingRules(content.postingRules),
  };
  return `${renderHero(content)}${normalizeSectionOrder(content.sectionOrder)
    .filter((key) => visibility[key] !== false)
    .map((key) => sections[key]?.() || '').join('')}
    `;
}

function renderHero(content) {
  const groupUrl = safeExternalUrl(content.heroGroupCtaUrl);
  const kioskRoute = safeInternalRoute(content.heroKioskCtaRoute, '#/register');
  const imageUrl = safeImageUrl(content.heroImageUrl);
  return `<section class="community-hero">
    <div class="community-hero-copy"><span class="portal-eyebrow">Cộng đồng Diễn Châu</span><h1>${escapeHtml(content.heroTitle || '')}</h1><p>${escapeHtml(content.heroSubtitle || '')}</p>
      <div class="portal-hero-actions">${groupUrl ? `<a class="btn-primary" href="${escapeHtml(groupUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(content.heroGroupCtaLabel || 'Tham gia Group')} ${renderIcon('external-link')}</a>` : ''}<a class="btn-secondary" href="${escapeHtml(kioskRoute)}">${escapeHtml(content.heroKioskCtaLabel || 'Đăng ký Kiosk')}</a></div>
    </div>
    <figure class="community-hero-media ${imageUrl ? '' : 'is-fallback'}" data-image-frame>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="Banner ${escapeHtml(content.heroTitle || 'cộng đồng')}" width="1200" height="720" data-fallback-image>` : ''}<span class="homepage-image-fallback" aria-hidden="true">${renderIcon('users')}</span></figure>
  </section>`;
}

function renderFeaturedBusinesses(businesses) {
  const rows = [...businesses].sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  return `<section class="portal-section homepage-section" id="featured-businesses">${sectionHeading('Doanh nghiệp địa phương', 'Doanh nghiệp & dịch vụ nổi bật', 'Khám phá các cửa hàng và dịch vụ đang được giới thiệu trong cộng đồng.')}${rows.length ? `<div class="featured-business-grid">${rows.map(renderBusinessCard).join('')}</div>` : `<div class="homepage-empty homepage-empty--compact"><span aria-hidden="true">${renderIcon('store')}</span><p>Chưa có doanh nghiệp nổi bật đang hiển thị.</p></div>`}</section>`;
}

function renderBusinessCard(item) {
  const imageUrl = safeImageUrl(item.imageUrl);
  const facebookUrl = safeExternalUrl(item.facebookUrl);
  const zaloUrl = contactUrl(item.zaloContact, 'zalo');
  const phoneUrl = contactUrl(item.phone, 'phone');
  return `<article class="featured-business-card"><div class="featured-business-media ${imageUrl ? '' : 'is-fallback'}" data-image-frame>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" width="640" height="400" data-fallback-image>` : ''}<span class="homepage-image-fallback" aria-hidden="true">${renderIcon('store')}</span>${item.badge ? `<span class="featured-business-badge">${escapeHtml(item.badge)}</span>` : ''}</div>
    <div class="featured-business-body"><span class="featured-business-category">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.name)}</h3>${item.shortDescription ? `<p>${escapeHtml(item.shortDescription)}</p>` : ''}${item.address ? `<div class="featured-business-address">${renderIcon('location')}<span>${escapeHtml(item.address)}</span></div>` : ''}<div class="featured-business-links">${facebookUrl ? externalLink(facebookUrl, 'Facebook', 'facebook') : ''}${zaloUrl ? externalLink(zaloUrl, 'Zalo / liên hệ', 'message') : ''}${phoneUrl ? `<a href="${escapeHtml(phoneUrl)}">${renderIcon('phone')}<span>${escapeHtml(item.phone)}</span></a>` : ''}</div></div></article>`;
}

function renderKioskServices() {
  return `<section class="portal-section homepage-section" id="kiosk-services">${sectionHeading('Dịch vụ Kiosk', 'Kết nối cửa hàng với cộng đồng', 'Chọn đúng nhu cầu để đăng ký hoặc tra cứu thông tin Kiosk.')}<div class="service-grid">${service('store', 'Đăng ký Kiosk', 'Tạo Kiosk mới và thanh toán qua quy trình hiện có.', 'register', 'Đăng ký Kiosk')}${service('user-plus', 'Bổ sung Kiosk', 'Bổ sung Kiosk đã có để Ban quản trị kiểm tra.', 'legacy-registration', 'Bổ sung Kiosk')}${service('search', 'Tra cứu Kiosk', 'Kiểm tra trạng thái và thời hạn Kiosk bằng số điện thoại.', 'lookup', 'Tra cứu Kiosk')}</div></section>`;
}

function renderPostingRules(value) {
  const rules = String(value || '').split(/\r?\n/).map((rule) => rule.trim()).filter(Boolean);
  return `<section class="portal-section homepage-section posting-rules-section" id="posting-rules">${sectionHeading('Quy tắc đăng bài', 'Giữ cộng đồng hữu ích và dễ kết nối', '')}${rules.length ? `<ol class="posting-rules-list">${rules.map((rule, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><p>${escapeHtml(rule)}</p></li>`).join('')}</ol>` : '<div class="homepage-empty"><p>Quy tắc đăng bài đang được cập nhật.</p></div>'}</section>`;
}

function renderCommunityLinks(links) {
  const rows = [...links].filter((item) => item?.enabled !== false && safeExternalUrl(item?.url)).sort((a, b) => Number(a.display_order ?? a.displayOrder ?? 0) - Number(b.display_order ?? b.displayOrder ?? 0));
  return `<section class="portal-section homepage-section" id="community-links">${sectionHeading('Hệ thống cộng đồng', 'Kết nối qua các kênh chính thức', 'Chọn đúng nhóm hoặc fanpage phù hợp với nhu cầu của bạn.')}${rows.length ? `<div class="community-link-grid">${rows.map((item) => `<a href="${escapeHtml(safeExternalUrl(item.url))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">${renderIcon(item.key === 'fanpage' ? 'facebook' : 'users')}</span><div><strong>${escapeHtml(item.name)}</strong><small>Mở liên kết ${renderIcon('external-link')}</small></div></a>`).join('')}</div>` : '<div class="homepage-empty"><p>Các kênh cộng đồng đang được cập nhật.</p></div>'}</section>`;
}

function renderContact(content) {
  const zalo = Array.isArray(content.zaloContacts) ? content.zaloContacts : [];
  const links = [...zalo.map((item) => ({ icon: 'message', label: item.label, url: safeExternalUrl(item.url) })), { icon: 'phone', label: content.hotlineLabel, url: contactUrl(content.hotlineNumber, 'phone'), phone: true }, { icon: 'facebook', label: content.fanpageLabel, url: safeExternalUrl(content.fanpageUrl) }].filter((item) => item.label && item.url);
  return `<section class="portal-section homepage-section contact-section" id="contact">${sectionHeading('Liên hệ Admin', 'Cần hỗ trợ về Kiosk hoặc cộng đồng?', 'Liên hệ Ban quản trị qua các kênh chính thức dưới đây.')}<div class="homepage-contact-grid">${links.map((item) => `<a href="${escapeHtml(item.url)}" ${item.phone ? '' : 'target="_blank" rel="noopener noreferrer"'}><span aria-hidden="true">${renderIcon(item.icon)}</span><div><small>${item.phone ? 'Hotline' : item.icon === 'facebook' ? 'Facebook' : 'Zalo'}</small><strong>${escapeHtml(item.label)}</strong></div>${renderIcon('chevron-right')}</a>`).join('')}</div></section>`;
}

function service(icon, title, text, route, cta) { return `<article class="service-card"><span class="service-card-icon" aria-hidden="true">${renderIcon(icon)}</span><h3>${title}</h3><p>${text}</p><a href="#/${route}">${cta} ${renderIcon('chevron-right')}</a></article>`; }
function sectionHeading(eyebrow, title, description) { return `<div class="portal-section-heading"><span>${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>`; }
function externalLink(url, label, icon) { return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${renderIcon(icon)}<span>${escapeHtml(label)}</span></a>`; }
function normalizeSectionOrder(value) { const requested = Array.isArray(value) ? value.filter((key) => SECTION_KEYS.includes(key)) : []; return [...new Set([...requested, ...SECTION_KEYS])]; }

function safeExternalUrl(value) {
  try { const url = new URL(String(value || '').trim()); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function safeImageUrl(value) { const raw = String(value || '').trim(); return raw.startsWith('/') ? raw : safeExternalUrl(raw); }
function safeInternalRoute(value, fallback) { const route = String(value || ''); return /^#\/[a-z0-9-]+$/.test(route) ? route : fallback; }
function contactUrl(value, kind) { const raw = String(value || '').trim(); if (!raw) return ''; if (kind === 'phone') { const number = raw.replace(/[^0-9+]/g, ''); return number ? `tel:${number}` : ''; } const external = safeExternalUrl(raw); if (external) return external; const digits = raw.replace(/\D/g, ''); return digits ? `https://zalo.me/${digits}` : ''; }

function bindImageFallbacks(root) {
  root.querySelectorAll('[data-fallback-image]').forEach((image) => image.addEventListener('error', () => { image.hidden = true; image.closest('[data-image-frame]')?.classList.add('is-fallback'); }, { once: true }));
}
