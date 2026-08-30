import { escapeHtml } from '../utils/html.js';
import { getUserAvatarPath } from '../utils/avatar.js';
import { renderIcon } from '../utils/icons.js';
import { PUBLIC_BRAND } from '../config/organization.js';
import { getThemeLogoPath } from '../utils/themeLogo.js';

export function AppLayout({ navSections, user }) {
  const displayName = user?.display_name || user?.username || 'Người dùng';
  const username = getAccountUsername(user);
  const roleLabel = getRoleLabel(user);
  const avatarPath = getUserAvatarPath(user);
  const isAdmin = user?.is_system_admin === true;
  const brandLogoPath = escapeHtml(getThemeLogoPath());
  const brandLogoLightPath = escapeHtml(PUBLIC_BRAND.assets.logoLight);
  const brandLogoDarkPath = escapeHtml(PUBLIC_BRAND.assets.logoDark);
  return `
    <div class="app-shell">
      <aside class="sidebar" data-sidebar>
        <div class="sidebar-logo">
          <div class="sidebar-brand-image-wrap" aria-label="Diễn Châu - À Đây Rồi (DHL)">
            <img class="sidebar-brand-image" src="${brandLogoPath}" data-theme-logo data-logo-light="${brandLogoLightPath}" data-logo-dark="${brandLogoDarkPath}" alt="" width="2172" height="724">
          </div>
        </div>
        <nav class="sidebar-nav" aria-label="Điều hướng chính">
          ${navSections.map(renderNavSection).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user-block">
            <img class="user-avatar" src="${escapeHtml(avatarPath)}" alt="" loading="lazy">
            <div class="sidebar-user-meta">
              <div class="user-name">${escapeHtml(displayName)}</div>
              <div class="user-username">${escapeHtml(username)}</div>
              <div class="user-role">${escapeHtml(roleLabel)}</div>
            </div>
          </div>
          <button class="logout-button" type="button" data-logout aria-label="Đăng xuất">
            <span class="nav-icon logout-icon" aria-hidden="true">${renderIcon('logout')}</span><span class="logout-label">Đăng xuất</span>
          </button>
        </div>
      </aside>
      <button class="sidebar-overlay" type="button" data-sidebar-overlay aria-label="Đóng menu" tabindex="-1"></button>

      <main class="main-content">
        <header class="top-bar">
          <div class="top-bar-left">
            <button class="icon-button" type="button" data-menu-toggle aria-label="Mở menu" aria-expanded="false">
              <span class="nav-icon bare-icon" aria-hidden="true">${renderIcon('menu')}</span>
            </button>
            <img class="top-brand-mark" src="${brandLogoPath}" data-theme-logo data-logo-light="${brandLogoLightPath}" data-logo-dark="${brandLogoDarkPath}" alt="Diễn Châu - À Đây Rồi (DHL)" width="2172" height="724" loading="lazy">
            <span class="top-bar-context">Diễn Châu - À Đây Rồi (DHL)</span>
          </div>
          ${isAdmin
            ? renderAdminTopbar({ displayName, username, roleLabel, avatarPath })
            : renderUserTopbar({ displayName, username, roleLabel, avatarPath, permissions: user?.permissions || [] })}
        </header>
        <div class="page-content" data-route-outlet></div>
      </main>
    </div>

    <div class="modal-overlay hidden" data-modal-overlay>
      <div class="modal" data-modal role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
        <div class="modal-header">
          <h3 id="app-modal-title" data-modal-title></h3>
          <button class="modal-close" type="button" data-modal-close aria-label="Đóng"><span aria-hidden="true">${renderIcon('x')}</span></button>
        </div>
        <div class="modal-body" data-modal-body></div>
      </div>
    </div>

    <div class="toast-container" data-toast-container aria-live="polite" aria-atomic="true"></div>
  `;
}

function getRoleLabel(user) {
  if (user?.is_system_admin) return 'System Admin';
  return user?.web_access_enabled ? 'Người dùng Web' : 'Thành viên';
}

function getAccountUsername(user) {
  return user?.username
    || user?.metadata?.username
    || user?.metadata?.auth_username
    || user?.metadata?.login_username
    || user?.email?.split('@')?.[0]
    || 'Chưa có username';
}

function renderAdminTopbar({ displayName, username, roleLabel, avatarPath }) {
  return `
        <div class="top-bar-right top-bar-user-actions">
          <span class="connection-badge" data-supabase-badge>Chưa kết nối dữ liệu</span>
          <span class="current-date" data-current-date></span>
          <details class="admin-notification-center"><summary class="top-icon-link" aria-label="Mở thông báo quản trị">${renderIcon('alert')}<span class="notification-count hidden" data-notification-count></span></summary><div class="admin-notification-popover"><header><strong>Việc cần chú ý</strong><button class="notification-mark-all" type="button" data-notification-mark-all>Đánh dấu tất cả đã đọc</button></header><div data-notification-list></div></div></details>
          <button class="top-icon-link theme-toggle-button" type="button" data-theme-toggle aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">
            ${renderIcon('moon')}
          </button>
          <details class="top-user-menu">
        <summary class="top-user-trigger" aria-label="Mở menu tài khoản admin">
          <img class="top-user-avatar" src="${escapeHtml(avatarPath)}" alt="" loading="lazy">
          <span class="top-user-chevron" aria-hidden="true">${renderIcon('chevron')}</span>
        </summary>
        <div class="top-user-dropdown">
          <div class="top-user-dropdown-head">
            <strong>${escapeHtml(displayName || username)}</strong>
            <span class="user-role-badge">${escapeHtml(roleLabel)}</span>
          </div>
          <button type="button" data-admin-change-password><span class="nav-icon" aria-hidden="true">${renderIcon('shield')}</span>Đổi mật khẩu</button>
          <button type="button" data-admin-mfa><span class="nav-icon" aria-hidden="true">${renderIcon('settings')}</span>Authenticator</button>
          <button type="button" data-logout><span class="nav-icon" aria-hidden="true">${renderIcon('logout')}</span>Đăng xuất</button>
        </div>
      </details>
    </div>
  `;
}

