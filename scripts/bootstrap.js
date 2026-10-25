// Executado a cada subida do container: migra o banco, faz a carga BNB (se SEED_BNB=true e banco vazio)
// e cria o administrador inicial (se ainda não houver nenhum)
const config = require('../src/config');
const db = require('../src/db');
const migrate = require('./migrate');
const seed = require('./seed');
const createAdmin = require('./create-admin');

async function esperarBanco(tentativas = 20) {
  for (let i = 1; i <= tentativas; i++) {
    try { await db.query('SELECT 1'); return; } catch (e) {
      console.log(`[bootstrap] aguardando o banco (${i}/${tentativas}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('Banco de dados indisponível');
}

(async () => {
  await esperarBanco();
  await migrate();
  if (config.seedBnb) await seed();
  await createAdmin({ onlyIfNone: true });
  await db.pool.end();
})().catch((e) => {
  console.error('[bootstrap] falhou:', e);
  process.exit(1);
});
