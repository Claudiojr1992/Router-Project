// App do técnico (PWA): pacote para uso offline, fila de ações e fotos de evidência
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, ESCRITORIO, INTERNOS, pode, podeAcao } = require('../auth');
const { gerarRelatorio } = require('../relatorio');
const { conferirConclusao } = require('../predecessora');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = ['a_fazer', 'em_andamento', 'aguardando', 'concluida'];
const MIMES = { 'image/jpeg': [0xff, 0xd8], 'image/png': [0x89, 0x50], 'image/webp': [0x52, 0x49] };
const MAX_FOTO = 8 * 1024 * 1024;

function uuid(x, campo = 'Identificador') {
  if (typeof x !== 'string' || !UUID_RE.test(x)) throw new HttpError(400, `${campo} inválido`);
  return x.toLowerCase();
}

// Garante que a tarefa está com o usuário (ou que ele é do escritório)
async function tarefaDoUsuario(c, user, tarefaId) {
  const t = (await c.query(
    `SELECT t.id, t.status, t.responsavel_id, t.endereco_id, a.checklist_id FROM tarefas t JOIN atividades a ON a.id = t.atividade_id WHERE t.id = $1`, [tarefaId])).rows[0];
  if (!t) throw new HttpError(404, 'Atividade não encontrada');
  if (!pode(user, 'projetos', 'editar') && !pode(user, 'delegadas', 'editar') && (!user.pessoa_id || t.responsavel_id !== user.pessoa_id)) {
    throw new HttpError(403, 'Esta atividade não está mais com você');
  }
  return t;
}

// Itens obrigatórios do checklist que ainda faltam
async function pendenciasChecklist(c, tarefa) {
  if (!tarefa.checklist_id) return [];
  const r = await c.query(
    `SELECT i.texto FROM checklist_itens i
      WHERE i.checklist_id = $1 AND i.obrigatorio
        AND NOT EXISTS (SELECT 1 FROM checklist_respostas r WHERE r.tarefa_id = $2 AND r.item_id = i.id AND r.ok)
        AND NOT (i.tipo_resposta = 'foto' AND EXISTS (SELECT 1 FROM evidencias e WHERE e.tarefa_id = $2 AND e.item_id = i.id))
      ORDER BY i.ordem`, [tarefa.checklist_id, tarefa.id]);
  return r.rows.map((x) => x.texto);
}

