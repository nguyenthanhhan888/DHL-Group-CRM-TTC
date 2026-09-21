import { Modal } from './components/Modal.js';
import { Toast } from './components/Toast.js';
import { NAV_SECTIONS, PAGE_TITLES } from './constants/navigation.js';
import { PERMISSIONS, canAccessPermission, canAccessRoute } from './constants/permissions.js';
import { AppLayout, bindSidebarPresentation, syncNavigationGroups } from './layouts/AppLayout.js';
import { createRouter } from './router/index.js';
import { getSupabaseStatus } from './supabase/client.js';
import { AuthService } from './services/AuthService.js';
import { settingsService } from './services/SettingsService.js';
import { WalletService } from './services/WalletService.js';
import { AdminNotificationService } from './services/AdminNotificationService.js';
import { HomepageContentService } from './services/HomepageContentService.js';
import { formatToday } from './utils/date.js';
import { escapeHtml } from './utils/html.js';
import { renderIcon } from './utils/icons.js';
import { syncThemeLogos } from './utils/themeLogo.js';
import { BusinessTypesPage } from './pages/BusinessTypesPage.js';
import { CategoriesPage } from './pages/CategoriesPage.js';
import { PromotionsPage } from './pages/PromotionsPage.js';
import { CustomerDetailPage } from './pages/CustomerDetailPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { KioskDetailPage } from './pages/KioskDetailPage.js';
import { KiosksPage } from './pages/KiosksPage.js';
import { LegacyRegistrationPage } from './pages/LegacyRegistrationPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PaymentsPage } from './pages/PaymentsPage.js';
import { PaymentDetailPage } from './pages/PaymentDetailPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { HomepageContentPage } from './pages/HomepageContentPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { AccountRegisterPage } from './pages/AccountRegisterPage.js';
import { RegistrationRequestsPage } from './pages/RegistrationRequestsPage.js';
import { StaffPage } from './pages/StaffPage.js';
import { UserHomePage } from './pages/UserHomePage.js';
import { TtcPage } from './pages/TtcPage.js';
import { AdminTtcPage } from './pages/AdminTtcPage.js';
import { HomePage } from './pages/HomePage.js';
import { LookupPage } from './pages/LookupPage.js';
import { applyPublicHomepageContent, bindPublicLayout, PublicLayout } from './components/PublicLayout.js';

const routes = {
  dashboard: DashboardPage,
  customers: CustomersPage,
  'customer-detail': CustomerDetailPage,
  kiosks: KiosksPage,
  'kiosk-detail': KioskDetailPage,
  payments: PaymentsPage,
  'payment-detail': PaymentDetailPage,
  categories: CategoriesPage,
  promotions: PromotionsPage,
  'business-types': BusinessTypesPage,
  logs: LogsPage,
  settings: SettingsPage,
  'homepage-content': HomepageContentPage,
  reports: ReportsPage,
  expenses: ExpensesPage,
  'registration-requests': RegistrationRequestsPage,
  'user-management': StaffPage,
  staff: StaffPage,
  permissions: StaffPage,
  'legacy-registration': LegacyRegistrationPage,
  register: RegisterPage,
  user: UserHomePage,
  'user-profile': UserHomePage,
  'user-announcements': UserHomePage,
  'user-support': UserHomePage,
  'user-kiosks': UserHomePage,
  'user-register-kiosk': UserHomePage,
  'user-facebook': UserHomePage,
  'payments-mine': UserHomePage,
  ttc: TtcPage,
  'ttc-earn': TtcPage,
  'ttc-campaign-create': TtcPage,
  'ttc-campaigns': TtcPage,
  'ttc-wallet': UserHomePage,
  'ttc-wallet-history': UserHomePage,
  admin: AdminTtcPage,
  'admin-ttc-campaigns': AdminTtcPage,
  'admin-ttc-announcements': AdminTtcPage,
  'admin-ttc-tasks': AdminTtcPage,
  'admin-ttc-users': StaffPage,
  'admin-ttc-wallets': AdminTtcPage,
  'admin-ttc-settings': AdminTtcPage,
  'admin-ttc-logs': AdminTtcPage,
};

const PUBLIC_ROUTES = new Set(['home', 'register', 'legacy-registration', 'lookup', 'login', 'signup']);
const HIDDEN_WEB_ROUTES = new Set();
const THEME_STORAGE_KEY = 'dhlThemePreference';

