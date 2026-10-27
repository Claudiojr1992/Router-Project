// Patrimônio: cada equipamento controlado (patrimônio / número de série), onde está e em que situação.
// O vínculo com o endereço alimenta o faturamento quando o contrato exige patrimônio.
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer } = require('../auth');

const STATUS = ['estoque', 'em_transporte', 'instalado', 'manutencao', 'baixado'];
const txt = (x, max = 120) => { const s = String(x ?? '').trim(); return s ? s.slice(0, max) : null; };

function corpo(b) {
  const a = {
    patrimonio: txt(b.patrimonio, 60), numero_serie: txt(b.numero_serie, 80), fabricante: txt(b.fabricante, 80), modelo: txt(b.modelo, 80),
    mac: txt(b.mac, 40), ip: txt(b.ip, 60), observacao: txt(b.observacao, 500),
    status: v.oneOf(b.status || 'estoque', 'Situação', STATUS),
    item_id: b.item_id ? v.id(b.item_id, 'Item') : null,
    endereco_id: b.endereco_id ? v.id(b.endereco_id, 'Endereço') : null,
    instalado_em: v.date(b.instalado_em, 'A data de instalação'),
    garantia_ate: v.date(b.garantia_ate, 'A garantia'),
  };
  if (!a.patrimonio && !a.numero_serie) throw new HttpError(400, 'Informe o patrimônio ou o número de série');
  if (a.status === 'instalado' && !a.endereco_id) throw new HttpError(400, 'Ativo instalado precisa de um endereço');
  if (a.status === 'instalado' && !a.instalado_em) a.instalado_em = new Date().toISOString().slice(0, 10);
  return a;
}

// item e endereço precisam ser do mesmo contrato do ativo
async function conferir(c, contrato, a) {
  if (a.item_id && !(await c.query(`SELECT 1 FROM contrato_itens WHERE id = $1 AND contrato_id = $2`, [a.item_id, contrato])).rows.length) throw new HttpError(400, 'O item não é deste contrato');
  if (a.endereco_id && !(await c.query(`SELECT 1 FROM enderecos WHERE id = $1 AND contrato_id = $2`, [a.endereco_id, contrato])).rows.length) throw new HttpError(400, 'O endereço não é deste contrato');
}

const LISTA = `SELECT a.*, ci.nome AS item, e.nome AS endereco, e.codigo AS endereco_codigo, e.municipio, e.uf, ct.numero AS contrato, cl.id AS cliente_id, cl.nome AS cliente
  FROM ativos a JOIN contratos ct ON ct.id = a.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
  LEFT JOIN contrato_itens ci ON ci.id = a.item_id LEFT JOIN enderecos e ON e.id = a.endereco_id`;

