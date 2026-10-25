// Mini-framework HTTP sobre node:http: rotas com :parâmetros, JSON, cookies, arquivos estáticos e cabeçalhos de segurança.
// Sem dependências externas — mais fácil de auditar e manter.
const http = require('http');
const fs = require('fs');
const path = require('path');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const config = require('./config');
const contexto = require('./contexto');
const origemTiles = (() => { try { return config.tileUrl ? ' ' + new URL(config.tileUrl.replace(/\{s\}/g, 'a')).origin.replace('//a.', '//*.') : ''; } catch (_) { return ''; } })();
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob:${origemTiles}`,
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function securityHeaders(res, secure) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
  return { re: new RegExp(`^${re}/?$`), keys };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Conteúdo grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createApp({ secureCookies = false, publicDir, proxyHops = 1 } = {}) {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    let opts = {};
    if (handlers.length && typeof handlers[0] === 'object') opts = handlers.shift();
    routes.push({ method, ...compile(pattern), handlers, opts });
  };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };

  function decorate(req, res) {
    res.json = (status, obj) => {
      if (res.writableEnded) return;
      const body = JSON.stringify(obj === undefined ? null : obj);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    res.cookie = (name, value, { maxAge, httpOnly = true } = {}) => {
      const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
      if (httpOnly) parts.push('HttpOnly');
      if (secureCookies) parts.push('Secure');
      if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
      const prev = res.getHeader('Set-Cookie');
      res.setHeader('Set-Cookie', prev ? [].concat(prev, parts.join('; ')) : parts.join('; '));
    };
    req.cookies = parseCookies(req.headers.cookie);
    // IP real do cliente: conta os proxies confiáveis a partir da direita do X-Forwarded-For (o cliente pode forjar a parte da esquerda)
    const fwd = proxyHops > 0 && req.headers['x-forwarded-for'];
    if (fwd) {
      const ips = String(fwd).split(',').map((x) => x.trim()).filter(Boolean);
      req.ip = ips[Math.max(0, ips.length - proxyHops)] || req.socket.remoteAddress;
    } else req.ip = req.socket.remoteAddress;
    const ctx = contexto.atual();
    if (ctx) ctx.ip = req.ip;
  }

  function serveStatic(req, res, pathname) {
    if (!publicDir || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let rel;
    try { rel = decodeURIComponent(pathname); } catch (_) { return false; }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return false;
    let st;
    try { st = fs.statSync(file); } catch (_) { return false; }
    if (!st.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size };
    headers['Cache-Control'] = (ext === '.html' || rel.startsWith('/m/')) ? 'no-cache' : (rel.startsWith('/vendor/') ? 'public, max-age=604800' : 'public, max-age=300');
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  }

  async function handle(req, res) {
    securityHeaders(res, secureCookies);
    decorate(req, res);
    const url = new URL(req.url, 'http://local');
    req.path = url.pathname;
    req.query = Object.fromEntries(url.searchParams);

    try {
      const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) {
        if (serveStatic(req, res, url.pathname)) return;
        const allowed = routes.some((r) => r.re.test(url.pathname));
        if (url.pathname.startsWith('/api/')) throw new HttpError(allowed ? 405 : 404, allowed ? 'Método não permitido' : 'Rota não encontrada');
        if (serveStatic(req, res, '/404.html')) return;
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Página não encontrada');
        return;
      }

      const m = url.pathname.match(route.re);
      req.params = {};
      route.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // Proteção CSRF: exige JSON e, quando o navegador informa Origin, que seja o mesmo host
        const origin = req.headers.origin;
        if (origin) {
          let oh;
          try { oh = new URL(origin).host; } catch (_) { oh = ''; }
          const host = req.headers['x-forwarded-host'] || req.headers.host;
          if (oh !== host) throw new HttpError(403, 'Origem não permitida');
        }
        const raw = await readBody(req, route.opts.limit || 1024 * 1024);
        if (raw.length) {
          if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Envie JSON');
          try { req.body = JSON.parse(raw.toString('utf8')); } catch (_) { throw new HttpError(400, 'JSON inválido'); }
        } else {
          req.body = {};
        }
      }

      for (const h of route.handlers) {
        const out = await h(req, res);
        if (res.writableEnded) return;
        if (out !== undefined) { res.json(200, out); return; }
      }
      if (!res.writableEnded) res.json(200, { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.json(err.status, { erro: err.message, ...(err.extra || {}) });
        return;
      }
      if (err && err.code === '23505') { res.json(409, { erro: 'Registro já existe' }); return; }
      if (err && (err.code === '23503')) { res.json(409, { erro: 'Registro vinculado a outros dados' }); return; }
      if (err && (err.code === '23514' || err.code === '22P02' || err.code === '22007')) { res.json(400, { erro: 'Valor inválido' }); return; }
      console.error('[erro]', req.method, req.url, err);
      res.json(500, { erro: 'Erro interno' });
    }
  }

  // Atende uma requisição (servidor próprio ou função serverless do Vercel)
  app.handler = (req, res) => contexto.run({}, () => handle(req, res));
  app.listen = (port, cb) => {
    const server = http.createServer(app.handler);
    server.keepAliveTimeout = 65000; // maior que o idle timeout do load balancer da AWS (60s)
    return server.listen(port, cb);
  };
  return app;
}

module.exports = { createApp, HttpError };