function renderUserTopbar({ displayName, username, roleLabel, avatarPath, permissions: grantedPermissions = [] }) {
  const permissions = new Set(grantedPermissions);
  return `
    <div class="top-bar-right top-bar-user-actions">
      <span class="current-date" data-current-date></span>
      <button class="top-icon-link theme-toggle-button" type="button" data-theme-toggle aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">
        ${renderIcon('moon')}
      </button>
      ${permissions.has('wallet') ? `<a class="top-wallet-pill" href="#/admin-ttc-wallets" aria-label="Mở ví xu">
        <span class="top-action-icon" aria-hidden="true">${renderIcon('wallet')}</span>
        <span data-topbar-wallet>-- xu</span>
      </a>` : ''}
      ${permissions.has('settings') ? `<a class="top-icon-link" href="#/settings" aria-label="Cài đặt hệ thống" title="Cài đặt hệ thống">
        ${renderIcon('settings')}
      </a>` : ''}
      <details class="top-user-menu">
        <summary class="top-user-trigger" aria-label="Mở menu tài khoản">
          <img class="top-user-avatar" src="${escapeHtml(avatarPath)}" alt="" loading="lazy">
          <span class="top-user-chevron" aria-hidden="true">${renderIcon('chevron')}</span>
        </summary>
        <div class="top-user-dropdown">
          <div class="top-user-dropdown-head">
            <strong>${escapeHtml(displayName || username)}</strong>
            <span class="user-role-badge">${escapeHtml(roleLabel)}</span>
          </div>
          ${permissions.has('settings') ? `<a href="#/settings"><span class="nav-icon" aria-hidden="true">${renderIcon('settings')}</span>Cài đặt</a>` : ''}
          ${permissions.has('wallet') ? `<a href="#/admin-ttc-wallets"><span class="nav-icon" aria-hidden="true">${renderIcon('wallet')}</span>Ví xu</a>` : ''}
          <button type="button" data-logout><span class="nav-icon" aria-hidden="true">${renderIcon('logout')}</span>Đăng xuất</button>
        </div>
      </details>
    </div>
  `;
}

function renderNavSection(section) {
  const sectionKey = section.label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (section.standalone) {
    return `<div class="nav-section nav-section-standalone" data-nav-section="${escapeHtml(sectionKey)}">${section.items.map(renderNavItem).join('')}</div>`;
  }
  if (section.collapsible) {
    return `
      <details class="nav-section nav-section-collapsible" data-nav-section="${escapeHtml(sectionKey)}" data-nav-section-collapsible>
        <summary class="nav-section-toggle" data-nav-section-toggle aria-expanded="false">
          <span>${escapeHtml(section.label)}</span>
          <span class="nav-section-chevron" aria-hidden="true">${renderIcon('chevron')}</span>
        </summary>
        <div class="nav-section-items"><div class="nav-section-items-inner">${section.items.map(renderNavItem).join('')}</div></div>
      </details>
    `;
  }
  return `<div class="nav-section" data-nav-section="${escapeHtml(sectionKey)}"><div class="nav-section-label">${escapeHtml(section.label)}</div>${section.items.map(renderNavItem).join('')}</div>`;
}

function renderNavItem(item) {
  if (item.children?.length) {
    return `
      <details class="nav-group" data-nav-group ${item.defaultOpen ? 'open' : ''}>
        <summary class="nav-group-toggle" data-nav-group-toggle>
          <span class="nav-icon" aria-hidden="true">${renderIcon(item.icon)}</span>
          <span>${escapeHtml(item.label)}</span>
          <span class="nav-chevron" aria-hidden="true">${renderIcon('chevron')}</span>
        </summary>
        <div class="nav-sublist">
          ${item.children.map((child) => renderNavItem({ ...child, subitem: true })).join('')}
        </div>
      </details>
    `;
  }
  return `
    <a href="#/${item.route}" class="nav-item ${item.subitem ? 'nav-subitem' : ''}" data-nav-route="${escapeHtml(item.route)}" ${item.matchRoute ? `data-nav-match-route="${escapeHtml(item.matchRoute)}"` : ''}>
      <span class="nav-icon" aria-hidden="true">${renderIcon(item.icon)}</span>
      <span>${escapeHtml(item.label)}</span>${item.route==='registration-requests'?'<span class="nav-count-badge hidden" data-registration-nav-count></span>':''}
    </a>
  `;
}

export { renderIcon };
