import { ConnectionNotice } from '../components/ConnectionNotice.js';
import { renderCategoryChart, renderRevenueChart } from '../components/DashboardCharts.js';
import { EmptyState } from '../components/EmptyState.js';
import { renderIcon } from '../utils/icons.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatCard } from '../components/StatCard.js';
import { getExpiryWarningDays, normalizeExpiryWarningDays } from '../config/organization.js';
import { DashboardService } from '../services/DashboardService.js';
import { formatCurrency } from '../utils/currency.js';
import { daysUntil, formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

export function DashboardPage() {
  return `
    ${PageHeader({
      title: 'Tổng quan',
      description: 'Tổng quan dữ liệu CRM từ Supabase.',
    })}
    ${ConnectionNotice()}
    <div class="stats-grid">
      ${StatCard({ tone: 'blue', icon: renderIcon('users'), value: '—', label: 'Tổng khách hàng', statId: 'stat-total-customers' })}
      ${StatCard({ tone: 'purple', icon: renderIcon('kiosk'), value: '—', label: 'Tổng Kiosk', statId: 'stat-total-kiosks' })}
      ${StatCard({ tone: 'orange', icon: renderIcon('check-circle'), value: '—', label: 'Kiosk hoạt động', statId: 'stat-active-kiosks' })}
      ${StatCard({ tone: 'orange', icon: renderIcon('clock'), value: '—', label: 'Kiosk chờ duyệt', statId: 'stat-pending-kiosks' })}
      ${StatCard({ tone: 'red', icon: renderIcon('x-circle'), value: '—', label: 'Kiosk hết hạn', statId: 'stat-expired-kiosks' })}
      ${StatCard({ tone: 'orange', icon: renderIcon('warning'), value: '—', label: 'Kiosk sắp hết hạn', statId: 'stat-expiring-soon' })}
      ${StatCard({ tone: 'green', icon: renderIcon('money'), value: '—', label: 'Doanh thu tháng này', statId: 'stat-revenue-month', className: 'stat-card-fluid' })}
      ${StatCard({ tone: 'teal', icon: renderIcon('trending-up'), value: '—', label: 'Doanh thu năm', statId: 'stat-revenue-year', className: 'stat-card-fluid' })}
    </div>

    <div class="dashboard-grid">
      <section class="dash-card revenue-chart-card">
        <div class="dash-card-header"><h3>Doanh thu theo tháng</h3></div>
        <div class="chart-container">
          <canvas id="revenueChart" role="img" aria-label="Doanh thu theo tháng"></canvas>
          <div id="revenueChartEmpty" class="hidden">
            ${EmptyState({ title: 'Chưa có doanh thu', message: 'Không có thanh toán hoàn thành trong năm hiện tại.' })}
          </div>
        </div>
      </section>
      <section class="dash-card">
        <div class="dash-card-header"><h3>Kiosk sắp hết hạn</h3></div>
        <div id="expiring-list" class="expiring-list">
          ${EmptyState({ title: 'Đang tải dữ liệu', message: 'Đang đọc danh sách kiosk sắp hết hạn từ Supabase.' })}
        </div>
      </section>
      <section class="dash-card">
        <div class="dash-card-header"><h3>Đăng ký gần đây</h3></div>
        <div id="recent-list" class="recent-list">
          ${EmptyState({ title: 'Đang tải dữ liệu', message: 'Đang đọc đăng ký gần đây từ Supabase.' })}
        </div>
      </section>
      <section class="dash-card">
        <div class="dash-card-header"><h3>Phân bổ danh mục</h3></div>
        <div class="chart-container small">
          <canvas id="categoryChart" role="img" aria-label="Phân bổ danh mục"></canvas>
          <div id="categoryChartEmpty" class="hidden">
            ${EmptyState({ title: 'Chưa có Kiosk', message: 'Không có dữ liệu kiosk để vẽ phân bổ danh mục.' })}
          </div>
        </div>
      </section>
    </div>
  `;
}

DashboardPage.afterRender = async function afterRenderDashboard() {
  setDashboardLoading();

  try {
    const dashboard = await DashboardService.getDashboardData();
    renderSummary(dashboard.summary);
    renderRevenueChart(dashboard.charts.monthlyRevenue);
    renderCategoryChart(dashboard.charts.categoryDistribution);
    renderExpiringKiosks(dashboard.lists.expiringKiosks, dashboard.warningDays);
    renderRecentRegistrations(dashboard.lists.recentRegistrations);
  } catch (error) {
    renderDashboardError(error);
  }
};

function setDashboardLoading() {
  [
    'stat-total-customers',
    'stat-total-kiosks',
    'stat-active-kiosks',
    'stat-pending-kiosks',
    'stat-expired-kiosks',
    'stat-expiring-soon',
    'stat-revenue-month',
    'stat-revenue-year',
  ].forEach((id) => setText(id, '—'));
}

function renderSummary(summary) {
  setText('stat-total-customers', summary.totalCustomers);
  setText('stat-total-kiosks', summary.totalKiosks);
  setText('stat-active-kiosks', summary.activeKiosks);
  setText('stat-pending-kiosks', summary.pendingKiosks);
  setText('stat-expired-kiosks', summary.expiredKiosks);
  setText('stat-expiring-soon', summary.expiringSoon);
  setText('stat-revenue-month', formatCurrency(summary.revenueThisMonth));
  setText('stat-revenue-year', formatCurrency(summary.revenueThisYear));
}

function renderExpiringKiosks(kiosks, warningDays = getExpiryWarningDays()) {
  const element = document.getElementById('expiring-list');
  if (!element) return;

  const expiryWarningDays = normalizeWarningDays(warningDays);
  if (!kiosks.length) {
    element.innerHTML = EmptyState({
      title: 'Không có kiosk sắp hết hạn',
      message: expiringKiosksEmptyMessage(expiryWarningDays),
    });
    return;
  }

  element.innerHTML = kiosks.map((kiosk) => {
    const days = daysUntil(kiosk.end_date);
    const daysClass = days <= 7 ? 'days-danger' : 'days-warning';
    return `
      <div class="expiring-item">
        <div>
          <div class="expiring-name">${escapeHtml(kiosk.facebook_name || '—')}</div>
          <div class="expiring-date">${escapeHtml(kiosk.customers?.facebook_name || '—')} · HH: ${formatDate(kiosk.end_date)}</div>
        </div>
        <span class="expiring-days ${daysClass}">Còn ${days} ngày</span>
      </div>
    `;
  }).join('');
}

export function expiringKiosksEmptyMessage(warningDays = getExpiryWarningDays()) {
  return `Không tìm thấy kiosk sắp hết hạn trong ${normalizeWarningDays(warningDays)} ngày tới.`;
}

function normalizeWarningDays(value) {
  return value == null || value === '' ? getExpiryWarningDays() : normalizeExpiryWarningDays(value);
}

function renderRecentRegistrations(registrations) {
  const element = document.getElementById('recent-list');
  if (!element) return;

  if (!registrations.length) {
    element.innerHTML = EmptyState({
      title: 'Chưa có đăng ký gần đây',
      message: 'Không tìm thấy đăng ký Kiosk mới.',
    });
    return;
  }

  element.innerHTML = registrations.map((registration) => `
    <div class="recent-item">
      <span class="recent-registration-icon" aria-hidden="true">${renderIcon('store')}</span>
      <div class="recent-registration-copy">
        <div class="expiring-name">${escapeHtml(registration.kioskName || 'Kiosk')}</div>
        <div class="expiring-date">${formatDate(registration.createdAt)}</div>
      </div>
      <strong class="recent-registration-amount">${escapeHtml(formatCurrency(registration.amount))}</strong>
    </div>
  `).join('');
}

function renderDashboardError(error) {
  const message = escapeHtml(error?.message || 'Không thể tải dữ liệu tổng quan.');
  document.querySelectorAll('.chart-container').forEach((container) => {
    container.innerHTML = EmptyState({ title: 'Không thể tải dữ liệu', message });
  });
  ['expiring-list', 'recent-list'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = EmptyState({ title: 'Không thể tải dữ liệu', message });
  });
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}
