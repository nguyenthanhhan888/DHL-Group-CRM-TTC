import { PUBLIC_BRAND } from '../config/organization.js';
import { escapeHtml } from '../utils/html.js';

export function PublicLogo({ className = '', alt = `${PUBLIC_BRAND.name} logo` } = {}) {
  return `<img class="public-logo ${escapeHtml(className)}" src="${PUBLIC_BRAND.assets.logo}" alt="${escapeHtml(alt)}" width="1280" height="512">`;
}
