// Permissões (perfis editáveis) e Auditoria (histórico de tudo o que muda no sistema)
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer } = require('../auth');
const perm = require('../permissoes');

const TABELAS = ['clientes', 'contratos', 'contrato_arquivos', 'contrato_itens', 'empresas', 'enderecos', 'etapas', 'equipe_regras', 'atividades', 'checklists',
  'checklist_itens', 'pessoas', 'times', 'time_membros', 'tarefas', 'regras_distribuicao', 'usuarios', 'perfis', 'medicoes', 'medicao_enderecos', 'integracoes',
  'monitoramento_ativos', 'relatorio_assinaturas', 'ativos'];

function perfilBody(b, novo) {
  const out = {
    nome: v.str(b.nome, 'o nome do perfil', { max: 60 }),
    descricao: v.str(b.descricao, 'a descrição', { max: 200, opcional: true }),
    tipo_pessoa: b.tipo_pessoa ? v.oneOf(b.tipo_pessoa, 'Tipo em Técnicos e times', ['tecnico', 'coordenacao', 'administrativo']) : null,
    ...perm.normalizar(b),
  };
  if (novo) {
    out.codigo = String(b.codigo || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(out.codigo)) throw new HttpError(400, 'Código do perfil inválido (letras minúsculas, números e _)');
  }
  return out;
}

