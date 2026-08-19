import { escapeHtml } from '../utils/html.js';
import { getUserAvatarPath } from '../utils/avatar.js';
import { renderIcon } from '../utils/icons.js';

export function AppLayout({ navSections, user }) {
  const displayName = user?.display_name || user?.username || 'Người dùng';
  const username = getAccountUsername(user);
  const roleLabel = getRoleLabel(user?.role);
  const avatarPath = getUserAvatarPath(user);
  const isAdmin = user?.role === 'admin';
  return `
    <div class="app-shell">
      <aside class="sidebar" data-sidebar>
        <div class="sidebar-logo">
          <div class="sidebar-brand-image-wrap" aria-label="DHL Group">
            <img class="sidebar-brand-image" src="logo/photo_2026-08-03_06-31-15.jpg" alt="DHL Group">
            <div class="sidebar-brand-wordmark" aria-hidden="true">
              <span>DHL</span>
              <strong>DHL GROUP</strong>
            </div>
          </div>
          <div>
            <div class="sidebar-title">Diễn Châu - À Đây Rồi (DHL)</div>
            <div class="sidebar-sub">DHL Group</div>
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
            <img class="top-brand-mark" src="logo/photo_2026-08-03_06-31-15.jpg" alt="DHL Group" loading="lazy">
            <div class="page-title" data-page-title>Tổng quan</div>
          </div>
          ${isAdmin
            ? renderAdminTopbar({ displayName, username, roleLabel, avatarPath })
            : renderUserTopbar({ displayName, username, roleLabel, avatarPath })}
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

function getRoleLabel(role) {
  if (role === 'admin') return 'Quản trị viên';
  if (role === 'user') return 'Thành viên';
  return 'Thành viên';
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
          <span class="connection-badge" data-supabase-badge>Chưa kết nối Supabase</span>
          <span class="current-date" data-current-date></span>
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
            <strong>Admin</strong>
            <span>${escapeHtml(displayName)}</span>
            <span>${escapeHtml(username)}</span>
            <span>${escapeHtml(roleLabel)}</span>
          </div>
          <button type="button" data-admin-change-password><span class="nav-icon" aria-hidden="true">${renderIcon('shield')}</span>Đổi mật khẩu</button>
          <button type="button" data-admin-mfa><span class="nav-icon" aria-hidden="true">${renderIcon('settings')}</span>Authenticator</button>
          <button type="button" data-logout><span class="nav-icon" aria-hidden="true">${renderIcon('logout')}</span>Đăng xuất</button>
        </div>
      </details>
    </div>
  `;
}

function renderUserTopbar({ displayName, username, roleLabel, avatarPath }) {
  return `
    <div class="top-bar-right top-bar-user-actions">
      <button class="top-icon-link theme-toggle-button" type="button" data-theme-toggle aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">
        ${renderIcon('moon')}
      </button>
      <a class="top-wallet-pill" href="#/ttc-wallet" aria-label="Mở ví xu">
        <span class="top-action-icon" aria-hidden="true">${renderIcon('wallet')}</span>
        <span data-topbar-wallet>-- xu</span>
      </a>
      <a class="top-icon-link" href="#/user-facebook" aria-label="Tài khoản Facebook" title="Tài khoản Facebook">
        ${renderIcon('facebook')}
      </a>
      <a class="top-icon-link" href="#/user-profile" aria-label="Cài đặt tài khoản" title="Cài đặt tài khoản">
        ${renderIcon('settings')}
      </a>
      <details class="top-user-menu">
        <summary class="top-user-trigger" aria-label="Mở menu tài khoản">
          <img class="top-user-avatar" src="${escapeHtml(avatarPath)}" alt="" loading="lazy">
          <span class="top-user-chevron" aria-hidden="true">${renderIcon('chevron')}</span>
        </summary>
        <div class="top-user-dropdown">
          <div class="top-user-dropdown-head">
            <strong>${escapeHtml(username)}</strong>
            <span>${escapeHtml(displayName)}</span>
            <span>${escapeHtml(roleLabel)}</span>
          </div>
          <a href="#/user-profile"><span class="nav-icon" aria-hidden="true">${renderIcon('settings')}</span>Cài đặt</a>
          <a href="#/ttc-wallet"><span class="nav-icon" aria-hidden="true">${renderIcon('wallet')}</span>Ví xu</a>
          <a href="#/ttc-wallet-history"><span class="nav-icon" aria-hidden="true">${renderIcon('history')}</span>Lịch sử giao dịch</a>
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
  return `
    <div class="nav-section" data-nav-section="${escapeHtml(sectionKey)}">
      <div class="nav-section-label">${section.label}</div>
      ${section.items.map(renderNavItem).join('')}
    </div>
  `;
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
      <span>${escapeHtml(item.label)}</span>
    </a>
  `;
}

export { renderIcon };
