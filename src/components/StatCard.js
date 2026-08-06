export function StatCard({ tone, icon, value, label, statId = '', className = '' }) {
  const classes = ['stat-card', tone ? `tone-${tone}` : '', className]
    .filter(Boolean)
    .join(' ');

  return `
    <div class="${classes}">
      <div class="stat-icon" aria-hidden="true">${icon}</div>
      <div>
        <div class="stat-number" ${statId ? `id="${statId}"` : ''}>${value}</div>
        <div class="stat-label">${label}</div>
      </div>
    </div>
  `;
}
