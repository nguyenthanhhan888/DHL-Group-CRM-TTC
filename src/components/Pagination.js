import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';

export function Pagination({ id, page = 1, pageSize = 10, total = 0, pageSizeOptions = [], noun = 'kết quả', showPageSize = true }) {
  return `<nav class="pagination-bar" id="${escapeHtml(id)}-pagination" aria-label="Phân trang">${paginationContent({ id, page, pageSize, total, pageSizeOptions, noun, showPageSize })}</nav>`;
}

export function updatePagination(options) {
  const host = document.getElementById(`${options.id}-pagination`);
  if (host) host.innerHTML = paginationContent(options);
}

export function bindPagination(id, { onPage, onPageSize } = {}) {
  const host = document.getElementById(`${id}-pagination`);
  if (!host || host.dataset.bound === 'true') return;
  host.dataset.bound = 'true';
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pagination-page]');
    if (!button || button.disabled) return;
    const nextPage = Number(button.dataset.paginationPage);
    if (Number.isInteger(nextPage) && nextPage > 0) onPage?.(nextPage);
  });
  host.addEventListener('change', (event) => {
    const select = event.target.closest('[data-pagination-size]');
    if (!select) return;
    onPageSize?.(Number(select.value));
  });
}

export function paginationItems(page, totalPages, siblingCount = 1) {
  const last = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), last);
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);
  const pages = new Set([1, last]);
  const rangeStart = current <= 3 ? 2 : current >= last - 2 ? last - 3 : current - siblingCount;
  const rangeEnd = current <= 3 ? 4 : current >= last - 2 ? last - 1 : current + siblingCount;
  for (let value = rangeStart; value <= rangeEnd; value += 1) {
    if (value > 1 && value < last) pages.add(value);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push('ellipsis');
    result.push(value);
  });
  return result;
}

function paginationContent({ id, page = 1, pageSize = 10, total = 0, pageSizeOptions = [], noun = 'kết quả', showPageSize = true }) {
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Number(pageSize || 1)));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const pages = paginationItems(current, totalPages);
  return `
    <div class="pagination-controls">
      <button class="pagination-button pagination-arrow" type="button" data-pagination-page="${current - 1}" ${current <= 1 ? 'disabled' : ''} aria-label="Trang trước">${renderIcon('chevron-left')}</button>
      <div class="pagination-pages" aria-label="Chọn trang">${pages.map((item) => item === 'ellipsis'
        ? '<span class="pagination-ellipsis" aria-hidden="true">…</span>'
        : `<button class="pagination-button ${item === current ? 'active' : ''}" type="button" data-pagination-page="${item}" ${item === current ? 'aria-current="page"' : ''}>${item}</button>`).join('')}</div>
      <span class="pagination-mobile-count">${current} / ${totalPages}</span>
      <button class="pagination-button pagination-arrow" type="button" data-pagination-page="${current + 1}" ${current >= totalPages ? 'disabled' : ''} aria-label="Trang sau">${renderIcon('chevron-right')}</button>
    </div>
    <div class="pagination-meta">
      ${showPageSize ? `<label class="pagination-size"><span>Hiển thị</span><select class="filter-select compact" data-pagination-size aria-label="Số dòng mỗi trang">${pageSizeOptions.map((size) => `<option value="${size}" ${Number(size) === Number(pageSize) ? 'selected' : ''}>${size} / trang</option>`).join('')}</select></label>` : ''}
      <span class="pagination-summary">${Number(total || 0)} ${escapeHtml(noun)}</span>
    </div>
  `;
}
