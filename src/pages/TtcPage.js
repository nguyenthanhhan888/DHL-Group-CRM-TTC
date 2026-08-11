import { EmptyState } from '../components/EmptyState.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from '../components/FacebookIdResolver.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { TtcService } from '../services/TtcService.js';
import { UserProfileService } from '../services/UserProfileService.js';
import { WalletService } from '../services/WalletService.js';
import { isMissingDatabaseFeatureError } from '../utils/databaseFeature.js';
import { formatDateTime } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

const FACEBOOK_ACTIONS = ['like', 'follow', 'comment', 'reaction', 'share', 'join_group'];
const OPENED_TASKS_STORAGE_KEY = 'dhlOpenedTtcTasks';

const state = {
  facebookAccounts: [],
  interactionTypes: [],
  selectedFacebookAccountId: '',
  wallet: null,
  availableTasks: [],
  myTasks: [],
  myCampaigns: [],
  processingTaskId: null,
  activeTab: 'profile',
  taskInteractionType: '',
  requestedAction: '',
  campaignSearchTerm: '',
  campaignStatusFilter: '',
  campaignServiceFilter: '',
  campaignDateFrom: '',
  campaignDateTo: '',
  availableTaskSearchTerm: '',
  myTaskSearchTerm: '',
  walletHistorySearchTerm: '',
  walletLedger: [],
  campaignWorkflowTab: 'create',
  openedTaskKeys: loadOpenedTaskKeys(),
};

const TTC_ROUTE_CONFIG = {
  ttc: {
    tab: 'profile',
    title: 'Tổng quan tương tác chéo',
    description: 'Ví xu và Facebook ID dùng để nhận nhiệm vụ, tạo tăng tương tác và theo dõi giao dịch.',
  },
  'ttc-earn': {
    tab: 'tasks',
    title: 'Kiếm xu',
    description: 'Chọn loại nhiệm vụ Facebook như like, follow, comment để nhận việc phù hợp.',
  },
  'ttc-campaign-create': {
    tab: 'boost',
    title: 'Tăng Tương Tác',
    description: 'Chọn loại tương tác Facebook, nhập link mục tiêu và số lượng; hệ thống tự trừ xu theo đơn giá cấu hình.',
    mode: 'create-campaign',
  },
  'ttc-campaigns': {
    tab: 'boost',
    title: 'Tăng tương tác của tôi',
    description: 'Quản lý các chiến dịch/đơn tăng tương tác đã tạo, không trộn với lịch sử ví.',
    mode: 'my-campaigns',
  },
  'ttc-wallet': {
    tab: 'profile',
    title: 'Ví xu',
    description: 'Xem số dư xu dùng để tạo tăng tương tác và nhận thưởng từ nhiệm vụ.',
    mode: 'wallet',
  },
  'ttc-wallet-history': {
    tab: 'history',
    title: 'Lịch sử giao dịch',
    description: 'Theo dõi từng lần cộng, trừ và điều chỉnh xu.',
  },
};

let ttcLifecycle = null;
let lastTtcWalletRefreshAt = 0;

