import { Modal } from './components/Modal.js';
import { Toast } from './components/Toast.js';
import { NAV_SECTIONS, PAGE_TITLES } from './constants/navigation.js';
import { PERMISSIONS, ROLES } from './constants/roles.js';
import { AppLayout } from './layouts/AppLayout.js';
import { createRouter } from './router/index.js';
import { getSupabaseStatus } from './supabase/client.js';
import { AuthService } from './services/AuthService.js';
import { PermissionService } from './services/PermissionService.js';
import { settingsService } from './services/SettingsService.js';
import { WalletService } from './services/WalletService.js';
import { formatToday } from './utils/date.js';
import { BusinessTypesPage } from './pages/BusinessTypesPage.js';
import { CategoriesPage } from './pages/CategoriesPage.js';
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
import { SettingsPage } from './pages/SettingsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegistrationRequestsPage } from './pages/RegistrationRequestsPage.js';
import { StaffPage } from './pages/StaffPage.js';
import { PermissionsPage } from './pages/PermissionsPage.js';
import { UserHomePage } from './pages/UserHomePage.js';
import { TtcPage } from './pages/TtcPage.js';
import { AdminTtcPage } from './pages/AdminTtcPage.js';

const routes = {
  dashboard: DashboardPage,
  customers: CustomersPage,
  'customer-detail': CustomerDetailPage,
  kiosks: KiosksPage,
  'kiosk-detail': KioskDetailPage,
  payments: PaymentsPage,
  'payment-detail': PaymentDetailPage,
  categories: CategoriesPage,
  'business-types': BusinessTypesPage,
  logs: LogsPage,
  settings: SettingsPage,
  reports: ReportsPage,
  'registration-requests': RegistrationRequestsPage,
  staff: StaffPage,
  permissions: PermissionsPage,
  'legacy-registration': LegacyRegistrationPage,
  register: RegisterPage,
  user: UserHomePage,
  'user-profile': UserHomePage,
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
  'admin-ttc-users': AdminTtcPage,
  'admin-ttc-wallets': AdminTtcPage,
  'admin-ttc-settings': AdminTtcPage,
  'admin-ttc-logs': AdminTtcPage,
};

const PUBLIC_REGISTRATION_ROUTES = new Set(['register', 'legacy-registration']);
const HIDDEN_WEB_ROUTES = new Set(['payments', 'staff', 'permissions']);

