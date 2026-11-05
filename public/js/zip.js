// Monta um arquivo .zip no navegador (sem compressão: fotos JPEG já são comprimidas).
// Assim o download das evidências não passa pelo limite de tamanho de resposta do servidor.
const Zip = (() => {
  const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TAB[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const dosTempo = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosData = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  const enc = new TextEncoder();
  // nome seguro para arquivo/pasta
  const nome = (s, max = 60) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ._-]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, max) || 'arquivo';

  function criar() {
    const arquivos = [];
    const usados = new Set();
    return {
      // dados: Uint8Array | ArrayBuffer | string
      add(caminho, dados, quando = new Date()) {
        let c = caminho, n = 2;
        while (usados.has(c)) { c = caminho.replace(/(\.[^./]+)?$/, (ext) => `_${n}${ext || ''}`); n++; }
        usados.add(c);
        const u8 = typeof dados === 'string' ? enc.encode(dados) : dados instanceof Uint8Array ? dados : new Uint8Array(dados);
        arquivos.push({ nome: enc.encode(c), dados: u8, crc: crc32(u8), quando: quando instanceof Date && !isNaN(quando) ? quando : new Date() });
      },
      get tamanho() { return arquivos.reduce((s, a) => s + a.dados.length, 0); },
      get quantidade() { return arquivos.length; },
      blob() {
        const partes = [], central = [];
        let off = 0;
        for (const a of arquivos) {
          const h = new DataView(new ArrayBuffer(30));
          h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
          h.setUint16(10, dosTempo(a.quando), true); h.setUint16(12, dosData(a.quando), true); h.setUint32(14, a.crc, true);
          h.setUint32(18, a.dados.length, true); h.setUint32(22, a.dados.length, true); h.setUint16(26, a.nome.length, true); h.setUint16(28, 0, true);
          partes.push(h.buffer, a.nome, a.dados);
          const c = new DataView(new ArrayBuffer(46));
          c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
          c.setUint16(12, dosTempo(a.quando), true); c.setUint16(14, dosData(a.quando), true); c.setUint32(16, a.crc, true);
          c.setUint32(20, a.dados.length, true); c.setUint32(24, a.dados.length, true); c.setUint16(28, a.nome.length, true);
          c.setUint32(42, off, true);
          central.push(c.buffer, a.nome);
          off += 30 + a.nome.length + a.dados.length;
        }
        const tamCentral = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
        const fim = new DataView(new ArrayBuffer(22));
        fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
        fim.setUint32(12, tamCentral, true); fim.setUint32(16, off, true);
        return new Blob([...partes, ...central, fim.buffer], { type: 'application/zip' });
      },
    };
  }

  function baixar(blob, arquivo) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = arquivo;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // Evidências de endereços: { enderecos: [ids], nomeArquivo, relatorios: true, progresso(msg) }
  // Pastas: [Endereço]/[NN_Atividade]/fotos + relatório PDF de cada atividade com evidência
  async function evidencias({ enderecos, nomeArquivo, relatorios = true, tarefa = null, progresso = () => {} }) {
    const z = criar();
    const varios = enderecos.length > 1;
    let fotos = 0, falhas = 0;
    for (const [ie, eid] of enderecos.entries()) {
      progresso(`Lendo o endereço ${ie + 1} de ${enderecos.length}…`);
      const r = await fetch(`/api/enderecos/${eid}/evidencias`, { credentials: 'same-origin' });
      if (!r.ok) { falhas++; continue; }
      const d = await r.json();
      const base = varios ? `${nome(`${d.endereco.codigo ? d.endereco.codigo + '_' : ''}${d.endereco.nome}`, 70)}/` : '';
      for (const [it, t] of d.tarefas.entries()) {
        if (!t.fotos.length || (tarefa && t.id !== tarefa)) continue;
        const pasta = `${base}${String(it + 1).padStart(2, '0')}_${nome(t.atividade, 40)}/`;
        for (const [k, f] of t.fotos.entries()) {
          progresso(`Baixando fotos: ${fotos + 1} (${d.endereco.nome})`);
          try {
            const rf = await fetch(`/api/fotos/${f.id}`, { credentials: 'same-origin' });
            if (!rf.ok) throw new Error();
            const quando = new Date(f.tirada_em || f.criado_em);
            const ext = /png/.test(f.mime) ? 'png' : /webp/.test(f.mime) ? 'webp' : 'jpg';
            z.add(`${pasta}${String(k + 1).padStart(3, '0')}_${nome(f.item || f.legenda || 'foto_geral', 50)}_${isNaN(quando) ? '' : quando.toISOString().slice(0, 10)}.${ext}`, await rf.arrayBuffer(), quando);
            fotos++;
          } catch (_) { falhas++; }
        }
        if (relatorios) {
          progresso(`Gerando o relatório: ${t.atividade} (${d.endereco.nome})`);
          try {
            const rp = await fetch(`/api/tarefas/${t.id}/relatorio.pdf`, { credentials: 'same-origin' });
            if (!rp.ok) throw new Error();
            z.add(`${pasta}Relatorio_${nome(t.atividade, 50)}.pdf`, await rp.arrayBuffer());
          } catch (_) { falhas++; }
        }
      }
    }
    if (!fotos) throw new Error(enderecos.length > 1 ? 'Nenhuma foto nos endereços escolhidos' : 'Este endereço ainda não tem fotos');
    progresso('Montando o arquivo .zip…');
    baixar(z.blob(), nomeArquivo);
    return { fotos, falhas, arquivos: z.quantidade, tamanho: z.tamanho };
  }

  return { criar, baixar, evidencias, nome };
})();
