const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 10 * 60;

function issueRenewalToken({ kioskId, now = Date.now() } = {}) {
  const payload = {
    v: 1,
    kid: positiveInteger(kioskId),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

function verifyRenewalToken(token, { now = Date.now(), expectedKioskId } = {}) {
  const [ivValue, encryptedValue, tagValue, extra] = String(token || '').split('.');
  if (!ivValue || !encryptedValue || !tagValue || extra) throw tokenError('Token gia hạn không hợp lệ.');
  let payload;
  try { const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(ivValue,'base64url'));decipher.setAuthTag(Buffer.from(tagValue,'base64url'));payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue,'base64url')),decipher.final()]).toString('utf8')); }
  catch { throw tokenError('Token gia hạn không hợp lệ.'); }
  if (payload?.v !== 1 || !Number.isSafeInteger(payload?.kid) || !Number.isSafeInteger(payload?.exp)) throw tokenError('Token gia hạn không hợp lệ.');
  if (payload.exp <= Math.floor(now / 1000)) throw tokenError('Token gia hạn đã hết hạn.', 'TOKEN_EXPIRED');
  if (expectedKioskId != null && payload.kid !== positiveInteger(expectedKioskId)) throw tokenError('Token không thuộc Kiosk này.', 'TOKEN_SCOPE_MISMATCH');
  return payload;
}

function encryptionKey() { return crypto.createHash('sha256').update(requireSecret()).digest(); }
function requireSecret() { const secret = process.env.PUBLIC_RENEWAL_TOKEN_SECRET; if (!secret || secret.length < 32) { const error = new Error('Thiếu cấu hình PUBLIC_RENEWAL_TOKEN_SECRET an toàn.'); error.code = 'MISSING_RENEWAL_SECRET'; throw error; } return secret; }
function positiveInteger(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw tokenError('Kiosk không hợp lệ.'); return number; }
function tokenError(message, code = 'INVALID_RENEWAL_TOKEN') { const error = new Error(message); error.code = code; return error; }

function renewalNonceHash(nonce) { return crypto.createHash('sha256').update(String(nonce || '')).digest('hex'); }
module.exports = { TOKEN_TTL_SECONDS, issueRenewalToken, renewalNonceHash, verifyRenewalToken };
