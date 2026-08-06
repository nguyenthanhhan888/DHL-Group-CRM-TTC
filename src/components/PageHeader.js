export function PageHeader({ title, description, actions = '' }) {
  return `
    <div class="page-header">
      <div>
        <h1>${title}</h1>
        ${description ? `<p>${description}</p>` : ''}
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </div>
  `;
}

