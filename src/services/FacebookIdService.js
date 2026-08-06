export const FacebookIdService = {
  async resolve(facebookUrl) {
    const response = await fetch('/api/facebook-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facebook_url: String(facebookUrl || '').trim() }),
    });

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
    };
  },
};

export const resolveFacebookId = (facebookUrl) => FacebookIdService.resolve(facebookUrl);