async function initApp() {
  const root = document.getElementById('app');
  if (!root) return;

  try {
    const session = await AuthService.initialize();
    const initialRoute = normalizePublicPathRoute() || getRouteName();

    if (PUBLIC_REGISTRATION_ROUTES.has(initialRoute)) {
      renderPublicRegistration(root, initialRoute);
      return;
    }

    if (!session) {
      renderLogin(root);
      return;
    }

    const profile = await AuthService.getCurrentProfile(session.user.id);
    if (!isProfileAllowed(profile)) {
      await AuthService.signOut();
      renderLogin(root, 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
      return;
    }

    if (profile.role === ROLES.REVIEWER) {
      profile.permissions = await PermissionService.getMyPermissions();
      profile.permissions = applyLocalPreviewPermissions(profile.permissions);
      if (!profile.permissions.length) {
        await AuthService.signOut();
        renderLogin(root, 'Tài khoản chưa được cấp quyền truy cập.');
        return;
      }
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
  const { role, permissions: userPermissions } = profile;
  let permissions;

  if (role === ROLES.REVIEWER) {
    permissions = {
      canAccess: (route) => {
        const allowedRoutes = new Set(userPermissions || []);
        return allowedRoutes.has(route);
      }
    };
  } else {
    permissions = PERMISSIONS[role] || PERMISSIONS[ROLES.FUTURE_CUSTOMER];
  }

  const canAccess = (route) => {
    if (route === 'not-found') return true;
    if (HIDDEN_WEB_ROUTES.has(String(route || '').split('?')[0])) return false;
    return permissions.canAccess(routePermission(route));
  };

  const getDefaultRoute = (role) => {
    if (role === ROLES.ADMIN) return 'dashboard';
    if (role === ROLES.REVIEWER) return firstAllowedRoute(userPermissions);
    if (role === ROLES.SUPPORT) return 'dashboard';
    if (role === ROLES.USER) return 'user';
    return 'register';
  };

  const defaultRoute = getDefaultRoute(role);

  window.addEventListener('hashchange', () => {
    if (PUBLIC_REGISTRATION_ROUTES.has(getRouteName())) {
      window.location.reload();
    }
  });

  if (getRouteName() === 'login') {
    window.location.hash = `#/${defaultRoute}`;
  } else if (!canAccess(getRouteName())) {
    window.location.hash = `#/${defaultRoute}`;
  }

  const getNavSections = (role) => {
    return NAV_SECTIONS
      .map((section) => ({
        ...section,
        items: filterNavItems(section.items, role, canAccess),
      }))
      .filter((section) => section.items.length);
  };

  const navSections = getNavSections(role);

  root.innerHTML = AppLayout({ navSections, user: profile });
  Modal.mount();
  Toast.mount();

  const sidebar = document.querySelector('[data-sidebar]');
  const outlet = document.querySelector('[data-route-outlet]');
  const pageTitle = document.querySelector('[data-page-title]');
  const currentDate = document.querySelector('[data-current-date]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const sidebarOverlay = document.querySelector('[data-sidebar-overlay]');
  const supabaseBadge = document.querySelector('[data-supabase-badge]');

  if (currentDate) currentDate.textContent = formatToday();
  updateSupabaseBadge(supabaseBadge);
  refreshTopbarWallet(profile);

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

  const setSidebarOpen = (isOpen) => {
    sidebar?.classList.toggle('open', isOpen);
    sidebarOverlay?.classList.toggle('open', isOpen);
    menuToggle?.setAttribute('aria-expanded', String(isOpen));
    menuToggle?.setAttribute('aria-label', isOpen ? 'Đóng menu' : 'Mở menu');
  };

  menuToggle?.addEventListener('click', () => setSidebarOpen(!sidebar?.classList.contains('open')));
  sidebarOverlay?.addEventListener('click', () => setSidebarOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
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
    onRouteChange(route) {
      pageTitle.textContent = PAGE_TITLES[route] || PAGE_TITLES.dashboard;
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

      if (freshProfile.role === ROLES.REVIEWER) {
        const freshPermissions = await PermissionService.getMyPermissions();
        userPermissions.splice(0, userPermissions.length, ...applyLocalPreviewPermissions(freshPermissions));
        if (!canAccess(getRouteName())) {
          window.location.hash = `#/${firstAllowedRoute(userPermissions)}`;
        }
      }
    } catch {
      // A transient refresh failure should not destroy the current UI. Protected
      // database/Edge operations still perform their own active-user checks.
    }
  }, 30_000);
}

function routePermission(route) {
  const routeName = String(route || '').split('?')[0];
  if (routeName && routeName !== route) return routePermission(routeName);
  if (route === 'admin/ttc') return 'admin-ttc';
  return {
    'customer-detail': 'customers',
    'kiosk-detail': 'kiosks',
    'payment-detail': 'payments',
    'payments-mine': 'user',
    'user-profile': 'user',
    'user-kiosks': 'user',
    'user-register-kiosk': 'user',
    'user-facebook': 'user',
    'ttc-earn': 'ttc',
    'ttc-campaign-create': 'ttc',
    'ttc-campaigns': 'ttc',
    'ttc-wallet': 'ttc',
    'ttc-wallet-history': 'ttc',
    'admin-ttc-campaigns': 'admin-ttc',
    'admin-ttc-announcements': 'admin-ttc',
    'admin-ttc-tasks': 'admin-ttc',
    'admin-ttc-users': 'admin-ttc',
    'admin-ttc-wallets': 'admin-ttc',
    'admin-ttc-settings': 'admin-ttc',
    'admin-ttc-logs': 'admin-ttc',
    admin: getRouteSubPath() === 'ttc' ? 'admin-ttc' : 'admin',
  }[route] || route;
}

function filterNavItems(items, role, canAccess) {
  return items
    .map((item) => {
      if (!item.roles || item.roles.includes(role)) {
        if (item.children?.length) {
          const children = filterNavItems(item.children, role, canAccess);
          return children.length ? { ...item, children } : null;
        }
        const permissionRoute = item.matchRoute || item.route;
        return permissionRoute && canAccess(permissionRoute) ? item : null;
      }
      return null;
    })
    .filter(Boolean);
}

function isProfileAllowed(profile) {
  if (!profile) return false;
  if (![ROLES.ADMIN, ROLES.REVIEWER, ROLES.USER].includes(profile.role)) return false;
  if (profile.role === ROLES.USER) return profile.status !== 'locked';
  return Boolean(profile.is_active);
}

function firstAllowedRoute(userPermissions = []) {
  const preferred = [
    'registration-requests',
    'dashboard',
    'customers',
    'kiosks',
    'admin-ttc',
    'ttc',
    'user',
    'reports',
    'logs',
  ];
  const route = preferred.find((item) => userPermissions.includes(item)) || userPermissions[0] || 'dashboard';
  return route === 'admin-ttc' ? 'admin/ttc' : route;
}

function applyLocalPreviewPermissions(permissions = []) {
  if (!isLocalPreviewHost()) return permissions;
  return Array.from(new Set(permissions || []));
}

function isLocalPreviewHost() {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
}

function normalizePublicPathRoute() {
  if (window.location.hash) return '';
  const pathRoute = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!PUBLIC_REGISTRATION_ROUTES.has(pathRoute)) return '';
  window.history.replaceState(null, '', `${window.location.origin}/#/${pathRoute}${window.location.search}`);
  return pathRoute;
}

function renderLogin(root, message = '') {
  if (getRouteName() !== 'login') window.location.hash = '#/login';
  root.innerHTML = LoginPage({ message });
  LoginPage.afterRender();
}

function renderPublicRegistration(root, route = 'register') {
  root.innerHTML = `
    <main class="public-shell">
      <div class="public-topbar">
        <div class="public-register-brand">
          <img src="logo/photo_2026-08-03_06-31-15.jpg" alt="DHL Group - Diễn Châu À Đây Rồi">
        </div>
        <a href="#/login" data-open-login>Đăng nhập quản trị</a>
      </div>
      <nav class="public-registration-tabs" aria-label="Chọn loại đăng ký">
        <a href="#/register" data-public-registration-route class="${route === 'register' ? 'active' : ''}" ${route === 'register' ? 'aria-current="page"' : ''}>Đăng ký mới</a>
        <a href="#/legacy-registration" data-public-registration-route class="${route === 'legacy-registration' ? 'active' : ''}" ${route === 'legacy-registration' ? 'aria-current="page"' : ''}>Bổ sung khách hàng cũ</a>
      </nav>
      <div class="public-content" data-route-outlet></div>
    </main>
    <div class="modal-overlay hidden" data-modal-overlay>
      <div class="modal" data-modal role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
        <div class="modal-header"><h3 id="app-modal-title" data-modal-title></h3><button class="modal-close" type="button" data-modal-close>✕</button></div>
        <div class="modal-body" data-modal-body></div>
      </div>
    </div>
    <div class="toast-container" data-toast-container aria-live="polite"></div>
  `;
  Modal.mount();
  Toast.mount();
  settingsService.getPublicSettings().catch(() => {
    // Registration remains usable; configured organization links are omitted.
  });
  root.querySelectorAll('[data-public-registration-route]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (link.classList.contains('active')) return;
      event.preventDefault();
      window.location.hash = link.getAttribute('href');
      window.location.reload();
    });
  });
  root.querySelector('[data-open-login]')?.addEventListener('click', (event) => {
    event.preventDefault();
    window.location.hash = '#/login';
    window.location.reload();
  });
  const outlet = root.querySelector('[data-route-outlet]');
  const page = route === 'legacy-registration' ? LegacyRegistrationPage : RegisterPage;
  outlet.innerHTML = page();
  page.afterRender();
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
    'kiosk-detail': 'kiosks',
    'payment-detail': 'payments',
    'payments-mine': 'payments-mine',
    'user-profile': 'user-profile',
    'user-kiosks': 'user-kiosks',
    'user-register-kiosk': 'user-register-kiosk',
    'user-facebook': 'user-facebook',
    'ttc-earn': 'ttc-earn',
    'ttc-campaign-create': 'ttc-campaign-create',
    'ttc-campaigns': 'ttc-campaigns',
    'ttc-wallet': 'ttc-wallet',
    'ttc-wallet-history': 'ttc-wallet-history',
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
    const active = hasQuery ? link.dataset.navRoute === currentFullRoute : navRoute === activeRoute;
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
  document.querySelectorAll('[data-nav-group]').forEach((group) => {
    const hasActiveChild = Boolean(group.querySelector('.nav-subitem.active'));
    group.classList.toggle('has-active-child', hasActiveChild);
    const toggle = group.querySelector('[data-nav-group-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', String(hasActiveChild || group.open));
    if (hasActiveChild) group.open = true;
  });
}

function updateSupabaseBadge(element) {
  if (!element) return;
  const status = getSupabaseStatus();
  element.textContent = status.configured ? 'Supabase sẵn sàng' : 'Chưa kết nối Supabase';
  element.classList.toggle('ready', status.configured);
}

async function refreshTopbarWallet(profile) {
  if (profile?.role !== ROLES.USER) return;
  const walletLabel = document.querySelector('[data-topbar-wallet]');
  if (!walletLabel) return;
  walletLabel.textContent = 'Đang tải';
  try {
    const { data } = await WalletService.getMyWallet();
    walletLabel.textContent = `${formatNumber(data?.balance ?? 0)} xu`;
  } catch {
    walletLabel.textContent = '0 xu';
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

document.addEventListener('DOMContentLoaded', initApp);
