const STORAGE_PREFIX = 'dhl-crm:list-navigation:v1';

export const LIST_DETAIL_ROUTES = Object.freeze({
  customers: 'customer-detail',
  kiosks: 'kiosk-detail',
  payments: 'payment-detail',
});

const pendingScrollRestores = new Map();

export function navigationAccountId(profile = {}) {
  return String(profile?.user_id || profile?.id || '').trim() || 'signed-out';
}

export function isRestorableListRoute(route) {
  return Object.hasOwn(LIST_DETAIL_ROUTES, String(route || ''));
}

export function detailOrigin(listRoute, detailRoute) {
  return LIST_DETAIL_ROUTES[listRoute] === detailRoute ? listRoute : '';
}

export function shouldUseHistoryBack(historyState, listRoute) {
  return historyState?.dhlListOrigin === listRoute;
}

export function readListNavigationState(route, defaults, profile, storage = availableStorage()) {
  const fallback = clone(defaults);
  if (!storage || !isRestorableListRoute(route)) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(route, profile)) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return { ...fallback, ...parsed, sort: mergeSort(fallback.sort, parsed.sort) };
  } catch {
    return fallback;
  }
}

export function writeListNavigationState(route, value, profile, storage = availableStorage()) {
  if (!storage || !isRestorableListRoute(route)) return;
  try {
    const current = readListNavigationState(route, {}, profile, storage);
    storage.setItem(storageKey(route, profile), JSON.stringify({ ...current, ...(value || {}) }));
  } catch {
    // A blocked/full sessionStorage must not break list navigation.
  }
}

export function clearListNavigationState(route, profile, storage = availableStorage()) {
  if (!storage || !isRestorableListRoute(route)) return;
  try {
    storage.removeItem(storageKey(route, profile));
  } catch {
    // Reset still succeeds in memory when storage is unavailable.
  }
  pendingScrollRestores.delete(storageKey(route, profile));
}

export function clearAccountNavigationState(profile, storage = availableStorage()) {
  if (!storage) return;
  for (const route of Object.keys(LIST_DETAIL_ROUTES)) clearListNavigationState(route, profile, storage);
}

export function captureListScroll(route, profile, scrollY = currentScrollY(), storage = availableStorage()) {
  if (!isRestorableListRoute(route)) return;
  const key = storageKey(route, profile);
  if (pendingScrollRestores.has(key)) return;
  const current = readListNavigationState(route, {}, profile, storage);
  writeListNavigationState(route, { ...current, scrollY: nonNegativeNumber(scrollY) }, profile, storage);
}

export function prepareListScrollRestore(route, profile, storage = availableStorage()) {
  if (!isRestorableListRoute(route)) return;
  const saved = readListNavigationState(route, {}, profile, storage);
  pendingScrollRestores.set(storageKey(route, profile), nonNegativeNumber(saved.scrollY));
}

export function restoreListScroll(route, profile, options = {}) {
  const key = storageKey(route, profile);
  if (!pendingScrollRestores.has(key)) return false;
  const top = pendingScrollRestores.get(key);
  pendingScrollRestores.delete(key);
  const view = options.view || globalThis.window;
  const schedule = options.schedule || globalThis.requestAnimationFrame || ((callback) => callback());
  if (!view?.scrollTo) return false;
  schedule(() => schedule(() => view.scrollTo({ top, left: 0, behavior: 'auto' })));
  return true;
}

function storageKey(route, profile) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(navigationAccountId(profile))}:${route}`;
}

function availableStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function currentScrollY() {
  return globalThis.window?.scrollY || globalThis.document?.documentElement?.scrollTop || 0;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function mergeSort(fallback, stored) {
  if (!fallback || typeof fallback !== 'object') return stored;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return clone(fallback);
  return { ...fallback, ...stored };
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
