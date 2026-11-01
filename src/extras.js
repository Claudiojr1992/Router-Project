// Atividades extras no endereço (ex.: escavação, instalação de poste): incluídas quando aparece a necessidade,
// com quem pediu, quando, por quê e a quantidade. O item faturado da atividade entra no valor do endereço quando ela é concluída.
const v = require('./validate');
const { HttpError } = require('./http');
const { pode, podeAcao } = require('./auth');

const qtd = (x) => (x === undefined || x === null || x === '' ? 1 : v.num(String(x).replace(',', '.'), 'A quantidade', { min: 0.01, max: 100000 }));
const fmtQ = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');

// Item faturado criado junto com a atividade extra (ex.: "Poste" a R$ 850,00 por unidade)
async function itemNovo(c, contratoId, it) {
  if (!it || !String(it.nome || '').trim()) return null;
  const nome = v.str(String(it.nome).replace(/\s+/g, ' '), 'o nome do item', { max: 80 });
  const preco = it.valor_unitario === '' || it.valor_unitario == null ? null : v.num(String(it.valor_unitario).replace(',', '.'), `O valor de "${nome}"`, { min: 0, max: 1e9 });
  const r = await c.query(
    `INSERT INTO contrato_itens (contrato_id, nome, ordem, unidade, valor_unitario, faturavel)
     VALUES ($1, $2, (SELECT COALESCE(max(ordem),0)+1 FROM contrato_itens WHERE contrato_id = $1), NULLIF($3,''), $4::numeric, $4::numeric IS NOT NULL)
     ON CONFLICT (contrato_id, lower(nome)) DO UPDATE SET valor_unitario = COALESCE(EXCLUDED.valor_unitario, contrato_itens.valor_unitario),
       faturavel = contrato_itens.faturavel OR EXCLUDED.faturavel, unidade = COALESCE(EXCLUDED.unidade, contrato_itens.unidade) RETURNING id`,
    [contratoId, nome, String(it.unidade || '').trim().slice(0, 12), preco]);
  return r.rows[0].id;
}

async function evento(c, tarefaId, usuarioId, tipo, detalhe) {
  await c.query(`INSERT INTO tarefa_eventos (tarefa_id, usuario_id, tipo, detalhe) VALUES ($1,$2,$3,$4)`, [tarefaId, usuarioId, tipo, detalhe]);
}

// Quem pode mexer nas atividades do endereço: o escritório (Execução) ou quem tem atividade nele
async function podeNoEndereco(c, user, enderecoId) {
  if (pode(user, 'projetos', 'editar')) return true;
  if (!user.pessoa_id) return false;
  return (await c.query(`SELECT 1 FROM tarefas WHERE endereco_id = $1 AND responsavel_id = $2 LIMIT 1`, [enderecoId, user.pessoa_id])).rows.length > 0;
}

