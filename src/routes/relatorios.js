// Relatórios: modelo por checklist, prévia, assinatura do cliente por link e download das evidências (.zip)
const crypto = require('crypto');
const db = require('../db');
const v = require('../validate');
const config = require('../config');
const { HttpError } = require('../http');
const { requer, GESTAO, ESCRITORIO, INTERNOS } = require('../auth');
const { gerarRelatorio, desenhar, normalizarModelo, MODELO_PADRAO, VARIAVEIS } = require('../relatorio');
const { criarZip, nomeArquivo } = require('../zip');

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const DIAS_LINK = 30;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pdf(res, r, baixar) {
  res.writeHead(200, {
    'Content-Type': 'application/pdf', 'Content-Length': r.bytes.length, 'Cache-Control': 'private, no-store',
    'Content-Disposition': `${baixar ? 'attachment' : 'inline'}; filename="${r.nome}"; filename*=UTF-8''${encodeURIComponent(r.nome)}`,
  });
  res.end(r.bytes);
}
function zip(res, buf, nome) {
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}` });
  res.end(buf);
}

// Dados de exemplo para a prévia do modelo
function exemplo(modelo, empresa) {
  const agora = Date.now();
  return {
    t: { atividade: 'Instalação de câmeras', endereco: 'Agência Centro', codigo: '001', municipio: 'Belém', uf: 'PA', logradouro: 'Av. Presidente Vargas, 251',
      bairro: 'Campina', cep: '66010-000', cliente: 'Cliente de exemplo', contrato: '001/2026', empresa, responsavel: 'Técnico de exemplo', status: 'concluida',
      realizada_inicio: new Date(agora - 26 * 3600e3).toISOString(), realizada_fim: new Date(agora - 2 * 3600e3).toISOString(), cameras: 12,
      prevista_inicio: null, prevista_fim: null, checklist_id: 1, checklist: 'Checklist de instalação', evidencia: null, modelo,
      equipamentos: [{ nome: 'Câmera', quantidade: 12 }, { nome: 'Servidor / NVR', quantidade: 1 }] },
    itens: [
      { texto: 'Câmeras fixadas e alinhadas', tipo_resposta: 'check', obrigatorio: true, ok: true, usuario: 'Técnico de exemplo', criado_em: new Date(agora - 5 * 3600e3).toISOString() },
      { texto: 'Foto de cada câmera instalada', tipo_resposta: 'foto', obrigatorio: true, fotos: 12 },
      { texto: 'Número de série do servidor', tipo_resposta: 'texto', obrigatorio: false, ok: true, valor: 'SN-123456' },
    ],
    fotos: [], eventos: [{ tipo: 'comentario', detalhe: 'Instalação concluída sem pendências.', criado_em: new Date(agora - 2 * 3600e3).toISOString(), usuario: 'Técnico de exemplo' }],
    assinatura: null,
  };
}

// Página pública de assinatura
function paginaAssinatura(info, token) {
  const assinado = !!info.assinado_em;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assinar relatório · ${esc(info.cliente)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap">
<link rel="stylesheet" href="/css/app.css">
<style>
body{background:var(--bg)} .as{max-width:880px;margin:0 auto;padding:24px 16px 48px;display:flex;flex-direction:column;gap:16px}
.as h1{font-size:clamp(1.6rem,4vw,2.2rem)} .as .card{padding:18px} .as iframe{width:100%;height:min(70vh,760px);border:1px solid var(--line);border-radius:10px;background:#fff}
.pad{position:relative;border:1.5px dashed var(--line);border-radius:10px;background:#fff;touch-action:none} .pad canvas{display:block;width:100%;height:190px;cursor:crosshair}
.pad span{position:absolute;left:14px;bottom:10px;color:#9aa;font-size:.85rem;pointer-events:none} .ok{color:var(--ok);font-weight:700}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px} @media(max-width:640px){.grid3{grid-template-columns:1fr}}
</style></head><body><main class="as">
<div class="row" style="justify-content:space-between">${'<span class="logo" style="color:var(--ink)"><span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="#0B3B36" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="6" r="2.2"/><path d="M7 17c5 0 3-10 10-10"/></svg></span><span>Rout<b>Project</b></span></span>'}
<span class="muted" style="font-size:.9rem">${esc(info.empresa || '')}</span></div>
<div><h1>Relatório para assinatura</h1><p class="muted" style="margin:6px 0 0">${esc(info.atividade)} · ${esc(info.endereco)} · ${esc(info.municipio)}/${esc(info.uf)} · ${esc(info.cliente)}</p></div>
<iframe src="/assinar/${token}/relatorio.pdf" title="Relatório"></iframe>
<p style="margin:-6px 0 0"><a href="/assinar/${token}/relatorio.pdf?baixar=1">Baixar o relatório (PDF)</a></p>
<div class="card" id="box">${assinado
    ? `<p class="ok" style="margin:0">Relatório assinado por ${esc(info.nome)} em ${new Date(info.assinado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p><p class="muted" style="margin:6px 0 0">O PDF acima já contém a assinatura.</p>`
    : `<h2 style="font-size:1.3rem;margin-bottom:10px">Assinar</h2>
  <div class="alert err" hidden id="err"></div>
  <div class="grid3"><div class="field"><label for="n">Nome completo<span class="req">*</span></label><input class="input" id="n" autocomplete="name" required></div>
  <div class="field"><label for="d">CPF ou documento</label><input class="input" id="d"></div>
  <div class="field"><label for="c">Cargo / função</label><input class="input" id="c"></div></div>
  <div class="field"><label>Assinatura<span class="req">*</span></label><div class="pad"><canvas id="cv" aria-label="Área para assinar com o dedo ou o mouse"></canvas><span id="ph">Assine aqui com o dedo ou o mouse</span></div>
  <button class="btn sm" type="button" id="lp" style="align-self:flex-start;margin-top:6px">Limpar assinatura</button></div>
  <label class="check"><input type="checkbox" id="ac"> Li o relatório e confirmo as informações.</label>
  <button class="btn primary" type="button" id="go">Assinar relatório</button>`}</div>
<p class="muted" style="font-size:.8rem;text-align:center">A assinatura registra nome, data, hora e endereço de rede de quem assinou.</p>
</main>
${assinado ? '' : `<script>
const cv=document.getElementById('cv'),ctx=cv.getContext('2d');let des=false,tem=false,ult=null;
function tam(){const r=cv.getBoundingClientRect(),k=window.devicePixelRatio||1;const img=tem?cv.toDataURL():null;cv.width=r.width*k;cv.height=r.height*k;ctx.scale(k,k);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#14211F';if(img){const i=new Image();i.onload=()=>ctx.drawImage(i,0,0,r.width,r.height);i.src=img}}
tam();addEventListener('resize',tam);
const pt=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
cv.addEventListener('pointerdown',e=>{des=true;ult=pt(e);cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointermove',e=>{if(!des)return;const p=pt(e);ctx.beginPath();ctx.moveTo(ult[0],ult[1]);ctx.lineTo(p[0],p[1]);ctx.stroke();ult=p;if(!tem){tem=true;document.getElementById('ph').hidden=true}});
['pointerup','pointercancel'].forEach(t=>cv.addEventListener(t,()=>des=false));
document.getElementById('lp').onclick=()=>{ctx.clearRect(0,0,cv.width,cv.height);tem=false;document.getElementById('ph').hidden=false};
document.getElementById('go').onclick=async()=>{const err=document.getElementById('err');err.hidden=true;
  const nome=document.getElementById('n').value.trim();
  const falta=!nome?'Informe o nome completo.':!tem?'Faça a assinatura no quadro.':!document.getElementById('ac').checked?'Confirme que leu o relatório.':'';
  if(falta){err.textContent=falta;err.hidden=false;return}
  const b=document.getElementById('go');b.disabled=true;b.textContent='Assinando…';
  try{const r=await fetch('/api/assinar/${token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome,documento:document.getElementById('d').value,cargo:document.getElementById('c').value,imagem:cv.toDataURL('image/png')})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.erro||'Não foi possível assinar');location.reload()}
  catch(e){err.textContent=e.message;err.hidden=false;b.disabled=false;b.textContent='Assinar relatório'}};
</script>`}</body></html>`;
}

async function porToken(token) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(String(token || ''))) throw new HttpError(404, 'Link inválido');
  const a = await db.one(
    `SELECT ra.id, ra.tarefa_id, ra.expira_em, ra.nome, ra.assinado_em,
            a.nome AS atividade, e.nome AS endereco, e.municipio, e.uf, cl.nome AS cliente, emp.nome AS empresa
       FROM relatorio_assinaturas ra JOIN tarefas t ON t.id = ra.tarefa_id JOIN atividades a ON a.id = t.atividade_id
       JOIN enderecos e ON e.id = t.endereco_id JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
       LEFT JOIN empresas emp ON emp.id = ct.empresa_id
      WHERE ra.token_hash = $1`, [hash(token)]);
  if (!a) throw new HttpError(404, 'Link de assinatura não encontrado');
  if (!a.assinado_em && new Date(a.expira_em) < new Date()) throw new HttpError(410, 'Este link de assinatura expirou. Peça um novo link.');
  return a;
}

// Fotos de uma lista de tarefas para o .zip
async function arquivosDeFotos(tarefaIds, pastaPorTarefa) {
  const fotos = await db.many(
    `SELECT ev.id, ev.tarefa_id, ev.mime, ev.conteudo, ev.legenda, ev.tirada_em, ev.criado_em, i.texto AS item
       FROM evidencias ev LEFT JOIN checklist_itens i ON i.id = ev.item_id
      WHERE ev.tarefa_id = ANY($1) ORDER BY ev.tarefa_id, ev.item_id NULLS LAST, ev.criado_em`, [tarefaIds]);
  return fotos.map((f, i) => {
    const quando = new Date(f.tirada_em || f.criado_em);
    const ext = f.mime === 'image/png' ? 'png' : f.mime === 'image/webp' ? 'webp' : 'jpg';
    const dia = quando.toISOString().slice(0, 10);
    return { nome: `${pastaPorTarefa(f.tarefa_id)}${String(i + 1).padStart(3, '0')}_${nomeArquivo(f.item || f.legenda || 'foto_geral', 50)}_${dia}.${ext}`, dados: f.conteudo, data: quando };
  });
}

module.exports = (app) => {
  const leitura = requer(INTERNOS);
  const escritorio = requer(ESCRITORIO);
  const gestao = requer(GESTAO);

  // ---------- Modelo do relatório (por checklist) ----------
  app.get('/api/checklists/:id/relatorio', leitura, async (req) => {
    const r = await db.one(`SELECT relatorio FROM checklists WHERE id = $1`, [v.id(req.params.id)]);
    if (!r) throw new HttpError(404, 'Checklist não encontrado');
    const m = typeof r.relatorio === 'string' ? JSON.parse(r.relatorio) : r.relatorio;
    return { modelo: m ? normalizarModelo(m) : null, padrao: MODELO_PADRAO, variaveis: VARIAVEIS };
  });

  app.put('/api/checklists/:id/relatorio', { limit: 1024 * 1024 }, gestao, async (req) => {
    let m;
    try { m = req.body.modelo == null ? null : normalizarModelo(req.body.modelo); } catch (e) { throw new HttpError(400, e.message); }
    const r = await db.query(`UPDATE checklists SET relatorio = $1::jsonb WHERE id = $2`, [m ? JSON.stringify(m) : null, v.id(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Checklist não encontrado');
    return { ok: true, modelo: m };
  });

  // Prévia do PDF com dados de exemplo (não grava nada)
  app.post('/api/checklists/:id/relatorio/previa', { limit: 1024 * 1024 }, escritorio, async (req, res) => {
    let m;
    try { m = normalizarModelo(req.body.modelo || {}); } catch (e) { throw new HttpError(400, e.message); }
    const r = await desenhar(exemplo(m, ''));
    pdf(res, { ...r, nome: 'Previa_relatorio.pdf' }, false);
  });

  // ---------- Assinatura do cliente ----------
  app.get('/api/tarefas/:id/assinatura', leitura, async (req) => {
    const id = v.id(req.params.id);
    const ass = await db.one(`SELECT nome, documento, cargo, assinado_em FROM relatorio_assinaturas WHERE tarefa_id = $1 AND assinado_em IS NOT NULL ORDER BY assinado_em DESC LIMIT 1`, [id]);
    const pend = await db.one(`SELECT criado_em, expira_em FROM relatorio_assinaturas WHERE tarefa_id = $1 AND assinado_em IS NULL AND expira_em > now() ORDER BY criado_em DESC LIMIT 1`, [id]);
    return { assinado: ass, pendente: pend };
  });

  app.post('/api/tarefas/:id/assinatura', escritorio, async (req) => {
    const id = v.id(req.params.id);
    if (!(await db.one(`SELECT 1 AS ok FROM tarefas WHERE id = $1`, [id]))) throw new HttpError(404, 'Atividade não encontrada');
    const token = crypto.randomBytes(24).toString('base64url');
    const r = await db.one(
      `INSERT INTO relatorio_assinaturas (tarefa_id, token_hash, criado_por, expira_em) VALUES ($1, $2, $3, now() + ($4 || ' days')::interval) RETURNING expira_em`,
      [id, hash(token), req.user.id, String(DIAS_LINK)]);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (config.appUrl.startsWith('https') ? 'https' : 'http');
    const base = host ? `${proto}://${host}` : config.appUrl;
    return { link: `${base}/assinar/${token}`, expira_em: r.expira_em };
  });

  app.get('/assinar/:token', async (req, res) => {
    let html;
    try { html = paginaAssinatura(await porToken(req.params.token), req.params.token); }
    catch (e) { html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/app.css"></head><body><div class="card empty" style="margin:24px auto;max-width:560px"><h2 style="margin-bottom:8px">Assinatura de relatório</h2><p>${esc(e.message)}</p></div></body></html>`; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  app.get('/assinar/:token/relatorio.pdf', async (req, res) => {
    const a = await porToken(req.params.token);
    const r = await gerarRelatorio(a.tarefa_id);
    if (!r) throw new HttpError(404, 'Relatório não encontrado');
    pdf(res, r, req.query.baixar === '1');
  });

  app.post('/api/assinar/:token', { limit: 1024 * 1024 }, async (req) => {
    const a = await porToken(req.params.token);
    if (a.assinado_em) throw new HttpError(409, 'Este relatório já foi assinado');
    const nome = v.str(req.body.nome, 'o nome completo', { min: 3, max: 120 });
    const doc = v.str(req.body.documento, 'o documento', { max: 40, opcional: true });
    const cargo = v.str(req.body.cargo, 'o cargo', { max: 80, opcional: true });
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.imagem || ''));
    if (!m) throw new HttpError(400, 'Faça a assinatura no quadro');
    const img = Buffer.from(m[1], 'base64');
    if (img.length < 200 || img.length > 600 * 1024 || img[0] !== 0x89) throw new HttpError(400, 'Assinatura inválida');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 60);
    const r = await db.query(
      `UPDATE relatorio_assinaturas SET nome = $1, documento = $2, cargo = $3, imagem = $4, ip = $5, assinado_em = now() WHERE id = $6 AND assinado_em IS NULL`,
      [nome, doc, cargo, img, ip, a.id]);
    if (!r.rowCount) throw new HttpError(409, 'Este relatório já foi assinado');
    await db.query(`INSERT INTO tarefa_eventos (tarefa_id, tipo, detalhe) VALUES ($1, 'assinatura', $2)`, [a.tarefa_id, `Relatório assinado por ${nome}${cargo ? ' (' + cargo + ')' : ''}`]);
    return { ok: true };
  });

  // ---------- Evidências (.zip) ----------
  app.get('/api/tarefas/:id/evidencias.zip', escritorio, async (req, res) => {
    const id = v.id(req.params.id);
    const t = await db.one(`SELECT t.id, a.nome AS atividade, e.nome AS endereco, e.codigo FROM tarefas t JOIN atividades a ON a.id = t.atividade_id JOIN enderecos e ON e.id = t.endereco_id WHERE t.id = $1`, [id]);
    if (!t) throw new HttpError(404, 'Atividade não encontrada');
    const arqs = await arquivosDeFotos([id], () => 'fotos/');
    const rel = await gerarRelatorio(id);
    if (rel) arqs.unshift({ nome: rel.nome, dados: rel.bytes });
    zip(res, criarZip(arqs), `Evidencias_${nomeArquivo(`${t.codigo || ''}_${t.endereco}_${t.atividade}`, 80)}.zip`);
  });

  app.get('/api/enderecos/:id/evidencias.zip', escritorio, async (req, res) => {
    const id = v.id(req.params.id);
    const e = await db.one(`SELECT id, nome, codigo FROM enderecos WHERE id = $1`, [id]);
    if (!e) throw new HttpError(404, 'Endereço não encontrado');
    const ts = await db.many(`SELECT t.id, a.nome AS atividade, a.ordem FROM tarefas t JOIN atividades a ON a.id = t.atividade_id WHERE t.endereco_id = $1 ORDER BY a.ordem, a.id`, [id]);
    const pasta = new Map(ts.map((t, i) => [t.id, `${String(i + 1).padStart(2, '0')}_${nomeArquivo(t.atividade, 40)}/`]));
    const arqs = await arquivosDeFotos(ts.map((t) => t.id), (tid) => pasta.get(tid));
    for (const t of ts) {
      const temAlgo = arqs.some((a) => a.nome.startsWith(pasta.get(t.id)));
      if (!temAlgo) continue;
      const rel = await gerarRelatorio(t.id);
      if (rel) arqs.push({ nome: pasta.get(t.id) + rel.nome, dados: rel.bytes });
    }
    if (!arqs.length) throw new HttpError(404, 'Este endereço ainda não tem fotos');
    zip(res, criarZip(arqs), `Evidencias_${nomeArquivo(`${e.codigo || ''}_${e.nome}`, 80)}.zip`);
  });
};
