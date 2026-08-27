export function setButtonBusy(button, busy, { busyLabel = 'Đang xử lý...' } = {}) {
  if (!button) return;
  if (busy) {
    if (button.dataset.busy === 'true') return;
    button.dataset.busy = 'true';
    button.dataset.originalHtml = button.innerHTML;
    button.dataset.originalDisabled = String(button.disabled);
    const width = button.getBoundingClientRect?.().width;
    if (width) button.style.minWidth = `${Math.ceil(width)}px`;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${busyLabel}</span>`;
    return;
  }
  if (button.dataset.busy !== 'true') return;
  button.innerHTML = button.dataset.originalHtml || '';
  button.disabled = button.dataset.originalDisabled === 'true';
  button.removeAttribute('aria-busy');
  button.style.removeProperty('min-width');
  delete button.dataset.busy;
  delete button.dataset.originalHtml;
  delete button.dataset.originalDisabled;
}
