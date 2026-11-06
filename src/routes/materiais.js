// Controle de material: catálogo, saldo em estoque, entradas/ajustes e aplicação em campo (endereço e atividade).
// Rastreabilidade: cada aplicação guarda lote, quantidade, técnico, data, local (GPS) e a atividade em que o material foi usado.
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, pode } = require('../auth');

const TIPOS = ['entrada', 'aplicacao', 'devolucao', 'ajuste'];
const UNIDADES = ['un', 'm', 'cx', 'pc', 'kg', 'l', 'rolo', 'par', 'kit', 'jg'];
const txt = (x, max = 120) => { const s = String(x ?? '').trim(); return s ? s.slice(0, max) : null; };
const like = (s) => '%' + String(s).slice(0, 80).replace(/[%_\\]/g, (c) => '\\' + c) + '%';
// sinal do movimento no saldo
const SALDO = `CASE m.tipo WHEN 'aplicacao' THEN -m.quantidade ELSE m.quantidade END`;

function corpoMaterial(b) {
  return {
    codigo: txt(b.codigo, 40),
    nome: v.str(b.nome, 'o nome do material', { max: 160 }),
    unidade: v.oneOf(b.unidade || 'un', 'Unidade', UNIDADES),
    categoria: txt(b.categoria, 60),
    fabricante: txt(b.fabricante, 80),
    estoque_minimo: v.num(b.estoque_minimo ?? 0, 'O estoque mínimo', { min: 0, max: 1e9 }) || 0,
    ativo: b.ativo !== false,
    observacao: txt(b.observacao, 500),
  };
}

const LISTA_MOV = `SELECT m.id, m.material_id, mt.nome AS material, mt.codigo AS material_codigo, mt.unidade, m.tipo, m.quantidade, m.lote, m.documento, m.fornecedor,
    m.endereco_id, e.nome AS endereco, e.codigo AS endereco_codigo, e.municipio, e.uf, ct.id AS contrato_id, ct.numero AS contrato, cl.id AS cliente_id, cl.nome AS cliente,
    m.tarefa_id, a.nome AS atividade, m.pessoa_id, p.nome AS pessoa, m.usuario_id, u.nome AS usuario, m.lat, m.lon, m.observacao, m.criado_em
  FROM material_movimentos m JOIN materiais mt ON mt.id = m.material_id
  LEFT JOIN enderecos e ON e.id = m.endereco_id LEFT JOIN contratos ct ON ct.id = e.contrato_id LEFT JOIN clientes cl ON cl.id = ct.cliente_id
  LEFT JOIN tarefas t ON t.id = m.tarefa_id LEFT JOIN atividades a ON a.id = t.atividade_id
  LEFT JOIN pessoas p ON p.id = m.pessoa_id LEFT JOIN usuarios u ON u.id = m.usuario_id`;

// Registra a aplicação de material numa atividade (usada pelo app e pela Execução)
async function aplicar(c, user, { tarefa_id, material_id, quantidade, lote, observacao, lat, lon, cliente_uuid }) {
  const t = (await c.query(`SELECT t.id, t.endereco_id, t.responsavel_id FROM tarefas t WHERE t.id = $1`, [tarefa_id])).rows[0];
  if (!t) throw new HttpError(404, 'Atividade não encontrada');
  const mt = (await c.query(`SELECT id, nome, unidade, ativo FROM materiais WHERE id = $1`, [material_id])).rows[0];
  if (!mt) throw new HttpError(404, 'Material não encontrado');
  if (!mt.ativo) throw new HttpError(400, `O material "${mt.nome}" está inativo`);
  const q = v.num(quantidade, 'A quantidade', { min: 0.001, max: 1e7 });
  const r = await c.query(
    `INSERT INTO material_movimentos (material_id, tipo, quantidade, lote, endereco_id, tarefa_id, pessoa_id, usuario_id, lat, lon, observacao, cliente_uuid)
     VALUES ($1,'aplicacao',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (cliente_uuid) DO NOTHING RETURNING id`,
    [mt.id, q, txt(lote, 80), t.endereco_id, t.id, user.pessoa_id || t.responsavel_id || null, user.id,
      v.num(lat, 'Latitude', { min: -90, max: 90, opcional: true }), v.num(lon, 'Longitude', { min: -180, max: 180, opcional: true }), txt(observacao, 300), cliente_uuid || null]);
  if (r.rows.length) {
    await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,'comentario',$3)`,
      [t.id, user.id, `Material aplicado: ${String(q).replace('.', ',')} ${mt.unidade} de ${mt.nome}${lote ? ' · lote ' + txt(lote, 80) : ''}`]);
  }
  return r.rows[0] || null;
}

// Remove uma aplicação: quem registrou (enquanto a atividade não foi concluída) ou o escritório
async function removerAplicacao(c, user, where, param) {
  const m = (await c.query(`SELECT m.id, m.usuario_id, m.tarefa_id, m.quantidade, mt.nome, mt.unidade, t.status FROM material_movimentos m JOIN materiais mt ON mt.id = m.material_id
                              LEFT JOIN tarefas t ON t.id = m.tarefa_id WHERE ${where} AND m.tipo = 'aplicacao'`, [param])).rows[0];
  if (!m) return null;
  const escritorio = pode(user, 'materiais', 'editar');
  if (!escritorio && (String(m.usuario_id) !== String(user.id) || m.status === 'concluida')) throw new HttpError(403, 'Só quem registrou pode remover, enquanto a atividade não for concluída');
  await c.query(`DELETE FROM material_movimentos WHERE id = $1`, [m.id]);
  if (m.tarefa_id) await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,'comentario',$3)`,
    [m.tarefa_id, user.id, `Material removido: ${String(m.quantidade).replace('.', ',')} ${m.unidade} de ${m.nome}`]);
  return m;
}

