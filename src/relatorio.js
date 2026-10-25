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
            emp.nome AS empresa, ck.relatorio AS modelo
       FROM tarefas t JOIN atividades a ON a.id = t.atividade_id
       LEFT JOIN checklists ck ON ck.id = a.checklist_id
       JOIN enderecos e ON e.id = t.endereco_id JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
       LEFT JOIN empresas emp ON emp.id = ct.empresa_id
       LEFT JOIN pessoas p ON p.id = t.responsavel_id
      WHERE t.id = $1`, [tarefaId]);
  if (!t) return null;
  const equip = await db.many(`SELECT ci.nome, ei.quantidade FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id
                                WHERE ei.endereco_id = $1 AND ei.quantidade > 0 ORDER BY ci.ordem, ci.id`, [t.endereco_id]);
  t.equipamentos = equip;
  const [itens, fotos, eventos] = await Promise.all([
    t.checklist_id ? db.many(
      `SELECT i.id, i.ordem, i.texto, i.tipo_resposta, i.obrigatorio, r.valor, r.ok, r.criado_em, u.nome AS usuario,
              (SELECT count(*)::int FROM evidencias ev WHERE ev.tarefa_id = $2 AND ev.item_id = i.id) AS fotos
         FROM checklist_itens i
         LEFT JOIN checklist_respostas r ON r.item_id = i.id AND r.tarefa_id = $2
         LEFT JOIN usuarios u ON u.id = r.usuario_id
        WHERE i.checklist_id = $1 ORDER BY i.ordem, i.id`, [t.checklist_id, tarefaId]) : [],
    db.many(`SELECT ev.id, ev.item_id, ev.legenda, ev.mime, ev.conteudo, ev.lat, ev.lon, ev.tirada_em, ev.criado_em, i.texto AS item, u.nome AS usuario
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
const MODELO_PADRAO = {
  titulo: '', subtitulo: '', empresa: '', cor: '#0B3B36', logo: null,
  campos: [
    { rotulo: 'Cliente', valor: '{cliente}' }, { rotulo: 'Contrato', valor: '{contrato}' }, { rotulo: 'Responsável', valor: '{responsavel}' },
    { rotulo: 'Status', valor: '{status}' }, { rotulo: 'Início (real)', valor: '{inicio}' }, { rotulo: 'Conclusão (real)', valor: '{conclusao}' },
    { rotulo: 'Duração', valor: '{duracao}' }, { rotulo: 'Câmeras', valor: '{cameras}' }, { rotulo: 'Previsto', valor: '{previsto}' },
    { rotulo: 'Endereço', valor: '{logradouro}' },
  ],
  introducao: '',
  secoes: { equipamentos: true, checklist: true, historico: true, fotos: true },
  termo: 'Declaro que os serviços descritos neste relatório foram executados e conferidos.',
  assinaturas: ['Responsável técnico', 'Cliente'],
};
const VARIAVEIS = ['cliente', 'contrato', 'empresa', 'atividade', 'endereco', 'codigo', 'municipio', 'uf', 'logradouro', 'responsavel', 'status',
  'inicio', 'conclusao', 'duracao', 'previsto', 'cameras', 'equipamentos', 'data'];

