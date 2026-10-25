// Conexão com o PostgreSQL (pool) e helpers de consulta/transação
const fs = require('fs');
const { Pool, types } = require('pg');
const config = require('./config');

// IDs BIGSERIAL (int8) como número; datas (DATE) como texto 'AAAA-MM-DD'; NUMERIC como número
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

let ssl = false;
if (config.dbSsl) {
  ssl = config.dbSslCa && fs.existsSync(config.dbSslCa)
    ? { ca: fs.readFileSync(config.dbSslCa, 'utf8'), rejectUnauthorized: true }
    : { rejectUnauthorized: false }; // criptografado; para validar o certificado, informe DB_SSL_CA
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('[db] erro em conexão ociosa:', err.message));

// Escritas levam junto quem está mexendo (para a auditoria feita pelos gatilhos do banco)
const contexto = require('./contexto');
const ESCRITA = /^\s*(insert|update|delete|with)\b/i;
function quem() {
  const c = contexto.atual();
  const u = c && c.usuario;
  return [u ? String(u.id) : '', u ? String(u.nome || '') : '', c && c.ip ? String(c.ip) : ''];
}
const SET_QUEM = `SELECT set_config('rp.uid', $1, $4), set_config('rp.unome', $2, $4), set_config('rp.ip', $3, $4)`;

async function query(text, params) {
  if (!ESCRITA.test(text)) return pool.query(text, params);
  // set_config local dentro de uma transação curta: funciona também com o pooler do Supabase (modo transação)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SET_QUEM, [...quem(), true]);
    const r = await client.query(text, params);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignora */ }
    throw e;
  } finally {
    client.release();
  }
}

async function one(text, params) {
  const r = await query(text, params);
  return r.rows[0] || null;
}

async function many(text, params) {
  const r = await query(text, params);
  return r.rows;
}

// Executa fn(client) dentro de BEGIN/COMMIT, com ROLLBACK em caso de erro
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SET_QUEM, [...quem(), true]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignora */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, many, tx, quem };
