import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Pagination, bindPagination, updatePagination } from '../components/Pagination.js';
import { Toast } from '../components/Toast.js';
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '../constants/permissions.js';
import { AuthService } from '../services/AuthService.js';
import { StaffService } from '../services/StaffService.js';
import { formatDateTime } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

const state = {
  users: [], actor: null, search: '', page: 1, pageSize: 25, total: 0,
  selectedUserId: '', activeTab: 'account', permissionCatalog: [],
  ledgerPage: 1, ledgerPageSize: 10, ledgerTotal: 0,
};

export function StaffPage() {
  return `
    ${PageHeader({
      title: 'Quản lý người dùng',
      description: 'Quản lý hồ sơ TTC, ví xu và quyền truy cập web theo từng tài khoản.',
    })}
    <div class="toolbar unified-users-toolbar">
      <label class="unified-user-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <input id="user-management-search" class="form-control" type="search" placeholder="Tìm username, họ tên, email hoặc số điện thoại" aria-label="Tìm người dùng" autocomplete="off">
      </label>
      <button id="reload-users-button" class="btn-secondary compact-button unified-users-reload" type="button">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"></path><path d="M20 4v7h-7"></path></svg>
        <span>Tải lại</span>
      </button>
    </div>
    <div class="table-card unified-users-table-card">
      <div class="report-table-wrap">
        <table class="data-table unified-users-table">
          <thead><tr><th>Người dùng</th><th>Liên hệ</th><th>TTC / Ví</th><th>Quyền Web</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Quản lý</th></tr></thead>
          <tbody id="user-management-body"><tr><td colspan="7">Đang tải người dùng...</td></tr></tbody>
        </table>
      </div>
      ${Pagination({ id: 'user-management', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: [10, 25, 50], noun: 'người dùng' })}
    </div>
  `;
}

StaffPage.afterRender = async function afterRenderStaff() {
  const search = document.getElementById('user-management-search');
  if (search) search.value = state.search;
  let searchTimer;
  search?.addEventListener('input', (event) => {
    state.search = event.currentTarget.value || '';
    state.page = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadUsers, 300);
  });
  document.getElementById('reload-users-button')?.addEventListener('click', loadUsers);
  document.getElementById('user-management-body')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-user-action]');
    if (!action) return;
    openUserDetail(action.dataset.userId, 'account');
  });
  bindPagination('user-management', {
    onPage(page) { state.page = page; loadUsers(); },
    onPageSize(pageSize) { state.page = 1; state.pageSize = pageSize; loadUsers(); },
  });
  try {
    const session = await AuthService.initialize();
    state.actor = session ? await AuthService.getCurrentProfile(session.user.id) : null;
  } catch {
    state.actor = null;
  }
  loadUsers();
};

