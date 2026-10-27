// RoutProject · aplicação (rotas montadas). Usada pelo servidor (src/server.js) e pela função do Vercel (api/index.js)
const path = require('path');
const config = require('./config');
const db = require('./db');
const { createApp } = require('./http');

const app = createApp({ secureCookies: config.cookieSecure, proxyHops: config.proxyHops, publicDir: path.join(__dirname, '..', 'public') });

// Saúde (usado pelo load balancer / Elastic Beanstalk)
app.get('/api/health', async () => {
  await db.query('SELECT 1');
  return { ok: true, app: 'RoutProject' };
});

require('./routes/auth')(app);
require('./routes/usuarios')(app);
require('./routes/cadastros')(app);
require('./routes/equipe')(app);
require('./routes/projetos')(app);
require('./routes/rota')(app);
require('./routes/mobile')(app);
require('./routes/relatorios')(app);
require('./routes/chat')(app);
require('./routes/faturamento')(app);
require('./routes/patrimonio')(app);
require('./routes/conexoes')(app);
require('./routes/admin')(app);
require('./routes/tiles')(app);

// Rotina agendada (Vercel Cron ou chamada manual): localiza endereços sem coordenadas
app.get('/api/cron/geocodificar', async (req) => {
  const segredo = process.env.CRON_SECRET;
  const { HttpError } = require('./http');
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) throw new HttpError(401, 'Não autorizado');
  return require('./geocodificar').processar({ limite: 30 });
});

module.exports = app;