// b: { endereco_id, atividade_id | nova: { nome, checklist_id, item_id }, quantidade, motivo, responsavel_id }
async function criarExtra(c, user, b) {
  if (!podeAcao(user, 'incluir_extra')) throw new HttpError(403, 'Seu perfil não pode incluir atividade extra');
  const enderecoId = v.id(b.endereco_id, 'Endereço');
  const e = (await c.query(`SELECT e.id, e.nome, e.contrato_id, EXISTS (SELECT 1 FROM medicao_enderecos me WHERE me.endereco_id = e.id) AS medido
                              FROM enderecos e WHERE e.id = $1`, [enderecoId])).rows[0];
  if (!e) throw new HttpError(404, 'Endereço não encontrado');
  if (!(await podeNoEndereco(c, user, e.id))) throw new HttpError(403, 'Você não tem atividade neste endereço');

  let a;
  if (b.nova) {
    if (!pode(user, 'atividades', 'editar') && !pode(user, 'projetos', 'editar')) throw new HttpError(403, 'Só o escritório cria um tipo novo de atividade extra. Escolha uma da lista.');
    const nome = v.str(b.nova.nome, 'o nome da atividade extra', { max: 120 });
    const ck = b.nova.checklist_id ? v.id(b.nova.checklist_id, 'Checklist') : null;
    let item = b.nova.item_id ? v.id(b.nova.item_id, 'Item faturado') : null;
    if (ck && !(await c.query(`SELECT 1 FROM checklists WHERE id = $1`, [ck])).rows.length) throw new HttpError(400, 'Checklist não encontrado');
    if (item && !(await c.query(`SELECT 1 FROM contrato_itens WHERE id = $1 AND contrato_id = $2`, [item, e.contrato_id])).rows.length) throw new HttpError(400, 'O item faturado precisa ser um item deste contrato');
    if (!item && b.nova.item_novo) item = await itemNovo(c, e.contrato_id, b.nova.item_novo);
    a = (await c.query(`SELECT id, nome, extra, item_id FROM atividades WHERE contrato_id = $1 AND ativo AND lower(nome) = lower($2)`, [e.contrato_id, nome])).rows[0];
    if (a && !a.extra) throw new HttpError(400, `"${a.nome}" já é uma atividade padrão deste contrato`);
    if (!a) {
      a = (await c.query(
        `INSERT INTO atividades (contrato_id, nome, curto, etapa, tempo_modo, tempo_qtd, tempo_unidade, conta_rota, tempo_impacto, checklist_id, ordem, extra, item_id)
         VALUES ($1,$2,$3,'Extra','fixo',1,'dia',false,'nenhum',$4,(SELECT COALESCE(max(ordem),0)+1 FROM atividades WHERE contrato_id = $1),true,$5)
         RETURNING id, nome, extra, item_id`, [e.contrato_id, nome, nome.slice(0, 40), ck, item])).rows[0];
    }
  } else {
    const aid = v.id(b.atividade_id, 'Atividade extra');
    a = (await c.query(`SELECT id, nome, extra, item_id FROM atividades WHERE id = $1 AND contrato_id = $2 AND ativo`, [aid, e.contrato_id])).rows[0];
    if (!a) throw new HttpError(400, 'Atividade não encontrada neste contrato');
    if (!a.extra) throw new HttpError(400, 'Essa é uma atividade padrão: ela já entra em todos os endereços');
  }

  const quantidade = qtd(b.quantidade);
  const motivo = v.str(b.motivo, 'o motivo', { max: 500, opcional: true });
  let resp = null;
  if (b.responsavel_id) {
    resp = v.id(b.responsavel_id, 'Responsável');
    if (resp !== user.pessoa_id && !podeAcao(user, 'delegar')) throw new HttpError(403, 'Seu perfil não pode passar a atividade para outra pessoa');
    if (!(await c.query(`SELECT 1 FROM pessoas WHERE id = $1 AND ativo`, [resp])).rows.length) throw new HttpError(400, 'Responsável não encontrado');
  } else if (user.pessoa_id && !pode(user, 'projetos', 'editar')) {
    resp = user.pessoa_id; // técnico no campo: a atividade fica com ele
  } else {
    resp = (await c.query(`SELECT pessoa_id FROM regras_distribuicao WHERE contrato_id = $1 AND atividade_id = $2`, [e.contrato_id, a.id])).rows[0]?.pessoa_id || null;
  }

  const t = (await c.query(
    `INSERT INTO tarefas (endereco_id, atividade_id, responsavel_id, extra, quantidade, motivo, solicitado_por, solicitado_em)
     VALUES ($1,$2,$3,true,$4,$5,$6, COALESCE($7::timestamptz, now())) ON CONFLICT (endereco_id, atividade_id) DO NOTHING RETURNING *`,
    [e.id, a.id, resp, quantidade, motivo, user.id, b.em && !Number.isNaN(Date.parse(b.em)) ? new Date(b.em).toISOString() : null])).rows[0];
  if (!t) throw new HttpError(400, `"${a.nome}" já está neste endereço. Abra a atividade e ajuste a quantidade.`);
  await evento(c, t.id, user.id, 'extra', `Atividade extra incluída · quantidade ${fmtQ(quantidade)}${motivo ? ' · motivo: ' + motivo : ''}`);
  return { ...t, atividade: a.nome, item_id: a.item_id, endereco_medido: e.medido };
}

// Quantidade e motivo de uma extra: o escritório sempre; quem pediu, enquanto não foi concluída
async function alterarExtra(c, user, atual, b) {
  if (!atual.extra) throw new HttpError(400, 'Só atividades extras têm quantidade');
  const gestor = pode(user, 'projetos', 'editar');
  if (!gestor && (atual.solicitado_por !== user.id || atual.status === 'concluida')) throw new HttpError(403, 'Só o escritório altera uma atividade extra concluída ou pedida por outra pessoa');
  const q = b.quantidade !== undefined ? qtd(b.quantidade) : Number(atual.quantidade);
  const m = b.motivo !== undefined ? v.str(b.motivo, 'o motivo', { max: 500, opcional: true }) : atual.motivo;
  if (q === Number(atual.quantidade) && m === atual.motivo) return;
  await c.query(`UPDATE tarefas SET quantidade = $1, motivo = $2, atualizado_em = now() WHERE id = $3`, [q, m, atual.id]);
  const mud = [];
  if (q !== Number(atual.quantidade)) mud.push(`quantidade ${fmtQ(atual.quantidade)} → ${fmtQ(q)}`);
  if (m !== atual.motivo) mud.push(`motivo: ${m || '(vazio)'}`);
  await evento(c, atual.id, user.id, 'extra', mud.join(' · '));
}

// Remove uma extra incluída por engano: quem pode excluir registros, ou quem pediu enquanto nada foi feito nela
async function removerExtra(c, user, tarefaId) {
  const t = (await c.query(
    `SELECT t.*, EXISTS (SELECT 1 FROM checklist_respostas r WHERE r.tarefa_id = t.id) OR EXISTS (SELECT 1 FROM evidencias ev WHERE ev.tarefa_id = t.id) AS mexida
       FROM tarefas t WHERE t.id = $1 FOR UPDATE`, [tarefaId])).rows[0];
  if (!t) throw new HttpError(404, 'Atividade não encontrada');
  if (!t.extra) throw new HttpError(400, 'Só atividades extras podem ser removidas do endereço');
  if (!podeAcao(user, 'excluir') && !(t.solicitado_por === user.id && t.status === 'a_fazer' && !t.mexida)) {
    throw new HttpError(403, 'Essa atividade extra já foi iniciada. Peça a quem pode excluir registros.');
  }
  await c.query(`DELETE FROM tarefas WHERE id = $1`, [t.id]);
  return { ok: true };
}

module.exports = { criarExtra, alterarExtra, removerExtra, itemNovo };
