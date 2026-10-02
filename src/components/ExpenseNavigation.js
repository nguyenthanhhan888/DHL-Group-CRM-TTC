export function ExpenseNavigation(active = 'expenses') {
  return `<nav class="expense-workspace-tabs" aria-label="Chi phí và nhân viên">
    <a href="#/expenses" ${active === 'expenses' ? 'aria-current="page"' : ''}>Khoản chi</a>
    <a href="#/expenses?tab=employees" ${active === 'employees' ? 'aria-current="page"' : ''}>Nhân viên</a>
  </nav>`;
}
