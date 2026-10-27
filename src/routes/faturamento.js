// Faturamento: medição mensal por contrato. Valor do endereço = itens faturáveis do contrato × quantidades do endereço
// + taxa fixa por endereço. O detalhe por item é gravado na medição (medicao_itens).
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, ESCRITORIO } = require('../auth');

// Item controlado com menos ativos instalados no endereço do que a quantidade prevista
const FALTA_PATRIMONIO = `SELECT 1 FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id
   WHERE ei.endereco_id = e.id AND ci.controla_patrimonio AND ei.quantidade >
     (SELECT count(*) FROM ativos a WHERE a.endereco_id = e.id AND a.item_id = ci.id AND a.status = 'instalado')`;
// Endereço apto: passou da etapa exigida pela regra do contrato e ainda não está em nenhuma medição
const APTO = `(CASE ct.regra_cobranca
    WHEN 'apos_handover' THEN e.status IN ('Handover','Concluída') OR e.concluido_em IS NOT NULL
    ELSE e.status IN ('Em validação','Faturado','Handover','Concluída') OR e.concluido_em IS NOT NULL END)
  AND NOT EXISTS (SELECT 1 FROM medicao_enderecos me WHERE me.endereco_id = e.id)
  AND (NOT ct.exige_patrimonio OR NOT EXISTS (${FALTA_PATRIMONIO}))`;
const VALOR = `(COALESCE(ct.valor_endereco,0) + COALESCE((SELECT sum(ei.quantidade * ci.valor_unitario) FROM endereco_itens ei
    JOIN contrato_itens ci ON ci.id = ei.item_id WHERE ei.endereco_id = e.id AND ci.faturavel AND ci.valor_unitario IS NOT NULL), 0))`;
// Itens faturáveis do endereço, para mostrar de onde vem o valor
const DETALHE = `COALESCE((SELECT json_agg(json_build_object('item', ci.nome, 'quantidade', ei.quantidade, 'valor_unitario', ci.valor_unitario,
    'total', ei.quantidade * ci.valor_unitario) ORDER BY ci.ordem, ci.id) FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id
   WHERE ei.endereco_id = e.id AND ci.faturavel AND ci.valor_unitario IS NOT NULL AND ei.quantidade > 0), '[]')`;
const FLUXO = { aberta: 'enviada', enviada: 'aprovada', aprovada: 'nf_emitida', nf_emitida: 'recebida' };

async function totalizar(c, medId) {
  await c.query(`UPDATE medicoes SET valor_total = COALESCE((SELECT sum(valor) FROM medicao_enderecos WHERE medicao_id = $1), 0) WHERE id = $1`, [medId]);
}