async function loadUsers() {
  const body = document.getElementById('user-management-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7">Đang tải người dùng...</td></tr>';
  try {
    const result = await StaffService.list({ search: state.search, page: state.page, pageSize: state.pageSize });
    state.users = result.users || [];
    state.total = Number(result.total || 0);
    renderRows();
    updatePagination({ id: 'user-management', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: [10, 25, 50], noun: 'người dùng' });
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7">${escapeHtml(error?.message || 'Không tải được người dùng.')}</td></tr>`;
  }
}

function renderRows() {
  const body = document.getElementById('user-management-body');
  if (!body) return;
  if (!state.users.length) {
    body.innerHTML = `<tr><td colspan="7">${EmptyState({ title: 'Không tìm thấy người dùng', message: 'Thử từ khóa khác hoặc tải lại dữ liệu.' })}</td></tr>`;
    return;
  }
  body.innerHTML = state.users.map((user) => {
    const wallet = userWallet(user);
    return `
      <tr>
        <td data-label="Người dùng"><div class="unified-user-identity"><strong>${escapeHtml(user.display_name || 'Chưa có tên')}</strong><span>@${escapeHtml(user.username || '—')}</span></div></td>
        <td data-label="Liên hệ"><div class="unified-user-contact"><span>${escapeHtml(user.email || '—')}</span><small>${escapeHtml(user.phone || '—')}</small></div></td>
        <td data-label="TTC / Ví"><div class="unified-user-wallet"><strong>${formatNumber(wallet?.balance || 0)} xu</strong><small>${escapeHtml(tierLabel(user))} · Hạn mức ${formatNumber(creditLimit(user))}</small></div></td>
        <td data-label="Quyền Web">${webAccessSummary(user)}</td>
        <td data-label="Trạng thái">${statusBadge(user.status)}</td>
        <td data-label="Đăng nhập gần nhất">${escapeHtml(formatDateTime(user.last_sign_in_at) || 'Chưa đăng nhập')}</td>
        <td data-label="Quản lý">${rowActions(user)}</td>
      </tr>`;
  }).join('');
}

function rowActions(user) {
  return `<button class="btn-secondary compact-button unified-user-manage" type="button" data-user-action="detail" data-user-id="${escapeHtml(user.user_id)}">Quản lý</button>`;
}

async function openUserDetail(userId, tab = 'account') {
  state.selectedUserId = userId;
  state.activeTab = tab;
  state.ledgerPage = 1;
  Modal.open({ title: 'Chi tiết người dùng', className: 'modal-wide unified-user-modal', body: '<div class="modal-loading">Đang tải hồ sơ người dùng...</div>' });
  try {
    const result = await StaffService.detail(userId);
    state.permissionCatalog = result.permissionCatalog || [];
    renderUserDetail(result.user);
    if (tab === 'ledger') loadLedger(userId);
  } catch (error) {
    Modal.open({ title: 'Chi tiết người dùng', className: 'modal-wide unified-user-modal', body: EmptyState({ title: 'Không tải được hồ sơ', message: error?.message || 'Vui lòng thử lại.' }) });
  }
}

function renderUserDetail(user) {
  const canManageSecurity = state.actor?.is_system_admin === true && !user.is_system_admin;
  Modal.open({
    title: `Người dùng · ${user.username || user.display_name || '—'}`,
    className: 'modal-wide unified-user-modal',
    body: `
      <div class="unified-user-summary">
        <div><strong>${escapeHtml(user.display_name || 'Chưa có tên')}</strong><span>@${escapeHtml(user.username || '—')}</span></div>
        <div>${user.is_system_admin ? '<span class="status-pill success">System Admin · Toàn quyền hệ thống</span>' : webAccessBadge(user)} ${statusBadge(user.status)}</div>
      </div>
      <div class="unified-user-tabs" role="tablist">
        ${detailTab('account', 'Tài khoản')}${detailTab('ttc', 'TTC')}${detailTab('access', 'Quyền truy cập')}${detailTab('ledger', 'Giao dịch')}${detailTab('security', 'Bảo mật')}
      </div>
      <div class="unified-user-detail-content">
        ${state.activeTab === 'account' ? accountPanel(user) : ''}
        ${state.activeTab === 'ttc' ? ttcPanel(user, canManageSecurity) : ''}
        ${state.activeTab === 'access' ? accessPanel(user, canManageSecurity) : ''}
        ${state.activeTab === 'ledger' ? ledgerPanel(user) : ''}
        ${state.activeTab === 'security' ? securityPanel(user, canManageSecurity) : ''}
      </div>`,
  });
  bindDetailEvents(user);
}

function detailTab(value, label) {
  return `<button type="button" class="unified-user-tab ${state.activeTab === value ? 'active' : ''}" data-detail-tab="${value}" role="tab" aria-selected="${state.activeTab === value}">${label}</button>`;
}

function accountPanel(user) {
  return `
    <section class="user-detail-card">
      <div class="user-detail-card-head"><div><span>Tài khoản</span><h3>Thông tin liên hệ</h3></div><time>Đăng nhập gần nhất: ${escapeHtml(formatDateTime(user.last_sign_in_at) || 'Chưa có')}</time></div>
      <form id="user-account-form" class="modal-form user-detail-form">
        <label class="form-group"><span>Username</span><input class="form-control" value="${escapeHtml(user.username || '')}" readonly></label>
        <div class="form-row"><label class="form-group"><span>Họ tên</span><input class="form-control" name="displayName" maxlength="100" value="${escapeHtml(user.display_name || '')}"></label><label class="form-group"><span>Email</span><input class="form-control" name="email" type="email" value="${escapeHtml(user.email || '')}"></label></div>
        <div class="form-row"><label class="form-group"><span>Số điện thoại</span><input class="form-control" name="phone" value="${escapeHtml(user.phone || '')}"></label><label class="form-group"><span>Facebook ID</span><input class="form-control" name="facebookId" inputmode="numeric" value="${escapeHtml(primaryFacebookId(user))}"></label></div>
        <label class="form-group"><span>Lý do cập nhật</span><input class="form-control" name="reason" maxlength="500" placeholder="Ghi chú thay đổi"></label>
        <div class="modal-actions"><button class="btn-primary" type="submit">Lưu thông tin</button></div>
      </form>
    </section>`;
}

function ttcPanel(user, canManageSecurity) {
  const wallet = userWallet(user);
  return `
    <div class="user-detail-grid">
      <section class="user-detail-card">
        <div class="user-detail-card-head"><div><span>TTC</span><h3>Hồ sơ nghiệp vụ</h3></div></div>
        <form id="user-ttc-form" class="modal-form user-detail-form">
          <div class="user-detail-metrics"><div><span>Số dư</span><strong>${formatNumber(wallet?.balance || 0)} xu</strong></div><div><span>Tổng nhận</span><strong>${formatNumber(wallet?.total_earned || 0)}</strong></div><div><span>Tổng chi</span><strong>${formatNumber(wallet?.total_spent || 0)}</strong></div></div>
          <div class="form-row"><label class="form-group"><span>Cấp bậc TTC</span><select class="form-control" name="tier">${tierOptions(user)}</select></label><label class="form-group"><span>Hạn mức</span><input class="form-control" name="creditLimit" type="number" min="0" step="1" value="${creditLimit(user)}"></label></div>
          <div class="modal-actions"><button class="btn-primary" type="submit">Lưu TTC</button></div>
        </form>
      </section>
      <section class="user-detail-card ${canManageSecurity ? '' : 'is-readonly'}">
        <div class="user-detail-card-head"><div><span>Ví xu</span><h3>Điều chỉnh qua ledger</h3></div></div>
        ${canManageSecurity ? `
          <form id="user-wallet-form" class="modal-form user-detail-form">
            <label class="form-group"><span>Số xu cộng/trừ</span><input class="form-control" name="amount" type="number" step="1" placeholder="5000 hoặc -5000" required></label>
            <label class="form-group"><span>Lý do</span><textarea class="form-control" name="reason" maxlength="500" required></textarea></label>
            ${adminPasswordField()}
            <div class="modal-actions"><button class="btn-primary" type="submit">Xác nhận số dư</button></div>
          </form>` : '<p class="modal-note">Chỉ System Admin được điều chỉnh số dư.</p>'}
      </section>
    </div>`;
}

function accessPanel(user, canManageSecurity) {
  const selected = new Set(user.permissions || []);
  return `
    <section class="user-detail-card user-access-card">
      <div class="user-detail-card-head user-access-card-head"><div><span>Quyền truy cập Web</span><h3>Phạm vi truy cập trực tiếp</h3></div>${webAccessDetailStatus(user)}</div>
      ${user.is_system_admin ? '<p class="modal-note">System Admin tự động có toàn bộ permission active; không tạo user_permissions riêng.</p>' : `
        <form id="user-permission-form" class="modal-form">
          <div class="permission-group-grid">${PERMISSION_GROUPS.map((group) => permissionGroup(group, selected, canManageSecurity)).join('')}</div>
          ${canManageSecurity ? `<div class="permission-action-bar"><div><strong data-permission-selection-count>${selected.size} quyền được chọn</strong><span data-permission-dirty>Chưa có thay đổi</span></div><button class="btn-primary" type="submit" data-permission-save disabled>Lưu quyền</button></div>` : '<p class="modal-note">Bạn có thể xem quyền; chỉ System Admin được cấp hoặc thu hồi.</p>'}
        </form>
        ${canManageSecurity ? permissionConfirmationDialog() : ''}`}
    </section>`;
}

function permissionGroup(group, selected, editable) {
  const activeCatalog = new Set(state.permissionCatalog);
  const permissions = group.permissions.filter((permission) => activeCatalog.has(permission));
  if (!permissions.length) return '';
  return `<fieldset class="permission-group"><legend>${escapeHtml(group.label)}</legend>${permissions.map((permission) => `<label class="permission-option"><input type="checkbox" name="permissions" value="${escapeHtml(permission)}" ${selected.has(permission) ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>${escapeHtml(PERMISSION_LABELS[permission] || 'Quyền chưa đặt tên')}</span></label>`).join('')}</fieldset>`;
}

function permissionConfirmationDialog() {
  return `
    <div class="permission-confirm-overlay hidden" data-permission-confirm-overlay>
      <section class="permission-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-confirm-title">
        <header>
          <div><span>Xác nhận bảo mật</span><h3 id="permission-confirm-title">Lưu thay đổi quyền</h3></div>
          <button class="modal-close" type="button" data-permission-confirm-cancel aria-label="Đóng xác nhận"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button>
        </header>
        <form id="permission-confirm-form" class="modal-form permission-confirm-form">
          <p class="modal-note">Xác nhận danh sách quyền đã chọn bằng mật khẩu quản trị.</p>
          ${adminPasswordField()}
          <label class="form-group"><span>Lý do</span><textarea class="form-control" name="reason" maxlength="500" rows="3" required></textarea></label>
          <div class="modal-actions"><button class="btn-secondary" type="button" data-permission-confirm-cancel>Hủy</button><button class="btn-primary" type="submit">Xác nhận thay đổi</button></div>
        </form>
      </section>
    </div>`;
}

function ledgerPanel(user) {
  return `
    <section class="user-detail-card">
      <div class="user-detail-card-head"><div><span>Wallet ledger</span><h3>Lịch sử giao dịch</h3></div><button class="btn-secondary compact-button" type="button" data-ledger-reload>Tải lại</button></div>
      <div id="user-ledger-panel"><div class="modal-loading">Đang tải giao dịch...</div></div>
      ${Pagination({ id: 'user-ledger', page: state.ledgerPage, pageSize: state.ledgerPageSize, total: state.ledgerTotal, pageSizeOptions: [10, 20, 50], noun: 'giao dịch' })}
    </section>`;
}

function securityPanel(user, canManageSecurity) {
  if (!canManageSecurity) return `<section class="user-detail-card">${EmptyState({ title: user.is_system_admin ? 'Tài khoản được bảo vệ' : 'Chỉ System Admin', message: user.is_system_admin ? 'Không thể khóa hoặc đặt lại mật khẩu System Admin từ trang này.' : 'Bạn không có quyền thực hiện thao tác bảo mật.' })}</section>`;
  const locking = user.status !== 'locked';
  return `
    <div class="user-detail-grid">
      <section class="user-detail-card">
        <div class="user-detail-card-head"><div><span>Trạng thái</span><h3>${locking ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}</h3></div></div>
        <form id="user-lock-form" class="modal-form user-detail-form">
          <p class="modal-note">${locking ? 'Khóa sẽ tắt web access và ban đăng nhập Auth.' : 'Mở khóa không tự cấp quyền; web access chỉ bật khi user còn permission.'}</p>
          <label class="form-group"><span>Lý do</span><textarea class="form-control" name="reason" maxlength="500" required></textarea></label>
          ${adminPasswordField()}
          <div class="modal-actions"><button class="${locking ? 'btn-danger' : 'btn-primary'}" type="submit">${locking ? 'Khóa tài khoản' : 'Mở khóa'}</button></div>
        </form>
      </section>
      <section class="user-detail-card">
        <div class="user-detail-card-head"><div><span>Supabase Auth</span><h3>Đặt lại mật khẩu</h3></div></div>
        <form id="user-password-form" class="modal-form user-detail-form">
          <label class="form-group"><span>Mật khẩu mới</span><input class="form-control" name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <label class="form-group"><span>Xác nhận mật khẩu mới</span><input class="form-control" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <label class="form-group"><span>Lý do</span><input class="form-control" name="reason" maxlength="500" required></label>
          ${adminPasswordField()}
          <div class="modal-actions"><button class="btn-primary" type="submit">Đặt lại mật khẩu</button></div>
        </form>
      </section>
    </div>`;
}

function adminPasswordField() {
  return '<label class="form-group admin-password-confirm"><span>Xác nhận mật khẩu quản trị</span><input class="form-control" name="adminPassword" type="password" autocomplete="current-password" required></label>';
}

function bindDetailEvents(user) {
  document.querySelectorAll('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => {
    state.activeTab = button.dataset.detailTab;
    renderUserDetail(user);
    if (state.activeTab === 'ledger') loadLedger(user.user_id);
  }));
  bindSubmit('user-account-form', async (form) => {
    await StaffService.updateProfile(user.user_id, {
      displayName: form.elements.displayName.value, email: form.elements.email.value,
      phone: form.elements.phone.value, facebookId: form.elements.facebookId.value, reason: form.elements.reason.value,
    });
    Toast.show('Đã cập nhật thông tin tài khoản.');
    await refreshDetail('account');
  });
  bindSubmit('user-ttc-form', async (form) => {
    await StaffService.updateProfile(user.user_id, { tier: form.elements.tier.value, creditLimit: form.elements.creditLimit.value, reason: 'Cập nhật hồ sơ TTC' });
    Toast.show('Đã cập nhật hồ sơ TTC.');
    await refreshDetail('ttc');
  });
  bindSubmit('user-wallet-form', async (form) => {
    await StaffService.adjustWallet(user.user_id, {
      amount: form.elements.amount.value, reason: form.elements.reason.value,
      description: 'Điều chỉnh từ Quản lý người dùng', adminPassword: form.elements.adminPassword.value,
      idempotencyKey: createIdempotencyKey('user-wallet'),
    });
    Toast.show('Đã cập nhật số dư và ghi ledger.');
    await refreshDetail('ttc');
  });
  bindPermissionEvents(user);
  bindSubmit('user-lock-form', async (form) => {
    await StaffService.setLocked(user.user_id, user.status !== 'locked', form.elements.adminPassword.value, form.elements.reason.value);
    Toast.show(user.status === 'locked' ? 'Đã mở khóa người dùng.' : 'Đã khóa người dùng.');
    await refreshDetail('security');
  });
  bindSubmit('user-password-form', async (form) => {
    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) throw new Error('Xác nhận mật khẩu mới chưa khớp.');
    await StaffService.resetPassword(user.user_id, form.elements.newPassword.value, form.elements.adminPassword.value, form.elements.reason.value);
    Toast.show('Đã đặt lại mật khẩu người dùng.');
    form.reset();
  });
  document.querySelector('[data-ledger-reload]')?.addEventListener('click', () => loadLedger(user.user_id));
  bindPagination('user-ledger', {
    onPage(page) { state.ledgerPage = page; loadLedger(user.user_id); },
    onPageSize(pageSize) { state.ledgerPage = 1; state.ledgerPageSize = pageSize; loadLedger(user.user_id); },
  });
}

