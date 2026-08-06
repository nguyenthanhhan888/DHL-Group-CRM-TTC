export function Toolbar({ children, className = '' }) {
  const classes = ['toolbar', className].filter(Boolean).join(' ');
  return `<div class="${classes}">${children}</div>`;
}
