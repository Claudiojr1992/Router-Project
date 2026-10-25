// Validação simples de entrada
const { HttpError } = require('./http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v, campo, { min = 0, max = 500, opcional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new HttpError(400, `Informe ${campo}`);
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${campo} inválido`);
  const s = String(v).trim();
  if (s.length < min) throw new HttpError(400, `${campo} muito curto`);
  if (s.length > max) throw new HttpError(400, `${campo} muito longo`);
  if (!s.length && !opcional) throw new HttpError(400, `Informe ${campo}`);
  return s || null;
}

function email(v) {
  const s = str(v, 'o e-mail', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw new HttpError(400, 'E-mail inválido');
  return s;
}

function int(v, campo, { min = -2147483648, max = 2147483647, opcional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new HttpError(400, `Informe ${campo}`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${campo} inválido`);
  return n;
}

function num(v, campo, { min = -1e12, max = 1e12, opcional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new HttpError(400, `Informe ${campo}`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${campo} inválido`);
  return n;
}

function oneOf(v, campo, lista, { opcional = false } = {}) {
  if ((v === undefined || v === null || v === '') && opcional) return null;
  if (!lista.includes(v)) throw new HttpError(400, `${campo} inválido`);
  return v;
}

function date(v, campo, { opcional = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new HttpError(400, `Informe ${campo}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `${campo} inválida`);
  return String(v);
}

function id(v, campo = 'id') {
  return int(v, campo, { min: 1 });
}

module.exports = { str, email, int, num, oneOf, date, id };