const HEX = /^#[0-9a-f]{6}$/i;
const txt = (v, max) => (v == null ? '' : String(v).slice(0, max));
// Valida e normaliza um modelo vindo da tela ou de um arquivo JSON
function normalizarModelo(m) {
  if (m == null) return null;
  if (typeof m !== 'object' || Array.isArray(m)) throw new Error('O modelo precisa ser um objeto JSON');
  const out = { ...MODELO_PADRAO, secoes: { ...MODELO_PADRAO.secoes } };
  out.titulo = txt(m.titulo, 120); out.subtitulo = txt(m.subtitulo, 160); out.empresa = txt(m.empresa, 120);
  out.cor = HEX.test(m.cor || '') ? m.cor : MODELO_PADRAO.cor;
  if (m.logo) {
    if (typeof m.logo !== 'string' || !/^data:image\/(png|jpe?g);base64,/.test(m.logo)) throw new Error('Logo: use uma imagem PNG ou JPG');
    if (m.logo.length > 420000) throw new Error('Logo: imagem muito grande (máximo 300 KB)');
    out.logo = m.logo;
  } else out.logo = null;
  if (m.campos !== undefined) {
    if (!Array.isArray(m.campos) || m.campos.length > 20) throw new Error('Campos: envie uma lista com até 20 itens');
    out.campos = m.campos.map((c) => ({ rotulo: txt(c && c.rotulo, 40), valor: txt(c && c.valor, 200) })).filter((c) => c.rotulo);
  }
  out.introducao = txt(m.introducao, 3000);
  if (m.secoes && typeof m.secoes === 'object') for (const k of Object.keys(out.secoes)) if (m.secoes[k] !== undefined) out.secoes[k] = !!m.secoes[k];
  out.termo = m.termo === undefined ? MODELO_PADRAO.termo : txt(m.termo, 3000);
  if (m.assinaturas !== undefined) {
    if (!Array.isArray(m.assinaturas) || m.assinaturas.length > 4) throw new Error('Assinaturas: até 4 rótulos');
    out.assinaturas = m.assinaturas.map((a) => txt(a, 50)).filter(Boolean);
  }
  return out;
}

async function gerarRelatorio(tarefaId) {
  const dados = await carregar(tarefaId);
  if (!dados) return null;
  return desenhar(dados);
}

