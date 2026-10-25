// Carrega o cliente BNB (contratos, 97 endereços, atividades, checklists e tarefas) se o banco ainda não tiver clientes
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function seed({ force = false } = {}) {
  const r = await db.one('SELECT count(*)::int AS n FROM clientes');
  if (r.n > 0 && !force) {
    console.log('[seed] já existem clientes — carga BNB ignorada');
    return false;
  }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'seeds', 'bnb.sql'), 'utf8');
  await db.query(sql); // o arquivo tem BEGIN/COMMIT próprios
  console.log('[seed] cliente BNB carregado');
  return true;
}

module.exports = seed;

if (require.main === module) {
  seed().then(() => db.pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
