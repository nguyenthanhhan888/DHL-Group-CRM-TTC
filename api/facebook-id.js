const TRAODOISUB_API_URL = 'https://id.traodoisub.com/api.php';
const REQUEST_TIMEOUT_MS = 10_000;

module.exports = async function facebookIdHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.');
  }

  const body = parseRequestBody(req.body);
  if (!body.ok) {
    return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  }

  const validation = validateFacebookUrl(body.value?.facebook_url);
  if (!validation.ok) {
    return sendError(res, 400, validation.code, validation.message);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(TRAODOISUB_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ link: validation.url }).toString(),
      signal: controller.signal,
    });

    if (!upstreamResponse.ok) {
      return sendError(
        res,
        502,
        'UPSTREAM_HTTP_ERROR',
        'Dịch vụ lấy Facebook ID đang tạm thời không khả dụng.',
      );
    }

    let upstreamData;
    try {
      upstreamData = await upstreamResponse.json();
    } catch {
      return sendError(
        res,
        502,
        'UPSTREAM_INVALID_JSON',
        'Dịch vụ lấy Facebook ID trả về dữ liệu không hợp lệ.',
      );
    }

    const facebookId = normalizeFacebookId(upstreamData?.id);
    if (!facebookId) {
      return sendError(
        res,
        422,
        'FACEBOOK_ID_NOT_FOUND',
        'Không tìm thấy Facebook ID từ URL này. Bạn có thể thử lại hoặc nhập ID thủ công.',
      );
    }

    return res.status(200).json({
      success: true,
      facebook_id: facebookId,
      facebook_url: validation.url,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return sendError(
        res,
        504,
        'UPSTREAM_TIMEOUT',
        'Dịch vụ lấy Facebook ID phản hồi quá chậm. Vui lòng thử lại.',
      );
    }
    return sendError(
      res,
      502,
      'UPSTREAM_REQUEST_FAILED',
      'Không thể kết nối dịch vụ lấy Facebook ID.',
    );
  } finally {
    clearTimeout(timeout);
  }
};

function parseRequestBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ok: true, value: body };
  }
  if (typeof body !== 'string') return { ok: false };
  try {
    const value = JSON.parse(body);
    return { ok: Boolean(value && typeof value === 'object' && !Array.isArray(value)), value };
  } catch {
    return { ok: false };
  }
}

function validateFacebookUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return {
      ok: false,
      code: 'FACEBOOK_URL_REQUIRED',
      message: 'Facebook URL là bắt buộc.',
    };
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return {
      ok: false,
      code: 'INVALID_URL',
      message: 'Facebook URL không hợp lệ.',
    };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      ok: false,
      code: 'INVALID_URL',
      message: 'Facebook URL phải dùng HTTP hoặc HTTPS.',
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = hostname === 'facebook.com'
    || hostname.endsWith('.facebook.com')
    || hostname === 'fb.com'
    || hostname.endsWith('.fb.com');
  if (!allowed) {
    return {
      ok: false,
      code: 'INVALID_FACEBOOK_DOMAIN',
      message: 'URL phải thuộc tên miền Facebook hợp lệ.',
    };
  }

  url.hash = '';
  return { ok: true, url: url.toString() };
}

function normalizeFacebookId(value) {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : '';
}

function sendError(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

module.exports._test = {
  normalizeFacebookId,
  parseRequestBody,
  validateFacebookUrl,
  REQUEST_TIMEOUT_MS,
};
