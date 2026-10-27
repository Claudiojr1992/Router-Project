// Login, cadastro, confirmação de e-mail e recuperação de senha
const db = require('../db');
const sec = require('../security');
const mail = require('../mail');
const v = require('../validate');
const config = require('../config');
const { HttpError } = require('../http');
const { COOKIE, loadUser, requer } = require('../auth');

const PERFIS_SOLICITAVEIS = ['tecnico', 'coordenador', 'supervisor', 'administrativo', 'cliente'];
const MIN = 60 * 1000;

// Limite de tentativas guardado no banco (vale para todas as instâncias do servidor)
async function contar(chave, max, janelaMin) {
  const r = await db.one(
    `INSERT INTO tentativas (chave, contagem, expira_em) VALUES ($1, 1, now() + make_interval(mins => $2))
     ON CONFLICT (chave) DO UPDATE SET
       contagem = CASE WHEN tentativas.expira_em < now() THEN 1 ELSE tentativas.contagem + 1 END,
       expira_em = CASE WHEN tentativas.expira_em < now() THEN now() + make_interval(mins => $2) ELSE tentativas.expira_em END
     RETURNING contagem, expira_em`, [chave, janelaMin]);
  if (Math.random() < 0.02) db.query(`DELETE FROM tentativas WHERE expira_em < now()`).catch(() => {});
  return r.contagem <= max ? null : r.expira_em;
}
async function limitar(req, chave, max, janelaMin, extra = null) {
  const ate = (await contar(`${chave}:${req.ip}`, max, janelaMin)) || (extra && (await contar(`${chave}:${extra}`, max, janelaMin)));
  if (ate) {
    const min = Math.max(1, Math.ceil((new Date(ate) - Date.now()) / MIN));
    throw new HttpError(429, `Muitas tentativas. Tente de novo em ${min} minuto(s).`);
  }
}
const zerar = (...chaves) => db.query(`DELETE FROM tentativas WHERE chave = ANY($1)`, [chaves]).catch(() => {});
const registrar = (acao, u, ip, resumo) => db.query(`INSERT INTO auditoria (usuario_id, usuario_nome, ip, acao, tabela, registro_id, resumo) VALUES ($1,$2,$3,$4,'usuarios',$5,$6)`,
  [u ? u.id : null, u ? u.nome : null, ip || null, acao, u ? String(u.id) : null, resumo]).catch(() => {});

