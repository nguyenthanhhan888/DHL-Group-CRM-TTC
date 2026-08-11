import { EmptyState } from '../components/EmptyState.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from '../components/FacebookIdResolver.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { bindPayosCopyButtons, PayosResultCard, watchPayosPaymentStatus } from '../components/PayosResultCard.js';
import { Toast } from '../components/Toast.js';
import { AnnouncementService } from '../services/AnnouncementService.js';
import { FacebookIdService } from '../services/FacebookIdService.js';
import { PayosService } from '../services/PayosService.js';
import { PaymentService } from '../services/PaymentService.js';
import { AuthService } from '../services/AuthService.js';
import { UserProfileService } from '../services/UserProfileService.js';
import { WalletService } from '../services/WalletService.js';
import { getOrganizationSetting } from '../config/organization.js';
import { bindCurrencyInput, formatCurrency, formatVndNumber, parseCurrencyInput } from '../utils/currency.js';
import { isMissingDatabaseFeatureError } from '../utils/databaseFeature.js';
import { formatDate, formatDateTime } from '../utils/date.js';
import { getUserAvatarPath } from '../utils/avatar.js';
import { escapeHtml } from '../utils/html.js';

const WALLET_POLL_INTERVAL_MS = 4000;
const WALLET_POLL_MAX_MS = 90_000;
const WALLET_FOCUS_THROTTLE_MS = 1500;

let pageLifecycle = null;
let walletPollTimer = null;
let walletPollStartedAt = 0;
let lastWalletRefreshAt = 0;

const state = {
  profile: null,
  wallet: null,
  customerLinks: [],
  payments: [],
  walletLedger: [],
  facebookAccounts: [],
  kioskSearchTerm: '',
  paymentSearchTerm: '',
  walletLedgerSearchTerm: '',
  facebookSearchTerm: '',
  announcements: [],
};

const USER_ROUTE_CONFIG = {
  user: {
    title: 'Trang chủ',
    description: 'Bảng tin cập nhật, điểm xu và xếp hạng cộng đồng.',
    sections: ['homeFeed'],
  },
  'user-profile': {
    title: 'Hồ sơ cá nhân',
    description: 'Thông tin tài khoản, ví xu và các thiết lập đang có trong hệ thống.',
    sections: ['accountProfile'],
  },
  'user-announcements': {
    title: 'Thông báo',
    description: 'Theo dõi các cập nhật từ hệ thống và admin.',
    sections: ['announcements'],
  },
  'user-support': {
    title: 'Hỗ trợ',
    description: 'Thông tin liên hệ hỗ trợ đã được cấu hình trong hệ thống.',
    sections: ['support'],
  },
  'user-kiosks': {
    title: 'Danh sách Kiosk',
    description: 'Kiosk thuộc tài khoản của bạn sẽ hiển thị tại đây sau khi được liên kết.',
    sections: ['kioskEntry'],
  },
  'user-register-kiosk': {
    title: 'Đăng ký Kiosk mới',
    description: 'Mở form đăng ký Kiosk và tạo mã thanh toán theo luồng đăng ký public.',
    sections: ['kioskEntry'],
  },
  'payments-mine': {
    title: 'Thanh toán của tôi',
    description: 'Theo dõi khoản thanh toán Kiosk của tài khoản. Hệ thống tự hoàn tất khi ngân hàng xác nhận.',
    sections: ['paymentNotice'],
  },
  'ttc-wallet': {
    title: 'Ví xu',
    description: 'Xem số dư, nạp tiền và dùng xu để tạo tương tác.',
    sections: ['wallet'],
  },
  'ttc-wallet-history': {
    title: 'Lịch sử giao dịch',
    description: 'Theo dõi các lần cộng/trừ xu và số dư sau mỗi giao dịch.',
    sections: ['walletLedger'],
  },
  'user-facebook': {
    title: 'Tài khoản Facebook',
    description: 'Liên kết Facebook ID để nhận nhiệm vụ kiếm xu trong tương tác chéo.',
    sections: ['facebookForm', 'facebookList'],
  },
};

export function UserHomePage({ route = 'user' } = {}) {
  const view = USER_ROUTE_CONFIG[route] || USER_ROUTE_CONFIG.user;
  const hasSection = (section) => view.sections.includes(section);
  return `
    ${PageHeader({
      title: view.title,
      description: view.description,
    })}
    <div id="user-portal-notice"></div>
    ${hasSection('homeFeed') ? renderUserHomeFeed() : ''}
    ${hasSection('announcements') ? renderAnnouncementsSection() : ''}
    ${hasSection('support') ? renderSupportSection() : ''}
    ${hasSection('accountProfile') ? renderAccountProfileSection() : ''}
    ${hasSection('profile') ? `<section class="dash-card">
      <div class="dash-card-header"><h3>Hồ sơ của tôi</h3></div>
      <form id="user-profile-form" class="form-grid">
        <label class="form-group"><span>Họ tên</span><input class="form-control" name="displayName" autocomplete="name"></label>
        <label class="form-group"><span>Số điện thoại</span><input class="form-control" name="phone" autocomplete="tel"></label>
        <label class="form-group"><span>Email</span><input class="form-control" name="email" type="email" autocomplete="email"></label>
        <div class="form-actions">
          <button class="btn-primary" type="submit">Lưu hồ sơ</button>
        </div>
      </form>
    </section>` : ''}
    ${hasSection('walletSummary') ? `<section class="dash-card">
      <div class="dash-card-header">
        <h3>Ví xu</h3>
        <a class="btn-secondary link-button" href="#/ttc-wallet">Nạp xu</a>
      </div>
      <div id="user-wallet-panel">
        ${EmptyState({ title: 'Đang tải ví xu', message: 'Đang đọc số dư từ Supabase.' })}
      </div>
    </section>` : ''}
    ${hasSection('wallet') ? `<section class="dash-card">
      <div class="dash-card-header"><h3>Ví xu</h3></div>
      <div id="user-wallet-return-status"></div>
      <div id="user-wallet-panel">
        ${EmptyState({ title: 'Đang tải ví xu', message: 'Đang đọc số dư từ Supabase.' })}
      </div>
      <form id="wallet-topup-form" class="wallet-topup-form wallet-topup-card">
        <div class="wallet-topup-heading">
          <strong>Nạp tiền</strong>
          <span>Tạo mã thanh toán để cộng xu vào ví sau khi ngân hàng xác nhận.</span>
        </div>
        <div class="wallet-topup-presets" aria-label="Chọn nhanh số tiền nạp">
          <button type="button" data-topup-amount="50000">50.000 VNĐ</button>
          <button type="button" data-topup-amount="100000">100.000 VNĐ</button>
          <button type="button" data-topup-amount="200000">200.000 VNĐ</button>
        </div>
        <label class="wallet-topup-input">
          <span>Số tiền muốn nạp</span>
          <input class="form-control" name="amount" type="text" inputmode="numeric" placeholder="0 VNĐ" aria-label="Số tiền nạp" required>
        </label>
        <button class="btn-primary wallet-topup-submit" type="submit">Nạp tiền</button>
      </form>
    </section>` : ''}
    ${hasSection('kioskEntry') ? `<section class="dash-card user-kiosk-entry-card">
      <div class="dash-card-header"><h3>Mua Kiosk mới</h3></div>
      <p class="muted-text">Form đăng ký tạo hồ sơ Khách hàng/Kiosk và QR/link thanh toán cho chính khoản dịch vụ Kiosk. Khoản này không nạp vào ví xu.</p>
      <div class="list-search-bar">
        <input id="user-kiosk-search" class="form-control" type="search" placeholder="Tìm theo tên Kiosk, khách hàng, Facebook ID hoặc trạng thái" aria-label="Tìm Kiosk của tôi" autocomplete="off">
      </div>
      <div id="user-kiosk-links">
        ${EmptyState({ title: 'Đang tải Kiosk', message: 'Đang đọc các Kiosk đã liên kết với tài khoản.' })}
      </div>
      <a class="btn-secondary link-button" href="#/register">Đăng ký Kiosk và thanh toán</a>
    </section>` : ''}
    ${hasSection('paymentNotice') ? `<section class="dash-card">
      <div class="dash-card-header"><h3>Thanh toán Kiosk của tôi</h3></div>
      <div class="list-search-bar">
        <input id="user-payment-search" class="form-control" type="search" placeholder="Tìm theo Kiosk, số tiền, trạng thái hoặc thời gian" aria-label="Tìm thanh toán của tôi" autocomplete="off">
      </div>
      <div id="user-payment-list">
        ${EmptyState({ title: 'Đang tải thanh toán', message: 'Đang đọc thanh toán theo khách hàng đã liên kết.' })}
      </div>
      <a class="btn-secondary link-button" href="#/register">Đăng ký Kiosk mới</a>
    </section>` : ''}
    ${hasSection('wallet') || hasSection('walletLedger') ? `<section class="dash-card">
      <div class="dash-card-header"><h3>Lịch sử ví</h3></div>
      <div class="list-search-bar">
        <input id="user-wallet-ledger-search" class="form-control" type="search" placeholder="Tìm theo mô tả, loại giao dịch hoặc số xu" aria-label="Tìm lịch sử ví của tôi" autocomplete="off">
      </div>
      <div id="user-wallet-ledger">
        ${EmptyState({ title: 'Đang tải lịch sử', message: 'Đang đọc giao dịch xu gần đây.' })}
      </div>
    </section>` : ''}
    ${hasSection('facebookForm') ? `<section class="dash-card">
      <div class="dash-card-header"><h3>Thêm Facebook</h3></div>
      <form id="user-facebook-form" class="stacked-form" novalidate>
        ${FacebookIdResolverFields({
          urlId: 'user-facebook-url',
          idId: 'user-facebook-id',
          requiredUrl: true,
          requiredId: false,
          manualFallback: 'never',
          prefix: 'user-facebook',
          idAttributes: 'name="facebookId" readonly',
          urlAttributes: 'name="facebookUrlOriginal"',
        })}
        <label class="form-group"><span>Ghi chú</span><input class="form-control" name="note" autocomplete="off"></label>
        <label class="checkbox-row"><input type="checkbox" name="isPrimary" checked> <span>Đặt làm Facebook chính</span></label>
        <div class="form-actions">
          <button class="btn-primary" type="submit">Lưu Facebook</button>
        </div>
      </form>
    </section>` : ''}
    ${hasSection('facebookList') ? `<section class="dash-card">
      <div class="dash-card-header"><h3>Facebook đã liên kết</h3></div>
      <div class="list-search-bar">
        <input id="user-facebook-search" class="form-control" type="search" placeholder="Tìm theo Facebook ID, link hoặc trạng thái" aria-label="Tìm Facebook đã liên kết" autocomplete="off">
      </div>
      <div id="user-facebook-panel">
        ${EmptyState({ title: 'Đang tải Facebook', message: 'Đang đọc tài khoản Facebook đã lưu.' })}
      </div>
    </section>` : ''}
  `;
}