module.exports = (app) => {
  const logado = requer();

  // Filtros: contrato, endereco, status, item, q (patrimônio, série, modelo, endereço)
  app.get('/api/ativos', logado, async (req) => {
    const q = req.query, w = [], p = [];
    const add = (sql, val) => { p.push(val); w.push(sql.replace('?', `$${p.length}`)); };
    if (q.contrato) add('a.contrato_id = ?', v.id(q.contrato, 'Contrato'));
    if (q.endereco) add('a.endereco_id = ?', v.id(q.endereco, 'Endereço'));
    if (q.status) add('a.status = ?', v.oneOf(q.status, 'Situação', STATUS));
    if (q.item) add('a.item_id = ?', v.id(q.item, 'Item'));
    if (q.q) add(`(COALESCE(a.patrimonio,'') || ' ' || COALESCE(a.numero_serie,'') || ' ' || COALESCE(a.modelo,'') || ' ' || COALESCE(a.fabricante,'') || ' ' || COALESCE(e.nome,'') || ' ' || COALESCE(e.codigo,'')) ILIKE ?`,
      '%' + String(q.q).slice(0, 80).replace(/[%_\\]/g, (c) => '\\' + c) + '%');
    return db.many(`${LISTA} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.atualizado_em DESC, a.id DESC LIMIT 2000`, p);
  });

  // Resumo do contrato: por item controlado, quanto precisa (quantidades dos endereços) e quanto já tem patrimônio
  app.get('/api/ativos/resumo', logado, async (req) => {
    const ct = v.id(req.query.contrato, 'Contrato');
    const itens = await db.many(
      `SELECT ci.id, ci.nome, ci.controla_patrimonio,
              COALESCE((SELECT sum(ei.quantidade) FROM endereco_itens ei WHERE ei.item_id = ci.id),0)::int AS previsto,
              (SELECT count(*)::int FROM ativos a WHERE a.item_id = ci.id) AS cadastrados,
              (SELECT count(*)::int FROM ativos a WHERE a.item_id = ci.id AND a.status = 'instalado') AS instalados
         FROM contrato_itens ci WHERE ci.contrato_id = $1 ORDER BY ci.ordem, ci.id`, [ct]);
    const status = await db.many(`SELECT status, count(*)::int AS n FROM ativos WHERE contrato_id = $1 GROUP BY status`, [ct]);
    return { itens, status: Object.fromEntries(status.map((s) => [s.status, s.n])) };
  });

  // Contratos (para escolher na tela) e, de um contrato, os itens e endereços para os campos
  app.get('/api/ativos/contratos', logado, async () => db.many(
    `SELECT ct.id, ct.numero, ct.tipo, cl.id AS cliente_id, cl.nome AS cliente, ct.exige_patrimonio,
            (SELECT count(*)::int FROM ativos a WHERE a.contrato_id = ct.id) AS ativos
       FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id WHERE ct.status <> 'encerrado' AND cl.ativo ORDER BY cl.nome, ct.tipo DESC, ct.id`));
  app.get('/api/ativos/opcoes', logado, async (req) => {
    const ct = v.id(req.query.contrato, 'Contrato');
    const [itens, enderecos] = await Promise.all([
      db.many(`SELECT id, nome, controla_patrimonio FROM contrato_itens WHERE contrato_id = $1 ORDER BY ordem, id`, [ct]),
      db.many(`SELECT id, codigo, nome, municipio, uf FROM enderecos WHERE contrato_id = $1 ORDER BY nome`, [ct]),
    ]);
    return { itens, enderecos };
  });

  app.get('/api/enderecos/:id/ativos', logado, async (req) => db.many(`${LISTA} WHERE a.endereco_id = $1 ORDER BY ci.ordem NULLS LAST, a.patrimonio, a.numero_serie`, [v.id(req.params.id)]));

  app.post('/api/ativos', logado, async (req) => db.tx(async (c) => {
    const ct = v.id(req.body.contrato_id, 'Contrato');
    const a = corpo(req.body);
    await conferir(c, ct, a);
    return (await c.query(
      `INSERT INTO ativos (contrato_id, item_id, endereco_id, patrimonio, numero_serie, fabricante, modelo, mac, ip, status, instalado_em, garantia_ate, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [ct, a.item_id, a.endereco_id, a.patrimonio, a.numero_serie, a.fabricante, a.modelo, a.mac, a.ip, a.status, a.instalado_em, a.garantia_ate, a.observacao])).rows[0];
  }));

  app.put('/api/ativos/:id', logado, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const atual = (await c.query(`SELECT contrato_id FROM ativos WHERE id = $1`, [id])).rows[0];
    if (!atual) throw new HttpError(404, 'Ativo não encontrado');
    const a = corpo(req.body);
    await conferir(c, atual.contrato_id, a);
    return (await c.query(
      `UPDATE ativos SET item_id=$1, endereco_id=$2, patrimonio=$3, numero_serie=$4, fabricante=$5, modelo=$6, mac=$7, ip=$8, status=$9,
              instalado_em=$10, garantia_ate=$11, observacao=$12, atualizado_em=now() WHERE id=$13 RETURNING *`,
      [a.item_id, a.endereco_id, a.patrimonio, a.numero_serie, a.fabricante, a.modelo, a.mac, a.ip, a.status, a.instalado_em, a.garantia_ate, a.observacao, id])).rows[0];
  }));

  app.delete('/api/ativos/:id', logado, async (req) => {
    const r = await db.query(`DELETE FROM ativos WHERE id = $1`, [v.id(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Ativo não encontrado');
    return { ok: true };
  });

  // Vários de uma vez: mudar situação e/ou endereço (ex.: "instalar estes 12 no endereço X", "baixar estes 3")
  app.post('/api/ativos/mover', logado, async (req) => db.tx(async (c) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => v.id(x, 'Ativo')) : [];
    if (!ids.length || ids.length > 2000) throw new HttpError(400, 'Selecione os ativos');
    const status = v.oneOf(req.body.status, 'Situação', STATUS);
    const end = req.body.endereco_id ? v.id(req.body.endereco_id, 'Endereço') : null;
    if (status === 'instalado' && !end) throw new HttpError(400, 'Escolha o endereço onde os ativos foram instalados');
    const cts = (await c.query(`SELECT DISTINCT contrato_id FROM ativos WHERE id = ANY($1)`, [ids])).rows;
    if (cts.length !== 1) throw new HttpError(400, 'Mova ativos de um contrato por vez');
    if (end && !(await c.query(`SELECT 1 FROM enderecos WHERE id = $1 AND contrato_id = $2`, [end, cts[0].contrato_id])).rows.length) throw new HttpError(400, 'O endereço não é deste contrato');
    const r = await c.query(
      `UPDATE ativos SET status = $1, endereco_id = CASE WHEN $1 IN ('estoque','baixado') AND $2::bigint IS NULL THEN NULL ELSE COALESCE($2, endereco_id) END,
              instalado_em = CASE WHEN $1 = 'instalado' THEN COALESCE(instalado_em, CURRENT_DATE) ELSE instalado_em END, atualizado_em = now()
        WHERE id = ANY($3)`, [status, end, ids]);
    return { alterados: r.rowCount };
  }));

  // Importação da planilha: patrimônio, série, item, fabricante, modelo, MAC, IP, endereço (código ou nome), situação
  app.post('/api/ativos/lote', { limit: 4 * 1024 * 1024 }, logado, async (req) => db.tx(async (c) => {
    const ct = v.id(req.body.contrato_id, 'Contrato');
    const linhas = Array.isArray(req.body.linhas) ? req.body.linhas : [];
    if (!linhas.length || linhas.length > 5000) throw new HttpError(400, 'Planilha vazia ou grande demais (até 5.000 linhas)');
    const itens = (await c.query(`SELECT id, lower(nome) AS k FROM contrato_itens WHERE contrato_id = $1`, [ct])).rows;
    const ends = (await c.query(`SELECT id, lower(COALESCE(codigo,'')) AS cod, lower(nome) AS nome FROM enderecos WHERE contrato_id = $1`, [ct])).rows;
    const NST = { estoque: 'estoque', 'em estoque': 'estoque', transporte: 'em_transporte', 'em transporte': 'em_transporte', instalado: 'instalado', manutencao: 'manutencao', 'manutenção': 'manutencao', baixado: 'baixado', baixa: 'baixado' };
    let novos = 0, atualizados = 0; const erros = [];
    for (const [i, l] of linhas.entries()) {
      await c.query('SAVEPOINT linha'); // uma linha com erro não derruba as outras
      try {
        const ki = String(l.item || '').trim().toLowerCase();
        const item = ki ? itens.find((x) => x.k === ki) : null;
        if (ki && !item) throw new Error(`item "${l.item}" não existe no contrato`);
        const ke = String(l.endereco || '').trim().toLowerCase();
        const end = ke ? ends.find((x) => (x.cod && x.cod === ke) || x.nome === ke) : null;
        if (ke && !end) throw new Error(`endereço "${l.endereco}" não encontrado no contrato`);
        const st = NST[String(l.status || '').trim().toLowerCase()] || (end ? 'instalado' : 'estoque');
        const a = corpo({ ...l, status: st, item_id: item && item.id, endereco_id: end && end.id });
        const ja = (await c.query(`SELECT id, contrato_id FROM ativos WHERE ($1::text IS NOT NULL AND lower(patrimonio) = lower($1)) OR ($2::text IS NOT NULL AND lower(numero_serie) = lower($2)) LIMIT 1`, [a.patrimonio, a.numero_serie])).rows[0];
        if (ja && ja.contrato_id !== ct) throw new Error('patrimônio/série já cadastrado em outro contrato');
        if (ja) {
          await c.query(`UPDATE ativos SET item_id=COALESCE($1,item_id), endereco_id=$2, patrimonio=COALESCE($3,patrimonio), numero_serie=COALESCE($4,numero_serie), fabricante=COALESCE($5,fabricante),
                           modelo=COALESCE($6,modelo), mac=COALESCE($7,mac), ip=COALESCE($8,ip), status=$9, instalado_em=COALESCE(instalado_em,$10), atualizado_em=now() WHERE id=$11`,
            [a.item_id, a.endereco_id, a.patrimonio, a.numero_serie, a.fabricante, a.modelo, a.mac, a.ip, a.status, a.instalado_em, ja.id]);
          atualizados++;
        } else {
          await c.query(`INSERT INTO ativos (contrato_id, item_id, endereco_id, patrimonio, numero_serie, fabricante, modelo, mac, ip, status, instalado_em)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [ct, a.item_id, a.endereco_id, a.patrimonio, a.numero_serie, a.fabricante, a.modelo, a.mac, a.ip, a.status, a.instalado_em]);
          novos++;
        }
        await c.query('RELEASE SAVEPOINT linha');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT linha');
        erros.push(`Linha ${i + 2}: ${e.code === '23505' ? 'patrimônio ou série repetido' : e.message}`); if (erros.length > 50) break;
      }
    }
    if (erros.length && !novos && !atualizados) throw new HttpError(400, erros.slice(0, 8).join(' · '));
    return { novos, atualizados, erros };
  }));
};
