import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CompactAction } from '../src/components/CompactAction.js';
import { StatusBadge } from '../src/components/StatusBadge.js';

test('required Kiosk states use distinct semantic badge treatments', () => {
  const expected = {
    active: ['Hoạt động', 'success'],
    warning: ['Sắp hết hạn', 'warning'],
    expired: ['Hết hạn', 'danger'],
    pending: ['Chờ duyệt', 'pending'],
    suspended: ['Tạm ngưng', 'neutral'],
  };

  for (const [status, [label, tone]] of Object.entries(expected)) {
    const html = StatusBadge(status);
    assert.match(html, new RegExp(`status-badge--${tone}`));
    assert.match(html, new RegExp(label));
    assert.match(html, /status-dot/);
  }
});

test('compact actions include SVG icons and semantic action tones', () => {
  const actions = [
    CompactAction({ label: 'Xem', icon: 'view', tone: 'info', href: '#/kiosks' }),
    CompactAction({ label: 'Sửa', icon: 'edit', tone: 'secondary' }),
    CompactAction({ label: 'Gia hạn', icon: 'refresh', tone: 'positive' }),
    CompactAction({ label: 'Ngừng', icon: 'pause', tone: 'warning' }),
    CompactAction({ label: 'Xóa', icon: 'trash', tone: 'danger' }),
  ];

  actions.forEach((html) => assert.match(html, /compact-action.*<svg/));
  assert.match(actions.join('\n'), /compact-action--(info|secondary|positive|warning|danger)/);
});

test('shared CSS gives badges tint, border and compact actions a bounded size', async () => {
  const css = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-badge\s*\{[^}]*background|\.status-badge--success/s);
  assert.match(css, /\.status-badge--pending[^}]*background:/s);
  assert.match(css, /\.status-badge--neutral[^}]*border-color:/s);
  assert.match(css, /\.compact-action\s*\{[^}]*min-height:30px/s);
});