module.exports = (app) => {
  const logado = requer();

  // ---------- Permissões ----------
  app.get('/api/perfis', logado, async () => {
    const ps = await db.many(`SELECT p.*, (SELECT count(*)::int FROM usuarios u WHERE u.perfil = p.codigo AND u.status <> 'inativo') AS usuarios FROM perfis p ORDER BY ordem, nome`);
    return { perfis: ps, modulos: perm.MODULOS, acoes: perm.ACOES };
  });

  app.post('/api/perfis', logado, async (req) => {
    const p = perfilBody(req.body, true);
    if (await db.one(`SELECT 1 AS ok FROM perfis WHERE codigo = $1`, [p.codigo])) throw new HttpError(409, 'Já existe um perfil com esse código');
    await db.query(`INSERT INTO perfis (codigo, nome, descricao, tipo_pessoa, permissoes, acoes, ordem) VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(max(ordem),0)+1 FROM perfis))`,
      [p.codigo, p.nome, p.descricao, p.tipo_pessoa, p.permissoes, p.acoes]);
    perm.limparCache();
    return { ok: true, codigo: p.codigo };
  });

  app.put('/api/perfis/:codigo', logado, async (req) => {
    const codigo = String(req.params.codigo);
    const atual = await db.one(`SELECT codigo, sistema FROM perfis WHERE codigo = $1`, [codigo]);
    if (!atual) throw new HttpError(404, 'Perfil não encontrado');
    const p = perfilBody(req.body, false);
    if (codigo === 'admin') { // o administrador mantém acesso total; só nome e descrição mudam
      await db.query(`UPDATE perfis SET nome = $1, descricao = $2, atualizado_em = now() WHERE codigo = 'admin'`, [p.nome, p.descricao]);
    } else {
      await db.query(`UPDATE perfis SET nome = $1, descricao = $2, tipo_pessoa = $3, permissoes = $4, acoes = $5, atualizado_em = now() WHERE codigo = $6`,
        [p.nome, p.descricao, p.tipo_pessoa, p.permissoes, p.acoes, codigo]);
    }
    perm.limparCache();
    return { ok: true };
  });

  app.delete('/api/perfis/:codigo', logado, async (req) => {
    const codigo = String(req.params.codigo);
    const p = await db.one(`SELECT sistema, (SELECT count(*)::int FROM usuarios WHERE perfil = $1) AS n FROM perfis WHERE codigo = $1`, [codigo]);
    if (!p) throw new HttpError(404, 'Perfil não encontrado');
    if (p.sistema) throw new HttpError(400, 'Perfis do sistema podem ser editados, mas não excluídos');
    if (p.n) throw new HttpError(400, `${p.n} usuário(s) usam este perfil. Mude o perfil deles antes de excluir.`);
    await db.query(`DELETE FROM perfis WHERE codigo = $1`, [codigo]);
    perm.limparCache();
    return { ok: true };
  });

  // ---------- Auditoria ----------
  // Filtros: usuario, tabela, acao, registro, de, ate (AAAA-MM-DD), q (texto), antes (id para a próxima página)
  app.get('/api/auditoria', logado, async (req) => {
    const q = req.query, w = [], p = [];
    const add = (sql, val) => { p.push(val); w.push(sql.replace('?', `$${p.length}`)); };
    if (q.usuario) add('a.usuario_id = ?', v.id(q.usuario, 'Usuário'));
    if (q.sistema === '1') w.push('a.usuario_id IS NULL');
    if (q.tabela) add('a.tabela = ?', v.oneOf(q.tabela, 'Área', TABELAS));
    if (q.acao) add('a.acao = ?', v.oneOf(q.acao, 'Ação', ['insert', 'update', 'delete', 'login', 'login_falhou']));
    if (q.registro) add('a.registro_id = ?', String(q.registro).slice(0, 40));
    if (q.de) add('a.criado_em >= ?::date', v.date(q.de, 'A data inicial'));
    if (q.ate) add("a.criado_em < (?::date + interval '1 day')", v.date(q.ate, 'A data final'));
    if (q.q) add("(COALESCE(a.antes::text,'') || COALESCE(a.depois::text,'') || COALESCE(a.resumo,'') || COALESCE(a.usuario_nome,'')) ILIKE ?", '%' + String(q.q).slice(0, 80).replace(/[%_\\]/g, (c) => '\\' + c) + '%');
    if (q.antes) add('a.id < ?', v.id(q.antes, 'Página'));
    const limite = Math.min(200, Math.max(10, parseInt(q.limite, 10) || 80));
    p.push(limite);
    const linhas = await db.many(
      `SELECT a.*, CASE a.tabela
                WHEN 'enderecos' THEN (SELECT e.nome || ' · ' || e.municipio || '/' || e.uf FROM enderecos e WHERE e.id::text = a.registro_id)
                WHEN 'clientes' THEN (SELECT c.nome FROM clientes c WHERE c.id::text = a.registro_id)
                WHEN 'contratos' THEN (SELECT cl.nome || ' · ' || ct.numero FROM contratos ct JOIN clientes cl ON cl.id = ct.cliente_id WHERE ct.id::text = a.registro_id)
                WHEN 'usuarios' THEN (SELECT u.nome FROM usuarios u WHERE u.id::text = a.registro_id)
                WHEN 'empresas' THEN (SELECT x.nome FROM empresas x WHERE x.id::text = a.registro_id)
                WHEN 'ativos' THEN (SELECT COALESCE(x.patrimonio, x.numero_serie) FROM ativos x WHERE x.id::text = a.registro_id)
                WHEN 'tarefas' THEN (SELECT at.nome || ' · ' || e.nome FROM tarefas t JOIN atividades at ON at.id = t.atividade_id JOIN enderecos e ON e.id = t.endereco_id WHERE t.id::text = a.registro_id)
                ELSE NULL END AS registro_nome
         FROM auditoria a ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT $${p.length}`, p);
    return { linhas, mais: linhas.length === limite ? linhas[linhas.length - 1].id : null };
  });

  // Histórico de um registro (aparece no próprio cadastro): endereço, contrato ou cliente
  for (const [rota, tabela] of [['enderecos', 'enderecos'], ['contratos', 'contratos'], ['clientes', 'clientes'], ['ativos', 'ativos']]) {
    app.get(`/api/${rota}/:id/historico`, logado, async (req) => db.many(
      `SELECT id, criado_em, usuario_nome, ip, acao, antes, depois FROM auditoria WHERE tabela = $1 AND registro_id = $2 ORDER BY id DESC LIMIT 100`,
      [tabela, String(v.id(req.params.id))]));
  }

  app.get('/api/auditoria/filtros', logado, async () => ({
    usuarios: await db.many(`SELECT DISTINCT a.usuario_id AS id, COALESCE(u.nome, a.usuario_nome) AS nome FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.usuario_id IS NOT NULL ORDER BY 2`),
    tabelas: TABELAS,
    resumo: await db.one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE criado_em > now() - interval '1 day')::int AS hoje,
                                 count(*) FILTER (WHERE acao = 'login_falhou' AND criado_em > now() - interval '1 day')::int AS falhas_hoje FROM auditoria`),
  }));
};