UserHomePage.afterRender = function afterRenderUserHome() {
  resetPageLifecycle();
  bindFacebookIdResolvers(document);
  bindProfileForm();
  bindAccountTabs();
  bindAccountPasswordForm();
  bindAccountSecurityActions();
  bindFacebookForm();
  bindWalletTopupForm();
  bindUserListSearch();
  bindWalletAutoRefresh(pageLifecycle.signal);
  renderPayosReturnStatus();
  loadUserPortalData();
};

function bindUserListSearch() {
  document.getElementById('user-kiosk-search')?.addEventListener('input', (event) => {
    state.kioskSearchTerm = event.currentTarget.value || '';
    renderCustomerLinks();
  });
  document.getElementById('user-payment-search')?.addEventListener('input', (event) => {
    state.paymentSearchTerm = event.currentTarget.value || '';
    renderMyPayments();
  });
  document.getElementById('user-wallet-ledger-search')?.addEventListener('input', (event) => {
    state.walletLedgerSearchTerm = event.currentTarget.value || '';
    renderWalletLedger();
  });
  document.getElementById('user-facebook-search')?.addEventListener('input', (event) => {
    state.facebookSearchTerm = event.currentTarget.value || '';
    renderFacebookAccounts();
  });
}

function renderUserHomeFeed() {
  return `
    <section class="user-social-home">
      <div class="user-social-feed">
        <div class="user-social-toolbar">
          <div>
            <strong>Bảng tin hệ thống</strong>
            <span>Cập nhật từ admin, thay đổi giá xu và hướng dẫn mới.</span>
          </div>
          <div class="user-live-strip" aria-label="Trạng thái hệ thống">
            <span><i></i> Live nhiệm vụ</span>
            <span>+128 lượt hôm nay</span>
          </div>
          <a class="btn-secondary link-button" href="#/ttc-wallet">Nạp xu</a>
        </div>
        <div class="user-social-metrics" aria-label="Tổng quan nhanh">
          <div class="user-social-metric">
            <span>Đang chạy</span>
            <strong>24</strong>
            <small>flow Facebook</small>
          </div>
          <div class="user-social-metric">
            <span>Thưởng hôm nay</span>
            <strong>18.4K</strong>
            <small>xu đã phát</small>
          </div>
          <div class="user-social-metric">
            <span>Tốc độ duyệt</span>
            <strong>2m</strong>
            <small>trung bình</small>
          </div>
        </div>
        <div id="user-announcement-feed">
          ${EmptyState({ title: 'Đang tải bảng tin', message: 'Đang đọc thông báo hệ thống.' })}
        </div>
      </div>
      <aside class="user-social-aside">
        <div class="user-rank-card">
          <div class="user-rank-head">
            <h3>Bảng xếp hạng</h3>
            <span>Page 1 VNĐ</span>
          </div>
          ${renderLeaderboard()}
        </div>
      </aside>
    </section>
  `;
}

function renderAnnouncementsSection() {
  return `
    <section class="dash-card user-announcements-page">
      <div class="dash-card-header"><h3>Thông báo</h3></div>
      <div id="user-announcement-feed">
        ${EmptyState({ title: 'Đang tải thông báo', message: 'Đang đọc thông báo hệ thống.' })}
      </div>
    </section>
  `;
}

function renderSupportSection() {
  const supportItems = [
    ['Điện thoại', getOrganizationSetting('support_phone')],
    ['Zalo hỗ trợ', getOrganizationSetting('zalo_url')],
    ['Fanpage', getOrganizationSetting('fanpage_url')],
    ['Nhóm chính', getOrganizationSetting('group_url')],
    ['Nhóm cộng đồng', getOrganizationSetting('sub_group_url')],
    ['Tuyển dụng', getOrganizationSetting('recruitment_group_url')],
  ].filter(([, value]) => String(value || '').trim());
  return `
    <section class="dash-card user-support-card">
      <div class="dash-card-header"><h3>Hỗ trợ</h3></div>
      ${supportItems.length ? `
        <div class="settings-list user-support-list">
          ${supportItems.map(([label, value]) => renderSupportItem(label, value)).join('')}
        </div>
      ` : EmptyState({
        title: 'Chưa có thông tin hỗ trợ',
        message: 'Admin có thể cấu hình số điện thoại, Zalo, fanpage và nhóm trong Cài đặt.',
      })}
    </section>
  `;
}

