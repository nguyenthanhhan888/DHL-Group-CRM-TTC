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
    EXPENSES: 'expenses',
    HOMEPAGE_CONTENT: 'homepage-content',
    SOURCES: 'sources',
    CATEGORIES: 'categories',
    BUSINESS_TYPES: 'business-types',
    REGISTRATION_REQUESTS: 'registration-requests',
    NOTIFICATIONS: 'notifications',
    USER_MANAGEMENT: 'user-management',
    LOGS: 'logs',
    SETTINGS: 'settings',
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
    expenses: PERMISSIONS.EXPENSES,
    'homepage-content': PERMISSIONS.HOMEPAGE_CONTENT,
    categories: PERMISSIONS.CATEGORIES,
    'business-types': PERMISSIONS.BUSINESS_TYPES,
    'registration-requests': PERMISSIONS.REGISTRATION_REQUESTS,
    'user-management': PERMISSIONS.USER_MANAGEMENT,
    staff: PERMISSIONS.USER_MANAGEMENT,
    permissions: PERMISSIONS.USER_MANAGEMENT,
    logs: PERMISSIONS.LOGS,
    settings: PERMISSIONS.SETTINGS,
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
    { label: 'Tài chính', permissions: [PERMISSIONS.PAYMENTS, PERMISSIONS.PAYMENT_DETAIL, PERMISSIONS.EXPENSES] },
    {
      label: 'Hệ thống',
      permissions: [
        PERMISSIONS.NOTIFICATIONS,
        PERMISSIONS.SOURCES,
        PERMISSIONS.CATEGORIES,
        PERMISSIONS.BUSINESS_TYPES,
        PERMISSIONS.USER_MANAGEMENT,
        PERMISSIONS.LOGS,
        PERMISSIONS.SETTINGS,
        PERMISSIONS.HOMEPAGE_CONTENT,
      ],
    },
  ]);

  const PERMISSION_LABELS = Object.freeze({
    dashboard: 'Dashboard', reports: 'Báo cáo', customers: 'Khách hàng',
    'customer-detail': 'Chi tiết khách hàng', kiosks: 'Kiosk', 'kiosk-detail': 'Chi tiết Kiosk',
    'legacy-registration': 'Dữ liệu cũ', payments: 'Thanh toán', 'payment-detail': 'Chi tiết thanh toán', expenses: 'Chi phí',
    sources: 'Nguồn', categories: 'Danh mục', 'business-types': 'Loại hình kinh doanh',
    'registration-requests': 'Hồ sơ đăng ký',
    notifications: 'Thông báo', 'user-management': 'Quản lý người dùng',
    logs: 'Nhật ký',
    settings: 'Cài đặt hệ thống', 'homepage-content': 'Nội dung trang chủ',
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
