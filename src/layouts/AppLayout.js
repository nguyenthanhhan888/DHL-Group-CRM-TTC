import { escapeHtml } from '../utils/html.js';
import { getUserAvatarPath } from '../utils/avatar.js';

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
          <button class="modal-close" type="button" data-modal-close aria-label="Đóng">✕</button>
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

function renderIcon(name) {
  const icon = (content) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`;
  const path = (d) => `<path d="${d}"/>`;
  const circle = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const rect = (x, y, width, height, rx = 2) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}"/>`;
  const icons = {
    home: icon(path('M4.5 10.6 12 4.5l7.5 6.1v8.2a1.7 1.7 0 0 1-1.7 1.7h-3.6v-6.1H9.8v6.1H6.2a1.7 1.7 0 0 1-1.7-1.7v-8.2Z')),
    dashboard: icon(`${rect(4, 4.5, 6.4, 6.4, 1.4)}${rect(13.6, 4.5, 6.4, 4.8, 1.4)}${rect(13.6, 12.5, 6.4, 7, 1.4)}${rect(4, 14, 6.4, 5.5, 1.4)}`),
    users: icon(`${path('M15.5 19.2c-.4-2.3-2-3.6-4.7-3.6s-4.3 1.3-4.8 3.6')}${circle(10.8, 9, 3.2)}${path('M18.8 18.6c-.2-1.8-1.2-3-3-3.6')}${path('M15.4 6.3a2.8 2.8 0 0 1 0 5.3')}`),
    store: icon(`${path('M5 10.4 6.1 5h11.8l1.1 5.4')}${path('M5 10.4a2.5 2.5 0 0 0 4.2 1.8 2.5 2.5 0 0 0 3.6 0 2.5 2.5 0 0 0 4.2 0 2.5 2.5 0 0 0 2-1.8')}${path('M6.5 13.2v6.3h11v-6.3')}${path('M9.2 19.5v-4.3h5.6v4.3')}`),
    plus: icon(path('M12 5v14M5 12h14')),
    check: icon(path('m5 12.7 4.2 4.1L19 7')),
    coin: icon(`${ellipse(12, 7.2, 7, 3.2)}${path('M5 7.2v5.2c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2V7.2')}${path('M5 12.5v4.3c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2v-4.3')}`),
    list: icon(path('M8 6.5h11M8 12h11M8 17.5h11M4.8 6.5h.1M4.8 12h.1M4.8 17.5h.1')),
    briefcase: icon(`${rect(4, 7.5, 16, 11.5, 2)}${path('M9.5 7.5V5.8h5v1.7M4 12h16M10.2 12v1.4h3.6V12')}`),
    report: icon(`${path('M6 4.5h9.2L18 7.3v12.2H6z')}${path('M14.8 4.5v3.1H18M9 16v-4M12 16V9.5M15 16v-2.5')}`),
    target: icon(`${circle(12, 12, 8)}${circle(12, 12, 4.5)}${circle(12, 12, 1.6)}`),
    boost: icon(`${path('M4 17.8 9 13l3.3 3.2L20 7.6')}${path('M15.4 7.4H20v4.6')}${path('M4 20h16')}`),
    'user-circle': icon(`${circle(12, 12, 8.5)}${circle(12, 9.8, 2.7)}${path('M7.3 18.1c.9-2.4 2.5-3.6 4.7-3.6s3.8 1.2 4.7 3.6')}`),
    wallet: icon(`${rect(4, 6.5, 16, 12, 2)}${path('M4 9.8h13.5A2.5 2.5 0 0 1 20 12.3v.2h-4.2a2.5 2.5 0 0 0 0 5H20')}${path('M16.2 14.8h.1')}`),
    sliders: icon(path('M5 7h8M17 7h2M5 12h2M11 12h8M5 17h8M17 17h2M13 5v4M7 10v4M13 15v4')),
    alert: icon(`${path('M12 4.2 21 19H3L12 4.2Z')}${path('M12 9.2v4.4M12 16.8h.1')}`),
    history: icon(`${path('M7.1 8H4.5V5.4')}${path('M5.2 12a6.8 6.8 0 1 0 1.9-4.7L4.5 9.9')}${path('M12 8.6v3.8l3 1.8')}`),
    facebook: icon(path('M14.5 8.2h2.3V4.8h-2.6c-2.8 0-4.4 1.7-4.4 4.6v2H7.2v3.4h2.6v5h3.6v-5h2.6l.6-3.4h-3.2V9.5c0-.8.4-1.3 1.1-1.3Z')),
    shield: icon(`${path('M12 3.8 19 6.5v5.2c0 4.2-2.6 7.3-7 8.6-4.4-1.3-7-4.4-7-8.6V6.5l7-2.7Z')}${path('m8.8 12.2 2.2 2.1 4.4-4.5')}`),
    settings: icon(path('M4.5 6.5h8M16.5 6.5h3M4.5 12h3M11.5 12h8M4.5 17.5h9M17.5 17.5h2M12.5 4.6v3.8M7.5 10.1v3.8M13.5 15.6v3.8')),
    support: icon(`${path('M5 13v-1a7 7 0 0 1 14 0v1')}${path('M5 13.2a2 2 0 0 0 2 2h1v-4H7a2 2 0 0 0-2 2ZM19 13.2a2 2 0 0 1-2 2h-1v-4h1a2 2 0 0 1 2 2Z')}${path('M16 17.5c-.8 1.3-2.1 2-4 2h-1.2')}`),
    moon: icon(path('M20 15.1A7.7 7.7 0 0 1 8.9 4.5 8.3 8.3 0 1 0 20 15.1Z')),
    sun: icon(`${circle(12, 12, 4)}${path('M12 3.5v2M12 18.5v2M5.6 5.6 7 7M17 17l1.4 1.4M3.5 12h2M18.5 12h2M5.6 18.4 7 17M17 7l1.4-1.4')}`),
    logout: icon(`${path('M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10')}${path('M14 8l4 4-4 4M18 12H9')}`),
    chevron: icon(path('m8 10 4 4 4-4')),
    menu: icon(path('M4.5 7h15M4.5 12h15M4.5 17h15')),
    thumb: icon(`${path('M7 10.5v9H4.5v-9H7Z')}${path('M7 10.5 11.4 4h1.2c1.1 0 1.8 1 1.5 2l-.8 3.1H18a2 2 0 0 1 2 2.3l-.9 5.3a3.4 3.4 0 0 1-3.4 2.8H7')}`),
    'user-plus': icon(`${circle(9.8, 8.8, 3.2)}${path('M4.5 19c.5-2.7 2.3-4.2 5.3-4.2 2.2 0 3.8.8 4.6 2.3')}${path('M18 10v6M15 13h6')}`),
    message: icon(`${path('M5 5.5h14v10.2H8.2L5 18.8V5.5Z')}${path('M8.5 9.4h7M8.5 12.3h4.8')}`),
    heart: icon(path('M12 20s-7-4.1-8.5-8.8A4.3 4.3 0 0 1 11 7.4L12 8.5l1-1.1a4.3 4.3 0 0 1 7.5 3.8C19 15.9 12 20 12 20Z')),
    share: icon(`${path('M12 15V4.5')}${path('m8.5 8 3.5-3.5L15.5 8')}${path('M5 12.5v5.8A1.7 1.7 0 0 0 6.7 20h10.6a1.7 1.7 0 0 0 1.7-1.7v-5.8')}`),
  };
  return icons[name] || escapeHtml(name || '');
}

function ellipse(cx, cy, rx, ry) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
}
