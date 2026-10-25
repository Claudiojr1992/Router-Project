// Função serverless do Vercel: todas as rotas (API, páginas e arquivos) passam pela mesma aplicação.
// Na primeira requisição de cada instância, aplica as migrações pendentes (a trava no banco evita corrida)
// e cria o primeiro administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD.
// Sem DATABASE_URL o app não tem como funcionar: mostra uma página explicando o que falta (em vez de erro 500)
const FALTA_BANCO = !process.env.DATABASE_URL;
const app = FALTA_BANCO ? null : require('../src/app');

let pronto = null;
function preparar() {
  if (!pronto) {
    pronto = require('../scripts/migrate')()
      .then(() => require('../scripts/create-admin')({ onlyIfNone: true })) // ADMIN_EMAIL / ADMIN_PASSWORD, só se ainda não houver admin
      .catch((e) => {
        pronto = null; // tenta de novo na próxima requisição
        console.error('[vercel] preparação do banco falhou:', e.message);
      });
  }
  return pronto;
}

module.exports = async (req, res) => {
  if (FALTA_BANCO) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><title>RoutProject</title><body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.5">'
      + '<h2>RoutProject: falta configurar o banco</h2><p>Crie a variável <b>DATABASE_URL</b> no projeto do Vercel (Settings → Environment Variables, ambiente Production) '
      + 'com a string do <b>Transaction pooler</b> do Supabase (porta 6543) e faça um <b>Redeploy</b>.</p>'
      + '<p>Para o primeiro acesso, crie também <b>ADMIN_EMAIL</b> e <b>ADMIN_PASSWORD</b>.</p></body>');
    return;
  }
  await preparar();
  return app.handler(req, res);
};
