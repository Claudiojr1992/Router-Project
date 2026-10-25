// Técnicos, coordenação e administrativos (pessoas) e times
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, GESTAO, INTERNOS } = require('../auth');

function pessoaBody(b) {
  const hab = Array.isArray(b.habilidades) ? b.habilidades.slice(0, 20).map((h, i) => v.str(h, `a habilidade ${i + 1}`, { max: 40 })) : [];
  return [
    v.str(b.nome, 'o nome', { max: 120 }),
    v.oneOf(b.tipo, 'Tipo', ['tecnico', 'coordenacao', 'administrativo']),
    v.str(b.area, 'a área', { max: 80, opcional: true }),
    v.str(b.cidade_base, 'a cidade base', { max: 100, opcional: true }),
    b.uf_base ? v.str(String(b.uf_base).toUpperCase(), 'a UF', { min: 2, max: 2 }) : null,
    v.str(b.telefone, 'o telefone', { max: 30, opcional: true }),
    hab,
    b.ativo !== false,
  ];
}

async function salvarMembros(c, timeId, membros, lider) {
  if (!Array.isArray(membros) || membros.length > 50) throw new HttpError(400, 'Lista de técnicos inválida');
  await c.query(`DELETE FROM time_membros WHERE time_id = $1`, [timeId]);
  for (const pid of membros) {
    const pessoa = v.id(pid, 'Técnico');
    await c.query(`INSERT INTO time_membros (time_id, pessoa_id, lider) VALUES ($1,$2,$3)`, [timeId, pessoa, pessoa === lider]);
  }
}

module.exports = (app) => {
  const leitura = requer(INTERNOS);
  const gestao = requer(GESTAO);

  app.get('/api/pessoas', leitura, async (req) => {
    const tipo = req.query.tipo ? v.oneOf(req.query.tipo, 'Tipo', ['tecnico', 'coordenacao', 'administrativo']) : null;
    return db.many(
      `SELECT p.*, u.email, u.perfil,
              (SELECT array_agg(t.nome ORDER BY t.nome) FROM time_membros tm JOIN times t ON t.id = tm.time_id WHERE tm.pessoa_id = p.id) AS times,
              (SELECT count(*)::int FROM tarefas t WHERE t.responsavel_id = p.id AND t.status <> 'concluida') AS abertas
         FROM pessoas p LEFT JOIN usuarios u ON u.id = p.usuario_id
        WHERE ($1::text IS NULL OR p.tipo = $1)
        ORDER BY p.ativo DESC, p.tipo, p.nome`, [tipo]);
  });

  app.post('/api/pessoas', gestao, async (req) => db.one(
    `INSERT INTO pessoas (nome, tipo, area, cidade_base, uf_base, telefone, habilidades, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, pessoaBody(req.body)));

  app.put('/api/pessoas/:id', gestao, async (req) => {
    const r = await db.one(
      `UPDATE pessoas SET nome=$1, tipo=$2, area=$3, cidade_base=$4, uf_base=$5, telefone=$6, habilidades=$7, ativo=$8
        WHERE id = $9 RETURNING *`, [...pessoaBody(req.body), v.id(req.params.id)]);
    if (!r) throw new HttpError(404, 'Pessoa não encontrada');
    return r;
  });

  app.get('/api/times', leitura, async () => db.many(
    `SELECT t.*, COALESCE(json_agg(json_build_object('id', p.id, 'nome', p.nome, 'lider', tm.lider) ORDER BY tm.lider DESC, p.nome)
                          FILTER (WHERE p.id IS NOT NULL), '[]') AS membros
       FROM times t LEFT JOIN time_membros tm ON tm.time_id = t.id LEFT JOIN pessoas p ON p.id = tm.pessoa_id
      GROUP BY t.id ORDER BY t.ativo DESC, t.nome`));

  app.post('/api/times', gestao, async (req) => db.tx(async (c) => {
    const t = (await c.query(`INSERT INTO times (nome, cor, base) VALUES ($1,$2,$3) RETURNING *`, [
      v.str(req.body.nome, 'o nome do time', { max: 80 }), v.str(req.body.cor, 'a cor', { max: 20, opcional: true }),
      v.str(req.body.base, 'a base', { max: 100, opcional: true })])).rows[0];
    await salvarMembros(c, t.id, req.body.membros || [], req.body.lider ? Number(req.body.lider) : null);
    return t;
  }));

  app.put('/api/times/:id', gestao, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const r = await c.query(`UPDATE times SET nome=$1, cor=$2, base=$3, ativo=$4 WHERE id=$5 RETURNING *`, [
      v.str(req.body.nome, 'o nome do time', { max: 80 }), v.str(req.body.cor, 'a cor', { max: 20, opcional: true }),
      v.str(req.body.base, 'a base', { max: 100, opcional: true }), req.body.ativo !== false, id]);
    if (!r.rows.length) throw new HttpError(404, 'Time não encontrado');
    await salvarMembros(c, id, req.body.membros || [], req.body.lider ? Number(req.body.lider) : null);
    return r.rows[0];
  }));

  app.delete('/api/times/:id', gestao, async (req) => {
    await db.query(`DELETE FROM times WHERE id = $1`, [v.id(req.params.id)]);
    return { ok: true };
  });
};
