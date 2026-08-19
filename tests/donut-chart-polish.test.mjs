import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chartsUrl = new URL('../src/components/DashboardCharts.js', import.meta.url);
const cssUrl = new URL('../src/styles/app.css', import.meta.url);
const dashboardUrl = new URL('../src/pages/DashboardPage.js', import.meta.url);

test('category chart canvas height is at least 210px (larger than Phase 3 180px)', async () => {
  const src = await readFile(chartsUrl, 'utf8');
  const match = src.match(/setupCanvas\(canvas,\s*(\d+)\)/g);
  const categorySetup = match?.find((m) => !m.includes('revenueChartHeight'));
  assert.ok(categorySetup, 'renderCategoryChart calls setupCanvas with a fixed height');
  const height = Number(categorySetup.match(/(\d+)\)/)?.[1]);
  assert.ok(height >= 210, `Canvas height ${height} should be >= 210`);
});

test('category donut radius cap is at least 80px (larger than Phase 3 70px)', async () => {
  const src = await readFile(chartsUrl, 'utf8');
  const match = src.match(/Math\.min\(height\s*\/\s*2\s*-\s*\d+,\s*(\d+)\)/);
  assert.ok(match, 'Radius is capped with Math.min');
  const cap = Number(match[1]);
  assert.ok(cap >= 80, `Radius cap ${cap} should be >= 80`);
});

test('category donut inner radius ratio is between 0.50 and 0.60', async () => {
  const src = await readFile(chartsUrl, 'utf8');
  const match = src.match(/innerRadius\s*=\s*radius\s*\*\s*([\d.]+)/);
  assert.ok(match, 'innerRadius is defined as a fraction of radius');
  const ratio = Number(match[1]);
  assert.ok(ratio >= 0.50 && ratio <= 0.60, `Inner radius ratio ${ratio} should be between 0.50 and 0.60`);
});

test('category legend is vertically centered relative to canvas height, not fixed at y=10', async () => {
  const src = await readFile(chartsUrl, 'utf8');
  const legendFn = src.slice(src.indexOf('function drawCategoryLegend'));
  assert.doesNotMatch(legendFn, /legendY\s*=\s*10\b/, 'legendY must not be hardcoded to 10');
  assert.match(legendFn, /canvas\.height/, 'legendY should be computed from canvas height');
});

test('chart-container.small uses flex alignment for vertical centering', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const smallBlock = css.slice(css.indexOf('.chart-container.small'));
  const blockEnd = smallBlock.indexOf('}') + 1;
  const block = smallBlock.slice(0, blockEnd);
  assert.match(block, /display\s*:\s*flex/, '.chart-container.small must use display:flex');
  assert.match(block, /align-items\s*:\s*center/, '.chart-container.small must use align-items:center');
});

test('chart-container.small min-height matches canvas height', async () => {
  const [src, css] = await Promise.all([readFile(chartsUrl, 'utf8'), readFile(cssUrl, 'utf8')]);
  const canvasHeight = Number(src.match(/setupCanvas\(canvas,\s*(\d+)\)/g)
    ?.find((m) => !m.includes('revenueChartHeight'))
    ?.match(/(\d+)\)/)?.[1]);
  const cssHeight = Number(css.match(/\.chart-container\.small\s*\{[^}]*min-height\s*:\s*(\d+)px/)?.[1]);
  assert.ok(canvasHeight > 0 && cssHeight > 0, 'Both heights should be parseable');
  assert.equal(cssHeight, canvasHeight, 'CSS min-height should match canvas setup height');
});

test('canvas theme tokens are all present and no hardcoded colors in fill/stroke assignments', async () => {
  const src = await readFile(chartsUrl, 'utf8');
  for (const token of ['--primary', '--chart-grid', '--chart-label', '--chart-center', '--chart-center-text']) {
    assert.match(src, new RegExp(token), `Token ${token} must be used`);
  }
  assert.doesNotMatch(src, /ctx\.(?:fillStyle|strokeStyle)\s*=\s*['"](?:#|rgba?\()/,
    'No hardcoded color strings should be assigned to fillStyle or strokeStyle');
});

test('dashboard category card HTML still uses chart-container small class', async () => {
  const src = await readFile(dashboardUrl, 'utf8');
  assert.match(src, /class="chart-container small"/, 'Category card must keep chart-container small class');
  assert.match(src, /id="categoryChart"/, 'Canvas element must retain its id');
});
