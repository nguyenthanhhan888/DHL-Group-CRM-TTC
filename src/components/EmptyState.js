export function EmptyState({ title, message }) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">∅</div>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-message">${message}</div>
    </div>
  `;
}
