// Faturamento: medição mensal por contrato (endereços aptos pela regra de cobrança × valores do contrato)
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, ESCRITORIO } = require('../auth');

// Endereço apto: passou da etapa exigida pela regra do contrato e ainda não está em nenhuma medição
const APTO = `(CASE ct.regra_cobranca
    WHEN 'apos_handover' THEN e.status IN ('Handover','Concluída') OR e.concluido_em IS NOT NULL
    ELSE e.status IN ('Em validação','Faturado','Handover','Concluída') OR e.concluido_em IS NOT NULL END)
  AND NOT EXISTS (SELECT 1 FROM medicao_enderecos me WHERE me.endereco_id = e.id)`;
const VALOR = `(COALESCE(ct.valor_camera,0) * e.cameras + COALESCE(ct.valor_endereco,0))`;
const FLUXO = { aberta: 'enviada', enviada: 'aprovada', aprovada: 'nf_emitida', nf_emitida: 'recebida' };

async function totalizar(c, medId) {
  await c.query(`UPDATE medicoes SET valor_total = COALESCE((SELECT sum(valor) FROM medicao_enderecos WHERE medicao_id = $1), 0) WHERE id = $1`, [medId]);
}

module.exports = (app) => {
  const escritorio = requer(ESCRITORIO);

  app.get('/api/faturamento/contratos', escritorio, async () => db.many(
    `SELECT ct.id, ct.numero, ct.tipo, ct.status, ct.valor_camera, ct.valor_endereco, ct.regra_cobranca, cl.id AS cliente_id, cl.nome AS cliente,
            (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa,
            count(e.id)::int AS enderecos,
            count(e.id) FILTER (WHERE ${APTO})::int AS aptos,
            COALESCE(sum(${VALOR}) FILTER (WHERE ${APTO}), 0)::float AS valor_apto,
            COALESCE(sum(${VALOR}), 0)::float AS valor_total,
            count(e.id) FILTER (WHERE EXISTS (SELECT 1 FROM medicao_enderecos me WHERE me.endereco_id = e.id))::int AS medidos,
            ct.criado_em,
            (SELECT COALESCE(sum(valor_total),0)::float FROM medicoes m WHERE m.contrato_id = ct.id AND m.status IN ('aberta','enviada','aprovada')) AS em_andamento,
            (SELECT COALESCE(sum(valor_total),0)::float FROM medicoes m WHERE m.contrato_id = ct.id AND m.status IN ('nf_emitida','recebida')) AS faturado,
            (SELECT COALESCE(sum(valor_total),0)::float FROM medicoes m WHERE m.contrato_id = ct.id AND m.status = 'recebida') AS recebido
       FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id LEFT JOIN enderecos e ON e.contrato_id = ct.id
      WHERE ct.status <> 'encerrado' AND cl.ativo GROUP BY ct.id, cl.id ORDER BY cl.nome, ct.tipo DESC, ct.id`));

  app.get('/api/faturamento/contratos/:id', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const contrato = await db.one(`SELECT ct.*, cl.nome AS cliente, (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa
                                     FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id WHERE ct.id = $1`, [id]);
    if (!contrato) throw new HttpError(404, 'Contrato não encontrado');
    const [aptos, medicoes] = await Promise.all([
      db.many(`SELECT e.id, e.codigo, e.nome, e.municipio, e.uf, e.cameras, e.status, e.concluido_em, ${VALOR}::float AS valor
                 FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ct.id = $1 AND ${APTO} ORDER BY e.uf, e.municipio, e.nome`, [id]),
      db.many(`SELECT m.*, (SELECT count(*)::int FROM medicao_enderecos me WHERE me.medicao_id = m.id) AS enderecos,
                      (SELECT COALESCE(sum(cameras),0)::int FROM medicao_enderecos me WHERE me.medicao_id = m.id) AS cameras
                 FROM medicoes m WHERE m.contrato_id = $1 ORDER BY m.competencia DESC, m.id DESC`, [id]),
    ]);
    return { contrato, aptos, medicoes };
  });

  app.post('/api/faturamento/contratos/:id/medicoes', escritorio, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const comp = String(req.body.competencia || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp)) throw new HttpError(400, 'Competência inválida (use o mês, ex.: 2026-11)');
    const ids = Array.isArray(req.body.endereco_ids) ? req.body.endereco_ids.map((x) => v.id(x, 'Endereço')) : [];
    if (!ids.length) throw new HttpError(400, 'Selecione os endereços da medição');
    const aptos = (await c.query(
      `SELECT e.id, e.cameras, ${VALOR} AS valor FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
        WHERE ct.id = $1 AND e.id = ANY($2) AND ${APTO}`, [id, ids])).rows;
    if (aptos.length !== ids.length) throw new HttpError(400, 'Algum endereço não está mais apto (já medido ou fora da regra). Atualize a tela.');
    const m = (await c.query(`INSERT INTO medicoes (contrato_id, competencia, observacao) VALUES ($1, $2, $3) RETURNING id`,
      [id, `${comp}-01`, v.str(req.body.observacao, 'a observação', { max: 1000, opcional: true })])).rows[0];
    for (const a of aptos) await c.query(`INSERT INTO medicao_enderecos (medicao_id, endereco_id, cameras, valor) VALUES ($1,$2,$3,$4)`, [m.id, a.id, a.cameras, a.valor]);
    await totalizar(c, m.id);
    return m;
  }));

  app.get('/api/medicoes/:id', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const m = await db.one(`SELECT m.*, ct.numero AS contrato, ct.valor_camera, ct.valor_endereco, ct.regra_cobranca, cl.nome AS cliente,
                                   (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa
                              FROM medicoes m JOIN contratos ct ON ct.id = m.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id WHERE m.id = $1`, [id]);
    if (!m) throw new HttpError(404, 'Medição não encontrada');
    m.itens = await db.many(`SELECT me.endereco_id, me.cameras, me.valor::float AS valor, e.codigo, e.nome, e.municipio, e.uf, e.status
                               FROM medicao_enderecos me JOIN enderecos e ON e.id = me.endereco_id WHERE me.medicao_id = $1 ORDER BY e.uf, e.municipio, e.nome`, [id]);
    return m;
  });

  // Avança o fluxo: enviar → aprovar → nf (número e data) → receber; "reabrir" volta para aberta
  app.patch('/api/medicoes/:id', escritorio, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const m = (await c.query(`SELECT m.*, ct.regra_cobranca FROM medicoes m JOIN contratos ct ON ct.id = m.contrato_id WHERE m.id = $1`, [id])).rows[0];
    if (!m) throw new HttpError(404, 'Medição não encontrada');
    const acao = v.oneOf(req.body.acao, 'Ação', ['enviar', 'aprovar', 'nf', 'receber', 'reabrir', 'observacao']);
    const dia = v.date(req.body.data, 'A data') || new Date().toISOString().slice(0, 10);
    if (acao === 'observacao') {
      await c.query(`UPDATE medicoes SET observacao = $1 WHERE id = $2`, [v.str(req.body.observacao, 'a observação', { max: 1000, opcional: true }), id]);
      return { ok: true };
    }
    const alvo = { enviar: 'enviada', aprovar: 'aprovada', nf: 'nf_emitida', receber: 'recebida', reabrir: 'aberta' }[acao];
    if (acao !== 'reabrir' && FLUXO[m.status] !== alvo) throw new HttpError(400, 'Essa etapa não é a próxima desta medição');
    if (acao === 'reabrir' && !['enviada', 'aprovada'].includes(m.status)) throw new HttpError(400, 'Só dá para reabrir medição enviada ou aprovada');
    if (acao === 'enviar') await c.query(`UPDATE medicoes SET status = 'enviada', enviada_em = $1 WHERE id = $2`, [dia, id]);
    if (acao === 'aprovar') await c.query(`UPDATE medicoes SET status = 'aprovada', aprovada_em = $1 WHERE id = $2`, [dia, id]);
    if (acao === 'nf') {
      const nf = v.str(req.body.numero_nf, 'o número da nota fiscal', { max: 40 });
      await c.query(`UPDATE medicoes SET status = 'nf_emitida', numero_nf = $1, emitida_em = $2 WHERE id = $3`, [nf, dia, id]);
      // endereços que estavam em validação passam para Faturado
      await c.query(`UPDATE enderecos e SET status = 'Faturado', atualizado_em = now() FROM medicao_enderecos me
                      WHERE me.medicao_id = $1 AND me.endereco_id = e.id AND e.status = 'Em validação'`, [id]);
    }
    if (acao === 'receber') await c.query(`UPDATE medicoes SET status = 'recebida', recebida_em = $1 WHERE id = $2`, [dia, id]);
    if (acao === 'reabrir') await c.query(`UPDATE medicoes SET status = 'aberta', enviada_em = NULL, aprovada_em = NULL WHERE id = $1`, [id]);
    return { ok: true };
  }));

  app.delete('/api/medicoes/:id/enderecos/:end', escritorio, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const m = (await c.query(`SELECT status FROM medicoes WHERE id = $1`, [id])).rows[0];
    if (!m) throw new HttpError(404, 'Medição não encontrada');
    if (m.status !== 'aberta') throw new HttpError(400, 'Só dá para tirar endereços de medição aberta');
    await c.query(`DELETE FROM medicao_enderecos WHERE medicao_id = $1 AND endereco_id = $2`, [id, v.id(req.params.end, 'Endereço')]);
    await totalizar(c, id);
    return { ok: true };
  }));

  app.delete('/api/medicoes/:id', escritorio, async (req) => {
    const r = await db.query(`DELETE FROM medicoes WHERE id = $1 AND status = 'aberta'`, [v.id(req.params.id)]);
    if (!r.rowCount) throw new HttpError(400, 'Só dá para excluir medição aberta');
    return { ok: true };
  });
};