function renderSupportItem(label, value) {
  const normalized = String(value || '').trim();
  const href = supportHref(label, normalized);
  return `
    <div class="settings-row user-support-row">
      <span>${escapeHtml(label)}</span>
      ${href
        ? `<a class="link-button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(normalized)}</a>`
        : `<strong>${escapeHtml(normalized)}</strong>`}
    </div>
  `;
}

function supportHref(label, value) {
  if (/^https?:\/\//i.test(value)) return value;
  if (label === 'Điện thoại') return `tel:${value.replace(/\s+/g, '')}`;
  return '';
}

function renderLeaderboard() {
  const ranks = [
    ['10q31****', 'Thách đấu', 194320],
    ['Hala****', 'Đại cao thủ', 171900],
    ['Halad****', 'Cao thủ', 170820],
    ['Hala****', 'Kim cương', 168040],
    ['hala****', 'Vàng', 167830],
    ['halad****', 'Đồng nhất', 165470],
  ];
  return ranks.map(([name, tier, score], index) => `
    <div class="user-rank-row ${index < 3 ? 'is-podium' : ''}">
      <img src="${escapeHtml(getRankAvatar(index))}" alt="" loading="lazy">
      <div>
        <strong><span class="user-rank-position">#${index + 1}</span>${escapeHtml(name)}</strong>
        <span>${escapeHtml(tier)} · Điểm: ${formatNumber(score)}</span>
      </div>
    </div>
  `).join('');
}

function getRankAvatar(index) {
  const avatars = [
    'images/avatars/avatar_01.webp',
    'images/avatars/avatar_02.webp',
    'images/avatars/avatar_03.webp',
    'images/avatars/avatar_05.webp',
    'images/avatars/avatar_06.webp',
    'images/avatars/avatar_07.webp',
  ];
  return avatars[index % avatars.length];
}

function resetPageLifecycle() {
  stopWalletPolling();
  pageLifecycle?.abort();
  pageLifecycle = new AbortController();
}

function bindWalletAutoRefresh(signal) {
  const refreshIfVisible = () => {
    if (document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (now - lastWalletRefreshAt < WALLET_FOCUS_THROTTLE_MS) return;
    lastWalletRefreshAt = now;
    loadWalletAndLedger();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfVisible();
  }, { signal });

  window.addEventListener('focus', refreshIfVisible, { signal });
  window.addEventListener('pageshow', refreshIfVisible, { signal });
}

function startWalletPolling(reason = '') {
  stopWalletPolling();
  walletPollStartedAt = Date.now();
  lastWalletRefreshAt = 0;
  loadWalletAndLedger();

  walletPollTimer = window.setInterval(() => {
    if (Date.now() - walletPollStartedAt >= WALLET_POLL_MAX_MS) {
      stopWalletPolling();
      return;
    }
    if (document.visibilityState === 'hidden') return;
    loadWalletAndLedger();
  }, WALLET_POLL_INTERVAL_MS);

  if (reason) {
    const panel = document.getElementById('user-wallet-return-status');
    if (panel && !panel.innerHTML.trim()) {
      panel.innerHTML = `
        <div class="notice success wallet-return-notice">
          <strong>Đang chờ xác nhận thanh toán</strong>
          <span>Số dư và lịch sử ví sẽ tự làm mới khi ngân hàng xác nhận thanh toán.</span>
        </div>
      `;
    }
  }
}

function stopWalletPolling() {
  if (walletPollTimer) {
    window.clearInterval(walletPollTimer);
    walletPollTimer = null;
  }
  walletPollStartedAt = 0;
}

async function loadWalletAndLedger() {
  lastWalletRefreshAt = Date.now();
  await Promise.allSettled([loadWallet(), loadWalletLedger()]);
}

function bindProfileForm() {
  document.getElementById('user-profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    button.textContent = 'Đang lưu...';
    try {
      await UserProfileService.ensureMyProfile(values);
      Toast.show('Đã lưu hồ sơ thành viên.');
      await loadUserPortalData();
    } catch (error) {
      Toast.show(isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('lưu hồ sơ user portal')
        : error?.message || 'Không thể lưu hồ sơ.');
    } finally {
      button.disabled = false;
      button.textContent = 'Lưu hồ sơ';
    }
  });
}

async function loadCurrentProfile() {
  const form = document.getElementById('user-profile-form');
  const summary = document.getElementById('user-account-summary');
  if (!form && !summary) return;
  try {
    const { data } = await UserProfileService.getCurrentAppProfile();
    state.profile = data || null;
    populateProfileForm();
    renderAccountSummaryIntoDom();
  } catch (error) {
    showMigrationNotice(error, 'hồ sơ user portal');
  }
}

function populateProfileForm() {
  const form = document.getElementById('user-profile-form');
  if (!form || !state.profile) return;
  const profile = state.profile;
  setFormValue(form, 'displayName', profile.display_name || '');
  setFormValue(form, 'phone', profile.phone || '');
  setFormValue(form, 'email', profile.email || '');
  setInputValue('user-profile-username', getProfileUsername(profile));
  setInputValue('user-profile-created', formatDate(profile.created_at || profile.createdAt));
  setTextValue('user-security-created', formatDate(profile.created_at || profile.createdAt));
  setTextValue('user-security-status', profile.status === 'active' ? 'Hoạt động' : statusLabel(profile.status));
  const status = document.getElementById('user-account-status');
  if (status) {
    status.textContent = profile.status === 'active' ? 'Hoạt động' : statusLabel(profile.status);
    status.className = `status-pill ${profile.status === 'active' ? 'success' : ''}`;
  }
}

function setFormValue(form, name, value) {
  const field = form.elements?.[name];
  if (field) field.value = value || '';
}

function setInputValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value || '—';
}

function setTextValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.textContent = value || '—';
}

async function loadUserPortalData() {
  loadAnnouncements();
  await Promise.allSettled([
    loadCurrentProfile(),
    loadWalletAndLedger(),
    loadFacebookAccounts(),
    loadCustomerLinks(),
    loadMyPayments(),
  ]);
}

function loadAnnouncements() {
  const panel = document.getElementById('user-announcement-feed');
  if (!panel) return;
  state.announcements = AnnouncementService.list();
  renderAnnouncements();
}

function renderAnnouncements() {
  const panel = document.getElementById('user-announcement-feed');
  if (!panel) return;
  if (!state.announcements.length) {
    panel.innerHTML = EmptyState({
      title: 'Chưa có thông báo',
      message: 'Admin tạo thông báo thì nội dung sẽ hiện tại đây.',
    });
    return;
  }
  panel.innerHTML = state.announcements.map((item, index) => `
    <article class="user-announcement-card ${index === 0 ? 'is-featured' : ''}" style="--feed-index: ${index};">
      <header class="user-announcement-head">
        <img src="images/avatar.PNG" alt="" loading="lazy">
        <div>
          <strong>${escapeHtml(item.author || 'Admin')} <span>✓</span></strong>
          <time>${escapeHtml(formatDateTime(item.createdAt))}</time>
        </div>
      </header>
      <div class="user-announcement-body">
        <h3>${escapeHtml(item.title || '[CẬP NHẬT]')}</h3>
        <p>*${escapeHtml(item.category || 'Thông báo')}</p>
        <ul>
          ${(item.body || []).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>
      </div>
      <footer class="user-announcement-actions">
        <button type="button">♡ Like</button>
        <button type="button">◌ Comment</button>
        <button type="button">↗ Share</button>
        <span class="user-announcement-pulse">Đang cập nhật</span>
      </footer>
      <div class="user-announcement-comment">
        <img src="${escapeHtml(getUserAvatarPath(state.profile || {}))}" alt="" loading="lazy">
        <span>Write a comment...</span>
      </div>
    </article>
  `).join('');
}

function renderAccountProfileSection() {
  return `
    <section class="user-account-page">
      <div class="user-account-main">
        <div class="account-tabs" role="tablist" aria-label="Tài khoản của tôi">
          <button class="account-tab active" type="button" role="tab" aria-selected="true" data-account-tab="profile">${accountIcon('user')}<span>Thông tin tài khoản</span></button>
          <button class="account-tab" type="button" role="tab" aria-selected="false" data-account-tab="security">${accountIcon('shield')}<span>Bảo mật</span></button>
          <button class="account-tab" type="button" role="tab" aria-selected="false" data-account-tab="password">${accountIcon('lock')}<span>Đổi mật khẩu</span></button>
        </div>
        <div class="dash-card account-info-card" data-account-panel="profile">
          <div class="dash-card-header">
            <h3><span class="account-heading-icon" aria-hidden="true">${accountIcon('id')}</span>Thông tin tài khoản</h3>
            <span class="status-pill" id="user-account-status">Đang tải</span>
          </div>
          <form id="user-profile-form" class="account-profile-form">
            <label class="form-group">
              <span>${accountIcon('user')}Họ tên</span>
              <input class="form-control" name="displayName" autocomplete="name">
            </label>
            <label class="form-group">
              <span>${accountIcon('phone')}Số điện thoại</span>
              <input class="form-control" name="phone" type="tel" autocomplete="tel">
            </label>
            <label class="form-group">
              <span>${accountIcon('user')}Username</span>
              <input class="form-control" id="user-profile-username" autocomplete="username" readonly>
            </label>
            <label class="form-group">
              <span>${accountIcon('mail')}Email</span>
              <input class="form-control" name="email" type="email" autocomplete="email">
            </label>
            <label class="form-group">
              <span>${accountIcon('facebook')}FB liên kết TTC</span>
              <input class="form-control" id="user-ttc-facebook" value="Đang tải" readonly>
            </label>
            <label class="form-group">
              <span>${accountIcon('link')}FB liên kết Kiosk</span>
              <input class="form-control" id="user-kiosk-facebook" value="Đang tải" readonly>
            </label>
            <label class="form-group">
              <span>${accountIcon('calendar')}Ngày tham gia</span>
              <input class="form-control" id="user-profile-created" value="Đang tải" readonly>
            </label>
            <label class="form-group">
              <span>${accountIcon('badge')}Cấp bậc</span>
              <input class="form-control" value="Thành viên" readonly>
            </label>
            <div class="form-actions">
              <button class="btn-primary account-save-button" type="submit">${accountIcon('save')}<span>Lưu hồ sơ</span></button>
            </div>
          </form>
        </div>
        <div class="dash-card account-info-card" data-account-panel="security" hidden>
          <div class="dash-card-header">
            <h3><span class="account-heading-icon" aria-hidden="true">${accountIcon('shield')}</span>Bảo mật</h3>
            <button class="table-action-button" type="button" data-user-mfa-open>Quản lý Authenticator</button>
          </div>
          <div class="account-security-list">
            <div class="account-security-row primary-security-row">
              <span>${accountIcon('shield')}Authenticator</span>
              <div>
                <strong id="user-mfa-summary">Đang tải</strong>
                <small>Bảo vệ đăng nhập bằng mã 6 số từ ứng dụng xác thực.</small>
              </div>
              <em class="status-pill" id="user-mfa-status-pill">Đang tải</em>
            </div>
            <div class="account-security-row">
              <span>${accountIcon('mail')}Phương thức đăng nhập</span>
              <strong>Username / SĐT / Email và mật khẩu</strong>
            </div>
            <div class="account-security-row">
              <span>${accountIcon('shield')}Trạng thái tài khoản</span>
              <strong id="user-security-status">Đang tải</strong>
            </div>
            <div class="account-security-row">
              <span>${accountIcon('calendar')}Ngày tạo tài khoản</span>
              <strong id="user-security-created">Đang tải</strong>
            </div>
          </div>
        </div>
        <div class="dash-card account-info-card" data-account-panel="password" hidden>
          <div class="dash-card-header">
            <h3><span class="account-heading-icon" aria-hidden="true">${accountIcon('lock')}</span>Đổi mật khẩu</h3>
          </div>
          <form id="user-password-form" class="account-profile-form">
            <label class="form-group">
              <span>${accountIcon('lock')}Mật khẩu mới</span>
              <input class="form-control" name="password" type="password" minlength="6" autocomplete="new-password" required>
            </label>
            <label class="form-group">
              <span>${accountIcon('lock')}Nhập lại mật khẩu</span>
              <input class="form-control" name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required>
            </label>
            <div class="form-actions">
              <button class="btn-primary account-save-button" type="submit">${accountIcon('save')}<span>Lưu mật khẩu</span></button>
            </div>
          </form>
        </div>
      </div>
      <aside class="account-summary-card" id="user-account-summary">
        ${renderAccountSummary()}
      </aside>
    </section>
  `;
}

function bindAccountTabs() {
  document.querySelector('.account-tabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-account-tab]');
    if (!tab) return;
    const activeTab = tab.dataset.accountTab || 'profile';
    document.querySelectorAll('[data-account-tab]').forEach((button) => {
      const active = button.dataset.accountTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-account-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.accountPanel !== activeTab;
    });
    if (activeTab === 'security') loadUserMfaSummary();
  });
}

function bindAccountSecurityActions() {
  document.querySelector('[data-user-mfa-open]')?.addEventListener('click', openUserMfaModal);
}

function bindAccountPasswordForm() {
  document.getElementById('user-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.elements.password.value;
    const confirmPassword = form.elements.confirmPassword.value;
    if (password.length < 6) {
      Toast.show('Mật khẩu cần ít nhất 6 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      Toast.show('Xác nhận mật khẩu chưa khớp.');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Đang lưu...';
    try {
      await AuthService.updatePassword(password);
      form.reset();
      Toast.show('Đã đổi mật khẩu.');
    } catch (error) {
      Toast.show(error?.message || 'Không đổi được mật khẩu.');
    } finally {
      button.disabled = false;
      button.textContent = 'Lưu mật khẩu';
    }
  });
}

async function loadUserMfaSummary() {
  const summary = document.getElementById('user-mfa-summary');
  const pill = document.getElementById('user-mfa-status-pill');
  if (!summary && !pill) return;
  try {
    const factors = await AuthService.listMfaFactors();
    const totpFactors = Array.isArray(factors?.totp) ? factors.totp : [];
    const verifiedFactors = totpFactors.filter((factor) => factor.status === 'verified');
    if (summary) summary.textContent = verifiedFactors.length ? `${verifiedFactors.length} thiết bị đã bật` : 'Chưa bật Authenticator';
    if (pill) {
      pill.textContent = verifiedFactors.length ? 'Đang bật' : 'Chưa bật';
      pill.className = `status-pill ${verifiedFactors.length ? 'success' : 'warning'}`;
    }
  } catch (error) {
    if (summary) summary.textContent = error?.message || 'Chưa đọc được Authenticator';
    if (pill) {
      pill.textContent = 'Chưa sẵn sàng';
      pill.className = 'status-pill warning';
    }
  }
}

async function openUserMfaModal() {
  Modal.open({
    title: 'Authenticator',
    body: '<div class="modal-loading">Đang đọc trạng thái Authenticator...</div>',
  });
  try {
    await renderUserMfaStatus();
  } catch (error) {
    renderUserMfaError(error);
  }
}

async function renderUserMfaStatus() {
  const factors = await AuthService.listMfaFactors();
  const totpFactors = Array.isArray(factors?.totp) ? factors.totp : [];
  const verifiedFactors = totpFactors.filter((factor) => factor.status === 'verified');
  const unverifiedFactors = totpFactors.filter((factor) => factor.status !== 'verified');
  if (verifiedFactors.length) {
    Modal.open({
      title: 'Authenticator',
      body: `
        <div class="admin-security-panel">
          <div class="admin-security-state success">
            <strong>Authenticator đang bật</strong>
            <span>${escapeHtml(verifiedFactors.length)} thiết bị đã xác minh.</span>
          </div>
          <div class="admin-security-list">
            ${verifiedFactors.map((factor) => `
              <div class="admin-security-device">
                <div>
                  <strong>${escapeHtml(factor.friendly_name || factor.factor_type || 'Authenticator')}</strong>
                  <span>${escapeHtml(factor.created_at ? `Tạo lúc ${formatDateTimeSafe(factor.created_at)}` : 'Thiết bị TOTP')}</span>
                </div>
                <button class="table-action-button danger-action" type="button" data-user-mfa-unenroll="${escapeHtml(factor.id)}">Gỡ</button>
              </div>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" type="button" data-user-mfa-enroll>Thêm thiết bị</button>
            <button class="btn-primary" type="button" data-user-mfa-close>Hoàn tất</button>
          </div>
        </div>
      `,
    });
    bindUserMfaStatusEvents();
    return;
  }
  if (unverifiedFactors.length) {
    renderUserMfaEnrollment(unverifiedFactors[0]);
    return;
  }
  Modal.open({
    title: 'Authenticator',
    body: `
      <div class="admin-security-panel">
        <div class="admin-security-state">
          <strong>Chưa bật Authenticator</strong>
          <span>Quét QR bằng Google Authenticator, Authy hoặc ứng dụng tương tự rồi nhập mã 6 số để bật bảo vệ đăng nhập.</span>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-user-mfa-close>Để sau</button>
          <button class="btn-primary" type="button" data-user-mfa-enroll>Bật Authenticator</button>
        </div>
      </div>
    `,
  });
  bindUserMfaStatusEvents();
}