async function initApp() {
  const root = document.getElementById('app');
  if (!root) return;
  applySavedTheme();

  try {
    const session = await AuthService.initialize();
    const initialRoute = normalizePublicPathRoute() || getRouteName() || 'home';

    if (PUBLIC_ROUTES.has(initialRoute)) {
      renderPublicSite(root, initialRoute);
      return;
    }

    if (!session) {
      renderLogin(root);
      return;
    }

    const mfaRequirement = await AuthService.getMfaRequirement();
    if (mfaRequirement.required) {
      renderLogin(root, 'Vui lòng xác minh Authenticator để vào hệ thống.');
      return;
    }

    const profile = await AuthService.getCurrentProfile(session.user.id);
    if (!isProfileAllowed(profile)) {
      await AuthService.signOut();
      renderLogin(root, 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
      return;
    }

    try {
      await settingsService.getPublicSettings();
    } catch {
      // Organization links remain unavailable if configuration cannot be loaded.
    }
    renderAuthenticatedApp(root, profile);
  } catch (error) {
    renderLogin(root, error?.message || 'Không thể khởi tạo phiên đăng nhập.');
  }
}

function renderAuthenticatedApp(root, profile) {
  const userPermissions = profile.permissions || [];

  const canAccess = (route) => {
    if (route === 'not-found') return true;
    if (HIDDEN_WEB_ROUTES.has(String(route || '').split('?')[0])) return false;
    return canAccessRoute(profile, normalizeRouteForPermission(route));
  };

  const defaultRoute = firstAllowedRoute(profile);

  window.addEventListener('hashchange', () => {
    if (PUBLIC_ROUTES.has(getRouteName())) {
      window.location.reload();
    }
  });

  if (['staff', 'permissions', 'admin-ttc-users'].includes(getRouteName())) {
    window.location.hash = '#/user-management';
  } else if (getRouteName() === 'login') {
    window.location.hash = `#/${defaultRoute}`;
  } else if (!canAccess(getRouteName())) {
    window.location.hash = `#/${defaultRoute}`;
  }

  const getNavSections = () => {
    return NAV_SECTIONS
      .map((section) => ({
        ...section,
        items: filterNavItems(section.items, profile, canAccess),
      }))
      .filter((section) => section.items.length);
  };

  const navSections = getNavSections();

  root.innerHTML = AppLayout({ navSections, user: profile });
  bindSidebarPresentation();
  Modal.mount();
  Toast.mount();

  const sidebar = document.querySelector('[data-sidebar]');
  const outlet = document.querySelector('[data-route-outlet]');
  const currentDate = document.querySelector('[data-current-date]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const sidebarOverlay = document.querySelector('[data-sidebar-overlay]');
  const notificationCenter = document.querySelector('.admin-notification-center');
  const supabaseBadge = document.querySelector('[data-supabase-badge]');

  if (currentDate) currentDate.textContent = formatToday();
  bindThemeToggle();
  updateSupabaseBadge(supabaseBadge);
  refreshTopbarWallet(profile);
  if (canAccessPermission(profile, PERMISSIONS.NOTIFICATIONS) || canAccessPermission(profile, PERMISSIONS.REGISTRATION_REQUESTS)) refreshAdminNotifications();
  window.addEventListener('dhl:actionable-registration-changed', refreshAdminNotifications);
  window.addEventListener('dhl-wallet-updated', (event) => {
    if (!canAccessPermission(profile, PERMISSIONS.WALLET)) return;
    const wallet = event?.detail?.wallet;
    if (wallet && Object.prototype.hasOwnProperty.call(wallet, 'balance')) {
      updateTopbarWalletLabel(wallet);
      return;
    }
    refreshTopbarWallet(profile, { showLoading: false });
  });

  const openLogoutModal = () => {
    Modal.open({
      title: 'Xác nhận đăng xuất',
      body: `
        <p>Bạn có chắc muốn kết thúc phiên làm việc hiện tại?</p>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-cancel-logout>Ở lại</button>
          <button class="btn-danger" type="button" data-confirm-logout>Đăng xuất</button>
        </div>
      `,
    });
    document.querySelector('[data-cancel-logout]')?.addEventListener('click', Modal.close);
    document.querySelector('[data-confirm-logout]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Đang đăng xuất...';
      try {
        await AuthService.signOut();
        window.location.hash = '#/login';
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Đăng xuất';
        Toast.show(error?.message || 'Không thể đăng xuất.');
      }
    });
  };

  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', openLogoutModal);
  });
  document.querySelector('[data-admin-change-password]')?.addEventListener('click', openAdminPasswordModal);
  document.querySelector('[data-admin-mfa]')?.addEventListener('click', openAdminMfaModal);

  function openAdminPasswordModal() {
    Modal.open({
      title: 'Đổi mật khẩu admin',
      body: `
        <form id="admin-self-password-form" class="modal-form">
          <p class="modal-note">Mật khẩu mới áp dụng cho chính tài khoản admin đang đăng nhập.</p>
          <label class="form-group">
            <span>Mật khẩu mới</span>
            <input class="form-control" name="password" type="password" minlength="6" autocomplete="new-password" required>
          </label>
          <label class="form-group">
            <span>Xác nhận mật khẩu</span>
            <input class="form-control" name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required>
          </label>
          <div class="modal-actions">
            <button class="btn-secondary" type="button" data-cancel-admin-password>Hủy</button>
            <button class="btn-primary" type="submit">Lưu mật khẩu</button>
          </div>
        </form>
      `,
    });
    document.querySelector('[data-cancel-admin-password]')?.addEventListener('click', Modal.close);
    document.getElementById('admin-self-password-form')?.addEventListener('submit', async (event) => {
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
        Modal.close();
        Toast.show('Đã đổi mật khẩu admin.');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Lưu mật khẩu';
        Toast.show(error?.message || 'Không đổi được mật khẩu.');
      }
    });
  }

  async function openAdminMfaModal() {
    Modal.open({
      title: 'Authenticator admin',
      body: '<div class="modal-loading">Đang đọc trạng thái Authenticator...</div>',
    });
    try {
      await renderAdminMfaStatus();
    } catch (error) {
      renderAdminMfaError(error);
    }
  }

  async function renderAdminMfaStatus() {
    const factors = await AuthService.listMfaFactors();
    const totpFactors = Array.isArray(factors?.totp) ? factors.totp : [];
    const verifiedFactors = totpFactors.filter((factor) => factor.status === 'verified');
    const unverifiedFactors = totpFactors.filter((factor) => factor.status !== 'verified');
    if (verifiedFactors.length) {
      Modal.open({
        title: 'Authenticator admin',
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
                  <button class="table-action-button danger-action" type="button" data-admin-mfa-unenroll="${escapeHtml(factor.id)}">Gỡ</button>
                </div>
              `).join('')}
            </div>
            <div class="modal-actions">
              <button class="btn-secondary" type="button" data-admin-mfa-enroll>Thêm thiết bị</button>
              <button class="btn-primary" type="button" data-admin-mfa-close>Hoàn tất</button>
            </div>
          </div>
        `,
      });
      bindAdminMfaStatusEvents();
      return;
    }
    if (unverifiedFactors.length) {
      await renderAdminMfaEnrollment(unverifiedFactors[0]);
      return;
    }
    Modal.open({
      title: 'Authenticator admin',
      body: `
        <div class="admin-security-panel">
          <div class="admin-security-state">
            <strong>Chưa bật Authenticator</strong>
            <span>Tạo mã QR, quét bằng Google Authenticator/Authy rồi nhập mã 6 số để xác minh.</span>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" type="button" data-admin-mfa-close>Để sau</button>
            <button class="btn-primary" type="button" data-admin-mfa-enroll>Bật Authenticator</button>
          </div>
        </div>
      `,
    });
    bindAdminMfaStatusEvents();
  }

  function bindAdminMfaStatusEvents() {
    document.querySelector('[data-admin-mfa-close]')?.addEventListener('click', Modal.close);
    document.querySelector('[data-admin-mfa-enroll]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Đang tạo...';
      try {
        const factor = await AuthService.enrollTotpMfa({ friendlyName: 'DHL Admin Authenticator' });
        renderAdminMfaEnrollment(factor);
      } catch (error) {
        renderAdminMfaError(error);
      }
    });
    document.querySelectorAll('[data-admin-mfa-unenroll]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const currentButton = event.currentTarget;
        currentButton.disabled = true;
        currentButton.textContent = 'Đang gỡ...';
        try {
          await AuthService.unenrollMfaFactor(currentButton.dataset.adminMfaUnenroll);
          Toast.show('Đã gỡ thiết bị Authenticator.');
          await renderAdminMfaStatus();
        } catch (error) {
          currentButton.disabled = false;
          currentButton.textContent = 'Gỡ';
          Toast.show(error?.message || 'Không gỡ được Authenticator.');
        }
      });
    });
  }

  function renderAdminMfaEnrollment(factor) {
    const totp = factor?.totp || {};
    const factorId = factor?.id || factor?.factorId || '';
    const qrCode = qrCodeImageSource(totp.qr_code || totp.qrCode || '');
    const secret = totp.secret || '';
    Modal.open({
      title: 'Cài Authenticator',
      body: `
        <form id="admin-mfa-verify-form" class="modal-form">
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
            <button class="btn-secondary" type="button" data-admin-mfa-back>Quay lại</button>
            <button class="btn-primary" type="submit">Xác minh</button>
          </div>
        </form>
      `,
    });
    document.querySelector('[data-admin-mfa-back]')?.addEventListener('click', () => {
      renderAdminMfaStatus().catch(renderAdminMfaError);
    });
    document.getElementById('admin-mfa-verify-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Đang xác minh...';
      try {
        await AuthService.verifyTotpMfa(factorId, form.elements.code.value);
        Toast.show('Đã bật Authenticator cho admin.');
        await renderAdminMfaStatus();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Xác minh';
        Toast.show(error?.message || 'Mã Authenticator chưa đúng.');
      }
    });
  }

  function renderAdminMfaError(error) {
    Modal.open({
      title: 'Authenticator admin',
      body: `
        <div class="admin-security-panel">
          <div class="admin-security-state warning">
            <strong>Chưa thể mở Authenticator</strong>
            <span>${escapeHtml(error?.message || 'Dịch vụ xác minh chưa sẵn sàng.')}</span>
          </div>
          <div class="modal-actions">
            <button class="btn-primary" type="button" data-admin-mfa-close>Đã hiểu</button>
          </div>
        </div>
      `,
    });
    document.querySelector('[data-admin-mfa-close]')?.addEventListener('click', Modal.close);
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

  const setSidebarOpen = (isOpen) => {
    sidebar?.classList.toggle('open', isOpen);
    sidebarOverlay?.classList.toggle('open', isOpen);
    menuToggle?.setAttribute('aria-expanded', String(isOpen));
    menuToggle?.setAttribute('aria-label', isOpen ? 'Đóng menu' : 'Mở menu');
  };

  menuToggle?.addEventListener('click', () => setSidebarOpen(!sidebar?.classList.contains('open')));
  sidebarOverlay?.addEventListener('click', () => setSidebarOpen(false));
  document.addEventListener('click', (event) => {
    if (notificationCenter?.open && !notificationCenter.contains(event.target)) notificationCenter.open = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (notificationCenter?.open) {
      notificationCenter.open = false;
      notificationCenter.querySelector('summary')?.focus();
      return;
    }
    if (sidebar?.classList.contains('open')) {
      setSidebarOpen(false);
      menuToggle?.focus();
      return;
    }
    Modal.close();
  });

  createRouter({
    outlet,
    routes,
    fallback: NotFoundPage,
    defaultRoute,
    canAccess,
    context: { profile },
    onRouteChange(route) {
      document.title = `${PAGE_TITLES[route] || PAGE_TITLES.dashboard} · DHL Group`;
      setActiveNavigation(route);
      if (window.innerWidth < 900) {
        setSidebarOpen(false);
      }
    },
  }).start();

  window.setInterval(async () => {
    try {
      const session = await AuthService.initialize();
      const freshProfile = session ? await AuthService.getCurrentProfile(session.user.id) : null;
      if (!isProfileAllowed(freshProfile)) {
        await AuthService.signOut();
        window.location.hash = '#/login';
        window.location.reload();
        return;
      }

      Object.assign(profile, freshProfile);
      userPermissions.splice(0, userPermissions.length, ...(freshProfile.permissions || []));
      profile.permissions = userPermissions;
      if (!canAccess(getRouteName())) {
        window.location.hash = `#/${firstAllowedRoute(profile)}`;
      }
    } catch {
      // A transient refresh failure should not destroy the current UI. Protected
      // database/Edge operations still perform their own active-user checks.
    }
  }, 30_000);
}

