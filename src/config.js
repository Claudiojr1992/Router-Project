// Configuração lida das variáveis de ambiente (arquivo .env localmente; Elastic Beanstalk na AWS)
const fs = require('fs');
const path = require('path');

// Carrega .env simples (KEY=valor) se existir — sem dependência externa
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = process.env;

// Banco: DATABASE_URL, ou POSTGRES_URL (criada pela integração Supabase ↔ Vercel). Os parâmetros sslmode/supa da URL
// são retirados: o SSL é configurado por DB_SSL (o certificado do Supabase não está na lista padrão do Node).
function urlDoBanco() {
  const bruta = env.DATABASE_URL || env.POSTGRES_URL || '';
  if (!bruta) return '';
  try {
    const u = new URL(bruta);
    if (u.searchParams.has('sslmode') && env.DB_SSL === undefined) env.DB_SSL = 'true';
    for (const k of ['sslmode', 'supa', 'pgbouncer', 'sslrootcert']) u.searchParams.delete(k);
    return u.toString();
  } catch (_) { return bruta; }
}
const DB_URL = urlDoBanco();
const isProd = env.NODE_ENV === 'production';

const config = {
  isProd,
  port: parseInt(env.PORT || '8080', 10),
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/$/, ''),
  databaseUrl: DB_URL || 'postgres://routproject:routproject@localhost:5432/routproject',
  dbSsl: env.DB_SSL === 'true',
  dbSslCa: env.DB_SSL_CA || '',
  sessionSecret: env.SESSION_SECRET || '',
  sessionHours: parseInt(env.SESSION_HOURS || '12', 10),
  admin: { name: env.ADMIN_NAME || 'Administrador', email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '' },
  seedBnb: env.SEED_BNB === 'true',
  // Mapa de ruas do Painel de rotas (imagens no padrão {z}/{x}/{y}); TILE_URL=off desliga
  tileUrl: env.TILE_URL === 'off' ? '' : (env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  // Cookie só por HTTPS: automático quando APP_URL começa com https://
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : (env.APP_URL || '').startsWith('https://'),
  // Quantos proxies confiáveis ficam na frente do app (1 = só o nginx do Elastic Beanstalk; 2 = load balancer + nginx)
  proxyHops: parseInt(env.TRUST_PROXY_HOPS || '1', 10),
  smtp: {
    host: env.SMTP_HOST || '',
    port: parseInt(env.SMTP_PORT || '587', 10),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'RoutProject <nao-responda@localhost>',
  },
};

// Sem SESSION_SECRET (ex.: Vercel), deriva um segredo da string do banco, que já é secreta no servidor
if ((!config.sessionSecret || config.sessionSecret.length < 24) && isProd && DB_URL) {
  config.sessionSecret = require('crypto').createHash('sha256').update('routproject-session:' + DB_URL).digest('hex');
}

if (!config.sessionSecret || config.sessionSecret.length < 24) {
  if (isProd) {
    console.error('[config] SESSION_SECRET ausente ou curto (mínimo 24 caracteres). Defina antes de subir em produção.');
    process.exit(1);
  }
  config.sessionSecret = 'dev-only-secret-change-me-0123456789';
  console.warn('[config] SESSION_SECRET não definido — usando segredo de desenvolvimento.');
}

module.exports = config;
