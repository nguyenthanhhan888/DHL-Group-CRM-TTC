const REQUEST_TIMEOUT_MS = 9_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const FACEBOOK_CRAWLER_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

module.exports = async function facebookIdHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ phương thức POST.');
  }

  const body = parseRequestBody(req.body);
  if (!body.ok) return sendError(res, 400, 'INVALID_JSON', 'Nội dung JSON không hợp lệ.');
  const validation = validateFacebookUrl(body.value?.facebook_url);
  if (!validation.ok) return sendError(res, 400, validation.code, validation.message);

  const facebookUrl = normalizeFacebookUrl(validation.url);
  const directId = facebookIdFromProfileUrl(facebookUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    if (directId) {
      let meta;
      try {
        meta = await resolveWithin(fetchFacebookMeta(facebookUrl, controller.signal), 2_500);
      } catch (error) {
        if (normalizeProviderError(error).code === 'FACEBOOK_PROFILE_NOT_FOUND') {
          return sendError(res, 404, 'FACEBOOK_PROFILE_NOT_FOUND', 'Không tìm thấy tài khoản Facebook. Liên kết có thể đã bị xóa hoặc không còn tồn tại.');
        }
        meta = null;
      }
      const payload = {
        success: true,
        facebook_id: directId,
        facebook_url: facebookUrl,
        source: 'url_pattern',
      };
      if (meta?.name) payload.facebook_name = meta.name;
      return res.status(200).json(payload);
    }

    const tasks = [fetchFacebookMeta(facebookUrl, controller.signal)];
    tasks.push(
      fetchTraodoisub(facebookUrl, controller.signal),
      fetch2uid(facebookUrl, controller.signal),
      fetchLookupId(facebookUrl, controller.signal),
      fetchVnfame(facebookUrl, controller.signal),
    );
    const results = await Promise.allSettled(tasks);
    const resolved = results
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
    const facebookId = directId || resolved.map((item) => item.id).find(Boolean) || '';
    const facebookName = resolved.find((item) => item.source === 'facebook_meta')?.name
      || resolved.find((item) => item.id === facebookId)?.name
      || '';
    if (facebookId) {
      const idResult = resolved.find((item) => item.id === facebookId);
      const payload = {
        success: true,
        facebook_id: facebookId,
        facebook_url: facebookUrl,
        source: directId ? 'url_pattern' : (idResult?.source || 'provider'),
      };
      if (facebookName) payload.facebook_name = facebookName;
      return res.status(200).json(payload);
    }

    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => normalizeProviderError(result.reason));
    if (errors.some((error) => error.code === 'FACEBOOK_PROFILE_NOT_FOUND')) {
      return sendError(res, 404, 'FACEBOOK_PROFILE_NOT_FOUND', 'Không tìm thấy tài khoản Facebook. Liên kết có thể đã bị xóa hoặc không còn tồn tại.');
    }
    if (errors.length === tasks.length && errors.every((error) => error.code === 'FACEBOOK_ID_PROVIDER_BLOCKED')) {
      return sendError(res, 503, 'FACEBOOK_ID_PROVIDER_BLOCKED', 'Facebook đang hạn chế tra cứu tự động. Chưa thể xác định trạng thái tài khoản. Bạn có thể nhập Facebook ID thủ công hoặc thử lại.');
    }
    if (errors.length === tasks.length && errors.every((error) => error.code === 'UPSTREAM_TIMEOUT')) {
      return sendError(res, 504, 'UPSTREAM_TIMEOUT', 'Dịch vụ lấy Facebook ID phản hồi quá chậm. Vui lòng thử lại.');
    }
    if (errors.length === tasks.length) {
      const codes = new Set(errors.map((error) => error.code));
      if (codes.size === 1) {
        const code = errors[0].code;
        const messages = {
          UPSTREAM_HTTP_ERROR: 'Các dịch vụ lấy Facebook ID đang tạm thời không khả dụng.',
          UPSTREAM_INVALID_JSON: 'Các dịch vụ lấy Facebook ID trả về dữ liệu không hợp lệ.',
        };
        return sendError(res, 502, code, messages[code] || 'Không thể kết nối các dịch vụ lấy Facebook ID.');
      }
    }
    return sendError(res, 422, 'FACEBOOK_LOOKUP_INCONCLUSIVE', 'Không thể nhận diện tài khoản từ liên kết này. Vui lòng kiểm tra URL hoặc nhập Facebook ID thủ công.');
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
};

