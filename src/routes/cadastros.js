// Clientes, contratos (com PDF), endereços, atividades e checklists
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, GESTAO, ESCRITORIO, INTERNOS } = require('../auth');
const { validarItens, garantirItem, salvarItensEndereco } = require('../itens');
const { aplicarEtapa, garantirEtapa, parseData, validarData, clienteDoContrato } = require('../etapas');
const { aplicarPlano, parseNaRota, ajustarEquipes, parseEquipe, parseDia, MAX_EQUIPES, carregarRegras, validarRegras, recalcularPrevisao } = require('../plano');

const UF = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

function clienteBody(b) {
  return [
    v.str(b.nome, 'o nome do cliente', { max: 120 }),
    v.str(b.razao_social, 'a razão social', { max: 200, opcional: true }),
    v.str(b.cnpj, 'o CNPJ', { max: 20, opcional: true }),
    v.str(b.segmento, 'o segmento', { max: 80, opcional: true }),
    v.str(b.contato_nome, 'o contato', { max: 120, opcional: true }),
    b.contato_email ? v.email(b.contato_email) : null,
    v.str(b.contato_fone, 'o telefone', { max: 30, opcional: true }),
    v.str(b.observacoes, 'as observações', { max: 2000, opcional: true }),
  ];
}

function contratoBody(b) {
  return [
    v.str(b.numero, 'o número do contrato', { max: 60 }),
    v.oneOf(b.tipo || 'principal', 'Tipo', ['principal', 'aditivo']),
    v.str(b.objeto, 'o objeto', { max: 500, opcional: true }),
    v.date(b.vigencia_inicio, 'A data de início'),
    v.date(b.vigencia_fim, 'A data de fim'),
    v.num(b.valor_camera, 'O valor por câmera', { min: 0, opcional: true }),
    v.num(b.valor_endereco, 'O valor por endereço', { min: 0, opcional: true }),
    v.oneOf(b.regra_cobranca || 'apos_validacao', 'Regra de cobrança', ['apos_validacao', 'apos_handover']),
    v.oneOf(b.status || 'ativo', 'Status', ['ativo', 'encerrado', 'suspenso']),
    b.empresa_id ? v.id(b.empresa_id, 'Empresa') : null,
  ];
}

function empresaBody(b) {
  return [
    v.str(b.nome, 'o nome da empresa', { min: 2, max: 120 }),
    v.str(b.cnpj, 'o CNPJ', { max: 20, opcional: true }),
    v.str(b.contato, 'o contato', { max: 120, opcional: true }),
    b.email ? v.email(b.email) : null,
    v.str(b.telefone, 'o telefone', { max: 30, opcional: true }),
  ];
}

// Sem coordenada e com logradouro/CEP: localiza pelo endereço logo depois de salvar (sem travar a resposta)
function localizarDepois(e) {
  if (e && e.lat == null && (e.logradouro || e.cep)) require('../geocodificar').geocodificarEndereco(e.id).catch(() => {});
  return e;
}

// Coordenadas: digitadas = "manual"; se o endereço mudou e a posição veio da localização automática, localiza de novo
async function ajustarGeo(c, r, antes) {
  if (r.lat != null && r.lon != null) {
    const mudouPos = !antes || +antes.lat !== +r.lat || +antes.lon !== +r.lon;
    const mudouEnd = antes && ['logradouro', 'cep', 'municipio', 'uf'].some((k) => (antes[k] || '') !== (r[k] || ''));
    if (mudouPos) await c.query(`UPDATE enderecos SET geo_fonte = 'manual' WHERE id = $1`, [r.id]);
    // o endereço mudou e as coordenadas ficaram iguais: a posição passa a seguir o endereço novo
    else if (mudouEnd) { await c.query(`UPDATE enderecos SET lat = NULL, lon = NULL, geo_fonte = NULL, geo_tentado_em = NULL WHERE id = $1`, [r.id]); r.lat = null; r.lon = null; }
  } else {
    await c.query(`UPDATE enderecos SET geo_fonte = NULL, geo_tentado_em = NULL WHERE id = $1`, [r.id]);
  }
}

function enderecoBody(b) {
  return [
    v.str(b.codigo, 'o código', { max: 40, opcional: true }),
    v.str(b.nome, 'o nome do endereço', { max: 160 }),
    v.str(b.logradouro, 'o logradouro', { max: 200, opcional: true }),
    v.str(b.bairro, 'o bairro', { max: 100, opcional: true }),
    v.str(b.cep, 'o CEP', { max: 10, opcional: true }),
    v.str(b.municipio, 'o município', { max: 100 }),
    v.oneOf(String(b.uf || '').toUpperCase(), 'UF', UF),
    v.num(b.lat, 'A latitude', { min: -90, max: 90, opcional: true }),
    v.num(b.lon, 'A longitude', { min: -180, max: 180, opcional: true }),
    v.int(b.cameras, 'O número de câmeras', { min: 0, max: 10000 }),
  ];
}

