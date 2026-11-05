// Relatório PDF de uma atividade (tarefa): dados do endereço, início e fim reais, checklist, comentários e fotos
const path = require('path');
const db = require('./db');
const { PDFDocument, StandardFonts, rgb } = require(path.join(__dirname, '..', 'public', 'vendor', 'pdf-lib.min.js'));

const TZ = 'America/Sao_Paulo';
const C = {
  head: rgb(0.043, 0.231, 0.212), accent: rgb(0.055, 0.431, 0.388), amber: rgb(0.914, 0.698, 0.227),
  ink: rgb(0.078, 0.129, 0.122), muted: rgb(0.357, 0.42, 0.408), line: rgb(0.824, 0.871, 0.859), soft: rgb(0.957, 0.973, 0.969),
  ok: rgb(0.122, 0.604, 0.357), err: rgb(0.761, 0.255, 0.227), white: rgb(1, 1, 1),
};
const ST = { a_fazer: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando', concluida: 'Concluída' };

// Fontes padrão do PDF só aceitam WinAnsi: troca o que não couber
const TROCA = { '→': '->', '←': '<-', '✓': 'OK', '✔': 'OK', '✗': 'X', '·': '·' };
function limpa(s) {
  return String(s ?? '').replace(/[\r\t]/g, ' ').split('').map((ch) => {
    if (TROCA[ch]) return TROCA[ch];
    const c = ch.charCodeAt(0);
    if (c < 32 && ch !== '\n') return ' ';
    if (c <= 255 || '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(ch)) return ch;
    return '';
  }).join('');
}
const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const data = (d) => (d ? new Date(String(d).length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('pt-BR', { timeZone: TZ }) : '—');
function duracao(a, b) {
  if (!a || !b) return '—';
  const min = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d ? `${d} d` : '', h ? `${h} h` : '', `${m} min`].filter(Boolean).join(' ');
}

async function carregar(tarefaId) {
  const t = await db.one(
    `SELECT t.*, a.nome AS atividade, a.etapa, a.evidencia, a.checklist_id, ck.nome AS checklist,
            e.nome AS endereco, e.codigo, e.logradouro, e.bairro, e.cep, e.municipio, e.uf, e.cameras, e.lat, e.lon,
            ct.numero AS contrato, cl.nome AS cliente, p.nome AS responsavel, p.tipo AS responsavel_tipo,
            emp.nome AS empresa, emp.logo AS empresa_logo, ct.analista, ct.elaborador,
            COALESCE((SELECT rm.modelo FROM relatorio_modelos rm WHERE rm.id = ck.modelo_id), ck.relatorio, (SELECT rm.modelo FROM relatorio_modelos rm WHERE rm.padrao LIMIT 1)) AS modelo
       FROM tarefas t JOIN atividades a ON a.id = t.atividade_id
       LEFT JOIN checklists ck ON ck.id = a.checklist_id
       JOIN enderecos e ON e.id = t.endereco_id JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
       LEFT JOIN empresas emp ON emp.id = ct.empresa_id
       LEFT JOIN pessoas p ON p.id = t.responsavel_id
      WHERE t.id = $1`, [tarefaId]);
  if (!t) return null;
  const [equip, ativos, mon] = await Promise.all([
    db.many(`SELECT ci.id AS item_id, ci.nome, ei.quantidade FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id
              WHERE ei.endereco_id = $1 AND ei.quantidade > 0 ORDER BY ci.ordem, ci.id`, [t.endereco_id]),
    db.many(`SELECT item_id, patrimonio, numero_serie, fabricante, modelo, ip, status FROM ativos WHERE endereco_id = $1 AND status <> 'baixado' ORDER BY item_id, ip NULLS LAST, id`, [t.endereco_id]),
    db.many(`SELECT hostname, ip, tipo, status, enviado_em FROM monitoramento_ativos WHERE endereco_id = $1 ORDER BY hostname`, [t.endereco_id]).catch(() => []),
  ]);
  t.equipamentos = equip; t.ativos = ativos; t.monitoramento = mon;
  const [itens, fotos, eventos] = await Promise.all([
    t.checklist_id ? db.many(
      `SELECT i.id, i.ordem, i.texto, i.tipo_resposta, i.obrigatorio, r.valor, r.ok, r.criado_em, u.nome AS usuario,
              (SELECT count(*)::int FROM evidencias ev WHERE ev.tarefa_id = $2 AND ev.item_id = i.id) AS fotos
         FROM checklist_itens i
         LEFT JOIN checklist_respostas r ON r.item_id = i.id AND r.tarefa_id = $2
         LEFT JOIN usuarios u ON u.id = r.usuario_id
        WHERE i.checklist_id = $1 ORDER BY i.ordem, i.id`, [t.checklist_id, tarefaId]) : [],
    db.many(`SELECT ev.id, ev.item_id, ev.legenda, ev.mime, ev.conteudo, ev.lat, ev.lon, ev.local_texto, ev.altitude, ev.tirada_em, ev.criado_em, i.texto AS item, u.nome AS usuario
               FROM evidencias ev LEFT JOIN checklist_itens i ON i.id = ev.item_id LEFT JOIN usuarios u ON u.id = ev.usuario_id
              WHERE ev.tarefa_id = $1 ORDER BY ev.item_id NULLS LAST, ev.criado_em LIMIT 60`, [tarefaId]),
    db.many(`SELECT ev.tipo, ev.detalhe, ev.criado_em, u.nome AS usuario FROM tarefa_eventos ev LEFT JOIN usuarios u ON u.id = ev.usuario_id
              WHERE ev.tarefa_id = $1 ORDER BY ev.criado_em`, [tarefaId]),
  ]);
  const assinatura = await db.one(
    `SELECT nome, documento, cargo, imagem, assinado_em, ip FROM relatorio_assinaturas
      WHERE tarefa_id = $1 AND assinado_em IS NOT NULL ORDER BY assinado_em DESC LIMIT 1`, [tarefaId]);
  if (typeof t.modelo === 'string') t.modelo = JSON.parse(t.modelo);
  return { t, itens, fotos, eventos, assinatura };
}

// ---------- Modelo do relatório ----------
// estrutura: as seções na ordem em que saem no PDF; cada uma pode ser desligada, renomeada ou ter o texto trocado.
// "texto" é uma seção livre (incluída pela tela Relatórios).
const TIPOS = {
  objetivo: 'Objetivo do documento', identificacao: 'Identificação da unidade', itens: 'Itens do relatório', checklist: 'Checklist de execução',
  execucao: 'Execução, testes e monitoramento', evidencias: 'Evidências de instalação', historico: 'Histórico e observações', texto: 'Observações', termo: 'Termo de aceite',
};
const TEXTO_OBJETIVO = 'O presente documento tem como objetivo formalizar a entrega técnica da atividade {atividade} na unidade abaixo identificada, reunindo os itens instalados, o checklist de execução e as evidências fotográficas da instalação.';
const TEXTO_TERMO = 'O presente Termo de Aceite formaliza o recebimento deste relatório técnico, bem como a ciência e a concordância com as informações, os registros, as evidências, as condições e as especificações técnicas nele apresentadas.';
const ESTRUTURA_PADRAO = [
  { tipo: 'objetivo', titulo: TIPOS.objetivo, ativo: true, texto: TEXTO_OBJETIVO },
  { tipo: 'identificacao', titulo: TIPOS.identificacao, ativo: true },
  { tipo: 'itens', titulo: TIPOS.itens, ativo: true },
  { tipo: 'checklist', titulo: TIPOS.checklist, ativo: true },
  { tipo: 'execucao', titulo: TIPOS.execucao, ativo: true },
  { tipo: 'evidencias', titulo: TIPOS.evidencias, ativo: true },
  { tipo: 'historico', titulo: TIPOS.historico, ativo: false },
  { tipo: 'termo', titulo: TIPOS.termo, ativo: true, texto: TEXTO_TERMO },
];
const MODELO_PADRAO = {
  titulo: '', subtitulo: '', empresa: '', cor: '#1F3864', logo: null, capa: true,
  campos: [
    { rotulo: 'Cliente final', valor: '{cliente}' }, { rotulo: 'Contrato', valor: '{contrato}' },
    { rotulo: 'Unidade / código', valor: '{endereco} {codigo}' }, { rotulo: 'Endereço completo', valor: '{logradouro}' },
    { rotulo: 'Empresa responsável pelo relatório', valor: '{empresa}' }, { rotulo: 'Atividade', valor: '{atividade}' },
    { rotulo: 'Data de execução', valor: '{execucao}' },
  ],
  estrutura: ESTRUTURA_PADRAO,
  evidencias: { colunas: 2, agrupar: true, legenda: { data: true, autor: true, local: true }, maximo: 0, excluir: [] },
  assinaturas: ['Responsável pela implantação', 'Responsável pelo recebimento (cliente)'],
  // campos antigos, mantidos em sincronia com a estrutura (modelos e arquivos JSON de versões anteriores)
  introducao: TEXTO_OBJETIVO,
  secoes: { equipamentos: true, checklist: true, historico: false, fotos: true },
  termo: TEXTO_TERMO,
};
const VARIAVEIS = ['cliente', 'contrato', 'empresa', 'atividade', 'endereco', 'codigo', 'municipio', 'uf', 'logradouro', 'responsavel', 'analista', 'elaborador', 'status',
  'inicio', 'conclusao', 'duracao', 'previsto', 'execucao', 'cameras', 'equipamentos', 'data'];

const HEX = /^#[0-9a-f]{6}$/i;
const txt = (v, max) => (v == null ? '' : String(v).slice(0, max));
const copia = (o) => JSON.parse(JSON.stringify(o));
// Valida e normaliza um modelo vindo da tela ou de um arquivo JSON
function normalizarModelo(m) {
  if (m == null) return null;
  if (typeof m !== 'object' || Array.isArray(m)) throw new Error('O modelo precisa ser um objeto JSON');
  const out = copia(MODELO_PADRAO);
  out.titulo = txt(m.titulo, 120); out.subtitulo = txt(m.subtitulo, 160); out.empresa = txt(m.empresa, 120);
  out.cor = HEX.test(m.cor || '') ? m.cor : MODELO_PADRAO.cor;
  out.capa = m.capa !== false;
  if (m.logo) {
    if (typeof m.logo !== 'string' || !/^data:image\/(png|jpe?g);base64,/.test(m.logo)) throw new Error('Logo: use uma imagem PNG ou JPG');
    if (m.logo.length > 420000) throw new Error('Logo: imagem muito grande (máximo 300 KB)');
    out.logo = m.logo;
  } else out.logo = null;
  if (m.campos !== undefined) {
    if (!Array.isArray(m.campos) || m.campos.length > 20) throw new Error('Campos: envie uma lista com até 20 itens');
    out.campos = m.campos.map((c) => ({ rotulo: txt(c && c.rotulo, 40), valor: txt(c && c.valor, 200) })).filter((c) => c.rotulo);
  }
  if (Array.isArray(m.estrutura)) {
    if (m.estrutura.length > 24) throw new Error('Estrutura: até 24 seções');
    out.estrutura = m.estrutura.filter((s) => s && TIPOS[s.tipo]).map((s) => ({
      tipo: s.tipo, titulo: txt(s.titulo, 80) || TIPOS[s.tipo], ativo: s.ativo !== false,
      ...(['objetivo', 'texto', 'termo'].includes(s.tipo) ? { texto: txt(s.texto, 4000) } : {}),
    }));
    for (const tipo of Object.keys(TIPOS)) { // seções fixas que faltarem entram desligadas no fim (antes do termo)
      if (tipo === 'texto' || out.estrutura.some((s) => s.tipo === tipo)) continue;
      const base = ESTRUTURA_PADRAO.find((s) => s.tipo === tipo);
      out.estrutura.splice(out.estrutura.findIndex((s) => s.tipo === 'termo') >= 0 ? out.estrutura.findIndex((s) => s.tipo === 'termo') : out.estrutura.length, 0, { ...base, ativo: false });
    }
  } else {
    // modelo antigo: monta a estrutura com o texto de introdução, as seções ligadas e o termo
    const sec = { ...MODELO_PADRAO.secoes, ...(m.secoes || {}) };
    const intro = m.introducao === undefined ? TEXTO_OBJETIVO : txt(m.introducao, 4000);
    const termo = m.termo === undefined ? TEXTO_TERMO : txt(m.termo, 4000);
    out.estrutura = copia(ESTRUTURA_PADRAO).map((s) => {
      if (s.tipo === 'objetivo') return { ...s, texto: intro || TEXTO_OBJETIVO };
      if (s.tipo === 'itens') return { ...s, ativo: !!sec.equipamentos };
      if (s.tipo === 'checklist') return { ...s, ativo: !!sec.checklist };
      if (s.tipo === 'historico') return { ...s, ativo: !!sec.historico };
      if (s.tipo === 'evidencias') return { ...s, ativo: !!sec.fotos };
      if (s.tipo === 'termo') return { ...s, texto: termo, ativo: !!termo || (m.assinaturas || []).length > 0 };
      return s;
    });
  }
  const e = m.evidencias && typeof m.evidencias === 'object' ? m.evidencias : {};
  const lg = e.legenda && typeof e.legenda === 'object' ? e.legenda : {};
  out.evidencias = {
    colunas: [1, 2, 3].includes(+e.colunas) ? +e.colunas : 2,
    agrupar: e.agrupar !== false,
    legenda: { data: lg.data !== false, autor: lg.autor !== false, local: lg.local !== false },
    maximo: Math.max(0, Math.min(300, parseInt(e.maximo, 10) || 0)),
    excluir: Array.isArray(e.excluir) ? e.excluir.slice(0, 100).map((x) => txt(x, 300)).filter(Boolean) : [],
  };
  if (m.assinaturas !== undefined) {
    if (!Array.isArray(m.assinaturas) || m.assinaturas.length > 4) throw new Error('Assinaturas: até 4 rótulos');
    out.assinaturas = m.assinaturas.map((a) => txt(a, 50)).filter(Boolean);
  }
  // mantém os campos antigos coerentes com a estrutura
  const s = (tipo) => out.estrutura.find((x) => x.tipo === tipo) || {};
  out.introducao = s('objetivo').ativo ? s('objetivo').texto || '' : '';
  out.termo = s('termo').ativo ? s('termo').texto || '' : '';
  out.secoes = { equipamentos: !!s('itens').ativo, checklist: !!s('checklist').ativo, historico: !!s('historico').ativo, fotos: !!s('evidencias').ativo };
  return out;
}

async function gerarRelatorio(tarefaId) {
  const dados = await carregar(tarefaId);
  if (!dados) return null;
  return desenhar(dados);
}

async function desenhar(dados) {
  const { t, itens, fotos, eventos, assinatura } = dados;
  const md = normalizarModelo(t.modelo || MODELO_PADRAO);
  const corHead = (() => { const c = parseInt(md.cor.slice(1), 16); return rgb(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); })();
  const empresa = md.empresa || t.empresa || '';
  const execucao = t.realizada_fim || t.realizada_inicio;
  const vars = {
    cliente: t.cliente, contrato: t.contrato, empresa, atividade: t.atividade, endereco: t.endereco, codigo: t.codigo || '',
    municipio: t.municipio, uf: t.uf, logradouro: [t.logradouro, t.bairro, t.cep ? 'CEP ' + t.cep : '', `${t.municipio}/${t.uf}`].filter(Boolean).join(', ') || '—',
    responsavel: t.responsavel || '—', analista: t.analista || '—', elaborador: t.elaborador || '—',
    status: ST[t.status] || t.status, inicio: dataHora(t.realizada_inicio), conclusao: dataHora(t.realizada_fim), duracao: duracao(t.realizada_inicio, t.realizada_fim),
    previsto: t.prevista_inicio || t.prevista_fim ? `${data(t.prevista_inicio)} a ${data(t.prevista_fim)}` : '—', cameras: String(t.cameras ?? '—'),
    equipamentos: (t.equipamentos || []).map((e) => `${e.nome}: ${e.quantidade}`).join(', ') || '—', data: data(new Date().toISOString()),
    execucao: execucao ? data(execucao) : '—',
  };
  const resolve = (s) => String(s || '').replace(/\{(\w+)\}/g, (m0, k) => (k in vars ? vars[k] : m0));
  const pdf = await PDFDocument.create();
  pdf.setTitle(limpa(`Relatório · ${t.atividade} · ${t.endereco}`));
  pdf.setAuthor(limpa(empresa || 'RoutProject')); pdf.setCreator('RoutProject'); pdf.setProducer('RoutProject');
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const FI = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const PW = 595.28, PH = 841.89, M = 48, CW = PW - 2 * M;
  const HEAD_H = 64; // quadro de cabeçalho das páginas internas
  const final = t.status === 'concluida';
  const tituloDoc = md.titulo ? resolve(md.titulo) : 'Relatório técnico de entrega';
  let page, y;

  function quebra(s, f, sz, maxW) {
    const out = [];
    for (const par of limpa(s).split('\n')) {
      let linha = '';
      for (const w of par.split(/\s+/)) {
        const tenta = linha ? linha + ' ' + w : w;
        if (f.widthOfTextAtSize(tenta, sz) <= maxW) linha = tenta;
        else { if (linha) out.push(linha); linha = w; while (f.widthOfTextAtSize(linha, sz) > maxW && linha.length > 1) { let k = linha.length; while (k > 1 && f.widthOfTextAtSize(linha.slice(0, k), sz) > maxW) k--; out.push(linha.slice(0, k)); linha = linha.slice(k); } }
      }
      out.push(linha);
    }
    return out;
  }
  const texto = (s, x, yy, { f = F, sz = 9.5, c = C.ink, maxW, lh = 1.35 } = {}) => {
    const linhas = maxW ? quebra(s, f, sz, maxW) : [limpa(s)];
    linhas.forEach((l, i) => page.drawText(l, { x, y: yy - i * sz * lh, size: sz, font: f, color: c }));
    return linhas.length * sz * lh;
  };
  const centro = (s, yy, f, sz, c = C.ink) => { const l = limpa(s); page.drawText(l, { x: (PW - f.widthOfTextAtSize(l, sz)) / 2, y: yy, size: sz, font: f, color: c }); };

  // símbolo da empresa: logo da empresa executora, senão o logo do modelo do checklist
  let logo = null;
  for (const src of [t.empresa_logo, md.logo]) {
    if (logo || !src) continue;
    try { const b = Buffer.from(String(src).split(',')[1], 'base64'); logo = /png/.test(String(src).slice(0, 20)) ? await pdf.embedPng(b) : await pdf.embedJpg(b); } catch (_) { logo = null; }
  }
  const marca = (x, yy, w, h, tamTexto) => { // desenha o logo dentro da caixa (x, yy = canto inferior)
    if (logo) { const s = Math.min(w / logo.width, h / logo.height); page.drawImage(logo, { x: x + (w - logo.width * s) / 2, y: yy + (h - logo.height * s) / 2, width: logo.width * s, height: logo.height * s }); return; }
    page.drawRectangle({ x, y: yy, width: w, height: h, color: corHead });
    const nome = limpa(empresa || 'RoutProject');
    const linhas = quebra(nome, FB, tamTexto, w - 10).slice(0, 3);
    linhas.forEach((l, i) => page.drawText(l, { x: x + (w - FB.widthOfTextAtSize(l, tamTexto)) / 2, y: yy + h / 2 + (linhas.length / 2 - i - 0.8) * tamTexto * 1.2, size: tamTexto, font: FB, color: C.white }));
  };

  // ---------- capa ----------
  if (md.capa) {
  page = pdf.addPage([PW, PH]);
  marca((PW - 150) / 2, PH - 300, 150, 150, 20);
  let yc = PH - 360;
  for (const l of quebra(tituloDoc.toUpperCase(), FB, 19, CW - 40)) { centro(l, yc, FB, 19, corHead); yc -= 25; }
  yc -= 4;
  for (const l of quebra(md.subtitulo ? resolve(md.subtitulo) : t.atividade, F, 12.5, CW - 60)) { centro(l, yc, F, 12.5, C.ink); yc -= 17; }
  yc -= 22;
  centro(`PROJETO ${String(t.cliente || '').toUpperCase()}${t.contrato ? ' · CONTRATO ' + t.contrato : ''}`, yc, FB, 12, C.ink);
  yc -= 20;
  centro(`${t.endereco}${t.codigo ? ' · ' + t.codigo : ''} · ${t.municipio}/${t.uf}`, yc, F, 11, C.muted);
  yc -= 44;
  const pessoas = [['Analista projetista', vars.analista], ['Responsável pela implantação', vars.responsavel], ['Relatório elaborado por', vars.elaborador], ['Data', vars.data]];
  for (const [k, v] of pessoas) {
    const a = limpa(k + ': '), b = limpa(v), w = FB.widthOfTextAtSize(a, 10.5) + F.widthOfTextAtSize(b, 10.5), x0 = (PW - w) / 2;
    page.drawText(a, { x: x0, y: yc, size: 10.5, font: FB, color: C.ink });
    page.drawText(b, { x: x0 + FB.widthOfTextAtSize(a, 10.5), y: yc, size: 10.5, font: F, color: C.ink });
    yc -= 17;
  }
  const selo = final ? 'RELATÓRIO FINAL' : 'RELATÓRIO PARCIAL · ATIVIDADE EM ANDAMENTO';
  const sw = FB.widthOfTextAtSize(selo, 8.5) + 20;
  page.drawRectangle({ x: (PW - sw) / 2, y: yc - 26, width: sw, height: 20, color: final ? C.ok : C.amber });
  centro(selo, yc - 19.5, FB, 8.5, final ? C.white : C.head);
  if (empresa) centro(empresa, 70, F, 9, C.muted);
  }

  // ---------- páginas internas ----------
  function novaPagina() { page = pdf.addPage([PW, PH]); y = PH - 30 - HEAD_H - 26; }
  const precisa = (h) => { if (y - h < 56) novaPagina(); };
  let nSec = 0;
  const secao = (titulo) => {
    precisa(56); y -= 6; nSec += 1;
    page.drawText(limpa(`${nSec}. ${titulo}`), { x: M, y, size: 13, font: FB, color: corHead });
    y -= 20;
  };
  const sub = (titulo, detalhe) => {
    precisa(40);
    page.drawText(limpa(titulo), { x: M, y, size: 10, font: FB, color: C.ink });
    if (detalhe) page.drawText(limpa(detalhe), { x: M, y: y - 13, size: 9, font: F, color: C.muted });
    y -= detalhe ? 26 : 15;
  };
  // tabela com cabeçalho escuro; colunas: [{ t, w, b }] (w em fração de CW)
  function tabela(cols, linhas, { vazio = '—' } = {}) {
    const ws = cols.map((c) => c.w * CW), pad = 6, sz = 9;
    const cab = () => {
      precisa(40);
      page.drawRectangle({ x: M, y: y - 20, width: CW, height: 20, color: corHead });
      let x = M; cols.forEach((c, i) => { page.drawText(limpa(c.t), { x: x + pad, y: y - 13.5, size: 8.5, font: FB, color: C.white }); x += ws[i]; });
      y -= 20;
    };
    cab();
    for (const ln of linhas.length ? linhas : [cols.map((_, i) => (i === 0 ? vazio : ''))]) {
      const parts = ln.map((v, i) => quebra(v == null || v === '' ? '—' : String(v), cols[i].b ? FB : F, sz, ws[i] - 2 * pad));
      const h = Math.max(20, Math.max(...parts.map((p) => p.length)) * sz * 1.3 + 9);
      if (y - h < 56) { novaPagina(); cab(); }
      page.drawRectangle({ x: M, y: y - h, width: CW, height: h, borderColor: C.line, borderWidth: 0.6 });
      let x = M;
      parts.forEach((p, i) => {
        if (i) page.drawLine({ start: { x, y }, end: { x, y: y - h }, thickness: 0.6, color: C.line });
        p.forEach((l, k) => page.drawText(l, { x: x + pad, y: y - 13 - k * sz * 1.3, size: sz, font: cols[i].b ? FB : F, color: C.ink }));
        x += ws[i];
      });
      y -= h;
    }
    y -= 14;
  }

  novaPagina();
  const ev = md.evidencias;
  const SECOES = {
    objetivo: async (s) => {
      secao(s.titulo);
      y -= texto(resolve(s.texto || MODELO_PADRAO.introducao), M, y, { sz: 10, maxW: CW, lh: 1.45 }) + 10;
      if (t.evidencia) y -= texto(`Evidência exigida nesta atividade: ${t.evidencia}`, M, y, { f: FI, sz: 9, c: C.muted, maxW: CW }) + 8;
    },
    identificacao: async (s) => {
      secao(s.titulo);
      tabela([{ t: 'Campo', w: 0.36 }, { t: 'Informação', w: 0.64 }], md.campos.map((c) => [c.rotulo, resolve(c.valor) || '—']));
    },
    // cada item do contrato no endereço, com os ativos (patrimônio, série, IP) registrados
    itens: async (s) => {
      if (!(t.equipamentos || []).length) return;
      secao(s.titulo);
      const ativos = t.ativos || [];
      const letras = 'abcdefghijklmnopqrstuvwxyz';
      t.equipamentos.forEach((e, k) => {
        const lista = ativos.filter((a) => String(a.item_id) === String(e.item_id));
        const marcas = [...new Set(lista.map((a) => [a.fabricante, a.modelo].filter(Boolean).join(' · ')).filter(Boolean))];
        sub(`${letras[k % 26]}) ${e.nome} · Quantidade: ${String(e.quantidade).padStart(2, '0')}`, marcas.length ? `Marca / modelo: ${marcas.join('; ')}` : '');
        if (lista.length) {
          tabela([{ t: 'Nº', w: 0.08, b: true }, { t: 'IP de rede', w: 0.2, b: true }, { t: 'Patrimônio', w: 0.22 }, { t: 'Nº de série', w: 0.3, b: true }, { t: 'Situação', w: 0.2 }],
            lista.map((a, i) => [String(i + 1).padStart(2, '0'), a.ip || 'SEM', a.patrimonio || 'SEM', a.numero_serie || 'SEM', a.status === 'instalado' ? 'Instalado' : a.status]));
        } else { precisa(18); y -= texto('Patrimônio e número de série ainda não registrados para este item.', M, y, { f: FI, sz: 8.5, c: C.muted }) + 10; }
      });
    },
    checklist: async (s) => {
      if (!t.checklist_id) return;
      const feitos = itens.filter((i) => i.ok || (i.tipo_resposta === 'foto' && i.fotos > 0)).length;
      secao(`${s.titulo} · ${t.checklist} (${feitos}/${itens.length})`);
      tabela([{ t: 'Item verificado', w: 0.5 }, { t: 'Resultado', w: 0.22, b: true }, { t: 'Registrado por', w: 0.28 }],
        itens.map((i) => {
          const resp = i.tipo_resposta === 'foto' ? (i.fotos ? `${i.fotos} foto(s)` : 'Sem foto') : i.tipo_resposta === 'check' ? (i.ok ? 'Conforme' : 'Pendente') : (i.valor || 'Pendente');
          return [`${i.texto}${i.obrigatorio ? ' *' : ''}`, resp, [i.usuario, i.criado_em ? dataHora(i.criado_em) : ''].filter(Boolean).join(' · ')];
        }));
      y += 6; precisa(14); y -= texto('* item obrigatório', M, y, { sz: 7.5, c: C.muted }) + 8;
    },
    execucao: async (s) => {
      const mon = t.monitoramento || [];
      secao(s.titulo);
      tabela([{ t: 'Início real', w: 0.25 }, { t: 'Conclusão real', w: 0.25 }, { t: 'Duração', w: 0.2 }, { t: 'Status', w: 0.3, b: true }], [[vars.inicio, vars.conclusao, vars.duracao, vars.status]]);
      if (mon.length) {
        tabela([{ t: 'Host', w: 0.34 }, { t: 'IP', w: 0.2, b: true }, { t: 'Tipo', w: 0.18 }, { t: 'Monitoramento (Zabbix)', w: 0.28 }],
          mon.map((m) => [m.hostname, m.ip, m.tipo, m.status === 'enviado' ? 'Ativo' + (m.enviado_em ? ' desde ' + data(m.enviado_em) : '') : m.status === 'erro' ? 'Erro no envio' : 'Pendente']));
      }
    },
    // fotos: colunas, agrupamento, legenda, quantidade máxima e itens deixados de fora vêm do modelo
    evidencias: async (s) => {
      const fora = new Set((ev.excluir || []).map((x) => x.toLowerCase()));
      let lista = fotos.filter((f) => !fora.has(String(f.item || '__geral__').toLowerCase()));
      if (ev.maximo) lista = lista.slice(0, ev.maximo);
      if (!lista.length) return;
      const cols = ev.colunas, gap = 14, fw = (CW - gap * (cols - 1)) / cols, fh = cols === 1 ? 330 : cols === 2 ? 200 : 140;
      precisa(fh + 90);
      secao(`${s.titulo} (${lista.length} foto${lista.length > 1 ? 's' : ''})`);
      const grupos = [];
      for (const f of lista) { const g = ev.agrupar ? (f.item || 'Registro fotográfico geral') : ''; let gr = grupos.find((x) => x.nome === g); if (!gr) grupos.push((gr = { nome: g, fotos: [] })); gr.fotos.push(f); }
      for (const g of grupos) {
        precisa(fh + 60);
        if (g.nome) { page.drawText(limpa(g.nome).slice(0, 95), { x: M, y, size: 9.5, font: FB, color: C.ink }); y -= 14; }
        for (let k = 0; k < g.fotos.length; k += cols) {
          precisa(fh + 34);
          for (let j = 0; j < cols && k + j < g.fotos.length; j++) {
            const f = g.fotos[k + j], x = M + j * (fw + gap);
            let img = null;
            try { img = f.mime === 'image/png' ? await pdf.embedPng(f.conteudo) : await pdf.embedJpg(f.conteudo); } catch (_) { img = null; }
            page.drawRectangle({ x, y: y - fh, width: fw, height: fh, color: C.white, borderColor: C.line, borderWidth: 0.8 });
            if (img) {
              const sc = Math.min((fw - 12) / img.width, (fh - 12) / img.height), w = img.width * sc, h = img.height * sc;
              page.drawImage(img, { x: x + (fw - w) / 2, y: y - fh + (fh - h) / 2, width: w, height: h });
            } else page.drawText('Imagem em formato não suportado no PDF', { x: x + 10, y: y - fh / 2, size: 8, font: F, color: C.muted });
            const leg = [f.legenda, ev.legenda.data ? dataHora(f.tirada_em || f.criado_em) : '', ev.legenda.autor ? f.usuario : '',
              ev.legenda.local ? (f.local_texto || (f.lat != null ? `${(+f.lat).toFixed(5)}, ${(+f.lon).toFixed(5)}` : '')) : ''].filter(Boolean).join(' · ');
            quebra(leg, FI, 7.5, fw).slice(0, 2).forEach((l, n) => page.drawText(l, { x, y: y - fh - 11 - n * 9.5, size: 7.5, font: FI, color: C.muted }));
          }
          y -= fh + 32;
        }
      }
    },
    historico: async (s) => {
      const hist = eventos.filter((e) => e.tipo === 'comentario' || e.tipo === 'status' || e.tipo === 'extra');
      if (!hist.length) return;
      secao(s.titulo);
      tabela([{ t: 'Data e responsável', w: 0.3 }, { t: 'Registro', w: 0.7 }], hist.map((e) => [`${dataHora(e.criado_em)} · ${e.usuario || 'Sistema'}`,
        e.tipo === 'status' ? `Status: ${String(e.detalhe).replace(/a_fazer|em_andamento|aguardando|concluida/g, (m) => ST[m])}` : e.detalhe]));
    },
    texto: async (s) => {
      if (!s.titulo && !s.texto) return;
      secao(s.titulo || 'Observações');
      if (s.texto) y -= texto(resolve(s.texto), M, y, { sz: 10, maxW: CW, lh: 1.45 }) + 10;
    },
    // termo de aceite: assinatura do cliente genérica (nome, cargo e data em branco), ou a assinatura digital, se houver
    termo: async (s) => {
      precisa(220);
      secao(s.titulo);
      if (s.texto) y -= texto(resolve(s.texto), M, y, { sz: 10, maxW: CW, lh: 1.45 }) + 16;
      const rots = md.assinaturas;
      if (!rots.length) return;
      const n = rots.length, gap = 30, w = (CW - gap * (n - 1)) / n;
      precisa(130);
      const base = y - 64;
      const ic = rots.findIndex((a) => /cliente|recebimento/i.test(a)), iCli = ic >= 0 ? ic : n - 1;
      let img = null;
      if (assinatura && assinatura.imagem) { try { img = await pdf.embedPng(assinatura.imagem); } catch (_) { img = null; } }
      rots.forEach((rot, i) => {
        const x = M + i * (w + gap);
        if (i === iCli && img) { const sc = Math.min((w - 10) / img.width, 54 / img.height); page.drawImage(img, { x: x + (w - img.width * sc) / 2, y: base + 4, width: img.width * sc, height: img.height * sc }); }
        page.drawLine({ start: { x, y: base }, end: { x: x + w, y: base }, thickness: 0.8, color: C.ink });
        const r = limpa(rot).slice(0, 48); page.drawText(r, { x: x + (w - FB.widthOfTextAtSize(r, 9)) / 2, y: base - 13, size: 9, font: FB, color: C.ink });
        let linhas;
        if (i === iCli) linhas = assinatura ? [assinatura.nome, [assinatura.cargo, assinatura.documento].filter(Boolean).join(' · '), `Assinado digitalmente em ${dataHora(assinatura.assinado_em)}`].filter(Boolean)
          : ['Nome: ______________________________', 'Cargo / matrícula: ____________________', 'Data: ____/____/________'];
        else linhas = [i === 0 ? vars.responsavel : '', empresa].filter(Boolean);
        linhas.forEach((l, k) => { const s2 = limpa(l).slice(0, 60); page.drawText(s2, { x: x + (w - F.widthOfTextAtSize(s2, 8.5)) / 2, y: base - 28 - k * 14, size: 8.5, font: F, color: C.muted }); });
      });
      y = base - 80;
    },
  };
  for (const s of md.estrutura) if (s.ativo && SECOES[s.tipo]) await SECOES[s.tipo](s);

  // cabeçalho em quadro (páginas internas) e rodapé com a numeração
  const pags = pdf.getPages(), tot = pags.length;
  const hoje = data(new Date().toISOString());
  pags.forEach((p, idx) => {
    page = p;
    if (idx > 0 || !md.capa) {
      const top = PH - 30, x0 = 24, W = PW - 48, lw = 78, c1 = 0.42 * (W - lw), c2 = 0.2 * (W - lw), h2 = HEAD_H / 2;
      const cel = (x, yy, w, h) => p.drawRectangle({ x, y: yy, width: w, height: h, borderColor: C.ink, borderWidth: 0.7 });
      cel(x0, top - HEAD_H, lw, HEAD_H);
      marca(x0 + 6, top - HEAD_H + 6, lw - 12, HEAD_H - 12, 9);
      const xa = x0 + lw, xb = xa + c1, xc = xb + c2, wc = W - lw - c1 - c2;
      [[xa, c1], [xb, c2], [xc, wc]].forEach(([x, w]) => { cel(x, top - h2, w, h2); cel(x, top - HEAD_H, w, h2); });
      const par = (x, yy, k, v, w) => { const a = limpa(k + ': '); p.drawText(a, { x: x + 6, y: yy, size: 8, font: FB, color: C.ink }); const b = quebra(v, F, 8, w - 12 - FB.widthOfTextAtSize(a, 8))[0] || ''; p.drawText(b, { x: x + 6 + FB.widthOfTextAtSize(a, 8), y: yy, size: 8, font: F, color: C.ink }); };
      par(xa, top - 13, 'Projeto', String(t.cliente || '').toUpperCase(), c1);
      par(xa, top - 25, 'Unidade', `${t.endereco} · ${t.municipio}/${t.uf}`.toUpperCase(), c1);
      par(xb, top - 13, 'Versão', '1.0', c2);
      par(xb, top - 25, 'Situação', final ? 'Final' : 'Parcial', c2);
      par(xc, top - 13, 'Data', hoje, wc);
      par(xa, top - h2 - 13, 'Responsável', vars.responsavel, c1);
      par(xa, top - h2 - 25, 'Analista', vars.analista, c1);
      par(xb, top - h2 - 13, 'Setor', 'Implantação', c2);
      par(xc, top - h2 - 13, 'Página', `${idx + 1} de ${tot}`, wc);
    }
    p.drawLine({ start: { x: M, y: 34 }, end: { x: PW - M, y: 34 }, thickness: 0.5, color: C.line });
    p.drawText(limpa(`${tituloDoc} · ${t.atividade} · gerado em ${dataHora(new Date())}`).slice(0, 110), { x: M, y: 22, size: 7, font: F, color: C.muted });
    const nn = `Página ${idx + 1} de ${tot}`;
    p.drawText(nn, { x: PW - M - F.widthOfTextAtSize(nn, 7.5), y: 22, size: 7.5, font: F, color: C.muted });
  });

  const nome = limpa(`Relatorio_${t.endereco}_${t.atividade}`).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 90) + '.pdf';
  return { bytes: Buffer.from(await pdf.save()), nome, final };
}

module.exports = { gerarRelatorio, carregar, desenhar, normalizarModelo, MODELO_PADRAO, VARIAVEIS, TIPOS };