async function fetchFacebookMeta(url, signal) {
  const response = await fetch(url, {
    headers: { 'User-Agent': FACEBOOK_CRAWLER_AGENT, 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
    redirect: 'follow', signal,
  });
  if (isFacebookLoginUrl(response.url)) return null;
  if ([404, 410].includes(response.status) && isProfileSpecificFacebookResponse(url, response.url)) {
    throw providerError('FACEBOOK_PROFILE_NOT_FOUND');
  }
  if (!response.ok) throw providerError('UPSTREAM_HTTP_ERROR');
  const source = await response.text();
  if (isCaptchaResponse(source)) throw providerError('FACEBOOK_ID_PROVIDER_BLOCKED');
  if (isFacebookLoginPage(source)) return null;
  if (isFacebookProfileUnavailablePage(source)) throw providerError('FACEBOOK_PROFILE_NOT_FOUND');
  const deepLink = source.match(/fb:\/\/(?:profile\/|page\/?\?id=)(\d+)/i);
  const ogTitle = extractMetaContent(source, 'og:title');
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const result = { id: normalizeFacebookId(deepLink?.[1]), name: cleanFacebookName(ogTitle || title), source: 'facebook_meta' };
  return result.id || result.name ? result : null;
}

async function fetchTraodoisub(url, signal) {
  const response = await fetch('https://id.traodoisub.com/api.php', {
    method: 'POST',
    headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ link: url }).toString(), signal,
  });
  if (!response.ok) throw providerError('UPSTREAM_HTTP_ERROR');
  const data = await readJson(response);
  if (Number(data?.code) === 403 || /captcha|recaptcha/i.test(String(data?.error || data?.message || ''))) {
    throw providerError('FACEBOOK_ID_PROVIDER_BLOCKED');
  }
  return providerResult(data?.id, data?.name || data?.title || data?.fullname, 'traodoisub');
}

