export const PAGE_TITLES = {
  dashboard: 'Tổng quan',
  customers: 'Khách hàng',
  'customer-detail': 'Chi tiết khách hàng',
  kiosks: 'Kiosk',
  'legacy-registration': 'Bổ sung dữ liệu cũ',
  'kiosk-detail': 'Chi tiết Kiosk',
  payments: 'Thanh toán',
  'payments-mine': 'Thanh toán của tôi',
  categories: 'Danh mục',
  'business-types': 'Loại hình KD',
  logs: 'Lịch sử thay đổi',
  settings: 'Cài đặt',
  register: 'Đăng ký trực tuyến',
  'registration-requests': 'Duyệt đơn đăng ký',
  staff: 'Quản lý nhân viên',
  reports: 'Báo cáo',
  permissions: 'Phân quyền',
  user: 'Trang chủ',
  'user-profile': 'Hồ sơ của tôi',
  'user-kiosks': 'Kiosk của tôi',
  'user-register-kiosk': 'Đăng ký Kiosk mới',
  'user-facebook': 'Tài khoản Facebook',
  ttc: 'Tổng quan tương tác chéo',
  'ttc-earn': 'Kiếm xu',
  'ttc-campaign-create': 'Tạo tăng tương tác',
  'ttc-campaigns': 'Tăng tương tác của tôi',
  'ttc-wallet': 'Ví xu',
  'ttc-wallet-history': 'Lịch sử giao dịch',
  admin: 'Quản trị tương tác chéo',
  'admin-ttc-campaigns': 'Tăng tương tác',
  'admin-ttc-announcements': 'Thông báo',
  'admin-ttc-tasks': 'Duyệt nhiệm vụ',
  'admin-ttc-users': 'Người dùng',
  'admin-ttc-wallets': 'Ví xu',
  'admin-ttc-settings': 'Cấu hình giá TTC',
  'admin-ttc-logs': 'Kiểm tra & vi phạm',
};

