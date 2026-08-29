(function exposePermissionModel(root) {
  const PERMISSIONS = Object.freeze({
    DASHBOARD: 'dashboard',
    REPORTS: 'reports',
    CUSTOMERS: 'customers',
    CUSTOMER_DETAIL: 'customer-detail',
    KIOSKS: 'kiosks',
    KIOSK_DETAIL: 'kiosk-detail',
    LEGACY_REGISTRATION: 'legacy-registration',
    PAYMENTS: 'payments',
    PAYMENT_DETAIL: 'payment-detail',
    SOURCES: 'sources',
    CATEGORIES: 'categories',
    BUSINESS_TYPES: 'business-types',
    REGISTRATION_REQUESTS: 'registration-requests',
    TTC: 'ttc',
    SERVICES: 'services',
    NOTIFICATIONS: 'notifications',
    TASKS: 'tasks',
    USER_MANAGEMENT: 'user-management',
    WALLET: 'wallet',
    PRICING: 'pricing',
    VIOLATIONS: 'violations',
    LOGS: 'logs',
    SETTINGS: 'settings',
    ADMIN_TTC: 'admin-ttc',
  });

  const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));
  const ROUTE_PERMISSIONS = Object.freeze({
    dashboard: PERMISSIONS.DASHBOARD,
    reports: PERMISSIONS.REPORTS,
    customers: PERMISSIONS.CUSTOMERS,
    'customer-detail': PERMISSIONS.CUSTOMER_DETAIL,
    kiosks: PERMISSIONS.KIOSKS,
    'kiosk-detail': PERMISSIONS.KIOSK_DETAIL,
    'legacy-registration': PERMISSIONS.LEGACY_REGISTRATION,
    payments: PERMISSIONS.PAYMENTS,
    'payment-detail': PERMISSIONS.PAYMENT_DETAIL,
    categories: PERMISSIONS.CATEGORIES,
    'business-types': PERMISSIONS.BUSINESS_TYPES,
    'registration-requests': PERMISSIONS.REGISTRATION_REQUESTS,
    ttc: PERMISSIONS.TTC,
    'ttc-earn': PERMISSIONS.TTC,
    'ttc-campaign-create': PERMISSIONS.TTC,
    'ttc-campaigns': PERMISSIONS.TTC,
    'admin-ttc-campaigns': PERMISSIONS.SERVICES,
    'admin-ttc-announcements': PERMISSIONS.NOTIFICATIONS,
    'admin-ttc-tasks': PERMISSIONS.TASKS,
    'user-management': PERMISSIONS.USER_MANAGEMENT,
    staff: PERMISSIONS.USER_MANAGEMENT,
    permissions: PERMISSIONS.USER_MANAGEMENT,
    'admin-ttc-users': PERMISSIONS.USER_MANAGEMENT,
    'admin-ttc-wallets': PERMISSIONS.WALLET,
    'ttc-wallet': PERMISSIONS.WALLET,
    'ttc-wallet-history': PERMISSIONS.WALLET,
    'admin-ttc-settings': PERMISSIONS.PRICING,
    'admin-ttc-logs': PERMISSIONS.VIOLATIONS,
    logs: PERMISSIONS.LOGS,
    settings: PERMISSIONS.SETTINGS,
    admin: PERMISSIONS.ADMIN_TTC,
    'admin-ttc': PERMISSIONS.ADMIN_TTC,
  });

  const PERMISSION_GROUPS = Object.freeze([
    { label: 'Tổng quan', permissions: [PERMISSIONS.DASHBOARD, PERMISSIONS.REPORTS] },
    {
      label: 'Khách hàng & Kiosk',
      permissions: [
        PERMISSIONS.CUSTOMERS,
        PERMISSIONS.CUSTOMER_DETAIL,
        PERMISSIONS.KIOSKS,
        PERMISSIONS.KIOSK_DETAIL,
        PERMISSIONS.LEGACY_REGISTRATION,
        PERMISSIONS.REGISTRATION_REQUESTS,
      ],
    },
    { label: 'Tài chính', permissions: [PERMISSIONS.PAYMENTS, PERMISSIONS.PAYMENT_DETAIL] },
    {
      label: 'TTC',
      permissions: [
        PERMISSIONS.TTC,
        PERMISSIONS.SERVICES,
        PERMISSIONS.NOTIFICATIONS,
        PERMISSIONS.TASKS,
        PERMISSIONS.WALLET,
        PERMISSIONS.PRICING,
        PERMISSIONS.VIOLATIONS,
        PERMISSIONS.ADMIN_TTC,
      ],
    },
    {
      label: 'Hệ thống',
      permissions: [
        PERMISSIONS.SOURCES,
        PERMISSIONS.CATEGORIES,
        PERMISSIONS.BUSINESS_TYPES,
        PERMISSIONS.USER_MANAGEMENT,
        PERMISSIONS.LOGS,
        PERMISSIONS.SETTINGS,
      ],
    },
  ]);

  const PERMISSION_LABELS = Object.freeze({
    dashboard: 'Dashboard', reports: 'Báo cáo', customers: 'Khách hàng',
    'customer-detail': 'Chi tiết khách hàng', kiosks: 'Kiosk', 'kiosk-detail': 'Chi tiết Kiosk',
    'legacy-registration': 'Dữ liệu cũ', payments: 'Thanh toán', 'payment-detail': 'Chi tiết thanh toán',
    sources: 'Nguồn', categories: 'Danh mục', 'business-types': 'Loại hình kinh doanh',
    'registration-requests': 'Hồ sơ đăng ký', ttc: 'Tổng quan TTC', services: 'Dịch vụ TTC',
    notifications: 'Thông báo', tasks: 'Nhiệm vụ', 'user-management': 'Quản lý người dùng',
    wallet: 'Ví xu', pricing: 'Bảng giá', violations: 'Vi phạm', logs: 'Nhật ký',
    settings: 'Cài đặt hệ thống', 'admin-ttc': 'Quản trị TTC',
  });

  const model = Object.freeze({
    PERMISSIONS,
    ALL_PERMISSIONS,
    ROUTE_PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSION_LABELS,
  });

  root.DHL_PERMISSION_MODEL = model;
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
})(typeof globalThis !== 'undefined' ? globalThis : this);
