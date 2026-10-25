// RoutProject · servidor HTTP (Docker / máquina própria)
const config = require('./config');
const db = require('./db');
const app = require('./app');

const server = app.listen(config.port, () => {
  console.log(`RoutProject ouvindo na porta ${config.port} (${config.isProd ? 'produção' : 'desenvolvimento'})`);
  require('./geocodificar').iniciarRotina();
});

function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando…`);
  server.close(() => db.pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