function bindUserMfaStatusEvents() {
  document.querySelector('[data-user-mfa-close]')?.addEventListener('click', () => {
    Modal.close();
    loadUserMfaSummary();
  });
  document.querySelector('[data-user-mfa-enroll]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Đang tạo...';
    try {
      const factor = await AuthService.enrollTotpMfa({ friendlyName: 'DHL User Authenticator' });
      renderUserMfaEnrollment(factor);
    } catch (error) {
      renderUserMfaError(error);
    }
  });
  document.querySelectorAll('[data-user-mfa-unenroll]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const currentButton = event.currentTarget;
      currentButton.disabled = true;
      currentButton.textContent = 'Đang gỡ...';
      try {
        await AuthService.unenrollMfaFactor(currentButton.dataset.userMfaUnenroll);
        Toast.show('Đã gỡ thiết bị Authenticator.');
        await renderUserMfaStatus();
        await loadUserMfaSummary();
      } catch (error) {
        currentButton.disabled = false;
        currentButton.textContent = 'Gỡ';
        Toast.show(error?.message || 'Không gỡ được Authenticator.');
      }
    });
  });
}

function renderUserMfaEnrollment(factor) {
  const totp = factor?.totp || {};
  const factorId = factor?.id || factor?.factorId || '';
  const qrCode = qrCodeImageSource(totp.qr_code || totp.qrCode || '');
  const secret = totp.secret || '';
  Modal.open({
    title: 'Cài Authenticator',
    body: `
      <form id="user-mfa-verify-form" class="modal-form">
        <div class="admin-mfa-setup">
          ${qrCode ? `<img class="admin-mfa-qr" src="${escapeHtml(qrCode)}" alt="QR Authenticator">` : ''}
          <div>
            <p class="modal-note">Quét QR bằng ứng dụng Authenticator, sau đó nhập mã 6 số để hoàn tất.</p>
            ${secret ? `
              <label class="form-group">
                <span>Mã secret dự phòng</span>
                <input class="form-control" value="${escapeHtml(secret)}" readonly>
              </label>
            ` : ''}
          </div>
        </div>
        <label class="form-group">
          <span>Mã xác minh 6 số</span>
          <input class="form-control" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
        </label>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-user-mfa-back>Quay lại</button>
          <button class="btn-primary" type="submit">Xác minh</button>
        </div>
      </form>
    `,
  });
  document.querySelector('[data-user-mfa-back]')?.addEventListener('click', () => {
    renderUserMfaStatus().catch(renderUserMfaError);
  });
  document.getElementById('user-mfa-verify-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Đang xác minh...';
    try {
      await AuthService.verifyTotpMfa(factorId, form.elements.code.value);
      Toast.show('Đã bật Authenticator.');
      await renderUserMfaStatus();
      await loadUserMfaSummary();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Xác minh';
      Toast.show(error?.message || 'Mã Authenticator chưa đúng.');
    }
  });
}

