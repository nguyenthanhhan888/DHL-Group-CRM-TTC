import '../../shared/permissions.js';

const model = globalThis.DHL_PERMISSION_MODEL;

export const PERMISSIONS = model.PERMISSIONS;
export const ALL_PERMISSIONS = model.ALL_PERMISSIONS;
export const ROUTE_PERMISSIONS = model.ROUTE_PERMISSIONS;
export const PERMISSION_GROUPS = model.PERMISSION_GROUPS;
export const PERMISSION_LABELS = model.PERMISSION_LABELS;

export function permissionForRoute(route) {
  return ROUTE_PERMISSIONS[String(route || '').split('?')[0]] || '';
}

export function canAccessPermission(accessProfile, permission) {
  if (!accessProfile) return false;
  if (accessProfile.is_system_admin === true) return true;
  if (!permission) return false;
  return Array.isArray(accessProfile.permissions) && accessProfile.permissions.includes(permission);
}

export function canAccessRoute(accessProfile, route) {
  if (accessProfile?.is_system_admin === true) return true;
  return canAccessPermission(accessProfile, permissionForRoute(route));
}
