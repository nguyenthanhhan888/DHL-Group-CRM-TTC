import { AuthService } from '../services/AuthService.js';
import { ROLES } from '../constants/roles.js';
import { escapeHtml } from '../utils/html.js';
import { PublicFooter, PublicHeader, bindPublicNavigation, publicIcon } from '../components/OfficialCommunityCard.js';

export function LoginPage({ message = '' } = {}) {
  return `
    <div class="auth-public-site public-site">
    ${PublicHeader({ route: 'login' })}
    <main class="auth-shell">
      <section class="auth-landing auth-landing-expanded">
        <div class="auth-intro-panel">
          <div class="auth-brand-row">
            <div class="auth-logo dhl-logo-mark" aria-label="DHL Group">
              <img src="logo/photo_2026-08-03_06-31-15.jpg" alt="DHL Group">
            </div>
            <div>
              <h1>Diễn Châu - À Đây Rồi (DHL)</h1>
              <p>Cổng quản lý Kiosk, ví xu và tương tác chéo Facebook.</p>
            </div>
          </div>
          <div id="login-error" class="form-error ${message ? '' : 'hidden'}">${escapeHtml(message)}</div>
          <div class="auth-main-grid">
            <aside class="auth-story-panel" aria-label="Giới thiệu ADAYROIDC.COM">
              <div class="auth-story-media">
                <img src="images/cover.PNG" alt="Cộng đồng ADAYROIDC.COM">
              </div>
              <div class="auth-story-content">
                <h2>ADAYROIDC.COM</h2>
                <p>Cổng tài khoản dành cho thành viên quản lý Kiosk, ví xu và hoạt động tương tác cộng đồng.</p>
                <ul class="auth-feature-list">
                  <li>${publicIcon('check')} Quản lý Kiosk tập trung</li>
                  <li>${publicIcon('check')} Theo dõi ví xu và thanh toán</li>
                  <li>${publicIcon('check')} Sử dụng các tính năng tương tác</li>
                  <li>${publicIcon('check')} Xem lịch sử hoạt động</li>
                </ul>
                <p class="auth-story-tagline">Nhanh chóng - Minh bạch - An toàn - Hiệu quả.</p>
              </div>
            </aside>
            <div class="auth-panel auth-account-panel">
              <div class="auth-tab-list" role="tablist" aria-label="Tài khoản web">
                <button class="auth-tab-button active" type="button" role="tab" aria-selected="true" data-auth-tab="login">Đăng nhập</button>
                <button class="auth-tab-button" type="button" role="tab" aria-selected="false" data-auth-tab="register">Đăng ký tài khoản</button>
              </div>
              <form id="login-form" class="auth-form-panel" data-auth-panel="login" novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">Đăng nhập</span>
                  <h2>Đăng nhập tài khoản</h2>
                  <p>Vào dashboard quản lý Kiosk và TTC.</p>
                </div>
                <label class="form-group">
                  <span>Email, username hoặc SĐT</span>
                  <input id="login-email" class="form-control" autocomplete="username" required />
                </label>
                <label class="form-group">
                  <span>Mật khẩu</span>
                  <span class="auth-password-control"><input id="login-password" class="form-control" type="password" autocomplete="current-password" required /><button type="button" aria-label="Hiện mật khẩu" data-password-toggle="login-password">${publicIcon('eye')}</button></span>
                </label>
                <button id="login-submit" class="btn-primary auth-submit" type="submit">Đăng nhập</button>
              </form>
              <form id="account-register-form" class="auth-form-panel hidden" data-auth-panel="register" novalidate>
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
                <label class="form-group">
                  <span>Số điện thoại</span>
                  <input id="register-account-phone" class="form-control" type="tel" autocomplete="tel" required />
                </label>
                <label class="form-group">
                  <span>Email liên hệ (không bắt buộc)</span>
                  <input id="register-account-email" class="form-control" type="email" autocomplete="email" />
                </label>
                <div class="form-row">
                  <label class="form-group">
                    <span>Mật khẩu</span>
                    <span class="auth-password-control"><input id="register-account-password" class="form-control" type="password" autocomplete="new-password" required /><button type="button" aria-label="Hiện mật khẩu" data-password-toggle="register-account-password">${publicIcon('eye')}</button></span>
                  </label>
                  <label class="form-group">
                    <span>Xác nhận mật khẩu</span>
                    <span class="auth-password-control"><input id="register-account-confirm" class="form-control" type="password" autocomplete="new-password" required /><button type="button" aria-label="Hiện mật khẩu" data-password-toggle="register-account-confirm">${publicIcon('eye')}</button></span>
                  </label>
                </div>
                <button id="account-register-submit" class="btn-primary auth-submit" type="submit">Tạo tài khoản</button>
              </form>
              <div class="auth-assurance-panel" aria-label="Lợi ích tài khoản">
                <div>
                  <strong>Đăng nhập linh hoạt</strong>
                  <span>Dùng username, số điện thoại hoặc email.</span>
                </div>
                <div>
                  <strong>Tạo tài khoản nhanh</strong>
                  <span>Hoàn tất thông tin và đăng nhập ngay sau khi tạo.</span>
                </div>
                <div>
                  <strong>Ví xu và Kiosk</strong>
                  <span>Nạp xu PayOS, mua tương tác và theo dõi Kiosk trong cùng một nơi.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>${PublicFooter()}</div>
  `;
}

LoginPage.afterRender = function afterRenderLogin() {
  bindPublicNavigation(document.querySelector('.auth-public-site'));
  setLoading(document.getElementById('login-submit'), false);
  setLoading(document.getElementById('account-register-submit'), false, 'Đang tạo tài khoản...', 'Tạo tài khoản');

  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => switchAuthTab(button.dataset.authTab || 'login'));
  });
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    });
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
      const profile = await AuthService.getCurrentProfile(authData?.user?.id);
      window.location.hash = profile?.role === ROLES.ADMIN ? '#/dashboard' : '#/user';
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

    if (!displayName || !username || !phone || !password) {
      showError(errorElement, 'Vui lòng nhập đầy đủ thông tin đăng ký.');
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
      showError(errorElement, 'Đã tạo tài khoản và ví xu. Bạn có thể đăng nhập bằng username hoặc SĐT.');
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
  });
  document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.authPanel !== tab);
  });
  const errorElement = document.getElementById('login-error');
  if (preserveMessage) {
    errorElement?.classList.toggle('hidden', !errorElement.textContent.trim());
    return;
  }
  errorElement?.classList.toggle('hidden', !errorElement.textContent.trim());
  errorElement?.classList.add('form-error');
  errorElement?.classList.remove('notice', 'success');
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
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
