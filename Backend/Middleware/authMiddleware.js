const crypto = require('crypto');

const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'nards-catering-change-this-secret';
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function encodeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;

  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const signaturesMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!signaturesMatch) return null;

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function createAuthToken(user) {
  return encodeToken({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  });
}

function requireInternalUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  try {
    const user = decodeToken(token);
    if (!user) return res.status(401).json({ error: 'Internal login required.' });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid internal login token.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  next();
}

function requireManager(req, res, next) {
  if (!['admin', 'manager'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Manager or administrator access required.' });
  }
  next();
}

module.exports = { createAuthToken, requireInternalUser, requireAdmin, requireManager };