export const NAV_SECTIONS = [
  {
    label: 'TỔNG QUAN',
    items: [
      { route: 'user', label: 'Trang chủ', icon: 'home', roles: ['user'] },
      { route: 'dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['admin'] },
    ],
  },
  {
    label: 'QUẢN LÝ CRM',
    items: [
      { route: 'customers', label: 'Khách hàng', icon: 'users', roles: ['admin'] },
      { route: 'kiosks', label: 'Kiosk', icon: 'store', roles: ['admin'] },
      { route: 'register', label: 'Đăng ký Kiosk', icon: 'plus', roles: ['admin'] },
      { route: 'registration-requests', label: 'Đơn đăng ký', icon: 'check', roles: ['admin'] },
      { route: 'categories', label: 'Danh mục', icon: 'list', roles: ['admin'] },
      { route: 'business-types', label: 'Loại hình kinh doanh', icon: 'briefcase', roles: ['admin'] },
      { route: 'reports', label: 'Báo cáo', icon: 'report', roles: ['admin'] },
    ],
  },
  {
    label: 'TƯƠNG TÁC CHÉO',
    items: [
      { route: 'admin/ttc', label: 'Tổng quan TTC', icon: 'target', roles: ['admin'] },
      { route: 'admin-ttc-announcements', label: 'Thông báo', icon: 'alert', roles: ['admin'] },
      { route: 'admin-ttc-campaigns', label: 'Tăng tương tác', icon: 'boost', roles: ['admin'] },
      { route: 'admin-ttc-tasks', label: 'Duyệt nhiệm vụ', icon: 'check', roles: ['admin'] },
      { route: 'admin-ttc-users', label: 'Người dùng', icon: 'user-circle', roles: ['admin'] },
      { route: 'admin-ttc-wallets', label: 'Ví xu', icon: 'coin', roles: ['admin'] },
      { route: 'admin-ttc-settings', label: 'Cấu hình giá', icon: 'sliders', roles: ['admin'] },
      { route: 'admin-ttc-logs', label: 'Kiểm tra & vi phạm', icon: 'alert', roles: ['admin'] },
      {
        label: 'Kiếm xu',
        icon: 'coin',
        roles: ['user'],
        defaultOpen: true,
        children: [
          {
            label: 'Facebook',
            icon: 'facebook',
            roles: ['user'],
            defaultOpen: true,
            children: [
              { route: 'ttc-earn?type=like', matchRoute: 'ttc-earn', label: 'Tăng like', icon: 'thumb', roles: ['user'] },
              { route: 'ttc-earn?type=follow', matchRoute: 'ttc-earn', label: 'Tăng follow', icon: 'user-plus', roles: ['user'] },
              { route: 'ttc-earn?type=comment', matchRoute: 'ttc-earn', label: 'Tăng comment', icon: 'message', roles: ['user'] },
              { route: 'ttc-earn?type=reaction', matchRoute: 'ttc-earn', label: 'Tăng cảm xúc', icon: 'heart', roles: ['user'] },
              { route: 'ttc-earn?type=share', matchRoute: 'ttc-earn', label: 'Share', icon: 'share', roles: ['user'] },
              { route: 'ttc-earn?type=join_group', matchRoute: 'ttc-earn', label: 'Join group', icon: 'users', roles: ['user'] },
            ],
          },
        ],
      },
      {
        label: 'Tăng tương tác',
        icon: 'boost',
        roles: ['user'],
        defaultOpen: true,
        children: [
          {
            label: 'Facebook',
            icon: 'facebook',
            roles: ['user'],
            defaultOpen: true,
            children: [
              { route: 'ttc-campaign-create?type=like', matchRoute: 'ttc-campaign-create', label: 'Tăng like', icon: 'thumb', roles: ['user'] },
              { route: 'ttc-campaign-create?type=follow', matchRoute: 'ttc-campaign-create', label: 'Tăng follow', icon: 'user-plus', roles: ['user'] },
              { route: 'ttc-campaign-create?type=comment', matchRoute: 'ttc-campaign-create', label: 'Tăng comment', icon: 'message', roles: ['user'] },
              { route: 'ttc-campaign-create?type=reaction', matchRoute: 'ttc-campaign-create', label: 'Tăng cảm xúc', icon: 'heart', roles: ['user'] },
              { route: 'ttc-campaign-create?type=share', matchRoute: 'ttc-campaign-create', label: 'Share', icon: 'share', roles: ['user'] },
              { route: 'ttc-campaign-create?type=join_group', matchRoute: 'ttc-campaign-create', label: 'Join group', icon: 'users', roles: ['user'] },
            ],
          },
        ],
      },
      { route: 'ttc-campaigns', label: 'Tăng tương tác của tôi', icon: 'list', roles: ['user'] },
      { route: 'ttc-wallet', label: 'Ví xu', icon: 'wallet', roles: ['user'] },
      { route: 'ttc-wallet-history', label: 'Lịch sử giao dịch', icon: 'history', roles: ['user'] },
    ],
  },
  {
    label: 'KIOSK CỦA TÔI',
    items: [
      { route: 'user-kiosks', label: 'Danh sách Kiosk', icon: 'store', roles: ['user'] },
      { route: 'user-register-kiosk', label: 'Đăng ký Kiosk mới', icon: 'plus', roles: ['user'] },
      { route: 'payments-mine', label: 'Thanh toán của tôi', icon: 'coin', roles: ['user'] },
    ],
  },
  {
    label: 'TÀI KHOẢN',
    items: [
      { route: 'user-profile', label: 'Hồ sơ của tôi', icon: 'user-circle', roles: ['user'] },
      { route: 'user-facebook', label: 'Tài khoản Facebook', icon: 'facebook', roles: ['user'] },
    ],
  },
  {
    label: 'HỆ THỐNG',
    items: [
      { route: 'logs', label: 'Nhật ký hoạt động', icon: 'history', roles: ['admin'] },
      { route: 'settings', label: 'Cài đặt', icon: 'settings', roles: ['admin'] },
    ],
  },
];

export const REVIEWER_NAV_SECTIONS = [
  {
    label: 'Kiểm duyệt',
    items: [
      { route: 'registration-requests', label: 'Duyệt đăng ký', icon: 'check' },
    ],
  },
];
