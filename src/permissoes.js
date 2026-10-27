// Perfis editáveis: cada módulo com nível nenhum | ver | editar, e ações especiais (reabrir, excluir…).
// O acesso às rotas da API é decidido aqui, pela tabela ROTAS (um lugar só para revisar).
const db = require('./db');

const MODULOS = [
  { id: 'rota', nome: 'Projetos · Painel e rotas', grupo: 'Operação', desc: 'Plano de rotas por equipe, mapa, meta, regras e PDF' },
  { id: 'projetos', nome: 'Projetos · Execução', grupo: 'Operação', desc: 'Matriz endereço × atividade, responsáveis, relatórios, assinatura e monitoramento' },
  { id: 'delegadas', nome: 'Tarefas · Delegadas ao escritório', grupo: 'Operação', desc: 'Tarefas enviadas para coordenação e administrativo' },
  { id: 'minhas', nome: 'Tarefas · Comigo', grupo: 'Operação', desc: 'As tarefas da própria pessoa (iniciar, pausar, concluir)' },
  { id: 'app', nome: 'App do técnico', grupo: 'Operação', desc: 'Uso do app no celular, com e sem internet' },
  { id: 'faturamento', nome: 'Faturamento', grupo: 'Operação', desc: 'Medições, nota fiscal e recebimento' },
  { id: 'patrimonio', nome: 'Patrimônio', grupo: 'Operação', desc: 'Ativos com patrimônio e número de série, onde estão e em que situação' },
  { id: 'chat', nome: 'Chat', grupo: 'Operação', desc: 'Conversas, pedidos e ocorrências' },
  { id: 'clientes', nome: 'Projetos · Cadastro e endereços', grupo: 'Cadastros', desc: 'Criar projetos; clientes, contratos, endereços, etapas e equipes' },
  { id: 'empresas', nome: 'Empresas', grupo: 'Cadastros', desc: 'Empresas executoras e parceiras' },
  { id: 'atividades', nome: 'Atividades', grupo: 'Cadastros', desc: 'Atividades de cada contrato e tempos' },
  { id: 'checklists', nome: 'Checklists', grupo: 'Cadastros', desc: 'Checklists e modelo do relatório' },
  { id: 'equipe', nome: 'Técnicos e times', grupo: 'Cadastros', desc: 'Pessoas e times que recebem atividades' },
  { id: 'conexoes', nome: 'Conexões', grupo: 'Cadastros', desc: 'NetBox e Zabbix' },
  { id: 'usuarios', nome: 'Usuários e acessos', grupo: 'Administração', desc: 'Aprovar, criar e editar usuários' },
  { id: 'permissoes', nome: 'Permissões', grupo: 'Administração', desc: 'Perfis e o que cada um pode fazer' },
  { id: 'auditoria', nome: 'Auditoria', grupo: 'Administração', desc: 'Histórico de tudo o que mudou no sistema', soVer: true },
];
const ACOES = [
  { id: 'reabrir', nome: 'Reabrir atividade concluída' },
  { id: 'excluir', nome: 'Excluir endereços, arquivos e registros' },
  { id: 'delegar', nome: 'Trocar o responsável de uma atividade' },
  { id: 'distribuir', nome: 'Distribuir atividades em lote e criar regras' },
  { id: 'forcar_monitoramento', nome: 'Subir ao Zabbix sem concluir as atividades' },
];
const NIVEL = { nenhum: 0, ver: 1, editar: 2 };

// ---------- perfis em memória (recarrega a cada 30 s ou quando alguém salva) ----------
let cache = null, cacheEm = 0;
async function perfis() {
  if (cache && Date.now() - cacheEm < 30000) return cache;
  const rs = await db.many(`SELECT codigo, nome, descricao, sistema, permissoes, acoes, ordem FROM perfis ORDER BY ordem, nome`);
  cache = new Map(rs.map((p) => [p.codigo, p]));
  cacheEm = Date.now();
  return cache;
}
const limparCache = () => { cache = null; };

