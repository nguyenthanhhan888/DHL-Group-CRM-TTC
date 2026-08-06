import { EmptyState } from './EmptyState.js';

export function DataTable({ columns, emptyTitle, emptyMessage }) {
  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="${columns.length}">
              ${EmptyState({ title: emptyTitle, message: emptyMessage })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

