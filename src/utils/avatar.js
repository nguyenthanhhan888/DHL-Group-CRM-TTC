export const USER_AVATAR_PATHS = [
  'images/avatars/avatar_01.webp',
  'images/avatars/avatar_02.webp',
  'images/avatars/avatar_03.webp',
  'images/avatars/avatar_05.webp',
  'images/avatars/avatar_06.webp',
  'images/avatars/avatar_07.webp',
];

export function getStableAvatarPath(seed) {
  const key = String(seed || 'dhl-user').trim() || 'dhl-user';
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  const avatarIndex = Math.abs(hash) % USER_AVATAR_PATHS.length;
  return USER_AVATAR_PATHS[avatarIndex];
}

export function getUserAvatarPath(user) {
  return getStableAvatarPath(
    user?.user_id
      || user?.id
      || user?.email
      || user?.username
      || user?.display_name
      || user?.phone,
  );
}
