const MONTH_LABELS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
const CHART_COLORS = ['#6c63ff', '#f6a623', '#00d4aa', '#ef4444', '#3b82f6', '#a855f7', '#f97316', '#14b8a6'];

export function renderRevenueChart(series) {
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

  drawRevenueGrid(ctx, width, height, padding, yAxisLabels);

  series.forEach((item, index) => {
    const x = padding.left + index * barSlot + (barSlot - barWidth) / 2;
    const barHeight = Math.max((item.total / maxValue) * chartHeight, item.total > 0 ? 4 : 0);
    const y = height - padding.bottom - barHeight;
    const gradient = ctx.createLinearGradient(x, y, x, height - padding.bottom);
    gradient.addColorStop(0, 'rgba(108, 99, 255, 0.9)');
    gradient.addColorStop(1, 'rgba(168, 85, 247, 0.4)');

    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, barWidth, barHeight, 6);
    ctx.fill();

    ctx.fillStyle = '#64748b';
    ctx.font = '11px Be Vietnam Pro, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(MONTH_LABELS[index], x + barWidth / 2, height - padding.bottom + 18);

    if (item.total > 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 10px Be Vietnam Pro, sans-serif';
      ctx.fillText(formatCompactCurrency(item.total), x + barWidth / 2, y - 6);
    }
  });
}

export function renderCategoryChart(distribution) {
  const canvas = document.getElementById('categoryChart');
  const empty = document.getElementById('categoryChartEmpty');
  if (!canvas || !empty) return;

  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  canvas.classList.toggle('hidden', total === 0);
  empty.classList.toggle('hidden', total > 0);
  if (total === 0) return;

  const context = setupCanvas(canvas, 180);
  if (!context) return;

  const { ctx, width, height } = context;
  const centerX = width * 0.35;
  const centerY = height / 2;
  const radius = Math.min(height / 2 - 10, 70);
  const innerRadius = radius * 0.55;
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
  ctx.fillStyle = '#1a1d2e';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px Be Vietnam Pro, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(total, centerX, centerY + 6);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Be Vietnam Pro, sans-serif';
  ctx.fillText('Kiosk', centerX, centerY + 20);

  drawCategoryLegend(ctx, distribution, width);
}

function drawRevenueGrid(ctx, width, height, padding, labels) {
  const chartHeight = height - padding.top - padding.bottom;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + chartHeight * (1 - index / 4);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = '#475569';
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

function drawCategoryLegend(ctx, distribution, width) {
  const legendX = width * 0.68;
  const legendY = 10;

  distribution.slice(0, 6).forEach((item, index) => {
    const y = legendY + index * 26;
    const label = item.name.length > 14 ? `${item.name.slice(0, 14)}…` : item.name;
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    roundRect(ctx, legendX, y + 2, 12, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Be Vietnam Pro, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label} (${item.count})`, legendX + 16, y + 13);
  });
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
