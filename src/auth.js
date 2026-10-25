// Sessão do usuário e controle de acesso pelas permissões do perfil (tela Permissões)
const { one } = require('./db');
const { verifySession } = require('./security');
const { HttpError } = require('./http');
const contexto = require('./contexto');
const perm = require('./permissoes');

const COOKIE = 'rp_session';

// Listas antigas (mantidas para compatibilidade de código; o acesso real vem das permissões do perfil)
const GESTAO = ['admin', 'coordenador', 'supervisor'];
const REABRIR = ['admin', 'coordenador', 'supervisor'];
const ESCRITORIO = ['admin', 'coordenador', 'supervisor', 'administrativo'];
const INTERNOS = ['admin', 'coordenador', 'supervisor', 'administrativo', 'tecnico'];

async function loadUser(req) {
  if (req.user !== undefined) return req.user;
  const data = verifySession(req.cookies[COOKIE]);
  req.user = null;
  if (!data) return null;
  const u = await one(
    `SELECT u.id, u.nome, u.email, u.perfil, u.status, u.empresa, p.id AS pessoa_id
       FROM usuarios u LEFT JOIN pessoas p ON p.usuario_id = u.id
      WHERE u.id = $1`, [data.uid]);
  if (!u || u.status !== 'ativo') return null;
  u.perm = await perm.permissoesDe(u.perfil);
  req.user = u;
  const ctx = contexto.atual();
  if (ctx) ctx.usuario = { id: u.id, nome: u.nome };
  return u;
}

// requer(): exige login e aplica a tabela de permissões da rota (src/permissoes.js).
// As listas de perfis passadas pelas rotas antigas só valem para caminhos que a tabela não conhece.
function requer(...perfis) {
  const lista = perfis.flat();
  return async (req) => {
    const u = await loadUser(req);
    if (!u) throw new HttpError(401, 'Faça login para continuar');
    const r = perm.checarRota(u, req.method, req.path);
    if (r === true) return;
    if (typeof r === 'string') throw new HttpError(403, r);
    if (lista.length && !lista.includes(u.perfil) && u.perfil !== 'admin') throw new HttpError(403, 'Seu perfil não tem acesso a esta ação');
  };
}

const pode = (u, modulo, nivel) => perm.pode(u, modulo, nivel);
const podeAcao = (u, acao) => perm.podeAcao(u, acao);

module.exports = { COOKIE, loadUser, requer, pode, podeAcao, GESTAO, ESCRITORIO, INTERNOS, REABRIR };
