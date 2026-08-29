import { PUBLIC_BRAND } from '../config/organization.js';
import { escapeHtml } from '../utils/html.js';
import { getThemeLogoPath } from '../utils/themeLogo.js';

export function PublicLogo({ className = '', alt = `${PUBLIC_BRAND.name} logo` } = {}) {
  return `<img class="public-logo ${escapeHtml(className)}" src="${escapeHtml(getThemeLogoPath())}" data-theme-logo data-logo-light="${escapeHtml(PUBLIC_BRAND.assets.logoLight)}" data-logo-dark="${escapeHtml(PUBLIC_BRAND.assets.logoDark)}" alt="${escapeHtml(alt)}" width="2172" height="724" decoding="async" fetchpriority="high">`;
}
