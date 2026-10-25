// Usuários e acessos (somente administrador)
const db = require('../db');
const v = require('../validate');
const mail = require('../mail');
const sec = require('../security');
const { HttpError } = require('../http');
const { requer } = require('../auth');

// perfis vêm da tela Permissões
async function perfilValido(codigo, campo = 'Perfil', opcional = false) {
  if ((codigo === undefined || codigo === null || codigo === '') && opcional) return null;
  const p = await db.one(`SELECT codigo FROM perfis WHERE codigo = $1`, [String(codigo || '')]);
  if (!p) throw new HttpError(400, `${campo} inválido`);
  return p.codigo;
}

async function garantirPessoa(client, usuario) {
  const tipo = (await client.query(`SELECT tipo_pessoa FROM perfis WHERE codigo = $1`, [usuario.perfil])).rows[0]?.tipo_pessoa;
  if (!tipo) return;
  const p = await client.query(`SELECT id FROM pessoas WHERE usuario_id = $1`, [usuario.id]);
  if (p.rows.length) {
    await client.query(`UPDATE pessoas SET tipo = $1, nome = $2, ativo = true WHERE id = $3`, [tipo, usuario.nome, p.rows[0].id]);
  } else {
    await client.query(`INSERT INTO pessoas (usuario_id, nome, tipo) VALUES ($1, $2, $3)`, [usuario.id, usuario.nome, tipo]);
  }
}

module.exports = (app) => {
  const admin = requer('admin');

  app.get('/api/usuarios', admin, async (req) => {
    const status = req.query.status ? v.oneOf(req.query.status, 'Status', ['pendente_email', 'pendente_aprovacao', 'ativo', 'inativo']) : null;
    return db.many(
      `SELECT u.id, u.nome, u.email, u.empresa, u.telefone, u.perfil, u.perfil_solicitado, u.status, u.ultimo_acesso, u.criado_em,
              p.id AS pessoa_id, p.tipo AS pessoa_tipo
         FROM usuarios u LEFT JOIN pessoas p ON p.usuario_id = u.id
        WHERE ($1::text IS NULL OR u.status = $1)
        ORDER BY (u.status = 'pendente_aprovacao') DESC, u.nome`, [status]);
  });

  app.post('/api/usuarios/:id/aprovar', admin, async (req) => {
    const id = v.id(req.params.id);
    const perfil = await perfilValido(req.body.perfil);
    const u = await db.tx(async (c) => {
      const r = await c.query(
        `UPDATE usuarios SET status = 'ativo', perfil = $1, atualizado_em = now()
          WHERE id = $2 AND status IN ('pendente_aprovacao','pendente_email','inativo') RETURNING id, nome, email, perfil`, [perfil, id]);
      if (!r.rows.length) throw new HttpError(404, 'Usuário não encontrado ou já ativo');
      await garantirPessoa(c, r.rows[0]);
      return r.rows[0];
    });
    mail.sendApproved(u.email, u.nome).catch((e) => console.error('[mail]', e.message));
    return { ok: true };
  });

  app.patch('/api/usuarios/:id', admin, async (req) => {
    const id = v.id(req.params.id);
    const perfil = await perfilValido(req.body.perfil, 'Perfil', true);
    const status = v.oneOf(req.body.status, 'Status', ['ativo', 'inativo'], { opcional: true });
    if (id === req.user.id && ((status && status !== 'ativo') || (perfil && perfil !== 'admin'))) {
      throw new HttpError(400, 'Você não pode remover o seu próprio acesso de administrador');
    }
    await db.tx(async (c) => {
      const r = await c.query(
        `UPDATE usuarios SET perfil = COALESCE($1, perfil), status = COALESCE($2, status), atualizado_em = now()
          WHERE id = $3 RETURNING id, nome, perfil, status`, [perfil, status, id]);
      if (!r.rows.length) throw new HttpError(404, 'Usuário não encontrado');
      if (r.rows[0].status === 'ativo') await garantirPessoa(c, r.rows[0]);
      if (status === 'inativo') await c.query(`UPDATE pessoas SET ativo = false WHERE usuario_id = $1`, [id]);
    });
    return { ok: true };
  });

  // Cadastro manual de um integrante (já ativo, com senha inicial definida pelo administrador)
  app.post('/api/usuarios', admin, async (req) => {
    const nome = v.str(req.body.nome, 'o nome', { min: 2, max: 120 });
    const email = v.email(req.body.email);
    const perfil = await perfilValido(req.body.perfil);
    const empresa = v.str(req.body.empresa, 'a empresa', { max: 120, opcional: true });
    const telefone = v.str(req.body.telefone, 'o telefone', { max: 30, opcional: true });
    const senha = String(req.body.senha || '');
    if (!sec.senhaValida(senha)) throw new HttpError(400, 'A senha inicial precisa de 8 caracteres ou mais, com letras e números');
    const hash = await sec.hashPassword(senha);
    return db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM usuarios WHERE lower(email) = $1`, [email])).rows.length) throw new HttpError(409, 'Já existe um usuário com esse e-mail');
      const u = (await c.query(
        `INSERT INTO usuarios (nome, email, senha_hash, empresa, telefone, perfil, status) VALUES ($1,$2,$3,$4,$5,$6,'ativo') RETURNING id, nome, email, perfil`,
        [nome, email, hash, empresa, telefone, perfil])).rows[0];
      await garantirPessoa(c, u);
      if (telefone) await c.query(`UPDATE pessoas SET telefone = $1 WHERE usuario_id = $2`, [telefone, u.id]);
      return u;
    });
  });

  // Editar dados de um usuário (nome, e-mail, empresa, telefone) e, se pedido, definir nova senha
  app.put('/api/usuarios/:id', admin, async (req) => {
    const id = v.id(req.params.id);
    const nome = v.str(req.body.nome, 'o nome', { min: 2, max: 120 });
    const email = v.email(req.body.email);
    const empresa = v.str(req.body.empresa, 'a empresa', { max: 120, opcional: true });
    const telefone = v.str(req.body.telefone, 'o telefone', { max: 30, opcional: true });
    const senha = req.body.senha ? String(req.body.senha) : null;
    if (senha && !sec.senhaValida(senha)) throw new HttpError(400, 'A nova senha precisa de 8 caracteres ou mais, com letras e números');
    const hash = senha ? await sec.hashPassword(senha) : null;
    await db.tx(async (c) => {
      if ((await c.query(`SELECT 1 FROM usuarios WHERE lower(email) = $1 AND id <> $2`, [email, id])).rows.length) throw new HttpError(409, 'Já existe outro usuário com esse e-mail');
      const r = await c.query(`UPDATE usuarios SET nome = $1, email = $2, empresa = $3, telefone = $4, senha_hash = COALESCE($5, senha_hash), atualizado_em = now() WHERE id = $6`,
        [nome, email, empresa, telefone, hash, id]);
      if (!r.rowCount) throw new HttpError(404, 'Usuário não encontrado');
      await c.query(`UPDATE pessoas SET nome = $1, telefone = COALESCE($2, telefone) WHERE usuario_id = $3`, [nome, telefone, id]);
    });
    return { ok: true };
  });

  app.delete('/api/usuarios/:id', admin, async (req) => {
    const id = v.id(req.params.id);
    const r = await db.query(`DELETE FROM usuarios WHERE id = $1 AND status IN ('pendente_email','pendente_aprovacao')`, [id]);
    if (!r.rowCount) throw new HttpError(400, 'Só é possível recusar cadastros pendentes. Para os demais, desative.');
    return { ok: true };
  });
};
