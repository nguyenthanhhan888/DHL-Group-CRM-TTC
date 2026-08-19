const MONTH_LABELS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
const CHART_COLORS = ['#6c63ff', '#f6a623', '#00d4aa', '#ef4444', '#3b82f6', '#a855f7', '#f97316', '#14b8a6'];
let latestRevenueSeries = [];
let latestCategoryDistribution = [];

if (typeof window !== 'undefined') {
  window.addEventListener('dhl:themechange', () => {
    if (latestRevenueSeries.length) renderRevenueChart(latestRevenueSeries);
    if (latestCategoryDistribution.length) renderCategoryChart(latestCategoryDistribution);
  });
}

export function renderRevenueChart(series) {
  latestRevenueSeries = Array.isArray(series) ? series : [];
  const canvas = document.getElementById('revenueChart');
  const empty = document.getElementById('revenueChartEmpty');
  if (!canvas || !empty) return;

  const hasRevenue = series.some((item) => item.total > 0);
  canvas.classList.toggle('hidden', !hasRevenue);
  empty.classList.toggle('hidden', hasRevenue);
  if (!hasRevenue) return;

  const context = setupCanvas(canvas, revenueChartHeight(canvas));
  if (!context) return;

  const { ctx, width, height } = context;
  const theme = chartTheme();
  const maxValue = Math.max(...series.map((item) => item.total), 1);
  const yAxisLabels = revenueAxisLabels(maxValue);
  const padding = {
    top: 24,
    right: 16,
    bottom: 36,
    left: revenueAxisPadding(ctx, yAxisLabels, width),
  };
  const chartHeight = height - padding.top - padding.bottom;
  const barSlot = (width - padding.left - padding.right) / 12;
  const barWidth = barSlot * 0.72;

  drawRevenueGrid(ctx, width, height, padding, yAxisLabels, theme);

  series.forEach((item, index) => {
    const x = padding.left + index * barSlot + (barSlot - barWidth) / 2;
    const barHeight = Math.max((item.total / maxValue) * chartHeight, item.total > 0 ? 4 : 0);
    const y = height - padding.bottom - barHeight;
    const gradient = ctx.createLinearGradient(x, y, x, height - padding.bottom);
    gradient.addColorStop(0, theme.primary);
    gradient.addColorStop(1, colorWithAlpha(theme.primary, 0.32));

    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, barWidth, barHeight, 6);
    ctx.fill();

    ctx.fillStyle = theme.label;
    ctx.font = '11px Be Vietnam Pro, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(MONTH_LABELS[index], x + barWidth / 2, height - padding.bottom + 18);

    if (item.total > 0) {
      ctx.fillStyle = theme.label;
      ctx.font = '700 10px Be Vietnam Pro, sans-serif';
      ctx.fillText(formatCompactCurrency(item.total), x + barWidth / 2, y - 6);
    }
  });
}

export function renderCategoryChart(distribution) {
  latestCategoryDistribution = Array.isArray(distribution) ? distribution : [];
  const canvas = document.getElementById('categoryChart');
  const empty = document.getElementById('categoryChartEmpty');
  if (!canvas || !empty) return;

  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  canvas.classList.toggle('hidden', total === 0);
  empty.classList.toggle('hidden', total > 0);
  if (total === 0) return;

  const context = setupCanvas(canvas, 216);
  if (!context) return;

  const { ctx, width, height } = context;
  const theme = chartTheme();
  const centerX = width * 0.35;
  const centerY = height / 2;
  const radius = Math.min(height / 2 - 12, 84);
  const innerRadius = radius * 0.54;
  let angle = -Math.PI / 2;

  distribution.forEach((item, index) => {
    const slice = (item.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    ctx.fill();
    angle += slice;
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  ctx.fillStyle = theme.center;
  ctx.fill();
  ctx.fillStyle = theme.centerText;
  ctx.font = '700 18px Be Vietnam Pro, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(total, centerX, centerY + 6);
  ctx.fillStyle = theme.label;
  ctx.font = '11px Be Vietnam Pro, sans-serif';
  ctx.fillText('Kiosk', centerX, centerY + 20);

  drawCategoryLegend(ctx, distribution, width, theme);
}

function drawRevenueGrid(ctx, width, height, padding, labels, theme) {
  const chartHeight = height - padding.top - padding.bottom;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + chartHeight * (1 - index / 4);
    ctx.beginPath();
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = theme.label;
    ctx.font = '11px Be Vietnam Pro, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(labels[index], padding.left - 8, y + 4);
  }
}

function revenueAxisLabels(maxValue) {
  return Array.from({ length: 5 }, (_, index) => formatCompactCurrency((maxValue * index) / 4));
}

function revenueChartHeight(canvas) {
  const containerHeight = canvas.parentElement?.clientHeight || 0;
  return Math.max(containerHeight, 320);
}

function revenueAxisPadding(ctx, labels, width) {
  ctx.font = '11px Be Vietnam Pro, sans-serif';
  const maxLabelWidth = labels.reduce((max, label) => Math.max(max, ctx.measureText(label).width), 0);
  const ideal = Math.ceil(maxLabelWidth + 20);
  const maxAllowed = Math.max(58, width * 0.28);
  return Math.min(Math.max(58, ideal), maxAllowed);
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  if (amount >= 1000000000) return `${formatCompactNumber(amount / 1000000000)} tỷ`;
  if (amount >= 1000000) return `${formatCompactNumber(amount / 1000000)}tr`;
  if (amount >= 1000) return `${formatCompactNumber(amount / 1000)}k`;
  return formatCompactNumber(amount);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value);
}

function drawCategoryLegend(ctx, distribution, width, theme) {
  const legendX = width * 0.68;
  const itemCount = Math.min(distribution.length, 6);
  const rowHeight = 26;
  const totalLegendHeight = itemCount * rowHeight;
  const legendY = (ctx.canvas.height / (window.devicePixelRatio || 1) - totalLegendHeight) / 2;

  distribution.slice(0, 6).forEach((item, index) => {
    const y = legendY + index * 26;
    const label = item.name.length > 14 ? `${item.name.slice(0, 14)}…` : item.name;
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    roundRect(ctx, legendX, y + 2, 12, 12, 3);
    ctx.fill();
    ctx.fillStyle = theme.label;
    ctx.font = '11px Be Vietnam Pro, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label} (${item.count})`, legendX + 16, y + 13);
  });
}

function chartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    primary: token('--primary', '#6c63ff'),
    grid: token('--chart-grid', 'rgba(255,255,255,.08)'),
    label: token('--chart-label', '#94a3b8'),
    center: token('--chart-center', '#1a1d2e'),
    centerText: token('--chart-center-text', '#ffffff'),
  };
}

function colorWithAlpha(color, alpha) {
  const hex = String(color).trim().match(/^#([\da-f]{6})$/i)?.[1];
  if (!hex) return color;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(',')},${alpha})`;
}

function setupCanvas(canvas, height) {
  const parent = canvas.parentElement;
  const width = parent?.clientWidth || 400;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function roundRect(ctx, x, y, width, height, radius) {
  if (height <= 0 || width <= 0) return;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    return;
  }

  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}
