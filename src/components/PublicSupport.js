import { PUBLIC_BRAND } from '../config/organization.js';

const { contacts: publicContacts } = PUBLIC_BRAND;
const contacts = [
  ...publicContacts.zalo.map((item) => ['zalo', item.label, item.url, `Mở Zalo ${item.label}`]),
  ['phone', publicContacts.hotline.label, publicContacts.hotline.url, `Gọi hotline ${publicContacts.hotline.label}`],
  ['facebook', 'Fanpage Admin', publicContacts.fanpage, 'Mở Fanpage Admin'],
  ['facebook', 'Group chính', publicContacts.groups.primary, 'Mở Group chính'],
  ['facebook', 'Group phụ', publicContacts.groups.secondary, 'Mở Group phụ'],
  ['facebook', 'Group tuyển dụng', publicContacts.groups.recruitment, 'Mở Group tuyển dụng'],
];

export function PublicContactLinks({ compact = false } = {}) {
  return `<div class="public-contact-links ${compact ? 'compact' : ''}">${contacts.map(([kind, label, href, aria]) => {
    const external = href.startsWith('http');
    return `<a class="public-contact-link" href="${href}" aria-label="${aria}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ''}>${icon(kind)}<span>${label}</span></a>`;
  }).join('')}</div>`;
}

export function PublicSupport() {
  return `<aside class="public-support" aria-label="Thông tin hỗ trợ">
    <div><strong>Cần hỗ trợ?</strong><span>Ban quản trị sẵn sàng hỗ trợ Kiosk của bạn.</span></div>
    ${PublicContactLinks({ compact: true })}
  </aside>`;
}

function icon(kind) {
  if (kind === 'zalo') return '<span class="contact-platform-icon contact-zalo" aria-hidden="true">Zalo</span>';
  if (kind === 'phone') return '<svg class="contact-platform-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-1-1.3 2.2a15.7 15.7 0 0 1-9.9-9.9L8 7 7 3Z"/></svg>';
  return '<svg class="contact-platform-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4h-3c-3.3 0-5 2-5 5v2H6v4h3v7h4v-7h3l1-4h-4V9c0-.7.3-1 1-1Z"/></svg>';
}
