export const ROLES = {
  ADMIN: 'admin',
  REVIEWER: 'reviewer',
  SUPPORT: 'support',
  USER: 'user',
  FUTURE_CUSTOMER: 'future_customer',
};

export const PERMISSIONS = {
  [ROLES.ADMIN]: {
    canAccess: () => true, // Admin can access everything
  },
  [ROLES.REVIEWER]: {
    // canAccess will be populated dynamically
  },
  [ROLES.SUPPORT]: {
    canAccess: (route) => {
      const allowedRoutes = new Set(['dashboard']);
      return allowedRoutes.has(route);
    },
  },
  [ROLES.USER]: {
    canAccess: (route) => {
      const allowedRoutes = new Set([
        'user',
        'payments-mine',
        'ttc',
      ]);
      return allowedRoutes.has(route);
    },
  },
  [ROLES.FUTURE_CUSTOMER]: {
    canAccess: (route) => {
      const allowedRoutes = new Set(['register', 'legacy-registration']);
      return allowedRoutes.has(route);
    },
  },
};
