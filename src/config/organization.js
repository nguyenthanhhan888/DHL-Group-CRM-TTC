const organizationSettings = new Map();

export function replaceOrganizationSettings(values = {}) {
  organizationSettings.clear();
  Object.entries(values || {}).forEach(([key, value]) => {
    organizationSettings.set(key, value == null ? '' : String(value));
  });
}

export function getOrganizationSetting(key, fallback = '') {
  return organizationSettings.get(key) ?? fallback;
}

export function getFacebookGroupMemberBaseUrl() {
  const facebookGroupId = getOrganizationSetting('facebook_group_id').trim();
  return facebookGroupId
    ? `https://www.facebook.com/groups/${encodeURIComponent(facebookGroupId)}/user`
    : '';
}