async function fetch2uid(url, signal) {
  const landing = await fetch('https://2uid.net', { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!landing.ok) throw providerError('UPSTREAM_HTTP_ERROR');
  const html = await landing.text();
  const csrf = html.match(/X-CSRF-TOKEN['"]\s*,\s*['"]([^'"]+)['"]/i)?.[1];
  if (!csrf) return null;
  const headers = {
    'X-CSRF-TOKEN': csrf, Referer: 'https://2uid.net/', Origin: 'https://2uid.net',
    'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded',
  };
  const cookie = responseCookies(landing);
  if (cookie) headers.Cookie = cookie;
  const response = await fetch('https://2uid.net/api/convert', {
    method: 'POST', headers, body: new URLSearchParams({ link: url }).toString(), signal,
  });
  if (!response.ok) throw providerError('UPSTREAM_HTTP_ERROR');
  const data = await readJson(response);
  if (/captcha|recaptcha/i.test(String(data?.error || data?.message || ''))) throw providerError('FACEBOOK_ID_PROVIDER_BLOCKED');
  return Number(data?.success) === 200 ? providerResult(data?.id, data?.name, '2uid') : null;
}

async function fetchLookupId(url, signal) {
  const response = await fetch('https://lookup-id.com/', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://lookup-id.com/', Origin: 'https://lookup-id.com', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ fburl: url, check: 'Lookup' }).toString(), signal,
  });
  if (!response.ok) throw providerError('UPSTREAM_HTTP_ERROR');
  const html = await response.text();
  if (/captcha|recaptcha/i.test(html)) throw providerError('FACEBOOK_ID_PROVIDER_BLOCKED');
  return providerResult(html.match(/<span[^>]+id=["']code["'][^>]*>(\d+)<\/span>/i)?.[1], '', 'lookup-id');
}

async function fetchVnfame(url, signal) {
  const response = await fetch('https://vnfame.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT, Referer: 'https://vnfame.com/lay-id-facebook/', Origin: 'https://vnfame.com',
      'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ action: 'get_facebook_id', fb_url: url }).toString(), signal,
  });
  if (!response.ok) throw providerError('UPSTREAM_HTTP_ERROR');
  const data = await readJson(response);
  if (/captcha|recaptcha/i.test(String(data?.error || data?.message || ''))) throw providerError('FACEBOOK_ID_PROVIDER_BLOCKED');
  return data?.success ? providerResult(data?.data?.fb_id, data?.data?.name, 'vnfame') : null;
}

function providerResult(id, name, source) {
  const facebookId = normalizeFacebookId(id);
  return facebookId ? { id: facebookId, name: cleanFacebookName(name), source } : null;
}

async function readJson(response) {
  try { return await response.json(); } catch { throw providerError('UPSTREAM_INVALID_JSON'); }
}

async function resolveWithin(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise.catch((error) => {
        if (normalizeProviderError(error).code === 'FACEBOOK_PROFILE_NOT_FOUND') throw error;
        return null;
      }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function extractMetaContent(source, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyFirst = source.match(new RegExp(`<meta[^>]+property=(["'])${escaped}\\1[^>]+content=(["'])(.*?)\\2`, 'i'));
  if (propertyFirst) return propertyFirst[3];
  const contentFirst = source.match(new RegExp(`<meta[^>]+content=(["'])(.*?)\\1[^>]+property=(["'])${escaped}\\3`, 'i'));
  return contentFirst?.[2] || '';
}

function cleanFacebookName(value) {
  const name = decodeHtmlEntities(String(value || ''))
    .replace(/\s*\|\s*Facebook$/i, '')
    .replace(/\s*-\s*(?:Trang chủ|Home|Facebook)$/i, '')
    .trim();
  if (!name || /^(facebook|error|log in to facebook|đăng nhập facebook)$/i.test(name)) return '';
  return name.slice(0, 300);
}

function isCaptchaResponse(value) {
  return /(?:captcha|recaptcha|checkpoint\/challenge)/i.test(String(value || ''));
}

function isFacebookLoginUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return /(^|\.)facebook\.com$/i.test(url.hostname)
      && /^\/(?:login|checkpoint)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isFacebookLoginPage(source) {
  const text = decodeHtmlEntities(String(source || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return /(?:log in to facebook|đăng nhập facebook)/i.test(text)
    && /(?:forgot(?:ten)? password|quên mật khẩu|create new account|tạo tài khoản mới)/i.test(text);
}

function isFacebookProfileUnavailablePage(source) {
  const text = decodeHtmlEntities(String(source || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return /(?:this page isn't available|this page is not available|page not found|the link you followed may be broken, or the page may have been removed|trang này hiện không khả dụng|không tìm thấy trang|liên kết bạn truy cập có thể bị hỏng hoặc trang có thể đã bị gỡ)/i.test(text);
}

function isProfileSpecificFacebookResponse(requestedValue, responseValue) {
  try {
    const requested = new URL(requestedValue);
    const response = new URL(responseValue || requestedValue);
    if (!/(^|\.)facebook\.com$/i.test(response.hostname) || isFacebookLoginUrl(response.toString())) return false;
    const cleanPath = (value) => value.replace(/\/+$/, '') || '/';
    return cleanPath(response.pathname) === cleanPath(requested.pathname);
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
    const radix = entity[1].toLowerCase() === 'x' ? 16 : 10;
    const number = Number.parseInt(entity.slice(radix === 16 ? 2 : 1), radix);
    return Number.isFinite(number) ? String.fromCodePoint(number) : match;
  });
}

function responseCookies(response) {
  const cookies = response.headers?.getSetCookie?.() || [];
  if (cookies.length) return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  return String(response.headers?.get?.('set-cookie') || '').split(/,(?=[^;,]+=)/).map((cookie) => cookie.split(';')[0]).filter(Boolean).join('; ');
}

function parseRequestBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return { ok: true, value: body };
  if (typeof body !== 'string') return { ok: false };
  try {
    const value = JSON.parse(body);
    return { ok: Boolean(value && typeof value === 'object' && !Array.isArray(value)), value };
  } catch { return { ok: false }; }
}

function validateFacebookUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, code: 'FACEBOOK_URL_REQUIRED', message: 'Facebook URL là bắt buộc.' };
  let url;
  try { url = new URL(value.trim()); } catch { return invalidFacebookUrl(); }
  if (!['http:', 'https:'].includes(url.protocol)) return invalidFacebookUrl();
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.com' || hostname.endsWith('.fb.com');
  if (!allowed || isUnsupportedFacebookContentUrl(url)) return invalidFacebookUrl();
  url.hash = '';
  return { ok: true, url: url.toString() };
}

function invalidFacebookUrl() {
  return { ok: false, code: 'INVALID_FACEBOOK_URL', message: 'Link Facebook không hợp lệ. Vui lòng kiểm tra lại.' };
}

function isUnsupportedFacebookContentUrl(url) {
  const segments = url.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  if (!segments.length) return true;
  if (segments[0] === 'profile.php') return !normalizeFacebookId(url.searchParams.get('id'));
  const unsupportedRoots = new Set([
    'dialog', 'events', 'gaming', 'groups', 'help', 'login', 'marketplace', 'permalink.php',
    'photo.php', 'reel', 'reels', 'share', 'sharer', 'story.php', 'video.php', 'watch',
  ]);
  const unsupportedNested = new Set(['posts', 'photos', 'reel', 'reels', 'stories', 'videos']);
  return unsupportedRoots.has(segments[0]) || segments.slice(1).some((segment) => unsupportedNested.has(segment));
}

function normalizeFacebookUrl(value) {
  const url = new URL(value);
  if (/(^|\.)facebook\.com$/i.test(url.hostname)) url.hostname = 'www.facebook.com';
  url.protocol = 'https:';
  url.hash = '';
  if (url.pathname.replace(/\/+$/, '') === '/profile.php') {
    const id = normalizeFacebookId(url.searchParams.get('id'));
    url.search = id ? `?id=${id}` : '';
  } else {
    ['mibextid', 'ref', 'refid', '__tn__', '__cft__'].forEach((key) => url.searchParams.delete(key));
  }
  return url.toString();
}

function normalizeFacebookId(value) {
  const id = String(value ?? '').trim();
  return /^\d{5,30}$/.test(id) ? id : '';
}

function facebookIdFromProfileUrl(value) {
  const url = new URL(value);
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'profile.php') return normalizeFacebookId(url.searchParams.get('id'));
  return /^\d{5,30}$/.test(path) ? path : '';
}

function providerError(code) { const error = new Error(code); error.code = code; return error; }
function normalizeProviderError(error) { return { code: error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : (error?.code || 'UPSTREAM_REQUEST_FAILED') }; }
function sendError(res, status, code, message) { return res.status(status).json({ success: false, code, message }); }

module.exports._test = {
  cleanFacebookName, facebookIdFromProfileUrl, normalizeFacebookId, normalizeFacebookUrl,
  isFacebookLoginPage, isFacebookLoginUrl, isFacebookProfileUnavailablePage,
  isProfileSpecificFacebookResponse, isUnsupportedFacebookContentUrl,
  parseRequestBody, validateFacebookUrl, REQUEST_TIMEOUT_MS,
};