function bindPermissionEvents(user) {
  const permissionForm = document.getElementById('user-permission-form');
  const confirmation = document.querySelector('[data-permission-confirm-overlay]');
  if (!permissionForm || !confirmation) return;
  const initial = [...new Set(user.permissions || [])].sort();
  const saveButton = permissionForm.querySelector('[data-permission-save]');
  const count = permissionForm.querySelector('[data-permission-selection-count]');
  const dirty = permissionForm.querySelector('[data-permission-dirty]');
  const selectedPermissions = () => [...permissionForm.querySelectorAll('input[name="permissions"]:checked')].map((input) => input.value).sort();
  const hasChanges = () => JSON.stringify(selectedPermissions()) !== JSON.stringify(initial);
  const updateSelectionState = () => {
    const selected = selectedPermissions();
    if (count) count.textContent = `${selected.length} quyền được chọn`;
    if (dirty) dirty.textContent = hasChanges() ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi';
    if (saveButton) saveButton.disabled = !hasChanges();
  };
  const closeConfirmation = () => {
    confirmation.classList.add('hidden');
    document.getElementById('permission-confirm-form')?.reset();
    saveButton?.focus();
  };
  const openConfirmation = () => {
    if (!hasChanges()) return;
    confirmation.classList.remove('hidden');
    document.querySelector('#permission-confirm-form input[name="adminPassword"]')?.focus();
  };

  permissionForm.querySelectorAll('input[name="permissions"]').forEach((input) => input.addEventListener('change', updateSelectionState));
  permissionForm.addEventListener('submit', (event) => { event.preventDefault(); openConfirmation(); });
  confirmation.querySelectorAll('[data-permission-confirm-cancel]').forEach((button) => button.addEventListener('click', closeConfirmation));
  confirmation.addEventListener('click', (event) => { if (event.target === confirmation) closeConfirmation(); });
  confirmation.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeConfirmation();
  });
  bindSubmit('permission-confirm-form', async (form) => {
    await StaffService.syncPermissions(user.user_id, selectedPermissions(), form.elements.adminPassword.value, form.elements.reason.value);
    Toast.show('Đã đồng bộ quyền truy cập.');
    await refreshDetail('access');
  });
  updateSelectionState();
}

