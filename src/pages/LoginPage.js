import { AuthService } from '../services/AuthService.js';
import { ROLES } from '../constants/roles.js';
import { escapeHtml } from '../utils/html.js';
import { PUBLIC_BRAND } from '../config/organization.js';

export function LoginPage({ message = '' } = {}) {
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
                <span class="auth-panel-kicker">Cổng chính thức</span>
                <h2>${PUBLIC_BRAND.name}</h2>
                <p>Truy cập tài khoản để quản lý Kiosk và sử dụng các tiện ích dành cho thành viên cộng đồng.</p>
                <p class="auth-story-tagline">Kết nối rõ ràng • Quản lý thuận tiện</p>
              </div>
            </aside>
            <div class="auth-panel auth-account-panel">
              <div class="auth-tab-list" role="tablist" aria-label="Tài khoản web">
                <button id="auth-tab-login" class="auth-tab-button active" type="button" role="tab" aria-selected="true" aria-controls="login-form" tabindex="0" data-auth-tab="login">Đăng nhập</button>
                <button id="auth-tab-register" class="auth-tab-button" type="button" role="tab" aria-selected="false" aria-controls="account-register-form" tabindex="-1" data-auth-tab="register">Đăng ký tài khoản</button>
              </div>
              <form id="login-form" class="auth-form-panel" role="tabpanel" aria-labelledby="auth-tab-login" data-auth-panel="login" novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">Đăng nhập</span>
                  <h2>Đăng nhập tài khoản</h2>
                  <p>Vào dashboard quản lý Kiosk và TTC.</p>
                </div>
                <label class="form-group">
                  <span>Email, username hoặc SĐT</span>
                  <input id="login-email" class="form-control" autocomplete="username" required />
                </label>
                <div id="login-error" class="form-error auth-panel-message ${message ? '' : 'hidden'}" role="alert" aria-live="polite">${escapeHtml(message)}</div>
                <label class="form-group">
                  <span>Mật khẩu</span>
                  <input id="login-password" class="form-control" type="password" autocomplete="current-password" required />
                </label>
                <button id="login-submit" class="btn-primary auth-submit" type="submit">Đăng nhập</button>
              </form>
              <form id="login-mfa-form" class="auth-form-panel hidden" data-auth-panel="mfa" novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">Bảo mật 2 lớp</span>
                  <h2>Xác minh Authenticator</h2>
                  <p>Nhập mã 6 số từ Google Authenticator hoặc ứng dụng tương tự.</p>
                </div>
                <label class="form-group">
                  <span>Mã Authenticator</span>
                  <input id="login-mfa-code" class="form-control" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
                </label>
                <span data-auth-message-anchor="mfa"></span>
                <button id="login-mfa-submit" class="btn-primary auth-submit" type="submit">Xác minh</button>
                <button id="login-mfa-back" class="btn-secondary auth-submit" type="button">Đăng nhập lại</button>
              </form>
              <form id="account-register-form" class="auth-form-panel hidden" role="tabpanel" aria-labelledby="auth-tab-register" data-auth-panel="register" hidden novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">Tài khoản web</span>
                  <h2>Đăng ký tài khoản</h2>
                  <p>Tạo tài khoản để dùng ví chung, Kiosk và các flow Facebook.</p>
                </div>
                <div class="form-row">
                  <label class="form-group">
                    <span>Họ và tên</span>
                    <input id="register-account-name" class="form-control" autocomplete="name" required />
                  </label>
                  <label class="form-group">
                    <span>Username</span>
                    <input id="register-account-username" class="form-control" autocomplete="username" minlength="3" maxlength="40" pattern="[a-z0-9._-]+" required />
                  </label>
                </div>
                <span data-auth-message-anchor="register"></span>
                <label class="form-group">
                  <span>Số điện thoại (không bắt buộc)</span>
                  <input id="register-account-phone" class="form-control" type="tel" autocomplete="tel" />
                </label>
                <label class="form-group">
                  <span>Email liên hệ (không bắt buộc)</span>
                  <input id="register-account-email" class="form-control" type="email" autocomplete="email" />
                </label>
                <div class="form-row">
                  <label class="form-group">
                    <span>Mật khẩu</span>
                    <input id="register-account-password" class="form-control" type="password" autocomplete="new-password" required />
                  </label>
                  <label class="form-group">
                    <span>Xác nhận mật khẩu</span>
                    <input id="register-account-confirm" class="form-control" type="password" autocomplete="new-password" required />
                  </label>
                </div>
                <button id="account-register-submit" class="btn-primary auth-submit" type="submit">Tạo tài khoản</button>
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
  setLoading(document.getElementById('account-register-submit'), false, 'Đang tạo tài khoản...', 'Tạo tài khoản');
  let pendingMfaFactorId = '';
  placeAuthMessage('login');

  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => switchAuthTab(button.dataset.authTab || 'login'));
    button.addEventListener('keydown', handleAuthTabKeydown);
  });

  document.getElementById('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const identifier = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value || '';
    const button = document.getElementById('login-submit');
    const errorElement = document.getElementById('login-error');

    if (!identifier || !password) {
      showError(errorElement, 'Vui lòng nhập email/username/SĐT và mật khẩu.');
      return;
    }

    setLoading(button, true);
    errorElement?.classList.add('hidden');

    try {
      const authData = await withTimeout(
        AuthService.signIn(identifier, password),
        15_000,
        'Đăng nhập phản hồi quá chậm. Vui lòng thử lại.'
      );
      if (authData?.mfaRequired) {
        pendingMfaFactorId = authData.mfaFactorId || '';
        switchAuthTab('mfa');
        document.getElementById('login-mfa-code')?.focus();
        return;
      }
      const profile = await AuthService.getCurrentProfile(authData?.user?.id);
      window.location.hash = profile?.role === ROLES.ADMIN ? '#/dashboard' : '#/user';
      window.location.reload();
    } catch (error) {
      const message = error?.code === 'AUTH_TIMEOUT'
        ? error.message
        : error?.message === 'Email not confirmed'
        ? 'Tài khoản chưa được kích hoạt. Vui lòng liên hệ admin.'
        : 'Email/username/SĐT hoặc mật khẩu không đúng.';
      showError(errorElement, message);
    } finally {
      setLoading(button, false);
    }
  });

  document.getElementById('login-mfa-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = document.getElementById('login-mfa-code')?.value.trim();
    const button = document.getElementById('login-mfa-submit');
    const errorElement = document.getElementById('login-error');
    if (!/^\d{6}$/.test(code || '')) {
      showError(errorElement, 'Vui lòng nhập mã Authenticator gồm 6 chữ số.');
      return;
    }
    setLoading(button, true, 'Đang xác minh...', 'Xác minh');
    errorElement?.classList.add('hidden');
    try {
      const authData = await withTimeout(
        AuthService.completeTotpMfa(pendingMfaFactorId, code),
        15_000,
        'Xác minh phản hồi quá chậm. Vui lòng thử lại.'
      );
      const profile = await AuthService.getCurrentProfile(authData?.session?.user?.id);
      window.location.hash = profile?.role === ROLES.ADMIN ? '#/dashboard' : '#/user';
      window.location.reload();
    } catch (error) {
      showError(errorElement, error?.message || 'Mã Authenticator chưa đúng.');
    } finally {
      setLoading(button, false, 'Đang xác minh...', 'Xác minh');
    }
  });

  document.getElementById('login-mfa-back')?.addEventListener('click', async () => {
    await AuthService.signOut().catch(() => null);
    pendingMfaFactorId = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-mfa-code').value = '';
    switchAuthTab('login');
  });

  document.getElementById('account-register-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const displayName = document.getElementById('register-account-name')?.value.trim();
    const username = document.getElementById('register-account-username')?.value.trim().toLowerCase();
    const phone = document.getElementById('register-account-phone')?.value.trim();
    const email = document.getElementById('register-account-email')?.value.trim();
    const password = document.getElementById('register-account-password')?.value || '';
    const confirm = document.getElementById('register-account-confirm')?.value || '';
    const button = document.getElementById('account-register-submit');
    const errorElement = document.getElementById('login-error');

    if (!displayName || !username || !password) {
      showError(errorElement, 'Vui lòng nhập họ tên, username và mật khẩu.');
      return;
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      showError(errorElement, 'Username cần 3-40 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới.');
      return;
    }
    if (password.length < 6) {
      showError(errorElement, 'Mật khẩu cần ít nhất 6 ký tự.');
      return;
    }
    if (password !== confirm) {
      showError(errorElement, 'Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(button, true, 'Đang tạo tài khoản...');
    errorElement?.classList.add('hidden');
    try {
      await AuthService.signUp({ username, email, password, displayName, phone });
      showError(errorElement, phone
        ? 'Đã tạo tài khoản và ví xu. Bạn có thể đăng nhập bằng username hoặc SĐT.'
        : 'Đã tạo tài khoản và ví xu. Bạn có thể đăng nhập bằng username.'
      );
      errorElement?.classList.remove('form-error');
      errorElement?.classList.add('notice', 'success');
      form?.reset?.();
      const loginEmail = document.getElementById('login-email');
      if (loginEmail) loginEmail.value = username;
      switchAuthTab('login', { preserveMessage: true });
    } catch (error) {
      showError(errorElement, accountRegisterErrorMessage(error));
    } finally {
      setLoading(button, false, 'Đang tạo tài khoản...', 'Tạo tài khoản');
    }
  });
};

