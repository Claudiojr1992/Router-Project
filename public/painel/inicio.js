const RP_BASE = ((D.base && D.base.nome) || 'Fortaleza/CE').split('/')[0];
const RP_CAM = D.units.some((u) => u.c > 0);
(function () {
  const ap = (t) => {
    const r = document.documentElement;
    if (t === 'claro') r.dataset.theme = 'light';
    else if (t === 'escuro') r.dataset.theme = 'dark';
    else delete r.dataset.theme;
  };
  try {
    ap(localStorage.getItem('rp-tema') || 'auto');
  } catch (e) {}
  addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data && e.data.rpTema) ap(e.data.rpTema);
  });
})();
const RP_NOME = D.estatico ? 'CFTV BNB' : D.titulo;
const RP_TIT = D.estatico ? 'INSTALAÇÃO CFTV BNB' : 'INSTALAÇÃO · ' + String(D.titulo).toUpperCase();
const RP_ARQ = D.estatico
  ? 'CFTV_BNB'
  : String(D.titulo)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_');
(function () {
  if (D.estatico) return;
  const cam = D.units.reduce((s, u) => s + (u.c || 0), 0);
  document.title = 'Painel de rotas · ' + D.titulo;
  const h = document.querySelector('.top h1');
  if (h) h.textContent = 'Rotas de instalação · ' + D.titulo;
  const s = document.querySelector('.top .sub');
  if (s)
    s.textContent =
      D.units.length +
      ' endereços · ' +
      (cam ? cam.toLocaleString('pt-BR') + ' câmeras · ' : '') +
      'equipes saem de ' +
      ((D.base && D.base.nome) || '') +
      ' · meta mensal dividida entre as equipes · até ' +
      D.P.HDIA +
      ' h de viagem por dia · distâncias estimadas pelas coordenadas';
  const q = document.getElementById('m-q');
  if (q) q.max = D.units.length;
})();
