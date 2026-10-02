const DEFAULT_ROUTE = 'dashboard';

export function createRouter({ outlet, routes, fallback, onRouteChange, defaultRoute = DEFAULT_ROUTE, canAccess, context = {} }) {
  let active = false;
  function start() {
    active = true;
    window.addEventListener('hashchange', render);
    render();
  }

  function stop() {
    active = false;
    window.removeEventListener('hashchange', render);
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
    const page = routes[route] || fallback;
    outlet.innerHTML = page({ route, params });
    onRouteChange?.(routes[route] ? route : defaultRoute);
    page.afterRender?.({ ...context, route, params, outlet });
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
