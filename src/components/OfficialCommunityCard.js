import { getOrganizationSetting } from '../config/organization.js';
import { escapeHtml } from '../utils/html.js';

const ADMIN_FANPAGE_URL = 'https://www.facebook.com/admin.dc.adayroi';

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
          <h3>☎️ Thông tin liên hệ</h3>
          <div class="official-community-contact-group">
            <strong>📱 Zalo hỗ trợ</strong>
            <div>
              <a href="https://zalo.me/0888690346" target="_blank" rel="noopener noreferrer">0888 690 346</a>
              <a href="https://zalo.me/0888640346" target="_blank" rel="noopener noreferrer">0888 640 346</a>
            </div>
          </div>
          <div class="official-community-contact-group">
            <strong>☎️ Hotline</strong>
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
