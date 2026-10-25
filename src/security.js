// Senhas (scrypt), sessão assinada (HMAC-SHA256), códigos de 6 dígitos e limitador de tentativas
const crypto = require('crypto');
const config = require('./config');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(senha) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(senha, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function verifyPassword(senha, stored) {
  return new Promise((resolve) => {
    try {
      const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
      if (alg !== 'scrypt') return resolve(false);
      const key = Buffer.from(keyB64, 'base64');
      crypto.scrypt(senha, Buffer.from(saltB64, 'base64'), key.length, { N: +N, r: +r, p: +p }, (err, out) => {
        if (err) return resolve(false);
        resolve(crypto.timingSafeEqual(out, key));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

// Regras mínimas de senha: 8+ caracteres, com letra e número
function senhaValida(s) {
  return typeof s === 'string' && s.length >= 8 && s.length <= 200 && /[A-Za-z]/.test(s) && /\d/.test(s);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signSession(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + config.sessionHours * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHmac('sha256', config.sessionSecret).update(String(code)).digest('hex');
}

// Limitador em memória: max tentativas por chave em janela (ms).
// Em várias instâncias atrás de balanceador cada uma conta separado — suficiente para começar.
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  b.n += 1;
  return b.n <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60000).unref();

module.exports = { hashPassword, verifyPassword, senhaValida, signSession, verifySession, newCode, hashCode, rateLimit };