function renderUserMfaError(error) {
  Modal.open({
    title: 'Authenticator',
    body: `
      <div class="admin-security-panel">
        <div class="admin-security-state warning">
          <strong>Chưa thể mở Authenticator</strong>
          <span>${escapeHtml(error?.message || 'Supabase MFA chưa sẵn sàng.')}</span>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" type="button" data-user-mfa-close>Đã hiểu</button>
        </div>
      </div>
    `,
  });
  document.querySelector('[data-user-mfa-close]')?.addEventListener('click', Modal.close);
}

function renderPayosReturnStatus() {
  const panel = document.getElementById('user-wallet-return-status');
  if (!panel) return;
  const params = readHashQueryParams();
  const status = String(params.get('status') || params.get('code') || '').toLowerCase();
  const hasPayosSignal = params.has('orderCode') || params.has('id') || params.has('status') || params.has('code');
  if (!hasPayosSignal) {
    panel.innerHTML = '';
    return;
  }

  const isCancelled = ['cancelled', 'cancel', 'canceled'].includes(status);
  panel.innerHTML = `
    <div class="notice ${isCancelled ? 'warning' : 'success'} wallet-return-notice">
      <strong>${isCancelled ? 'Thanh toán đã hủy' : 'Đang chờ ngân hàng xác nhận'}</strong>
      <span>${isCancelled
        ? 'Bạn có thể tạo lại link nạp xu khi cần.'
        : 'Mình đang làm mới ví và lịch sử giao dịch. Nếu webhook chưa về, số dư sẽ cập nhật sau vài giây.'}</span>
    </div>
  `;

  if (!isCancelled) startWalletPolling('payos-return');
}

async function loadWallet() {
  const panel = document.getElementById('user-wallet-panel');
  const hasSummary = Boolean(document.getElementById('user-account-summary'));
  if (!panel && !hasSummary) return;
  try {
    const { data } = await WalletService.getMyWallet();
    state.wallet = data || null;
    window.dispatchEvent(new CustomEvent('dhl-wallet-updated', {
      detail: { wallet: state.wallet },
    }));
    if (panel) panel.innerHTML = `
      <div class="stats-grid">
        <div><strong>${escapeHtml(String(data?.balance ?? 0))}</strong><br><span class="muted-text">Số dư hiện tại</span></div>
        <div><strong>${escapeHtml(String(data?.total_earned ?? 0))}</strong><br><span class="muted-text">Tổng kiếm được</span></div>
        <div><strong>${escapeHtml(String(data?.total_spent ?? 0))}</strong><br><span class="muted-text">Tổng đã dùng</span></div>
      </div>
    `;
    renderAccountSummaryIntoDom();
  } catch (error) {
    showMigrationNotice(error, 'cổng thành viên và ví xu');
    if (panel) panel.innerHTML = EmptyState({
      title: 'Chưa có ví xu',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('ví xu')
        : error?.message || 'Lưu hồ sơ để khởi tạo ví xu.',
    });
  }
}

async function loadCustomerLinks() {
  const panel = document.getElementById('user-kiosk-links');
  const needsAccountStatus = Boolean(document.getElementById('user-kiosk-facebook') || document.getElementById('user-account-summary'));
  if (!panel && !needsAccountStatus) return;
  try {
    const { data } = await UserProfileService.listMyCustomerLinks();
    state.customerLinks = data || [];
    renderCustomerLinks();
    renderAccountFacebookStatuses();
    renderAccountSummaryIntoDom();
  } catch (error) {
    showMigrationNotice(error, 'liên kết khách hàng/Kiosk');
    if (panel) panel.innerHTML = EmptyState({
      title: 'Không tải được Kiosk',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('liên kết khách hàng/Kiosk')
        : error?.message || 'Vui lòng thử lại sau.',
    });
  }
}

function renderCustomerLinks() {
  const panel = document.getElementById('user-kiosk-links');
  if (!panel) return;
  if (!state.customerLinks.length) {
    panel.innerHTML = EmptyState({
      title: 'Chưa liên kết Kiosk',
      message: 'Kiosk đăng ký public chưa tự tạo tài khoản web. Admin cần liên kết hồ sơ khách hàng với tài khoản này để hiển thị tại đây.',
    });
    return;
  }
  const links = filterCustomerLinks(state.customerLinks);
  if (!links.length) {
    panel.innerHTML = EmptyState({
      title: 'Không tìm thấy Kiosk',
      message: 'Thử tìm bằng tên Kiosk, khách hàng, Facebook ID hoặc trạng thái khác.',
    });
    return;
  }
  panel.innerHTML = links.map((link) => `
      <div class="recent-item">
        <div>
          <div class="expiring-name">${escapeHtml(link.kiosks?.facebook_name || link.customers?.facebook_name || 'Kiosk')}</div>
          <div class="expiring-date">FB ID: ${escapeHtml(link.kiosks?.facebook_id || '—')} · Khách hàng: ${escapeHtml(link.customers?.facebook_name || '—')}</div>
        </div>
        <span class="status-pill ${link.kiosks?.status === 'active' ? 'success' : ''}">${escapeHtml(link.kiosks?.status || '—')}</span>
      </div>
    `).join('');
}

async function loadMyPayments() {
  const panel = document.getElementById('user-payment-list');
  if (!panel) return;
  try {
    const { data: links } = await UserProfileService.listMyCustomerLinks();
    const customerIds = Array.from(new Set((links || [])
      .map((link) => link.customer_id)
      .filter(Boolean)));
    if (!customerIds.length) {
      state.payments = [];
      panel.innerHTML = EmptyState({
        title: 'Chưa có thanh toán được liên kết',
        message: 'Thanh toán Kiosk gắn với hồ sơ Khách hàng/Kiosk. Sau khi admin liên kết tài khoản web với khách hàng, lịch sử thanh toán riêng sẽ hiện tại đây.',
      });
      return;
    }

    const results = await Promise.allSettled(customerIds.map((customerId) => PaymentService.listByCustomer(customerId)));
    state.payments = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value?.data || [])
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    renderMyPayments();
  } catch (error) {
    showMigrationNotice(error, 'thanh toán của tôi');
    panel.innerHTML = EmptyState({
      title: 'Không tải được thanh toán',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('thanh toán của tôi')
        : error?.message || 'Vui lòng thử lại sau.',
    });
  }
}

function renderMyPayments() {
  const panel = document.getElementById('user-payment-list');
  if (!panel) return;
  if (!state.payments.length) {
    panel.innerHTML = EmptyState({
      title: 'Chưa có thanh toán',
      message: 'Các khoản đăng ký/gia hạn Kiosk của bạn sẽ hiển thị tại đây.',
    });
    return;
  }
  const payments = filterPayments(state.payments);
  if (!payments.length) {
    panel.innerHTML = EmptyState({
      title: 'Không tìm thấy thanh toán',
      message: 'Thử tìm bằng Kiosk, số tiền, trạng thái hoặc thời gian khác.',
    });
    return;
  }
  panel.innerHTML = payments.map((payment) => `
      <div class="recent-item">
        <div>
          <div class="expiring-name">${formatCurrency(payment.total_amount || 0)} · ${escapeHtml(payment.kiosks?.facebook_name || 'Kiosk')}</div>
          <div class="expiring-date">${formatDateTime(payment.created_at)} · ${Number(payment.months || 0)} tháng</div>
        </div>
        <span class="status-pill ${payment.payment_status === 'completed' ? 'success' : payment.payment_status === 'rejected' ? 'danger' : ''}">${escapeHtml(paymentStatusLabel(payment.payment_status))}</span>
      </div>
    `).join('');
}

