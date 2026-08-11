import { EmptyState } from '../components/EmptyState.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from '../components/FacebookIdResolver.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { PAGE_TITLES } from '../constants/navigation.js';
import { AnnouncementService } from '../services/AnnouncementService.js';
import { TtcAdminService } from '../services/TtcAdminService.js';
import { getUserAvatarPath } from '../utils/avatar.js';
import { isMissingDatabaseFeatureError } from '../utils/databaseFeature.js';
import { formatDateTime } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

const state = {
  campaigns: [],
  reviewTasks: [],
  checkLogs: [],
  walletLedger: [],
  users: [],
  interactionTypes: [],
  processingTaskId: null,
  userSearchTerm: '',
  walletUserSearchTerm: '',
  campaignSearchTerm: '',
  campaignTab: 'all',
  createCampaignTab: 'owner',
  reviewTaskTab: 'pending',
  userTab: 'list',
  reviewTaskSearchTerm: '',
  checkLogSearchTerm: '',
  checkLogTab: 'all',
  walletLedgerSearchTerm: '',
  priceSearchTerm: '',
  announcements: [],
};

const ADMIN_TTC_ROUTE_CONFIG = {
  admin: {
    title: 'Quản trị tương tác chéo',
    description: 'Theo dõi danh sách tăng tương tác và trạng thái chạy của từng đơn.',
    panels: ['campaigns'],
  },
  'admin-ttc-campaigns': {
    title: 'Tăng tương tác',
    description: 'Tạo và theo dõi các gói tăng like, follow, comment, reaction, share, join group Facebook bằng xu.',
    panels: ['campaignCreate', 'campaigns'],
  },
  'admin-ttc-announcements': {
    title: 'Thông báo trang chủ',
    description: 'Tạo thông báo giả để hiển thị trên trang chủ tài khoản user.',
    panels: ['announcements'],
  },
  'admin-ttc-tasks': {
    title: 'Duyệt nhiệm vụ',
    description: 'Duyệt nhiệm vụ user đã gửi bằng chứng; cộng xu hoặc từ chối có lý do.',
    panels: ['tasks'],
  },
  'admin-ttc-users': {
    title: 'Người dùng',
    description: 'Quản lý tài khoản web, ví chung, Facebook ID và trạng thái sử dụng Kiosk/TTC.',
    panels: ['users'],
  },
  'admin-ttc-wallets': {
    title: 'Ví xu',
    description: 'Điều chỉnh ví chung có lý do rõ ràng và lưu ledger để đối soát.',
    panels: ['wallets', 'walletLedger'],
  },
  'admin-ttc-settings': {
    title: 'Cấu hình giá TTC',
    description: 'Điều chỉnh giá mua, xu thưởng, số lượng tối thiểu/tối đa và trạng thái từng loại tương tác.',
    panels: ['settings'],
  },
  'admin-ttc-logs': {
    title: 'Kiểm tra & vi phạm',
    description: 'Xem lịch sử submit/verify nhiệm vụ và kết quả kiểm tra gần đây.',
    panels: ['logs'],
  },
};

const USER_PERMISSION_ROUTES = [
  'dashboard',
  'reports',
  'customers',
  'kiosks',
  'legacy-registration',
  'payments',
  'categories',
  'business-types',
  'registration-requests',
  'admin-ttc',
  'admin-ttc-campaigns',
  'admin-ttc-announcements',
  'admin-ttc-tasks',
  'admin-ttc-users',
  'admin-ttc-wallets',
  'admin-ttc-settings',
  'admin-ttc-logs',
  'logs',
  'settings',
];

export function AdminTtcPage({ route = 'admin' } = {}) {
  const view = ADMIN_TTC_ROUTE_CONFIG[route] || ADMIN_TTC_ROUTE_CONFIG.admin;
  const hasPanel = (panel) => view.panels.includes(panel);
  return `
    ${PageHeader({
      title: view.title,
      description: view.description,
      actions: '',
    })}
    <div id="admin-ttc-migration-notice"></div>
    <div class="ttc-shell admin-ttc-shell admin-ttc-route-${escapeHtml(route)}">
      <div class="dashboard-grid ${view.panels.length === 1 ? 'single-panel-grid' : ''} ${route === 'admin-ttc-campaigns' ? 'admin-campaign-layout' : ''}">
      ${hasPanel('campaigns') ? `<section class="dash-card admin-campaign-list-card">
        <div class="dash-card-header"><h3>Danh sách tăng tương tác</h3></div>
        <div class="list-search-bar">
          <input id="admin-ttc-campaign-search" class="form-control" type="search" placeholder="Tìm theo loại, link, user hoặc trạng thái" aria-label="Tìm tăng tương tác" autocomplete="off">
        </div>
        <div id="admin-ttc-campaigns">
          ${EmptyState({ title: 'Đang tải tăng tương tác', message: 'Đang đọc danh sách TTC.' })}
        </div>
      </section>` : ''}
      ${hasPanel('campaignCreate') ? `<section class="dash-card admin-ttc-create-card">
        <div class="dash-card-header"><h3>Tạo tăng tương tác</h3></div>
        ${renderCreateCampaignTabs()}
        <form id="admin-ttc-create-campaign-form" class="stacked-form admin-create-campaign-form" novalidate>
          <div class="admin-create-tab-panel" data-admin-create-panel="owner" ${adminCreatePanelHiddenAttribute('owner')}>
            <label class="form-group">
              <span>Tạo cho user</span>
              <select id="admin-ttc-campaign-owner" class="form-control" name="ownerUserId" required>
                <option value="">Đang tải user...</option>
              </select>
            </label>
            <div class="form-row">
              <label class="form-group">
                <span>Loại tương tác</span>
                <select id="admin-ttc-campaign-type" class="form-control" name="interactionType" required>
                  <option value="">Đang tải cấu hình...</option>
                </select>
              </label>
              <label class="form-group">
                <span>Số lượng</span>
                <input id="admin-ttc-campaign-quantity" class="form-control" name="targetQuantity" type="number" min="1" step="1" value="10" inputmode="numeric" required>
              </label>
            </div>
            <div id="admin-ttc-campaign-cost" class="ttc-cost-summary">Chọn loại tương tác để xem đơn giá.</div>
          </div>
          <div class="admin-create-tab-panel" data-admin-create-panel="target" ${adminCreatePanelHiddenAttribute('target')}>
            ${FacebookIdResolverFields({
              urlId: 'admin-ttc-target-url',
              idId: 'admin-ttc-target-facebook-id',
              requiredUrl: true,
              requiredId: false,
              manualFallback: 'always',
              prefix: 'admin-ttc-target',
              urlAttributes: 'name="targetUrl"',
              idAttributes: 'name="targetFacebookId"',
              urlLabel: 'Link mục tiêu',
              idLabel: 'ID mục tiêu',
              buttonLabel: 'Lấy ID',
              helperText: 'Dán link Facebook mục tiêu rồi bấm Lấy ID nếu cần hệ thống tự nhận diện.',
            })}
            <label class="form-group">
              <span>Nhãn mục tiêu</span>
              <input class="form-control" name="targetLabel" placeholder="Tên bài viết, page hoặc group">
            </label>
          </div>
          <div class="admin-create-tab-panel" data-admin-create-panel="notes" ${adminCreatePanelHiddenAttribute('notes')}>
            <label class="form-group" data-admin-comment-options-field hidden>
              <span>Nội dung comment gợi ý</span>
              <textarea class="form-control" name="commentOptions" rows="2" placeholder="Mỗi dòng là một nội dung comment"></textarea>
            </label>
            <label class="form-group">
              <span>Lý do admin tạo</span>
              <input class="form-control" name="reason" placeholder="Ví dụ: tạo giúp user theo yêu cầu">
            </label>
          </div>
          <div class="form-actions"><button class="btn-primary" type="submit">Tạo tăng tương tác</button></div>
        </form>
      </section>` : ''}
      ${hasPanel('announcements') ? `<section class="dash-card admin-announcement-card">
        <div class="dash-card-header">
          <h3>Tạo thông báo</h3>
          <span class="muted-text">Demo bằng localStorage, chưa ghi DB.</span>
        </div>
        <form id="admin-announcement-form" class="stacked-form">
          <div class="form-row">
            <label class="form-group">
              <span>Tiêu đề</span>
              <input class="form-control" name="title" value="[CẬP NHẬT]" required>
            </label>
            <label class="form-group">
              <span>Nhóm nội dung</span>
              <input class="form-control" name="category" placeholder="Facebook, Tiktok, Kiosk..." required>
            </label>
          </div>
          <label class="form-group">
            <span>Nội dung</span>
            <textarea class="form-control" name="body" rows="5" placeholder="Mỗi dòng là một ý thông báo" required></textarea>
          </label>
          <div class="form-actions"><button class="btn-primary" type="submit">Đăng thông báo</button></div>
        </form>
        <div id="admin-announcement-preview" class="admin-announcement-preview"></div>
      </section>` : ''}
      ${hasPanel('tasks') ? `<section class="dash-card">
        <div class="dash-card-header"><h3>Nhiệm vụ chờ duyệt</h3></div>
        <div class="list-search-bar">
          <input id="admin-ttc-task-search" class="form-control" type="search" placeholder="Tìm theo task, loại, user hoặc link mục tiêu" aria-label="Tìm nhiệm vụ chờ duyệt" autocomplete="off">
        </div>
        <div id="admin-ttc-review-tasks">
          ${EmptyState({ title: 'Đang tải nhiệm vụ', message: 'Đang đọc task submitted/verifying.' })}
        </div>
      </section>` : ''}
      ${hasPanel('users') ? `<section class="dash-card">
        <div class="dash-card-header"><h3>Danh sách người dùng</h3></div>
        <div class="admin-user-toolbar">
          <label class="form-group">
            <span>Tìm người dùng</span>
            <input id="admin-ttc-user-search" class="form-control" type="search" placeholder="Tìm theo tên, email, SĐT hoặc Facebook ID">
          </label>
          <div class="admin-user-summary" id="admin-ttc-user-summary">Đang tải...</div>
        </div>
        <div id="admin-ttc-users-list">
          ${EmptyState({ title: 'Đang tải người dùng', message: 'Đang đọc tài khoản web và ví chung.' })}
        </div>
      </section>` : ''}
      ${hasPanel('wallets') ? `<section class="dash-card admin-wallet-card">
        <div class="dash-card-header">
          <h3>Ví chung</h3>
          <span class="muted-text">Cộng/trừ xu có lý do và lưu lịch sử</span>
        </div>
        <div id="admin-wallet-stats" class="admin-wallet-stats">
          <div class="admin-wallet-stat"><span>Đang tải</span><strong>—</strong></div>
        </div>
        <form id="admin-wallet-adjust-form" class="stacked-form admin-wallet-adjust-form">
          <div class="dash-card-header compact-card-header"><h3>Điều chỉnh ví</h3></div>
          <label class="form-group">
            <span>Tìm user</span>
            <input id="admin-wallet-user-search" class="form-control" type="search" placeholder="Gõ tên, username, email, SĐT hoặc Facebook ID để lọc nhanh">
          </label>
          <label class="form-group">
            <span>User</span>
            <select id="admin-wallet-user" class="form-control" name="userId" required>
              <option value="">Đang tải user...</option>
            </select>
          </label>
          <div class="form-row">
            <label class="form-group"><span>Số xu</span><input class="form-control" name="amount" type="number" step="1" required></label>
            <label class="form-group">
              <span>Loại điều chỉnh</span>
              <select class="form-control" name="description" required>
                <option value="">Chọn loại điều chỉnh</option>
                <option value="Cộng tiền">Cộng tiền</option>
                <option value="Trừ tiền">Trừ tiền</option>
                <option value="Thưởng">Thưởng</option>
                <option value="Hoàn tiền">Hoàn tiền</option>
                <option value="Trừ sai phạm">Trừ sai phạm</option>
                <option value="Điều chỉnh khác">Điều chỉnh khác</option>
              </select>
            </label>
          </div>
          <label class="form-group"><span>Lý do bắt buộc</span><textarea class="form-control" name="reason" rows="2" required></textarea></label>
          <div class="form-actions"><button class="btn-primary" type="submit">Ghi giao dịch ví</button></div>
        </form>
      </section>` : ''}
      ${hasPanel('walletLedger') ? `<section class="dash-card admin-wallet-ledger-card">
        <div class="dash-card-header">
          <h3>Sổ ví gần đây</h3>
          <span class="muted-text">Theo dõi giao dịch ví để đối soát nhanh</span>
        </div>
        <div class="list-search-bar">
          <input id="admin-wallet-ledger-search" class="form-control" type="search" placeholder="Tìm theo user, username, loại giao dịch, số xu hoặc lý do" aria-label="Tìm sổ ví" autocomplete="off">
        </div>
        <div id="admin-wallet-ledger-list">
          ${EmptyState({ title: 'Đang tải sổ ví', message: 'Đang đọc lịch sử giao dịch ví chung.' })}
        </div>
      </section>` : ''}
      ${hasPanel('settings') ? `<section class="dash-card">
        <div class="dash-card-header"><h3>Bảng giá tương tác</h3></div>
        <div class="list-search-bar">
          <input id="admin-ttc-price-search" class="form-control" type="search" placeholder="Tìm theo mã, tên tương tác, giá hoặc trạng thái" aria-label="Tìm cấu hình giá TTC" autocomplete="off">
        </div>
        <div id="admin-ttc-price-settings">
          ${EmptyState({ title: 'Đang tải bảng giá', message: 'Đang đọc cấu hình ttc_interaction_types.' })}
        </div>
      </section>` : ''}
      ${hasPanel('logs') ? `<section class="dash-card">
        <div class="dash-card-header"><h3>Check logs gần đây</h3></div>
        <div class="list-search-bar">
          <input id="admin-ttc-log-search" class="form-control" type="search" placeholder="Tìm theo task, loại check, trạng thái hoặc kết quả" aria-label="Tìm check log" autocomplete="off">
        </div>
        <div id="admin-ttc-check-logs">
          ${EmptyState({ title: 'Đang tải logs', message: 'Đang đọc lịch sử kiểm tra nhiệm vụ.' })}
        </div>
      </section>` : ''}
      </div>
    </div>
  `;
}

