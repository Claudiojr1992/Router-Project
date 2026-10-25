// Chat: canal geral e um canal por projeto (cliente); mensagens, pedidos e ocorrências com "resolvido"
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, INTERNOS } = require('../auth');

const TIPOS = ['mensagem', 'pedido', 'ocorrencia'];
// na URL: geral | cliente-12  ·  no banco: geral | cliente:12
function canalDe(p) {
  const s = String(p || '');
  if (s === 'geral') return 'geral';
  const m = /^cliente-(\d{1,12})$/.exec(s);
  if (!m) throw new HttpError(404, 'Canal não encontrado');
  return `cliente:${m[1]}`;
}

module.exports = (app) => {
  const interno = requer(INTERNOS);

  app.get('/api/chat/canais', interno, async (req) => {
    const clientes = await db.many(`SELECT id, nome FROM clientes WHERE ativo ORDER BY nome`);
    const canais = [{ canal: 'geral', url: 'geral', nome: 'Geral', tipo: 'geral' }, ...clientes.map((c) => ({ canal: `cliente:${c.id}`, url: `cliente-${c.id}`, nome: c.nome, tipo: 'projeto', cliente_id: c.id }))];
    const ult = await db.many(
      `SELECT DISTINCT ON (m.canal) m.canal, m.texto, m.tipo, m.criado_em, u.nome AS usuario
         FROM mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id ORDER BY m.canal, m.criado_em DESC`);
    const cont = await db.many(
      `SELECT m.canal, count(*) FILTER (WHERE m.criado_em > COALESCE(l.lido_em, 'epoch') AND m.usuario_id IS DISTINCT FROM $1)::int AS nao_lidas,
              count(*) FILTER (WHERE m.tipo <> 'mensagem' AND NOT m.resolvido)::int AS abertos
         FROM mensagens m LEFT JOIN chat_leituras l ON l.canal = m.canal AND l.usuario_id = $1 GROUP BY m.canal`, [req.user.id]);
    const U = new Map(ult.map((x) => [x.canal, x])), C = new Map(cont.map((x) => [x.canal, x]));
    return canais.map((c) => ({ ...c, ultima: U.get(c.canal) || null, nao_lidas: C.get(c.canal)?.nao_lidas || 0, abertos: C.get(c.canal)?.abertos || 0 }));
  });

  app.get('/api/chat/:canal/mensagens', interno, async (req) => {
    const canal = canalDe(req.params.canal);
    const depois = req.query.depois ? v.id(req.query.depois, 'Mensagem') : 0;
    const rows = await db.many(
      `SELECT m.id, m.tipo, m.texto, m.resolvido, m.criado_em, m.usuario_id, u.nome AS usuario, u.perfil, m.endereco_id, e.nome AS endereco, e.municipio, e.uf
         FROM mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id LEFT JOIN enderecos e ON e.id = m.endereco_id
        WHERE m.canal = $1 AND m.id > $2 ORDER BY m.id DESC LIMIT 300`, [canal, depois]);
    return rows.reverse();
  });

  // endereços do projeto para citar numa mensagem
  app.get('/api/chat/:canal/enderecos', interno, async (req) => {
    const canal = canalDe(req.params.canal);
    if (canal === 'geral') return [];
    return db.many(`SELECT e.id, e.nome, e.codigo, e.municipio, e.uf FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
                     WHERE ct.cliente_id = $1 ORDER BY e.nome LIMIT 3000`, [+canal.split(':')[1]]);
  });

  app.post('/api/chat/:canal/mensagens', interno, async (req) => {
    const canal = canalDe(req.params.canal);
    const texto = v.str(req.body.texto, 'a mensagem', { max: 4000 });
    const tipo = v.oneOf(req.body.tipo || 'mensagem', 'Tipo', TIPOS);
    const end = req.body.endereco_id ? v.id(req.body.endereco_id, 'Endereço') : null;
    if (canal.startsWith('cliente:') && !(await db.one(`SELECT 1 AS ok FROM clientes WHERE id = $1`, [+canal.split(':')[1]]))) throw new HttpError(404, 'Projeto não encontrado');
    const m = await db.one(`INSERT INTO mensagens (canal, tipo, usuario_id, texto, endereco_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [canal, tipo, req.user.id, texto, end]);
    await db.query(`INSERT INTO chat_leituras (usuario_id, canal, lido_em) VALUES ($1,$2,now()) ON CONFLICT (usuario_id, canal) DO UPDATE SET lido_em = now()`, [req.user.id, canal]);
    return m;
  });

  app.post('/api/chat/:canal/lido', interno, async (req) => {
    const canal = canalDe(req.params.canal);
    await db.query(`INSERT INTO chat_leituras (usuario_id, canal, lido_em) VALUES ($1,$2,now()) ON CONFLICT (usuario_id, canal) DO UPDATE SET lido_em = now()`, [req.user.id, canal]);
    return { ok: true };
  });

  app.post('/api/chat/mensagens/:id/resolver', interno, async (req) => {
    const r = await db.query(`UPDATE mensagens SET resolvido = $1 WHERE id = $2 AND tipo <> 'mensagem'`, [req.body.resolvido !== false, v.id(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Pedido ou ocorrência não encontrado');
    return { ok: true };
  });

  // total de não lidas (para o selo no menu)
  app.get('/api/chat/nao-lidas', interno, async (req) => db.one(
    `SELECT count(*)::int AS n FROM mensagens m LEFT JOIN chat_leituras l ON l.canal = m.canal AND l.usuario_id = $1
      WHERE m.criado_em > COALESCE(l.lido_em, 'epoch') AND m.usuario_id IS DISTINCT FROM $1`, [req.user.id]));
};
