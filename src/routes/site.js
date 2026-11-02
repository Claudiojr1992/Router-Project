// Site comercial: formulário de demonstração (público) e lista de contatos para a equipe comercial
const db = require('../db');
const v = require('../validate');
const config = require('../config');
const mail = require('../mail');
const { HttpError } = require('../http');
const { requer, INTERNOS } = require('../auth');

const STATUS = ['novo', 'em_contato', 'proposta', 'fechado', 'descartado'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function limitar(ip) {
  const r = await db.one(
    `INSERT INTO tentativas (chave, contagem, expira_em) VALUES ($1, 1, now() + interval '60 minutes')
     ON CONFLICT (chave) DO UPDATE SET
       contagem = CASE WHEN tentativas.expira_em < now() THEN 1 ELSE tentativas.contagem + 1 END,
       expira_em = CASE WHEN tentativas.expira_em < now() THEN now() + interval '60 minutes' ELSE tentativas.expira_em END
     RETURNING contagem`, [`contato:${ip}`]);
  if (r.contagem > 5) throw new HttpError(429, 'Recebemos vários pedidos deste acesso. Tente de novo em 1 hora ou escreva para o nosso e-mail.');
}

module.exports = (app) => {
  const leitura = requer(INTERNOS);

  // Pedido de demonstração enviado pelo site (sem login)
  app.post('/api/site/contato', async (req) => {
    const b = req.body || {};
    if (b.site) return { ok: true }; // campo escondido preenchido = robô
    const dados = [
      v.str(b.nome, 'o seu nome', { max: 120 }),
      v.str(b.empresa, 'a empresa', { max: 160, opcional: true }),
      v.email(b.email),
      v.str(b.telefone, 'o telefone', { max: 40, opcional: true }),
      v.str(b.enderecos, 'a quantidade de endereços', { max: 40, opcional: true }),
      v.str(b.interesse, 'o interesse', { max: 200, opcional: true }),
      v.str(b.mensagem, 'a mensagem', { max: 2000, opcional: true }),
      v.str(b.origem, 'a origem', { max: 60, opcional: true }),
    ];
    await limitar(req.ip);
    const c = await db.tx(async (tx) => (await tx.query(
      `INSERT INTO contatos (nome, empresa, email, telefone, enderecos, interesse, mensagem, origem, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, criado_em`,
      [...dados, String(req.ip || '').slice(0, 60)])).rows[0]);
    // avisa a equipe comercial (se o e-mail estiver configurado); o contato fica salvo de qualquer jeito
    const para = process.env.SITE_CONTATO_EMAIL || (config.admin && config.admin.email);
    if (para) {
      const linhas = [['Nome', dados[0]], ['Empresa', dados[1]], ['E-mail', dados[2]], ['Telefone', dados[3]], ['Endereços por ano', dados[4]], ['Interesse', dados[5]], ['Mensagem', dados[6]]]
        .filter(([, x]) => x).map(([k, x]) => `<tr><td style="padding:4px 12px 4px 0;color:#5B6B68">${k}</td><td style="padding:4px 0">${esc(x)}</td></tr>`).join('');
      mail.send(para, `Pedido de demonstração: ${dados[1] || dados[0]}`, `<p>Novo contato pelo site do RoutProject.</p><table>${linhas}</table><p>Veja e acompanhe em Contatos do site.</p>`,
        `Novo contato pelo site: ${dados[0]} (${dados[2]})`).catch(() => {});
    }
    return { ok: true, id: c.id };
  });

  app.get('/api/contatos', leitura, async (req) => db.many(
    `SELECT id, nome, empresa, email, telefone, enderecos, interesse, mensagem, origem, status, nota, criado_em, atualizado_em
       FROM contatos WHERE ($1::text IS NULL OR status = $1) ORDER BY criado_em DESC LIMIT 1000`,
    [req.query.status && STATUS.includes(req.query.status) ? req.query.status : null]));

  app.patch('/api/contatos/:id', leitura, async (req) => db.tx(async (c) => {
    const id = v.id(req.params.id);
    const atual = (await c.query(`SELECT * FROM contatos WHERE id = $1`, [id])).rows[0];
    if (!atual) throw new HttpError(404, 'Contato não encontrado');
    const status = req.body.status !== undefined ? v.oneOf(req.body.status, 'Status', STATUS) : atual.status;
    const nota = req.body.nota !== undefined ? v.str(req.body.nota, 'a anotação', { max: 4000, opcional: true }) : atual.nota;
    return (await c.query(`UPDATE contatos SET status = $1, nota = $2, atualizado_em = now() WHERE id = $3 RETURNING *`, [status, nota, id])).rows[0];
  }));
};
