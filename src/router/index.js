import {
  captureListScroll,
  detailOrigin,
  isRestorableListRoute,
  prepareListScrollRestore,
  shouldUseHistoryBack,
} from '../utils/listNavigationState.js';

const DEFAULT_ROUTE = 'dashboard';

export function createRouter({ outlet, routes, fallback, onRouteChange, defaultRoute = DEFAULT_ROUTE, canAccess, context = {} }) {
  let active = false;
  let currentRoute = '';
  let scrollFrame = 0;
  function start() {
    active = true;
    window.addEventListener('hashchange', render);
    if (globalThis.document) {
      window.addEventListener('scroll', captureActiveScroll, { passive: true });
      document.addEventListener('click', handleListBack);
    }
    render();
  }

  function stop() {
    active = false;
    window.removeEventListener('hashchange', render);
    if (globalThis.document) {
      window.removeEventListener('scroll', captureActiveScroll);
      document.removeEventListener('click', handleListBack);
    }
    if (scrollFrame) (window.cancelAnimationFrame || clearTimeout)(scrollFrame);
  }

  function render() {
    if (!active || !outlet) return;

    const { route, params } = parseRoute(window.location.hash, defaultRoute);
    if (!routes[route]) {
      window.location.hash = `#/${defaultRoute}`;
      return;
    }
    if (canAccess && !canAccess(route)) {
      window.location.hash = `#/${defaultRoute}`;
      return;
    }
    if (currentRoute && currentRoute !== route && isRestorableListRoute(currentRoute)) {
      captureListScroll(currentRoute, context.profile);
    }
    const origin = detailOrigin(currentRoute, route);
    if (origin) {
      window.history.replaceState({ ...(window.history.state || {}), dhlListOrigin: origin }, '', window.location.href);
    }
    if (isRestorableListRoute(route)) prepareListScrollRestore(route, context.profile);

    const page = routes[route] || fallback;
    outlet.innerHTML = page({ ...context, route, params });
    currentRoute = route;
    onRouteChange?.(routes[route] ? route : defaultRoute);
    page.afterRender?.({ ...context, route, params, outlet });
  }

  function captureActiveScroll() {
    if (!isRestorableListRoute(currentRoute) || scrollFrame) return;
    const schedule = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    scrollFrame = schedule(() => {
      scrollFrame = 0;
      captureListScroll(currentRoute, context.profile);
    });
  }

  function handleListBack(event) {
    const link = event.target.closest?.('[data-list-back]');
    if (!link) return;
    const listRoute = link.dataset.listBack;
    if (!shouldUseHistoryBack(window.history.state, listRoute)) return;
    event.preventDefault();
    window.history.back();
  }

  return { start, stop };
}

function parseRoute(hash, defaultRoute) {
  const raw = hash.replace(/^#\/?/, '').trim();
  const [pathPart, queryString = ''] = raw.split('?');
  const pathSegments = pathPart.split('/').filter(Boolean);
  const route = pathSegments[0] || '';
  const params = new URLSearchParams(queryString);

  if (pathSegments.length > 1 && !params.has('id')) {
    params.set('id', pathSegments.slice(1).join('/'));
  }

  if (!route) {
    window.location.hash = `#/${defaultRoute}`;
    return { route: defaultRoute, params };
  }

  return { route, params };
}
