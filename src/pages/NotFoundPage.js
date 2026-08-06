import { EmptyState } from '../components/EmptyState.js';

export function NotFoundPage() {
  return `
    <section class="dash-card">
      ${EmptyState({
        title: 'Không tìm thấy trang',
        message: 'Kiểm tra lại đường dẫn hoặc chọn một mục trong sidebar.',
      })}
    </section>
  `;
}

