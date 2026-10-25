// Mapa de ruas: as imagens passam pelo servidor (com identificação do app e cache), como pede a política
// de uso do OpenStreetMap — o navegador não chama o servidor de mapas direto. TILE_URL troca a origem; TILE_URL=off desliga.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const { loadUser } = require('../auth');

const PASTA = process.env.TILE_CACHE_DIR || path.join(os.tmpdir(), 'routproject-tiles');
const MEM_MAX = 1500;
const DIAS = 14;
const mem = new Map(); // chave -> Buffer (LRU simples)
const pendentes = new Map();
let ativas = 0;
const fila = [];

function guardarMem(k, buf) {
  mem.delete(k); mem.set(k, buf);
  while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

function baixar(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const contato = config.admin.email ? `; contato ${config.admin.email}` : '';
    const req = lib.get(u, {
      headers: { 'User-Agent': `RoutProject/1.0 (+${config.appUrl}${contato})`, Referer: config.appUrl + '/', Accept: 'image/png,image/*' },
      timeout: 15000,
    }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(partes);
        const tipo = String(res.headers['content-type'] || '');
        if (res.statusCode !== 200 || !tipo.startsWith('image/')) return reject(new Error(`servidor de mapas respondeu ${res.statusCode}`));
        resolve(buf);
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

// no máximo 2 downloads ao mesmo tempo (a política do OSM pede poucas conexões)
function agendar(fn) {
  return new Promise((resolve, reject) => {
    const rodar = async () => { ativas++; try { resolve(await fn()); } catch (e) { reject(e); } finally { ativas--; if (fila.length) fila.shift()(); } };
    if (ativas < 2) rodar(); else fila.push(rodar);
  });
}

async function tile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (mem.has(k)) { const b = mem.get(k); guardarMem(k, b); return b; }
  const arq = path.join(PASTA, String(z), String(x), `${y}.png`);
  try {
    const st = fs.statSync(arq);
    if (Date.now() - st.mtimeMs < DIAS * 86400000) { const b = fs.readFileSync(arq); guardarMem(k, b); return b; }
  } catch (_) { /* não está no disco */ }
  if (pendentes.has(k)) return pendentes.get(k);
  const p = agendar(() => baixar(config.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'abc'[(x + y) % 3])))
    .then((b) => {
      guardarMem(k, b);
      fs.mkdir(path.dirname(arq), { recursive: true }, () => fs.writeFile(arq, b, () => {}));
      return b;
    })
    .finally(() => pendentes.delete(k));
  pendentes.set(k, p);
  return p;
}

const tipoDe = (b) => (b[0] === 0x89 ? 'image/png' : b[0] === 0xff ? 'image/jpeg' : b.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : b[0] === 0x3c ? 'image/svg+xml' : 'image/png');

module.exports = (app) => {
  app.get('/tiles/:z/:x/:y', async (req, res) => {
    const u = await loadUser(req);
    const z = parseInt(req.params.z, 10), x = parseInt(req.params.x, 10), y = parseInt(String(req.params.y).replace(/\.png$/, ''), 10);
    const fim = (st, txt) => { res.writeHead(st, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(txt); };
    if (!u) return fim(401, 'Faça login');
    if (!config.tileUrl) return fim(404, 'Mapa de ruas desligado');
    const n = 2 ** z;
    if (!(z >= 0 && z <= 19 && x >= 0 && x < n && y >= 0 && y < n)) return fim(400, 'Imagem inválida');
    try {
      const b = await tile(z, x, y);
      res.writeHead(200, { 'Content-Type': tipoDe(b), 'Content-Length': b.length, 'Cache-Control': 'private, max-age=604800' });
      res.end(b);
    } catch (e) {
      fim(502, e.message);
    }
  });
};