async function criarCodigo(usuarioId, tipo, minutos) {
  const codigo = sec.newCode();
  await db.query(`UPDATE codigos SET usado = true WHERE usuario_id = $1 AND tipo = $2 AND NOT usado`, [usuarioId, tipo]);
  await db.query(
    `INSERT INTO codigos (usuario_id, tipo, codigo_hash, expira_em) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [usuarioId, tipo, sec.hashCode(codigo), String(minutos)]);
  return codigo;
}

async function conferirCodigo(usuarioId, tipo, codigo) {
  const c = await db.one(
    `SELECT id, codigo_hash, tentativas FROM codigos
      WHERE usuario_id = $1 AND tipo = $2 AND NOT usado AND expira_em > now()
      ORDER BY id DESC LIMIT 1`, [usuarioId, tipo]);
  if (!c) throw new HttpError(400, 'Código expirado. Peça um novo código.');
  if (c.tentativas >= 5) throw new HttpError(400, 'Código bloqueado por tentativas. Peça um novo código.');
  if (c.codigo_hash !== sec.hashCode(String(codigo || '').trim())) {
    await db.query(`UPDATE codigos SET tentativas = tentativas + 1 WHERE id = $1`, [c.id]);
    throw new HttpError(400, 'Código incorreto');
  }
  await db.query(`UPDATE codigos SET usado = true WHERE id = $1`, [c.id]);
}

function publico(u) {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, empresa: u.empresa, pessoa_id: u.pessoa_id || null,
    perfil_nome: u.perm ? u.perm.nome : u.perfil, permissoes: u.perm ? u.perm.permissoes : {}, acoes: u.perm ? u.perm.acoes : {}, trocar_senha: !!u.trocar_senha };
}

module.exports = (app) => {
  app.post('/api/auth/cadastro', async (req) => {
    await limitar(req, 'cadastro', 10, 60);
    const b = req.body;
    const nome = v.str(b.nome, 'o nome', { min: 3, max: 120 });
    const email = v.email(b.email);
    const empresa = v.str(b.empresa, 'a empresa', { max: 120, opcional: true });
    const perfil = String(b.perfil_solicitado || 'tecnico');
    if (perfil === 'admin' || !(await db.one(`SELECT 1 AS ok FROM perfis WHERE codigo = $1`, [perfil]))) throw new HttpError(400, 'O perfil é inválido');
    if (!sec.senhaValida(b.senha)) throw new HttpError(400, 'A senha precisa de 8 caracteres ou mais, com letras e números');
    if (b.aceite !== true) throw new HttpError(400, 'É preciso aceitar os termos de uso');

    const existente = await db.one(`SELECT id, nome, status FROM usuarios WHERE lower(email) = $1`, [email]);
    if (existente) {
      // Não revela se o e-mail já existe; reenvia o código se ainda estiver pendente
      if (existente.status === 'pendente_email') {
        const codigo = await criarCodigo(existente.id, 'confirmar', 30);
        await mail.sendConfirmCode(email, existente.nome, codigo);
      }
      return { ok: true, email };
    }
    const hash = await sec.hashPassword(b.senha);
    const u = await db.one(
      `INSERT INTO usuarios (nome, email, senha_hash, empresa, perfil, perfil_solicitado, status)
       VALUES ($1, $2, $3, $4, 'tecnico', $5, 'pendente_email') RETURNING id`,
      [nome, email, hash, empresa, perfil]);
    const codigo = await criarCodigo(u.id, 'confirmar', 30);
    await mail.sendConfirmCode(email, nome, codigo);
    return { ok: true, email };
  });

  app.post('/api/auth/confirmar', async (req) => {
    await limitar(req, 'confirmar', 20, 15);
    const email = v.email(req.body.email);
    const u = await db.one(`SELECT id, status FROM usuarios WHERE lower(email) = $1`, [email]);
    if (!u || u.status !== 'pendente_email') throw new HttpError(400, 'Código expirado. Peça um novo código.');
    await conferirCodigo(u.id, 'confirmar', req.body.codigo);
    await db.query(`UPDATE usuarios SET status = 'pendente_aprovacao', atualizado_em = now() WHERE id = $1`, [u.id]);
    return { ok: true, status: 'pendente_aprovacao' };
  });

  app.post('/api/auth/reenviar', async (req) => {
    await limitar(req, 'reenviar', 5, 15);
    const email = v.email(req.body.email);
    const u = await db.one(`SELECT id, nome, status FROM usuarios WHERE lower(email) = $1`, [email]);
    if (u && u.status === 'pendente_email') {
      const codigo = await criarCodigo(u.id, 'confirmar', 30);
      await mail.sendConfirmCode(email, u.nome, codigo);
    }
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = v.email(req.body.email);
    await limitar(req, 'login', 10, 10, 'email:' + email);
    const senha = String(req.body.senha || '');
    const u = await db.one(`SELECT id, nome, email, perfil, status, empresa, senha_hash FROM usuarios WHERE lower(email) = $1`, [email]);
    const ok = u ? await sec.verifyPassword(senha, u.senha_hash) : await sec.verifyPassword(senha, 'scrypt$16384$8$1$AAAA$AAAA');
    if (!u || !ok) { await registrar('login_falhou', u, req.ip, `Senha incorreta para ${email}`); throw new HttpError(401, 'E-mail ou senha incorretos'); }
    if (u.status === 'pendente_email') throw new HttpError(403, 'Confirme seu e-mail antes de entrar', { status: u.status });
    if (u.status === 'pendente_aprovacao') throw new HttpError(403, 'Seu cadastro aguarda aprovação do administrador', { status: u.status });
    if (u.status !== 'ativo') throw new HttpError(403, 'Acesso desativado. Fale com o administrador.', { status: u.status });

    // senha que não segue a regra atual (ex.: senha de teste): entra, mas precisa trocar antes de usar o sistema
    if (!sec.senhaValida(senha)) await db.query(`UPDATE usuarios SET trocar_senha = true WHERE id = $1`, [u.id]);
    const lembrar = req.body.lembrar === true;
    const token = sec.signSession({ uid: u.id });
    res.cookie(COOKIE, token, { maxAge: lembrar ? config.sessionHours * 3600 * 1000 : undefined });
    await db.query(`UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1`, [u.id]);
    await zerar(`login:${req.ip}`, `login:email:${email}`);
    await registrar('login', u, req.ip, 'Entrou no sistema');
    req.user = undefined;
    req.cookies[COOKIE] = token;
    return { ok: true, usuario: publico(await loadUser(req)) };
  });

  app.post('/api/auth/logout', async (req, res) => {
    res.cookie(COOKIE, '', { maxAge: 0 });
    return { ok: true };
  });

  app.get('/api/auth/me', requer(), async (req) => ({ usuario: publico(req.user) }));

  // Meus dados: nome, empresa e telefone (o e-mail identifica o acesso e só o administrador muda)
  app.get('/api/auth/meus-dados', requer(), async (req) => db.one(
    `SELECT id, nome, email, empresa, telefone, perfil, criado_em, ultimo_acesso FROM usuarios WHERE id = $1`, [req.user.id]));
  app.put('/api/auth/meus-dados', requer(), async (req) => {
    const nome = v.str(req.body.nome, 'o nome', { min: 2, max: 120 });
    const empresa = v.str(req.body.empresa, 'a empresa', { max: 120, opcional: true });
    const telefone = v.str(req.body.telefone, 'o telefone', { max: 30, opcional: true });
    await db.tx(async (c) => {
      await c.query(`UPDATE usuarios SET nome = $1, empresa = $2, telefone = $3, atualizado_em = now() WHERE id = $4`, [nome, empresa, telefone, req.user.id]);
      await c.query(`UPDATE pessoas SET nome = $1, telefone = COALESCE($2, telefone) WHERE usuario_id = $3`, [nome, telefone, req.user.id]);
    });
    return { ok: true };
  });

  app.post('/api/auth/esqueci', async (req) => {
    await limitar(req, 'esqueci', 5, 15);
    const email = v.email(req.body.email);
    const u = await db.one(`SELECT id, nome, status FROM usuarios WHERE lower(email) = $1`, [email]);
    if (u && u.status === 'ativo') {
      const codigo = await criarCodigo(u.id, 'reset', 15);
      await mail.sendResetCode(email, u.nome, codigo);
    }
    return { ok: true }; // mesma resposta exista ou não o e-mail
  });

  app.post('/api/auth/redefinir', async (req) => {
    await limitar(req, 'redefinir', 10, 15);
    const email = v.email(req.body.email);
    if (!sec.senhaValida(req.body.senha)) throw new HttpError(400, 'A senha precisa de 8 caracteres ou mais, com letras e números');
    const u = await db.one(`SELECT id, status FROM usuarios WHERE lower(email) = $1`, [email]);
    if (!u || u.status !== 'ativo') throw new HttpError(400, 'Código expirado. Peça um novo código.');
    await conferirCodigo(u.id, 'reset', req.body.codigo);
    await db.query(`UPDATE usuarios SET senha_hash = $1, trocar_senha = false, atualizado_em = now() WHERE id = $2`, [await sec.hashPassword(req.body.senha), u.id]);
    return { ok: true };
  });

  app.post('/api/auth/senha', requer(), async (req) => {
    await limitar(req, 'senha', 10, 15);
    const atual = await db.one(`SELECT senha_hash FROM usuarios WHERE id = $1`, [req.user.id]);
    if (!(await sec.verifyPassword(String(req.body.atual || ''), atual.senha_hash))) throw new HttpError(400, 'Senha atual incorreta');
    if (!sec.senhaValida(req.body.nova)) throw new HttpError(400, 'A nova senha precisa de 8 caracteres ou mais, com letras e números');
    if (String(req.body.nova) === String(req.body.atual)) throw new HttpError(400, 'A nova senha precisa ser diferente da atual');
    await db.query(`UPDATE usuarios SET senha_hash = $1, trocar_senha = false, atualizado_em = now() WHERE id = $2`, [await sec.hashPassword(req.body.nova), req.user.id]);
    return { ok: true };
  });
};
