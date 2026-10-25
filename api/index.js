// Função serverless do Vercel: todas as rotas (API, páginas e arquivos) passam pela mesma aplicação.
// Na primeira requisição de cada instância, aplica as migrações pendentes (a trava no banco evita corrida)
// e cria o primeiro administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD.
const app = require('../src/app');

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
  await preparar();
  return app.handler(req, res);
};