module.exports = (app) => {
  const logado = requer();

  // Catálogo com saldo, total aplicado e último movimento
  app.get('/api/materiais', logado, async (req) => db.many(
    `SELECT mt.*, COALESCE(s.saldo, 0) AS saldo, COALESCE(s.aplicado, 0) AS aplicado, COALESCE(s.entradas, 0) AS entradas, s.ultimo,
            (COALESCE(s.saldo, 0) < mt.estoque_minimo) AS abaixo_minimo
       FROM materiais mt LEFT JOIN (
         SELECT m.material_id, sum(${SALDO}) AS saldo, sum(m.quantidade) FILTER (WHERE m.tipo = 'aplicacao') AS aplicado,
                sum(m.quantidade) FILTER (WHERE m.tipo = 'entrada') AS entradas, max(m.criado_em) AS ultimo
           FROM material_movimentos m GROUP BY m.material_id) s ON s.material_id = mt.id
      ${req.query.todos ? '' : 'WHERE mt.ativo'} ORDER BY mt.nome`));

  app.post('/api/materiais', logado, async (req) => {
    const m = corpoMaterial(req.body);
    return db.one(`INSERT INTO materiais (codigo, nome, unidade, categoria, fabricante, estoque_minimo, ativo, observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [m.codigo, m.nome, m.unidade, m.categoria, m.fabricante, m.estoque_minimo, m.ativo, m.observacao]);
  });

  app.put('/api/materiais/:id', logado, async (req) => {
    const m = corpoMaterial(req.body);
    const r = await db.one(`UPDATE materiais SET codigo=$1, nome=$2, unidade=$3, categoria=$4, fabricante=$5, estoque_minimo=$6, ativo=$7, observacao=$8 WHERE id=$9 RETURNING *`,
      [m.codigo, m.nome, m.unidade, m.categoria, m.fabricante, m.estoque_minimo, m.ativo, m.observacao, v.id(req.params.id)]);
    if (!r) throw new HttpError(404, 'Material não encontrado');
    return r;
  });

  // Excluir só sem movimentos (com histórico, o material é inativado para manter a rastreabilidade)
  app.delete('/api/materiais/:id', logado, async (req) => {
    const id = v.id(req.params.id);
    const usado = await db.one(`SELECT count(*)::int AS n FROM material_movimentos WHERE material_id = $1`, [id]);
    if (usado.n) { await db.query(`UPDATE materiais SET ativo = false WHERE id = $1`, [id]); return { ok: true, inativado: true }; }
    await db.query(`DELETE FROM materiais WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Movimentos — filtros: material, endereco, cliente, contrato, tipo, pessoa, q (lote, documento, fornecedor, endereço, atividade), de, ate
  app.get('/api/materiais/movimentos', logado, async (req) => {
    const q = req.query, w = [], p = [];
    const add = (sql, val) => { p.push(val); w.push(sql.replace(/\?/g, `$${p.length}`)); };
    if (q.material) add('m.material_id = ?', v.id(q.material, 'Material'));
    if (q.endereco) add('m.endereco_id = ?', v.id(q.endereco, 'Endereço'));
    if (q.tarefa) add('m.tarefa_id = ?', v.id(q.tarefa, 'Atividade'));
    if (q.contrato) add('ct.id = ?', v.id(q.contrato, 'Contrato'));
    if (q.cliente) add('cl.id = ?', v.id(q.cliente, 'Projeto'));
    if (q.pessoa) add('m.pessoa_id = ?', v.id(q.pessoa, 'Pessoa'));
    if (q.tipo) add('m.tipo = ?', v.oneOf(q.tipo, 'Tipo', TIPOS));
    if (q.de) add('m.criado_em >= ?::date', v.date(q.de, 'A data inicial'));
    if (q.ate) add(`m.criado_em < (?::date + 1)`, v.date(q.ate, 'A data final'));
    if (q.q) add(`(COALESCE(m.lote,'') || ' ' || COALESCE(m.documento,'') || ' ' || COALESCE(m.fornecedor,'') || ' ' || COALESCE(e.nome,'') || ' ' || COALESCE(e.codigo,'') || ' ' || COALESCE(a.nome,'') || ' ' || mt.nome) ILIKE ?`, like(q.q));
    return db.many(`${LISTA_MOV} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.criado_em DESC, m.id DESC LIMIT 3000`, p);
  });

  // Entrada, devolução, ajuste (escritório) ou aplicação numa atividade
  app.post('/api/materiais/movimentos', logado, async (req) => db.tx(async (c) => {
    const b = req.body;
    const tipo = v.oneOf(b.tipo, 'Tipo', TIPOS);
    const material = v.id(b.material_id, 'Material');
    if (tipo === 'aplicacao') return aplicar(c, req.user, { ...b, tarefa_id: v.id(b.tarefa_id, 'Atividade'), material_id: material });
    if (!pode(req.user, 'materiais', 'editar')) throw new HttpError(403, 'Seu perfil não pode lançar entradas e ajustes de material');
    const q = v.num(b.quantidade, 'A quantidade', { min: tipo === 'ajuste' ? -1e7 : 0.001, max: 1e7 });
    if (!q) throw new HttpError(400, 'Informe a quantidade');
    const r = (await c.query(
      `INSERT INTO material_movimentos (material_id, tipo, quantidade, lote, documento, fornecedor, endereco_id, usuario_id, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [material, tipo, q, txt(b.lote, 80), txt(b.documento, 80), txt(b.fornecedor, 120), b.endereco_id ? v.id(b.endereco_id, 'Endereço') : null, req.user.id, txt(b.observacao, 300)])).rows[0];
    return r;
  }));

  app.delete('/api/materiais/movimentos/:id', logado, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const m = (await c.query(`SELECT tipo FROM material_movimentos WHERE id = $1`, [id])).rows[0];
    if (!m) throw new HttpError(404, 'Movimento não encontrado');
    if (m.tipo === 'aplicacao') { await removerAplicacao(c, req.user, 'm.id = $1', id); return { ok: true }; }
    if (!pode(req.user, 'materiais', 'editar')) throw new HttpError(403, 'Seu perfil não pode excluir movimentos');
    await c.query(`DELETE FROM material_movimentos WHERE id = $1`, [id]);
    return { ok: true };
  }));

  // Rastreabilidade de um lote (ou de um material): onde foi aplicado, quando e por quem
  app.get('/api/materiais/rastreio', logado, async (req) => {
    const lote = txt(req.query.lote, 80), mat = req.query.material ? v.id(req.query.material, 'Material') : null;
    if (!lote && !mat) throw new HttpError(400, 'Informe o lote ou o material');
    const w = [], p = [];
    if (lote) { p.push(lote); w.push(`lower(m.lote) = lower($${p.length})`); }
    if (mat) { p.push(mat); w.push(`m.material_id = $${p.length}`); }
    const movs = await db.many(`${LISTA_MOV} WHERE ${w.join(' AND ')} ORDER BY m.criado_em`, p);
    const entradas = movs.filter((m) => m.tipo === 'entrada');
    const aplic = movs.filter((m) => m.tipo === 'aplicacao');
    return {
      lote, movimentos: movs,
      resumo: {
        entradas: entradas.reduce((s, m) => s + +m.quantidade, 0), aplicado: aplic.reduce((s, m) => s + +m.quantidade, 0),
        enderecos: new Set(aplic.map((m) => m.endereco_id)).size, projetos: new Set(aplic.map((m) => m.cliente_id)).size,
      },
    };
  });

  // Material aplicado num endereço (Execução, relatório)
  app.get('/api/enderecos/:id/materiais', logado, async (req) => db.many(`${LISTA_MOV} WHERE m.endereco_id = $1 AND m.tipo = 'aplicacao' ORDER BY m.criado_em`, [v.id(req.params.id)]));
};

module.exports.aplicar = aplicar;
module.exports.removerAplicacao = removerAplicacao;
