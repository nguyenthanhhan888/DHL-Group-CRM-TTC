const instances = new WeakMap();

export function enhanceSearchableSelect(select, { placeholder = 'Tìm và chọn' } = {}) {
  if (!select) return;
  if (instances.has(select)) return refreshSearchableSelect(select, { placeholder });
  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-select';
  wrapper.innerHTML = `<input class="form-control searchable-select-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"><button class="searchable-select-clear" type="button" aria-label="Xóa lựa chọn"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button><div class="searchable-select-menu hidden" role="listbox"></div>`;
  select.classList.add('searchable-select-native'); select.setAttribute('aria-hidden', 'true'); select.tabIndex = -1; select.after(wrapper);
  const instance = { wrapper, input: wrapper.querySelector('input'), menu: wrapper.querySelector('[role="listbox"]'), clear: wrapper.querySelector('button'), options: [], active: -1, placeholder };
  instances.set(select, instance);
  const close = () => { wrapper.classList.remove('open'); instance.menu.classList.add('hidden'); instance.input.setAttribute('aria-expanded', 'false'); instance.active = -1; };
  const open = () => { if (select.disabled) return; wrapper.classList.add('open'); instance.menu.classList.remove('hidden'); instance.input.setAttribute('aria-expanded', 'true'); render(select, instance, instance.input.value === selectedText(select) ? '' : instance.input.value); };
  instance.input.addEventListener('focus', open); instance.input.addEventListener('click', open);
  instance.input.addEventListener('input', () => { open(); render(select, instance, instance.input.value); });
  instance.input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { close(); instance.input.value = selectedText(select); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); instance.active = Math.max(0, Math.min(instance.options.length - 1, instance.active + (event.key === 'ArrowDown' ? 1 : -1))); render(select, instance, instance.input.value, false); instance.menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
    if (event.key === 'Enter' && instance.active >= 0) { event.preventDefault(); choose(select, instance, instance.options[instance.active]); close(); }
  });
  instance.menu.addEventListener('mousedown', (event) => event.preventDefault());
  instance.menu.addEventListener('click', (event) => { const item = event.target.closest('[data-searchable-value]'); if (!item) return; choose(select, instance, { value: item.dataset.searchableValue, label: item.textContent }); close(); instance.input.focus(); });
  instance.clear.addEventListener('click', () => { choose(select, instance, { value: '', label: '' }); instance.input.focus(); open(); });
  document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) close(); });
  select.addEventListener('change', () => sync(select, instance));
  refreshSearchableSelect(select, { placeholder });
}

export function refreshSearchableSelect(select, { placeholder } = {}) {
  const instance = instances.get(select); if (!instance) return enhanceSearchableSelect(select, { placeholder });
  if (placeholder) instance.placeholder = placeholder; sync(select, instance); render(select, instance, '');
}

function sync(select, instance) { instance.input.disabled = select.disabled; instance.clear.disabled = select.disabled || !select.value; instance.input.placeholder = select.disabled ? select.options[0]?.textContent || instance.placeholder : instance.placeholder; instance.input.value = selectedText(select); }
function render(select, instance, query = '', reset = true) { const term = String(query).trim().toLocaleLowerCase('vi'); instance.options = [...select.options].filter((o) => o.value).map((o) => ({ value: o.value, label: o.textContent.trim() })).filter((o) => !term || o.label.toLocaleLowerCase('vi').includes(term)).sort((a,b) => a.label.localeCompare(b.label, 'vi', { sensitivity: 'base' })); if (reset) instance.active = instance.options.length ? 0 : -1; instance.menu.innerHTML = instance.options.length ? instance.options.map((o,i) => `<button type="button" role="option" data-searchable-value="${escapeAttr(o.value)}" aria-selected="${i === instance.active}">${escapeText(o.label)}</button>`).join('') : '<div class="searchable-select-empty">Không tìm thấy kết quả</div>'; }
function choose(select, instance, option) { select.value = option.value; instance.input.value = option.label || ''; instance.clear.disabled = !option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
function selectedText(select) { return select.selectedOptions?.[0]?.value ? select.selectedOptions[0].textContent.trim() : ''; }
function escapeText(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function escapeAttr(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
