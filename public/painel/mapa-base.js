// RoutProject · mapa de ruas por baixo do desenho das rotas
// O desenho (SVG) usa a projeção de Mercator, a mesma das imagens do OpenStreetMap: a camada de imagens acompanha
// o enquadramento do SVG (viewBox) e os pontos caem no endereço real. Ao aproximar, os marcadores mantêm o tamanho na tela.
(function () {
  const URL_T = window.RP_TILES; // ex.: https://tile.openstreetmap.org/{z}/{x}/{y}.png ('' desliga)
  const camada = document.getElementById('tiles');
  const wrap = svg.parentElement;
  const attr = document.getElementById('map-attr');
  let erros = 0, carregadas = 0, agendado = false;

  if (URL_T) {
    document.body.classList.add('tiles-on');
    attr.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  } else if (camada) camada.remove();

  // coordenada do SVG -> pixel do mundo no nível z
  const T = (z) => (256 * Math.pow(2, z)) / 360;
  const mundo = (x, y, z) => [(x / SS2 + LON0 + 180) * T(z), (y / SS2 + MY0 + 180) * T(z)];
  const doMundo = (X, Y, z) => [(X / T(z) - 180 - LON0) * SS2, (Y / T(z) - 180 - MY0) * SS2];

  function desenharImagens() {
    agendado = false;
    if (!URL_T || !camada || !svg.isConnected) return;
    const m = svg.getScreenCTM(), r = wrap.getBoundingClientRect();
    if (!m || !r.width) return;
    // nível de zoom das imagens pela escala atual (px de tela por grau)
    const z = Math.max(2, Math.min(19, Math.round(Math.log2((m.a * SS2 * 360) / 256))));
    const inv = m.inverse();
    const a = new DOMPoint(r.left, r.top).matrixTransform(inv), b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
    const [X0, Y0] = mundo(a.x, a.y, z), [X1, Y1] = mundo(b.x, b.y, z);
    const n = Math.pow(2, z);
    const tx0 = Math.max(0, Math.floor(X0 / 256)), tx1 = Math.min(n - 1, Math.floor(X1 / 256));
    const ty0 = Math.max(0, Math.floor(Y0 / 256)), ty1 = Math.min(n - 1, Math.floor(Y1 / 256));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 400) return;
    const vistas = new Set();
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const k = `${z}/${tx}/${ty}`;
        vistas.add(k);
        const [ux, uy] = doMundo(tx * 256, ty * 256, z);
        const p0 = new DOMPoint(ux, uy).matrixTransform(m);
        const lado = 256 / T(z) * SS2 * m.a;
        let img = camada.querySelector(`img[data-k="${k}"]`);
        if (!img) {
          img = new Image();
          img.dataset.k = k;
          img.alt = '';
          img.decoding = 'async';
          img.onload = () => { carregadas++; img.classList.add('ok'); };
          img.onerror = () => { erros++; img.remove(); if (erros > 8 && !carregadas) desligar(); };
          img.src = URL_T.replace('{z}', z).replace('{x}', tx).replace('{y}', ty).replace('{s}', 'abc'[(tx + ty) % 3]);
          camada.appendChild(img);
        }
        img.style.transform = `translate(${(p0.x - r.left).toFixed(1)}px,${(p0.y - r.top).toFixed(1)}px)`;
        img.style.width = img.style.height = (lado + 0.6).toFixed(1) + 'px';
        img.dataset.z = z;
      }
    }
    // remove as de outros níveis depois que as novas carregarem (evita piscar)
    camada.querySelectorAll('img').forEach((img) => {
      if (vistas.has(img.dataset.k)) return;
      if (+img.dataset.z !== z) { if (!img._sai) img._sai = setTimeout(() => img.remove(), 350); }
      else img.remove();
    });
  }
  function desligar() {
    document.body.classList.remove('tiles-on');
    if (camada) camada.innerHTML = '';
    attr.textContent = 'Mapa de ruas indisponível: mostrando o mapa esquemático';
  }

  // marcadores com tamanho constante na tela: raio e texto acompanham o zoom
  function escala() {
    const k = Math.min(1, Math.max(0.002, vb.w / W));
    const kr = Math.pow(k, 0.92);
    svg.querySelectorAll('#map > g:not(.esq) circle').forEach((c) => {
      if (c._r0 === undefined) c._r0 = +c.getAttribute('r');
      c.setAttribute('r', (c._r0 * kr).toFixed(4));
    });
    svg.querySelectorAll('#map > g:not(.esq) text').forEach((t) => {
      if (t._f0 === undefined) t._f0 = +t.getAttribute('font-size') || 11;
      t.setAttribute('font-size', (t._f0 * kr).toFixed(4));
    });
    svg.style.setProperty('--k', kr);
  }

  window.rpMapaBase = function () {
    escala();
    if (!agendado) { agendado = true; requestAnimationFrame(desenharImagens); }
  };
  // o painel redesenha marcadores a cada render: reaplica a escala
  const r0 = render;
  render = function () { const x = r0.apply(this, arguments); try { window.rpMapaBase(); } catch (e) { console.error(e); } return x; };
  new ResizeObserver(() => window.rpMapaBase()).observe(wrap);
  window.rpMapaBase();
})();
