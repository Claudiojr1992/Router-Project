// Arquivo .zip simples (sem compressão — fotos JPEG e PDF já são comprimidos), sem dependências
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return [t, dt];
}

// arquivos: [{ nome: 'pasta/arquivo.jpg', dados: Buffer, data?: Date }]
function criarZip(arquivos) {
  const partes = [], central = [];
  let off = 0;
  const usados = new Set();
  for (const a of arquivos) {
    let nome = a.nome;
    for (let i = 2; usados.has(nome); i++) nome = a.nome.replace(/(\.[^./]+)?$/, (ext) => `_${i}${ext || ''}`);
    usados.add(nome);
    const n = Buffer.from(nome, 'utf8'), d = a.dados, crc = crc32(d), [tm, dt] = dosTime(a.data || new Date());
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(tm, 10); h.writeUInt16LE(dt, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22);
    h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    partes.push(h, n, d);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(tm, 12); c.writeUInt16LE(dt, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + d.length;
  }
  const cen = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cen.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cen, fim]);
}

// nome de arquivo seguro (sem acento e caracteres especiais)
const nomeArquivo = (s, max = 60) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'arquivo';

module.exports = { criarZip, nomeArquivo, crc32 };