function switchAuthTab(tab, { preserveMessage = false } = {}) {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    const active = button.dataset.authTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
    const active = panel.dataset.authPanel === tab;
    panel.classList.toggle('hidden', !active);
    panel.hidden = !active;
  });
  placeAuthMessage(tab);
  const errorElement = document.getElementById('login-error');
  if (preserveMessage) {
    errorElement?.classList.toggle('hidden', !errorElement.textContent.trim());
    return;
  }
  errorElement?.classList.toggle('hidden', !errorElement.textContent.trim());
  errorElement?.classList.add('form-error');
  errorElement?.classList.remove('notice', 'success');
}

function handleAuthTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-auth-tab]')];
  if (!tabs.length) return;
  event.preventDefault();
  const current = Math.max(0, tabs.indexOf(event.currentTarget));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  switchAuthTab(tabs[next].dataset.authTab);
  tabs[next].focus();
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function placeAuthMessage(tab) {
  const errorElement = document.getElementById('login-error');
  if (!errorElement) return;
  if (tab === 'login') {
    document.querySelector('#login-email')?.closest('.form-group')?.after(errorElement);
    return;
  }
  const anchor = document.querySelector(`[data-auth-message-anchor="${tab}"]`);
  anchor?.after(errorElement);
}

function accountRegisterErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'Tài khoản này đã tồn tại. Vui lòng chuyển sang tab Đăng nhập.';
  }
  if (message.includes('email address') && message.includes('invalid')) {
    return 'Email không hợp lệ. Vui lòng dùng email thật, ví dụ ten@gmail.com.';
  }
  if (message.includes('rate limit')) {
    return 'Hệ thống đang giới hạn số lần tạo tài khoản. Vui lòng chờ ít phút rồi thử lại.';
  }
  if (message.includes('password')) {
    return 'Mật khẩu chưa hợp lệ. Vui lòng dùng mật khẩu ít nhất 6 ký tự.';
  }
  return error?.message || 'Không thể tạo tài khoản.';
}

function setLoading(button, loading, loadingText = 'Đang đăng nhập...', idleText = 'Đăng nhập') {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? loadingText : idleText;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(message);
      error.code = 'AUTH_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}