async function desenhar(dados) {
  const { t, itens, fotos, eventos, assinatura } = dados;
  const md = t.modelo ? normalizarModelo(t.modelo) : MODELO_PADRAO;
  const corHead = (() => { const c = parseInt(md.cor.slice(1), 16); return rgb(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); })();
  const vars = {
    cliente: t.cliente, contrato: t.contrato, empresa: md.empresa || t.empresa || '', atividade: t.atividade, endereco: t.endereco, codigo: t.codigo || '',
    municipio: t.municipio, uf: t.uf, logradouro: [t.logradouro, t.bairro, t.cep].filter(Boolean).join(' · ') || '—', responsavel: t.responsavel || '—',
    status: ST[t.status] || t.status, inicio: dataHora(t.realizada_inicio), conclusao: dataHora(t.realizada_fim), duracao: duracao(t.realizada_inicio, t.realizada_fim),
    previsto: t.prevista_inicio || t.prevista_fim ? `${data(t.prevista_inicio)} a ${data(t.prevista_fim)}` : '—', cameras: String(t.cameras ?? '—'),
    equipamentos: (t.equipamentos || []).map((e) => `${e.nome}: ${e.quantidade}`).join(', ') || '—', data: data(new Date().toISOString()),
  };
  const resolve = (s) => String(s || '').replace(/\{(\w+)\}/g, (m0, k) => (k in vars ? vars[k] : m0));
  const pdf = await PDFDocument.create();
  pdf.setTitle(limpa(`Relatório · ${t.atividade} · ${t.endereco}`));
  pdf.setAuthor('RoutProject'); pdf.setCreator('RoutProject'); pdf.setProducer('RoutProject');
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.28, PH = 841.89, M = 40, CW = PW - 2 * M;
  const final = t.status === 'concluida';
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
  const texto = (s, x, yy, { f = F, sz = 9.5, c = C.ink, maxW } = {}) => {
    const linhas = maxW ? quebra(s, f, sz, maxW) : [limpa(s)];
    linhas.forEach((l, i) => page.drawText(l, { x, y: yy - i * sz * 1.3, size: sz, font: f, color: c }));
    return linhas.length * sz * 1.3;
  };

  let logo = null;
  if (md.logo) { try { const b = Buffer.from(md.logo.split(',')[1], 'base64'); logo = /png/.test(md.logo.slice(0, 20)) ? await pdf.embedPng(b) : await pdf.embedJpg(b); } catch (_) { logo = null; } }
  const empresaTopo = md.empresa || t.empresa || '';
  function novaPagina() {
    page = pdf.addPage([PW, PH]);
    page.drawRectangle({ x: 0, y: PH - 54, width: PW, height: 54, color: corHead });
    let xT = M;
    if (logo) { const s = Math.min(110 / logo.width, 34 / logo.height); page.drawImage(logo, { x: M, y: PH - 27 - (logo.height * s) / 2, width: logo.width * s, height: logo.height * s }); xT = M + logo.width * s + 12; }
    else if (empresaTopo) { page.drawText(limpa(empresaTopo).slice(0, 40), { x: M, y: PH - 34, size: 15, font: FB, color: C.white }); xT = M + Math.min(FB.widthOfTextAtSize(limpa(empresaTopo).slice(0, 40), 15), 230) + 14; }
    else {
      page.drawText('Rout', { x: M, y: PH - 34, size: 17, font: FB, color: C.white });
      page.drawText('Project', { x: M + FB.widthOfTextAtSize('Rout', 17), y: PH - 34, size: 17, font: FB, color: C.amber });
      xT = M + 118;
    }
    page.drawText(limpa(md.titulo ? resolve(md.titulo) : 'Relatório de atividade').slice(0, 48), { x: xT, y: PH - 32, size: 9, font: FB, color: rgb(0.86, 0.92, 0.9) });
    const selo = final ? 'RELATÓRIO FINAL' : 'RELATÓRIO PARCIAL';
    const sw = FB.widthOfTextAtSize(selo, 8.5) + 16;
    page.drawRectangle({ x: PW - M - sw, y: PH - 38, width: sw, height: 18, color: final ? C.ok : C.amber });
    page.drawText(selo, { x: PW - M - sw + 8, y: PH - 32.5, size: 8.5, font: FB, color: final ? C.white : C.head });
    y = PH - 78;
  }
  const precisa = (h) => { if (y - h < 50) novaPagina(); };
  const secao = (titulo) => {
    precisa(40); y -= 8;
    page.drawText(limpa(titulo).toUpperCase(), { x: M, y, size: 9, font: FB, color: C.accent });
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: PW - M, y: y - 5 }, thickness: 0.8, color: C.line });
    y -= 20;
  };

  novaPagina();
  // título
  y -= texto(md.titulo ? resolve(md.titulo) : t.atividade, M, y, { f: FB, sz: 18, maxW: CW }) - 4;
  if (md.subtitulo) y -= texto(resolve(md.subtitulo), M, y, { sz: 11, maxW: CW });
  y -= texto(`${md.titulo ? t.atividade + ' · ' : ''}${t.endereco} · ${t.municipio}/${t.uf}${t.codigo ? ' · ' + t.codigo : ''}`, M, y, { sz: 11, c: C.muted, maxW: CW });
  y -= 8;

  // quadro de informações
  const campos = md.campos.map((c) => [c.rotulo, resolve(c.valor) || '—']);
  const colW = CW / 2, linhaH = 30, nL = Math.ceil(campos.length / 2);
  page.drawRectangle({ x: M, y: y - nL * linhaH - 6, width: CW, height: nL * linhaH + 10, color: C.soft, borderColor: C.line, borderWidth: 0.6 });
  campos.forEach(([k, v], i) => {
    const cx = M + 10 + (i % 2) * colW, cy = y - 6 - Math.floor(i / 2) * linhaH;
    page.drawText(limpa(k).toUpperCase(), { x: cx, y: cy - 6, size: 7, font: FB, color: C.muted });
    const linhas = quebra(v, F, 10, colW - 20);
    page.drawText(linhas[0] || '', { x: cx, y: cy - 19, size: 10, font: F, color: C.ink });
  });
  y -= nL * linhaH + 18;
  if (md.introducao) { precisa(40); y -= texto(resolve(md.introducao), M, y, { sz: 9.5, maxW: CW }) + 6; }
  if (t.evidencia) { y -= texto(`Evidência exigida: ${t.evidencia}`, M, y, { sz: 9, c: C.muted, maxW: CW }) + 2; }
  if (md.secoes.equipamentos && t.equipamentos && t.equipamentos.length) {
    secao('Equipamentos do endereço');
    y -= texto(t.equipamentos.map((e) => `${e.nome}: ${e.quantidade}`).join('   ·   '), M, y, { sz: 9.5, maxW: CW }) + 4;
  }

  // checklist
  if (md.secoes.checklist && t.checklist_id) {
    const feitos = itens.filter((i) => i.ok || (i.tipo_resposta === 'foto' && i.fotos > 0)).length;
    const faltam = itens.filter((i) => i.obrigatorio && !(i.ok || (i.tipo_resposta === 'foto' && i.fotos > 0)));
    secao(`Checklist · ${t.checklist} (${feitos}/${itens.length})`);
    if (faltam.length) { precisa(20); y -= texto(`Itens obrigatórios pendentes: ${faltam.length}`, M, y, { f: FB, sz: 9, c: C.err }) + 4; }
    for (const i of itens) {
      const feito = i.ok || (i.tipo_resposta === 'foto' && i.fotos > 0);
      const resp = i.tipo_resposta === 'foto' ? (i.fotos ? `${i.fotos} foto(s)` : 'sem foto')
        : i.tipo_resposta === 'check' ? (i.ok ? 'Feito' : 'Não marcado') : (i.valor || '—');
      const linhas = quebra(`${i.texto}${i.obrigatorio ? ' *' : ''}`, F, 9.5, CW - 200);
      const h = Math.max(30, linhas.length * 12.5 + 14);
      precisa(h);
      page.drawRectangle({ x: M, y: y - 9, width: 11, height: 11, borderColor: feito ? C.ok : (i.obrigatorio ? C.err : C.line), borderWidth: 1.2, color: feito ? C.ok : C.white });
      if (feito) page.drawText('OK', { x: M + 1.2, y: y - 6, size: 5.5, font: FB, color: C.white });
      linhas.forEach((l, k) => page.drawText(l, { x: M + 20, y: y - 7 - k * 12.5, size: 9.5, font: F, color: C.ink }));
      page.drawText(limpa(resp).slice(0, 40), { x: PW - M - 175, y: y - 7, size: 9, font: FB, color: feito ? C.ink : C.muted });
      if (i.usuario || i.criado_em) page.drawText(limpa(`${i.usuario || ''} ${i.criado_em ? dataHora(i.criado_em) : ''}`).trim().slice(0, 44), { x: PW - M - 175, y: y - 18, size: 7, font: F, color: C.muted });
      page.drawLine({ start: { x: M, y: y - h + 6 }, end: { x: PW - M, y: y - h + 6 }, thickness: 0.4, color: C.line });
      y -= h;
    }
    precisa(14); y -= texto('* item obrigatório', M, y - 2, { sz: 7.5, c: C.muted }) + 2;
  }

  // histórico e comentários
  const hist = eventos.filter((e) => e.tipo === 'comentario' || e.tipo === 'status');
  if (md.secoes.historico && hist.length) {
    secao('Histórico e comentários');
    for (const e of hist) {
      const quem = `${dataHora(e.criado_em)} · ${e.usuario || 'Sistema'}`;
      const det = e.tipo === 'status' ? `Status: ${String(e.detalhe).replace(/a_fazer|em_andamento|aguardando|concluida/g, (m) => ST[m])}` : e.detalhe;
      const linhas = quebra(det, F, 9.5, CW - 150);
      precisa(linhas.length * 12.5 + 8);
      page.drawText(limpa(quem), { x: M, y, size: 8, font: F, color: C.muted });
      linhas.forEach((l, k) => page.drawText(l, { x: M + 150, y: y - k * 12.5, size: 9.5, font: e.tipo === 'comentario' ? F : F, color: C.ink }));
      y -= linhas.length * 12.5 + 6;
    }
  }

  // fotos (2 por linha)
  if (md.secoes.fotos && fotos.length) {
    precisa(270);
    secao(`Fotos (${fotos.length})`);
    const gap = 14, fw = (CW - gap) / 2, fh = 190;
    for (let k = 0; k < fotos.length; k += 2) {
      precisa(fh + 36);
      for (let j = 0; j < 2 && k + j < fotos.length; j++) {
        const f = fotos[k + j];
        const x = M + j * (fw + gap);
        let img = null;
        try { img = f.mime === 'image/png' ? await pdf.embedPng(f.conteudo) : await pdf.embedJpg(f.conteudo); } catch (_) { img = null; }
        page.drawRectangle({ x, y: y - fh, width: fw, height: fh, color: C.soft, borderColor: C.line, borderWidth: 0.6 });
        if (img) {
          const s = Math.min(fw / img.width, fh / img.height);
          const w = img.width * s, h = img.height * s;
          page.drawImage(img, { x: x + (fw - w) / 2, y: y - fh + (fh - h) / 2, width: w, height: h });
        } else page.drawText('Imagem em formato não suportado no PDF', { x: x + 10, y: y - fh / 2, size: 8, font: F, color: C.muted });
        const leg = [f.item || f.legenda || 'Foto geral', dataHora(f.tirada_em || f.criado_em), f.lat != null ? `${(+f.lat).toFixed(5)}, ${(+f.lon).toFixed(5)}` : ''].filter(Boolean).join(' · ');
        quebra(leg, F, 7.5, fw).slice(0, 2).forEach((l, n) => page.drawText(l, { x, y: y - fh - 11 - n * 9.5, size: 7.5, font: F, color: C.muted }));
      }
      y -= fh + 34;
    }
  }

  // termo de aceite e assinaturas
  if (md.termo || md.assinaturas.length) {
    precisa(170);
    secao('Aceite');
    if (md.termo) { y -= texto(resolve(md.termo), M, y, { sz: 9.5, maxW: CW }) + 10; }
    const n = md.assinaturas.length;
    if (n) {
      precisa(110);
      const gap = 24, w = (CW - gap * (n - 1)) / n, base = y - 62;
      // a assinatura digital do cliente vai no rótulo "Cliente" (ou no último)
      const ic = md.assinaturas.findIndex((a) => /cliente/i.test(a)), iCli = ic >= 0 ? ic : n - 1;
      let img = null;
      if (assinatura && assinatura.imagem) { try { img = await pdf.embedPng(assinatura.imagem); } catch (_) { img = null; } }
      md.assinaturas.forEach((rot, i) => {
        const x = M + i * (w + gap);
        if (i === iCli && img) {
          const s = Math.min((w - 10) / img.width, 50 / img.height);
          page.drawImage(img, { x: x + (w - img.width * s) / 2, y: base + 4, width: img.width * s, height: img.height * s });
        }
        page.drawLine({ start: { x, y: base }, end: { x: x + w, y: base }, thickness: 0.8, color: C.ink });
        page.drawText(limpa(rot).slice(0, 40), { x, y: base - 12, size: 8.5, font: FB, color: C.ink });
        if (i === iCli && assinatura) {
          const linhas = [assinatura.nome, [assinatura.cargo, assinatura.documento].filter(Boolean).join(' · '), `Assinado digitalmente em ${dataHora(assinatura.assinado_em)}`].filter(Boolean);
          linhas.forEach((l, k) => page.drawText(limpa(l).slice(0, 60), { x, y: base - 24 - k * 10, size: 7.5, font: F, color: C.muted }));
        } else page.drawText('Nome / data', { x, y: base - 24, size: 7.5, font: F, color: C.muted });
      });
      y = base - 60;
    }
  }

  // rodapé com número de página
  const pags = pdf.getPages();
  const gerado = `Gerado em ${dataHora(new Date())} pelo RoutProject`;
  pags.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 34 }, end: { x: PW - M, y: 34 }, thickness: 0.5, color: C.line });
    p.drawText(limpa(gerado), { x: M, y: 22, size: 7.5, font: F, color: C.muted });
    const n = `Página ${i + 1} de ${pags.length}`;
    p.drawText(n, { x: PW - M - F.widthOfTextAtSize(n, 7.5), y: 22, size: 7.5, font: F, color: C.muted });
  });

  const nome = limpa(`Relatorio_${t.endereco}_${t.atividade}`).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 90) + '.pdf';
  return { bytes: Buffer.from(await pdf.save()), nome, final };
}

module.exports = { gerarRelatorio, desenhar, normalizarModelo, MODELO_PADRAO, VARIAVEIS };