async function permissoesDe(codigo) {
  const p = (await perfis()).get(codigo);
  return p ? { perfil: p.codigo, nome: p.nome, permissoes: p.permissoes || {}, acoes: p.acoes || {} } : { perfil: codigo, nome: codigo, permissoes: {}, acoes: {} };
}

function pode(u, modulo, nivel = 'ver') {
  if (!u || !u.perm) return false;
  if (u.perfil === 'admin') return true; // o administrador nunca perde o acesso
  const tem = NIVEL[u.perm.permissoes[modulo]] || 0;
  return tem >= NIVEL[nivel];
}
function podeAcao(u, acao) {
  if (!u || !u.perm) return false;
  if (u.perfil === 'admin') return true;
  return !!u.perm.acoes[acao];
}

// ---------- quem pode chamar cada rota da API ----------
// [método (ou *), expressão do caminho, exigência]. Exigência: 'modulo' (GET = ver, demais = editar), 'modulo:nivel',
// lista de alternativas (basta uma) e/ou { acao } que também precisa estar liberada. A primeira linha que casar vale.
const P = (re) => new RegExp('^' + re + '/?$');
const ROTAS = [
  ['*', P('/api/auth/.*'), null],
  ['*', P('/api/perfis(/.*)?'), { GET: ['permissoes:ver', 'usuarios:ver'], default: 'permissoes:editar' }],
  ['*', P('/api/auditoria(/.*)?'), 'auditoria:ver'],
  ['*', P('/api/usuarios(/.*)?'), 'usuarios'],
  // patrimônio (antes das regras gerais de endereços)
  ['GET', P('/api/enderecos/[^/]+/ativos'), { any: ['patrimonio:ver', 'clientes:ver'] }],
  ['DELETE', P('/api/ativos/[^/]+'), ['patrimonio:editar', { acao: 'excluir' }]],
  ['*', P('/api/ativos(/.*)?'), 'patrimonio'],
  // cadastros
  ['DELETE', P('/api/enderecos/[^/]+'), ['clientes:editar', { acao: 'excluir' }]],
  ['POST', P('/api/enderecos/excluir'), ['clientes:editar', { acao: 'excluir' }]],
  ['DELETE', P('/api/arquivos/[^/]+'), ['clientes:editar', { acao: 'excluir' }]],
  ['*', P('/api/enderecos/[^/]+/monitoramento(/.*)?'), 'projetos'],
  ['*', P('/api/contratos/[^/]+/monitoramento(/.*)?'), 'projetos'],
  ['GET', P('/api/enderecos/[^/]+/evidencias\\.zip'), 'projetos:ver'],
  ['GET', P('/api/contratos/[^/]+/atividades'), { any: ['atividades:ver', 'projetos:ver', 'clientes:ver'] }],
  ['*', P('/api/contratos/[^/]+/atividades(/.*)?'), 'atividades:editar'],
  ['*', P('/api/atividades(/.*)?'), 'atividades'],
  ['GET', P('/api/checklists'), { any: ['checklists:ver', 'atividades:ver', 'projetos:ver'] }],
  ['*', P('/api/checklists(/.*)?'), 'checklists'],
  ['GET', P('/api/empresas'), { any: ['empresas:ver', 'clientes:ver', 'faturamento:ver'] }],
  ['*', P('/api/empresas(/.*)?'), 'empresas'],
  ['*', P('/api/clientes/[^/]+/distribuir(/.*)?'), { any: ['clientes:editar', 'rota:editar'] }],
  ['GET', P('/api/clientes(/.*)?'), { any: ['clientes:ver', 'rota:ver', 'projetos:ver'] }],
  ['*', P('/api/(clientes|contratos|enderecos|arquivos)(/.*)?'), 'clientes'],
  // equipe
  ['GET', P('/api/(pessoas|times)(/.*)?'), { any: ['equipe:ver', 'projetos:ver', 'delegadas:ver', 'clientes:ver'] }],
  ['*', P('/api/(pessoas|times)(/.*)?'), 'equipe'],
  // conexões
  ['GET', P('/api/conexoes/zabbix/opcoes'), { any: ['conexoes:ver', 'projetos:ver'] }],
  ['POST', P('/api/conexoes/[^/]+/(importar|enviar)'), { any: ['conexoes:editar', 'clientes:editar'] }],
  ['GET', P('/api/conexoes/[^/]+/sites'), { any: ['conexoes:ver', 'clientes:editar'] }],
  ['*', P('/api/conexoes(/.*)?'), 'conexoes'],
  // operação
  ['*', P('/api/(faturamento|medicoes)(/.*)?'), 'faturamento'],
  ['*', P('/api/chat(/.*)?'), 'chat'],
  ['*', P('/api/mobile(/.*)?'), { any: ['app', 'minhas'] }],
  ['POST', P('/api/projetos/[^/]+/distribuir'), ['projetos:editar', { acao: 'distribuir' }]],
  ['*', P('/api/projetos(/.*)?'), 'projetos'],
  ['GET', P('/api/delegadas'), 'delegadas:ver'],
  ['GET', P('/api/minhas-tarefas'), 'minhas:ver'],
  ['GET', P('/api/tarefas/[^/]+/(evidencias\\.zip|assinatura)'), 'projetos:ver'],
  ['POST', P('/api/tarefas/[^/]+/assinatura'), 'projetos:editar'],
  ['*', P('/api/(tarefas|fotos)(/.*)?'), { any: ['minhas', 'projetos', 'delegadas', 'app'] }],
  ['GET', P('/api/carteira'), { any: ['rota:ver', 'projetos:ver', 'clientes:ver'] }],
  ['*', P('/api/rota(/.*)?'), 'rota'],
];