async function loadWalletLedger() {
  const panel = document.getElementById('user-wallet-ledger');
  if (!panel) return;
  try {
    const { data } = await WalletService.getMyLedger({ page: 1, pageSize: 10 });
    state.walletLedger = data || [];
    renderWalletLedger();
  } catch (error) {
    showMigrationNotice(error, 'lịch sử ví xu');
    panel.innerHTML = EmptyState({
      title: 'Không tải được lịch sử ví',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('lịch sử ví')
        : error?.message || 'Vui lòng thử lại sau.',
    });
  }
}

function renderWalletLedger() {
  const panel = document.getElementById('user-wallet-ledger');
  if (!panel) return;
  if (!state.walletLedger.length) {
    panel.innerHTML = EmptyState({
      title: 'Chưa có giao dịch',
      message: 'Các lần cộng/trừ xu sẽ hiển thị tại đây.',
    });
    return;
  }
  const entries = filterWalletLedger(state.walletLedger);
  if (!entries.length) {
    panel.innerHTML = EmptyState({
      title: 'Không tìm thấy giao dịch',
      message: 'Thử tìm bằng mô tả, loại giao dịch hoặc số xu khác.',
    });
    return;
  }
  panel.innerHTML = `
    <div class="report-table-wrap wallet-ledger-table-wrap">
      <table class="data-table wallet-ledger-table">
        <thead>
          <tr>
            <th>Mã giao dịch</th>
            <th>Loại giao dịch</th>
            <th>Nội dung</th>
            <th>Liên quan</th>
            <th>Số xu</th>
            <th>Số dư trước</th>
            <th>Số dư sau</th>
            <th>Thời gian</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(renderWalletLedgerRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderWalletLedgerRow(entry) {
  const amount = Number(entry.amount || 0);
  const sign = amount > 0 ? '+' : '';
  const label = ledgerTransactionLabel(entry);
  return `
    <tr>
      <td class="tabular-cell">#${escapeHtml(String(entry.id || '—'))}</td>
      <td><span class="status-pill ${amount < 0 ? 'danger' : 'success'}">${escapeHtml(label)}</span></td>
      <td>${escapeHtml(entry.description || label)}</td>
      <td>${renderLedgerRelation(entry)}</td>
      <td class="tabular-cell ${amount < 0 ? 'wallet-negative' : 'wallet-positive'}">${sign}${escapeHtml(formatNumber(amount))}</td>
      <td class="tabular-cell">${escapeHtml(formatNumber(entry.balance_before ?? 0))}</td>
      <td class="tabular-cell">${escapeHtml(formatNumber(entry.balance_after ?? 0))}</td>
      <td>${formatDateTime(entry.created_at)}</td>
      <td>${escapeHtml(entry.reason || entry.metadata?.note || '—')}</td>
    </tr>
  `;
}

function renderLedgerRelation(entry) {
  const table = String(entry.related_table || '').trim();
  const id = String(entry.related_id || '').trim();
  if (!table || !id) return '—';
  if (table === 'ttc_campaigns') {
    return `<a class="link-button" href="#/ttc-campaigns?campaign=${escapeHtml(id)}">Xem chiến dịch #${escapeHtml(id)}</a>`;
  }
  if (table === 'ttc_tasks') return `Nhiệm vụ #${escapeHtml(id)}`;
  if (table === 'payos_orders') return `PayOS #${escapeHtml(id)}`;
  return `${escapeHtml(table)} #${escapeHtml(id)}`;
}

function bindFacebookForm() {
  document.getElementById('user-facebook-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const resolverRoot = form.querySelector('[data-facebook-id-resolver]');
    const values = Object.fromEntries(new FormData(form));
    const facebookId = String(values.facebookId || '').trim();
    const resolverState = resolverRoot?.dataset.resolverState || 'idle';
    const urlError = validateFacebookUrl(values.facebookUrlOriginal);
    if (urlError) {
      markFacebookFormError(resolverRoot, urlError);
      Toast.show(urlError);
      return;
    }
    if (facebookId && !/^\d+$/.test(facebookId)) {
      markFacebookFormError(resolverRoot, 'Facebook ID chỉ được chứa chữ số.');
      Toast.show('Facebook ID chỉ được chứa chữ số.');
      return;
    }
    const status = facebookId && resolverState === 'success'
      ? 'resolved'
      : resolverFailureStatus(resolverState);

    button.disabled = true;
    button.textContent = 'Đang lưu...';
    try {
      await UserProfileService.upsertMyFacebookAccount({
        facebookUrlOriginal: values.facebookUrlOriginal,
        facebookUrlNormalized: resolverRoot?.dataset.resolvedUrl || values.facebookUrlOriginal,
        facebookId: status === 'resolved' ? facebookId : '',
        facebookIdStatus: status,
        isPrimary: values.isPrimary === 'on',
        note: values.note,
        metadata: {
          facebook_name: resolverRoot?.dataset.resolvedName || '',
          resolver_state: resolverState,
          source: 'user_portal',
        },
      });
      Toast.show(status === 'resolved'
        ? 'Đã lưu Facebook ID.'
        : 'Đã lưu link Facebook để admin kiểm tra.');
      form.reset();
      await loadFacebookAccounts();
    } catch (error) {
      Toast.show(isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('lưu Facebook user portal')
        : error?.message || 'Không thể lưu Facebook.');
    } finally {
      button.disabled = false;
      button.textContent = 'Lưu Facebook';
    }
  });
}

function markFacebookFormError(resolverRoot, message) {
  const error = resolverRoot?.querySelector('[data-facebook-id-error]');
  const urlInput = resolverRoot?.querySelector('input[type="url"]');
  if (error) {
    error.textContent = message;
    error.classList.remove('hidden');
  }
  urlInput?.focus();
}

