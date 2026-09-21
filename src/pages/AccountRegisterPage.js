import { PUBLIC_BRAND } from '../config/organization.js';
import { AuthService } from '../services/AuthService.js';
import { escapeHtml } from '../utils/html.js';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;

export function AccountRegisterPage() {
  return `
    <main class="auth-shell">
      <section class="auth-landing auth-landing-expanded">
        <div class="auth-intro-panel">
          <div class="auth-main-grid">
            <aside class="auth-story-panel" aria-label="Giới thiệu tài khoản DHL">
              <div class="auth-story-media">
                <img src="${PUBLIC_BRAND.assets.cover}" alt="Ảnh bìa cộng đồng ${escapeHtml(PUBLIC_BRAND.communityName)}" width="1942" height="809">
              </div>
              <div class="auth-story-content">
                <span class="auth-panel-kicker">Tài khoản thành viên</span>
                <h2>${escapeHtml(PUBLIC_BRAND.name)}</h2>
                <p>Tạo tài khoản để sử dụng khu vực cá nhân. Quyền quản trị CRM chỉ xuất hiện khi System Admin cấp riêng.</p>
              </div>
            </aside>
            <div class="auth-panel auth-account-panel">
              <form id="account-register-form" class="auth-form-panel account-register-form" novalidate>
                <div class="auth-panel-heading">
                  <span class="auth-panel-kicker">DHL Group</span>
                  <h2>Đăng ký tài khoản</h2>
                  <p>Dùng username để đăng nhập. Bạn không cần cung cấp email.</p>
                </div>
                <label class="form-group"><span>Tên đăng nhập *</span><input id="signup-username" class="form-control" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="40" required><small class="field-helper">3–40 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.</small></label>
                <label class="form-group"><span>Mật khẩu *</span><span class="password-input-wrap"><input id="signup-password" class="form-control" type="password" autocomplete="new-password" minlength="8" required><button class="password-visibility-toggle" type="button" data-password-toggle="signup-password" aria-label="Hiện mật khẩu">Hiện</button></span><small class="field-helper">Ít nhất 8 ký tự.</small></label>
                <div id="signup-message" class="form-error auth-panel-message hidden" role="alert" aria-live="polite"></div>
                <button id="signup-submit" class="btn-primary auth-submit" type="submit">Tạo tài khoản</button>
                <p class="auth-account-link">Đã có tài khoản? <a href="#/login">Đăng nhập</a></p>
              </form>
            </div>
          </div>
        </div>
      </section>
    </main>`;
}

AccountRegisterPage.afterRender = function afterRenderAccountRegister() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Ẩn' : 'Hiện';
    button.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  }));

  document.getElementById('account-register-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('signup-username')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('signup-password')?.value || '';
    const message = document.getElementById('signup-message');
    const submit = document.getElementById('signup-submit');
    const validationMessage = validateRegistration({ username, password });
    if (validationMessage) return showMessage(message, validationMessage, false);

    setLoading(submit, true);
    message?.classList.add('hidden');
    try {
      await AuthService.signUp({ username, password });
      showMessage(message, 'Tạo tài khoản thành công. Đang chuyển đến trang đăng nhập…', true);
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('account-registration-success', `Tài khoản ${username} đã được tạo. Vui lòng đăng nhập.`);
      window.setTimeout(() => { window.location.hash = '#/login'; }, 900);
    } catch (error) {
      showMessage(message, error?.message || 'Không thể tạo tài khoản lúc này.', false);
      setLoading(submit, false);
    }
  });
};

function validateRegistration({ username, password }) {
  if (!USERNAME_PATTERN.test(username)) return 'Tên đăng nhập phải có 3–40 ký tự gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.';
  if (password.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.';
  return '';
}

function showMessage(element, message, success) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden', 'auth-success-message');
  if (success) element.classList.add('auth-success-message');
}

function setLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? 'Đang tạo tài khoản…' : 'Tạo tài khoản';
}
