import { PageHeader } from '../components/PageHeader.js';
import { PermissionService } from '../services/PermissionService.js';
import { ROLES } from '../constants/roles.js';
import { Toast } from '../components/Toast.js';

const MANAGEABLE_ROUTES = [
  'dashboard',
  'reports',
  'customers',
  'kiosks',
  'legacy-registration',
  'payments',
  'categories',
  'business-types',
  'registration-requests',
  'logs',
];

const state = {
  permissions: [],
  loading: true,
  saving: false,
};

export function PermissionsPage() {
  return `
    ${PageHeader({ title: 'Phân quyền' })}
    <section class="card" id="permissions-card">
      <div id="permissions-loader">Đang tải...</div>
      <form id="permissions-form" class="hidden">
        <p>Chọn các trang mà vai trò <strong>Reviewer</strong> có thể truy cập.</p>
        <div class="permission-checkbox-group">
          ${MANAGEABLE_ROUTES.map(route => `
            <label class="form-checkbox">
              <input type="checkbox" name="permissions" value="${route}">
              <span>${route}</span>
            </label>
          `).join('')}
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary" id="save-permissions-button">Lưu thay đổi</button>
        </div>
      </form>
    </section>
  `;
}

async function loadPermissions() {
  const card = document.getElementById('permissions-card');
  const loader = document.getElementById('permissions-loader');
  const form = document.getElementById('permissions-form');

  try {
    state.permissions = await PermissionService.getRolePermissions(ROLES.REVIEWER);
    form.classList.remove('hidden');
    loader.classList.add('hidden');
    
    const checkboxes = form.querySelectorAll('input[name="permissions"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = state.permissions.includes(checkbox.value);
    });
  } catch (error) {
    Toast.show('Không thể tải quyền.', 'error');
    loader.textContent = 'Lỗi khi tải quyền.';
  } finally {
    state.loading = false;
  }
}

async function savePermissions(event) {
  event.preventDefault();
  if (state.saving) return;

  state.saving = true;
  const button = document.getElementById('save-permissions-button');
  button.disabled = true;
  button.textContent = 'Đang lưu...';

  const form = document.getElementById('permissions-form');
  const selectedPermissions = Array.from(form.querySelectorAll('input[name="permissions"]:checked')).map(cb => cb.value);

  try {
    state.permissions = await PermissionService.updateReviewerPermissions(
      selectedPermissions,
      'Admin cập nhật quyền Reviewer',
    );
    Toast.show('Lưu quyền thành công.');
  } catch (error) {
    Toast.show('Lỗi khi lưu quyền.', 'error');
  } finally {
    state.saving = false;
    button.disabled = false;
    button.textContent = 'Lưu thay đổi';
  }
}

PermissionsPage.afterRender = function afterRenderPermissionsPage() {
  loadPermissions();
  document.getElementById('permissions-form').addEventListener('submit', savePermissions);
};