AdminTtcPage.afterRender = function afterRenderAdminTtcPage() {
  bindAdminTtcEvents();
  syncAdminCreateTabs();
  loadAdminTtcData();
};

function bindAdminTtcEvents() {
  bindFacebookIdResolvers(document);

  document.getElementById('admin-ttc-campaign-type')?.addEventListener('change', syncAdminCampaignCost);
  document.getElementById('admin-ttc-campaign-quantity')?.addEventListener('input', syncAdminCampaignCost);
  document.getElementById('admin-ttc-create-campaign-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await createAdminCampaign(event.currentTarget);
  });
  document.querySelector('.admin-ttc-create-card')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-admin-create-tab]');
    if (!tab) return;
    state.createCampaignTab = tab.dataset.adminCreateTab || 'owner';
    syncAdminCreateTabs();
  });

  document.getElementById('admin-ttc-price-settings')?.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-admin-price-form]');
    if (!form) return;
    event.preventDefault();
    await updateInteractionType(form);
  });

  document.getElementById('admin-ttc-review-tasks')?.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-admin-task-tab]');
    if (tab) {
      state.reviewTaskTab = tab.dataset.adminTaskTab || 'pending';
      renderReviewTasks();
      return;
    }
    const button = event.target.closest('[data-admin-task-action]');
    if (!button || state.processingTaskId) return;
    const taskId = button.dataset.taskId;
    const action = button.dataset.adminTaskAction;
    await verifyTask(taskId, action, button);
  });

  document.getElementById('admin-wallet-adjust-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await adjustWallet(event.currentTarget);
  });

  document.querySelector('.admin-ttc-shell')?.addEventListener('click', (event) => {
    const link = event.target.closest('[data-wallet-user-link]');
    if (!link) return;
    sessionStorage.setItem('adminWalletUserId', link.dataset.walletUserLink || '');
  });

  document.getElementById('admin-ttc-user-search')?.addEventListener('input', (event) => {
    state.userSearchTerm = event.currentTarget.value || '';
    renderAdminUsers();
  });

  document.getElementById('admin-ttc-users-list')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-admin-user-tab]');
    if (tab) {
      state.userTab = tab.dataset.adminUserTab || 'list';
      renderAdminUsers();
      return;
    }
    const action = event.target.closest('[data-admin-user-action]');
    if (!action) return;
    event.preventDefault();
    renderAdminUserQuickAction(action.dataset.adminUserAction, action.dataset.userId, action.closest('.row-action-menu-panel'));
  });

  document.getElementById('admin-ttc-users-list')?.addEventListener('submit', async (event) => {
    const walletForm = event.target.closest('[data-admin-user-wallet-form]');
    if (walletForm) {
      event.preventDefault();
      await submitAdminUserQuickWallet(walletForm);
      return;
    }
    const passwordForm = event.target.closest('[data-admin-user-password-form]');
    if (passwordForm) {
      event.preventDefault();
      await submitAdminUserQuickPassword(passwordForm);
      return;
    }
    const statusForm = event.target.closest('[data-admin-user-status-form]');
    if (statusForm) {
      event.preventDefault();
      await submitAdminUserQuickStatus(statusForm);
    }
  });

  document.getElementById('admin-wallet-user-search')?.addEventListener('input', (event) => {
    state.walletUserSearchTerm = event.currentTarget.value || '';
    renderWalletUserSelect();
  });

  document.getElementById('admin-ttc-campaign-search')?.addEventListener('input', (event) => {
    state.campaignSearchTerm = event.currentTarget.value || '';
    renderAdminCampaigns();
  });

  document.getElementById('admin-ttc-campaigns')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-admin-campaign-tab]');
    if (tab) {
      state.campaignTab = tab.dataset.adminCampaignTab || 'all';
      renderAdminCampaigns();
      return;
    }
    const action = event.target.closest('[data-admin-campaign-action]');
    if (!action) return;
    event.preventDefault();
    openCancelCampaignModal(action.dataset.campaignId);
  });

  document.getElementById('admin-ttc-task-search')?.addEventListener('input', (event) => {
    state.reviewTaskSearchTerm = event.currentTarget.value || '';
    renderReviewTasks();
  });

  document.getElementById('admin-ttc-log-search')?.addEventListener('input', (event) => {
    state.checkLogSearchTerm = event.currentTarget.value || '';
    renderCheckLogs();
  });

  document.getElementById('admin-ttc-check-logs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-admin-log-tab]');
    if (!tab) return;
    state.checkLogTab = tab.dataset.adminLogTab || 'all';
    renderCheckLogs();
  });

  document.getElementById('admin-wallet-ledger-search')?.addEventListener('input', (event) => {
    state.walletLedgerSearchTerm = event.currentTarget.value || '';
    renderWalletLedgerPanel();
  });

  document.getElementById('admin-ttc-price-search')?.addEventListener('input', (event) => {
    state.priceSearchTerm = event.currentTarget.value || '';
    renderInteractionSettingsPanel();
  });

  document.getElementById('admin-announcement-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    AnnouncementService.create(values);
    event.currentTarget.reset();
    event.currentTarget.elements.title.value = '[CẬP NHẬT]';
    Toast.show('Đã đăng thông báo lên trang chủ user.');
    renderAdminAnnouncements();
  });
}

async function loadAdminTtcData() {
  renderAdminAnnouncements();
  await Promise.allSettled([
    loadCampaigns(),
    loadReviewTasks(),
    loadCheckLogs(),
    loadWalletLedger(),
    loadUsers(),
    loadInteractionTypes(),
  ]);
}

function renderAdminAnnouncements() {
  const panel = document.getElementById('admin-announcement-preview');
  if (!panel) return;
  state.announcements = AnnouncementService.list();
  panel.innerHTML = state.announcements.slice(0, 5).map((item) => `
    <div class="recent-item">
      <div>
        <div class="expiring-name">${escapeHtml(item.title || '[CẬP NHẬT]')} · ${escapeHtml(item.category || 'Thông báo')}</div>
        <div class="expiring-date">${escapeHtml(formatDateTime(item.createdAt))} · ${escapeHtml((item.body || [])[0] || '')}</div>
      </div>
    </div>
  `).join('');
}

async function loadCampaigns() {
  const panel = document.getElementById('admin-ttc-campaigns');
  if (!panel) return;
  try {
    const { data } = await TtcAdminService.listCampaigns({
      pagination: { page: 1, pageSize: 100 },
    });
    state.campaigns = data || [];
    renderAdminCampaigns();
  } catch (error) {
    showMigrationNotice(error, 'quản trị tăng tương tác TTC');
    panel.innerHTML = EmptyState({
      title: 'Không tải được tăng tương tác',
      message: isMissingDatabaseFeatureError(error)
        ? adminFriendlyFeatureMessage('quản trị tăng tương tác TTC')
        : error?.message || 'Vui lòng thử lại.',
    });
  }
}

function renderAdminCampaigns() {
  const panel = document.getElementById('admin-ttc-campaigns');
  if (!panel) return;
  if (!state.campaigns.length) {
    panel.innerHTML = EmptyState({ title: 'Chưa có tăng tương tác', message: 'Các lượt tăng tương tác TTC sẽ hiển thị tại đây.' });
    return;
  }
  const campaigns = filterAdminCampaigns(state.campaigns);
  if (!campaigns.length) {
    panel.innerHTML = EmptyState({ title: 'Không tìm thấy tăng tương tác', message: 'Thử tìm bằng loại tương tác, link, user hoặc trạng thái khác.' });
    return;
  }
  panel.innerHTML = renderCampaignsTable(campaigns);
}

async function loadReviewTasks() {
  const panel = document.getElementById('admin-ttc-review-tasks');
  if (!panel) return;
  try {
    const [submitted, verifying, approved, rejected] = await Promise.all([
      TtcAdminService.listTasks({ status: 'submitted', pagination: { page: 1, pageSize: 100 } }),
      TtcAdminService.listTasks({ status: 'verifying', pagination: { page: 1, pageSize: 100 } }),
      TtcAdminService.listTasks({ status: 'approved', pagination: { page: 1, pageSize: 100 } }),
      TtcAdminService.listTasks({ status: 'rejected', pagination: { page: 1, pageSize: 100 } }),
    ]);
    state.reviewTasks = [
      ...(submitted.data || []),
      ...(verifying.data || []),
      ...(approved.data || []),
      ...(rejected.data || []),
    ]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    renderReviewTasks();
  } catch (error) {
    showMigrationNotice(error, 'duyệt nhiệm vụ TTC');
    panel.innerHTML = EmptyState({
      title: 'Không tải được task',
      message: isMissingDatabaseFeatureError(error)
        ? adminFriendlyFeatureMessage('duyệt nhiệm vụ TTC')
        : error?.message || 'Vui lòng thử lại.',
    });
  }
}

function renderReviewTasks() {
  const panel = document.getElementById('admin-ttc-review-tasks');
  if (!panel) return;
  if (!state.reviewTasks.length) {
    panel.innerHTML = EmptyState({ title: 'Không có nhiệm vụ chờ duyệt', message: 'Task user submit sẽ xuất hiện tại đây.' });
    return;
  }
  const tasks = filterReviewTasks(state.reviewTasks);
  const visibleTasks = filterReviewTasksByTab(tasks);
  if (!tasks.length) {
    panel.innerHTML = EmptyState({ title: 'Không tìm thấy nhiệm vụ', message: 'Thử tìm bằng task, loại tương tác, user hoặc link mục tiêu khác.' });
    return;
  }
  panel.innerHTML = renderReviewTasksTable(visibleTasks, tasks);
}

