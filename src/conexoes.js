// Clientes do NetBox (REST) e do Zabbix (JSON-RPC), sem dependências: node:http/https
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./http');

// ---------- token guardado criptografado (AES-256-GCM, chave derivada do SESSION_SECRET) ----------
const CHAVE = crypto.createHash('sha256').update(config.sessionSecret + '|integracoes').digest();
function cifrar(txt) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CHAVE, iv);
  const enc = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decifrar(s) {
  if (!s) return '';
  try {
    const [iv, tag, enc] = s.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', CHAVE, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (_) {
    throw new HttpError(400, 'Não foi possível ler o token salvo (o SESSION_SECRET mudou?). Informe o token de novo em Conexões.');
  }
}

// ---------- requisição HTTP(S) com tempo limite e opção de aceitar certificado próprio ----------
const LIMITE = 25 * 1024 * 1024;
function requisicao(url, { method = 'GET', headers = {}, body = null, inseguro = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (_) { return reject(new HttpError(400, 'Endereço (URL) inválido')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new HttpError(400, 'Use um endereço http:// ou https://'));
    const lib = u.protocol === 'https:' ? https : http;
    const dados = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request(u, {
      method,
      headers: { Accept: 'application/json', 'User-Agent': 'RoutProject', ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}), ...headers },
      timeout,
      ...(u.protocol === 'https:' && inseguro ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const partes = []; let n = 0;
      res.on('data', (d) => { n += d.length; if (n > LIMITE) { req.destroy(); reject(new HttpError(502, 'Resposta grande demais do servidor externo')); } else partes.push(d); });
      res.on('end', () => {
        const txt = Buffer.concat(partes).toString('utf8');
        let json = null; try { json = txt ? JSON.parse(txt) : null; } catch (_) { /* não é JSON */ }
        resolve({ status: res.statusCode, json, txt });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new HttpError(504, `Sem resposta de ${u.host} em ${timeout / 1000} s`)); });
    req.on('error', (e) => {
      const m = { ENOTFOUND: 'endereço não encontrado (DNS)', ECONNREFUSED: 'conexão recusada', ECONNRESET: 'conexão interrompida', ETIMEDOUT: 'tempo esgotado',
        DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado próprio (marque "Aceitar certificado próprio")', SELF_SIGNED_CERT_IN_CHAIN: 'certificado próprio (marque "Aceitar certificado próprio")',
        UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificado não verificado (marque "Aceitar certificado próprio")', CERT_HAS_EXPIRED: 'certificado vencido' }[e.code];
      reject(new HttpError(502, `Falha ao conectar em ${u.host}: ${m || e.message}`));
    });
    if (dados) req.write(dados);
    req.end();
  });
}

// ---------- configuração salva ----------
async function carregar(tipo, { exigir = true } = {}) {
  const r = await db.one(`SELECT * FROM integracoes WHERE tipo = $1`, [tipo]);
  if (!r || !r.url || !r.token_cifrado) {
    if (exigir) throw new HttpError(400, `Configure a conexão com o ${tipo === 'netbox' ? 'NetBox' : 'Zabbix'} em Conexões`);
    return null;
  }
  return { url: r.url.replace(/\/+$/, ''), token: decifrar(r.token_cifrado), opcoes: r.opcoes || {} };
}

// ---------- NetBox ----------
function nbHeaders(token) {
  // tokens v2 do NetBox 4.5+ começam com "nbt_" e usam Bearer; os antigos usam "Token"
  return { Authorization: (/^nbt_/.test(token) ? 'Bearer ' : 'Token ') + token };
}
async function netbox(cfg, caminho, { method = 'GET', body } = {}) {
  const base = cfg.url.replace(/\/api\/?$/, '');
  const r = await requisicao(`${base}/api/${caminho.replace(/^\/+/, '')}`, { method, body, headers: nbHeaders(cfg.token), inseguro: !!cfg.opcoes.inseguro });
  if (r.status === 401 || r.status === 403) throw new HttpError(502, 'NetBox recusou o token (sem permissão ou token inválido)');
  if (r.status === 404) throw new HttpError(502, 'NetBox não encontrou o caminho da API. Confira a URL (ex.: https://netbox.suaempresa.com.br)');
  if (r.status >= 400) {
    const det = r.json ? Object.entries(r.json).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ') : r.txt.slice(0, 200);
    throw new HttpError(502, `NetBox respondeu ${r.status}: ${det}`);
  }
  if (!r.json) throw new HttpError(502, 'NetBox não respondeu em JSON. Confira a URL.');
  return r.json;
}

// "Rua X, 100 - Centro, Fortaleza - CE, 60000-000" → { municipio, uf, cep }
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
function lerEndereco(txt) {
  const bruto = String(txt || '');
  const cep = (bruto.match(/\b\d{5}-?\d{3}\b/) || [])[0] || null;
  const segs = bruto.split(/[,\n;]+/).map((x) => x.replace(/\b\d{5}-?\d{3}\b/, '').replace(/\bCEP\b:?/i, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let municipio = null, uf = null;
  for (let i = segs.length - 1; i >= 0 && !uf; i--) {
    const m = segs[i].match(/^(.*?)\s*[-/–]\s*([A-Za-z]{2})$/);
    if (m && UFS.includes(m[2].toUpperCase())) { uf = m[2].toUpperCase(); municipio = m[1].split(/\s[-–]\s/).pop().trim() || (i > 0 ? segs[i - 1] : null); }
    else if (UFS.includes(segs[i].toUpperCase()) && segs[i].length === 2 && i > 0) { uf = segs[i].toUpperCase(); municipio = segs[i - 1].split(/\s[-–]\s/).pop().trim(); }
  }
  return { municipio: municipio || null, uf, cep: cep && (cep.includes('-') ? cep : cep.slice(0, 5) + '-' + cep.slice(5)) };
}

function siteNetbox(s) {
  const cf = s.custom_fields || {};
  const pick = (...ks) => { for (const k of ks) { const v = cf[k]; if (v != null && v !== '') return typeof v === 'object' ? v.name || v.value || v.label || null : String(v); } return null; };
  const end = lerEndereco(s.physical_address || s.shipping_address);
  const ufCf = pick('uf', 'estado', 'state');
  return {
    origem: 'netbox', ref: s.id, nome: s.name, codigo: s.facility || s.slug || null, slug: s.slug,
    status: s.status && (s.status.label || s.status.value), regiao: s.region && s.region.name, grupo: s.group && s.group.name, tenant: s.tenant && s.tenant.name,
    logradouro: (s.physical_address || '').split(/\r?\n/)[0].slice(0, 200) || null,
    municipio: pick('municipio', 'cidade', 'city') || end.municipio, uf: (ufCf || end.uf || '').toUpperCase().slice(0, 2) || null, cep: pick('cep') || end.cep,
    lat: s.latitude != null ? +s.latitude : null, lon: s.longitude != null ? +s.longitude : null, descricao: s.description || '',
  };
}

async function netboxSites(cfg, { q = '', limite = 500 } = {}) {
  const out = []; let offset = 0;
  while (out.length < limite) {
    const pg = await netbox(cfg, `dcim/sites/?limit=${Math.min(200, limite - out.length)}&offset=${offset}${q ? '&q=' + encodeURIComponent(q) : ''}`);
    const rs = pg.results || [];
    out.push(...rs.map(siteNetbox));
    if (!pg.next || !rs.length) break;
    offset += rs.length;
  }
  return out;
}

// ---------- Zabbix ----------
async function zabbix(cfg, metodo, params = {}) {
  const url = /api_jsonrpc\.php$/.test(cfg.url) ? cfg.url : cfg.url + '/api_jsonrpc.php';
  const corpo = { jsonrpc: '2.0', method: metodo, params, id: Date.now() % 1e9 };
  const semAuth = metodo === 'apiinfo.version';
  // Zabbix 6.4+: token no cabeçalho Bearer; versões anteriores: "auth" no corpo (opção "auth_corpo")
  const headers = semAuth || cfg.opcoes.auth_corpo ? {} : { Authorization: 'Bearer ' + cfg.token };
  const r = await requisicao(url, { method: 'POST', body: semAuth || !cfg.opcoes.auth_corpo ? corpo : { ...corpo, auth: cfg.token }, headers, inseguro: !!cfg.opcoes.inseguro });
  if (r.status === 404) throw new HttpError(502, 'Zabbix: API não encontrada. Use a URL do frontend (ex.: https://zabbix.suaempresa.com.br) ou termine em /api_jsonrpc.php');
  if (!r.json) throw new HttpError(502, `Zabbix não respondeu em JSON (HTTP ${r.status}). Confira a URL.`);
  if (r.json.error) {
    const e = r.json.error;
    const txt = `${e.message || ''} ${e.data || ''}`.trim();
    if (/not authori[sz]ed|session terminated|re-login/i.test(txt)) throw new HttpError(502, 'Zabbix recusou o token (inválido, vencido ou sem permissão)');
    throw new HttpError(502, `Zabbix: ${txt}`);
  }
  return r.json.result;
}

function hostZabbix(h) {
  const inv = (h.inventory && !Array.isArray(h.inventory)) ? h.inventory : {};
  const end = lerEndereco([inv.site_address_a, inv.site_city && inv.site_state ? `${inv.site_city} - ${inv.site_state}` : ''].filter(Boolean).join(', '));
  const ip = (h.interfaces || []).find((i) => +i.main === 1) || (h.interfaces || [])[0];
  const uf = (inv.site_state || end.uf || '').toUpperCase();
  return {
    origem: 'zabbix', ref: h.hostid, nome: h.name || h.host, codigo: h.host, status: +h.status === 0 ? 'Monitorado' : 'Desativado',
    grupo: (h.hostgroups || h.groups || []).map((g) => g.name).join(', '), ip: ip ? ip.ip || ip.dns : null,
    logradouro: inv.site_address_a || null, municipio: inv.site_city || end.municipio || null, uf: UFS.includes(uf) ? uf : null, cep: inv.site_zip || end.cep || null,
    lat: inv.location_lat ? +inv.location_lat : null, lon: inv.location_lon ? +inv.location_lon : null, descricao: inv.location || h.description || '',
  };
}

async function zabbixHosts(cfg, { q = '', limite = 1000 } = {}) {
  const p = { output: ['hostid', 'host', 'name', 'status', 'description'], selectInterfaces: ['ip', 'dns', 'main', 'type'], selectInventory: ['location', 'location_lat', 'location_lon', 'site_address_a', 'site_city', 'site_state', 'site_zip'], limit: limite, sortfield: 'name' };
  if (q) { p.search = { name: q, host: q }; p.searchByAny = true; }
  // Zabbix 6.2+: selectHostGroups; anteriores: selectGroups
  let rs;
  try { rs = await zabbix(cfg, 'host.get', { ...p, selectHostGroups: ['name'] }); }
  catch (e) { if (!/selectHostGroups|Invalid parameter/i.test(e.message)) throw e; rs = await zabbix(cfg, 'host.get', { ...p, selectGroups: ['name'] }); }
  return rs.map(hostZabbix);
}

// grupo pelo nome (cria se não existir) e template pelo nome
async function grupoId(cfg, nome, cache) {
  const k = 'g:' + nome.toLowerCase();
  if (cache[k]) return cache[k];
  const g = await zabbix(cfg, 'hostgroup.get', { output: ['groupid'], filter: { name: [nome] } });
  cache[k] = g.length ? g[0].groupid : (await zabbix(cfg, 'hostgroup.create', { name: nome })).groupids[0];
  return cache[k];
}
async function templateId(cfg, nome, cache) {
  const k = 't:' + nome.toLowerCase();
  if (cache[k] !== undefined) return cache[k];
  const t = await zabbix(cfg, 'template.get', { output: ['templateid'], filter: { host: [nome] } });
  const t2 = t.length ? t : await zabbix(cfg, 'template.get', { output: ['templateid'], filter: { name: [nome] } });
  if (!t2.length) throw new HttpError(400, `Template "${nome}" não existe no Zabbix`);
  cache[k] = t2[0].templateid;
  return cache[k];
}

// Cria ou atualiza o host do ativo no Zabbix; devolve o hostid
async function enviarAtivo(cfg, a, e, cache) {
  const op = cfg.opcoes;
  const grupo = a.grupo || op.grupo || 'RoutProject';
  const tpl = a.template || (a.interface === 'icmp' ? op.template_icmp || 'ICMP Ping' : a.interface === 'agent' ? op.template_agent : op.template_snmp);
  const porta = String(a.porta || (a.interface === 'snmp' ? 161 : 10050));
  const iface = { type: a.interface === 'snmp' ? 2 : 1, main: 1, useip: 1, ip: a.ip, dns: '', port: porta };
  if (a.interface === 'snmp') iface.details = { version: 2, bulk: 1, community: a.comunidade || op.comunidade || '{$SNMP_COMMUNITY}' };
  const corpo = {
    name: (a.nome_visivel || `${e.nome} · ${a.hostname}`).slice(0, 128),
    groups: [{ groupid: await grupoId(cfg, grupo, cache) }],
    interfaces: [iface],
    inventory_mode: 0,
    inventory: {
      location: `${e.nome}${e.codigo ? ' (' + e.codigo + ')' : ''}`.slice(0, 128), site_address_a: (e.logradouro || '').slice(0, 128), site_city: (e.municipio || '').slice(0, 128),
      site_state: e.uf || '', site_zip: e.cep || '', type: a.tipo || '', ...(e.lat != null ? { location_lat: String(e.lat), location_lon: String(e.lon) } : {}),
    },
    tags: [{ tag: 'routproject', value: e.cliente || '' }, { tag: 'endereco', value: e.codigo || String(e.id) }, { tag: 'tipo', value: a.tipo || '' }],
  };
  if (tpl) corpo.templates = [{ templateid: await templateId(cfg, tpl, cache) }];
  const ex = await zabbix(cfg, 'host.get', { output: ['hostid'], filter: { host: [a.hostname] }, selectInterfaces: ['interfaceid', 'main', 'type'] });
  if (ex.length) {
    const h = ex[0];
    const up = { hostid: h.hostid, name: corpo.name, groups: corpo.groups, inventory_mode: 0, inventory: corpo.inventory, tags: corpo.tags };
    if (corpo.templates) up.templates = corpo.templates;
    await zabbix(cfg, 'host.update', up);
    const main = (h.interfaces || []).find((i) => +i.main === 1 && +i.type === iface.type);
    if (main) await zabbix(cfg, 'hostinterface.update', { interfaceid: main.interfaceid, ip: iface.ip, port: iface.port, ...(iface.details ? { details: iface.details } : {}) });
    return h.hostid;
  }
  return (await zabbix(cfg, 'host.create', { host: a.hostname, ...corpo })).hostids[0];
}

module.exports = { cifrar, decifrar, requisicao, carregar, netbox, netboxSites, siteNetbox, zabbix, zabbixHosts, enviarAtivo, lerEndereco, UFS };
