// RoutProject · ler e gerar planilhas no navegador, sem bibliotecas externas
//   Planilha.ler(arquivo)          -> Promise<string[][]>   (.xlsx ou .csv)
//   Planilha.xlsx(abas)            -> Blob .xlsx            abas = [{ nome, linhas: [[...]], larguras? }]
//   Planilha.csv(linhas)           -> Blob .csv (UTF-8 com BOM, separador ;, abre direto no Excel)
//   Planilha.baixar(blob, nome)
const Planilha = (() => {
  // ---------- CSV ----------
  function lerCsv(txt) {
    txt = txt.replace(/^﻿/, '');
    const prim = txt.split(/\r?\n/)[0] || '';
    const sep = prim.includes('\t') ? '\t' : (prim.split(';').length >= prim.split(',').length ? ';' : ',');
    const out = []; let row = [], cel = '', q = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (q) {
        if (ch === '"') { if (txt[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += ch;
      } else if (ch === '"' && cel === '') q = true; // aspas só abrem no começo da célula
      else if (ch === sep) { row.push(cel); cel = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cel); out.push(row); row = []; cel = ''; }
      else cel += ch;
    }
    if (cel !== '' || row.length) { row.push(cel); out.push(row); }
    return out.filter((r) => r.some((c) => String(c).trim() !== ''));
  }
  const csvCel = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv(linhas) {
    return new Blob(['﻿' + linhas.map((r) => r.map(csvCel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }

  // ---------- ZIP (leitura) ----------
  async function inflar(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre .xlsx. Salve a planilha como CSV e tente de novo.');
    const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Arquivo .xlsx inválido');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {}; const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const met = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const nome = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      files[nome] = { met, csize, off };
      p += 46 + nl + xl + cl;
    }
    return async (nome) => {
      const f = files[nome]; if (!f) return null;
      const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true);
      const ini = f.off + 30 + lnl + lxl, dados = u8.subarray(ini, ini + f.csize);
      const raw = f.met === 0 ? dados : await inflar(dados);
      return dec.decode(raw);
    };
  }

  // ---------- XLSX (leitura da primeira aba) ----------
  const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; if (!m) return -1; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function lerXlsx(buf) {
    const ler = await unzip(buf);
    const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
    const ss = [];
    const sst = await ler('xl/sharedStrings.xml');
    if (sst) for (const si of xml(sst).getElementsByTagName('si')) ss.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    let alvo = 'xl/worksheets/sheet1.xml';
    const wb = await ler('xl/workbook.xml'), rels = await ler('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const s1 = xml(wb).getElementsByTagName('sheet')[0];
      const rid = s1 && (s1.getAttribute('r:id') || s1.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) { const tg = rel.getAttribute('Target').replace(/^\//, ''); alvo = tg.startsWith('xl/') ? tg : 'xl/' + tg; }
    }
    const sh = await ler(alvo);
    if (!sh) throw new Error('Não encontrei a primeira aba da planilha');
    const out = [];
    for (const row of xml(sh).getElementsByTagName('row')) {
      const r = [];
      let auto = 0;
      for (const c of row.getElementsByTagName('c')) {
        let i = colIdx(c.getAttribute('r')); if (i < 0) i = auto; auto = i + 1;
        const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = ss[+(v && v.textContent)] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else if (t === 'b') val = v && v.textContent === '1' ? 'VERDADEIRO' : 'FALSO';
        else val = v ? v.textContent : '';
        r[i] = val;
      }
      out.push(Array.from(r, (x) => x ?? ''));
    }
    return out.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  async function ler(file) {
    const nome = (file.name || '').toLowerCase();
    if (nome.endsWith('.xlsx')) return lerXlsx(await file.arrayBuffer());
    if (nome.endsWith('.xls')) throw new Error('Formato .xls antigo: salve como .xlsx ou .csv no Excel e tente de novo.');
    const buf = await file.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel em ANSI
    return lerCsv(txt);
  }

  // ---------- ZIP (gravação, sem compressão) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(arquivos) {
    const enc = new TextEncoder(); const partes = []; const central = []; let off = 0;
    for (const [nome, conteudo] of arquivos) {
      const nb = enc.encode(nome), db = enc.encode(conteudo), crc = crc32(db);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true);
      partes.push(new Uint8Array(h.buffer), nb, db);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, db.length, true); c.setUint32(24, db.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + db.length;
    }
    const csize = central.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, arquivos.length, true); e.setUint16(10, arquivos.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...partes, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- XLSX (gravação) ----------
  const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colRef = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function xlsx(abas) {
    const sheets = abas.map((a, n) => {
      const cols = a.larguras ? `<cols>${a.larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
      const rows = a.linhas.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
        const ref = colRef(ci) + (ri + 1), st = ri === 0 && a.cabecalho !== false ? ' s="1"' : '';
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
      }).join('')}</row>`).join('');
      const pane = a.cabecalho !== false ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
      return [`xl/worksheets/sheet${n + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`];
    });
    return zip([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((_, n) => `<Override PartName="/xl/worksheets/sheet${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, n) => `<sheet name="${xesc(String(a.nome).slice(0, 31))}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, n) => `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E6E63"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ...sheets,
    ]);
  }

  function baixar(blob, nome) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
  }

  return { ler, lerCsv, xlsx, csv, baixar };
})();
