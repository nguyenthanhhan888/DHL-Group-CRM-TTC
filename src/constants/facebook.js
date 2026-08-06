import { getFacebookGroupMemberBaseUrl } from '../config/organization.js';

export const FACEBOOK_GROUP_MEMBER_BASE_URL = {
  toString: getFacebookGroupMemberBaseUrl,
};
export const FACEBOOK_PROFILE_BASE_URL = 'https://www.facebook.com';

export function buildFacebookGroupMemberUrl(facebookId) {
  const normalizedId = String(facebookId || '').trim();
  if (!normalizedId) return null;
  const baseUrl = getFacebookGroupMemberBaseUrl();
  return baseUrl ? `${baseUrl}/${encodeURIComponent(normalizedId)}` : null;
}
