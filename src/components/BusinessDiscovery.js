import { formatCurrency } from '../utils/currency.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';

export function normalizeBusinessSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function findBusinessSuggestions(query, categories = [], businessTypes = [], limit = 6) {
  const needle = normalizeBusinessSearch(query);
  if (!needle) return [];
  const categoryMap = new Map(categories.map((item) => [String(item.id), item]));
  const terms = needle.split(' ').filter(Boolean);
  return businessTypes.map((businessType) => {
    const category = categoryMap.get(String(businessType.category_id)) || businessType.categories || {};
    const name = normalizeBusinessSearch(businessType.name);
    const haystack = `${name} ${normalizeBusinessSearch(category.name)} ${normalizeBusinessSearch(businessType.description || category.description)}`;
    if (!terms.every((term) => haystack.includes(term))) return null;
    const score = name === needle ? 100 : name.startsWith(needle) ? 70 : name.includes(needle) ? 50 : 20;
    return { businessType, category, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score
    || String(a.businessType.name).localeCompare(String(b.businessType.name), 'vi', { sensitivity: 'base' })).slice(0, limit);
}

export function BusinessDiscovery({ prefix }) {
  return `<div class="business-discovery" data-business-discovery>
    <label class="form-group business-search-field"><span>Bạn đang kinh doanh gì? *</span>
      <span class="business-search-control">${renderIcon('search')}<input class="form-control" type="search" data-business-search autocomplete="off" placeholder="Ví dụ: bán hoa, spa, quán ăn, cafe, điện thoại..." aria-controls="${prefix}-suggestions" aria-describedby="${prefix}-business-help" /></span>
      <span class="field-helper" id="${prefix}-business-help">Nhập từ khóa gần đúng, hệ thống sẽ gợi ý ngành nghề phù hợp.</span></label>
    <div class="business-suggestions" id="${prefix}-suggestions" data-business-suggestions aria-live="polite"></div>
    <button class="business-manual-toggle" type="button" data-business-manual-toggle aria-expanded="false">Chọn thủ công</button>
    <div class="business-manual-fields hidden" data-business-manual><div class="form-row">
      <label class="form-group"><span>Danh mục *</span><select class="form-control" data-kiosk-category required><option value="">Đang tải danh mục...</option></select><span class="field-error hidden"></span></label>
      <label class="form-group"><span>Loại hình kinh doanh *</span><select class="form-control" data-kiosk-business-type required disabled><option value="">Chọn danh mục trước</option></select><span class="field-error hidden"></span></label>
    </div></div><div class="business-selection hidden" data-business-selection></div>
  </div>`;
}

export function renderBusinessSuggestions(target, query, categories, businessTypes) {
  const suggestions = findBusinessSuggestions(query, categories, businessTypes);
  if (!normalizeBusinessSearch(query)) { target.innerHTML = ''; return; }
  if (!suggestions.length) {
    target.innerHTML = '<div class="business-empty"><strong>Không tìm thấy ngành nghề phù hợp?</strong><p>Thử từ khóa khác hoặc chọn thủ công. Nếu vẫn chưa thấy đúng ngành nghề, vui lòng liên hệ Admin trước khi thanh toán để được hướng dẫn.</p></div>';
    return;
  }
  target.innerHTML = `<p class="business-suggestion-heading">Bạn có thể đang tìm:</p>${suggestions.map(({ businessType, category }) => `<button type="button" class="business-suggestion" data-select-business="${escapeHtml(businessType.id)}"><span class="business-suggestion-icon">${renderIcon('store')}</span><span class="business-suggestion-copy"><strong>${escapeHtml(businessType.name)}</strong><small>Danh mục: ${escapeHtml(category.name || 'Chưa xác định')}</small><small>Loại hình KD: ${escapeHtml(businessType.name)}</small></span><span class="business-suggestion-action"><b>${formatCurrency(businessType.price_per_month)}/tháng</b><em>Chọn ${renderIcon('chevron-right')}</em></span></button>`).join('')}`;
}

export function renderBusinessSelection(target, category, businessType) {
  target.classList.remove('hidden');
  target.innerHTML = `<div><span>Danh mục đã chọn</span><strong>${escapeHtml(category?.name || '—')}</strong></div><div><span>Loại hình kinh doanh</span><strong>${escapeHtml(businessType?.name || '—')}</strong></div><button type="button" data-change-business>Đổi lựa chọn</button><p><span class="business-selection-warning-icon">${renderIcon('warning')}</span>Hãy kiểm tra kỹ ngành nghề đã chọn. Chọn sai có thể khiến Kiosk không được nhận diện đúng khi hỗ trợ duyệt bài.</p>`;
}
