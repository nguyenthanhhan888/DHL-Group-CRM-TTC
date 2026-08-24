export const FacebookIdService = {
  async resolve(facebookUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch('/api/facebook-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facebook_url: String(facebookUrl || '').trim() }),
        signal: controller.signal,
      });
    } catch (error) {
      const friendly = new Error(error?.name === 'AbortError'
        ? 'Hết thời gian lấy thông tin Facebook. Vui lòng thử lại.'
        : 'Không thể kết nối để lấy thông tin Facebook. Vui lòng kiểm tra mạng và thử lại.');
      friendly.code = error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'NETWORK_ERROR';
      throw friendly;
    } finally {
      clearTimeout(timeout);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Backend trả về dữ liệu không hợp lệ.');
    }

    if (!response.ok || !data?.success || !/^\d+$/.test(String(data.facebook_id || ''))) {
      const error = new Error(data?.message || 'Không thể lấy Facebook ID.');
      error.code = data?.code || 'FACEBOOK_ID_REQUEST_FAILED';
      throw error;
    }

    return {
      facebookId: String(data.facebook_id),
      facebookUrl: String(data.facebook_url || facebookUrl),
      facebookName: String(data.facebook_name || data.name || facebookNameFromUrl(data.facebook_url || facebookUrl) || '').trim(),
    };
  },
};

export const resolveFacebookId = (facebookUrl) => FacebookIdService.resolve(facebookUrl);

function facebookNameFromUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path || path === 'profile.php') return '';
    return decodeURIComponent(path.split('/')[0] || '').trim();
  } catch {
    return '';
  }
}