async function refreshAdminNotifications(){try{const data=await AdminNotificationService.getActionable();const items=[...data.items].sort((left,right)=>Date.parse(right.createdAt||0)-Date.parse(left.createdAt||0));const count=document.querySelector('[data-notification-count]');const navCount=document.querySelector('[data-registration-nav-count]');const list=document.querySelector('[data-notification-list]');const markAll=document.querySelector('[data-notification-mark-all]');if(count){count.textContent=String(data.unreadCount);count.classList.toggle('hidden',!data.unreadCount);}if(navCount){navCount.textContent=String(data.registrationCount);navCount.classList.toggle('hidden',!data.registrationCount);}if(markAll){markAll.disabled=!data.unreadCount;markAll.onclick=()=>{AdminNotificationService.markAllRead(items);refreshAdminNotifications();};}if(list){list.innerHTML=items.length?items.map(item=>`<a class="admin-notification-item is-${escapeHtml(item.tone)} ${item.read?'is-read':'is-unread'}" data-notification-id="${escapeHtml(item.id)}" href="${escapeHtml(item.href)}"><span aria-hidden="true">${renderIcon(item.icon)}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small><time>${escapeHtml(item.timeLabel)}</time></span></a>`).join(''):'<p class="admin-notification-empty">Mọi việc đã được xử lý.</p>';list.querySelectorAll('[data-notification-id]').forEach(item=>item.addEventListener('click',()=>{AdminNotificationService.markRead(item.dataset.notificationId);document.querySelector('.admin-notification-center')?.removeAttribute('open');}));}}catch{const list=document.querySelector('[data-notification-list]');if(list)list.innerHTML='<p class="admin-notification-empty">Không thể tải thông báo.</p>';}}

function applySavedTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  setTheme(savedTheme || 'light', { persist: false });
}

function bindThemeToggle() {
  const button = document.querySelector('[data-theme-toggle]');
  if (!button) return;
  updateThemeToggle(button);
  button.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    updateThemeToggle(button);
  });
}

function setTheme(theme, { persist = true } = {}) {
  const normalizedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;
  syncThemeLogos(normalizedTheme);
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
  window.dispatchEvent(new CustomEvent('dhl:themechange', { detail: { theme: normalizedTheme } }));
}

function updateThemeToggle(button) {
  const isLight = document.documentElement.dataset.theme === 'light';
  button.setAttribute('aria-label', isLight ? 'Đổi sang giao diện tối' : 'Đổi sang giao diện sáng');
  button.setAttribute('title', isLight ? 'Đổi sang giao diện tối' : 'Đổi sang giao diện sáng');
  button.innerHTML = isLight
    ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 15.1A7.7 7.7 0 0 1 8.9 4.5 8.3 8.3 0 1 0 20 15.1Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M5.6 5.6 7 7M17 17l1.4 1.4M3.5 12h2M18.5 12h2M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>';
}

function normalizeRouteForPermission(route) {
  const routeName = String(route || '').split('?')[0];
  if (routeName && routeName !== route) return normalizeRouteForPermission(routeName);
  if (route === 'admin/ttc') return 'admin';
  return route;
}

