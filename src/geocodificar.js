// Localização pelo endereço (logradouro, município, UF, CEP) quando o endereço não tem latitude/longitude.
// Usa o Nominatim (OpenStreetMap) por padrão; GEOCODER_URL troca por outro servidor compatível e GEOCODER=off desliga.
// Respeita 1 consulta por segundo e só aceita o ponto se cair perto do município informado.
const db = require('./db');
const { requisicao } = require('./conexoes');
const { coordMunicipio } = require('./rota-dados');

const BASE = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const LIGADO = (process.env.GEOCODER || 'on') !== 'off';
const CONTATO = process.env.GEOCODER_EMAIL || process.env.ADMIN_EMAIL || '';
const RAIO_KM = 60;

let fila = Promise.resolve();
let ultima = 0;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLa = (b.la - a.la) * rad, dLo = (b.lo - a.lo) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.la * rad) * Math.cos(b.la * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Uma consulta por vez, com intervalo mínimo de 1,1 s
function consultar(params) {
  const p = fila.then(async () => {
    const dt = Date.now() - ultima;
    if (dt < 1100) await esperar(1100 - dt);
    ultima = Date.now();
    const qs = new URLSearchParams({ format: 'jsonv2', limit: '3', countrycodes: 'br', addressdetails: '0', ...params, ...(CONTATO ? { email: CONTATO } : {}) });
    const r = await requisicao(`${BASE}/search?${qs}`, { headers: { 'User-Agent': 'RoutProject/1.0 (gestao de implantacao)', 'Accept-Language': 'pt-BR' }, timeout: 15000 });
    if (r.status === 429) throw new Error('limite de consultas do serviço de mapas; tente mais tarde');
    if (r.status >= 400 || !Array.isArray(r.json)) throw new Error(`serviço de mapas respondeu ${r.status}`);
    return r.json;
  });
  fila = p.catch(() => {});
  return p;
}

// Devolve { lat, lon } ou null. Tenta endereço completo, depois sem número/bairro, depois o CEP.
async function localizar(e) {
  if (!LIGADO) return null;
  const ref = coordMunicipio(e.municipio, e.uf);
  const rua = String(e.logradouro || '').split(/\r?\n/)[0].replace(/\s+-\s+.*$/, '').trim();
  const tentativas = [];
  if (rua) tentativas.push({ street: rua, city: e.municipio, state: e.uf, country: 'Brasil' });
  if (rua && /\d/.test(rua)) tentativas.push({ street: rua.replace(/,?\s*(n[ºo°.]?\s*)?\d+.*$/i, '').trim(), city: e.municipio, state: e.uf, country: 'Brasil' });
  if (e.cep) tentativas.push({ postalcode: String(e.cep).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2'), country: 'Brasil' });
  if (rua) tentativas.push({ q: `${rua}, ${e.bairro ? e.bairro + ', ' : ''}${e.municipio} - ${e.uf}, Brasil` });
  for (const t of tentativas) {
    if (Object.values(t).some((x) => x == null || x === '')) continue;
    const rs = await consultar(t);
    for (const r of rs) {
      const p = { la: +r.lat, lo: +r.lon };
      if (!Number.isFinite(p.la) || !Number.isFinite(p.lo)) continue;
      if (ref && km(ref, p) > RAIO_KM) continue; // caiu em outra cidade com a mesma rua
      return { lat: +p.la.toFixed(6), lon: +p.lo.toFixed(6) };
    }
  }
  return null;
}

// Localiza e grava um endereço; devolve { ok, lat, lon }
async function geocodificarEndereco(id) {
  const e = await db.one(`SELECT id, logradouro, bairro, cep, municipio, uf FROM enderecos WHERE id = $1`, [id]);
  if (!e) return { ok: false, erro: 'Endereço não encontrado' };
  let p = null, erro = null;
  try { p = await localizar(e); } catch (err) { erro = err.message; }
  if (p) await db.query(`UPDATE enderecos SET lat = $1, lon = $2, geo_fonte = 'endereco', geo_tentado_em = now() WHERE id = $3`, [p.lat, p.lon, id]);
  else if (!erro) await db.query(`UPDATE enderecos SET geo_tentado_em = now() WHERE id = $1`, [id]);
  return p ? { ok: true, ...p } : { ok: false, erro: erro || 'Endereço não encontrado no mapa; fica pelo centro do município' };
}

// Endereços sem coordenada que ainda não foram tentados (ou de um cliente/lista específicos)
async function pendentes({ cliente = null, ids = null, limite = 50, refazer = false } = {}) {
  const w = [`e.lat IS NULL`, `(e.logradouro IS NOT NULL OR e.cep IS NOT NULL)`];
  const p = [];
  if (!refazer) w.push(`e.geo_tentado_em IS NULL`);
  if (cliente) { p.push(cliente); w.push(`ct.cliente_id = $${p.length}`); }
  if (ids) { p.push(ids); w.push(`e.id = ANY($${p.length})`); }
  p.push(limite);
  return (await db.many(`SELECT e.id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ${w.join(' AND ')} ORDER BY e.id LIMIT $${p.length}`, p)).map((r) => r.id);
}

async function processar(opts) {
  const ids = await pendentes(opts);
  let ok = 0, falhas = 0, erro = null;
  for (const id of ids) {
    const r = await geocodificarEndereco(id);
    if (r.ok) ok++; else { falhas++; if (/limite|respondeu|conectar|resposta/i.test(r.erro || '')) { erro = r.erro; break; } }
  }
  return { processados: ids.length, localizados: ok, sem_resultado: falhas, erro };
}

// Rodada em segundo plano: a cada 10 minutos, até 120 endereços
let rodando = false;
function iniciarRotina() {
  if (!LIGADO) return;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try { const r = await processar({ limite: 120 }); if (r.processados) console.log(`[geo] ${r.localizados}/${r.processados} endereço(s) localizados${r.erro ? ' · ' + r.erro : ''}`); }
    catch (e) { console.warn('[geo]', e.message); }
    finally { rodando = false; }
  };
  setTimeout(rodar, 20000).unref();
  setInterval(rodar, 10 * 60000).unref();
}

module.exports = { localizar, geocodificarEndereco, processar, iniciarRotina, LIGADO };
