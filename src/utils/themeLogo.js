import { PUBLIC_BRAND } from '../config/organization.js';

export function getThemeLogoPath(theme = currentTheme()) {
  return theme === 'dark'
    ? PUBLIC_BRAND.assets.logoDark
    : PUBLIC_BRAND.assets.logoLight;
}

export function syncThemeLogos(theme = currentTheme(), root = globalThis.document) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  root?.querySelectorAll?.('[data-theme-logo]').forEach((image) => {
    const nextPath = normalizedTheme === 'dark'
      ? image.dataset.logoDark
      : image.dataset.logoLight;
    if (nextPath && image.getAttribute('src') !== nextPath) image.setAttribute('src', nextPath);
  });
}

function currentTheme() {
  return globalThis.document?.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light';
}