function filterNavItems(items, profile, canAccess) {
  return items
    .map((item) => {
      if (item.children?.length) {
        const children = filterNavItems(item.children, profile, canAccess);
        return children.length ? { ...item, children } : null;
      }
      if (item.permission) return canAccessPermission(profile, item.permission) ? item : null;
      return item.route && canAccess(item.route) ? item : null;
    })
    .filter(Boolean);
}

function isProfileAllowed(profile) {
  if (!profile) return false;
  return profile.status === 'active'
    && profile.web_access_enabled === true;
}

function firstAllowedRoute(profile) {
  const preferred = [
    'dashboard', 'reports', 'customers', 'customer-detail', 'kiosks', 'kiosk-detail',
    'registration-requests', 'payments', 'payment-detail', 'expenses', 'categories', 'business-types',
    'ttc', 'admin-ttc-campaigns', 'admin-ttc-announcements', 'admin-ttc-tasks',
    'admin-ttc-wallets', 'admin-ttc-settings', 'admin-ttc-logs', 'admin',
    'user-management', 'logs', 'settings', 'homepage-content', 'user',
  ];
  return preferred.find((route) => canAccessRoute(profile, route)) || 'user';
}

function normalizePublicPathRoute() {
  if (window.location.hash) return '';
  const pathRoute = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!PUBLIC_ROUTES.has(pathRoute)) return '';
  window.history.replaceState(null, '', `${window.location.origin}/#/${pathRoute}${window.location.search}`);
  return pathRoute;
}