function bindWalletTopupForm() {
  const form = document.getElementById('wallet-topup-form');
  if (!form) return;
  bindCurrencyInput(form.elements.amount);

  form.querySelectorAll('[data-topup-amount]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = form.elements.amount;
      if (!input) return;
      input.value = formatVndNumber(button.dataset.topupAmount);
      input.focus();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const amount = parseCurrencyInput(new FormData(form).get('amount'));
    if (!Number.isInteger(amount) || amount <= 0) {
      Toast.show('Số tiền nạp phải là số nguyên dương.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Đang tạo...';
    try {
      const walletUserId = await resolveCurrentUserId();
      const { data } = await PayosService.createWalletTopup({
        walletUserId,
        amount,
        description: 'DHLTOPUP',
        returnUrl: buildPayosRouteUrl('#/ttc-wallet'),
        cancelUrl: buildPayosRouteUrl('#/ttc-wallet'),
      });
      showWalletPayosResult(amount, data);
      startWalletPolling('topup-created');
      form.reset();
    } catch (error) {
      Toast.show(isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('nạp xu')
        : error?.message || 'Không tạo được link nạp tiền.');
    } finally {
      button.disabled = false;
      button.textContent = 'Nạp tiền';
    }
  });
}

async function resolveCurrentUserId() {
  const { data: profile } = await UserProfileService.getCurrentAppProfile();
  if (profile?.user_id) return profile.user_id;
  const { data: createdProfile } = await UserProfileService.ensureMyProfile({
    metadata: { source: 'wallet_topup' },
  });
  if (createdProfile?.profile?.user_id) return createdProfile.profile.user_id;
  if (createdProfile?.user_id) return createdProfile.user_id;
  throw new Error('Không xác định được user hiện tại.');
}

async function loadFacebookAccounts() {
  const panel = document.getElementById('user-facebook-panel');
  const needsAccountStatus = Boolean(document.getElementById('user-ttc-facebook') || document.getElementById('user-account-summary'));
  if (!panel && !needsAccountStatus) return;
  try {
    const { data } = await UserProfileService.listMyFacebookAccounts();
    state.facebookAccounts = data || [];
    renderFacebookAccounts();
    renderAccountFacebookStatuses();
    renderAccountSummaryIntoDom();
    enrichFacebookAccountNames(state.facebookAccounts);
  } catch (error) {
    showMigrationNotice(error, 'Facebook user portal');
    if (panel) panel.innerHTML = EmptyState({
      title: 'Không tải được Facebook',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyFeatureMessage('Facebook user portal')
        : error?.message || 'Vui lòng thử lại sau.',
    });
  }
}

async function enrichFacebookAccountNames(accounts = []) {
  const targets = accounts
    .filter((account) => !getFacebookAccountName(account) && (account.facebook_url_normalized || account.facebook_url_original))
    .slice(0, 5);
  if (!targets.length) return;

  const results = await Promise.allSettled(targets.map(async (account) => {
    const resolved = await FacebookIdService.resolve(account.facebook_url_normalized || account.facebook_url_original);
    if (!resolved.facebookName) return false;
    if (account.facebook_id && resolved.facebookId !== account.facebook_id) return false;
    account.metadata = {
      ...(account.metadata || {}),
      facebook_name: resolved.facebookName,
    };
    if (!account.facebook_id) account.facebook_id = resolved.facebookId;
    return true;
  }));

  if (results.some((result) => result.status === 'fulfilled' && result.value)) {
    renderFacebookAccounts();
    renderAccountFacebookStatuses();
    renderAccountSummaryIntoDom();
  }
}

function renderAccountFacebookStatuses() {
  const ttcField = document.getElementById('user-ttc-facebook');
  const kioskField = document.getElementById('user-kiosk-facebook');
  if (ttcField) ttcField.value = facebookAccountStatusText(getPrimaryTtcFacebookAccount());
  if (kioskField) kioskField.value = kioskFacebookStatusText(getPrimaryKioskLink());
}

function renderAccountSummaryIntoDom() {
  const summary = document.getElementById('user-account-summary');
  if (!summary) return;
  summary.innerHTML = renderAccountSummary();
  renderAccountFacebookStatuses();
}

function renderAccountSummary() {
  const profile = state.profile || {};
  const wallet = state.wallet || profile.wallet || {};
  const displayName = profile.display_name || profile.username || 'Người dùng';
  const usernameLine = getProfileUsername(profile);
  const email = profile.email || '—';
  const avatarPath = getUserAvatarPath(profile);
  const status = profile.status === 'active' ? 'Hoạt động' : statusLabel(profile.status);
  return `
    <div class="account-summary-hero">
      <img class="account-summary-avatar" src="${escapeHtml(avatarPath)}" alt="" loading="lazy">
      <span class="account-summary-check" aria-hidden="true">✓</span>
      <h3>${escapeHtml(displayName)}</h3>
      <p>${escapeHtml(usernameLine)}</p>
      <p>Thành viên</p>
    </div>
    <div class="account-summary-metrics">
      ${accountMetric('Số dư hiện tại', `${formatNumber(wallet.balance)} xu`, 'wallet', 'wallet')}
      ${accountMetric('Tổng xu đã nhận', `${formatNumber(wallet.total_earned)} xu`, 'earned', 'coin')}
      ${accountMetric('Tổng xu đã dùng', `${formatNumber(wallet.total_spent)} xu`, 'spent', 'chart')}
    </div>
    <div class="account-summary-details">
      ${summaryRow('Email', email, 'mail')}
      ${summaryRow('Số điện thoại', profile.phone || '—', 'phone')}
      ${summaryRow('FB TTC', facebookAccountStatusText(getPrimaryTtcFacebookAccount()), 'facebook')}
      ${summaryRow('FB Kiosk', kioskFacebookStatusText(getPrimaryKioskLink()), 'link')}
      ${summaryRow('Ngày tham gia', formatDate(profile.created_at || profile.createdAt), 'calendar')}
      ${summaryRow('Trạng thái', status, 'badge')}
    </div>
  `;
}

function getPrimaryTtcFacebookAccount() {
  return state.facebookAccounts.find((account) => account.is_primary) || state.facebookAccounts[0] || null;
}

function getProfileUsername(profile = {}) {
  return profile.username
    || profile.metadata?.username
    || profile.metadata?.auth_username
    || profile.metadata?.login_username
    || 'Chưa cập nhật username';
}

function getPrimaryKioskLink() {
  return state.customerLinks.find((link) => link.status === 'approved')
    || state.customerLinks[0]
    || null;
}

function facebookAccountStatusText(account) {
  if (!account) return 'Chưa liên kết TTC';
  const value = account.facebook_id || account.facebook_url_normalized || account.facebook_url_original || '';
  const name = getFacebookAccountName(account);
  const status = facebookIdStatusLabel(account.facebook_id_status);
  if (!value) return 'Đang chờ xác minh TTC';
  return name ? `${name} * ${value} · ${status}` : `${value} · ${status}`;
}

function kioskFacebookStatusText(link) {
  if (!link) return 'Chưa liên kết Kiosk';
  const value = link.kiosks?.facebook_id
    || link.customers?.facebook_id
    || link.kiosks?.facebook_link
    || link.customers?.facebook_link
    || '';
  const name = link.kiosks?.facebook_name || link.customers?.facebook_name || 'Kiosk';
  return value ? `${value} · ${name}` : `${name} · chưa có FB ID`;
}

function accountMetric(label, value, tone, icon) {
  return `
    <div class="account-summary-metric metric-${tone}">
      <span><span class="account-metric-icon" aria-hidden="true">${accountIcon(icon)}</span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function summaryRow(label, value, icon) {
  return `
    <div class="account-summary-row">
      <span><span class="account-row-icon" aria-hidden="true">${accountIcon(icon)}</span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '—')}</strong>
    </div>
  `;
}

function statusLabel(status) {
  return {
    active: 'Hoạt động',
    pending_profile: 'Chờ bổ sung',
    locked: 'Đã khóa',
  }[status] || status || '—';
}

function renderFacebookAccounts() {
  const panel = document.getElementById('user-facebook-panel');
  if (!panel) return;
  if (!state.facebookAccounts.length) {
    panel.innerHTML = EmptyState({
      title: 'Chưa liên kết Facebook',
      message: 'Bước sau sẽ dùng resolver hiện có để lưu Facebook ID từ link.',
    });
    return;
  }
  const accounts = filterFacebookAccounts(state.facebookAccounts);
  if (!accounts.length) {
    panel.innerHTML = EmptyState({
      title: 'Không tìm thấy Facebook',
      message: 'Thử tìm bằng Facebook ID, link hoặc trạng thái khác.',
    });
    return;
  }
  panel.innerHTML = accounts.map((account) => {
    const facebookName = getFacebookAccountName(account);
    const facebookId = account.facebook_id || 'Chưa có ID';
    const accountTitle = facebookName ? `${facebookName} * ${facebookId}` : facebookId;
    return `
      <div class="recent-item">
        <div>
          <div class="expiring-name">${escapeHtml(accountTitle)}</div>
          <div class="expiring-date">${escapeHtml(account.facebook_url_normalized || account.facebook_url_original || '')}</div>
        </div>
        <span class="status-pill ${facebookIdStatusTone(account.facebook_id_status)}">${escapeHtml(facebookIdStatusLabel(account.facebook_id_status))}</span>
      </div>
    `;
  }).join('');
}

function getFacebookAccountName(account = {}) {
  return account.facebook_name
    || account.facebookName
    || account.name
    || account.metadata?.facebook_name
    || account.metadata?.facebookName
    || account.metadata?.name
    || facebookHandleFromUrl(account.facebook_url_normalized || account.facebook_url_original)
    || '';
}

function facebookHandleFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path || path === 'profile.php') return '';
    return decodeURIComponent(path.split('/')[0] || '').trim();
  } catch {
    return '';
  }
}

function facebookIdStatusLabel(status) {
  return {
    resolved: 'Đã lấy ID tự động',
    manual: 'Nhập thủ công',
    manual_verified: 'Đã xác minh',
    pending: 'Đang kiểm tra',
    failed: 'Cần kiểm tra lại',
    invalid_url: 'Link không hợp lệ',
    'invalid-url': 'Link không hợp lệ',
    not_found: 'Không tìm thấy ID',
    'not-found': 'Không tìm thấy ID',
    timeout: 'Hết thời gian kiểm tra',
    upstream_error: 'Chưa kiểm tra được',
    'upstream-error': 'Chưa kiểm tra được',
  }[status] || 'Đang kiểm tra';
}

function facebookIdStatusTone(status) {
  if (['resolved', 'manual_verified'].includes(status)) return 'success';
  if (['failed', 'invalid_url', 'invalid-url', 'not_found', 'not-found', 'upstream_error', 'upstream-error'].includes(status)) return 'danger';
  return '';
}

function resolverFailureStatus(state) {
  if (['invalid-url', 'not-found', 'timeout', 'upstream-error'].includes(state)) return 'failed';
  return 'pending';
}

function validateFacebookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Link Facebook là bắt buộc.';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const validHost = host === 'facebook.com'
      || host.endsWith('.facebook.com')
      || host === 'fb.com'
      || host.endsWith('.fb.com');
    if (!['http:', 'https:'].includes(url.protocol) || !validHost) {
      return 'URL phải thuộc tên miền Facebook hợp lệ.';
    }
  } catch {
    return 'Facebook URL không hợp lệ.';
  }
  return '';
}

function transactionLabel(type) {
  return {
    earn_task: 'Thưởng nhiệm vụ TTC',
    spend_campaign: 'Tạo tăng tương tác TTC',
    bonus_signup: 'Thưởng tài khoản',
    admin_adjustment: 'Điều chỉnh Admin',
    refund_campaign: 'Hoàn tăng tương tác TTC',
    spend_kiosk: 'Mua gói Kiosk',
    refund_kiosk: 'Hoàn gói Kiosk',
  }[type] || 'Giao dịch xu';
}

function ledgerTransactionLabel(entry = {}) {
  if (String(entry.related_table || '') === 'payos_orders') return 'Nạp xu PayOS';
  return transactionLabel(entry.transaction_type);
}

function paymentStatusLabel(status) {
  return {
    pending: 'Chờ thanh toán',
    completed: 'Hoàn thành',
    rejected: 'Từ chối',
    cancelled: 'Đã hủy',
  }[status] || status || 'Không rõ';
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function accountIcon(name) {
  const icons = {
    user: '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.6-4 3-6 7-6s6.4 2 7 6H5Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6l8-3Zm-1 12 5-5-1.4-1.4L11 12.2 9.4 10.6 8 12l3 3Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h2v10H5V10h2Zm2 0h6V8a3 3 0 0 0-6 0v2Z"/></svg>',
    id: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4V5Zm3 4h5v2H7V9Zm0 4h8v2H7v-2Zm10-4h-3v5h3V9Z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M7 3h10v18H7V3Zm2 2v14h6V5H9Zm2 11h2v1h-2v-1Z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4V6Zm2 2v.4l6 3.6 6-3.6V8H6Zm0 2.7V16h12v-5.3l-6 3.6-6-3.6Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><path d="M14 8h3V4h-3c-3 0-5 2-5 5v2H6v4h3v6h4v-6h3l1-4h-4V9c0-.6.4-1 1-1Z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><path d="M7 3h2v2h6V3h2v2h3v16H4V5h3V3Zm11 8H6v8h12v-8Z"/></svg>',
    badge: '<svg viewBox="0 0 24 24"><path d="M12 3 15 8l6 1-4.3 4.2 1 5.8L12 16.2 6.3 19l1-5.8L3 9l6-1 3-5Z"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 6h15v3h1v10H4V6Zm2 2v9h12v-6h-7V9h6V8H6Zm10 5h2v2h-2v-2Z"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4Zm-8 6.8c1.6 1.5 4.5 2.2 8 2.2s6.4-.8 8-2.2V14c0 2.2-3.6 4-8 4s-8-1.8-8-4v-3.2Zm0 5c1.6 1.5 4.5 2.2 8 2.2s6.4-.8 8-2.2V18c0 2.2-3.6 4-8 4s-8-1.8-8-4v-2.2Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M5 19V5h2v14H5Zm6 0V9h2v10h-2Zm6 0v-7h2v7h-2Z"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M5 4h12l2 2v14H5V4Zm2 2v12h10V8.5L14.5 6H14v5H8V6H7Zm3 0v3h2V6h-2Zm-1 8h6v2H9v-2Z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M8.5 13.5 7.1 12l-1.4 1.4a3 3 0 0 0 4.2 4.2l2.8-2.8a3 3 0 0 0 0-4.2l-1.4-1.4 1.4-1.4 1.4 1.4a5 5 0 0 1 0 7.1l-2.8 2.8a5 5 0 0 1-7.1-7.1l1.4-1.4 2.9 2.9Zm7-3L16.9 12l1.4-1.4a3 3 0 0 0-4.2-4.2l-2.8 2.8a3 3 0 0 0 0 4.2l1.4 1.4-1.4 1.4-1.4-1.4a5 5 0 0 1 0-7.1l2.8-2.8a5 5 0 0 1 7.1 7.1l-1.4 1.4-2.9-2.9Z"/></svg>',
  };
  return icons[name] || '';
}

function filterCustomerLinks(links) {
  const query = normalizeSearch(state.kioskSearchTerm);
  if (!query) return links;
  return links.filter((link) => [
    link.kiosks?.facebook_name,
    link.kiosks?.facebook_id,
    link.kiosks?.status,
    link.customers?.facebook_name,
    link.customer_id,
    link.kiosk_id,
  ].map(normalizeSearch).join(' ').includes(query));
}

function filterPayments(payments) {
  const query = normalizeSearch(state.paymentSearchTerm);
  if (!query) return payments;
  return payments.filter((payment) => [
    payment.id,
    payment.kiosks?.facebook_name,
    payment.total_amount,
    payment.months,
    payment.payment_status,
    paymentStatusLabel(payment.payment_status),
    payment.created_at,
  ].map(normalizeSearch).join(' ').includes(query));
}

function filterWalletLedger(entries) {
  const query = normalizeSearch(state.walletLedgerSearchTerm);
  if (!query) return entries;
  return entries.filter((entry) => [
    entry.id,
    entry.transaction_type,
    transactionLabel(entry.transaction_type),
    ledgerTransactionLabel(entry),
    entry.description,
    entry.reason,
    entry.related_table,
    entry.related_id,
    entry.amount,
    entry.balance_before,
    entry.balance_after,
    entry.metadata?.note,
    entry.created_at,
  ].map(normalizeSearch).join(' ').includes(query));
}

function filterFacebookAccounts(accounts) {
  const query = normalizeSearch(state.facebookSearchTerm);
  if (!query) return accounts;
  return accounts.filter((account) => [
    account.id,
    getFacebookAccountName(account),
    account.facebook_id,
    account.facebook_url_normalized,
    account.facebook_url_original,
    account.facebook_id_status,
    account.note,
  ].map(normalizeSearch).join(' ').includes(query));
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

function buildPayosRouteUrl(route) {
  return `${window.location.origin}${window.location.pathname}${route}`;
}

function showWalletPayosResult(amount, data = {}) {
  Modal.open({
    title: 'Nạp tiền',
    body: `
      <div class="approval-message">
        <p>Đã tạo yêu cầu nạp <strong>${formatCurrency(amount)}</strong>. Xu sẽ tự cộng vào ví sau khi ngân hàng xác nhận thanh toán.</p>
        ${PayosResultCard({
          amountLabel: formatCurrency(amount),
          accountName: data.accountName,
          accountNumber: data.accountNumber,
          bankName: data.bankName,
          bin: data.bin,
          checkoutUrl: data.checkoutUrl,
          description: data.description,
          orderCode: data.orderCode,
          paymentLinkId: data.paymentLinkId,
          qrCode: data.qrCode,
          note: 'Quét QR hoặc mở trang thanh toán. Sau khi thanh toán thành công, ví sẽ tự cập nhật trong vài giây.',
        })}
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-payos-close>Đóng</button>
      </div>
    `,
  });
  bindPayosCopyButtons(document);
  watchPayosPaymentStatus(document, {
    onPaid: () => {
      Toast.show('Đã nhận thanh toán. Ví đang được cập nhật.');
      Modal.close();
      loadWalletAndLedger();
      startWalletPolling('payos-paid');
    },
  });
  document.querySelector('[data-payos-close]')?.addEventListener('click', Modal.close);
}

function readHashQueryParams() {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams(window.location.search);
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function qrCodeImageSource(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:image')) return raw;
  if (raw.startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  return raw;
}

function formatDateTimeSafe(value) {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value || '');
  }
}

function showMigrationNotice(error, featureName) {
  if (!isMissingDatabaseFeatureError(error)) return;
  const notice = document.getElementById('user-portal-notice');
  if (!notice) return;
  notice.innerHTML = `
    <div class="notice warning">
      <strong>Chức năng đang được cập nhật</strong>
      <span>${escapeHtml(userFriendlyFeatureMessage(featureName))}</span>
    </div>
  `;
}

function userFriendlyFeatureMessage(featureName) {
  if (/payos|nạp xu|ví/i.test(String(featureName || ''))) {
    return 'Tính năng ví xu đang được đồng bộ. Vui lòng thử lại sau hoặc liên hệ admin để được hỗ trợ nạp xu.';
  }
  return 'Dữ liệu đang được đồng bộ. Vui lòng thử lại sau hoặc liên hệ admin nếu cần xử lý ngay.';
}