function exige(spec, metodo) {
  // devolve lista de alternativas [{mod, nivel}] e ações exigidas
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && (spec.GET || spec.default)) spec = metodo === 'GET' ? spec.GET : spec.default;
  const padrao = metodo === 'GET' ? 'ver' : 'editar';
  const lerUm = (s) => { const [mod, nivel] = String(s).split(':'); return { mod, nivel: nivel || padrao }; };
  let alternativas = [], acoes = [];
  const lista = Array.isArray(spec) ? spec : [spec];
  for (const s of lista) {
    if (s && typeof s === 'object' && s.acao) acoes.push(s.acao);
    else if (s && typeof s === 'object' && s.any) alternativas.push(...s.any.map(lerUm));
    else if (typeof s === 'string') alternativas.push(lerUm(s));
  }
  return { alternativas, acoes };
}

// true = liberado; string = motivo da recusa; null = rota não listada
function checarRota(u, metodo, caminho) {
  const r = ROTAS.find(([m, re]) => (m === '*' || m === metodo) && re.test(caminho));
  if (!r) return null;
  if (!r[2]) return true;
  const { alternativas, acoes } = exige(r[2], metodo);
  if (alternativas.length && !alternativas.some((a) => pode(u, a.mod, a.nivel))) {
    const a = alternativas[0], m = MODULOS.find((x) => x.id === a.mod);
    return `Seu perfil não pode ${a.nivel === 'editar' ? 'alterar' : 'ver'} ${m ? m.nome : a.mod}`;
  }
  for (const ac of acoes) if (!podeAcao(u, ac)) return `Seu perfil não tem a permissão: ${(ACOES.find((x) => x.id === ac) || {}).nome || ac}`;
  return true;
}

// Normaliza o que vem da tela de permissões
function normalizar(b) {
  const permissoes = {}, acoes = {};
  for (const m of MODULOS) {
    let n = String((b.permissoes || {})[m.id] || 'nenhum');
    if (!(n in NIVEL)) n = 'nenhum';
    if (m.soVer && n === 'editar') n = 'ver';
    permissoes[m.id] = n;
  }
  for (const a of ACOES) acoes[a.id] = !!(b.acoes || {})[a.id];
  return { permissoes, acoes };
}

module.exports = { MODULOS, ACOES, NIVEL, perfis, limparCache, permissoesDe, pode, podeAcao, checarRota, normalizar, ROTAS };