async function loadCheckLogs() {
  const panel = document.getElementById('admin-ttc-check-logs');
  if (!panel) return;
  try {
    const { data } = await TtcAdminService.listCheckLogs({ pagination: { page: 1, pageSize: 100 } });
    state.checkLogs = data || [];
    renderCheckLogs();
  } catch (error) {
    showMigrationNotice(error, 'check logs TTC');
    panel.innerHTML = EmptyState({
      title: 'Không tải được check logs',
      message: isMissingDatabaseFeatureError(error)
        ? adminFriendlyFeatureMessage('check logs TTC')
        : error?.message || 'Vui lòng thử lại.',
    });
  }
}

function renderCheckLogs() {
  const panel = document.getElementById('admin-ttc-check-logs');
  if (!panel) return;
  if (!state.checkLogs.length) {
    panel.innerHTML = EmptyState({ title: 'Chưa có check log', message: 'Lịch sử submit/verify sẽ hiển thị tại đây.' });
    return;
  }
  const logs = filterCheckLogs(state.checkLogs);
  if (!logs.length) {
    panel.innerHTML = EmptyState({ title: 'Không tìm thấy check log', message: 'Thử tìm bằng task, trạng thái, loại check hoặc kết quả khác.' });
    return;
  }
  panel.innerHTML = renderCheckLogsTable(filterCheckLogsByTab(logs), logs);
}

async function loadUsers() {
  const select = document.getElementById('admin-wallet-user');
  const ownerSelect = document.getElementById('admin-ttc-campaign-owner');
  const list = document.getElementById('admin-ttc-users-list');
  const campaignList = document.getElementById('admin-ttc-campaigns');
  if (!select && !ownerSelect && !list && !campaignList) return;
  try {
    const { data } = await TtcAdminService.listUsers({ pagination: { page: 1, pageSize: 100 } });
    state.users = data || [];
    if (!state.users.length) {
      if (select) select.innerHTML = '<option value="">Chưa có user portal</option>';
      if (ownerSelect) ownerSelect.innerHTML = '<option value="">Chưa có user active</option>';
      if (list) list.innerHTML = EmptyState({ title: 'Chưa có user TTC', message: 'User đăng ký tài khoản web sẽ hiển thị tại đây.' });
      renderWalletStats();
      return;
    }
    renderWalletUserSelect();
    renderWalletStats();
    if (document.getElementById('admin-wallet-ledger-list') && state.walletLedger.length) {
      renderWalletLedgerPanel();
    }
    if (document.getElementById('admin-ttc-campaigns') && state.campaigns.length) {
      renderAdminCampaigns();
    }
    if (ownerSelect) {
      const activeUsers = state.users.filter((user) => user.status === 'active');
      ownerSelect.innerHTML = [
        '<option value="">Chọn user nhận tăng tương tác</option>',
        ...activeUsers.map((user) => {
          const wallet = Array.isArray(user.wallets) ? user.wallets[0] : user.wallets;
          return `
            <option value="${user.user_id}">
              ${escapeHtml(formatUserOptionLabel(user))} · ${escapeHtml(String(wallet?.balance ?? 0))} xu
            </option>
          `;
        }),
      ].join('');
    }
    renderAdminUsers();
  } catch (error) {
    showMigrationNotice(error, 'danh sách user ví TTC');
    const message = isMissingDatabaseFeatureError(error) ? adminFriendlyFeatureMessage('danh sách user ví TTC') : error?.message || 'Không tải được user';
    if (select) select.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
    if (ownerSelect) ownerSelect.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
    if (list) list.innerHTML = EmptyState({ title: 'Không tải được user TTC', message });
  }
}

async function loadWalletLedger() {
  const panel = document.getElementById('admin-wallet-ledger-list');
  const needsUserMetrics = Boolean(document.getElementById('admin-ttc-users-list'));
  if (!panel && !needsUserMetrics) return;
  try {
    const { data } = await TtcAdminService.listWalletLedger({
      pagination: { page: 1, pageSize: needsUserMetrics ? 100 : 12 },
    });
    state.walletLedger = data || [];
    if (panel) renderWalletLedgerPanel();
    if (needsUserMetrics && state.users.length) renderAdminUsers();
  } catch (error) {
    showMigrationNotice(error, 'sổ ví TTC');
    if (!panel) return;
    panel.innerHTML = EmptyState({
      title: 'Không tải được sổ ví',
      message: isMissingDatabaseFeatureError(error)
        ? adminFriendlyFeatureMessage('sổ ví TTC')
        : error?.message || 'Vui lòng thử lại.',
    });
  }
}

function renderWalletUserSelect() {
  const select = document.getElementById('admin-wallet-user');
  if (!select) return;
  const users = filterUsers(state.users, state.walletUserSearchTerm).slice(0, 50);
  if (!users.length) {
    select.innerHTML = '<option value="">Không tìm thấy user phù hợp</option>';
    return;
  }
  select.innerHTML = [
    '<option value="">Chọn user</option>',
    ...users.map((user) => {
      const wallet = Array.isArray(user.wallets) ? user.wallets[0] : user.wallets;
      return `
        <option value="${user.user_id}">
          ${escapeHtml(formatUserOptionLabel(user))} · ${escapeHtml(String(wallet?.balance ?? 0))} xu
        </option>
      `;
    }),
  ].join('');
  const preferredUserId = sessionStorage.getItem('adminWalletUserId') || '';
  if (preferredUserId && users.some((user) => user.user_id === preferredUserId)) {
    select.value = preferredUserId;
  }
}

function renderWalletStats() {
  const panel = document.getElementById('admin-wallet-stats');
  if (!panel) return;
  const totals = state.users.reduce((acc, user) => {
    const wallet = getUserWallet(user);
    acc.balance += Number(wallet?.balance || 0);
    acc.earned += Number(wallet?.total_earned || 0);
    acc.spent += Number(wallet?.total_spent || 0);
    return acc;
  }, { balance: 0, earned: 0, spent: 0 });
  panel.innerHTML = `
    <div class="admin-wallet-stat">
      <span>User có ví</span>
      <strong>${formatNumber(state.users.length)}</strong>
    </div>
    <div class="admin-wallet-stat">
      <span>Tổng số dư</span>
      <strong>${formatNumber(totals.balance)} xu</strong>
    </div>
    <div class="admin-wallet-stat">
      <span>Tổng đã kiếm</span>
      <strong>${formatNumber(totals.earned)} xu</strong>
    </div>
    <div class="admin-wallet-stat">
      <span>Tổng đã dùng</span>
      <strong>${formatNumber(totals.spent)} xu</strong>
    </div>
  `;
}