function bindSubmit(id, handler) {
  document.getElementById(id)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.idleLabel = button.textContent; button.textContent = 'Đang xử lý...'; }
    try { await handler(form); } catch (error) { Toast.show(error?.message || 'Không thể thực hiện thao tác.', 'error'); }
    finally { if (button?.isConnected) { button.disabled = false; button.textContent = button.dataset.idleLabel || 'Lưu'; } }
  });
}

async function refreshDetail(tab) {
  await loadUsers();
  await openUserDetail(state.selectedUserId, tab);
}

async function loadLedger(userId) {
  const panel = document.getElementById('user-ledger-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="modal-loading">Đang tải giao dịch...</div>';
  try {
    const result = await StaffService.walletLedger(userId, { page: state.ledgerPage, pageSize: state.ledgerPageSize });
    state.ledgerTotal = Number(result.total || 0);
    panel.innerHTML = renderLedger(result.rows || []);
    updatePagination({ id: 'user-ledger', page: state.ledgerPage, pageSize: state.ledgerPageSize, total: state.ledgerTotal, pageSizeOptions: [10, 20, 50], noun: 'giao dịch' });
  } catch (error) {
    panel.innerHTML = EmptyState({ title: 'Không tải được giao dịch', message: error?.message || 'Vui lòng thử lại.' });
  }
}

function renderLedger(rows) {
  if (!rows.length) return EmptyState({ title: 'Chưa có giao dịch', message: 'Ví chưa có ledger để hiển thị.' });
  return `<div class="report-table-wrap"><table class="data-table user-ledger-table"><thead><tr><th>Thời gian</th><th>Loại</th><th>Số tiền</th><th>Trước</th><th>Sau</th><th>Lý do</th><th>Actor</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(formatDateTime(row.created_at))}</td><td>${escapeHtml(row.transaction_type || '—')}</td><td class="${Number(row.amount) >= 0 ? 'wallet-positive' : 'wallet-negative'}">${Number(row.amount) > 0 ? '+' : ''}${formatNumber(row.amount)}</td><td>${formatNumber(row.balance_before)}</td><td>${formatNumber(row.balance_after)}</td><td>${escapeHtml(row.reason || row.description || '—')}</td><td>${escapeHtml(row.actor_id || row.actor_type || 'system')}</td></tr>`).join('')}</tbody></table></div>`;
}

function userWallet(user) { return Array.isArray(user?.wallets) ? user.wallets[0] : user?.wallets; }
function facebookAccounts(user) { return Array.isArray(user?.user_facebook_accounts) ? user.user_facebook_accounts : []; }
function primaryFacebookId(user) { const items = facebookAccounts(user); return (items.find((item) => item.is_primary) || items[0])?.facebook_id || ''; }
function creditLimit(user) { const value = Number(user?.metadata?.credit_limit ?? 5000000); return Number.isFinite(value) && value >= 0 ? value : 5000000; }
function tierLabel(user) { return { customer: 'Khách hàng', silver: 'Bạc', gold: 'Vàng', diamond: 'Kim cương' }[user?.metadata?.tier] || 'Khách hàng'; }
function tierOptions(user) { return [['customer','Khách hàng'],['silver','Bạc'],['gold','Vàng'],['diamond','Kim cương']].map(([value,label]) => `<option value="${value}" ${user?.metadata?.tier === value ? 'selected' : ''}>${label}</option>`).join(''); }
function formatNumber(value) { return new Intl.NumberFormat('vi-VN').format(Number(value || 0)); }
function statusBadge(status) { const active = status === 'active'; return `<span class="status-pill ${active ? 'success' : status === 'locked' ? 'danger' : ''}">${active ? 'Hoạt động' : status === 'locked' ? 'Đã khóa' : 'Chờ hồ sơ'}</span>`; }
function webAccessBadge(user) { return `<span class="status-pill ${user.web_access_enabled ? 'success' : ''}">Quyền truy cập Web: ${user.web_access_enabled ? 'Đang bật' : 'Đang tắt'}</span>`; }
function webAccessSummary(user) {
  if (user.is_system_admin) return '<div class="user-web-access"><span>Quyền truy cập Web</span><strong class="is-enabled">Toàn quyền hệ thống</strong></div>';
  return `<div class="user-web-access"><span>Quyền truy cập Web</span><strong class="${user.web_access_enabled ? 'is-enabled' : 'is-disabled'}">${user.web_access_enabled ? 'Đang bật' : 'Đang tắt'}</strong><small>${(user.permissions || []).length} quyền được cấp</small></div>`;
}
function webAccessDetailStatus(user) {
  if (user.is_system_admin) return '<div class="user-access-status"><strong>Toàn quyền hệ thống</strong><span>Không cần cấp quyền riêng</span></div>';
  return `<div class="user-access-status"><strong class="${user.web_access_enabled ? 'is-enabled' : 'is-disabled'}">${user.web_access_enabled ? 'Đang bật' : 'Đang tắt'}</strong><span>${(user.permissions || []).length} quyền được cấp</span></div>`;
}
function createIdempotencyKey(prefix) { return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(16).slice(2)}`}`; }
