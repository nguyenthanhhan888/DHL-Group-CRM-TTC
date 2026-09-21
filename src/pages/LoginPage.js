import { AuthService } from '../services/AuthService.js';
import { ROUTE_PERMISSIONS } from '../constants/permissions.js';
import { escapeHtml } from '../utils/html.js';
import { PUBLIC_BRAND } from '../config/organization.js';

const GENERIC_AUTH_ERROR = 'Tên đăng nhập hoặc mật khẩu không chính xác.';

export function LoginPage({ message = '' } = {}) {
  const registrationMessage = readRegistrationMessage();
  return `
    <main class="auth-shell">
      <section class="auth-landing auth-landing-expanded">
        <div class="auth-intro-panel">
          <div class="auth-main-grid">
            <aside class="auth-story-panel" aria-label="Giới thiệu cổng DHL">
              <div class="auth-story-media">
                <img src="${PUBLIC_BRAND.assets.cover}" alt="Ảnh bìa cộng đồng ${PUBLIC_BRAND.communityName}" width="1942" height="809">
              </div>
              <div class="auth-story-content">
                <span class="auth-panel-kicker">Cổng quản trị chính thức</span>
                <h2>${PUBLIC_BRAND.name}</h2>
                <p>Đăng nhập bằng tên tài khoản để truy cập đúng các chức năng đã được cấp quyền.</p>
                <p class="auth-story-tagline">An toàn • Rõ quyền • Dễ quản lý</p>
              </div>
            </aside>
            <div class="auth-panel auth-account-panel">
              <form id="login-form" class="auth-form-panel" novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">DHL Group CRM</span>
                  <h2>Đăng nhập hệ thống</h2>
                  <p>Sử dụng username và mật khẩu của bạn.</p>
                </div>
                <label class="form-group">
                  <span>Tên đăng nhập</span>
                  <input id="login-username" class="form-control" autocomplete="username" autocapitalize="none" spellcheck="false" required>
                </label>
                <label class="form-group">
                  <span>Mật khẩu</span>
                  <span class="password-input-wrap">
                    <input id="login-password" class="form-control" type="password" autocomplete="current-password" required>
                    <button class="password-visibility-toggle" type="button" data-password-toggle aria-label="Hiện mật khẩu">Hiện</button>
                  </span>
                </label>
                <div id="login-success" class="auth-panel-message auth-success-message ${registrationMessage ? '' : 'hidden'}" role="status" aria-live="polite">${escapeHtml(registrationMessage)}</div>
                <div id="login-error" class="form-error auth-panel-message ${message ? '' : 'hidden'}" role="alert" aria-live="polite">${escapeHtml(message)}</div>
                <button id="login-submit" class="btn-primary auth-submit" type="submit">Đăng nhập</button>
                <p class="auth-account-link">Chưa có tài khoản? <a href="#/signup">Đăng ký</a></p>
              </form>
              <form id="login-mfa-form" class="auth-form-panel hidden" hidden novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">Bảo mật 2 lớp</span>
                  <h2>Xác minh Authenticator</h2>
                  <p>Nhập mã 6 số từ ứng dụng Authenticator.</p>
                </div>
                <label class="form-group">
                  <span>Mã Authenticator</span>
                  <input id="login-mfa-code" class="form-control" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
                </label>
                <button id="login-mfa-submit" class="btn-primary auth-submit" type="submit">Xác minh</button>
                <button id="login-mfa-back" class="btn-secondary auth-submit" type="button">Đăng nhập lại</button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}

LoginPage.afterRender = function afterRenderLogin() {
  setLoading(document.getElementById('login-submit'), false);
  setLoading(document.getElementById('login-mfa-submit'), false, 'Đang xác minh...', 'Xác minh');
  let pendingMfaFactorId = '';

  document.querySelector('[data-password-toggle]')?.addEventListener('click', (event) => {
    const input = document.getElementById('login-password');
    if (!input) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    event.currentTarget.textContent = visible ? 'Hiện' : 'Ẩn';
    event.currentTarget.setAttribute('aria-label', visible ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
  });

  document.getElementById('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('login-username')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('login-password')?.value || '';
    const button = document.getElementById('login-submit');
    const errorElement = document.getElementById('login-error');
    if (!username || !password) {
      showError(errorElement, GENERIC_AUTH_ERROR);
      return;
    }
    setLoading(button, true);
    errorElement?.classList.add('hidden');
    try {
      const authData = await withTimeout(AuthService.signIn(username, password), 15_000, GENERIC_AUTH_ERROR);
      if (authData?.mfaRequired) {
        pendingMfaFactorId = authData.mfaFactorId || '';
        switchPanel('mfa');
        document.getElementById('login-mfa-code')?.focus();
        return;
      }
      const profile = await AuthService.getCurrentProfile(authData?.user?.id);
      enterAuthenticatedApp(profile);
    } catch {
      showError(errorElement, GENERIC_AUTH_ERROR);
    } finally {
      setLoading(button, false);
    }
  });

  document.getElementById('login-mfa-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = document.getElementById('login-mfa-code')?.value.trim() || '';
    const button = document.getElementById('login-mfa-submit');
    const errorElement = document.getElementById('login-error');
    if (!/^\d{6}$/.test(code)) {
      showError(errorElement, 'Vui lòng nhập mã Authenticator gồm 6 chữ số.');
      return;
    }
    setLoading(button, true, 'Đang xác minh...', 'Xác minh');
    try {
      const authData = await withTimeout(AuthService.completeTotpMfa(pendingMfaFactorId, code), 15_000, 'Không thể xác minh Authenticator.');
      const profile = await AuthService.getCurrentProfile(authData?.session?.user?.id);
      enterAuthenticatedApp(profile);
    } catch (error) {
      showError(errorElement, error?.message || 'Mã Authenticator chưa đúng.');
    } finally {
      setLoading(button, false, 'Đang xác minh...', 'Xác minh');
    }
  });

  document.getElementById('login-mfa-back')?.addEventListener('click', async () => {
    await AuthService.signOut().catch(() => null);
    pendingMfaFactorId = '';
    const password = document.getElementById('login-password');
    const code = document.getElementById('login-mfa-code');
    if (password) password.value = '';
    if (code) code.value = '';
    switchPanel('login');
  });
};

function enterAuthenticatedApp(profile) {
  window.location.hash = `#/${defaultRoute(profile)}`;
  window.location.reload();
}

function defaultRoute(profile) {
  if (profile?.is_system_admin || profile?.permissions?.includes('dashboard')) return 'dashboard';
  const permissions = new Set(profile?.permissions || []);
  const preferredRoutes = ['reports', 'customers', 'kiosks', 'registration-requests', 'admin', 'user-management', 'logs', 'settings'];
  return preferredRoutes.find((route) => permissions.has(ROUTE_PERMISSIONS[route])) || 'user';
}

function readRegistrationMessage() {
  if (typeof sessionStorage === 'undefined') return '';
  const message = sessionStorage.getItem('account-registration-success') || '';
  sessionStorage.removeItem('account-registration-success');
  return message;
}

function switchPanel(panel) {
  const login = document.getElementById('login-form');
  const mfa = document.getElementById('login-mfa-form');
  const showMfa = panel === 'mfa';
  login?.classList.toggle('hidden', showMfa);
  if (login) login.hidden = showMfa;
  mfa?.classList.toggle('hidden', !showMfa);
  if (mfa) mfa.hidden = !showMfa;
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function setLoading(button, loading, loadingText = 'Đang đăng nhập...', idleText = 'Đăng nhập') {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? loadingText : idleText;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}
