import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderIcon } from '../src/utils/icons.js';

// ── 1. renderIcon exists and returns SVG strings ─────────────────────────────

describe('renderIcon', () => {
  it('exports a function', () => {
    assert.strictEqual(typeof renderIcon, 'function');
  });

  it('returns non-empty string for known names', () => {
    const known = [
      'home', 'dashboard', 'users', 'store', 'check', 'coin', 'list',
      'briefcase', 'report', 'shield', 'settings', 'logout', 'menu',
      'check-circle', 'x-circle', 'x', 'clock', 'money', 'calendar',
      'trending-up', 'warning', 'chart', 'user', 'kiosk',
    ];
    for (const name of known) {
      const result = renderIcon(name);
      assert.ok(result.length > 0, `renderIcon('${name}') returned empty`);
    }
  });

  it('returns empty string for unknown names', () => {
    assert.strictEqual(renderIcon('this-does-not-exist'), '');
    assert.strictEqual(renderIcon(''), '');
  });

  it('every result contains an <svg> element', () => {
    const names = ['home', 'users', 'check-circle', 'warning', 'kiosk'];
    for (const name of names) {
      assert.ok(renderIcon(name).includes('<svg'), `renderIcon('${name}') has no <svg>`);
    }
  });

  it('SVGs have aria-hidden="true"', () => {
    const names = ['check-circle', 'x-circle', 'clock', 'money', 'warning'];
    for (const name of names) {
      assert.ok(renderIcon(name).includes('aria-hidden="true"'), `${name} missing aria-hidden`);
    }
  });

  it('SVGs have focusable="false"', () => {
    const names = ['check-circle', 'x', 'warning'];
    for (const name of names) {
      assert.ok(renderIcon(name).includes('focusable="false"'), `${name} missing focusable`);
    }
  });
});

// ── 2. No hardcoded colors in icon registry ───────────────────────────────────

describe('icons.js color hygiene', () => {
  it('contains no hardcoded fill or stroke color values', () => {
    const src = readFileSync('src/utils/icons.js', 'utf8');
    const hardcoded = /#[0-9a-fA-F]{3,6}|rgb\(|rgba\(|hsl\(|fill="(?!none)[^"]+"|stroke="(?!none|currentColor)[^"]+"/g;
    const matches = src.match(hardcoded);
    assert.strictEqual(matches, null, `Hardcoded color values found: ${JSON.stringify(matches)}`);
  });
});

// ── 3. Functional emoji removed from targeted surfaces ───────────────────────

describe('functional emoji removal', () => {
  const FUNCTIONAL_EMOJI_RE = /✅|❌|⏳|⏰|💵|📈|🏪|👥|📅|📊|⚠️|🧾|⬆️|⬇️|🗂️|🏷️/u;

  const targets = [
    'src/pages/DashboardPage.js',
    'src/pages/PaymentsPage.js',
    'src/pages/ReportsPage.js',
    'src/components/RenewKioskForm.js',
    'src/pages/LegacyRegistrationPage.js',
    'src/layouts/AppLayout.js',
    'src/components/PublicLayout.js',
  ];

  for (const file of targets) {
    it(`no functional emoji in ${file}`, () => {
      const src = readFileSync(file, 'utf8');
      const match = src.match(FUNCTIONAL_EMOJI_RE);
      assert.strictEqual(match, null, `Functional emoji found in ${file}: ${JSON.stringify(match)}`);
    });
  }
});

// ── 4. Imports use shared icon system ─────────────────────────────────────────

describe('shared icon imports', () => {
  it('DashboardPage imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/pages/DashboardPage.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'DashboardPage should import from utils/icons.js');
  });

  it('PaymentsPage imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/pages/PaymentsPage.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'PaymentsPage should import from utils/icons.js');
  });

  it('ReportsPage imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/pages/ReportsPage.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'ReportsPage should import from utils/icons.js');
  });

  it('RenewKioskForm imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/components/RenewKioskForm.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'RenewKioskForm should import from utils/icons.js');
  });

  it('LegacyRegistrationPage imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/pages/LegacyRegistrationPage.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'LegacyRegistrationPage should import from utils/icons.js');
  });

  it('AppLayout re-exports renderIcon from utils/icons', () => {
    const src = readFileSync('src/layouts/AppLayout.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'AppLayout should import from utils/icons.js');
    assert.ok(src.includes('export { renderIcon }'), 'AppLayout should re-export renderIcon');
  });

  it('PublicLayout imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/components/PublicLayout.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'PublicLayout should import from utils/icons.js');
  });

  it('UserHomePage imports renderIcon from utils/icons', () => {
    const src = readFileSync('src/pages/UserHomePage.js', 'utf8');
    assert.ok(src.includes("from '../utils/icons.js'"), 'UserHomePage should import from utils/icons.js');
  });
});

// ── 5. Modal close uses SVG, not bare character ───────────────────────────────

describe('modal close button', () => {
  it('AppLayout modal-close does not use bare ✕ character', () => {
    const src = readFileSync('src/layouts/AppLayout.js', 'utf8');
    assert.ok(!src.includes('>✕<'), 'AppLayout has bare ✕ in modal-close');
  });

  it('PublicLayout modal-close does not use bare ✕ character', () => {
    const src = readFileSync('src/components/PublicLayout.js', 'utf8');
    assert.ok(!src.includes('>✕<'), 'PublicLayout has bare ✕ in modal-close');
  });
});

// ── 6. Success states use SVG, not bare checkmarks ───────────────────────────

describe('success state icons', () => {
  it('RenewKioskForm uses renderIcon for success icon', () => {
    const src = readFileSync('src/components/RenewKioskForm.js', 'utf8');
    assert.ok(!src.includes('>✓<'), 'RenewKioskForm has bare ✓ in success icon');
    assert.ok(src.includes("renderIcon('check-circle')"), 'RenewKioskForm should use renderIcon check-circle');
  });

  it('LegacyRegistrationPage uses renderIcon for success icon', () => {
    const src = readFileSync('src/pages/LegacyRegistrationPage.js', 'utf8');
    assert.ok(!src.includes('>✓<'), 'LegacyRegistrationPage has bare ✓ in empty-state-icon');
    assert.ok(src.includes("renderIcon('check-circle')"), 'LegacyRegistrationPage should use renderIcon check-circle');
  });
});

// ── 7. No external icon library dependencies ─────────────────────────────────

describe('no external icon dependencies', () => {
  it('package.json adds no icon library', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const iconLibs = ['@heroicons', 'lucide', 'feather', 'react-icons', 'phosphor', 'tabler-icons'];
    for (const lib of iconLibs) {
      const found = Object.keys(allDeps).some((k) => k.includes(lib));
      assert.strictEqual(found, false, `External icon library detected: ${lib}`);
    }
  });
});

// ── 8. stat-icon CSS uses SVG sizing, not font-size ──────────────────────────

describe('stat-icon CSS', () => {
  it('app.css .stat-icon uses width/height not font-size for sizing', () => {
    const src = readFileSync('src/styles/app.css', 'utf8');
    const statIconBlock = src.match(/\.stat-icon\s*\{[^}]+\}/)?.[0] || '';
    assert.ok(!statIconBlock.includes('font-size'), '.stat-icon should not use font-size');
    assert.ok(statIconBlock.includes('width') || statIconBlock.includes('height'), '.stat-icon should define width or height');
  });
});