export function TtcPage({ route = 'ttc' } = {}) {
  const view = TTC_ROUTE_CONFIG[route] || TTC_ROUTE_CONFIG.ttc;
  const showWorkflowTabs = route === 'ttc';
  const showInlineCampaignActions = route === 'ttc';
  const showCampaignServiceTabs = route === 'ttc-campaign-create';
  const showInlineTaskActions = route === 'ttc' || route === 'ttc-earn';
  const showCampaignWorkflowTabs = route === 'ttc-campaign-create';
  state.campaignWorkflowTab = showCampaignWorkflowTabs ? 'create' : 'history';
  if (view.mode === 'my-campaigns') state.campaignServiceFilter = '';
  state.activeTab = view.tab;
  return `
    ${PageHeader({
      title: view.title,
      description: view.description,
    })}
    <div id="ttc-migration-notice"></div>
    <div class="ttc-shell">
      ${showWorkflowTabs ? `<nav class="ttc-tabs" aria-label="Quy trình tương tác chéo">
        ${renderTtcTab('profile', 'Hồ sơ')}
        ${renderTtcTab('boost', 'Tăng tương tác')}
        ${renderTtcTab('tasks', 'Kiếm xu')}
        ${renderTtcTab('history', 'Lịch sử')}
      </nav>` : ''}

      <section class="ttc-tab-panel" data-ttc-panel="profile" ${state.activeTab === 'profile' ? '' : 'hidden'}>
        <div class="dashboard-grid ttc-profile-grid ${view.mode ? 'single-panel-grid' : ''}">
          ${view.mode === 'wallet' || !view.mode ? `<section class="dash-card">
            <div class="dash-card-header"><h3>Ví xu tổng quan</h3></div>
            <div id="ttc-wallet-panel">
              ${EmptyState({ title: 'Đang tải ví xu', message: 'Đang đọc số dư TTC của bạn.' })}
            </div>
          </section>` : ''}
          ${view.mode === 'wallet' ? '' : `<section class="dash-card">
            <div class="dash-card-header"><h3>Tài khoản nhận nhiệm vụ</h3></div>
            <select id="ttc-facebook-account" class="filter-select" aria-label="Chọn Facebook account">
              <option value="">Đang tải Facebook...</option>
            </select>
            <p class="muted-text ttc-helper-text">Hiện hệ thống dùng Facebook ID đã xác minh làm định danh worker khi nhận nhiệm vụ.</p>
          </section>`}
        </div>
      </section>

      <section class="ttc-tab-panel" data-ttc-panel="boost" ${state.activeTab === 'boost' ? '' : 'hidden'}>
        ${showCampaignServiceTabs ? `<div class="ttc-action-tabs ttc-service-tabs" data-ttc-campaign-actions aria-label="Chọn dịch vụ tăng tương tác Facebook">
          ${FACEBOOK_ACTIONS.map((action) => renderActionTab(action, 'campaign')).join('')}
        </div>` : ''}
        ${showCampaignWorkflowTabs ? `<nav class="ttc-subtabs" aria-label="Quản lý tăng tương tác">
          ${renderCampaignWorkflowTab('create', 'Tạo chiến dịch')}
          ${renderCampaignWorkflowTab('history', 'Lịch sử mua')}
        </nav>` : ''}
        <div class="dashboard-grid ttc-work-grid ${view.mode ? 'single-panel-grid' : ''}">
          ${view.mode === 'my-campaigns' ? '' : `<section class="dash-card" data-campaign-workflow-panel="create" ${showCampaignWorkflowTabs && state.campaignWorkflowTab !== 'create' ? 'hidden' : ''}>
            <div class="dash-card-header"><h3>Tạo tăng tương tác</h3></div>
            ${showInlineCampaignActions ? `<div class="ttc-action-tabs" data-ttc-campaign-actions aria-label="Chọn loại tương tác Facebook">
              ${FACEBOOK_ACTIONS.map((action) => renderActionTab(action, 'campaign')).join('')}
            </div>` : ''}
            <form id="ttc-create-campaign-form" class="stacked-form">
              <div class="form-row">
                <label class="form-group">
                  <span>Loại tương tác</span>
                  <select id="ttc-campaign-type" class="form-control" name="interactionType" required>
                    <option value="">Đang tải cấu hình...</option>
                  </select>
                </label>
                <label class="form-group">
                  <span>Số lượng</span>
                  <input id="ttc-campaign-quantity" class="form-control" name="targetQuantity" type="number" min="1" step="1" value="10" required>
                </label>
              </div>
              ${FacebookIdResolverFields({
                urlId: 'ttc-target-url',
                idId: 'ttc-target-facebook-id',
                requiredUrl: true,
                requiredId: false,
                manualFallback: 'never',
                prefix: 'ttc-target',
                urlAttributes: 'name="targetUrl"',
                idAttributes: 'name="targetFacebookId" readonly',
                urlLabel: 'Link mục tiêu',
                idLabel: 'ID mục tiêu',
                buttonLabel: 'Lấy ID',
                helperText: 'Dán link Facebook mục tiêu rồi bấm Lấy ID nếu cần hệ thống tự nhận diện.',
              })}
              <label class="form-group">
                <span>Nhãn mục tiêu</span>
                <input class="form-control" name="targetLabel" placeholder="Tên bài viết, page hoặc group để dễ nhận diện">
              </label>
              <label class="form-group" data-comment-options-field hidden>
                <span>Nội dung comment gợi ý</span>
                <textarea class="form-control" name="commentOptions" rows="2" placeholder="Mỗi dòng là một nội dung comment được phép dùng"></textarea>
              </label>
              <div class="notice warning ttc-form-note">
                <strong>Lưu ý Facebook</strong>
                <span>Chỉ nhập link Facebook đúng loại đã chọn. Không tạo nhiều lượt trùng cùng một mục tiêu khi lượt trước chưa hoàn tất.</span>
              </div>
              <div id="ttc-campaign-cost" class="ttc-cost-summary">
                Chọn loại tương tác để xem đơn giá.
              </div>
              <div class="form-actions">
                <button class="btn-primary" type="submit">Tạo tăng tương tác</button>
              </div>
            </form>
          </section>`}
          <section class="dash-card" data-campaign-workflow-panel="history" ${showCampaignWorkflowTabs && state.campaignWorkflowTab !== 'history' ? 'hidden' : ''}>
            <div class="dash-card-header"><h3>${view.mode === 'create-campaign' ? 'Lịch sử mua' : 'Tăng tương tác của tôi'}</h3></div>
            <div class="ttc-campaign-filter-grid">
              <input id="ttc-my-campaign-search" class="form-control" type="search" placeholder="Tìm theo mã đơn, UID/URL, dịch vụ hoặc ghi chú" aria-label="Tìm chiến dịch của tôi" autocomplete="off">
              <select id="ttc-my-campaign-service" class="form-control" aria-label="Lọc dịch vụ">
                <option value="">Tất cả dịch vụ</option>
              </select>
              <select id="ttc-my-campaign-status" class="form-control" aria-label="Lọc trạng thái">
                <option value="">Tất cả trạng thái</option>
                <option value="queued">Chờ chạy</option>
                <option value="running">Đang chạy</option>
                <option value="completed">Hoàn thành</option>
                <option value="cancelled">Đã hủy/hoàn tiền</option>
                <option value="failed">Lỗi</option>
              </select>
              <input id="ttc-my-campaign-date-from" class="form-control compact-date" type="date" aria-label="Từ ngày">
              <input id="ttc-my-campaign-date-to" class="form-control compact-date" type="date" aria-label="Đến ngày">
              <button class="btn-secondary compact-button" type="button" data-refresh-campaigns>Refresh</button>
            </div>
            <div id="ttc-my-campaign-list">
              ${EmptyState({ title: 'Đang tải tăng tương tác', message: 'Đang đọc danh sách TTC của bạn.' })}
            </div>
          </section>
        </div>
      </section>

      <section class="ttc-tab-panel" data-ttc-panel="tasks" ${state.activeTab === 'tasks' ? '' : 'hidden'}>
        <div class="dashboard-grid ttc-work-grid ttc-earn-grid">
          <section class="dash-card ttc-available-task-card">
            <div class="dash-card-header"><h3>Kho nhiệm vụ Facebook</h3></div>
            ${showInlineTaskActions ? `<div class="ttc-action-tabs" data-ttc-task-actions aria-label="Chọn loại nhiệm vụ Facebook">
              ${FACEBOOK_ACTIONS.map((action) => renderActionTab(action, 'task')).join('')}
            </div>` : ''}
            <div class="ttc-earn-filter-bar">
              <label class="form-group">
                <span>Loại nhiệm vụ</span>
                <select id="ttc-task-type" class="form-control">
                  <option value="">Tất cả loại nhiệm vụ</option>
                </select>
              </label>
              <label class="form-group">
                <span>Tìm nhiệm vụ</span>
                <input id="ttc-task-search" class="form-control" type="search" placeholder="Tìm theo loại, nhãn hoặc link mục tiêu" aria-label="Tìm nhiệm vụ kiếm xu" autocomplete="off">
              </label>
            </div>
            <div id="ttc-task-list">
              ${EmptyState({ title: 'Đang tải nhiệm vụ', message: 'Đang đọc nhiệm vụ TTC phù hợp.' })}
            </div>
          </section>
          <section class="dash-card ttc-my-task-card">
            <div class="dash-card-header"><h3>Nhiệm vụ đang làm / đã nhận</h3></div>
            <div class="list-search-bar">
              <input id="ttc-my-task-search" class="form-control" type="search" placeholder="Tìm theo loại, link, trạng thái hoặc bằng chứng" aria-label="Tìm nhiệm vụ của tôi" autocomplete="off">
            </div>
            <div id="ttc-my-task-list">
              ${EmptyState({ title: 'Đang tải nhiệm vụ', message: 'Đang đọc nhiệm vụ đã nhận.' })}
            </div>
          </section>
        </div>
      </section>

      <section class="ttc-tab-panel" data-ttc-panel="history" ${state.activeTab === 'history' ? '' : 'hidden'}>
        <div class="dashboard-grid ttc-history-grid single-panel-grid">
          <section class="dash-card">
            <div class="dash-card-header"><h3>Lịch sử ví</h3></div>
            <div class="list-search-bar">
              <input id="ttc-wallet-history-search" class="form-control" type="search" placeholder="Tìm theo mô tả, loại giao dịch hoặc số xu" aria-label="Tìm lịch sử ví" autocomplete="off">
            </div>
            <div id="ttc-wallet-history">
              ${EmptyState({ title: 'Đang tải lịch sử ví', message: 'Đang đọc giao dịch xu gần đây.' })}
            </div>
          </section>
          <section class="dash-card">
            <div class="dash-card-header"><h3>Auto/manual check</h3></div>
            <div class="notice warning">
              <strong>Cơ chế kiểm tra</strong>
              <span>Task có thể auto-check nếu backend hiện tại hỗ trợ. Khi chưa có tín hiệu tự động, admin review là fallback.</span>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;
}

TtcPage.afterRender = async function afterRenderTtcPage() {
  ttcLifecycle?.abort();
  ttcLifecycle = new AbortController();
  state.requestedAction = getRequestedAction();
  if (state.requestedAction) state.taskInteractionType = state.requestedAction;
  const requestedCampaignId = getRequestedCampaignId();
  bindFacebookIdResolvers(document);
  syncTtcTabs();
  bindTtcEvents();
  bindTtcWalletAutoRefresh(ttcLifecycle.signal);
  await Promise.allSettled([loadInteractionTypes(), loadWallet(), loadFacebookAccounts()]);
  syncCampaignCost();
  await Promise.allSettled([loadMyCampaigns(), loadAvailableTasks(), loadMyTasks()]);
  openRequestedCampaign(requestedCampaignId);
};

function bindTtcWalletAutoRefresh(signal) {
  const refreshIfVisible = () => {
    if (document.visibilityState === 'hidden') return;
    if (!document.getElementById('ttc-wallet-panel')) return;
    const now = Date.now();
    if (now - lastTtcWalletRefreshAt < 1500) return;
    lastTtcWalletRefreshAt = now;
    loadWallet();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfVisible();
  }, { signal });
  window.addEventListener('focus', refreshIfVisible, { signal });
  window.addEventListener('pageshow', refreshIfVisible, { signal });
}

function renderTtcTab(tab, label) {
  return `<button class="ttc-tab-button" type="button" data-ttc-tab="${tab}" aria-selected="${state.activeTab === tab ? 'true' : 'false'}">${label}</button>`;
}

function renderCampaignWorkflowTab(tab, label) {
  return `<button class="ttc-subtab-button" type="button" data-campaign-workflow-tab="${tab}" aria-selected="${state.campaignWorkflowTab === tab ? 'true' : 'false'}">${label}</button>`;
}

function renderActionTab(action, scope) {
  return `<button class="ttc-action-tab" type="button" data-ttc-action="${escapeHtml(action)}" data-ttc-action-scope="${escapeHtml(scope)}">${escapeHtml(actionLabel(action))}</button>`;
}

function bindTtcEvents() {
  document.querySelectorAll('[data-ttc-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.ttcTab || 'profile';
      syncTtcTabs();
    });
  });

  document.querySelectorAll('[data-campaign-workflow-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.campaignWorkflowTab = button.dataset.campaignWorkflowTab || 'create';
      syncCampaignWorkflowTabs();
    });
  });

  document.getElementById('ttc-facebook-account')?.addEventListener('change', async (event) => {
    state.selectedFacebookAccountId = event.target.value;
    await loadAvailableTasks();
  });

  document.getElementById('ttc-task-type')?.addEventListener('change', async (event) => {
    state.taskInteractionType = event.target.value || '';
    syncActionTabs();
    renderAvailableTasks();
    renderMyTasks();
  });

  document.getElementById('ttc-my-campaign-search')?.addEventListener('input', (event) => {
    state.campaignSearchTerm = event.currentTarget.value || '';
    renderMyCampaigns();
  });
  document.getElementById('ttc-my-campaign-service')?.addEventListener('change', (event) => {
    state.campaignServiceFilter = event.currentTarget.value || '';
    if (hasCreateCampaignForm() && state.campaignServiceFilter) {
      const type = state.interactionTypes.find((item) => item.code === state.campaignServiceFilter);
      if (type) selectCampaignAction(interactionAction(type), { silent: true });
    }
    syncActionTabs();
    renderMyCampaigns();
  });
  document.getElementById('ttc-my-campaign-status')?.addEventListener('change', (event) => {
    state.campaignStatusFilter = event.currentTarget.value || '';
    renderMyCampaigns();
  });
  document.getElementById('ttc-my-campaign-date-from')?.addEventListener('change', (event) => {
    state.campaignDateFrom = event.currentTarget.value || '';
    renderMyCampaigns();
  });
  document.getElementById('ttc-my-campaign-date-to')?.addEventListener('change', (event) => {
    state.campaignDateTo = event.currentTarget.value || '';
    renderMyCampaigns();
  });
  document.querySelector('[data-refresh-campaigns]')?.addEventListener('click', () => {
    loadMyCampaigns();
  });

  document.getElementById('ttc-task-search')?.addEventListener('input', (event) => {
    state.availableTaskSearchTerm = event.currentTarget.value || '';
    renderAvailableTasks();
  });

  document.getElementById('ttc-my-task-search')?.addEventListener('input', (event) => {
    state.myTaskSearchTerm = event.currentTarget.value || '';
    renderMyTasks();
  });

  document.getElementById('ttc-wallet-history-search')?.addEventListener('input', (event) => {
    state.walletHistorySearchTerm = event.currentTarget.value || '';
    renderWalletHistory();
  });

  document.getElementById('ttc-campaign-type')?.addEventListener('change', syncCampaignCost);
  document.getElementById('ttc-campaign-quantity')?.addEventListener('input', syncCampaignCost);

  document.getElementById('ttc-create-campaign-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await createCampaign(event.currentTarget);
  });

  document.querySelector('[data-ttc-task-actions]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ttc-action]');
    if (!button) return;
    state.taskInteractionType = button.dataset.ttcAction || '';
    const select = document.getElementById('ttc-task-type');
    if (select) select.value = state.taskInteractionType;
    syncActionTabs();
    renderAvailableTasks();
    renderMyTasks();
  });

  document.querySelector('[data-ttc-campaign-actions]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ttc-action]');
    if (!button) return;
    selectCampaignAction(button.dataset.ttcAction || '');
    renderMyCampaigns();
  });

  document.getElementById('ttc-my-campaign-list')?.addEventListener('click', async (event) => {
    const detailButton = event.target.closest('[data-campaign-detail]');
    if (detailButton) {
      const campaign = state.myCampaigns.find((item) => String(item.id) === detailButton.dataset.campaignDetail);
      if (campaign) openCampaignDetail(campaign);
      return;
    }
    const cancelButton = event.target.closest('[data-campaign-cancel]');
    if (!cancelButton) return;
    await cancelMyCampaign(cancelButton.dataset.campaignCancel);
  });

  document.getElementById('ttc-task-list')?.addEventListener('click', async (event) => {
    const openButton = event.target.closest('[data-open-task]');
    if (openButton) {
      const task = state.availableTasks.find((item) => taskStorageKey(item) === openButton.dataset.openTask);
      if (!task) return;
      if (!task.target_url) {
        Toast.show('Nhiệm vụ này chưa có link mục tiêu.');
        return;
      }
      markTaskOpened(task);
      renderAvailableTasks();
      window.open(task.target_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const claimButton = event.target.closest('[data-claim-task]');
    if (!claimButton || state.processingTaskId) return;
    const task = state.availableTasks.find((item) => taskStorageKey(item) === claimButton.dataset.claimTask);
    if (!task) return;
    await claimTaskReward(task, claimButton);
  });

  document.getElementById('ttc-my-task-list')?.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-submit-task-form]');
    if (!form) return;
    event.preventDefault();
    const taskId = form.dataset.submitTaskForm;
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    await submitTask(taskId, values, button);
  });
  document.getElementById('ttc-my-task-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-submit-owned-task]');
    if (!button || state.processingTaskId) return;
    await submitTask(button.dataset.submitOwnedTask, {
      evidenceText: 'User yêu cầu hệ thống kiểm tra tự động',
    }, button);
  });
}

function syncTtcTabs() {
  document.querySelectorAll('[data-ttc-tab]').forEach((button) => {
    const active = button.dataset.ttcTab === state.activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-ttc-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.ttcPanel !== state.activeTab;
  });
}

function syncCampaignWorkflowTabs() {
  document.querySelectorAll('[data-campaign-workflow-tab]').forEach((button) => {
    const active = button.dataset.campaignWorkflowTab === state.campaignWorkflowTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-campaign-workflow-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.campaignWorkflowPanel !== state.campaignWorkflowTab;
  });
}

async function loadInteractionTypes() {
  const select = document.getElementById('ttc-campaign-type');
  const taskTypeSelect = document.getElementById('ttc-task-type');
  if (!select && !taskTypeSelect) return;
  try {
    const { data } = await TtcService.listInteractionTypes();
    state.interactionTypes = (data || []).filter(isFacebookInteractionType);
    if (select) renderCampaignTypeOptions();
    renderCampaignServiceFilterOptions();
    if (taskTypeSelect) renderTaskTypeOptions();
    applyRequestedAction();
    applyDefaultCampaignAction();
    if (select) syncCampaignCost();
    syncActionTabs();
  } catch (error) {
    showMigrationNotice(error, 'TTC');
    const message = isMissingDatabaseFeatureError(error) ? userFriendlyTtcFeatureMessage('cấu hình TTC') : error?.message || 'Không tải được cấu hình';
    if (select) select.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
    if (taskTypeSelect) taskTypeSelect.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
  }
}

function renderCampaignServiceFilterOptions() {
  const select = document.getElementById('ttc-my-campaign-service');
  if (!select) return;
  const options = state.interactionTypes
    .filter((type) => type.is_active && isFacebookInteractionType(type))
    .map((type) => `<option value="${escapeHtml(type.code)}">${escapeHtml(actionLabel(interactionAction(type), type.label || type.code))}</option>`)
    .join('');
  select.innerHTML = `<option value="">Tất cả dịch vụ</option>${options}`;
  select.value = state.campaignServiceFilter;
}

function renderCampaignTypeOptions() {
  const select = document.getElementById('ttc-campaign-type');
  if (!select) return;
  const options = state.interactionTypes
    .filter((type) => type.is_active && isFacebookInteractionType(type))
    .map((type) => `<option value="${escapeHtml(type.code)}">${escapeHtml(actionLabel(interactionAction(type), type.label || type.code))}</option>`)
    .join('');
  select.innerHTML = `<option value="">Chọn loại tăng tương tác</option>${options}`;
}

function renderTaskTypeOptions() {
  const select = document.getElementById('ttc-task-type');
  if (!select) return;
  const seen = new Set();
  const options = state.interactionTypes
    .filter((type) => type.is_active && isFacebookInteractionType(type))
    .map((type) => ({ action: interactionAction(type), label: actionLabel(interactionAction(type), type.label || type.code) }))
    .filter((item) => {
      if (seen.has(item.action)) return false;
      seen.add(item.action);
      return true;
    })
    .map((item) => `<option value="${escapeHtml(item.action)}">${escapeHtml(item.label)}</option>`)
    .join('');
  select.innerHTML = `<option value="">Tất cả loại nhiệm vụ</option>${options}`;
  select.value = state.taskInteractionType;
}

function applyRequestedAction() {
  if (!state.requestedAction) return;
  const taskTypeSelect = document.getElementById('ttc-task-type');
  if (taskTypeSelect && [...taskTypeSelect.options].some((option) => option.value === state.requestedAction)) {
    taskTypeSelect.value = state.requestedAction;
    state.taskInteractionType = state.requestedAction;
  }
  selectCampaignAction(state.requestedAction, { silent: true });
}

function applyDefaultCampaignAction() {
  if (!document.querySelector('.ttc-service-tabs[data-ttc-campaign-actions]')) return;
  if (getSelectedInteractionType()) return;
  const firstType = state.interactionTypes.find((type) => type.is_active && isFacebookInteractionType(type));
  if (firstType) selectCampaignAction(interactionAction(firstType), { silent: true });
}

function selectCampaignAction(action, { silent = false } = {}) {
  const select = document.getElementById('ttc-campaign-type');
  if (!select || !action) return;
  const matched = state.interactionTypes.find((type) => (
    isFacebookInteractionType(type) && interactionAction(type) === action
  ));
  if (!matched) {
    if (!silent) Toast.show('Loại tương tác này chưa được bật trong cấu hình giá.');
    return;
  }
  select.value = matched.code;
  state.campaignServiceFilter = matched.code;
  const serviceFilter = document.getElementById('ttc-my-campaign-service');
  if (serviceFilter) serviceFilter.value = matched.code;
  syncCampaignCost();
}

function syncActionTabs() {
  const selectedCampaignAction = interactionAction(getSelectedInteractionType());
  document.querySelectorAll('[data-ttc-action]').forEach((button) => {
    const action = button.dataset.ttcAction || '';
    const scope = button.dataset.ttcActionScope;
    const active = scope === 'task'
      ? action === state.taskInteractionType
      : action === selectedCampaignAction;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function getRequestedAction() {
  const action = new URLSearchParams(window.location.hash.split('?')[1] || '').get('type') || '';
  return FACEBOOK_ACTIONS.includes(action) ? action : '';
}

function getRequestedCampaignId() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('campaign') || '';
}

function openRequestedCampaign(campaignId) {
  if (!campaignId) return;
  const campaign = state.myCampaigns.find((item) => String(item.id) === String(campaignId));
  if (campaign) openCampaignDetail(campaign);
}

async function loadWallet() {
  const panel = document.getElementById('ttc-wallet-panel');
  const history = document.getElementById('ttc-wallet-history');
  try {
    const { data } = await WalletService.getMyWallet();
    state.wallet = data || null;
    window.dispatchEvent(new CustomEvent('dhl-wallet-updated', {
      detail: { wallet: state.wallet },
    }));
    if (panel) {
      panel.innerHTML = `
        <div class="stats-grid">
          <div><strong>${escapeHtml(String(data?.balance ?? 0))}</strong><br><span class="muted-text">Số dư hiện tại</span></div>
          <div><strong>${escapeHtml(String(data?.total_earned ?? 0))}</strong><br><span class="muted-text">Tổng kiếm được</span></div>
          <div><strong>${escapeHtml(String(data?.total_spent ?? 0))}</strong><br><span class="muted-text">Tổng đã dùng</span></div>
        </div>
      `;
    }
    if (history) await loadWalletHistory(history);
  } catch (error) {
    showMigrationNotice(error, 'ví TTC');
    state.wallet = null;
    if (panel) {
      panel.innerHTML = EmptyState({
        title: 'Chưa có ví xu',
        message: isMissingDatabaseFeatureError(error)
          ? userFriendlyTtcFeatureMessage('ví TTC')
          : error?.message || 'Không đọc được ví.',
      });
    }
    if (history) {
      history.innerHTML = EmptyState({ title: 'Không tải được lịch sử ví', message: 'Vui lòng thử lại sau.' });
    }
  }
}

async function loadWalletHistory(panel) {
  const { data } = await WalletService.getMyLedger({ page: 1, pageSize: 12 });
  state.walletLedger = data || [];
  renderWalletHistory(panel);
}

function renderWalletHistory(targetPanel = null) {
  const panel = targetPanel || document.getElementById('ttc-wallet-history');
  if (!panel) return;
  if (!state.walletLedger.length) {
    panel.innerHTML = EmptyState({
      title: 'Chưa có giao dịch',
      message: 'Lịch sử kiếm/dùng xu TTC sẽ hiển thị tại đây.',
    });
    return;
  }
  const entries = filterWalletHistory(state.walletLedger);
  if (!entries.length) {
    panel.innerHTML = EmptyState({
      title: 'Không tìm thấy giao dịch',
      message: 'Thử tìm bằng mô tả, loại giao dịch hoặc số xu khác.',
    });
    return;
  }
  panel.innerHTML = entries.map((entry) => {
    const amount = Number(entry.amount || 0);
    return `
      <div class="recent-item">
        <div>
          <div class="expiring-name">${escapeHtml(entry.description || entry.transaction_type || 'Giao dịch xu')}</div>
          <div class="expiring-date">${formatDateTime(entry.created_at)} · Số dư sau: ${escapeHtml(String(entry.balance_after ?? 0))}</div>
        </div>
        <span class="status-pill ${amount < 0 ? 'danger' : 'success'}">${amount > 0 ? '+' : ''}${escapeHtml(String(amount))}</span>
      </div>
    `;
  }).join('');
}

async function loadFacebookAccounts() {
  const select = document.getElementById('ttc-facebook-account');
  if (!select) return;
  try {
    const { data } = await UserProfileService.listMyFacebookAccounts();
    state.facebookAccounts = (data || []).filter((account) => (
      account.facebook_id && ['resolved', 'manual_verified'].includes(account.facebook_id_status)
    ));
    if (!state.facebookAccounts.length) {
      select.innerHTML = '<option value="">Chưa có Facebook ID đã xác minh</option>';
      return;
    }
    state.selectedFacebookAccountId = String(
      state.facebookAccounts.find((account) => account.is_primary)?.id || state.facebookAccounts[0].id,
    );
    select.innerHTML = state.facebookAccounts.map((account) => `
      <option value="${account.id}" ${String(account.id) === state.selectedFacebookAccountId ? 'selected' : ''}>
        ${escapeHtml(account.facebook_id)}${account.is_primary ? ' · chính' : ''}
      </option>
    `).join('');
  } catch (error) {
    showMigrationNotice(error, 'Facebook TTC');
    select.innerHTML = `<option value="">${escapeHtml(isMissingDatabaseFeatureError(error) ? userFriendlyTtcFeatureMessage('Facebook TTC') : error?.message || 'Không tải được Facebook')}</option>`;
  }
}

async function createCampaign(form) {
  const values = Object.fromEntries(new FormData(form));
  const interactionType = getSelectedInteractionType();
  const quantity = Number(values.targetQuantity || 0);
  const targetFacebookId = String(values.targetFacebookId || '').trim();
  const resolverRoot = form.querySelector('[data-facebook-id-resolver]');
  const totalCost = interactionType ? Number(interactionType.unit_cost || 0) * quantity : 0;
  if (!interactionType) {
    Toast.show('Vui lòng chọn loại tương tác.');
    return;
  }
  if (!Number.isInteger(quantity) || quantity < Number(interactionType.min_quantity || 1)) {
    Toast.show('Số lượng không hợp lệ.');
    return;
  }
  if (state.wallet && totalCost > Number(state.wallet.balance || 0)) {
    Toast.show('Số dư xu không đủ để tạo tăng tương tác.');
    return;
  }
  const targetValidation = validateCampaignTargetUrl(interactionType, values.targetUrl);
  if (!targetValidation.valid) {
    Toast.show(targetValidation.message);
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Đang tạo...';
  try {
    await TtcService.createCampaign({
      interactionType: interactionType.code,
      targetUrl: values.targetUrl,
      targetQuantity: quantity,
      targetFacebookId: targetFacebookId || null,
      targetLabel: values.targetLabel,
      commentOptions: parseCommentOptions(values.commentOptions),
      metadata: {
        target_resolver_state: resolverRoot?.dataset.resolverState || 'idle',
        source: 'user_portal',
        platform: interactionPlatform(interactionType),
        action: interactionAction(interactionType),
      },
    });
    Toast.show('Đã tạo tăng tương tác và trừ xu.');
    form.reset();
    await Promise.allSettled([loadWallet(), loadMyCampaigns(), loadAvailableTasks()]);
    applyRequestedAction();
    syncCampaignCost();
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? userFriendlyTtcFeatureMessage('tạo tăng tương tác TTC')
      : error?.message || 'Không thể tạo tăng tương tác.');
  } finally {
    button.disabled = false;
    button.textContent = 'Tạo tăng tương tác';
  }
}

function syncCampaignCost() {
  const summary = document.getElementById('ttc-campaign-cost');
  const quantityInput = document.getElementById('ttc-campaign-quantity');
  const commentField = document.querySelector('[data-comment-options-field]');
  if (!summary) return;
  const interactionType = getSelectedInteractionType();
  const quantity = Number(quantityInput?.value || 0);
  if (commentField) commentField.hidden = interactionAction(interactionType) !== 'comment';
  if (!interactionType || !Number.isFinite(quantity) || quantity < 1) {
    summary.textContent = 'Chọn loại tương tác để xem đơn giá.';
    syncActionTabs();
    return;
  }
  const unitCost = Number(interactionType.unit_cost || 0);
  const reward = Number(interactionType.worker_reward || 0);
  const total = unitCost * quantity;
  const balance = state.wallet ? Number(state.wallet.balance || 0) : null;
  summary.innerHTML = `
    <span>Đơn giá: <strong>${unitCost}</strong> xu</span>
    <span>Thưởng/task: <strong>${reward}</strong> xu</span>
    <span>Tổng trừ: <strong>${total}</strong> xu</span>
    ${balance === null ? '' : `<span>Số dư: <strong>${balance}</strong> xu</span>`}
  `;
  syncActionTabs();
}

function getSelectedInteractionType() {
  const code = document.getElementById('ttc-campaign-type')?.value || '';
  return state.interactionTypes.find((type) => type.code === code) || null;
}

function interactionPlatform(type) {
  const code = String(type?.code || '');
  if (type?.config?.platform) return type.config.platform;
  return code.includes('_') ? code.split('_')[0] : 'facebook';
}

function isFacebookInteractionType(type) {
  return type?.is_active && interactionPlatform(type) === 'facebook' && String(type?.code || '').startsWith('facebook_');
}

function interactionAction(type) {
  const code = String(type?.code || '');
  return type?.config?.action || code.replace(/^facebook_/, '') || code;
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

async function loadMyCampaigns() {
  const list = document.getElementById('ttc-my-campaign-list');
  if (!list) return;
  try {
    const { data } = await TtcService.listMyCampaigns({ page: 1, pageSize: 50 });
    state.myCampaigns = data || [];
    renderMyCampaigns();
  } catch (error) {
    showMigrationNotice(error, 'tăng tương tác TTC');
    list.innerHTML = EmptyState({
      title: 'Không tải được tăng tương tác',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyTtcFeatureMessage('tăng tương tác TTC')
        : error?.message || 'Vui lòng thử lại sau.',
    });
  }
}

function renderMyCampaigns() {
  const list = document.getElementById('ttc-my-campaign-list');
  if (!list) return;
  if (!state.myCampaigns.length) {
    list.innerHTML = EmptyState({
      title: 'Chưa có tăng tương tác',
      message: 'Các lượt tăng tương tác Facebook bạn tạo sẽ hiển thị tiến độ tại đây.',
    });
    return;
  }
  const campaigns = filterMyCampaigns(state.myCampaigns);
  if (!campaigns.length) {
    list.innerHTML = EmptyState({
      title: 'Không tìm thấy tăng tương tác',
      message: 'Thử tìm bằng loại, nhãn, link hoặc trạng thái khác.',
    });
    return;
  }
  list.innerHTML = `
    <div class="report-table-wrap ttc-campaign-table-wrap">
      <table class="data-table ttc-campaign-table">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>UID / URL mục tiêu</th>
            <th>Dịch vụ</th>
            <th>Trạng thái</th>
            <th>Số lượng</th>
            <th>Tiến độ</th>
            <th>Đơn giá</th>
            <th>Tổng chi phí</th>
            <th>Thời gian</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${campaigns.map(renderCampaignRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderCampaignRow(campaign) {
  const targetQuantity = Number(campaign.target_quantity || 0);
  const completedCount = Number(campaign.completed_count || 0);
  const remainingCount = Math.max(0, targetQuantity - completedCount);
  const totalCost = Number(campaign.reserved_amount || (Number(campaign.unit_cost || 0) * targetQuantity));
  const canCancel = ['draft', 'queued', 'running', 'paused'].includes(campaign.status) && remainingCount > 0;
  return `
    <tr>
      <td class="tabular-cell">#${escapeHtml(String(campaign.id || '—'))}</td>
      <td class="ttc-campaign-target-cell">
        <strong>${escapeHtml(campaign.target_facebook_id || 'Chưa có UID')}</strong>
        <span>${escapeHtml(campaign.target_url || campaign.target_label || '—')}</span>
      </td>
      <td>${escapeHtml(campaignTypeLabel(campaign))}</td>
      <td><span class="status-pill ${campaignStatusTone(campaign.status)}">${escapeHtml(campaignStatusLabel(campaign.status))}</span></td>
      <td class="tabular-cell">${formatNumber(targetQuantity)}</td>
      <td class="tabular-cell">${formatNumber(completedCount)} / ${formatNumber(remainingCount)}</td>
      <td class="tabular-cell">${formatNumber(campaign.unit_cost || 0)} xu</td>
      <td class="tabular-cell">${formatNumber(totalCost)} xu</td>
      <td>
        <div class="compact-date">${formatDateTime(campaign.created_at)}</div>
        <div class="muted-text">${formatDateTime(campaign.updated_at)}</div>
      </td>
      <td>
        <div class="table-action-stack">
          <button class="btn-secondary compact-button" type="button" data-campaign-detail="${escapeHtml(String(campaign.id || ''))}">Chi tiết</button>
          ${canCancel ? `<button class="table-cancel-button" type="button" data-campaign-cancel="${escapeHtml(String(campaign.id || ''))}">Hủy</button>` : ''}
        </div>
      </td>
    </tr>
  `;
}

function openCampaignDetail(campaign) {
  const targetQuantity = Number(campaign.target_quantity || 0);
  const completedCount = Number(campaign.completed_count || 0);
  const remainingCount = Math.max(0, targetQuantity - completedCount);
  const relatedTasks = state.myTasks.filter((task) => Number(task.campaign_id) === Number(campaign.id));
  Modal.open({
    title: `Chi tiết chiến dịch #${campaign.id || '—'}`,
    className: 'modal-wide',
    body: `
      <div class="admin-user-modal-grid compact">
        ${renderCampaignModalStat('Dịch vụ', campaignTypeLabel(campaign))}
        ${renderCampaignModalStat('Trạng thái', campaignStatusLabel(campaign.status))}
        ${renderCampaignModalStat('Tiến độ', `${formatNumber(completedCount)} hoàn thành / ${formatNumber(remainingCount)} còn lại`)}
        ${renderCampaignModalStat('Đơn giá', `${formatNumber(campaign.unit_cost || 0)} xu`)}
        ${renderCampaignModalStat('Tổng chi phí', `${formatNumber(campaign.reserved_amount || 0)} xu`)}
        ${renderCampaignModalStat('Đã hoàn', `${formatNumber(campaign.refunded_amount || 0)} xu`)}
      </div>
      <div class="settings-list ttc-campaign-detail-list">
        <div class="settings-row"><span>UID mục tiêu</span><strong>${escapeHtml(campaign.target_facebook_id || 'Chưa có')}</strong></div>
        <div class="settings-row"><span>URL mục tiêu</span><strong>${escapeHtml(campaign.target_url || '—')}</strong></div>
        <div class="settings-row"><span>Nhãn/Ghi chú</span><strong>${escapeHtml(campaign.target_label || campaign.admin_reason || campaign.metadata?.note || '—')}</strong></div>
        <div class="settings-row"><span>Thời gian tạo</span><strong>${formatDateTime(campaign.created_at)}</strong></div>
        <div class="settings-row"><span>Cập nhật</span><strong>${formatDateTime(campaign.updated_at)}</strong></div>
      </div>
      <div class="dash-card-header compact-card-header"><h3>Nhiệm vụ phát sinh</h3></div>
      ${relatedTasks.length ? `
        <div class="quick-ledger-list">
          ${relatedTasks.map((task) => `
            <div class="quick-ledger-row">
              <strong>#${escapeHtml(String(task.task_id || task.id || '—'))}</strong>
              <span>${escapeHtml(statusLabel(task.status))} · ${formatDateTime(task.updated_at)}</span>
            </div>
          `).join('')}
        </div>
      ` : '<p class="muted-text">Chưa có nhiệm vụ phát sinh trong dữ liệu hiện tại.</p>'}
    `,
  });
}

function renderCampaignModalStat(label, value) {
  return `
    <div class="admin-user-modal-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? '—'))}</strong>
    </div>
  `;
}

async function cancelMyCampaign(campaignId) {
  const campaign = state.myCampaigns.find((item) => String(item.id) === String(campaignId));
  if (!campaign) {
    Toast.show('Không tìm thấy chiến dịch.');
    return;
  }
  const reason = window.prompt(`Nhập lý do hủy chiến dịch #${campaign.id}:`);
  if (!reason?.trim()) return;
  try {
    await TtcService.cancelCampaign(campaign.id, reason.trim());
    Toast.show('Đã gửi yêu cầu hủy/hoàn xu phần còn lại.');
    await Promise.allSettled([loadMyCampaigns(), loadWallet()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? userFriendlyTtcFeatureMessage('hủy chiến dịch TTC')
      : error?.message || 'Không hủy được chiến dịch.');
  }
}

async function loadAvailableTasks() {
  const list = document.getElementById('ttc-task-list');
  if (!list) return;
  if (!state.selectedFacebookAccountId) {
    list.innerHTML = EmptyState({
      title: 'Cần Facebook ID đã xác minh',
      message: 'Mở Cổng thành viên để dán link Facebook và lấy ID trước khi nhận nhiệm vụ.',
    });
    return;
  }
  try {
    const { data } = await TtcService.listAvailableTasks({
      facebookAccountId: state.selectedFacebookAccountId,
    });
    state.availableTasks = data || [];
    renderAvailableTasks();
  } catch (error) {
    showMigrationNotice(error, 'nhiệm vụ TTC');
    list.innerHTML = EmptyState({
      title: 'Chưa thể tải nhiệm vụ',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyTtcFeatureMessage('danh sách nhiệm vụ TTC')
        : error?.message || 'Vui lòng hoàn thiện hồ sơ và Facebook ID trước.',
    });
  }
}

function renderAvailableTasks() {
  const list = document.getElementById('ttc-task-list');
  if (!list) return;
  const data = state.taskInteractionType
    ? filterTasksByPlatform(state.availableTasks).filter((task) => taskAction(task) === state.taskInteractionType)
    : filterTasksByPlatform(state.availableTasks);
  const filteredData = filterAvailableTasks(data);
  if (!data.length) {
    const selectedType = state.interactionTypes.find((type) => (
      isFacebookInteractionType(type) && interactionAction(type) === state.taskInteractionType
    ));
    if (state.availableTasks.length && selectedType) {
      list.innerHTML = EmptyState({
        title: `Hết nhiệm vụ ${actionLabel(interactionAction(selectedType), selectedType.label || selectedType.code)}`,
        message: 'Đổi sang loại nhiệm vụ khác hoặc quay lại sau.',
      });
      return;
    }
    list.innerHTML = EmptyState({
      title: 'Hết nhiệm vụ, vui lòng quay lại sau',
      message: 'Không có nhiệm vụ Facebook phù hợp với lựa chọn hiện tại.',
    });
    return;
  }
  if (!filteredData.length) {
    list.innerHTML = EmptyState({
      title: 'Không tìm thấy nhiệm vụ',
      message: 'Thử tìm bằng loại, nhãn hoặc link mục tiêu khác.',
    });
    return;
  }
  list.innerHTML = filteredData.map(renderAvailableTask).join('');
}

function renderAvailableTask(task) {
  const opened = hasOpenedTask(task);
  const reward = `${escapeHtml(String(task.worker_reward || 0))} xu`;
  const action = taskAction(task);
  return `
    <div class="ttc-task-action-card">
      <button class="ttc-task-action-icon" type="button" data-open-task="${escapeHtml(taskStorageKey(task))}" aria-label="Mở nhiệm vụ ${escapeHtml(actionLabel(action))}">
        ${taskActionIcon(action)}
      </button>
      <div class="ttc-task-action-copy">
        <div class="expiring-name">${escapeHtml(actionLabel(action, taskInteractionLabel(task)))}</div>
        <div class="expiring-date">${escapeHtml(compactTaskTarget(task))}</div>
      </div>
      <div class="ttc-task-action-controls">
        ${opened
          ? `<button class="btn-primary compact-button" type="button" data-claim-task="${escapeHtml(taskStorageKey(task))}">Gửi kiểm tra</button>`
          : `
            <button class="btn-secondary compact-button" type="button" data-open-task="${escapeHtml(taskStorageKey(task))}">Mở bài viết</button>
            <span class="status-pill success">+${reward}</span>
          `}
      </div>
    </div>
  `;
}

function filterTasksByPlatform(tasks) {
  return (tasks || []).filter((task) => taskPlatform(task) === 'facebook');
}

function taskPlatform(task) {
  const type = state.interactionTypes.find((item) => item.code === task.interaction_type_code);
  if (type) return interactionPlatform(type);
  const code = String(task.interaction_type_code || '');
  return code.includes('_') ? code.split('_')[0] : 'facebook';
}

function taskAction(task) {
  const type = state.interactionTypes.find((item) => item.code === task.interaction_type_code);
  if (type) return interactionAction(type);
  return String(task.interaction_type_code || '').replace(/^facebook_/, '');
}

function interactionDisplayName(code) {
  const type = state.interactionTypes.find((item) => item.code === code);
  if (!type) return code;
  return scopedInteractionLabel(type);
}

function taskInteractionLabel(task) {
  const fallback = interactionDisplayName(task?.interaction_type_code) || 'TTC';
  return String(task?.interaction_label || fallback).replace(/^Facebook\s*[-·]\s*/i, '');
}

function compactTaskTarget(task) {
  if (task.target_label) return task.target_label;
  const url = String(task.target_url || '');
  if (!url) return 'Mở link để thực hiện nhiệm vụ';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'Mở link để thực hiện nhiệm vụ';
  }
}

function taskActionIcon(action) {
  const icons = {
    like: '<svg viewBox="0 0 24 24"><path d="M8 21H4V9h4v12Zm2-11 4-7c.8.1 1.5.5 1.9 1.1.4.6.5 1.3.3 2.1L15.6 9H20c.7 0 1.3.3 1.7.8.4.5.5 1.1.3 1.8l-1.5 6.1c-.5 2-1.8 3.3-3.8 3.3H10V10Z"/></svg>',
    follow: '<svg viewBox="0 0 24 24"><path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c.6-4.3 3-6.5 7-6.5 1.2 0 2.3.2 3.2.6A6 6 0 0 0 12 20H3Zm14-8v3h-3v3h3v3h3v-3h3v-3h-3v-3h-3Z"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4V5Zm4 4v2h8V9H8Zm0 4v2h6v-2H8Z"/></svg>',
    reaction: '<svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 10h2v2H8v-2Zm6 0h2v2h-2v-2Zm-6 5h8c-.8 1.6-2.1 2.4-4 2.4S8.8 16.6 8 15Z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M18 16.1c-1 0-1.8.4-2.4 1.1L8.9 13.8a3.2 3.2 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7c0 .2 0 .4.1.6L8.4 11A3 3 0 1 0 8.4 15l6.7 3.4A3 3 0 1 0 18 16.1Z"/></svg>',
    join_group: '<svg viewBox="0 0 24 24"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c.5-4 2.5-6 6-6s5.5 2 6 6H2Zm10.8-5.5c.9-.4 2-.5 3.2-.5 3.5 0 5.5 2 6 6h-5.5a7.5 7.5 0 0 0-3.7-5.5Z"/></svg>',
  };
  return icons[action] || icons.like;
}

function taskStorageKey(task) {
  const id = String(task?.task_id || task?.campaign_id || '');
  const target = String(task?.target_url || '');
  return id && target ? `${id}:${target}` : id;
}

function hasOpenedTask(task) {
  return state.openedTaskKeys.has(taskStorageKey(task));
}

function markTaskOpened(task) {
  const key = taskStorageKey(task);
  if (!key) return;
  state.openedTaskKeys.add(key);
  saveOpenedTaskKeys();
}

function clearOpenedTask(task) {
  const key = taskStorageKey(task);
  if (!key) return;
  state.openedTaskKeys.delete(key);
  saveOpenedTaskKeys();
}

function loadOpenedTaskKeys() {
  try {
    const raw = localStorage.getItem(OPENED_TASKS_STORAGE_KEY);
    const values = JSON.parse(raw || '[]');
    return new Set(Array.isArray(values) ? values.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveOpenedTaskKeys() {
  try {
    localStorage.setItem(OPENED_TASKS_STORAGE_KEY, JSON.stringify(Array.from(state.openedTaskKeys)));
  } catch {
    // Ignore storage errors; task claiming still works in the current session.
  }
}

function filterMyCampaigns(campaigns) {
  const serviceFilter = isPurchaseHistoryMode()
    ? getSelectedInteractionType()?.code || state.campaignServiceFilter
    : state.campaignServiceFilter;
  const statusFilter = state.campaignStatusFilter;
  const dateFrom = state.campaignDateFrom ? new Date(`${state.campaignDateFrom}T00:00:00`) : null;
  const dateTo = state.campaignDateTo ? new Date(`${state.campaignDateTo}T23:59:59`) : null;
  const query = normalizeSearch(state.campaignSearchTerm);
  return campaigns.filter((campaign) => {
    if (serviceFilter && campaign.interaction_type_code !== serviceFilter) return false;
    if (statusFilter && campaign.status !== statusFilter) return false;
    const createdAt = campaign.created_at ? new Date(campaign.created_at) : null;
    if (dateFrom && createdAt && createdAt < dateFrom) return false;
    if (dateTo && createdAt && createdAt > dateTo) return false;
    if (!query) return true;
    return [
    campaign.id,
    campaignTypeLabel(campaign),
    campaign.interaction_type_code,
    campaign.target_facebook_id,
    campaign.target_label,
    campaign.target_url,
    campaign.completed_count,
    campaign.target_quantity,
    campaign.unit_cost,
    campaign.reserved_amount,
    campaign.admin_reason,
    campaign.metadata?.note,
    campaign.status,
    campaignStatusLabel(campaign.status),
    campaign.created_at,
    campaign.updated_at,
    ].map(normalizeSearch).join(' ').includes(query);
  });
}

function isPurchaseHistoryMode() {
  return Boolean(document.getElementById('ttc-create-campaign-form'));
}

function filterAvailableTasks(tasks) {
  const query = normalizeSearch(state.availableTaskSearchTerm);
  if (!query) return tasks;
  return tasks.filter((task) => [
    task.task_id,
    taskInteractionLabel(task),
    task.interaction_type_code,
    task.target_label,
    task.target_url,
    task.worker_reward,
  ].map(normalizeSearch).join(' ').includes(query));
}

function filterMyTasks(tasks) {
  const scopedTasks = state.taskInteractionType
    ? (tasks || []).filter((task) => taskPlatform(task) === 'facebook' && taskAction(task) === state.taskInteractionType)
    : tasks;
  const query = normalizeSearch(state.myTaskSearchTerm);
  if (!query) return scopedTasks;
  return scopedTasks.filter((task) => [
    task.task_id,
    task.interaction_label,
    interactionDisplayName(task.interaction_type_code),
    task.interaction_type_code,
    task.target_label,
    task.target_url,
    task.status,
    statusLabel(task.status),
    task.rejection_reason,
    task.updated_at,
  ].map(normalizeSearch).join(' ').includes(query));
}

function filterWalletHistory(entries) {
  const query = normalizeSearch(state.walletHistorySearchTerm);
  if (!query) return entries;
  return entries.filter((entry) => [
    entry.id,
    entry.transaction_type,
    entry.description,
    entry.reason,
    entry.amount,
    entry.balance_after,
    entry.created_at,
  ].map(normalizeSearch).join(' ').includes(query));
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
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
  return interactionDisplayName(campaign?.interaction_type_code) || type?.label || campaign?.interaction_type_code || 'TTC';
}

function scopedInteractionLabel(type) {
  const label = actionLabel(interactionAction(type), type?.label || type?.code);
  return interactionPlatform(type) === 'facebook' ? label : `${platformLabel(interactionPlatform(type))} - ${label}`;
}

async function loadMyTasks() {
  const list = document.getElementById('ttc-my-task-list');
  if (!list) return;
  try {
    const { data } = await TtcService.listMyTasks({ page: 1, pageSize: 20 });
    state.myTasks = data || [];
    renderMyTasks();
  } catch (error) {
    showMigrationNotice(error, 'nhiệm vụ TTC');
    list.innerHTML = EmptyState({
      title: 'Không tải được nhiệm vụ của tôi',
      message: isMissingDatabaseFeatureError(error)
        ? userFriendlyTtcFeatureMessage('nhiệm vụ của tôi')
        : error?.message || 'Vui lòng thử lại sau.',
    });
  }
}

function renderMyTasks() {
  const list = document.getElementById('ttc-my-task-list');
  if (!list) return;
  const tasks = filterMyTasks(state.myTasks);
  if (!state.myTasks.length) {
    list.innerHTML = EmptyState({
      title: 'Chưa nhận nhiệm vụ',
      message: 'Nhiệm vụ đã nhận sẽ hiển thị tại đây để gửi bằng chứng và theo dõi trạng thái.',
    });
    return;
  }
  if (!tasks.length) {
    const selectedLabel = actionLabel(state.taskInteractionType);
    list.innerHTML = EmptyState({
      title: state.taskInteractionType ? `Chưa nhận nhiệm vụ ${selectedLabel}` : 'Không tìm thấy nhiệm vụ',
      message: state.myTaskSearchTerm
        ? 'Thử tìm bằng link, trạng thái hoặc bằng chứng khác.'
        : 'Nhiệm vụ đã nhận của loại đang chọn sẽ hiển thị tại đây.',
    });
    return;
  }
  list.innerHTML = tasks.map(renderMyTask).join('');
}

function renderMyTask(task) {
  const canSubmit = ['assigned', 'submitted'].includes(task.status);
  return `
    <div class="ttc-task-action-card ttc-task-owned-card">
      <span class="ttc-task-action-icon static-icon" aria-hidden="true">${taskActionIcon(taskAction(task))}</span>
      <div class="ttc-task-action-copy">
        <div class="expiring-name">${escapeHtml(actionLabel(taskAction(task), task.interaction_label || interactionDisplayName(task.interaction_type_code) || 'TTC'))}</div>
        <div class="expiring-date">${escapeHtml(compactTaskTarget(task))} · ${formatDateTime(task.updated_at)}</div>
      </div>
      <div class="ttc-task-action-controls">
        <span class="status-pill ${statusTone(task.status)}">${escapeHtml(statusLabel(task.status))}</span>
        ${canSubmit ? `<button class="btn-secondary compact-button" type="button" data-submit-owned-task="${escapeHtml(String(task.task_id || task.id || ''))}">Auto check</button>` : ''}
      </div>
      ${canSubmit ? `
        <form class="ttc-evidence-form hidden" data-submit-task-form="${task.task_id}">
          <input type="hidden" name="evidenceText" value="User yêu cầu hệ thống kiểm tra tự động">
        </form>
      ` : ''}
      ${task.rejection_reason ? `<div class="field-helper">${escapeHtml(task.rejection_reason)}</div>` : ''}
    </div>
  `;
}

async function claimTask(task, button) {
  state.processingTaskId = task.task_id;
  button.disabled = true;
  button.textContent = 'Đang nhận...';
  try {
    await TtcService.claimTask({
      campaignId: task.campaign_id,
      facebookAccountId: state.selectedFacebookAccountId,
    });
    Toast.show('Đã nhận nhiệm vụ.');
    await Promise.allSettled([loadAvailableTasks(), loadMyTasks()]);
    document.querySelector('.ttc-my-task-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? userFriendlyTtcFeatureMessage('nhận nhiệm vụ TTC')
      : error?.message || 'Không thể nhận nhiệm vụ.');
  } finally {
    state.processingTaskId = null;
    button.disabled = false;
    button.textContent = 'Nhận';
  }
}

async function claimTaskReward(task, button) {
  state.processingTaskId = taskStorageKey(task);
  button.disabled = true;
  button.textContent = 'Đang kiểm tra Facebook...';
  try {
    const { data } = await TtcService.claimTask({
      campaignId: task.campaign_id,
      facebookAccountId: state.selectedFacebookAccountId,
    });
    const claimedTaskId = data?.task?.id || data?.task?.task_id || task.task_id;
    await TtcService.submitTask(claimedTaskId, {
      target_url: task.target_url,
      target_label: task.target_label,
      action: taskAction(task),
      opened_target: true,
      submitted_from: 'user_portal_quick_claim',
    });
    const verification = await TtcService.autoVerifyFacebookTask(claimedTaskId);
    Toast.show(verification.verified && verification.credited
      ? `Facebook đã xác minh. Đã cộng +${task.worker_reward || 0} xu.`
      : verification.message || 'Facebook chưa xác minh nhiệm vụ, vui lòng thử lại sau.');
    clearOpenedTask(task);
    await Promise.allSettled([loadAvailableTasks(), loadMyTasks(), loadWallet()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? userFriendlyTtcFeatureMessage('nhận xu nhiệm vụ TTC')
      : error?.message || 'Không thể nhận xu nhiệm vụ.');
  } finally {
    state.processingTaskId = null;
    button.disabled = false;
    button.textContent = 'Gửi kiểm tra';
  }
}

async function submitTask(taskId, values, button) {
  const evidenceText = String(values.evidenceText || '').trim();
  if (!evidenceText) {
    Toast.show('Vui lòng nhập bằng chứng hoặc ghi chú trước khi gửi.');
    return;
  }
  state.processingTaskId = taskId;
  button.disabled = true;
  button.textContent = 'Đang auto check...';
  try {
    await TtcService.submitTask(taskId, {
      text: evidenceText,
      submitted_from: 'user_portal',
    });
    const verification = await TtcService.autoVerifyFacebookTask(taskId);
    Toast.show(verification.verified && verification.credited
      ? 'Facebook đã xác minh. Xu đã được cộng.'
      : verification.message || 'Facebook chưa xác minh nhiệm vụ, vui lòng thử lại sau.');
    await Promise.allSettled([loadMyTasks(), loadWallet()]);
  } catch (error) {
    Toast.show(isMissingDatabaseFeatureError(error)
      ? userFriendlyTtcFeatureMessage('gửi bằng chứng TTC')
      : error?.message || 'Không thể gửi bằng chứng.');
  } finally {
    state.processingTaskId = null;
    button.disabled = false;
    button.textContent = 'Auto check';
  }
}

function parseCommentOptions(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusLabel(status) {
  return {
    assigned: 'Đã nhận',
    submitted: 'Đã gửi',
    verifying: 'Đang kiểm tra',
    completed: 'Hoàn thành',
    rejected: 'Từ chối',
    expired: 'Hết hạn',
  }[status] || status || '—';
}

function statusTone(status) {
  if (status === 'completed') return 'success';
  if (['rejected', 'expired'].includes(status)) return 'danger';
  return '';
}

function campaignStatusTone(status) {
  if (status === 'completed') return 'success';
  if (['cancelled', 'failed'].includes(status)) return 'danger';
  return '';
}

function campaignStatusLabel(status) {
  return {
    draft: 'Nháp',
    queued: 'Chờ chạy',
    running: 'Đang chạy',
    paused: 'Tạm dừng',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
    failed: 'Lỗi',
  }[status] || status || '—';
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function showMigrationNotice(error, featureName) {
  if (!isMissingDatabaseFeatureError(error)) return;
  const notice = document.getElementById('ttc-migration-notice');
  if (!notice) return;
  notice.innerHTML = `
    <div class="notice warning">
      <strong>Chức năng đang được cập nhật</strong>
      <span>${escapeHtml(userFriendlyTtcFeatureMessage(featureName))}</span>
    </div>
  `;
}

function userFriendlyTtcFeatureMessage(featureName) {
  const name = String(featureName || '');
  if (/ví|payos|nạp|xu/i.test(name)) {
    return 'Ví xu đang được đồng bộ. Vui lòng thử lại sau hoặc liên hệ admin để được hỗ trợ nạp xu.';
  }
  if (/facebook/i.test(name)) {
    return 'Dữ liệu Facebook đang được đồng bộ. Vui lòng thử lại sau hoặc liên hệ admin nếu cần xử lý ngay.';
  }
  return 'Chức năng tương tác đang được cập nhật. Vui lòng thử lại sau hoặc liên hệ admin nếu cần xử lý ngay.';
}
