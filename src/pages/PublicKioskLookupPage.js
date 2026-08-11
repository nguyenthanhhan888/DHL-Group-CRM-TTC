import { escapeHtml } from '../utils/html.js';
import { PublicSupportBlock } from '../components/OfficialCommunityCard.js';

const NOT_FOUND = 'Không tìm thấy Kiosk với thông tin đã nhập.';

export function PublicKioskLookupPage() {
  return `
    <header class="page-header public-lookup-heading">
      <div><h1>Tra cứu Kiosk</h1><p>Nhập số điện thoại đã đăng ký để kiểm tra tình trạng Kiosk.</p></div>
    </header>
    <section class="form-card public-lookup-card">
      <form id="public-kiosk-lookup-form" class="public-lookup-form" novalidate>
        <label class="form-group" for="public-lookup-phone">
          <span>Số điện thoại đăng ký</span>
          <input class="form-control" id="public-lookup-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ví dụ: 0912 345 678" required>
        </label>
        <button class="btn-primary" id="public-lookup-submit" type="submit">Tra cứu</button>
      </form>
      <div id="public-lookup-message" class="public-lookup-message" aria-live="polite"></div>
      <p class="public-privacy-note">♢ Thông tin tra cứu chỉ hiển thị các dữ liệu Kiosk cần thiết.</p>
    </section>
    <section id="public-lookup-results" class="public-lookup-results" aria-live="polite"></section>
    <div class="public-lookup-add"><a class="btn-secondary link-button" href="#/register">Đăng ký thêm Kiosk</a></div>
    ${PublicSupportBlock({ title: 'Bạn cần gia hạn hoặc hỗ trợ?' })}
  `;
}

PublicKioskLookupPage.afterRender = function afterRender() {
  document.getElementById('public-kiosk-lookup-form')?.addEventListener('submit', submitLookup);
};

async function submitLookup(event) {
  event.preventDefault();
  const input = document.getElementById('public-lookup-phone');
  const button = document.getElementById('public-lookup-submit');
  const results = document.getElementById('public-lookup-results');
  setMessage('Đang tra cứu Kiosk…', 'loading');
  if (results) results.innerHTML = '';
  button.disabled = true;
  button.textContent = 'Đang tra cứu…';

  try {
    const response = await fetch('/api/public/kiosk-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: input?.value || '' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.kiosks) || !payload.kiosks.length) {
      setMessage(payload.message || NOT_FOUND, response.status === 429 ? 'error' : 'empty');
      return;
    }
    setMessage(`Tìm thấy ${payload.kiosks.length} Kiosk.`, 'success');
    results.innerHTML = payload.kiosks.map(renderKiosk).join('');
  } catch {
    setMessage('Không thể tra cứu lúc này. Vui lòng thử lại sau.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Tra cứu';
  }
}

export function renderKiosk(kiosk) {
  const tone = kiosk.status === 'Đã hết hạn' ? 'expired' : kiosk.status === 'Sắp hết hạn' ? 'warning' : 'active';
  const notice = tone === 'expired' ? 'Kiosk đã hết hạn.'
    : tone === 'warning' ? 'Kiosk sắp hết hạn. Vui lòng liên hệ Ban quản trị để gia hạn.'
      : 'Kiosk đang hoạt động bình thường.';
  return `
    <article class="public-result-card ${tone}">
      <div class="public-result-head"><h2>${escapeHtml(kiosk.name || 'Kiosk')}</h2><span class="public-status ${tone}">${escapeHtml(kiosk.status)}</span></div>
      <dl class="public-result-details">
        ${detail('Danh mục', kiosk.category || '—')}${detail('Loại hình kinh doanh', kiosk.businessType || '—')}
        ${detail('Ngày bắt đầu', formatDate(kiosk.startDate))}${detail('Ngày hết hạn', formatDate(kiosk.expirationDate))}
        ${detail('Số ngày còn lại', formatRemainingDays(kiosk.remainingDays))}
        ${detail('Tự động duyệt', kiosk.autoApprove ? 'Có' : 'Không')}
      </dl>
      <p class="public-status-notice ${tone}">${escapeHtml(notice)}</p>
      <button class="btn-secondary" type="button" disabled title="Gia hạn công khai đang chờ phê duyệt bảo mật">Gia hạn</button>
    </article>`;
}

function detail(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
  const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`;
}
function formatRemainingDays(value) {
  return Number.isInteger(value) && value >= 0 ? `${value} ngày` : '—';
}
function setMessage(message, state) {
  const element = document.getElementById('public-lookup-message');
  if (!element) return; element.className = `public-lookup-message ${state}`; element.textContent = message;
}