module.exports = (app) => {
  const escritorio = requer(ESCRITORIO);

  app.get('/api/faturamento/contratos', escritorio, async () => db.many(
    `SELECT ct.id, ct.numero, ct.tipo, ct.status, ct.valor_endereco, ct.regra_cobranca, ct.exige_patrimonio, cl.id AS cliente_id, cl.nome AS cliente,
            (SELECT count(*)::int FROM contrato_itens ci WHERE ci.contrato_id = ct.id AND ci.faturavel AND ci.valor_unitario IS NOT NULL) AS itens_preco,
            (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa,
            count(e.id)::int AS enderecos,
            count(e.id) FILTER (WHERE ${APTO})::int AS aptos,
            COALESCE(sum(${VALOR}) FILTER (WHERE ${APTO}), 0)::float AS valor_apto,
            COALESCE(sum(${VALOR}), 0)::float AS valor_total,
            count(e.id) FILTER (WHERE EXISTS (SELECT 1 FROM medicao_enderecos me WHERE me.endereco_id = e.id))::int AS medidos,
            count(e.id) FILTER (WHERE e.concluido_em IS NOT NULL)::int AS concluidos,
            COALESCE(sum(${VALOR}) FILTER (WHERE e.concluido_em IS NOT NULL), 0)::float AS valor_gerado,
            ct.criado_em,
            (SELECT COALESCE(sum(valor_total),0)::float FROM medicoes m WHERE m.contrato_id = ct.id AND m.status IN ('aberta','enviada','aprovada')) AS em_andamento,
            (SELECT COALESCE(sum(valor_total),0)::float FROM medicoes m WHERE m.contrato_id = ct.id AND m.status IN ('nf_emitida','recebida')) AS faturado,
            (SELECT COALESCE(sum(valor_total),0)::float FROM medicoes m WHERE m.contrato_id = ct.id AND m.status = 'recebida') AS recebido
       FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id LEFT JOIN enderecos e ON e.contrato_id = ct.id
      WHERE ct.status <> 'encerrado' AND cl.ativo GROUP BY ct.id, cl.id ORDER BY cl.nome, ct.tipo DESC, ct.id`));

  // Previsão de receita por mês: o que já foi gerado (endereços concluídos), o que está previsto pelo plano
  // (fim ou início previsto × preços) e o que foi medido e recebido. 6 meses para trás e 12 para a frente.
  app.get('/api/faturamento/previsao', escritorio, async (req) => {
    const ct = req.query.contrato ? v.id(req.query.contrato, 'Contrato') : null;
    const meses = await db.many(
      `WITH m AS (SELECT generate_series(date_trunc('month', CURRENT_DATE) - interval '6 months', date_trunc('month', CURRENT_DATE) + interval '11 months', interval '1 month')::date AS mes),
            e AS (SELECT e.*, ${VALOR} AS valor FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
                   WHERE ct.status <> 'encerrado' AND cl.ativo AND ($1::bigint IS NULL OR ct.id = $1))
       SELECT to_char(m.mes, 'YYYY-MM') AS mes,
              COALESCE((SELECT sum(valor) FROM e WHERE e.concluido_em IS NOT NULL AND date_trunc('month', e.concluido_em) = m.mes), 0)::float AS gerado,
              COALESCE((SELECT sum(valor) FROM e WHERE e.concluido_em IS NULL AND date_trunc('month', COALESCE(e.fim_previsto, e.inicio_previsto)) = m.mes), 0)::float AS previsto,
              COALESCE((SELECT count(*) FROM e WHERE e.concluido_em IS NULL AND date_trunc('month', COALESCE(e.fim_previsto, e.inicio_previsto)) = m.mes), 0)::int AS previstos,
              COALESCE((SELECT sum(md.valor_total) FROM medicoes md JOIN contratos ct ON ct.id = md.contrato_id WHERE ct.status <> 'encerrado' AND ($1::bigint IS NULL OR ct.id = $1) AND md.competencia = m.mes), 0)::float AS medido,
              COALESCE((SELECT sum(md.valor_total) FROM medicoes md JOIN contratos ct ON ct.id = md.contrato_id WHERE ct.status <> 'encerrado' AND ($1::bigint IS NULL OR ct.id = $1) AND md.status = 'recebida' AND date_trunc('month', md.recebida_em) = m.mes), 0)::float AS recebido
         FROM m ORDER BY m.mes`, [ct]);
    const fora = await db.one(
      `SELECT count(*)::int AS n, COALESCE(sum(${VALOR}),0)::float AS valor FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
        WHERE ct.status <> 'encerrado' AND ($1::bigint IS NULL OR ct.id = $1) AND e.concluido_em IS NULL
          AND (COALESCE(e.fim_previsto, e.inicio_previsto) IS NULL OR COALESCE(e.fim_previsto, e.inicio_previsto) < date_trunc('month', CURRENT_DATE))`, [ct]);
    return { meses, atual: new Date().toISOString().slice(0, 7), sem_data_ou_atrasado: fora };
  });

  app.get('/api/faturamento/contratos/:id', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const contrato = await db.one(`SELECT ct.*, cl.nome AS cliente, (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa
                                     FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id WHERE ct.id = $1`, [id]);
    if (!contrato) throw new HttpError(404, 'Contrato não encontrado');
    const [aptos, medicoes, itens, pendentes] = await Promise.all([
      db.many(`SELECT e.id, e.codigo, e.nome, e.municipio, e.uf, e.cameras, e.status, e.concluido_em, ${VALOR}::float AS valor, ${DETALHE} AS detalhe
                 FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ct.id = $1 AND ${APTO} ORDER BY e.uf, e.municipio, e.nome`, [id]),
      db.many(`SELECT m.*, (SELECT count(*)::int FROM medicao_enderecos me WHERE me.medicao_id = m.id) AS enderecos,
                      (SELECT COALESCE(sum(cameras),0)::int FROM medicao_enderecos me WHERE me.medicao_id = m.id) AS cameras
                 FROM medicoes m WHERE m.contrato_id = $1 ORDER BY m.competencia DESC, m.id DESC`, [id]),
      // tabela de preços do contrato com o previsto e o já instalado (endereços concluídos)
      db.many(`SELECT ci.id, ci.nome, ci.unidade, ci.faturavel, ci.valor_unitario::float AS valor_unitario, ci.controla_patrimonio,
                      COALESCE(sum(ei.quantidade),0)::int AS previsto,
                      COALESCE(sum(ei.quantidade) FILTER (WHERE e.concluido_em IS NOT NULL),0)::int AS concluido
                 FROM contrato_itens ci LEFT JOIN endereco_itens ei ON ei.item_id = ci.id LEFT JOIN enderecos e ON e.id = ei.endereco_id
                WHERE ci.contrato_id = $1 GROUP BY ci.id ORDER BY ci.ordem, ci.id`, [id]),
      // passaram da etapa de cobrança mas falta patrimônio (só quando o contrato exige)
      db.many(`SELECT e.id, e.nome, e.municipio, e.uf FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
                WHERE ct.id = $1 AND ct.exige_patrimonio AND EXISTS (${FALTA_PATRIMONIO})
                  AND NOT EXISTS (SELECT 1 FROM medicao_enderecos me WHERE me.endereco_id = e.id)
                  AND (e.concluido_em IS NOT NULL OR e.status IN ('Em validação','Faturado','Handover','Concluída')) ORDER BY e.nome LIMIT 200`, [id]),
    ]);
    return { contrato, aptos, medicoes, itens, pendentes_patrimonio: pendentes };
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
    await c.query(
      `INSERT INTO medicao_itens (medicao_id, endereco_id, item, quantidade, valor_unitario, total)
       SELECT $1::bigint, ei.endereco_id, ci.nome, ei.quantidade::numeric, ci.valor_unitario, ei.quantidade * ci.valor_unitario
         FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id
        WHERE ei.endereco_id = ANY($2::bigint[]) AND ci.faturavel AND ci.valor_unitario IS NOT NULL AND ei.quantidade > 0
       UNION ALL
       SELECT $1::bigint, e.id, 'Taxa por endereço', 1::numeric, ct.valor_endereco, ct.valor_endereco
         FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE e.id = ANY($2::bigint[]) AND COALESCE(ct.valor_endereco,0) > 0`, [m.id, ids]);
    await totalizar(c, m.id);
    return m;
  }));

  app.get('/api/medicoes/:id', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const m = await db.one(`SELECT m.*, ct.numero AS contrato, ct.valor_camera, ct.valor_endereco, ct.regra_cobranca, cl.nome AS cliente,
                                   (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa
                              FROM medicoes m JOIN contratos ct ON ct.id = m.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id WHERE m.id = $1`, [id]);
    if (!m) throw new HttpError(404, 'Medição não encontrada');
    m.itens = await db.many(`SELECT me.endereco_id, me.cameras, me.valor::float AS valor, e.codigo, e.nome, e.municipio, e.uf, e.status,
                                    COALESCE((SELECT json_agg(json_build_object('item', mi.item, 'quantidade', mi.quantidade::float, 'valor_unitario', mi.valor_unitario::float, 'total', mi.total::float) ORDER BY mi.id)
                                                FROM medicao_itens mi WHERE mi.medicao_id = me.medicao_id AND mi.endereco_id = me.endereco_id), '[]') AS detalhe
                               FROM medicao_enderecos me JOIN enderecos e ON e.id = me.endereco_id WHERE me.medicao_id = $1 ORDER BY e.uf, e.municipio, e.nome`, [id]);
    m.resumo = await db.many(`SELECT item, sum(quantidade)::float AS quantidade, valor_unitario::float AS valor_unitario, sum(total)::float AS total
                                FROM medicao_itens WHERE medicao_id = $1 GROUP BY item, valor_unitario ORDER BY min(id)`, [id]);
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
    const end = v.id(req.params.end, 'Endereço');
    await c.query(`DELETE FROM medicao_enderecos WHERE medicao_id = $1 AND endereco_id = $2`, [id, end]);
    await c.query(`DELETE FROM medicao_itens WHERE medicao_id = $1 AND endereco_id = $2`, [id, end]);
    await totalizar(c, id);
    return { ok: true };
  }));

  app.delete('/api/medicoes/:id', escritorio, async (req) => {
    const r = await db.query(`DELETE FROM medicoes WHERE id = $1 AND status = 'aberta'`, [v.id(req.params.id)]);
    if (!r.rowCount) throw new HttpError(400, 'Só dá para excluir medição aberta');
    return { ok: true };
  });
};

// usados também no cadastro (valor de cada endereço) e no patrimônio
module.exports.VALOR = VALOR;
module.exports.DETALHE = DETALHE;
module.exports.FALTA_PATRIMONIO = FALTA_PATRIMONIO;