function atividadeBody(b) {
  const modo = v.oneOf(b.tempo_modo || 'fixo', 'Modo de tempo', ['fixo', 'por_camera', 'faixa']);
  let faixas = null;
  if (modo === 'faixa') {
    if (!Array.isArray(b.faixas) || !b.faixas.length || b.faixas.length > 10) throw new HttpError(400, 'Informe as faixas de tempo');
    faixas = b.faixas.map((f, i) => ({
      ate: f.ate === null || f.ate === '' || f.ate === undefined ? null : v.int(f.ate, `Faixa ${i + 1}`, { min: 1 }),
      dias: v.num(f.dias, `Dias da faixa ${i + 1}`, { min: 0, max: 60 }),
    }));
  }
  return [
    v.str(b.nome, 'o nome da atividade', { max: 120 }),
    v.str(b.curto, 'o nome curto', { max: 30, opcional: true }),
    v.str(b.etapa, 'a etapa', { max: 60, opcional: true }),
    v.str(b.funcao, 'a função', { max: 80, opcional: true }),
    modo,
    v.num(b.tempo_qtd ?? 0, 'O tempo', { min: 0, max: 1000 }),
    v.oneOf(b.tempo_unidade || 'dia', 'Unidade', ['hora', 'dia']),
    modo === 'por_camera' ? v.int(b.min_por_camera, 'Os minutos por câmera', { min: 1, max: 1440 }) : null,
    faixas ? JSON.stringify(faixas) : null,
    (b.tempo_impacto || (b.conta_rota === false ? 'nenhum' : 'soma')) !== 'nenhum',
    b.checklist_id ? v.id(b.checklist_id, 'Checklist') : null,
    v.str(b.evidencia, 'a evidência', { max: 300, opcional: true }),
    v.int(b.ordem ?? 0, 'A ordem', { min: 0, max: 1000 }),
    v.oneOf(b.tempo_impacto || (b.conta_rota === false ? 'nenhum' : 'soma'), 'Impacto no tempo', ['soma', 'paralelo', 'nenhum']),
    b.predecessora_id ? v.id(b.predecessora_id, 'Predecessora') : null,
  ];
}

// A predecessora precisa ser do mesmo contrato e não pode fechar um ciclo (A depende de B que depende de A)
async function conferirPredecessora(c, contratoId, atividadeId, predId) {
  if (!predId) return;
  if (atividadeId && predId === atividadeId) throw new HttpError(400, 'A atividade não pode depender dela mesma');
  const p = (await c.query(`SELECT id FROM atividades WHERE id = $1 AND contrato_id = $2 AND ativo`, [predId, contratoId])).rows[0];
  if (!p) throw new HttpError(400, 'A predecessora precisa ser uma atividade deste contrato');
  let atual = predId; const vistos = new Set();
  while (atual && !vistos.has(atual)) {
    if (atividadeId && atual === atividadeId) throw new HttpError(400, 'Essa predecessora cria um ciclo entre as atividades');
    vistos.add(atual);
    atual = (await c.query(`SELECT predecessora_id FROM atividades WHERE id = $1`, [atual])).rows[0]?.predecessora_id || null;
  }
}

