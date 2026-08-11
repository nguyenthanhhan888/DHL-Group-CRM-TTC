const GENERIC_NOT_FOUND = 'Không tìm thấy Kiosk với thông tin đã nhập.';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map();

module.exports = async function kioskLookupHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { success: false, message: GENERIC_NOT_FOUND });
  }

  if (!allowRequest(clientAddress(req))) {
    res.setHeader('Retry-After', '60');
    return send(res, 429, { success: false, message: 'Vui lòng thử lại sau ít phút.' });
  }

  const body = parseBody(req.body);
  const phone = normalizeVietnamesePhone(body?.phone);
  if (!phone) {
    return send(res, 400, { success: false, message: GENERIC_NOT_FOUND });
  }

  try {
    const kiosks = await lookupKiosks(phone);
    if (!kiosks.length) {
      return send(res, 404, { success: false, message: GENERIC_NOT_FOUND });
    }
    return send(res, 200, { success: true, kiosks });
  } catch (error) {
    console.error('Public kiosk lookup failed:', error?.message || error);
    return send(res, 500, { success: false, message: 'Không thể tra cứu lúc này. Vui lòng thử lại sau.' });
  }
};

async function lookupKiosks(phone) {
  const config = getServerConfig();
  const customerUrl = new URL(`${config.url}/rest/v1/customers`);
  customerUrl.searchParams.set('select', 'id');
  customerUrl.searchParams.set('phone', `in.(${phoneVariants(phone).map(quotePostgrest).join(',')})`);
  customerUrl.searchParams.set('limit', '20');

  const customers = await supabaseGet(customerUrl, config);
  const customerIds = customers.map((item) => Number(item.id)).filter(Number.isSafeInteger);
  if (!customerIds.length) return [];

  const kioskUrl = new URL(`${config.url}/rest/v1/kiosks`);
  kioskUrl.searchParams.set('select', 'facebook_name,start_date,end_date,auto_approve,business_types(name),categories(name)');
  kioskUrl.searchParams.set('customer_id', `in.(${customerIds.join(',')})`);
  kioskUrl.searchParams.set('order', 'facebook_name.asc');
  kioskUrl.searchParams.set('limit', '100');

  const rows = await supabaseGet(kioskUrl, config);
  return rows.map((row) => toPublicKiosk(row));
}

async function supabaseGet(url, config) {
  const response = await fetch(url, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  });
  if (!response.ok) throw new Error(`Supabase lookup returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function toPublicKiosk(row, today = vietnamToday()) {
  const endDate = parseDateOnly(row?.end_date);
  const todayDate = parseDateOnly(today);
  if (!endDate || !todayDate) {
    throw new Error('Kiosk has an invalid date-only value');
  }
  const expired = endDate.epochDay < todayDate.epochDay;
  const remainingDays = differenceInDateOnlyDays(row.end_date, today);
  const status = expired ? 'Đã hết hạn' : remainingDays <= 15 ? 'Sắp hết hạn' : 'Đang hoạt động';
  return {
    name: String(row?.facebook_name || 'Kiosk').trim(),
    category: String(row?.categories?.name || '').trim() || null,
    businessType: String(row?.business_types?.name || '').trim() || null,
    startDate: validDateOnly(row?.start_date),
    expirationDate: validDateOnly(row?.end_date),
    remainingDays,
    status,
    autoApprove: row?.auto_approve === true,
  };
}

function normalizeVietnamesePhone(value) {
  let digits = String(value || '').trim().replace(/[\s().-]+/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
  return /^0[3-9]\d{8}$/.test(digits) ? digits : '';
}

function phoneVariants(phone) {
  const local = normalizeVietnamesePhone(phone);
  if (!local) return [];
  const international = `84${local.slice(1)}`;
  return [local, international, `+${international}`];
}

function differenceInDateOnlyDays(endDate, today) {
  const end = parseDateOnly(endDate);
  const current = parseDateOnly(today);
  if (!end || !current) return null;
  return Math.max(0, end.epochDay - current.epochDay);
}

function vietnamToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validDateOnly(value) {
  return parseDateOnly(value)?.value || null;
}

function parseDateOnly(value) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return { value: text, epochDay: Math.floor(timestamp / 86400000) };
}

function getServerConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing server Supabase configuration');
  return { url, key };
}

function allowRequest(key, now = Date.now()) {
  if (rateLimitBuckets.size > 5000) rateLimitBuckets.clear();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, startedAt: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

function clientAddress(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  try { return JSON.parse(String(body || '')); } catch { return null; }
}

function quotePostgrest(value) {
  return `"${String(value).replace(/["\\]/g, '')}"`;
}

function send(res, status, payload) {
  return res.status(status).json(payload);
}

module.exports._test = {
  allowRequest, differenceInDateOnlyDays, normalizeVietnamesePhone, phoneVariants,
  parseDateOnly, rateLimitBuckets, toPublicKiosk, vietnamToday,
};
