// Cria (ou reativa) o administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD
// Uso manual: ADMIN_EMAIL=voce@empresa.com ADMIN_PASSWORD='Senha123' node scripts/create-admin.js
const config = require('../src/config');
const db = require('../src/db');
const { hashPassword, senhaValida } = require('../src/security');

async function createAdmin({ onlyIfNone = false } = {}) {
  const { email, password, name } = config.admin;
  if (!email || !password) {
    if (!onlyIfNone) console.log('[admin] defina ADMIN_EMAIL e ADMIN_PASSWORD');
    return false;
  }
  if (onlyIfNone) {
    const r = await db.one(`SELECT count(*)::int AS n FROM usuarios WHERE perfil = 'admin' AND status = 'ativo'`);
    if (r.n > 0) return false;
  }
  if (!senhaValida(password)) {
    console.error('[admin] ADMIN_PASSWORD precisa de 8+ caracteres, com letras e números');
    return false;
  }
  const hash = await hashPassword(password);
  await db.tx(async (c) => {
    const u = (await c.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, status) VALUES ($1, lower($2), $3, 'admin', 'ativo')
       ON CONFLICT ((lower(email))) DO UPDATE SET perfil = 'admin', status = 'ativo', senha_hash = EXCLUDED.senha_hash
       RETURNING id, nome`, [name, email, hash])).rows[0];
    const p = await c.query(`SELECT id FROM pessoas WHERE usuario_id = $1`, [u.id]);
    if (!p.rows.length) await c.query(`INSERT INTO pessoas (usuario_id, nome, tipo) VALUES ($1, $2, 'coordenacao')`, [u.id, u.nome]);
  });
  console.log(`[admin] administrador pronto: ${email.toLowerCase()}`);
  return true;
}

module.exports = createAdmin;

if (require.main === module) {
  createAdmin().then(() => db.pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