function renderLogin(root, message = '') {
  renderPublicSite(root, 'login', message);
}

function renderPublicSite(root, requestedRoute = 'home', message = '') {
  const route = PUBLIC_ROUTES.has(requestedRoute) ? requestedRoute : 'home';
  const pages = { home: HomePage, register: RegisterPage, 'legacy-registration': LegacyRegistrationPage, lookup: LookupPage, login: LoginPage, signup: AccountRegisterPage };
  const page = pages[route];
  root.innerHTML = PublicLayout({ route, content: page({ message }) });
  bindPublicLayout(root);
  HomepageContentService.getPublic().then(({ content }) => applyPublicHomepageContent(content, root)).catch(() => {});
  Modal.mount();
  Toast.mount();
  settingsService.getPublicSettings().catch(() => {
    // Registration remains usable; configured organization links are omitted.
  });
  page.afterRender?.();
  window.addEventListener('hashchange', handlePublicHashChange, { once: true });
}

function handlePublicHashChange() {
  const route = getRouteName() || 'home';
  if (PUBLIC_ROUTES.has(route)) renderPublicSite(document.getElementById('app'), route);
  else window.location.reload();
}

function getRouteName() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return raw.split(/[/?]/)[0] || '';
}

function getRouteSubPath() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const path = raw.split('?')[0] || '';
  return path.split('/').slice(1).join('/');
}

function setActiveNavigation(route) {
  const currentFullRoute = window.location.hash.replace(/^#\/?/, '').split('&_ts=')[0] || route;
  const activeRoute = {
    'customer-detail': 'customers',
    'homepage-content': 'settings',
    'kiosk-detail': 'kiosks',
    'payment-detail': 'payments',
    'payments-mine': 'payments-mine',
    'user-profile': 'user-profile',
    'user-kiosks': 'user-kiosks',
    'user-register-kiosk': 'user-register-kiosk',
    'user-facebook': 'user-facebook',
    'ttc-earn': 'ttc',
    'ttc-campaign-create': 'ttc',
    'ttc-campaigns': 'ttc',
    'ttc-wallet': 'ttc',
    'ttc-wallet-history': 'ttc',
    'admin-ttc-campaigns': 'admin-ttc-campaigns',
    'admin-ttc-announcements': 'admin-ttc-announcements',
    'admin-ttc-tasks': 'admin-ttc-tasks',
    'admin-ttc-users': 'admin-ttc-users',
    'admin-ttc-wallets': 'admin-ttc-wallets',
    'admin-ttc-settings': 'admin-ttc-settings',
    'admin-ttc-logs': 'admin-ttc-logs',
    admin: getRouteSubPath() === 'ttc' ? 'admin/ttc' : 'admin',
  }[route] || route;

  document.querySelectorAll('[data-nav-route]').forEach((link) => {
    const navRoute = link.dataset.navMatchRoute || link.dataset.navRoute;
    const hasQuery = (link.dataset.navRoute || '').includes('?');
    const active = hasQuery ? link.dataset.navRoute === currentFullRoute : link.dataset.navRoute === activeRoute || navRoute === activeRoute;
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
  syncNavigationGroups();
}

function updateSupabaseBadge(element) {
  if (!element) return;
  const status = getSupabaseStatus();
  element.textContent = status.configured
    ? '● Hệ thống hoạt động bình thường'
    : '● Không thể kết nối dữ liệu';
  element.classList.toggle('ready', status.configured);
}

async function refreshTopbarWallet(profile, options = {}) {
  if (!canAccessPermission(profile, PERMISSIONS.WALLET)) return;
  const walletLabel = document.querySelector('[data-topbar-wallet]');
  if (!walletLabel) return;
  if (options.showLoading !== false) walletLabel.textContent = 'Đang tải';
  try {
    const { data } = await WalletService.getMyWallet();
    updateTopbarWalletLabel(data);
  } catch {
    walletLabel.textContent = '0 xu';
  }
}

function updateTopbarWalletLabel(wallet) {
  const walletLabel = document.querySelector('[data-topbar-wallet]');
  if (!walletLabel) return;
  walletLabel.textContent = `${formatNumber(wallet?.balance ?? 0)} xu`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

document.addEventListener('DOMContentLoaded', initApp);
