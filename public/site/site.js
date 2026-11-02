// RoutProject · site comercial: mapa de rotas do hero, menu, formulário de demonstração
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const CORES = ['var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)', 'var(--t5)'];
  // Exemplo real de plano (95 endereços, 5 equipes, saída de Fortaleza), já projetado em coordenadas do desenho
  const MAPA = {"w":560,"h":640,"base":[342.3,78.5],"pts":[[280.1,558.2,3],[36.9,120.0,1],[345.7,364.4,3],[274.9,209.2,1],[392.2,237.9,4],[86.6,207.8,1],[113.5,138.9,1],[122.6,364.5,1],[195.8,45.1,5],[175.7,402.2,0],[235.3,434.8,0],[467.8,189.0,5],[341.0,185.8,3],[281.0,309.0,2],[259.1,263.7,1],[177.8,117.9,1],[447.7,143.1,5],[177.7,78.8,1],[159.7,103.3,1],[270.5,616.0,2],[316.3,344.9,0],[422.1,296.0,0],[322.5,382.6,0],[325.5,308.9,0],[306.1,508.5,0],[189.2,181.7,0],[411.2,253.9,0],[225.8,592.8,0],[83.2,149.5,0],[197.4,435.2,0],[324.9,454.6,0],[300.7,365.1,0],[228.8,336.0,0],[281.6,377.8,0],[307.7,531.2,0],[143.7,66.9,0],[283.5,470.2,0],[274.6,331.9,0],[179.4,488.9,2],[143.7,478.3,1],[289.7,611.6,3],[94.7,362.5,1],[289.2,219.6,2],[441.8,247.0,5],[406.6,271.5,4],[231.4,50.3,5],[384.6,190.7,4],[352.8,271.6,3],[408.0,301.5,4],[404.2,235.8,4],[119.2,37.3,5],[124.0,541.6,1],[323.7,511.0,3],[433.0,274.2,5],[321.9,226.1,2],[317.0,392.6,3],[126.7,494.0,1],[452.6,148.0,5],[153.7,38.5,5],[296.8,588.2,3],[424.7,284.2,4],[285.5,307.5,2],[349.8,223.3,3],[325.7,348.1,3],[352.2,181.5,4],[300.7,547.9,3],[240.6,559.2,2],[214.8,45.5,5],[426.9,263.1,4],[323.4,406.3,3],[121.9,61.1,5],[202.8,151.8,1],[221.6,524.6,2],[389.7,280.6,4],[404.8,263.4,4],[309.1,475.9,3],[368.6,167.3,4],[91.7,24.0,5],[338.8,151.9,3],[219.5,190.2,1],[353.0,159.4,4],[366.7,181.9,4],[214.0,501.5,2],[439.6,181.4,5],[398.2,212.4,4],[419.6,270.3,4],[437.9,279.9,5],[342.1,78.3,5],[315.1,196.7,2],[382.3,128.2,5],[352.2,181.5,4],[24.0,488.6,1],[160.7,520.5,2],[467.0,193.7,5],[160.4,520.4,1]],"rotas":{"1":[[274.9,209.2],[259.1,263.7],[219.5,190.2],[202.8,151.8],[177.8,117.9],[177.7,78.8],[159.7,103.3],[113.5,138.9],[36.9,120.0],[86.6,207.8],[94.7,362.5],[122.6,364.5],[143.7,478.3],[126.7,494.0],[160.4,520.4],[124.0,541.6],[24.0,488.6]],"2":[[315.1,196.7],[321.9,226.1],[289.2,219.6],[285.5,307.5],[281.0,309.0],[214.0,501.5],[221.6,524.6],[240.6,559.2],[270.5,616.0],[160.7,520.5],[179.4,488.9]],"3":[[338.8,151.9],[341.0,185.8],[349.8,223.3],[352.8,271.6],[325.7,348.1],[345.7,364.4],[317.0,392.6],[323.4,406.3],[309.1,475.9],[323.7,511.0],[300.7,547.9],[280.1,558.2],[296.8,588.2],[289.7,611.6]],"4":[[353.0,159.4],[368.6,167.3],[352.2,181.5],[352.2,181.5],[366.7,181.9],[384.6,190.7],[398.2,212.4],[404.2,235.8],[392.2,237.9],[404.8,263.4],[406.6,271.5],[419.6,270.3],[426.9,263.1],[424.7,284.2],[408.0,301.5],[389.7,280.6]],"5":[[342.1,78.3],[382.3,128.2],[447.7,143.1],[452.6,148.0],[439.6,181.4],[467.8,189.0],[467.0,193.7],[441.8,247.0],[437.9,279.9],[433.0,274.2],[231.4,50.3],[214.8,45.5],[195.8,45.1],[153.7,38.5],[121.9,61.1],[119.2,37.3],[91.7,24.0]]}};
  const calma = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(nome, attrs, pai) { const e = document.createElementNS(NS, nome); for (const k in attrs) e.setAttribute(k, attrs[k]); if (pai) pai.appendChild(e); return e; }

  function desenharMapa() {
    const svg = $('#mapa'); if (!svg) return;
    svg.setAttribute('viewBox', `0 0 ${MAPA.w} ${MAPA.h}`);
    const grade = el('g', { class: 'grade-mapa' }, svg);
    for (let x = 40; x < MAPA.w; x += 40) el('line', { x1: x, y1: 0, x2: x, y2: MAPA.h }, grade);
    for (let y = 40; y < MAPA.h; y += 40) el('line', { x1: 0, y1: y, x2: MAPA.w, y2: y }, grade);
    const rotas = el('g', {}, svg), pontos = el('g', {}, svg);
    const caminhos = [];
    Object.entries(MAPA.rotas).forEach(([t, seq]) => {
      if (!seq.length) return;
      const d = 'M' + [MAPA.base, ...seq].map((p) => p.join(',')).join(' L');
      const p = el('path', { d, class: 'rota', stroke: CORES[t - 1] }, rotas);
      caminhos.push(p);
    });
    const marcas = MAPA.pts.map(([x, y, t]) => el('circle', t ? { cx: x, cy: y, r: 4.2, class: 'ponto', fill: CORES[t - 1] } : { cx: x, cy: y, r: 3.6, class: 'ponto feito' }, pontos));
    el('circle', { cx: MAPA.base[0], cy: MAPA.base[1], r: 13, class: 'base-anel' }, svg);
    el('circle', { cx: MAPA.base[0], cy: MAPA.base[1], r: 6, class: 'base' }, svg);
    const lg = $('#legenda');
    if (lg) lg.innerHTML = CORES.map((c, i) => `<span><i style="background:${c}"></i>Equipe ${i + 1}</span>`).join('');
    if (calma || !caminhos[0].getTotalLength) return;
    // Um único momento de movimento: as rotas se desenham a partir da base, uma equipe depois da outra
    marcas.forEach((m) => { m.style.opacity = '0'; });
    caminhos.forEach((p, i) => {
      const L = p.getTotalLength();
      p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
      p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 2200, delay: 300 + i * 260, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
    });
    marcas.forEach((m, i) => m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 200 + (i % 24) * 40, fill: 'forwards' }));
  }

  function menu() {
    const b = $('#hamb'), m = $('#menu'); if (!b) return;
    b.addEventListener('click', () => { const ab = m.classList.toggle('aberto'); b.setAttribute('aria-expanded', ab); b.setAttribute('aria-label', ab ? 'Fechar menu' : 'Abrir menu'); });
    m.addEventListener('click', (e) => { if (e.target.closest('a')) { m.classList.remove('aberto'); b.setAttribute('aria-expanded', 'false'); } });
  }

  // Quem já está logado vê "Abrir o sistema" no lugar de "Entrar"
  function sessao() {
    fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || !j.usuario) return;
      const a = $('#entrar'); a.textContent = 'Abrir o sistema'; a.href = j.usuario.perfil === 'tecnico' ? '/m/' : '/app/';
    }).catch(() => {});
  }

  function formulario() {
    const f = $('#form'); if (!f) return;
    let origem = 'Formulário';
    document.querySelectorAll('[data-origem]').forEach((a) => a.addEventListener('click', () => { origem = a.dataset.origem; setTimeout(() => $('#f-nome').focus({ preventScroll: true }), 500); }));
    f.querySelectorAll('[required]').forEach((i) => { const lb = f.querySelector(`label[for="${i.id}"]`); if (lb) lb.insertAdjacentHTML('beforeend', '<span class="req" aria-hidden="true">*</span>'); i.addEventListener('input', () => i.classList.remove('erro')); });
    const aviso = $('#aviso'), btn = $('#enviar');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      aviso.className = 'aviso'; aviso.textContent = '';
      const nome = $('#f-nome'), email = $('#f-email');
      const faltam = [nome, email].filter((i) => !i.value.trim());
      if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) faltam.push(email);
      if (faltam.length) { faltam.forEach((i) => i.classList.add('erro')); faltam[0].focus(); aviso.className = 'aviso erro'; aviso.textContent = !nome.value.trim() ? 'Informe o seu nome.' : 'Informe um e-mail válido para a resposta.'; return; }
      const corpo = { nome: nome.value.trim(), email: email.value.trim(), telefone: $('#f-tel').value.trim(), empresa: $('#f-emp').value.trim(), enderecos: $('#f-end').value,
        interesse: [...f.querySelectorAll('.interesse input:checked')].map((x) => x.value).join(', '), mensagem: $('#f-msg').value.trim(), origem, site: f.site.value };
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const r = await fetch('/api/site/contato', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar agora.');
        f.classList.add('enviado');
        f.innerHTML = `<div><h3>Pedido recebido</h3><p>Obrigado, ${corpo.nome.split(' ')[0].replace(/[<>&"]/g, '')}. Vamos responder no e-mail ${corpo.email.replace(/[<>&"]/g, '')} para combinar o horário da demonstração.</p></div>`;
      } catch (err) {
        aviso.className = 'aviso erro'; aviso.textContent = err.message + ' Confira os dados e tente de novo.';
        btn.disabled = false; btn.textContent = 'Agendar demonstração';
      }
    });
  }

  const ano = $('#ano'); if (ano) ano.textContent = new Date().getFullYear();
  desenharMapa(); menu(); sessao(); formulario();
})();
