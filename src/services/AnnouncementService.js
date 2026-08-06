const STORAGE_KEY = 'dhl_user_announcements';

const DEFAULT_ANNOUNCEMENTS = [
  {
    id: 'seed-price-update',
    title: '[CẬP NHẬT]',
    category: 'Tiktok',
    body: [
      'Tăng giá mua tiktok_follow, tiktok_follow2 (global) từ 1100xu/follow -> 1500xu/follow',
      'Tăng giá nhận xu tiktok_follow, tiktok_follow2 (global) từ 1000xu/follow -> 1400xu/follow',
    ],
    author: 'Admin',
    createdAt: '2026-05-22T21:30:58+07:00',
    reactionCount: 12,
    commentCount: 3,
    shareCount: 1,
  },
  {
    id: 'seed-facebook-update',
    title: '[CẬP NHẬT]',
    category: 'Facebook',
    body: [
      'Bổ sung nhiệm vụ like, follow, comment và share cho tài khoản đã xác minh Facebook ID.',
      'Ưu tiên hiển thị nhiệm vụ phù hợp với số dư ví và lịch sử hoàn thành.',
    ],
    author: 'Admin',
    createdAt: '2026-04-18T09:12:10+07:00',
    reactionCount: 8,
    commentCount: 2,
    shareCount: 0,
  },
];

export const AnnouncementService = {
  list() {
    const stored = readStoredAnnouncements();
    return [...stored, ...DEFAULT_ANNOUNCEMENTS]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  create({ title = '', category = '', body = '', author = 'Admin' } = {}) {
    const announcement = {
      id: `local-${Date.now()}`,
      title: String(title || '[CẬP NHẬT]').trim() || '[CẬP NHẬT]',
      category: String(category || 'Thông báo').trim() || 'Thông báo',
      body: normalizeBody(body),
      author: String(author || 'Admin').trim() || 'Admin',
      createdAt: new Date().toISOString(),
      reactionCount: 0,
      commentCount: 0,
      shareCount: 0,
    };
    const stored = readStoredAnnouncements();
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify([announcement, ...stored].slice(0, 20)));
    return announcement;
  },
};

function readStoredAnnouncements() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeBody(value) {
  const lines = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : ['Hệ thống vừa có cập nhật mới.'];
}
