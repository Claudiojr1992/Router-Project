// Aplica as migrações SQL de db/migrations em ordem, uma única vez cada
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function migrate() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const feitas = new Set((await db.many(`SELECT nome FROM schema_migrations`)).map((r) => r.nome));
  for (const f of arquivos) {
    if (feitas.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`[migrate] aplicando ${f}`);
    await db.tx(async (c) => {
      // trava para evitar duas instâncias migrando ao mesmo tempo
      await c.query('SELECT pg_advisory_xact_lock(724001)');
      const ja = await c.query('SELECT 1 FROM schema_migrations WHERE nome = $1', [f]);
      if (ja.rows.length) return;
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [f]);
    });
  }
  console.log('[migrate] banco atualizado');
}

module.exports = migrate;

if (require.main === module) {
  migrate().then(() => db.pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
