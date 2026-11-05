// RoutProject · abas do painel (Mapa e rotas | Planejamento e regras)
(function () {
  // dentro do sistema (moldura), o título já aparece em cima: o painel mostra só o conteúdo
  if (window.self !== window.top || /[?&]embutido=1/.test(location.search)) document.body.classList.add('embutido');
  const tabs = [...document.querySelectorAll('[data-ptab]')];
  const panes = [...document.querySelectorAll('[data-pane]')];
  const hint = document.getElementById('ptabs-hint');
  function abrir(v) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.ptab === v)));
    panes.forEach((p) => (p.hidden = p.dataset.pane !== v));
    if (v === 'mapa' && window.rpMapaBase) requestAnimationFrame(() => window.rpMapaBase());
    resumo();
  }
  // resumo do que está ligado, visível nas duas abas
  function resumo() {
    if (!hint) return;
    const n = document.querySelectorAll('#rp-regras .ufb.etb.on').length;
    const meta = document.getElementById('m-q');
    hint.textContent = [meta && meta.value ? `Meta ${meta.value}/mês` : '', `${n} regra${n === 1 ? '' : 's'} ligada${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  }
  tabs.forEach((t) => (t.onclick = () => abrir(t.dataset.ptab)));
  tabs.forEach((t, i) => (t.onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); abrir(n.dataset.ptab);
  }));
  const r0 = render;
  render = function () { const x = r0.apply(this, arguments); try { resumo(); } catch (_) { /* ignora */ } return x; };
  // o painel sempre abre no mapa (a aba de regras fica a um clique); ?aba=plano abre direto nas regras
  const ini = (location.search.match(/[?&]aba=(\w+)/) || [])[1] || 'mapa';
  abrir(tabs.some((t) => t.dataset.ptab === ini) ? ini : 'mapa');
})();