// Copia as atividades padrão para um contrato (do contrato que mais tem atividades, ou a lista base) e cria as tarefas
async function copiarPadrao(c, contrato) {
  const origem = (await c.query(`SELECT contrato_id FROM atividades WHERE ativo AND contrato_id <> $1 GROUP BY contrato_id ORDER BY count(*) DESC, contrato_id LIMIT 1`, [contrato])).rows[0];
  if (origem) {
    await c.query(`INSERT INTO atividades (contrato_id, nome, curto, etapa, funcao, tempo_modo, tempo_qtd, tempo_unidade, min_por_camera, faixas, conta_rota, checklist_id, evidencia, ordem, tempo_impacto)
                   SELECT $1, nome, curto, etapa, funcao, tempo_modo, tempo_qtd, tempo_unidade, min_por_camera, faixas, conta_rota, checklist_id, evidencia, ordem, tempo_impacto
                     FROM atividades WHERE contrato_id = $2 AND ativo ORDER BY ordem`, [contrato, origem.contrato_id]);
    await c.query(`UPDATE atividades n SET predecessora_id = np.id
                     FROM atividades o JOIN atividades op ON op.id = o.predecessora_id
                     JOIN atividades np ON np.contrato_id = $1 AND np.nome = op.nome AND np.ativo
                    WHERE o.contrato_id = $2 AND o.ativo AND n.contrato_id = $1 AND n.nome = o.nome`, [contrato, origem.contrato_id]);
  } else {
    const base = [['Coordenação e contato', 'Coordenação', 'Planejamento', 'Coordenador', 'fixo', 1, 'dia', false],
      ['Infraestrutura e cabos', 'Infra', 'Campo', 'Técnico de campo', 'fixo', 1, 'dia', true],
      ['Instalação de equipamentos', 'Instalação', 'Campo', 'Técnico de campo', 'fixo', 2, 'dia', true],
      ['Configuração do servidor e licença', 'Servidor', 'Configuração', 'Analista de configuração', 'fixo', 4, 'hora', true],
      ['Validação das imagens', 'Validação', 'Validação', 'Técnico de campo', 'fixo', 2, 'hora', true],
      ['Relatório de entrega e handover', 'Handover', 'Entrega', 'Administrativo', 'fixo', 1, 'dia', false]];
    for (const [i, a] of base.entries()) {
      await c.query(`INSERT INTO atividades (contrato_id, nome, curto, etapa, funcao, tempo_modo, tempo_qtd, tempo_unidade, conta_rota, ordem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [contrato, ...a, i + 1]);
    }
  }
  await c.query(`INSERT INTO tarefas (endereco_id, atividade_id) SELECT e.id, a.id FROM enderecos e JOIN atividades a ON a.contrato_id = e.contrato_id
                 WHERE e.contrato_id = $1 AND a.ativo ON CONFLICT DO NOTHING`, [contrato]);
}

module.exports = (app) => {
  const leitura = requer(INTERNOS);
  const escrita = requer(ESCRITORIO);
  const gestao = requer(GESTAO);

  // ---------- Clientes ----------
  app.get('/api/clientes', leitura, async () => db.many(
    `SELECT c.id, c.nome, c.razao_social, c.cnpj, c.segmento, c.ativo,
            count(DISTINCT ct.id)::int AS contratos, count(e.id)::int AS enderecos, COALESCE(sum(e.cameras),0)::int AS cameras,
            count(e.id) FILTER (WHERE e.status = 'Concluída')::int AS concluidos
       FROM clientes c
       LEFT JOIN contratos ct ON ct.cliente_id = c.id
       LEFT JOIN enderecos e ON e.contrato_id = ct.id
      GROUP BY c.id ORDER BY c.nome`));

  app.post('/api/clientes', escrita, async (req) => db.one(
    `INSERT INTO clientes (nome, razao_social, cnpj, segmento, contato_nome, contato_email, contato_fone, observacoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, clienteBody(req.body)));

  app.get('/api/clientes/:id', leitura, async (req) => {
    const id = v.id(req.params.id);
    const cliente = await db.one(`SELECT * FROM clientes WHERE id = $1`, [id]);
    if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
    cliente.contratos = await db.many(
      `SELECT ct.*, count(e.id)::int AS enderecos, COALESCE(sum(e.cameras),0)::int AS cameras,
              (SELECT count(*)::int FROM contrato_arquivos a WHERE a.contrato_id = ct.id) AS arquivos,
              (SELECT nome FROM empresas em WHERE em.id = ct.empresa_id) AS empresa
         FROM contratos ct LEFT JOIN enderecos e ON e.contrato_id = ct.id
        WHERE ct.cliente_id = $1 GROUP BY ct.id ORDER BY ct.tipo DESC, ct.id`, [id]);
    return cliente;
  });

  app.put('/api/clientes/:id', escrita, async (req) => {
    const r = await db.one(
      `UPDATE clientes SET nome=$1, razao_social=$2, cnpj=$3, segmento=$4, contato_nome=$5, contato_email=$6, contato_fone=$7, observacoes=$8
        WHERE id = $9 RETURNING *`, [...clienteBody(req.body), v.id(req.params.id)]);
    if (!r) throw new HttpError(404, 'Cliente não encontrado');
    return r;
  });

  // ---------- Empresas (executora ou parceira do contrato) ----------
  app.get('/api/empresas', leitura, async () => db.many(
    `SELECT em.*, (SELECT count(*)::int FROM contratos ct WHERE ct.empresa_id = em.id) AS contratos FROM empresas em ORDER BY em.ativo DESC, em.nome`));
  app.post('/api/empresas', escrita, async (req) => db.one(
    `INSERT INTO empresas (nome, cnpj, contato, email, telefone) VALUES ($1,$2,$3,$4,$5) RETURNING *`, empresaBody(req.body)));
  app.put('/api/empresas/:id', escrita, async (req) => {
    const r = await db.one(`UPDATE empresas SET nome=$1, cnpj=$2, contato=$3, email=$4, telefone=$5, ativo=$6 WHERE id = $7 RETURNING *`,
      [...empresaBody(req.body), req.body.ativo !== false, v.id(req.params.id)]);
    if (!r) throw new HttpError(404, 'Empresa não encontrada');
    return r;
  });

  // ---------- Contratos ----------
  app.post('/api/clientes/:id/contratos', escrita, async (req) => db.tx(async (c) => {
    const ct = (await c.query(
      `INSERT INTO contratos (cliente_id, numero, tipo, objeto, vigencia_inicio, vigencia_fim, valor_camera, valor_endereco, regra_cobranca, status, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [v.id(req.params.id), ...contratoBody(req.body)])).rows[0];
    const itens = validarItens(req.body.itens) || [];
    for (const it of itens) await garantirItem(c, ct.id, it.nome);
    if (req.body.atividades_padrao !== false) await copiarPadrao(c, ct.id); // um passo a menos: já nasce com as atividades
    return ct;
  }));

  app.put('/api/contratos/:id', escrita, async (req) => {
    const r = await db.one(
      `UPDATE contratos SET numero=$1, tipo=$2, objeto=$3, vigencia_inicio=$4, vigencia_fim=$5, valor_camera=$6, valor_endereco=$7,
              regra_cobranca=$8, status=$9, empresa_id=$10 WHERE id = $11 RETURNING *`, [...contratoBody(req.body), v.id(req.params.id)]);
    if (!r) throw new HttpError(404, 'Contrato não encontrado');
    return r;
  });

  // PDF do contrato: enviado em base64 dentro do JSON (até 10 MB)
  app.post('/api/contratos/:id/arquivos', { limit: 15 * 1024 * 1024 }, escrita, async (req) => {
    const nome = v.str(req.body.nome, 'o nome do arquivo', { max: 200 });
    const buf = Buffer.from(String(req.body.base64 || ''), 'base64');
    if (!buf.length) throw new HttpError(400, 'Arquivo vazio');
    if (buf.length > 10 * 1024 * 1024) throw new HttpError(413, 'O PDF precisa ter até 10 MB');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Envie um arquivo PDF');
    return db.one(
      `INSERT INTO contrato_arquivos (contrato_id, nome, tamanho, conteudo, enviado_por) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, nome, tamanho, criado_em`, [v.id(req.params.id), nome, buf.length, buf, req.user.id]);
  });

  app.get('/api/contratos/:id/arquivos', leitura, async (req) => db.many(
    `SELECT id, nome, tamanho, criado_em FROM contrato_arquivos WHERE contrato_id = $1 ORDER BY id DESC`, [v.id(req.params.id)]));

  app.get('/api/arquivos/:id', leitura, async (req, res) => {
    const a = await db.one(`SELECT nome, mime, conteudo FROM contrato_arquivos WHERE id = $1`, [v.id(req.params.id)]);
    if (!a) throw new HttpError(404, 'Arquivo não encontrado');
    res.writeHead(200, {
      'Content-Type': a.mime,
      'Content-Length': a.conteudo.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
      'Cache-Control': 'private, no-store',
    });
    res.end(a.conteudo);
  });

  app.delete('/api/arquivos/:id', gestao, async (req) => {
    await db.query(`DELETE FROM contrato_arquivos WHERE id = $1`, [v.id(req.params.id)]);
    return { ok: true };
  });

  // ---------- Endereços ----------
  // Itens do projeto (catálogo de equipamentos do contrato)
  app.get('/api/contratos/:id/itens', leitura, async (req) => db.many(
    `SELECT ci.id, ci.nome, ci.unidade, ci.ordem, COALESCE(sum(ei.quantidade),0)::int AS total, count(ei.endereco_id)::int AS enderecos
       FROM contrato_itens ci LEFT JOIN endereco_itens ei ON ei.item_id = ci.id
      WHERE ci.contrato_id = $1 GROUP BY ci.id ORDER BY ci.ordem, ci.id`, [v.id(req.params.id)]));

  app.put('/api/contratos/:id/itens', escrita, async (req) => db.tx(async (c) => {
    const contrato = v.id(req.params.id);
    const lista = validarItens((req.body.itens || []).map((x) => ({ nome: x.nome, quantidade: 0 }))) || [];
    const manter = [];
    for (const [i, it] of lista.entries()) {
      const id = await garantirItem(c, contrato, it.nome);
      await c.query(`UPDATE contrato_itens SET ordem = $1 WHERE id = $2`, [i + 1, id]);
      manter.push(id);
    }
    await c.query(`DELETE FROM contrato_itens WHERE contrato_id = $1 AND NOT (id = ANY($2::bigint[]))`, [contrato, manter]);
    return { ok: true };
  }));

  app.get('/api/contratos/:id/enderecos', leitura, async (req) => db.many(
    `SELECT e.*, COALESCE((SELECT json_agg(json_build_object('item_id', ci.id, 'nome', ci.nome, 'quantidade', ei.quantidade) ORDER BY ci.ordem, ci.id)
                             FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id WHERE ei.endereco_id = e.id), '[]') AS itens
              , et.nome AS etapa, et.data_inicio AS etapa_inicio
       FROM enderecos e LEFT JOIN etapas et ON et.id = e.etapa_id WHERE e.contrato_id = $1 ORDER BY e.uf, e.municipio, e.nome`, [v.id(req.params.id)]));

  // Etapas do cliente (cada uma com data de início; os endereços ligados a ela são atacados naquele mês)
  app.get('/api/clientes/:id/etapas', leitura, async (req) => db.many(
    `SELECT et.id, et.nome, et.data_inicio, et.ordem, count(e.id)::int AS enderecos, COALESCE(sum(e.cameras),0)::int AS cameras
       FROM etapas et LEFT JOIN enderecos e ON e.etapa_id = et.id
      WHERE et.cliente_id = $1 GROUP BY et.id ORDER BY et.data_inicio, et.ordem, et.id`, [v.id(req.params.id)]));

  app.put('/api/clientes/:id/etapas', escrita, async (req) => db.tx(async (c) => {
    const cli = v.id(req.params.id);
    const lista = req.body.etapas;
    if (!Array.isArray(lista) || lista.length > 60) throw new HttpError(400, 'Lista de etapas inválida');
    const manter = [];
    for (const [i, et] of lista.entries()) {
      const nome = v.str(et.nome, `o nome da etapa ${i + 1}`, { max: 60 });
      const data = validarData(parseData(et.data_inicio) || '', `Data de início da etapa ${i + 1}`);
      let id = et.id ? Number(et.id) : null;
      if (id) {
        const r = await c.query(`UPDATE etapas SET nome = $1, data_inicio = $2, ordem = $3 WHERE id = $4 AND cliente_id = $5 RETURNING id`, [nome, data, i + 1, id, cli]);
        if (!r.rowCount) id = null;
      }
      if (!id) id = await garantirEtapa(c, cli, nome, data);
      manter.push(id);
    }
    await c.query(`DELETE FROM etapas WHERE cliente_id = $1 AND NOT (id = ANY($2::bigint[]))`, [cli, manter]);
    return { ok: true };
  }));

  // Define a etapa de vários endereços de uma vez (null = tira da etapa)
  app.post('/api/enderecos/etapa', escrita, async (req) => db.tx(async (c) => {
    const ids = Array.isArray(req.body.endereco_ids) ? req.body.endereco_ids.map((x) => v.id(x, 'Endereço')) : [];
    if (!ids.length || ids.length > 5000) throw new HttpError(400, 'Selecione os endereços');
    const etapa = req.body.etapa_id ? v.id(req.body.etapa_id, 'Etapa') : null;
    if (etapa) {
      const r = await c.query(`SELECT count(*)::int AS n FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
                                 JOIN etapas et ON et.cliente_id = ct.cliente_id AND et.id = $2 WHERE e.id = ANY($1)`, [ids, etapa]);
      if (r.rows[0].n !== ids.length) throw new HttpError(400, 'A etapa precisa ser do mesmo cliente dos endereços');
    }
    const r = await c.query(`UPDATE enderecos SET etapa_id = $1, atualizado_em = now() WHERE id = ANY($2)`, [etapa, ids]);
    return { ok: true, atualizados: r.rowCount };
  }));

  app.post('/api/contratos/:id/enderecos', escrita, async (req) => localizarDepois(await db.tx(async (c) => {
    const contrato = v.id(req.params.id);
    const e = (await c.query(
      `INSERT INTO enderecos (contrato_id, codigo, nome, logradouro, bairro, cep, municipio, uf, lat, lon, cameras)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [contrato, ...enderecoBody(req.body)])).rows[0];
    await salvarItensEndereco(c, e.id, contrato, validarItens(req.body.itens), e.cameras);
    await aplicarEtapa(c, e.id, contrato, req.body);
    await aplicarPlano(c, e.id, req.body);
    await ajustarGeo(c, e, null);
    const cliE = await clienteDoContrato(c, contrato);
    await ajustarEquipes(c, cliE);
    await recalcularPrevisao(c, cliE, [e.id]);
    await c.query(`INSERT INTO tarefas (endereco_id, atividade_id) SELECT $1, id FROM atividades WHERE contrato_id = $2 AND ativo
                   ON CONFLICT DO NOTHING`, [e.id, contrato]);
    // aplica as regras de distribuição do projeto ao endereço novo
    await c.query(`UPDATE tarefas t SET responsavel_id = r.pessoa_id FROM regras_distribuicao r
                    WHERE t.endereco_id = $1 AND r.contrato_id = $2 AND r.atividade_id = t.atividade_id AND r.pessoa_id IS NOT NULL`, [e.id, contrato]);
    return e;
  })));

  // Vários endereços de uma vez (lista colada do Excel)
  app.post('/api/contratos/:id/enderecos/lote', { limit: 4 * 1024 * 1024 }, escrita, async (req) => {
    const contrato = v.id(req.params.id);
    const lista = req.body.enderecos;
    if (!Array.isArray(lista) || !lista.length) throw new HttpError(400, 'Nenhum endereço na lista');
    if (lista.length > 3000) throw new HttpError(400, 'Envie no máximo 3.000 endereços por vez');
    const linhas = lista.map((b, i) => {
      try { return enderecoBody({ ...b, cameras: b.cameras === '' || b.cameras == null ? 0 : b.cameras }); } catch (e) { throw new HttpError(400, `Linha ${i + 1}: ${e.message}`); }
    });
    const itensL = lista.map((b, i) => validarItens(b.itens, `Linha ${i + 1}: `));
    return db.tx(async (c) => {
      const ok = (await c.query(`SELECT 1 FROM contratos WHERE id = $1`, [contrato])).rows.length;
      if (!ok) throw new HttpError(404, 'Contrato não encontrado');
      const ids = [];
      let atualizados = 0;
      const atualizar = req.body.atualizar === true;
      const aplicarEtapaLinha = async (eid, n) => {
        const L = lista[n];
        try {
          await aplicarEtapa(c, eid, contrato, { etapa: L.etapa, etapa_inicio: L.etapa_inicio, ...(L.ordem_etapa !== undefined ? { ordem_etapa: L.ordem_etapa } : {}) });
          await aplicarPlano(c, eid, { equipe: L.equipe, inicio_previsto: L.inicio_previsto, concluido_em: L.concluido_em, entrega_material: L.entrega_material, na_rota: L.na_rota, despacho_material: L.despacho_material, modo_logistico: L.modo_logistico });
        }
        catch (e) { throw new HttpError(e.status || 400, `Linha ${n + 1}: ${e.message}`); }
      };
      for (const [n, l] of linhas.entries()) {
        const its = itensL[n] && itensL[n].length ? itensL[n] : null;
        if (atualizar && l[0]) {
          const ex = await c.query(
            `UPDATE enderecos SET nome=$3, logradouro=$4, bairro=$5, cep=$6, municipio=$7, uf=$8, lat=$9, lon=$10, cameras=$11, atualizado_em=now()
              WHERE contrato_id = $1 AND codigo = $2 RETURNING id`, [contrato, ...l]);
          if (ex.rowCount) {
            atualizados += ex.rowCount;
            for (const row of ex.rows) { await salvarItensEndereco(c, row.id, contrato, its, l[10]); await aplicarEtapaLinha(row.id, n); }
            continue;
          }
        }
        const nid = (await c.query(
          `INSERT INTO enderecos (contrato_id, codigo, nome, logradouro, bairro, cep, municipio, uf, lat, lon, cameras)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [contrato, ...l])).rows[0].id;
        await salvarItensEndereco(c, nid, contrato, its, l[10]);
        await aplicarEtapaLinha(nid, n);
        ids.push(nid);
      }
      await c.query(`INSERT INTO tarefas (endereco_id, atividade_id) SELECT e.id, a.id FROM enderecos e JOIN atividades a ON a.contrato_id = e.contrato_id AND a.ativo
                     WHERE e.id = ANY($1) ON CONFLICT DO NOTHING`, [ids]);
      await c.query(`UPDATE enderecos SET geo_fonte = 'manual' WHERE id = ANY($1) AND lat IS NOT NULL AND lon IS NOT NULL`, [ids]);
      await c.query(`UPDATE tarefas t SET responsavel_id = r.pessoa_id FROM regras_distribuicao r
                      WHERE t.endereco_id = ANY($1) AND r.contrato_id = $2 AND r.atividade_id = t.atividade_id AND r.pessoa_id IS NOT NULL`, [ids, contrato]);
      const cliL = await clienteDoContrato(c, contrato);
      await ajustarEquipes(c, cliL);
      await recalcularPrevisao(c, cliL);
      return { ok: true, criados: ids.length, atualizados };
    });
  });

  app.put('/api/enderecos/:id', escrita, async (req) => localizarDepois(await db.tx(async (c) => {
    const antes = (await c.query(`SELECT logradouro, cep, municipio, uf, lat, lon, geo_fonte FROM enderecos WHERE id = $1`, [v.id(req.params.id)])).rows[0];
    const r = (await c.query(
      `UPDATE enderecos SET codigo=$1, nome=$2, logradouro=$3, bairro=$4, cep=$5, municipio=$6, uf=$7, lat=$8, lon=$9, cameras=$10,
              atualizado_em = now() WHERE id = $11 RETURNING *`, [...enderecoBody(req.body), v.id(req.params.id)])).rows[0];
    if (!r) throw new HttpError(404, 'Endereço não encontrado');
    await salvarItensEndereco(c, r.id, r.contrato_id, validarItens(req.body.itens), r.cameras);
    await aplicarEtapa(c, r.id, r.contrato_id, req.body);
    await aplicarPlano(c, r.id, req.body);
    await ajustarGeo(c, r, antes);
    const cliE = await clienteDoContrato(c, r.contrato_id);
    await ajustarEquipes(c, cliE);
    await recalcularPrevisao(c, cliE, [r.id]);
    return (await c.query(`SELECT * FROM enderecos WHERE id = $1`, [r.id])).rows[0];
  })));

  // Quantidade de equipes do projeto (1 a 8). Ao diminuir, os endereços das equipes que saíram ficam sem equipe.
  app.put('/api/clientes/:id/equipes', escrita, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const n = req.body.equipes === null || req.body.equipes === '' ? null : v.int(req.body.equipes, 'A quantidade de equipes', { min: 1, max: MAX_EQUIPES });
    const r = await c.query(`UPDATE clientes SET equipes = $1 WHERE id = $2`, [n, id]);
    if (!r.rowCount) throw new HttpError(404, 'Cliente não encontrado');
    const sem = await c.query(`UPDATE enderecos e SET equipe = NULL FROM contratos ct WHERE ct.id = e.contrato_id AND ct.cliente_id = $1 AND e.equipe > $2`, [id, n || 0]);
    await recalcularPrevisao(c, id);
    return { ok: true, equipes: n, sem_equipe: sem.rowCount };
  }));

  // Regras de cada equipe: dias de trabalho, início e quantidade por dia de cada equipamento
  app.get('/api/clientes/:id/equipe-regras', leitura, async (req) => {
    const id = v.id(req.params.id);
    const cli = await db.one(`SELECT equipes FROM clientes WHERE id = $1`, [id]);
    if (!cli) throw new HttpError(404, 'Cliente não encontrado');
    const itens = await db.many(
      `SELECT ci.nome, min(ci.ordem) AS ordem, COALESCE(sum(ei.quantidade),0)::int AS total
         FROM contrato_itens ci JOIN contratos ct ON ct.id = ci.contrato_id LEFT JOIN endereco_itens ei ON ei.item_id = ci.id
        WHERE ct.cliente_id = $1 AND ct.status <> 'encerrado' GROUP BY ci.nome ORDER BY min(ci.ordem), ci.nome`, [id]);
    const regras = await db.tx((c) => carregarRegras(c, id));
    return { equipes: cli.equipes, itens, regras: [...regras].map(([equipe, r]) => ({ equipe, ...r })).sort((a, b) => a.equipe - b.equipe) };
  });

  app.put('/api/clientes/:id/equipe-regras', escrita, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    if (!(await c.query(`SELECT 1 FROM clientes WHERE id = $1`, [id])).rows.length) throw new HttpError(404, 'Cliente não encontrado');
    const regras = validarRegras(req.body.regras);
    await c.query(`DELETE FROM equipe_regras WHERE cliente_id = $1`, [id]);
    for (const r of regras) {
      await c.query(`INSERT INTO equipe_regras (cliente_id, equipe, dias_semana, inicio, producao, min_dias) VALUES ($1,$2,$3::int[],$4,$5::jsonb,$6)`,
        [id, r.equipe, `{${r.dias_semana.join(',')}}`, r.inicio, JSON.stringify(r.producao), r.min_dias]);
    }
    await recalcularPrevisao(c, id);
    return { ok: true };
  }));

  // Altera vários endereços de uma vez: etapa, equipe e/ou início previsto (campo ausente = não mexe)
  app.post('/api/enderecos/lote-plano', escrita, async (req) => db.tx(async (c) => {
    const ids = Array.isArray(req.body.endereco_ids) ? req.body.endereco_ids.map((x) => v.id(x, 'Endereço')) : [];
    if (!ids.length || ids.length > 5000) throw new HttpError(400, 'Selecione os endereços');
    const clis = (await c.query(`SELECT DISTINCT ct.cliente_id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE e.id = ANY($1)`, [ids])).rows;
    if (clis.length !== 1) throw new HttpError(400, 'Os endereços precisam ser do mesmo cliente');
    const cli = clis[0].cliente_id;
    if (req.body.etapa_id !== undefined) {
      const etapa = req.body.etapa_id ? v.id(req.body.etapa_id, 'Etapa') : null;
      if (etapa && !(await c.query(`SELECT 1 FROM etapas WHERE id = $1 AND cliente_id = $2`, [etapa, cli])).rows.length) throw new HttpError(400, 'Etapa não pertence a este cliente');
      await c.query(`UPDATE enderecos SET etapa_id = $1 WHERE id = ANY($2)`, [etapa, ids]);
    }
    const equipe = parseEquipe(req.body.equipe);
    if (equipe !== undefined) await c.query(`UPDATE enderecos SET equipe = $1 WHERE id = ANY($2)`, [equipe, ids]);
    const inicio = parseDia(req.body.inicio_previsto, 'Data de início');
    if (inicio !== undefined) await c.query(`UPDATE enderecos SET inicio_previsto = $1 WHERE id = ANY($2)`, [inicio, ids]);
    const naRota = parseNaRota(req.body.na_rota);
    if (naRota !== undefined) await c.query(`UPDATE enderecos SET na_rota = $1 WHERE id = ANY($2)`, [naRota, ids]);
    await c.query(`UPDATE enderecos SET atualizado_em = now() WHERE id = ANY($1)`, [ids]);
    await ajustarEquipes(c, cli);
    await recalcularPrevisao(c, cli, ids);
    return { ok: true, atualizados: ids.length };
  }));

  // Conclusão manual: { data: 'aaaa-mm-dd' } conclui (sai do Painel de rotas); { data: null } reabre (volta para a rota)
  app.post('/api/enderecos/:id/conclusao', escrita, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    if (!(await c.query(`SELECT 1 FROM enderecos WHERE id = $1`, [id])).rows.length) throw new HttpError(404, 'Endereço não encontrado');
    await aplicarPlano(c, id, { concluido_em: req.body.data ?? '' });
    if (!req.body.data) await recalcularPrevisao(c, (await c.query(`SELECT ct.cliente_id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE e.id = $1`, [id])).rows[0].cliente_id, [id]);
    return (await c.query(`SELECT id, status, concluido_em FROM enderecos WHERE id = $1`, [id])).rows[0];
  }));

  // Localiza agora pelo endereço (logradouro, município, CEP) e grava latitude/longitude
  app.post('/api/enderecos/:id/localizar', escrita, async (req) => {
    const r = await require('../geocodificar').geocodificarEndereco(v.id(req.params.id));
    if (!r.ok) throw new HttpError(400, r.erro);
    return r;
  });

  // Exclui vários endereços de uma vez (com tarefas, fotos e itens)
  app.post('/api/enderecos/excluir', gestao, async (req) => {
    const ids = Array.isArray(req.body.endereco_ids) ? req.body.endereco_ids.map((x) => v.id(x, 'Endereço')) : [];
    if (!ids.length || ids.length > 5000) throw new HttpError(400, 'Selecione os endereços');
    const r = await db.query(`DELETE FROM enderecos WHERE id = ANY($1)`, [ids]);
    return { ok: true, excluidos: r.rowCount };
  });

  app.delete('/api/enderecos/:id', gestao, async (req) => {
    await db.query(`DELETE FROM enderecos WHERE id = $1`, [v.id(req.params.id)]);
    return { ok: true };
  });

  // ---------- Atividades ----------
  app.get('/api/contratos/:id/atividades', leitura, async (req) => db.many(
    `SELECT a.*, ck.nome AS checklist_nome, (SELECT p.nome FROM atividades p WHERE p.id = a.predecessora_id) AS predecessora_nome,
            (SELECT count(*)::int FROM tarefas t WHERE t.atividade_id = a.id) AS tarefas,
            (SELECT count(*)::int FROM tarefas t WHERE t.atividade_id = a.id AND t.status = 'concluida') AS concluidas
       FROM atividades a LEFT JOIN checklists ck ON ck.id = a.checklist_id
      WHERE a.contrato_id = $1 AND a.ativo ORDER BY a.ordem, a.id`, [v.id(req.params.id)]));

  app.post('/api/contratos/:id/atividades', gestao, async (req) => db.tx(async (c) => {
    const contrato = v.id(req.params.id);
    const a = (await c.query(
      `INSERT INTO atividades (contrato_id, nome, curto, etapa, funcao, tempo_modo, tempo_qtd, tempo_unidade, min_por_camera, faixas,
                               conta_rota, checklist_id, evidencia, ordem, tempo_impacto, predecessora_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING *`, await (async () => {
        const corpo = atividadeBody(req.body); await conferirPredecessora(c, contrato, null, corpo[14]); return [contrato, ...corpo]; })())).rows[0];
    await c.query(`INSERT INTO tarefas (endereco_id, atividade_id) SELECT id, $1 FROM enderecos WHERE contrato_id = $2
                   ON CONFLICT DO NOTHING`, [a.id, contrato]);
    return a;
  }));

  // Copia as atividades padrão para um contrato sem atividades
  app.post('/api/contratos/:id/atividades/padrao', gestao, async (req) => db.tx(async (c) => {
    const contrato = v.id(req.params.id);
    const tem = (await c.query(`SELECT count(*)::int AS n FROM atividades WHERE contrato_id = $1 AND ativo`, [contrato])).rows[0].n;
    if (tem) throw new HttpError(400, 'Este contrato já tem atividades');
    await copiarPadrao(c, contrato);
    return { ok: true };
  }));

  // Preparação do projeto (guia na tela do cliente): o que já está pronto em cada contrato
  app.get('/api/contratos/:id/preparacao', leitura, async (req) => db.one(
    `SELECT (SELECT count(*)::int FROM atividades a WHERE a.contrato_id = $1 AND a.ativo) AS atividades,
            count(t.id)::int AS tarefas,
            count(t.id) FILTER (WHERE t.responsavel_id IS NULL AND t.status <> 'concluida')::int AS sem_responsavel
       FROM enderecos e LEFT JOIN tarefas t ON t.endereco_id = e.id WHERE e.contrato_id = $1`, [v.id(req.params.id)]));

  app.put('/api/atividades/:id', gestao, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const atual = (await c.query(`SELECT contrato_id FROM atividades WHERE id = $1`, [id])).rows[0];
    if (!atual) throw new HttpError(404, 'Atividade não encontrada');
    const corpo = atividadeBody(req.body);
    await conferirPredecessora(c, atual.contrato_id, id, corpo[14]);
    return (await c.query(
      `UPDATE atividades SET nome=$1, curto=$2, etapa=$3, funcao=$4, tempo_modo=$5, tempo_qtd=$6, tempo_unidade=$7, min_por_camera=$8,
              faixas=$9::jsonb, conta_rota=$10, checklist_id=$11, evidencia=$12, ordem=$13, tempo_impacto=$14, predecessora_id=$15 WHERE id = $16 RETURNING *`,
      [...corpo, id])).rows[0];
  }));

  app.delete('/api/atividades/:id', gestao, async (req) => {
    await db.query(`UPDATE atividades SET ativo = false WHERE id = $1`, [v.id(req.params.id)]);
    return { ok: true };
  });

  // ---------- Checklists ----------
  app.get('/api/checklists', leitura, async () => {
    const lista = await db.many(`SELECT * FROM checklists ORDER BY nome`);
    const itens = await db.many(`SELECT * FROM checklist_itens ORDER BY checklist_id, ordem, id`);
    for (const c of lista) c.itens = itens.filter((i) => i.checklist_id === c.id);
    return lista;
  });

  const salvarChecklist = async (c, id, b) => {
    if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > 100) throw new HttpError(400, 'Inclua os itens do checklist');
    await c.query(`DELETE FROM checklist_itens WHERE checklist_id = $1`, [id]);
    for (const [i, it] of b.itens.entries()) {
      await c.query(`INSERT INTO checklist_itens (checklist_id, ordem, texto, tipo_resposta, obrigatorio) VALUES ($1,$2,$3,$4,$5)`, [
        id, i + 1, v.str(it.texto, `o item ${i + 1}`, { max: 300 }),
        v.oneOf(it.tipo_resposta || 'check', 'Tipo de resposta', ['check', 'foto', 'texto', 'numero']), it.obrigatorio !== false]);
    }
  };

  app.post('/api/checklists', gestao, async (req) => db.tx(async (c) => {
    const ck = (await c.query(`INSERT INTO checklists (nome, descricao) VALUES ($1,$2) RETURNING *`, [
      v.str(req.body.nome, 'o nome do checklist', { max: 120 }), v.str(req.body.descricao, 'a descrição', { max: 500, opcional: true })])).rows[0];
    await salvarChecklist(c, ck.id, req.body);
    return ck;
  }));

  app.put('/api/checklists/:id', gestao, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const r = await c.query(`UPDATE checklists SET nome=$1, descricao=$2 WHERE id=$3 RETURNING *`, [
      v.str(req.body.nome, 'o nome do checklist', { max: 120 }), v.str(req.body.descricao, 'a descrição', { max: 500, opcional: true }), id]);
    if (!r.rows.length) throw new HttpError(404, 'Checklist não encontrado');
    await salvarChecklist(c, id, req.body);
    return r.rows[0];
  }));
};
