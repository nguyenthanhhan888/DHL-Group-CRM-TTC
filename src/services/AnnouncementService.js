const STORAGE_KEY = 'dhl_user_announcements';

const DEFAULT_ANNOUNCEMENTS = [];

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