function renderWalletLedger(rows) {
  if (!rows.length) {
    if (state.walletLedger.length && state.walletLedgerSearchTerm) {
      return EmptyState({
        title: 'Không tìm thấy giao dịch ví',
        message: 'Thử tìm bằng user, loại giao dịch, số xu hoặc lý do khác.',
      });
    }
    return EmptyState({
      title: 'Chưa có giao dịch ví',
      message: 'Các lần nạp, tiêu xu, cộng thưởng hoặc điều chỉnh admin sẽ nằm ở đây.',
    });
  }
  return `
    <div class="report-table-wrap admin-wallet-ledger-wrap">
      <table class="data-table admin-wallet-ledger-table">
        <thead>
          <tr>
            <th>Thời điểm</th>
            <th>User</th>
            <th>Loại</th>
            <th>Số xu</th>
            <th>Số dư sau</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const amount = Number(row.amount || 0);
            const user = state.users.find((item) => item.user_id === row.wallet_user_id);
            return `
              <tr>
                <td>${escapeHtml(formatDateTime(row.created_at))}</td>
                <td>
                  <strong>${escapeHtml(getUserDisplayName(user, row.wallet_user_id))}</strong>
                  <div class="muted-text">${escapeHtml(getUserUsernameLine(user, row.wallet_user_id))}</div>
                </td>
                <td>${escapeHtml(walletLedgerLabel(row))}</td>
                <td class="tabular-cell ${amount >= 0 ? 'wallet-positive' : 'wallet-negative'}">${amount > 0 ? '+' : ''}${formatNumber(amount)}</td>
                <td class="tabular-cell">${formatNumber(row.balance_after)} xu</td>
                <td>
                  <div>${escapeHtml(row.description || row.reason || '—')}</div>
                  ${row.reason && row.description ? `<div class="muted-text">${escapeHtml(row.reason)}</div>` : ''}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderWalletLedgerPanel() {
  const panel = document.getElementById('admin-wallet-ledger-list');
  if (!panel) return;
  panel.innerHTML = renderWalletLedger(filterWalletLedger(state.walletLedger));
}

function renderCampaignsTable(campaigns) {
  const totalQuantity = campaigns.reduce((sum, campaign) => sum + Number(campaign.target_quantity || 0), 0);
  const completedQuantity = campaigns.reduce((sum, campaign) => sum + Number(campaign.completed_count || 0), 0);
  return `
    ${renderAdminDataTabs([
      { label: 'Danh sách tăng tương tác', value: 'all', active: state.campaignTab === 'all' },
      { label: 'Theo trạng thái', value: 'status', active: state.campaignTab === 'status' },
      { label: 'Theo loại tương tác', value: 'type', active: state.campaignTab === 'type' },
    ], 'Nhóm tăng tương tác')}
    <div class="admin-data-table-summary">
      <strong>Tổng đơn ${formatNumber(campaigns.length)}</strong>
      <span>Đã chạy ${formatNumber(completedQuantity)}/${formatNumber(totalQuantity)} lượt</span>
    </div>
    ${state.campaignTab === 'status' ? renderCampaignGroupTable(campaigns, 'status') : ''}
    ${state.campaignTab === 'type' ? renderCampaignGroupTable(campaigns, 'type') : ''}
    ${state.campaignTab === 'all' ? renderCampaignDetailTable(campaigns) : ''}
  `;
}

function renderCampaignDetailTable(campaigns) {
  return `
    <div class="report-table-wrap admin-campaign-table-wrap">
      <table class="data-table admin-campaign-table">
        <thead>
          <tr>
            <th>ID đơn</th>
            <th>Thao tác</th>
            <th>Tài khoản</th>
            <th>UID / URL chạy</th>
            <th>Loại</th>
            <th>Số lượng</th>
            <th>Đã chạy</th>
            <th>Còn lại</th>
            <th>Trạng thái</th>
            <th>Số dư</th>
            <th>Created_at</th>
          </tr>
        </thead>
        <tbody>
          ${campaigns.map((campaign) => {
            const owner = getCampaignOwner(campaign);
            const wallet = getUserWallet(owner);
            const targetQuantity = Number(campaign.target_quantity || 0);
            const completedCount = Number(campaign.completed_count || 0);
            const remainingCount = Math.max(0, targetQuantity - completedCount);
            const canCancel = canCancelCampaign(campaign);
            return `
              <tr>
                <td class="tabular-cell">${escapeHtml(String(campaign.id || '—'))}</td>
                <td>
                  <details class="row-action-menu">
                    <summary>Thao tác</summary>
                    <div class="row-action-menu-panel">
                      <a class="table-action-button" href="#/admin-ttc-wallets" data-wallet-user-link="${escapeHtml(campaign.owner_user_id || '')}">Chỉnh ví</a>
                      <a class="table-action-button" href="#/admin-ttc-logs">Xem logs</a>
                      ${canCancel ? `<button class="table-action-button danger-action" type="button" data-admin-campaign-action="cancel" data-campaign-id="${escapeHtml(String(campaign.id || ''))}">Hủy/hoàn tiền</button>` : ''}
                    </div>
                  </details>
                </td>
                <td class="admin-campaign-account-cell">
                  <strong>${escapeHtml(getUserDisplayName(owner || campaign.user_profiles, campaign.owner_user_id))}</strong>
                  <div class="muted-text">${escapeHtml(getUserUsernameLine(owner || campaign.user_profiles, campaign.owner_user_id))}</div>
                </td>
                <td class="admin-campaign-target-cell">
                  <strong>${escapeHtml(campaign.target_facebook_id || 'Chưa có UID')}</strong>
                  <div class="muted-text">${escapeHtml(campaign.target_url || campaign.target_label || '—')}</div>
                </td>
                <td>${escapeHtml(campaignTypeLabel(campaign))}</td>
                <td class="tabular-cell">${formatNumber(targetQuantity)}</td>
                <td class="tabular-cell">${formatNumber(completedCount)}</td>
                <td class="tabular-cell">${formatNumber(remainingCount)}</td>
                <td><span class="status-pill ${campaignStatusClass(campaign.status)}">${escapeHtml(campaignStatusLabel(campaign.status))}</span></td>
                <td class="tabular-cell">${formatNumber(wallet?.balance ?? 0)} xu</td>
                <td>${escapeHtml(formatDateTime(campaign.created_at))}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function canCancelCampaign(campaign) {
  return !['completed', 'failed', 'cancelled'].includes(String(campaign?.status || ''));
}

function getCampaignGroupRows(campaigns, groupBy) {
  const groups = new Map();
  campaigns.forEach((campaign) => {
    const key = groupBy === 'status'
      ? campaignStatusLabel(campaign.status)
      : campaignTypeLabel(campaign);
    const total = Number(campaign.target_quantity || 0);
    const completed = Number(campaign.completed_count || 0);
    const unitCost = Number(campaign.unit_cost || 0);
    const current = groups.get(key) || {
      label: key,
      count: 0,
      completed: 0,
      total: 0,
      remaining: 0,
      cost: 0,
    };
    current.count += 1;
    current.completed += completed;
    current.total += total;
    current.remaining += Math.max(0, total - completed);
    current.cost += unitCost * total;
    groups.set(key, current);
  });
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function renderCampaignGroupTable(campaigns, groupBy) {
  const rows = getCampaignGroupRows(campaigns, groupBy);
  const firstColumn = groupBy === 'status' ? 'Trạng thái' : 'Loại tương tác';
  return `
    <div class="report-table-wrap admin-campaign-table-wrap">
      <table class="data-table admin-campaign-group-table">
        <thead>
          <tr>
            <th>${escapeHtml(firstColumn)}</th>
            <th>Số đơn</th>
            <th>Số lượng</th>
            <th>Đã chạy</th>
            <th>Còn lại</th>
            <th>Tiến độ</th>
            <th>Tổng chi phí</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((group) => {
            const percent = group.total > 0 ? Math.round((group.completed / group.total) * 100) : 0;
            return `
              <tr>
                <td><strong>${escapeHtml(group.label)}</strong></td>
                <td class="tabular-cell">${formatNumber(group.count)}</td>
                <td class="tabular-cell">${formatNumber(group.total)}</td>
                <td class="tabular-cell">${formatNumber(group.completed)}</td>
                <td class="tabular-cell">${formatNumber(group.remaining)}</td>
                <td class="tabular-cell">${formatNumber(percent)}%</td>
                <td class="tabular-cell">${formatNumber(group.cost)} xu</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderReviewTasksTable(tasks, allTasks = tasks) {
  const pendingCount = allTasks.filter(isPendingReviewTask).length;
  const approvedCount = allTasks.filter((task) => task.status === 'approved').length;
  const rejectedCount = allTasks.filter((task) => task.status === 'rejected').length;
  const tabLabel = {
    pending: 'Submitted/verifying cần xử lý',
    approved: 'Nhiệm vụ đã duyệt',
    rejected: 'Nhiệm vụ bị từ chối',
  }[state.reviewTaskTab] || 'Submitted/verifying cần xử lý';
  return `
    ${renderAdminDataTabs([
      { label: `Nhiệm vụ chờ duyệt (${formatNumber(pendingCount)})`, value: 'pending', active: state.reviewTaskTab === 'pending', attribute: 'data-admin-task-tab' },
      { label: `Đã duyệt (${formatNumber(approvedCount)})`, value: 'approved', active: state.reviewTaskTab === 'approved', attribute: 'data-admin-task-tab' },
      { label: `Bị từ chối (${formatNumber(rejectedCount)})`, value: 'rejected', active: state.reviewTaskTab === 'rejected', attribute: 'data-admin-task-tab' },
    ], 'Nhóm nhiệm vụ')}
    <div class="admin-data-table-summary">
      <strong>Tổng task ${formatNumber(tasks.length)}</strong>
      <span>${escapeHtml(tabLabel)}</span>
    </div>
    ${tasks.length ? `
      <div class="report-table-wrap admin-task-table-wrap">
        <table class="data-table admin-task-table">
          <thead>
            <tr>
              <th>Task ID</th>
              <th>Thao tác</th>
              <th>User submit</th>
              <th>Target</th>
              <th>Loại</th>
              <th>Bằng chứng</th>
              <th>Trạng thái</th>
              <th>Submitted_at</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.map((task) => `
              <tr>
                <td class="tabular-cell">${escapeHtml(String(task.id || task.task_id || '—'))}</td>
                <td>
                  ${isPendingReviewTask(task) ? `
                    <div class="inline-actions">
                      <button class="table-action-button" type="button" data-admin-task-action="approve" data-task-id="${escapeHtml(String(task.id || ''))}">Duyệt</button>
                      <button class="table-action-button danger-action" type="button" data-admin-task-action="reject" data-task-id="${escapeHtml(String(task.id || ''))}">Từ chối</button>
                    </div>
                  ` : '<span class="muted-text">Đã xử lý</span>'}
                </td>
                <td>
                  <strong>${escapeHtml(getUserDisplayName(task.user_profiles, task.assignee_user_id))}</strong>
                  <div class="muted-text">${escapeHtml(getUserUsernameLine(task.user_profiles, task.assignee_user_id))}</div>
                </td>
                <td class="admin-campaign-target-cell">${escapeHtml(task.ttc_campaigns?.target_url || '—')}</td>
                <td>${escapeHtml(campaignTypeLabel(task.ttc_campaigns || { interaction_type_code: task.ttc_campaigns?.interaction_type_code }))}</td>
                <td class="admin-evidence-cell">${escapeHtml(renderEvidence(task.evidence))}</td>
                <td><span class="status-pill ${task.status === 'approved' ? 'success' : task.status === 'rejected' ? 'danger' : ''}">${escapeHtml(taskStatusLabel(task.status))}</span></td>
                <td>${escapeHtml(formatDateTime(task.submitted_at || task.updated_at))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : EmptyState({
      title: `Chưa có ${tabLabel.toLowerCase()}`,
      message: 'Dữ liệu sẽ hiển thị tại đây khi có task phù hợp.',
    })}
  `;
}

function renderCheckLogsTable(logs, allLogs = logs) {
  const submitCount = allLogs.filter(isSubmitCheckLog).length;
  const verifyCount = allLogs.length - submitCount;
  const tabLabel = {
    all: 'Tất cả lịch sử submit/verify',
    submit: 'Chỉ log user submit nhiệm vụ',
    verify: 'Chỉ log kiểm tra hoặc duyệt nhiệm vụ',
  }[state.checkLogTab] || 'Tất cả lịch sử submit/verify';
  return `
    ${renderAdminDataTabs([
      { label: `Tất cả (${formatNumber(allLogs.length)})`, value: 'all', active: state.checkLogTab === 'all', attribute: 'data-admin-log-tab' },
      { label: `Submit logs (${formatNumber(submitCount)})`, value: 'submit', active: state.checkLogTab === 'submit', attribute: 'data-admin-log-tab' },
      { label: `Verify logs (${formatNumber(verifyCount)})`, value: 'verify', active: state.checkLogTab === 'verify', attribute: 'data-admin-log-tab' },
    ], 'Nhóm check logs')}
    <div class="admin-data-table-summary">
      <strong>Tổng log ${formatNumber(logs.length)}</strong>
      <span>${escapeHtml(tabLabel)}</span>
    </div>
    ${logs.length ? `
      <div class="report-table-wrap admin-log-table-wrap">
        <table class="data-table admin-log-table">
          <thead>
            <tr>
              <th>Log ID</th>
              <th>Task</th>
              <th>Campaign</th>
              <th>Loại check</th>
              <th>Trước</th>
              <th>Sau</th>
              <th>Kết quả</th>
              <th>Created_at</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((log) => `
              <tr>
                <td class="tabular-cell">${escapeHtml(String(log.id || '—'))}</td>
                <td class="tabular-cell">${escapeHtml(String(log.task_id || '—'))}</td>
                <td class="tabular-cell">${escapeHtml(String(log.campaign_id || '—'))}</td>
                <td>${escapeHtml(log.check_type || 'check')}</td>
                <td>${escapeHtml(taskStatusLabel(log.before_status))}</td>
                <td>${escapeHtml(taskStatusLabel(log.after_status))}</td>
                <td><span class="status-pill ${log.result === 'success' ? 'success' : log.result === 'failed' ? 'danger' : ''}">${escapeHtml(log.result || '—')}</span></td>
                <td>${escapeHtml(formatDateTime(log.created_at))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : EmptyState({
      title: `Chưa có ${tabLabel.toLowerCase()}`,
      message: 'Dữ liệu sẽ hiển thị tại đây khi có log phù hợp.',
    })}
  `;
}

function renderCreateCampaignTabs() {
  return renderAdminDataTabs([
    { label: 'Tạo cho user', value: 'owner', active: state.createCampaignTab === 'owner', attribute: 'data-admin-create-tab' },
    { label: 'Mục tiêu', value: 'target', active: state.createCampaignTab === 'target', attribute: 'data-admin-create-tab' },
    { label: 'Ghi chú & kiểm tra', value: 'notes', active: state.createCampaignTab === 'notes', attribute: 'data-admin-create-tab' },
  ], 'Nhóm thông tin tạo tăng tương tác');
}

function adminCreatePanelHiddenAttribute(panel) {
  return state.createCampaignTab === panel ? '' : 'hidden';
}

function renderAdminDataTabs(tabs, label) {
  return `
    <div class="admin-data-tabs" role="tablist" aria-label="${escapeHtml(label)}">
      ${tabs.map((tab) => {
        const attribute = tab.attribute || 'data-admin-campaign-tab';
        const tabAttribute = tab.value ? `${attribute}="${escapeHtml(tab.value)}"` : 'disabled';
        return `
          <button class="admin-data-tab ${tab.active ? 'active' : ''}" type="button" role="tab" aria-selected="${tab.active ? 'true' : 'false'}" ${tabAttribute}>
            ${escapeHtml(tab.label)}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function syncAdminCreateTabs() {
  document.querySelectorAll('[data-admin-create-tab]').forEach((tab) => {
    const active = tab.dataset.adminCreateTab === state.createCampaignTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-admin-create-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.adminCreatePanel !== state.createCampaignTab;
  });
}

function filterAdminCampaigns(campaigns) {
  const query = normalizeSearch(state.campaignSearchTerm);
  if (!query) return campaigns;
  return campaigns.filter((campaign) => {
    const owner = getCampaignOwner(campaign);
    const wallet = getUserWallet(owner);
    return [
      campaign.id,
      campaignTypeLabel(campaign),
      campaign.interaction_type_code,
      campaign.target_label,
      campaign.target_url,
      campaign.target_facebook_id,
      campaign.completed_count,
      campaign.target_quantity,
      campaign.status,
      campaignStatusLabel(campaign.status),
      owner?.display_name,
      owner?.username,
      owner?.email,
      owner?.phone,
      campaign.owner_user_id,
      wallet?.balance,
      campaign.created_at,
    ].map(normalizeSearch).join(' ').includes(query);
  });
}

function filterReviewTasks(tasks) {
  const query = normalizeSearch(state.reviewTaskSearchTerm);
  if (!query) return tasks;
  return tasks.filter((task) => [
    task.id,
    task.task_id,
    task.status,
    task.ttc_campaigns?.interaction_type_code,
    task.ttc_campaigns?.target_url,
    task.user_profiles?.display_name,
    task.user_profiles?.username,
    task.user_profiles?.email,
    task.assignee_user_id,
    task.submitted_at,
    task.updated_at,
    renderEvidence(task.evidence),
  ].map(normalizeSearch).join(' ').includes(query));
}

function isPendingReviewTask(task) {
  return ['submitted', 'verifying'].includes(task?.status);
}

function filterReviewTasksByTab(tasks) {
  if (state.reviewTaskTab === 'approved') {
    return tasks.filter((task) => task.status === 'approved');
  }
  if (state.reviewTaskTab === 'rejected') {
    return tasks.filter((task) => task.status === 'rejected');
  }
  return tasks.filter(isPendingReviewTask);
}

function filterCheckLogs(logs) {
  const query = normalizeSearch(state.checkLogSearchTerm);
  if (!query) return logs;
  return logs.filter((log) => [
    log.id,
    log.task_id,
    log.campaign_id,
    log.check_type,
    log.before_status,
    log.after_status,
    log.result,
    log.created_at,
  ].map(normalizeSearch).join(' ').includes(query));
}

function isSubmitCheckLog(log) {
  return normalizeSearch(log?.check_type).includes('submit');
}

function filterCheckLogsByTab(logs) {
  if (state.checkLogTab === 'submit') {
    return logs.filter(isSubmitCheckLog);
  }
  if (state.checkLogTab === 'verify') {
    return logs.filter((log) => !isSubmitCheckLog(log));
  }
  return logs;
}

function filterWalletLedger(rows) {
  const query = normalizeSearch(state.walletLedgerSearchTerm);
  if (!query) return rows;
  return rows.filter((row) => {
    const user = state.users.find((item) => item.user_id === row.wallet_user_id);
    return [
      row.id,
      row.wallet_user_id,
      user?.display_name,
      user?.username,
      user?.email,
      user?.phone,
      walletLedgerLabel(row),
      walletTransactionLabel(row.transaction_type),
      row.transaction_type,
      row.amount,
      row.balance_after,
      row.description,
      row.reason,
      row.created_at,
    ].map(normalizeSearch).join(' ').includes(query);
  });
}

function renderAdminUsers() {
  const list = document.getElementById('admin-ttc-users-list');
  if (!list) return;
  const users = filterUsers(state.users, state.userSearchTerm);
  const summary = document.getElementById('admin-ttc-user-summary');
  if (summary) {
    const totalBalance = users.reduce((sum, user) => sum + Number(getUserWallet(user)?.balance || 0), 0);
    summary.textContent = `Hiển thị ${users.length}/${state.users.length} người · Tổng ví ${formatNumber(totalBalance)} xu`;
  }
  list.innerHTML = renderUsersTable(users);
}

async function loadInteractionTypes() {
  const select = document.getElementById('admin-ttc-campaign-type');
  const settings = document.getElementById('admin-ttc-price-settings');
  if (!select && !settings) return;
  try {
    const { data } = await TtcAdminService.listInteractionTypes();
    state.interactionTypes = data || [];
    if (select) renderAdminCampaignTypeOptions();
    if (settings) renderInteractionSettingsPanel();
    syncAdminCampaignCost();
  } catch (error) {
    showMigrationNotice(error, 'cấu hình giá TTC');
    const message = isMissingDatabaseFeatureError(error) ? adminFriendlyFeatureMessage('cấu hình giá TTC') : error?.message || 'Không tải được cấu hình giá.';
    if (select) select.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
    if (settings) settings.innerHTML = EmptyState({ title: 'Không tải được bảng giá', message });
  }
}

function renderInteractionSettingsPanel() {
  const settings = document.getElementById('admin-ttc-price-settings');
  if (!settings) return;
  settings.innerHTML = renderInteractionSettings(state.interactionTypes);
}

function renderAdminCampaignTypeOptions() {
  const select = document.getElementById('admin-ttc-campaign-type');
  if (!select) return;
  const activeTypes = state.interactionTypes.filter((type) => (
    type.is_active && isFacebookInteractionType(type)
  ));
  select.innerHTML = [
    '<option value="">Chọn loại tương tác</option>',
    ...activeTypes.map((type) => `<option value="${escapeHtml(type.code)}">${escapeHtml(actionLabel(interactionAction(type), type.label || type.code))}</option>`),
  ].join('');
}

function renderUsersTable(users) {
  if (!users.length) {
    return EmptyState({
      title: 'Không tìm thấy người dùng',
      message: 'Thử tìm bằng tên, email, số điện thoại hoặc Facebook ID khác.',
    });
  }
  const totalBalance = users.reduce((sum, user) => sum + Number(getUserWallet(user)?.balance || 0), 0);
  return `
    <div class="admin-user-tabs" role="tablist" aria-label="Nhóm người dùng">
      <button class="admin-user-tab ${state.userTab === 'list' ? 'active' : ''}" type="button" role="tab" aria-selected="${state.userTab === 'list' ? 'true' : 'false'}" data-admin-user-tab="list">Danh sách người dùng</button>
      <button class="admin-user-tab ${state.userTab === 'group' ? 'active' : ''}" type="button" role="tab" aria-selected="${state.userTab === 'group' ? 'true' : 'false'}" data-admin-user-tab="group">Nhóm</button>
      <button class="admin-user-tab ${state.userTab === 'tier' ? 'active' : ''}" type="button" role="tab" aria-selected="${state.userTab === 'tier' ? 'true' : 'false'}" data-admin-user-tab="tier">Cấp bậc khách hàng</button>
    </div>
    <div class="admin-user-table-summary">
      <strong>Tổng user ${users.length}</strong>
      <span>Tổng ví: ${formatNumber(totalBalance)} xu</span>
    </div>
    ${state.userTab === 'group' ? renderUserGroupTable(users, 'status') : ''}
    ${state.userTab === 'tier' ? renderUserGroupTable(users, 'tier') : ''}
    ${state.userTab === 'list' ? renderUserDetailTable(users) : ''}
  `;
}

function renderUserDetailTable(users) {
  return `
    <div class="report-table-wrap admin-user-table-wrap">
      <table class="data-table admin-ttc-user-table">
        <thead>
          <tr>
            <th>Thao tác</th>
            <th>Tài khoản</th>
            <th>Cấp bậc</th>
            <th>Số dư hiện tại</th>
            <th>Tổng nạp tháng</th>
            <th>Tổng đã nạp</th>
            <th>Trạng thái</th>
            <th>Ngày tạo</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((user) => {
            const wallet = getUserWallet(user);
            const topupStats = getUserTopupStats(user);
            return `
              <tr>
                <td>
                  <details class="row-action-menu">
                    <summary>Thao tác</summary>
                    <div class="row-action-menu-panel">
                      <button class="table-action-button" type="button" data-admin-user-action="detail" data-user-id="${escapeHtml(user.user_id)}">Chi tiết</button>
                      <button class="table-action-button" type="button" data-admin-user-action="wallet" data-user-id="${escapeHtml(user.user_id)}">Sửa số dư</button>
                      <button class="table-action-button" type="button" data-admin-user-action="ledger" data-user-id="${escapeHtml(user.user_id)}">Nhật ký giao dịch</button>
                      <button class="table-action-button" type="button" data-admin-user-action="reset-password" data-user-id="${escapeHtml(user.user_id)}">Khôi phục mật khẩu</button>
                      <button class="table-action-button" type="button" data-admin-user-action="permissions" data-user-id="${escapeHtml(user.user_id)}">Cấp quyền</button>
                    </div>
                  </details>
                </td>
                <td class="admin-user-account-cell">
                  <strong>${escapeHtml(getUserAccountName(user))}</strong>
                </td>
                <td>${escapeHtml(userTierLabel(user))}</td>
                <td class="tabular-cell">${formatNumber(wallet?.balance ?? 0)}</td>
                <td class="tabular-cell">${formatNumber(topupStats.monthly)}</td>
                <td class="tabular-cell">${formatNumber(topupStats.total)}</td>
                <td><span class="status-pill ${user.status === 'active' ? 'success' : user.status === 'locked' ? 'danger' : ''}">${escapeHtml(userStatusLabel(user.status))}</span></td>
                <td>${escapeHtml(formatDateTime(user.created_at))}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminUserQuickAction(action, userId, panel) {
  const user = state.users.find((item) => item.user_id === userId);
  if (!user) {
    Toast.show('Không tìm thấy người dùng.');
    return;
  }
  if (action === 'detail') {
    panel?.closest('details')?.removeAttribute('open');
    openAdminUserDetail(user);
    return;
  }
  if (action === 'permissions') {
    panel?.closest('details')?.removeAttribute('open');
    openAdminUserPermissions(user);
    return;
  }
  if (!panel) return;
  panel.querySelector('.row-action-side-panel')?.remove();
  const quickPanel = document.createElement('div');
  quickPanel.className = 'row-action-side-panel';
  quickPanel.innerHTML = renderAdminUserQuickPanel(action, user);
  panel.appendChild(quickPanel);
}

function renderAdminUserQuickPanel(action, user) {
  if (action === 'wallet') return renderAdminUserQuickWallet(user);
  if (action === 'ledger') return renderAdminUserQuickLedger(user);
  if (action === 'reset-password') return renderAdminUserQuickPassword(user);
  return '';
}

function renderAdminUserQuickWallet(user) {
  return `
    <form class="quick-action-form" data-admin-user-wallet-form data-user-id="${escapeHtml(user.user_id)}">
      <div class="quick-action-head">Sửa nhanh số dư</div>
      <label class="form-group compact">
        <span>Số xu cộng/trừ</span>
        <input class="form-control" name="amount" type="number" step="1" placeholder="VD: 50000 hoặc -10000" required>
      </label>
      <label class="form-group compact">
        <span>Lý do</span>
        <select class="form-control" name="reason" required>
          <option value="">Chọn lý do</option>
          <option value="Cộng tiền thủ công">Cộng tiền thủ công</option>
          <option value="Trừ tiền">Trừ tiền</option>
          <option value="Trừ tiền vi phạm">Trừ tiền vi phạm</option>
          <option value="Khác">Khác</option>
        </select>
      </label>
      <button class="btn-primary quick-confirm-button" type="submit">Xác nhận</button>
    </form>
  `;
}

function renderAdminUserQuickLedger(user) {
  const rows = getUserLedgerRows(user.user_id).slice(0, 4);
  return `
    <div class="quick-action-head">Nhật ký gần đây</div>
    <div class="quick-ledger-list">
      ${rows.length ? rows.map((row) => {
        const amount = Number(row.amount || 0);
        return `
          <div class="quick-ledger-row">
            <strong class="${amount >= 0 ? 'wallet-positive' : 'wallet-negative'}">${amount > 0 ? '+' : ''}${escapeHtml(formatNumber(amount))}</strong>
            <span>${escapeHtml(walletLedgerLabel(row))}</span>
          </div>
        `;
      }).join('') : '<span class="quick-muted">Chưa có giao dịch gần đây.</span>'}
    </div>
    <a class="btn-secondary quick-confirm-button" href="#/admin-ttc-wallets" data-wallet-user-link="${escapeHtml(user.user_id)}">Xem đầy đủ</a>
  `;
}

function renderAdminUserQuickPassword(user) {
  return `
    <form class="quick-action-form" data-admin-user-password-form data-user-id="${escapeHtml(user.user_id)}">
      <div class="quick-action-head">Khôi phục mật khẩu</div>
      <label class="form-group compact">
        <span>Mật khẩu mới</span>
        <input class="form-control" name="password" type="password" minlength="6" autocomplete="new-password" required>
      </label>
      <label class="form-group compact">
        <span>Xác nhận</span>
        <input class="form-control" name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required>
      </label>
      <button class="btn-primary quick-confirm-button" type="submit">Xác nhận</button>
    </form>
  `;
}

function renderAdminUserQuickStatus(user) {
  return `
    <form class="quick-action-form" data-admin-user-status-form data-user-id="${escapeHtml(user.user_id)}">
      <div class="quick-action-head">Cấp quyền nhanh</div>
      <label class="form-group compact">
        <span>Trạng thái user</span>
        <select class="form-control" name="status" required>
          <option value="active" ${user.status === 'active' ? 'selected' : ''}>Hoạt động</option>
          <option value="locked" ${user.status === 'locked' ? 'selected' : ''}>Khóa tài khoản</option>
          <option value="pending_profile" ${user.status === 'pending_profile' ? 'selected' : ''}>Chờ hồ sơ</option>
        </select>
      </label>
      <p class="quick-muted">User khách hàng không được nâng thành admin tại đây.</p>
      <button class="btn-primary quick-confirm-button" type="submit">Xác nhận</button>
    </form>
  `;
}

async function submitAdminUserQuickWallet(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang lưu...';
  try {
    await TtcAdminService.adjustWallet({
      userId: form.dataset.userId,
      amount: form.elements.amount.value,
      reason: form.elements.reason.value,
      description: 'Sửa nhanh số dư từ bảng người dùng',
    });
    Toast.show('Đã cập nhật số dư.');
    await Promise.allSettled([loadWalletLedger(), loadUsers()]);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Xác nhận';
    Toast.show(error?.message || 'Không cập nhật được số dư.');
  }
}

async function submitAdminUserQuickPassword(form) {
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
    await TtcAdminService.resetUserPassword(form.dataset.userId, password);
    Toast.show('Đã đặt lại mật khẩu.');
    form.reset();
  } catch (error) {
    Toast.show(error?.message || 'Không đặt lại được mật khẩu.');
  } finally {
    button.disabled = false;
    button.textContent = 'Xác nhận';
  }
}

async function submitAdminUserQuickStatus(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang lưu...';
  try {
    await TtcAdminService.updateUserStatus(form.dataset.userId, form.elements.status.value);
    Toast.show('Đã cập nhật trạng thái user.');
    await loadUsers();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Xác nhận';
    Toast.show(error?.message || 'Không cập nhật được trạng thái.');
  }
}

function openAdminUserDetail(user) {
  const wallet = getUserWallet(user);
  const facebookAccounts = Array.isArray(user.user_facebook_accounts) ? user.user_facebook_accounts : [];
  const username = getUserAccountName(user);
  const creditLimit = getUserCreditLimit(user);
  Modal.open({
    title: `Thông tin người dùng: ${username}`,
    className: 'modal-wide',
    body: `
      <div class="admin-user-modal-profile">
        <img class="admin-user-modal-avatar" src="${escapeHtml(getUserAvatarPath(user))}" alt="" loading="lazy">
        <div class="admin-user-modal-status-line">
          <span class="status-pill ${user.status === 'active' ? 'success' : user.status === 'locked' ? 'danger' : ''}">${escapeHtml(userStatusLabel(user.status))}</span>
          <span>${escapeHtml(formatDateTime(user.created_at))}</span>
        </div>
      </div>
      <form id="admin-user-detail-form" class="modal-form admin-user-detail-form" data-user-id="${escapeHtml(user.user_id)}">
        <label class="form-group"><span>Username</span><input class="form-control" value="${escapeHtml(username)}" readonly></label>
        <div class="form-row">
          <label class="form-group"><span>Họ tên</span><input class="form-control" name="displayName" value="${escapeHtml(user.display_name || 'NoName')}"></label>
          <label class="form-group"><span>Email</span><input class="form-control" name="email" type="email" value="${escapeHtml(user.email || '')}"></label>
        </div>
        <div class="form-row">
          <label class="form-group"><span>Số điện thoại</span><input class="form-control" name="phone" value="${escapeHtml(user.phone || '')}"></label>
          <label class="form-group"><span>Số dư</span><input class="form-control" name="balance" type="number" step="1" value="${escapeHtml(String(Number(wallet?.balance ?? 0)))}"></label>
        </div>
        <div class="form-row">
          <label class="form-group">
            <span>Tình trạng</span>
            <select class="form-control" name="status">
              <option value="active" ${user.status === 'active' ? 'selected' : ''}>Đang hoạt động</option>
              <option value="locked" ${user.status === 'locked' ? 'selected' : ''}>Đã khóa</option>
              <option value="pending_profile" ${user.status === 'pending_profile' ? 'selected' : ''}>Chờ hồ sơ</option>
            </select>
          </label>
          <label class="form-group"><span>Hạn mức</span><input class="form-control" name="creditLimit" type="number" step="1" min="0" value="${escapeHtml(String(creditLimit))}"></label>
        </div>
        <div class="form-row">
          <label class="form-group">
            <span>Cấp bậc</span>
            <select class="form-control" name="tier">
              ${renderUserTierOptions(user)}
            </select>
          </label>
          <label class="form-group"><span>Facebook ID</span><input class="form-control" value="${escapeHtml(facebookAccounts.map((account) => account.facebook_id).filter(Boolean).join(', ') || '')}" readonly></label>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-admin-user-detail-close>Đóng</button>
          <button class="btn-primary" type="submit">Cập nhật</button>
        </div>
      </form>
    `,
  });
  document.querySelector('[data-admin-user-detail-close]')?.addEventListener('click', Modal.close);
  document.getElementById('admin-user-detail-form')?.addEventListener('submit', submitAdminUserDetail);
}

async function submitAdminUserDetail(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const user = state.users.find((item) => item.user_id === form.dataset.userId);
  if (!user) {
    Toast.show('Không tìm thấy người dùng.');
    return;
  }
  const wallet = getUserWallet(user);
  const values = Object.fromEntries(new FormData(form));
  const nextBalance = Number(values.balance || 0);
  const currentBalance = Number(wallet?.balance || 0);
  const creditLimit = Number(values.creditLimit || 0);
  if (!Number.isFinite(nextBalance) || nextBalance < 0) {
    Toast.show('Số dư không hợp lệ.');
    form.elements.balance?.focus();
    return;
  }
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    Toast.show('Hạn mức không hợp lệ.');
    form.elements.creditLimit?.focus();
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang cập nhật...';
  try {
    await TtcAdminService.updateUserProfile(user.user_id, {
      displayName: values.displayName,
      email: values.email,
      phone: values.phone,
      status: values.status,
      metadataPatch: {
        tier: values.tier || 'customer',
        credit_limit: creditLimit,
      },
    });

    const balanceDelta = nextBalance - currentBalance;
    if (balanceDelta !== 0) {
      await TtcAdminService.adjustWallet({
        userId: user.user_id,
        amount: balanceDelta,
        reason: 'Admin cập nhật số dư trong chi tiết user',
        description: 'Cập nhật số dư từ modal chi tiết',
      });
    }

    Modal.close();
    Toast.show('Đã cập nhật thông tin người dùng.');
    await Promise.allSettled([loadUsers(), loadWalletLedger()]);
  } catch (error) {
    Toast.show(error?.message || 'Không cập nhật được thông tin người dùng.');
  } finally {
    button.disabled = false;
    button.textContent = 'Cập nhật';
  }
}

function openAdminUserPasswordReset(user) {
  const username = getUserAccountName(user);
  Modal.open({
    title: 'Khôi phục mật khẩu',
    body: `
      <form id="admin-user-reset-password-form" class="modal-form">
        <p class="modal-note">Đặt lại mật khẩu đăng nhập cho ${escapeHtml(username)}. User sẽ dùng mật khẩu mới để đăng nhập bằng username, SĐT hoặc email.</p>
        <label class="form-group">
          <span>Mật khẩu mới</span>
          <input class="form-control" name="password" type="password" minlength="6" autocomplete="new-password" required>
        </label>
        <label class="form-group">
          <span>Xác nhận mật khẩu</span>
          <input class="form-control" name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required>
        </label>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-modal-close>Hủy</button>
          <button class="btn-primary" type="submit">Đặt lại mật khẩu</button>
        </div>
      </form>
    `,
  });
  document.getElementById('admin-user-reset-password-form')?.addEventListener('submit', async (event) => {
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
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Đang xử lý...';
    try {
      await TtcAdminService.resetUserPassword(user.user_id, password);
      Modal.close();
      Toast.show('Đã đặt lại mật khẩu người dùng.');
    } catch (error) {
      Toast.show(error?.message || 'Không đặt lại được mật khẩu.');
      submitButton.disabled = false;
      submitButton.textContent = 'Đặt lại mật khẩu';
    }
  });
  document.querySelector('#admin-user-reset-password-form [data-modal-close]')?.addEventListener('click', Modal.close);
}

function openAdminUserPermissions(user) {
  const selectedPermissions = getUserAdminPermissions(user);
  const username = getUserAccountName(user);
  Modal.open({
    title: 'Cấp quyền',
    className: 'modal-wide',
    body: `
      <form id="admin-user-permissions-form" class="modal-form admin-user-permissions-form" data-user-id="${escapeHtml(user.user_id)}">
        <div class="admin-user-permission-account">Tài khoản: <strong>${escapeHtml(username)}</strong></div>
        <div class="admin-user-permission-grid">
          ${USER_PERMISSION_ROUTES.map((route) => `
            <label class="admin-user-permission-check">
              <input type="checkbox" name="permissions" value="${escapeHtml(route)}" ${selectedPermissions.includes(route) ? 'checked' : ''}>
              <span>${escapeHtml(permissionLabel(route))}</span>
            </label>
          `).join('')}
        </div>
        <label class="form-group admin-user-password-confirm">
          <span>Xác nhận mật khẩu</span>
          <input class="form-control" name="password" type="password" placeholder="Nhập mật khẩu để xác nhận cấp quyền" autocomplete="current-password" required>
          <small>Vui lòng nhập mật khẩu tài khoản của bạn để xác nhận thay đổi quyền.</small>
        </label>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-admin-user-permissions-close>Đóng</button>
          <button class="btn-primary" type="submit">Lưu</button>
        </div>
      </form>
    `,
  });
  document.querySelector('[data-admin-user-permissions-close]')?.addEventListener('click', Modal.close);
  document.getElementById('admin-user-permissions-form')?.addEventListener('submit', submitAdminUserPermissions);
}

async function submitAdminUserPermissions(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const user = state.users.find((item) => item.user_id === form.dataset.userId);
  if (!user) {
    Toast.show('Không tìm thấy người dùng.');
    return;
  }
  const password = form.elements.password.value;
  const permissions = Array.from(form.querySelectorAll('input[name="permissions"]:checked')).map((input) => input.value);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang lưu...';
  try {
    await TtcAdminService.confirmCurrentAdminPassword(password);
    await TtcAdminService.updateUserProfile(user.user_id, {
      metadataPatch: {
        admin_permissions: permissions,
        admin_permissions_updated_at: new Date().toISOString(),
      },
    });
    Modal.close();
    Toast.show('Đã lưu quyền người dùng.');
    await loadUsers();
  } catch (error) {
    Toast.show(error?.message || 'Không lưu được quyền người dùng.');
  } finally {
    button.disabled = false;
    button.textContent = 'Lưu';
  }
}

function renderAdminUserModalStat(label, value) {
  return `
    <div class="admin-user-modal-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? '—'))}</strong>
    </div>
  `;
}

function getUserGroupRows(users, groupBy) {
  const groups = new Map();
  users.forEach((user) => {
    const wallet = getUserWallet(user);
    const facebookAccounts = Array.isArray(user.user_facebook_accounts) ? user.user_facebook_accounts : [];
    const hasFacebookId = facebookAccounts.some((account) => Boolean(account.facebook_id));
    const key = groupBy === 'tier' ? userTierLabel(user) : userStatusLabel(user.status);
    const current = groups.get(key) || {
      label: key,
      count: 0,
      facebookCount: 0,
      balance: 0,
      earned: 0,
      spent: 0,
    };
    current.count += 1;
    current.facebookCount += hasFacebookId ? 1 : 0;
    current.balance += Number(wallet?.balance || 0);
    current.earned += Number(wallet?.total_earned || 0);
    current.spent += Number(wallet?.total_spent || 0);
    groups.set(key, current);
  });
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function renderUserGroupTable(users, groupBy) {
  const rows = getUserGroupRows(users, groupBy);
  const firstColumn = groupBy === 'tier' ? 'Cấp bậc khách hàng' : 'Nhóm';
  return `
    <div class="report-table-wrap admin-user-table-wrap">
      <table class="data-table admin-user-group-table">
        <thead>
          <tr>
            <th>${escapeHtml(firstColumn)}</th>
            <th>Số user</th>
            <th>Có Facebook ID</th>
            <th>Tổng ví</th>
            <th>Tổng kiếm</th>
            <th>Tổng đã dùng</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((group) => `
            <tr>
              <td><strong>${escapeHtml(group.label)}</strong></td>
              <td class="tabular-cell">${formatNumber(group.count)}</td>
              <td class="tabular-cell">${formatNumber(group.facebookCount)}</td>
              <td class="tabular-cell">${formatNumber(group.balance)} xu</td>
              <td class="tabular-cell">${formatNumber(group.earned)} xu</td>
              <td class="tabular-cell">${formatNumber(group.spent)} xu</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function filterUsers(users, searchTerm) {
  const normalized = normalizeSearch(searchTerm);
  if (!normalized) return users;
  return users.filter((user) => {
    const wallet = Array.isArray(user.wallets) ? user.wallets[0] : user.wallets;
    const facebookAccounts = Array.isArray(user.user_facebook_accounts) ? user.user_facebook_accounts : [];
    const haystack = [
      user.display_name,
      user.username,
      user.email,
      user.phone,
      user.status,
      user.user_id,
      wallet?.balance,
      ...facebookAccounts.map((account) => account.facebook_id),
    ].map(normalizeSearch).join(' ');
    return haystack.includes(normalized);
  });
}

function getUserDisplayName(user, fallbackId = '') {
  return user?.display_name || user?.username || user?.email || user?.phone || shortUserId(fallbackId || user?.user_id);
}

function getUserAccountName(user) {
  return (
    user?.username
    || user?.metadata?.username
    || user?.metadata?.auth_username
    || user?.metadata?.login_username
    || user?.email?.split('@')[0]
    || user?.phone
    || user?.display_name
    || 'Chưa có username'
  );
}

function getUserUsernameLine(user, fallbackId = '') {
  const username = getUserAccountName(user);
  if (username && username !== 'Chưa có username') return `username - ${username}`;
  return user?.email || user?.phone || fallbackId || user?.user_id || 'Chưa có username';
}

function formatUserOptionLabel(user) {
  const name = getUserDisplayName(user);
  const username = getUserUsernameLine(user);
  return `${name} - ${username}`;
}

function getUserWallet(user) {
  return Array.isArray(user?.wallets) ? user.wallets[0] : user?.wallets;
}

function getUserLedgerRows(userId) {
  return state.walletLedger.filter((row) => row.wallet_user_id === userId);
}

function getUserTopupStats(user) {
  const wallet = getUserWallet(user);
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const rows = getUserLedgerRows(user.user_id).filter(isUserTopupLedgerRow);
  const totalFromLedger = rows.reduce((sum, row) => sum + Math.max(Number(row.amount || 0), 0), 0);
  const monthly = rows.reduce((sum, row) => {
    const createdAt = new Date(row.created_at);
    if (createdAt.getMonth() !== currentMonth || createdAt.getFullYear() !== currentYear) return sum;
    return sum + Math.max(Number(row.amount || 0), 0);
  }, 0);
  return {
    monthly,
    total: totalFromLedger || Number(wallet?.total_earned || 0),
  };
}

function isUserTopupLedgerRow(row) {
  const amount = Number(row?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const type = String(row?.transaction_type || '').toLowerCase();
  return (
    type.includes('topup')
    || type.includes('deposit')
    || type.includes('payos')
    || type === 'admin_adjustment'
    || type === 'bonus_signup'
  );
}

function getCampaignOwner(campaign) {
  const ownerUserId = campaign?.owner_user_id;
  const matchedUser = state.users.find((user) => user.user_id === ownerUserId);
  if (matchedUser) return matchedUser;
  const profile = Array.isArray(campaign?.user_profiles) ? campaign.user_profiles[0] : campaign?.user_profiles;
  return profile ? { ...profile, user_id: ownerUserId } : null;
}

function shortUserId(userId) {
  const id = String(userId || '');
  if (!id) return '—';
  return id.split('-')[0] || id.slice(0, 8);
}

function userTierLabel(user) {
  if (user?.status === 'locked') return 'Bị khóa';
  return {
    customer: 'Khách hàng',
    silver: 'Bạc',
    gold: 'Vàng',
    diamond: 'Kim cương',
  }[user?.metadata?.tier] || 'Khách hàng';
}

function renderUserTierOptions(user) {
  const selectedTier = user?.metadata?.tier || 'customer';
  return [
    ['customer', 'Khách hàng'],
    ['silver', 'Bạc'],
    ['gold', 'Vàng'],
    ['diamond', 'Kim cương'],
  ].map(([value, label]) => `<option value="${value}" ${selectedTier === value ? 'selected' : ''}>${label}</option>`).join('');
}

function getUserCreditLimit(user) {
  const value = Number(user?.metadata?.credit_limit ?? 5000000);
  return Number.isFinite(value) && value >= 0 ? value : 5000000;
}

function getUserAdminPermissions(user) {
  const permissions = user?.metadata?.admin_permissions;
  return Array.isArray(permissions) ? permissions.filter((permission) => USER_PERMISSION_ROUTES.includes(permission)) : [];
}

function permissionLabel(route) {
  const labels = {
    dashboard: 'Quản lý thống kê',
    reports: 'Quản lý báo cáo',
    customers: 'Quản lý khách hàng',
    kiosks: 'Quản lý Kiosk',
    'legacy-registration': 'Quản lý dữ liệu cũ',
    payments: 'Quản lý giao dịch',
    categories: 'Quản lý nguồn',
    'business-types': 'Quản lý ngành',
    'registration-requests': 'Quản lý đơn hàng',
    'admin-ttc': 'Quản lý TTC',
    'admin-ttc-campaigns': 'Quản lý dịch vụ',
    'admin-ttc-announcements': 'Quản lý thông báo',
    'admin-ttc-tasks': 'Quản lý nhiệm vụ',
    'admin-ttc-users': 'Quản lý người dùng',
    'admin-ttc-wallets': 'Quản lý ví xu',
    'admin-ttc-settings': 'Quản lý bảng giá',
    'admin-ttc-logs': 'Quản lý vi phạm',
    logs: 'Quản lý nhật ký',
    settings: 'Cài đặt hệ thống',
  };
  return labels[route] || PAGE_TITLES[route] || route;
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function renderInteractionSettings(types) {
  if (!types.length) {
    return EmptyState({ title: 'Chưa có loại tương tác', message: 'Bảng ttc_interaction_types chưa có dữ liệu.' });
  }
  const visibleTypes = types.filter(isFacebookInteractionType);
  const hiddenCount = types.length - visibleTypes.length;
  if (!visibleTypes.length) {
    return EmptyState({ title: 'Chưa có bảng giá Facebook', message: 'Cần bật các mã facebook_* trong ttc_interaction_types.' });
  }
  const filteredTypes = filterInteractionSettings(visibleTypes);
  if (!filteredTypes.length) {
    return EmptyState({ title: 'Không tìm thấy cấu hình giá', message: 'Thử tìm bằng mã, tên tương tác, giá hoặc trạng thái khác.' });
  }
  return `
    ${hiddenCount ? `<div class="notice warning admin-price-legacy-note">
      <strong>Đã ẩn ${hiddenCount} cấu hình ngoài scope</strong>
      <span>Bản này chỉ mở tương tác Facebook theo brief chính thức của khách hàng.</span>
    </div>` : ''}
    <div class="admin-price-grid">
      ${filteredTypes.map((type) => `
        <form class="admin-price-card" data-admin-price-form="${escapeHtml(type.code)}">
          <div class="admin-price-card-head">
            <div>
              <strong>${escapeHtml(type.code)}</strong>
              <div class="muted-text">${escapeHtml(platformLabel(interactionPlatform(type)))} · ${escapeHtml(actionLabel(interactionAction(type), type.label || type.code))}</div>
            </div>
            <label class="toggle-row">
              <input type="checkbox" name="isActive" ${type.is_active ? 'checked' : ''}>
              <span>Đang bật</span>
            </label>
          </div>
          <label class="form-group"><span>Tên hiển thị</span><input class="form-control" name="label" value="${escapeHtml(type.label || '')}" required></label>
          <div class="form-row">
            <label class="form-group"><span>Giá mua / lượt</span><input class="form-control" name="unitCost" type="number" min="0" step="1" value="${escapeHtml(type.unit_cost ?? 0)}" required></label>
            <label class="form-group"><span>Xu thưởng / nhiệm vụ</span><input class="form-control" name="workerReward" type="number" min="0" step="1" value="${escapeHtml(type.worker_reward ?? 0)}" required></label>
          </div>
          <div class="form-row">
            <label class="form-group"><span>Tối thiểu</span><input class="form-control" name="minQuantity" type="number" min="1" step="1" value="${escapeHtml(type.min_quantity ?? 1)}" required></label>
            <label class="form-group"><span>Tối đa</span><input class="form-control" name="maxQuantity" type="number" min="1" step="1" value="${escapeHtml(type.max_quantity ?? 1000)}" required></label>
          </div>
          <label class="form-group"><span>Giữ nhiệm vụ (giây)</span><input class="form-control" name="holdSeconds" type="number" min="0" step="1" value="${escapeHtml(type.hold_seconds ?? 0)}" required></label>
          <div class="form-actions"><button class="btn-primary compact-button" type="submit">Lưu giá</button></div>
        </form>
      `).join('')}
    </div>
  `;
}

function filterInteractionSettings(types) {
  const term = normalizeSearch(state.priceSearchTerm);
  if (!term) return types;
  return types.filter((type) => [
    type.code,
    type.label,
    platformLabel(interactionPlatform(type)),
    actionLabel(interactionAction(type), type.label || type.code),
    type.is_active ? 'đang bật active enabled' : 'đang tắt inactive disabled',
    type.unit_cost,
    type.worker_reward,
    type.min_quantity,
    type.max_quantity,
  ].some((value) => normalizeSearch(value).includes(term)));
}

async function verifyTask(taskId, action, button) {
  const reason = action === 'reject'
    ? window.prompt('Nhập lý do từ chối nhiệm vụ:')
    : window.prompt('Nhập ghi chú duyệt nhiệm vụ:', 'Nhiệm vụ hợp lệ');
  if (!reason) return;
  state.processingTaskId = taskId;
  button.disabled = true;
  button.textContent = action === 'approve' ? 'Đang duyệt...' : 'Đang từ chối...';
  try {
    await TtcAdminService.verifyTask(taskId, action, reason, {
      source: 'admin_ttc_page',
    });
    Toast.show(action === 'approve' ? 'Đã duyệt và cộng xu.' : 'Đã từ chối nhiệm vụ.');
    await Promise.allSettled([loadReviewTasks(), loadCheckLogs(), loadCampaigns()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? adminFriendlyFeatureMessage('duyệt nhiệm vụ TTC')
      : error?.message || 'Không xử lý được nhiệm vụ.');
  } finally {
    state.processingTaskId = null;
    button.disabled = false;
    button.textContent = action === 'approve' ? 'Duyệt cộng xu' : 'Từ chối';
  }
}

async function adjustWallet(form) {
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang ghi...';
  try {
    await TtcAdminService.adjustWallet({
      userId: values.userId,
      amount: values.amount,
      description: values.description,
      reason: values.reason,
      metadata: { source: 'admin_ttc_page' },
    });
    Toast.show('Đã ghi giao dịch ví.');
    form.reset();
    await Promise.allSettled([loadUsers(), loadWalletLedger()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? adminFriendlyFeatureMessage('điều chỉnh ví TTC')
      : error?.message || 'Không thể điều chỉnh ví.');
  } finally {
    button.disabled = false;
    button.textContent = 'Ghi giao dịch ví';
  }
}

async function createAdminCampaign(form) {
  const values = Object.fromEntries(new FormData(form));
  const interactionType = getAdminInteractionType(values.interactionType);
  const quantity = Number(values.targetQuantity || 0);
  const ownerUserId = String(values.ownerUserId || '').trim();
  if (!ownerUserId) {
    switchAdminCreateTabForField('ownerUserId');
    Toast.show('Vui lòng chọn user owner để tạo tăng tương tác.');
    return;
  }
  if (!interactionType) {
    switchAdminCreateTabForField('interactionType');
    Toast.show('Vui lòng chọn loại tương tác.');
    return;
  }
  if (!Number.isInteger(quantity) || quantity < Number(interactionType.min_quantity || 1) || quantity > Number(interactionType.max_quantity || 1000)) {
    switchAdminCreateTabForField('targetQuantity');
    Toast.show(`Số lượng phải từ ${interactionType.min_quantity} đến ${interactionType.max_quantity}.`);
    return;
  }
  const targetValidation = validateCampaignTargetUrl(interactionType, values.targetUrl);
  if (!targetValidation.valid) {
    switchAdminCreateTabForField('targetUrl');
    Toast.show(targetValidation.message);
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang tạo...';
  try {
    await TtcAdminService.createCampaignForUser({
      ownerUserId,
      interactionType: interactionType.code,
      targetUrl: values.targetUrl,
      targetQuantity: quantity,
      targetFacebookId: values.targetFacebookId || null,
      targetLabel: values.targetLabel,
      commentOptions: parseCommentOptions(values.commentOptions),
      reason: values.reason,
      metadata: {
        source: 'admin_ttc_page',
        platform: interactionPlatform(interactionType),
        action: interactionAction(interactionType),
      },
    });
    Toast.show('Đã tạo tăng tương tác.');
    form.reset();
    state.createCampaignTab = 'owner';
    syncAdminCreateTabs();
    await Promise.allSettled([loadCampaigns(), loadInteractionTypes()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? adminFriendlyFeatureMessage('tạo tăng tương tác')
      : error?.message || 'Không thể tạo tăng tương tác.');
  } finally {
    button.disabled = false;
    button.textContent = 'Tạo tăng tương tác';
    syncAdminCampaignCost();
  }
}

function switchAdminCreateTabForField(fieldName) {
  const tabByField = {
    ownerUserId: 'owner',
    interactionType: 'owner',
    targetQuantity: 'owner',
    targetUrl: 'target',
    targetFacebookId: 'target',
    targetLabel: 'target',
    commentOptions: 'notes',
    reason: 'notes',
  };
  state.createCampaignTab = tabByField[fieldName] || 'owner';
  syncAdminCreateTabs();
  requestAnimationFrame(() => {
    const field = document.querySelector(`#admin-ttc-create-campaign-form [name="${fieldName}"]`);
    if (field && typeof field.focus === 'function') field.focus();
  });
}

function openCancelCampaignModal(campaignId) {
  const campaign = state.campaigns.find((item) => String(item.id) === String(campaignId));
  if (!campaign) {
    Toast.show('Không tìm thấy đơn tăng tương tác để hủy.');
    return;
  }
  const remainingCount = Math.max(0, Number(campaign.target_quantity || 0) - Number(campaign.completed_count || 0));
  const refundableAmount = Math.max(0, Number(campaign.reserved_amount || 0) - Number(campaign.spent_amount || 0) - Number(campaign.refunded_amount || 0));
  Modal.open({
    title: 'Hủy/hoàn tiền tăng tương tác',
    body: `
      <form id="admin-cancel-campaign-form" class="stacked-form">
        <p class="muted-text">Đơn #${escapeHtml(String(campaign.id || '—'))} còn ${formatNumber(remainingCount)} lượt chưa chạy. Hệ thống sẽ gọi RPC hủy chiến dịch và hoàn phần xu còn lại nếu có.</p>
        <div class="admin-cancel-campaign-summary">
          <span>Đã chạy <strong>${formatNumber(campaign.completed_count || 0)}/${formatNumber(campaign.target_quantity || 0)}</strong></span>
          <span>Dự kiến hoàn <strong>${formatNumber(refundableAmount)} xu</strong></span>
        </div>
        <label class="form-group">
          <span>Lý do hủy *</span>
          <textarea class="form-control" name="reason" rows="3" placeholder="Ví dụ: user yêu cầu hủy đơn, link sai, hoặc hoàn phần còn lại" required></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-cancel-campaign-close>Đóng</button>
          <button class="btn-danger" type="submit">Hủy và hoàn tiền</button>
        </div>
      </form>
    `,
  });
  document.querySelector('[data-cancel-campaign-close]')?.addEventListener('click', Modal.close);
  document.getElementById('admin-cancel-campaign-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await cancelAdminCampaign(campaign.id, event.currentTarget);
  });
}

async function cancelAdminCampaign(campaignId, form) {
  const reason = new FormData(form).get('reason')?.trim() || '';
  if (!reason) {
    Toast.show('Vui lòng nhập lý do hủy chiến dịch.');
    form.querySelector('[name="reason"]')?.focus();
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang hủy...';
  try {
    await TtcAdminService.cancelCampaign(campaignId, reason);
    Modal.close();
    Toast.show('Đã hủy đơn và hoàn xu phần còn lại.');
    await Promise.allSettled([loadCampaigns(), loadUsers(), loadWalletLedger()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? adminFriendlyFeatureMessage('hủy/hoàn tiền tăng tương tác')
      : error?.message || 'Không thể hủy đơn tăng tương tác.');
  } finally {
    button.disabled = false;
    button.textContent = 'Hủy và hoàn tiền';
  }
}

async function updateInteractionType(form) {
  const code = form.dataset.adminPriceForm;
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang lưu...';
  try {
    await TtcAdminService.updateInteractionType(code, {
      ...values,
      isActive: values.isActive === 'on',
    });
    Toast.show(`Đã cập nhật giá ${code}.`);
    await loadInteractionTypes();
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? adminFriendlyFeatureMessage('cấu hình giá TTC')
      : error?.message || 'Không thể cập nhật bảng giá.');
  } finally {
    button.disabled = false;
    button.textContent = 'Lưu giá';
  }
}

function syncAdminCampaignCost() {
  const summary = document.getElementById('admin-ttc-campaign-cost');
  const quantityInput = document.getElementById('admin-ttc-campaign-quantity');
  const typeCode = document.getElementById('admin-ttc-campaign-type')?.value || '';
  const commentField = document.querySelector('[data-admin-comment-options-field]');
  if (!summary) return;
  const interactionType = getAdminInteractionType(typeCode);
  const quantity = Number(quantityInput?.value || 0);
  if (commentField) commentField.hidden = interactionAction(interactionType) !== 'comment';
  if (!interactionType || !Number.isFinite(quantity) || quantity < 1) {
    summary.textContent = 'Chọn loại tương tác để xem đơn giá.';
    return;
  }
  const unitCost = Number(interactionType.unit_cost || 0);
  const reward = Number(interactionType.worker_reward || 0);
  summary.innerHTML = `
    <span>Giá mua: <strong>${unitCost}</strong> xu/lượt</span>
    <span>Xu thưởng: <strong>${reward}</strong> xu/nhiệm vụ</span>
    <span>Tổng tạm tính: <strong>${unitCost * quantity}</strong> xu</span>
  `;
}

function getAdminInteractionType(code) {
  return state.interactionTypes.find((type) => type.code === code) || null;
}

function interactionPlatform(type) {
  const code = String(type?.code || '');
  if (type?.config?.platform) return type.config.platform;
  return code.includes('_') ? code.split('_')[0] : 'facebook';
}

function isFacebookInteractionType(type) {
  return interactionPlatform(type) === 'facebook' && String(type?.code || '').startsWith('facebook_');
}

function interactionAction(type) {
  const code = String(type?.code || '');
  if (type?.config?.action) return type.config.action;
  return code.replace(/^facebook_/, '') || code;
}

function platformLabel(platform) {
  return platform === 'facebook' ? 'Facebook' : platform || 'Khác';
}

function actionLabel(action, fallback = '') {
  return {
    like: 'Tăng like',
    follow: 'Tăng follow',
    comment: 'Tăng comment',
    reaction: 'Tăng cảm xúc',
    share: 'Share',
    join_group: 'Join group',
    subscribe: 'Tăng subscribe',
  }[action] || fallback || action || 'Tương tác';
}

function validateCampaignTargetUrl(interactionType, targetUrl) {
  const action = interactionAction(interactionType);
  const url = String(targetUrl || '').trim();
  if (!url) return { valid: false, message: 'Vui lòng nhập link mục tiêu.' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, message: 'Link mục tiêu không hợp lệ.' };
  }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) {
    return { valid: false, message: 'Link mục tiêu phải là link Facebook.' };
  }
  if (['like', 'reaction', 'comment', 'share'].includes(action) && !isFacebookContentUrl(parsed)) {
    return {
      valid: false,
      message: 'Nhiệm vụ like/cảm xúc/comment/share phải dùng link bài viết, ảnh, video, reel hoặc story cụ thể.',
    };
  }
  return { valid: true };
}

function isFacebookContentUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  if (path === '/story.php' && parsed.searchParams.get('story_fbid')) return true;
  return [
    '/posts/',
    '/videos/',
    '/reel/',
    '/photo/',
    '/photos/',
    '/permalink.php',
    '/watch/',
    '/share/p/',
    '/share/v/',
    '/share/r/',
  ].some((part) => path.includes(part));
}

function campaignTypeLabel(campaign) {
  const type = campaign?.ttc_interaction_types;
  if (type?.config?.platform || type?.config?.action) {
    return scopedInteractionLabel({
      code: campaign.interaction_type_code,
      label: type.label,
      config: type.config,
    });
  }
  const matched = state.interactionTypes.find((item) => item.code === campaign?.interaction_type_code);
  if (matched) return scopedInteractionLabel(matched);
  return type?.label || campaign?.interaction_type_code || 'TTC';
}

function scopedInteractionLabel(type) {
  const label = actionLabel(interactionAction(type), type?.label || type?.code);
  return interactionPlatform(type) === 'facebook' ? label : `${platformLabel(interactionPlatform(type))} - ${label}`;
}

function parseCommentOptions(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function userStatusLabel(status) {
  return {
    active: 'Hoạt động',
    locked: 'Đã khóa',
    pending_profile: 'Chờ hồ sơ',
  }[status] || status || 'Không rõ';
}

function campaignStatusLabel(status) {
  return {
    draft: 'Nháp',
    queued: 'Đang chờ',
    running: 'Đang chạy',
    paused: 'Tạm dừng',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
    failed: 'Lỗi',
  }[status] || status || 'Không rõ';
}

function campaignStatusClass(status) {
  return {
    completed: 'success',
    cancelled: 'danger',
    failed: 'danger',
  }[status] || '';
}

function taskStatusLabel(status) {
  return {
    available: 'Có thể nhận',
    assigned: 'Đã nhận',
    submitted: 'Chờ duyệt',
    verifying: 'Đang kiểm tra',
    completed: 'Hoàn thành',
    rejected: 'Từ chối',
    expired: 'Hết hạn',
  }[status] || status || 'Không rõ';
}

function walletTransactionLabel(type) {
  return {
    earn_task: 'Nhận nhiệm vụ',
    spend_campaign: 'Tạo tăng tương tác',
    bonus_signup: 'Thưởng đăng ký',
    admin_adjustment: 'Admin điều chỉnh',
    refund_campaign: 'Hoàn tăng tương tác',
    spend_kiosk: 'Mua Kiosk',
    refund_kiosk: 'Hoàn Kiosk',
  }[type] || type || 'Giao dịch';
}

function walletLedgerLabel(row = {}) {
  if (String(row.related_table || '') === 'payos_orders') return 'Nạp xu PayOS';
  return walletTransactionLabel(row.transaction_type);
}

function renderEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return 'Không có bằng chứng.';
  return evidence.text || JSON.stringify(evidence);
}

function showMigrationNotice(error, featureName) {
  if (!isMissingDatabaseFeatureError(error)) return;
  const notice = document.getElementById('admin-ttc-migration-notice');
  if (!notice) return;
  notice.innerHTML = `
    <div class="notice warning">
      <strong>Dữ liệu đang được đồng bộ</strong>
      <span>${escapeHtml(adminFriendlyFeatureMessage(featureName))}</span>
    </div>
  `;
}

function adminFriendlyFeatureMessage(featureName) {
  const name = String(featureName || 'chức năng này');
  return `${name} đang được cập nhật dữ liệu. Vui lòng kiểm tra lại cấu hình hoặc thử lại sau.`;
}
