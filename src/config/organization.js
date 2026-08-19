const organizationSettings = new Map();
const DEFAULT_EXPIRY_WARNING_DAYS = 30;

export const PUBLIC_BRAND = Object.freeze({
  name: 'Diễn Châu - À Đây Rồi DHL',
  communityName: 'Diễn Châu - À Đây Rồi',
  shortName: 'DHL',
  assets: Object.freeze({
    logo: 'logo/dhl-group-logo.jpg',
    cover: 'images/cover.PNG',
    avatar: 'images/avatar-1.PNG',
  }),
  contacts: Object.freeze({
    zalo: Object.freeze([
      Object.freeze({ label: '0888 690 346', number: '0888690346', url: 'https://zalo.me/0888690346' }),
      Object.freeze({ label: '0888 640 346', number: '0888640346', url: 'https://zalo.me/0888640346' }),
    ]),
    hotline: Object.freeze({ label: '0333 015 337', number: '0333015337', url: 'tel:0333015337' }),
    fanpage: 'https://www.facebook.com/admin.dc.adayroi/',
    groups: Object.freeze({
      primary: 'https://www.facebook.com/groups/1145443782801316',
      secondary: 'https://www.facebook.com/groups/dienchaugroup888',
      recruitment: 'https://www.facebook.com/groups/320237372898775',
    }),
  }),
});

export function replaceOrganizationSettings(values = {}) {
  organizationSettings.clear();
  Object.entries(values || {}).forEach(([key, value]) => {
    organizationSettings.set(key, value == null ? '' : String(value));
  });
}

export function getOrganizationSetting(key, fallback = '') {
  return organizationSettings.get(key) ?? fallback;
}

export function getExpiryWarningDays() {
  return normalizeExpiryWarningDays(getOrganizationSetting('warning_days', DEFAULT_EXPIRY_WARNING_DAYS));
}

export function normalizeExpiryWarningDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_EXPIRY_WARNING_DAYS;
  return Math.floor(days);
}

export function getFacebookGroupMemberBaseUrl() {
  const facebookGroupId = getOrganizationSetting('facebook_group_id').trim();
  return facebookGroupId
    ? `https://www.facebook.com/groups/${encodeURIComponent(facebookGroupId)}/user`
    : '';
}