async function aplicarAcao(c, user, a) {
  const tarefaId = v.id(a.tarefa_id, 'Atividade');
  const t = await tarefaDoUsuario(c, user, tarefaId);
  if (a.tipo === 'status') {
    const s = v.oneOf(a.status, 'Status', STATUS);
    if (s === t.status) return;
    if (t.status === 'concluida' && !podeAcao(user, 'reabrir')) throw new HttpError(403, 'Seu perfil não pode reabrir atividade concluída (fale com a coordenação ou a supervisão)');
    if (s === 'concluida') {
      await conferirConclusao(c, tarefaId);
      const falta = await pendenciasChecklist(c, t);
      if (falta.length) throw new HttpError(400, `Checklist incompleto: ${falta.join('; ')}`);
    }
    await c.query(
      `UPDATE tarefas SET status = $1, atualizado_em = now(),
              realizada_inicio = CASE WHEN $1 IN ('em_andamento','concluida') AND realizada_inicio IS NULL THEN COALESCE($3::timestamptz, now()) ELSE realizada_inicio END,
              realizada_fim = CASE WHEN $1 = 'concluida' THEN COALESCE($3::timestamptz, now()) ELSE NULL END
        WHERE id = $2`, [s, tarefaId, a.em && !Number.isNaN(Date.parse(a.em)) ? new Date(a.em).toISOString() : null]);
    await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,'status',$3)`,
      [tarefaId, user.id, `${t.status} → ${s} (app)`]);
  } else if (a.tipo === 'resposta') {
    const itemId = v.id(a.item_id, 'Item');
    const ok = (await c.query(`SELECT 1 FROM checklist_itens WHERE id = $1 AND checklist_id = $2`, [itemId, t.checklist_id])).rows.length;
    if (!ok) throw new HttpError(400, 'Item não pertence ao checklist desta atividade');
    await c.query(
      `INSERT INTO checklist_respostas (tarefa_id, item_id, valor, ok, usuario_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tarefa_id, item_id) DO UPDATE SET valor = EXCLUDED.valor, ok = EXCLUDED.ok, usuario_id = EXCLUDED.usuario_id, criado_em = now()`,
      [tarefaId, itemId, v.str(a.valor, 'a resposta', { max: 1000, opcional: true }), a.ok === true, user.id]);
  } else if (a.tipo === 'comentario') {
    await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,'comentario',$3)`,
      [tarefaId, user.id, v.str(a.texto, 'o comentário', { max: 2000 })]);
  } else if (a.tipo === 'ativo') {
    // Patrimônio registrado no campo: fica instalado no endereço da atividade
    const txt = (x, max) => { const s2 = String(x ?? '').trim(); return s2 ? s2.slice(0, max) : null; };
    const pat = txt(a.patrimonio, 60), serie = txt(a.numero_serie, 80);
    if (!pat && !serie) throw new HttpError(400, 'Informe o patrimônio ou o número de série');
    const e = (await c.query(`SELECT e.id, e.contrato_id FROM enderecos e WHERE e.id = $1`, [t.endereco_id])).rows[0];
    const itemId = a.item_id ? v.id(a.item_id, 'Item') : null;
    if (itemId && !(await c.query(`SELECT 1 FROM contrato_itens WHERE id = $1 AND contrato_id = $2`, [itemId, e.contrato_id])).rows.length) throw new HttpError(400, 'Item não é deste contrato');
    const dia = a.em && !Number.isNaN(Date.parse(a.em)) ? new Date(a.em).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const ja = (await c.query(`SELECT id, contrato_id FROM ativos WHERE ($1::text IS NOT NULL AND lower(patrimonio) = lower($1)) OR ($2::text IS NOT NULL AND lower(numero_serie) = lower($2)) LIMIT 1`, [pat, serie])).rows[0];
    if (ja && ja.contrato_id !== e.contrato_id) throw new HttpError(400, `Patrimônio/série ${pat || serie} já está em outro contrato`);
    if (ja) {
      await c.query(`UPDATE ativos SET endereco_id = $1, item_id = COALESCE($2, item_id), patrimonio = COALESCE($3, patrimonio), numero_serie = COALESCE($4, numero_serie),
                       fabricante = COALESCE($5, fabricante), modelo = COALESCE($6, modelo), status = 'instalado', instalado_em = $7, atualizado_em = now() WHERE id = $8`,
        [e.id, itemId, pat, serie, txt(a.fabricante, 80), txt(a.modelo, 80), dia, ja.id]);
    } else {
      await c.query(`INSERT INTO ativos (contrato_id, item_id, endereco_id, patrimonio, numero_serie, fabricante, modelo, status, instalado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,'instalado',$8)`,
        [e.contrato_id, itemId, e.id, pat, serie, txt(a.fabricante, 80), txt(a.modelo, 80), dia]);
    }
    await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,'comentario',$3)`,
      [tarefaId, user.id, `Patrimônio registrado no app: ${[pat, serie].filter(Boolean).join(' / ')}`]);
  } else {
    throw new HttpError(400, 'Tipo de ação desconhecido');
  }
}

module.exports = (app) => {
  const interno = requer(INTERNOS);

  // Tudo o que o técnico precisa para trabalhar sem internet
  app.get('/api/mobile/sync', interno, async (req) => {
    const u = req.user;
    const base = { usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, pessoa_id: u.pessoa_id, acoes: u.perm ? u.perm.acoes : {} }, servidor_em: new Date().toISOString() };
    if (!u.pessoa_id) return { ...base, tarefas: [], checklists: {}, respostas: {}, fotos: {}, patrimonio: {} };
    const tarefas = await db.many(
      `SELECT t.id, t.status, t.prevista_inicio, t.prevista_fim, t.realizada_inicio, t.realizada_fim, t.observacao, t.atualizado_em,
              a.id AS atividade_id, a.nome AS atividade, a.etapa, a.checklist_id, a.evidencia,
              (SELECT pa.nome FROM atividades pa WHERE pa.id = a.predecessora_id) AS pred_nome,
              (SELECT pt.status FROM tarefas pt WHERE pt.endereco_id = t.endereco_id AND pt.atividade_id = a.predecessora_id) AS pred_status,
              e.id AS endereco_id, e.codigo, e.nome AS endereco, e.logradouro, e.bairro, e.cep, e.municipio, e.uf, e.lat, e.lon,
              e.cameras, e.status AS endereco_status, e.aeroporto, e.km_aeroporto,
              cl.nome AS cliente, ct.numero AS contrato,
              COALESCE((SELECT json_agg(json_build_object('nome', ci.nome, 'quantidade', ei.quantidade) ORDER BY ci.ordem, ci.id)
                          FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id WHERE ei.endereco_id = e.id AND ei.quantidade > 0), '[]') AS equipamentos
         FROM tarefas t
         JOIN atividades a ON a.id = t.atividade_id AND a.ativo
         JOIN enderecos e ON e.id = t.endereco_id
         JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
        WHERE t.responsavel_id = $1 AND (t.status <> 'concluida' OR t.atualizado_em > now() - interval '7 days')
        ORDER BY t.prevista_inicio NULLS LAST, e.uf, e.municipio, a.ordem
        LIMIT 400`, [u.pessoa_id]);
    const ids = tarefas.map((t) => t.id);
    const ckIds = [...new Set(tarefas.map((t) => t.checklist_id).filter(Boolean))];
    const [ckRows, itens, resp, fotos] = await Promise.all([
      ckIds.length ? db.many(`SELECT id, nome FROM checklists WHERE id = ANY($1)`, [ckIds]) : [],
      ckIds.length ? db.many(`SELECT id, checklist_id, ordem, texto, tipo_resposta, obrigatorio FROM checklist_itens WHERE checklist_id = ANY($1) ORDER BY ordem, id`, [ckIds]) : [],
      ids.length ? db.many(`SELECT tarefa_id, item_id, valor, ok FROM checklist_respostas WHERE tarefa_id = ANY($1)`, [ids]) : [],
      ids.length ? db.many(`SELECT id, client_id, tarefa_id, item_id, legenda, criado_em FROM evidencias WHERE tarefa_id = ANY($1) ORDER BY criado_em`, [ids]) : [],
    ]);
    const checklists = {};
    for (const c of ckRows) checklists[c.id] = { id: c.id, nome: c.nome, itens: itens.filter((i) => i.checklist_id === c.id) };
    const respostas = {};
    for (const r of resp) (respostas[r.tarefa_id] = respostas[r.tarefa_id] || {})[r.item_id] = { valor: r.valor, ok: r.ok };
    const fotosPor = {};
    for (const f of fotos) (fotosPor[f.tarefa_id] = fotosPor[f.tarefa_id] || []).push(f);
    // Patrimônio dos endereços das atividades: itens controlados (com quantidade) e ativos já registrados
    const ends = [...new Set(tarefas.map((t) => t.endereco_id))];
    const patrimonio = {};
    if (ends.length) {
      const [pit, pat] = await Promise.all([
        db.many(`SELECT ei.endereco_id, ci.id, ci.nome, ei.quantidade FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id
                  WHERE ei.endereco_id = ANY($1) AND ci.controla_patrimonio AND ei.quantidade > 0 ORDER BY ci.ordem, ci.id`, [ends]),
        db.many(`SELECT id, endereco_id, item_id, patrimonio, numero_serie, status FROM ativos WHERE endereco_id = ANY($1) ORDER BY id`, [ends]),
      ]);
      for (const i of pit) (patrimonio[i.endereco_id] = patrimonio[i.endereco_id] || { itens: [], ativos: [] }).itens.push({ id: i.id, nome: i.nome, quantidade: i.quantidade });
      for (const x of pat) if (patrimonio[x.endereco_id]) patrimonio[x.endereco_id].ativos.push(x);
    }
    return { ...base, tarefas, checklists, respostas, fotos: fotosPor, patrimonio };
  });

  // Fila de ações feitas offline: [{ id(uuid), tipo, tarefa_id, ... }]
  app.post('/api/mobile/acoes', { limit: 2 * 1024 * 1024 }, interno, async (req) => {
    const lista = req.body.acoes;
    if (!Array.isArray(lista) || lista.length > 500) throw new HttpError(400, 'Lista de ações inválida');
    const resultados = [];
    for (const a of lista) {
      let id;
      try { id = uuid(a && a.id, 'Ação'); } catch (e) { resultados.push({ id: a && a.id, ok: false, erro: e.message }); continue; }
      try {
        await db.tx(async (c) => {
          const novo = await c.query(
            `INSERT INTO sync_acoes (client_id, usuario_id, tipo) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING client_id`,
            [id, req.user.id, String(a.tipo || '').slice(0, 20)]);
          if (!novo.rows.length) return; // já processada antes
          await aplicarAcao(c, req.user, a);
        });
        resultados.push({ id, ok: true });
      } catch (e) {
        if (!(e instanceof HttpError) && !['23514', '22P02', '23503', '23505'].includes(e.code)) throw e;
        if (e.code === '23505') e.message = 'Patrimônio ou número de série já cadastrado';
        resultados.push({ id, ok: false, erro: e.message });
      }
    }
    return { resultados };
  });

  // Foto de evidência (enviada em base64, já comprimida no celular)
  app.post('/api/mobile/fotos', { limit: 12 * 1024 * 1024 }, interno, async (req) => {
    const b = req.body;
    const clientId = uuid(b.client_id, 'Foto');
    const tarefaId = v.id(b.tarefa_id, 'Atividade');
    const mime = v.oneOf(b.mime || 'image/jpeg', 'Tipo de imagem', Object.keys(MIMES));
    const buf = Buffer.from(String(b.base64 || ''), 'base64');
    if (!buf.length) throw new HttpError(400, 'Foto vazia');
    if (buf.length > MAX_FOTO) throw new HttpError(413, 'Foto grande demais (máx. 8 MB)');
    const sig = MIMES[mime];
    if (buf[0] !== sig[0] || buf[1] !== sig[1]) throw new HttpError(400, 'Arquivo não é uma imagem válida');
    return db.tx(async (c) => {
      const t = await tarefaDoUsuario(c, req.user, tarefaId);
      let itemId = null;
      if (b.item_id) {
        itemId = v.id(b.item_id, 'Item');
        const ok = (await c.query(`SELECT 1 FROM checklist_itens WHERE id = $1 AND checklist_id = $2`, [itemId, t.checklist_id])).rows.length;
        if (!ok) throw new HttpError(400, 'Item não pertence ao checklist desta atividade');
      }
      const tirada = b.tirada_em && !Number.isNaN(Date.parse(b.tirada_em)) ? new Date(b.tirada_em).toISOString() : null;
      const r = await c.query(
        `INSERT INTO evidencias (client_id, tarefa_id, item_id, usuario_id, legenda, mime, tamanho, conteudo, lat, lon, tirada_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (client_id) DO NOTHING RETURNING id`,
        [clientId, tarefaId, itemId, req.user.id, v.str(b.legenda, 'a legenda', { max: 300, opcional: true }), mime, buf.length, buf,
          v.num(b.lat, 'Latitude', { min: -90, max: 90, opcional: true }), v.num(b.lon, 'Longitude', { min: -180, max: 180, opcional: true }), tirada]);
      const id = r.rows.length ? r.rows[0].id : (await c.query(`SELECT id FROM evidencias WHERE client_id = $1`, [clientId])).rows[0].id;
      if (itemId) {
        await c.query(
          `INSERT INTO checklist_respostas (tarefa_id, item_id, valor, ok, usuario_id) VALUES ($1,$2,'foto',true,$3)
           ON CONFLICT (tarefa_id, item_id) DO UPDATE SET ok = true, usuario_id = EXCLUDED.usuario_id, criado_em = now()`, [tarefaId, itemId, req.user.id]);
      }
      return { ok: true, id };
    });
  });

  app.get('/api/tarefas/:id/fotos', interno, async (req) => {
    const id = v.id(req.params.id);
    await db.tx((c) => tarefaDoUsuario(c, req.user, id));
    return db.many(
      `SELECT ev.id, ev.item_id, ev.legenda, ev.lat, ev.lon, ev.tirada_em, ev.criado_em, ev.tamanho, u.nome AS usuario, i.texto AS item
         FROM evidencias ev LEFT JOIN usuarios u ON u.id = ev.usuario_id LEFT JOIN checklist_itens i ON i.id = ev.item_id
        WHERE ev.tarefa_id = $1 ORDER BY ev.criado_em`, [id]);
  });

  // Checklist da atividade com as respostas (tela de Projetos e Delegadas)
  app.get('/api/tarefas/:id/checklist', interno, async (req) => {
    const id = v.id(req.params.id);
    const t = await db.tx((c) => tarefaDoUsuario(c, req.user, id));
    const info = await db.one(`SELECT realizada_inicio, realizada_fim, status FROM tarefas WHERE id = $1`, [id]);
    if (!t.checklist_id) return { ...info, checklist: null, itens: [] };
    const ck = await db.one(`SELECT id, nome FROM checklists WHERE id = $1`, [t.checklist_id]);
    const itens = await db.many(
      `SELECT i.id, i.texto, i.tipo_resposta, i.obrigatorio, r.valor, r.ok, r.criado_em, u.nome AS usuario,
              (SELECT count(*)::int FROM evidencias ev WHERE ev.tarefa_id = $2 AND ev.item_id = i.id) AS fotos
         FROM checklist_itens i LEFT JOIN checklist_respostas r ON r.item_id = i.id AND r.tarefa_id = $2
         LEFT JOIN usuarios u ON u.id = r.usuario_id WHERE i.checklist_id = $1 ORDER BY i.ordem, i.id`, [t.checklist_id, id]);
    return { ...info, checklist: ck, itens };
  });

  // Relatório PDF da atividade (parcial enquanto não concluída; final depois de concluída)
  app.get('/api/tarefas/:id/relatorio.pdf', interno, async (req, res) => {
    const id = v.id(req.params.id);
    await db.tx((c) => tarefaDoUsuario(c, req.user, id));
    const r = await gerarRelatorio(id);
    if (!r) throw new HttpError(404, 'Atividade não encontrada');
    const baixar = req.query.baixar === '1';
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': r.bytes.length, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${baixar ? 'attachment' : 'inline'}; filename="${r.nome}"; filename*=UTF-8''${encodeURIComponent(r.nome)}`,
    });
    res.end(r.bytes);
  });

  app.get('/api/fotos/:id', interno, async (req, res) => {
    const f = await db.one(`SELECT tarefa_id, mime, conteudo FROM evidencias WHERE id = $1`, [v.id(req.params.id)]);
    if (!f) throw new HttpError(404, 'Foto não encontrada');
    await db.tx((c) => tarefaDoUsuario(c, req.user, f.tarefa_id));
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.conteudo.length, 'Cache-Control': 'private, max-age=86400' });
    res.end(f.conteudo);
  });
};
