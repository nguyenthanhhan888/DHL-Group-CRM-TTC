import { escapeHtml } from '../utils/html.js';
import { getUserAvatarPath } from '../utils/avatar.js';

export function AppLayout({ navSections, user }) {
  const displayName = user?.display_name || user?.username || 'Người dùng';
  const roleLabel = getRoleLabel(user?.role);
  const avatarPath = getUserAvatarPath(user);
  const isAdmin = user?.role === 'admin';
  return `
    <div class="app-shell">
      <aside class="sidebar" data-sidebar>
        <div class="sidebar-logo">
          <div class="sidebar-brand-image-wrap" aria-label="DHL Group">
            <img class="sidebar-brand-image" src="logo/photo_2026-08-03_06-31-15.jpg" alt="DHL Group">
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
            <div class="page-title" data-page-title>Tổng quan</div>
          </div>
          ${isAdmin
            ? renderAdminTopbar()
            : renderUserTopbar({ displayName, roleLabel, avatarPath })}
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

function renderAdminTopbar() {
  return `
    <div class="top-bar-right">
      <span class="connection-badge" data-supabase-badge>Chưa kết nối Supabase</span>
      <span class="current-date" data-current-date></span>
    </div>
  `;
}

function renderUserTopbar({ displayName, roleLabel, avatarPath }) {
  return `
    <div class="top-bar-right top-bar-user-actions">
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
            <strong>Member</strong>
            <span>${escapeHtml(displayName)} · ${escapeHtml(roleLabel)}</span>
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
  const icons = {
    home: '<svg viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24"><path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M8.5 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7-1a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7ZM3 20c.5-3.5 2.4-5.4 5.5-5.4S13.5 16.5 14 20H3Zm10.2 0c.2-1.8-.4-3.4-1.3-4.6 1-.5 2.1-.8 3.6-.8 3 0 4.8 1.9 5.3 5.4h-7.6Z"/></svg>',
    store: '<svg viewBox="0 0 24 24"><path d="M5 4h14l1 6a3 3 0 0 1-4.9 2.3A3 3 0 0 1 12 13a3 3 0 0 1-3.1-.7A3 3 0 0 1 4 10l1-6Zm1 10h12v6H6v-6Zm3 2v4h6v-4H9Z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m9.2 16.6-4-4 1.5-1.5 2.5 2.5 8.1-8.1L18.8 7z"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4Zm-8 6.8c1.6 1.5 4.5 2.2 8 2.2s6.4-.8 8-2.2V14c0 2.2-3.6 4-8 4s-8-1.8-8-4v-3.2Zm0 5c1.6 1.5 4.5 2.2 8 2.2s6.4-.8 8-2.2V18c0 2.2-3.6 4-8 4s-8-1.8-8-4v-2.2Z"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M5 6h14v2H5V6Zm0 5h14v2H5v-2Zm0 5h14v2H5v-2Z"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24"><path d="M9 5h6l1 3h4v11H4V8h4l1-3Zm1.5 3h3l-.4-1h-2.2l-.4 1Z"/></svg>',
    report: '<svg viewBox="0 0 24 24"><path d="M5 4h12l2 2v14H5V4Zm4 12h2v-5H9v5Zm4 0h2V8h-2v8Z"/></svg>',
    target: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg>',
    boost: '<svg viewBox="0 0 24 24"><path d="M13 3h8v8h-2V6.4l-7.3 7.3-3-3L3.4 16 2 14.6l6.7-6.7 3 3L17.6 5H13V3Zm-9 15h16v2H4v-2Z"/></svg>',
    'user-circle': '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 5.2A6.8 6.8 0 0 0 12 19c1.9 0 3.6-.7 5-1.8-.8-1.9-2.5-3-5-3s-4.2 1.1-5 3Z"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 6h15v3h1v10H4V6Zm2 2v9h12v-6h-7V9h6V8H6Zm10 5h2v2h-2v-2Z"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M5 7h8v2H5V7Zm10-2h2v6h-2V5ZM5 15h3v2H5v-2Zm5-2h2v6h-2v-6Zm5 2h4v2h-4v-2Z"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><path d="M12 3 22 20H2L12 3Zm-1 6v5h2V9h-2Zm0 7v2h2v-2h-2Z"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.3 4H3l3.5-4L10 9H7.9A5 5 0 1 0 12 7V5Zm-1 3h2v4l3 2-1 1.7-4-2.4V8Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><path d="M14 8h3V4h-3c-3 0-5 2-5 5v2H6v4h3v6h4v-6h3l1-4h-4V9c0-.6.4-1 1-1Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6l8-3Zm-1 12 5-5-1.4-1.4L11 12.2 9.4 10.6 8 12l3 3Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M10.6 3h2.8l.5 2.2c.5.2 1 .4 1.4.8l2.1-1 2 2-1 2.1c.3.5.6.9.8 1.5l2.1.4v2.8l-2.1.5c-.2.5-.5 1-.8 1.4l1 2.1-2 2-2.1-1c-.5.3-.9.6-1.4.8l-.5 2.1h-2.8l-.5-2.1c-.5-.2-1-.5-1.4-.8l-2.1 1-2-2 1-2.1c-.3-.5-.6-.9-.8-1.4l-2.1-.5V12l2.1-.4c.2-.6.5-1 .8-1.5l-1-2.1 2-2 2.1 1c.5-.3.9-.6 1.4-.8l.5-2.2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>',
    logout: '<svg viewBox="0 0 24 24"><path d="M4 4h9v2H6v12h7v2H4V4Zm11 4 5 4-5 4v-3H9v-2h6V8Z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    thumb: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9h3Zm0 0 4-7h2l1 2-1 4h5.4c1 0 1.7.9 1.5 1.9l-1.1 5.8c-.2 1.3-1.3 2.3-2.7 2.3H7"/></svg>',
    'user-plus': '<svg viewBox="0 0 24 24"><path d="M15 19c-.5-2.8-2.2-4.2-5-4.2S5.5 16.2 5 19h10ZM10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-5v6m-3-3h6"/></svg>',
    message: '<svg viewBox="0 0 24 24"><path d="M5 5h14v10H8l-3 3V5Zm4 4h6m-6 3h4"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9-9a4.4 4.4 0 0 1 7.2-4.8L12 8l1.8-1.8A4.4 4.4 0 0 1 21 11c-2 4.6-9 9-9 9Z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M15 8h3a3 3 0 0 1 3 3v7H3v-7a3 3 0 0 1 3-3h3m3 6V3m0 0 4 4m-4-4L8 7"/></svg>',
  };
  return icons[name] || escapeHtml(name || '');
}
