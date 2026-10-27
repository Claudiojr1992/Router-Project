// Gestão de projetos: endereços x atividades (tarefas), delegação, distribuição em lote e atividades delegadas
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, GESTAO, ESCRITORIO, INTERNOS, pode, podeAcao } = require('../auth');
const { conferirConclusao } = require('../predecessora');

const STATUS = ['a_fazer', 'em_andamento', 'aguardando', 'concluida'];

async function evento(c, tarefaId, usuarioId, tipo, detalhe) {
  await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,$3,$4)`, [tarefaId, usuarioId, tipo, detalhe]);
}

module.exports = (app) => {
  const leitura = requer(INTERNOS);
  const escritorio = requer(ESCRITORIO);
  const gestao = requer(GESTAO);

  // Lista de projetos (um por contrato) com progresso
  app.get('/api/projetos', leitura, async () => db.many(
    `SELECT ct.id, ct.numero, ct.tipo, ct.objeto, ct.status, cl.id AS cliente_id, cl.nome AS cliente,
            (SELECT count(*)::int FROM enderecos e WHERE e.contrato_id = ct.id) AS enderecos,
            (SELECT COALESCE(sum(cameras),0)::int FROM enderecos e WHERE e.contrato_id = ct.id) AS cameras,
            count(t.id)::int AS tarefas,
            count(t.id) FILTER (WHERE t.status = 'concluida')::int AS concluidas,
            count(t.id) FILTER (WHERE t.responsavel_id IS NULL)::int AS sem_responsavel
       FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id
       LEFT JOIN enderecos e ON e.contrato_id = ct.id
       LEFT JOIN tarefas t ON t.endereco_id = e.id
      GROUP BY ct.id, cl.id ORDER BY cl.nome, ct.tipo DESC, ct.id`));

  // Visão completa de um projeto
  app.get('/api/projetos/:id', leitura, async (req) => {
    const id = v.id(req.params.id);
    const contrato = await db.one(
      `SELECT ct.*, cl.nome AS cliente FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id WHERE ct.id = $1`, [id]);
    if (!contrato) throw new HttpError(404, 'Projeto não encontrado');
    const [atividades, enderecos, tarefas, regras, itens] = await Promise.all([
      db.many(`SELECT id, nome, curto, etapa, funcao, ordem, predecessora_id, tempo_impacto FROM atividades WHERE contrato_id = $1 AND ativo ORDER BY ordem, id`, [id]),
      db.many(`SELECT e.id, e.ref_id, e.codigo, e.nome, e.municipio, e.uf, e.cameras, e.status, e.etapa_id, e.ordem_etapa, et.nome AS etapa, et.data_inicio AS etapa_inicio
                 FROM enderecos e LEFT JOIN etapas et ON et.id = e.etapa_id WHERE e.contrato_id = $1 ORDER BY et.data_inicio NULLS LAST, e.ordem_etapa NULLS LAST, e.uf, e.municipio, e.nome`, [id]),
      db.many(
        `SELECT t.id, t.endereco_id, t.atividade_id, t.status, t.responsavel_id, t.prevista_inicio, t.prevista_fim, t.atualizado_em,
                t.realizada_inicio, t.realizada_fim, p.nome AS responsavel, p.tipo AS responsavel_tipo, a.checklist_id,
                (SELECT count(*)::int FROM checklist_itens i WHERE i.checklist_id = a.checklist_id) AS ck_total,
                (SELECT count(*)::int FROM checklist_itens i WHERE i.checklist_id = a.checklist_id AND (
                    EXISTS (SELECT 1 FROM checklist_respostas r WHERE r.tarefa_id = t.id AND r.item_id = i.id AND r.ok)
                    OR (i.tipo_resposta = 'foto' AND EXISTS (SELECT 1 FROM evidencias ev WHERE ev.tarefa_id = t.id AND ev.item_id = i.id)))) AS ck_feitos,
                (SELECT count(*)::int FROM evidencias ev WHERE ev.tarefa_id = t.id) AS fotos
           FROM tarefas t JOIN enderecos e ON e.id = t.endereco_id
           JOIN atividades a ON a.id = t.atividade_id AND a.ativo
           LEFT JOIN pessoas p ON p.id = t.responsavel_id
          WHERE e.contrato_id = $1`, [id]),
      db.many(`SELECT r.*, p.nome AS pessoa FROM regras_distribuicao r LEFT JOIN pessoas p ON p.id = r.pessoa_id WHERE r.contrato_id = $1`, [id]),
      db.many(`SELECT id, nome FROM contrato_itens WHERE contrato_id = $1 ORDER BY ordem, id`, [id]),
    ]);
    // quantidade de cada item do contrato por endereço
    const qtds = await db.many(`SELECT ei.endereco_id, ei.item_id, ei.quantidade FROM endereco_itens ei JOIN enderecos e ON e.id = ei.endereco_id
                                 WHERE e.contrato_id = $1 AND ei.quantidade > 0`, [id]);
    const porEnd = new Map(enderecos.map((e) => [e.id, Object.assign(e, { tarefas: [] })]));
    for (const t of tarefas) porEnd.get(t.endereco_id)?.tarefas.push(t);
    for (const e of enderecos) e.itens = {};
    for (const q of qtds) { const e = porEnd.get(q.endereco_id); if (e) e.itens[q.item_id] = q.quantidade; }
    return { contrato, atividades, enderecos, regras, itens };
  });

  // Atualiza uma tarefa: responsável, status, datas, observação
  app.patch('/api/tarefas/:id', leitura, async (req) => {
    const id = v.id(req.params.id);
    const b = req.body;
    const u = req.user;
    return db.tx(async (c) => {
      const atual = (await c.query(`SELECT t.*, p.nome AS responsavel FROM tarefas t LEFT JOIN pessoas p ON p.id = t.responsavel_id WHERE t.id = $1 FOR UPDATE OF t`, [id])).rows[0];
      if (!atual) throw new HttpError(404, 'Atividade não encontrada');
      const podeGerir = pode(u, 'projetos', 'editar') || pode(u, 'delegadas', 'editar');
      const ehDono = u.pessoa_id && atual.responsavel_id === u.pessoa_id;
      if (!podeGerir && !ehDono) throw new HttpError(403, 'Esta atividade não está com você');

      if (b.responsavel_id !== undefined) {
        if (!podeAcao(u, 'delegar')) throw new HttpError(403, 'Seu perfil não pode trocar o responsável de atividades');
        const novo = b.responsavel_id === null ? null : v.id(b.responsavel_id, 'Responsável');
        let nome = 'ninguém';
        if (novo) {
          const p = (await c.query(`SELECT nome FROM pessoas WHERE id = $1 AND ativo`, [novo])).rows[0];
          if (!p) throw new HttpError(400, 'Responsável não encontrado');
          nome = p.nome;
        }
        if (novo !== atual.responsavel_id) {
          await c.query(`UPDATE tarefas SET responsavel_id = $1, atualizado_em = now() WHERE id = $2`, [novo, id]);
          await evento(c, id, u.id, 'atribuicao', `${atual.responsavel || 'ninguém'} → ${nome}`);
        }
      }
      if (b.status !== undefined) {
        const s = v.oneOf(b.status, 'Status', STATUS);
        if (atual.status === 'concluida' && s !== 'concluida' && !podeAcao(u, 'reabrir')) throw new HttpError(403, 'Seu perfil não pode reabrir atividade concluída (fale com a coordenação ou a supervisão)');
        if (s === 'concluida' && s !== atual.status) await conferirConclusao(c, id);
        if (s !== atual.status) {
          await c.query(
            `UPDATE tarefas SET status = $1, atualizado_em = now(),
                    realizada_inicio = CASE WHEN $1 IN ('em_andamento','concluida') AND realizada_inicio IS NULL THEN now() ELSE realizada_inicio END,
                    realizada_fim = CASE WHEN $1 = 'concluida' THEN now() ELSE NULL END
              WHERE id = $2`, [s, id]);
          await evento(c, id, u.id, 'status', `${atual.status} → ${s}`);
        }
      }
      if (b.prevista_inicio !== undefined || b.prevista_fim !== undefined) {
        if (!podeGerir) throw new HttpError(403, 'Só o escritório altera datas');
        await c.query(`UPDATE tarefas SET prevista_inicio = $1, prevista_fim = $2, atualizado_em = now() WHERE id = $3`, [
          v.date(b.prevista_inicio !== undefined ? b.prevista_inicio : atual.prevista_inicio, 'A data prevista'),
          v.date(b.prevista_fim !== undefined ? b.prevista_fim : atual.prevista_fim, 'A data prevista'), id]);
      }
      if (b.observacao !== undefined) {
        await c.query(`UPDATE tarefas SET observacao = $1, atualizado_em = now() WHERE id = $2`, [v.str(b.observacao, 'a observação', { max: 2000, opcional: true }), id]);
      }
      return (await c.query(
        `SELECT t.*, p.nome AS responsavel, p.tipo AS responsavel_tipo FROM tarefas t LEFT JOIN pessoas p ON p.id = t.responsavel_id WHERE t.id = $1`, [id])).rows[0];
    });
  });

  // Distribui uma atividade em lote para uma pessoa (ou membro do time) e, opcionalmente, salva como regra do projeto
  app.post('/api/projetos/:id/distribuir', gestao, async (req) => {
    const contrato = v.id(req.params.id);
    const atividade = v.id(req.body.atividade_id, 'Atividade');
    const pessoa = req.body.pessoa_id ? v.id(req.body.pessoa_id, 'Responsável') : null;
    const apenasVazias = req.body.somente_sem_responsavel !== false;
    const enderecos = Array.isArray(req.body.endereco_ids) && req.body.endereco_ids.length
      ? req.body.endereco_ids.map((x) => v.id(x, 'Endereço')) : null;
    if (!pessoa) throw new HttpError(400, 'Escolha para quem enviar');

    return db.tx(async (c) => {
      const ok = (await c.query(`SELECT 1 FROM atividades WHERE id = $1 AND contrato_id = $2`, [atividade, contrato])).rows.length;
      if (!ok) throw new HttpError(400, 'A atividade não pertence a este projeto');
      const p = (await c.query(`SELECT nome FROM pessoas WHERE id = $1 AND ativo`, [pessoa])).rows[0];
      if (!p) throw new HttpError(400, 'Responsável não encontrado');
      const r = await c.query(
        `UPDATE tarefas t SET responsavel_id = $1, atualizado_em = now()
           FROM enderecos e
          WHERE e.id = t.endereco_id AND e.contrato_id = $2 AND t.atividade_id = $3
            AND t.status <> 'concluida'
            AND ($4::boolean = false OR t.responsavel_id IS NULL)
            AND ($5::bigint[] IS NULL OR t.endereco_id = ANY($5))
            AND t.responsavel_id IS DISTINCT FROM $1
          RETURNING t.id`, [pessoa, contrato, atividade, apenasVazias, enderecos]);
      for (const row of r.rows) await evento(c, row.id, req.user.id, 'atribuicao', `distribuição em lote → ${p.nome}`);
      if (req.body.salvar_regra) {
        await c.query(
          `INSERT INTO regras_distribuicao (contrato_id, atividade_id, pessoa_id) VALUES ($1,$2,$3)
           ON CONFLICT (contrato_id, atividade_id) DO UPDATE SET pessoa_id = EXCLUDED.pessoa_id`, [contrato, atividade, pessoa]);
      }
      return { ok: true, atualizadas: r.rowCount };
    });
  });

  // Atividades delegadas a quem não é técnico (administrativo e coordenação)
  app.get('/api/delegadas', escritorio, async (req) => {
    const minhas = req.query.minhas === '1';
    if (minhas && !req.user.pessoa_id) return [];
    return db.many(
      `SELECT t.id, t.status, t.prevista_fim, t.atualizado_em, t.observacao,
              a.nome AS atividade, a.evidencia, e.id AS endereco_id, e.nome AS endereco, e.municipio, e.uf, e.status AS endereco_status,
              ct.id AS contrato_id, ct.numero AS contrato, cl.nome AS cliente,
              p.id AS responsavel_id, p.nome AS responsavel, p.tipo AS responsavel_tipo, p.area
         FROM tarefas t
         JOIN pessoas p ON p.id = t.responsavel_id AND p.tipo <> 'tecnico'
         JOIN atividades a ON a.id = t.atividade_id AND a.ativo
         JOIN enderecos e ON e.id = t.endereco_id
         JOIN contratos ct ON ct.id = e.contrato_id
         JOIN clientes cl ON cl.id = ct.cliente_id
        WHERE ($1::bigint IS NULL OR p.id = $1)
        ORDER BY t.status = 'concluida', t.prevista_fim NULLS LAST, t.atualizado_em DESC
        LIMIT 1000`, [minhas ? req.user.pessoa_id : null]);
  });

  // Atividades do usuário logado (técnico ou qualquer pessoa)
  app.get('/api/minhas-tarefas', leitura, async (req) => {
    if (!req.user.pessoa_id) return [];
    return db.many(
      `SELECT t.id, t.status, t.prevista_inicio, t.prevista_fim, t.atualizado_em, a.nome AS atividade, a.checklist_id, a.evidencia,
              e.id AS endereco_id, e.nome AS endereco, e.municipio, e.uf, e.cameras, e.status AS endereco_status,
              ct.numero AS contrato, cl.nome AS cliente
         FROM tarefas t JOIN atividades a ON a.id = t.atividade_id AND a.ativo
         JOIN enderecos e ON e.id = t.endereco_id JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
        WHERE t.responsavel_id = $1 ORDER BY t.status = 'concluida', t.prevista_inicio NULLS LAST, e.nome LIMIT 500`, [req.user.pessoa_id]);
  });

  app.get('/api/tarefas/:id/eventos', leitura, async (req) => db.many(
    `SELECT ev.id, ev.tipo, ev.detalhe, ev.criado_em, u.nome AS usuario
       FROM tarefa_eventos ev LEFT JOIN usuarios u ON u.id = ev.usuario_id
      WHERE ev.tarefa_id = $1 ORDER BY ev.criado_em DESC LIMIT 200`, [v.id(req.params.id)]));

  app.post('/api/tarefas/:id/comentarios', leitura, async (req) => {
    const id = v.id(req.params.id);
    const texto = v.str(req.body.texto, 'o comentário', { max: 2000 });
    const t = await db.one(`SELECT responsavel_id FROM tarefas WHERE id = $1`, [id]);
    if (!t) throw new HttpError(404, 'Atividade não encontrada');
    if (!pode(req.user, 'projetos', 'ver') && !pode(req.user, 'delegadas', 'ver') && t.responsavel_id !== req.user.pessoa_id) throw new HttpError(403, 'Esta atividade não está com você');
    await db.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,'comentario',$3)`, [id, req.user.id, texto]);
    return { ok: true };
  });
};
