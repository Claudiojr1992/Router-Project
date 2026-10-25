// Função serverless do Vercel: todas as rotas (API, páginas e arquivos) passam pela mesma aplicação.
// Na primeira requisição de cada instância, aplica as migrações pendentes (a trava no banco evita corrida).
const app = require('../src/app');

let pronto = null;
function preparar() {
  if (!pronto) {
    pronto = require('../scripts/migrate')().catch((e) => {
      pronto = null; // tenta de novo na próxima requisição
      console.error('[vercel] migração falhou:', e.message);
    });
  }
  return pronto;
}

module.exports = async (req, res) => {
  await preparar();
  return app.handler(req, res);
};
