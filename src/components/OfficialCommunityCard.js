import { getOrganizationSetting, PUBLIC_BRAND } from '../config/organization.js';
import { escapeHtml } from '../utils/html.js';

const OFFICIAL_LINKS = [
  {
    label: 'Nhóm chính',
    name: 'Diễn Châu - À Đây Rồi (DHL) ✅',
    setting: 'group_url',
  },
  {
    label: 'Nhóm phụ',
    name: 'Diễn Châu - À Đây Rồi (DHL - Nhóm phụ)',
    setting: 'sub_group_url',
  },
  {
    label: 'Nhóm tuyển dụng',
    name: 'Diễn Châu - À Đây Rồi (DHL - Tuyển Dụng)',
    setting: 'recruitment_group_url',
  },
  {
    label: 'Fanpage Admin',
    name: 'Admin Diễn Châu - À Đây Rồi',
    setting: 'fanpage_url',
    fallbackUrl: PUBLIC_BRAND.contacts.fanpage,
  },
];

export function OfficialCommunityCard({ id = 'official-community' } = {}) {
  return `
    <section class="official-community-card" aria-labelledby="${escapeHtml(id)}-title">
      <img
        class="official-community-cover"
        src="${PUBLIC_BRAND.assets.cover}"
        alt="Ảnh bìa nhóm ${PUBLIC_BRAND.communityName}"
        loading="eager"
      />
      <div class="official-community-content">
        <h2 id="${escapeHtml(id)}-title">Thông tin cộng đồng chính thức</h2>
        <p>Hãy sử dụng đúng các kênh dưới đây để đăng ký, gửi bill và liên hệ Ban quản trị.</p>
        <div class="official-community-links">
          ${OFFICIAL_LINKS.map(renderOfficialLink).join('')}
        </div>
      </div>
      <div class="official-community-contacts">
        <h3>☎️ Thông tin liên hệ</h3>
        <div class="official-community-contact-row">
          <div class="official-community-contact-group">
            <strong>📱 Zalo hỗ trợ</strong>
            <div>
              ${PUBLIC_BRAND.contacts.zalo.map((contact) => `<a href="${escapeHtml(contact.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(contact.label)}</a>`).join('')}
            </div>
          </div>
          <div class="official-community-contact-group">
            <strong>☎️ Hotline</strong>
            <div>
              <a href="${escapeHtml(PUBLIC_BRAND.contacts.hotline.url)}">${escapeHtml(PUBLIC_BRAND.contacts.hotline.label)}</a>
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
