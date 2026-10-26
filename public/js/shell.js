// Estrutura do sistema: menu lateral por perfil, cabeçalho da página e sessão
const Shell = (() => {
  const I = {
    rota: '<path d="M4 19c4 0 3-7 8-7s4-7 8-7"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>',
    proj: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
    del: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 15l3 3-3 3"/>',
    minhas: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    fat: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    cli: '<path d="M3 21V7l9-4 9 4v14"/><path d="M9 21v-6h6v6"/>',
    ativ: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    check: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9l2 2 4-4M8 16h8"/>',
    eq: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5c3 0 5.5 1.5 5.5 4.5"/>',
    users: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    cel: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
    escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    mini: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 10l-2 2 2 2"/>',
    voltar: '<path d="M15 18l-6-6 6-6"/>',
    emp: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

  const ESC = ['admin', 'coordenador', 'supervisor', 'administrativo'];
  const GES = ['admin', 'coordenador', 'supervisor'];
  const TODOS = ['admin', 'coordenador', 'supervisor', 'administrativo', 'tecnico'];
  // reabrir atividade concluída
  const REABRE = ['admin', 'coordenador', 'supervisor'];
  // cada item aparece para quem pode ao menos ver o módulo (tela Permissões)
  const MENU = [
    { grp: 'Operação' },
    { key: 'rota', href: '/app/rota.html', label: 'Painel de rotas', icon: 'rota', mod: 'rota' },
    { key: 'projetos', href: '/app/projetos.html', label: 'Projetos', icon: 'proj', mod: 'projetos' },
    { key: 'minhas', href: '/app/minhas.html', label: 'Minhas atividades', icon: 'minhas', mod: 'minhas' },
    { key: 'delegadas', href: '/app/delegadas.html', label: 'Delegadas', icon: 'del', mod: 'delegadas' },
    { key: 'faturamento', href: '/app/faturamento.html', label: 'Faturamento', icon: 'fat', mod: 'faturamento' },
    { key: 'chat', href: '/app/chat.html', label: 'Chat', icon: 'chat', mod: 'chat' },
    { key: 'app', href: '/m/', label: 'App do técnico', icon: 'cel', mod: 'app' },
    // na ordem em que um projeto novo é preparado
    { grp: 'Preparar projeto' },
    { key: 'clientes', href: '/app/clientes.html', label: 'Clientes e contratos', icon: 'cli', mod: 'clientes' },
    { key: 'atividades', href: '/app/atividades.html', label: 'Atividades', icon: 'ativ', mod: 'atividades' },
    { key: 'checklists', href: '/app/checklists.html', label: 'Checklists', icon: 'check', mod: 'checklists' },
    { key: 'equipe', href: '/app/equipe.html', label: 'Técnicos e times', icon: 'eq', mod: 'equipe' },
    { grp: 'Configurações' },
    { key: 'empresas', href: '/app/empresas.html', label: 'Empresas', icon: 'emp', mod: 'empresas' },
    { key: 'conexoes', href: '/app/conexoes.html', label: 'Conexões', icon: 'plug', mod: 'conexoes' },
    { key: 'usuarios', href: '/app/usuarios.html', label: 'Usuários e acessos', icon: 'users', mod: 'usuarios' },
    { key: 'permissoes', href: '/app/permissoes.html', label: 'Permissões', icon: 'escudo', mod: 'permissoes' },
    { key: 'auditoria', href: '/app/auditoria.html', label: 'Auditoria', icon: 'hist', mod: 'auditoria' },
  ];
  const NIV = { nenhum: 0, ver: 1, editar: 2 };
  let eu = null;
  // pode('clientes') = pode ver; pode('clientes', 'editar') = pode alterar
  const pode = (mod, nivel = 'ver') => !!eu && (eu.perfil === 'admin' || (NIV[(eu.permissoes || {})[mod]] || 0) >= NIV[nivel]);
  const acao = (a) => !!eu && (eu.perfil === 'admin' || !!(eu.acoes || {})[a]);
  const PERFIL = { admin: 'Administrador', coordenador: 'Coordenação', supervisor: 'Supervisão', administrativo: 'Administrativo', tecnico: 'Técnico', cliente: 'Cliente' };

  async function init({ key, title, sub = '', perfis = null, full = false }) {
    document.body.innerHTML = `<div class="app" id="app">
      <aside class="side" id="side"></aside>
      <div class="main">
        <nav class="abas" id="abas" aria-label="Telas abertas"></nav>
        ${full ? '' : `<header class="top">
          <button class="burger" type="button" aria-label="Abrir menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
          <button class="voltar" type="button" id="voltarPg" title="Voltar para a tela anterior" aria-label="Voltar" hidden>${svg('voltar')}</button>
          <div style="min-width:0"><h1>${RP.esc(title)}</h1><div class="sub" id="sub">${RP.esc(sub)}</div></div>
          <span class="spacer"></span><div class="row" id="actions"></div></header>`}
        <main class="content" id="content" ${full ? 'style="padding:0;gap:0;flex:1"' : ''}></main>
      </div></div>`;
    document.title = `${title} · RoutProject`;

    let user;
    try { user = (await RP.api('/auth/me')).usuario; } catch (_) { return new Promise(() => {}); }
    eu = user;
    const side = RP.$('#side');
    side.innerHTML = '<div class="sidetop">' + RP.logo('/app/') + `<button type="button" class="minibtn" id="minibtn" title="Encolher o menu" aria-label="Encolher o menu" aria-pressed="false">${svg('mini')}</button></div>` + '<nav aria-label="Menu principal">' + MENU.filter((m) => m.grp || pode(m.mod))
      .map((m) => (m.grp ? `<div class="grp">${m.grp}</div>` :
        `<a class="nav" href="${m.href}" title="${m.label}" ${m.key === key ? 'aria-current="page"' : ''}>${svg(m.icon)}<span>${m.label}</span>${m.soon ? '<span class="soon">em breve</span>' : ''}</a>`))
      .join('').replace(/(<div class="grp">[^<]+<\/div>)(?=<div class="grp">|$)/g, '') + '</nav>' +
      `<div class="me"><button type="button" class="mebtn" id="mebtn" aria-haspopup="menu" aria-expanded="false"><span class="avatar">${RP.esc(RP.iniciais(user.nome))}</span><span class="who"><b>${RP.esc(user.nome)}</b><span>${RP.esc(user.perfil_nome || PERFIL[user.perfil] || user.perfil)}</span></span>
         <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
       <div class="memenu" id="memenu" role="menu" hidden>
         <div class="mehead"><b>${RP.esc(user.nome)}</b><span>${RP.esc(user.email)}</span></div>
         <button type="button" role="menuitem" id="m-dados">${svg('user')}Meus dados e senha</button>
         <div class="metema" role="group" aria-label="Tema"><span>Tema</span><div>${[['auto', 'Automático', 'auto'], ['claro', 'Claro', 'sol'], ['escuro', 'Escuro', 'lua']].map(([k, t, ic]) => `<button type="button" data-tema="${k}" title="${t}" aria-label="Tema ${t}" aria-pressed="${temaAtual() === k}">${svg(ic)}</button>`).join('')}</div></div>
         <button type="button" role="menuitem" id="sair">${svg('sair')}Sair</button></div></div>`;
    RP.$('#sair').onclick = async () => { try { await RP.api('/auth/logout', { method: 'POST' }); } catch (_) {} location.href = '/'; };
    const mb = RP.$('#mebtn'), mm = RP.$('#memenu');
    const fechaMenu = () => { mm.hidden = true; mb.setAttribute('aria-expanded', 'false'); };
    mb.onclick = (e) => { e.stopPropagation(); mm.hidden = !mm.hidden; mb.setAttribute('aria-expanded', String(!mm.hidden)); };
    document.addEventListener('click', (e) => { if (!mm.hidden && !e.target.closest('.me')) fechaMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mm.hidden) { fechaMenu(); mb.focus(); } });
    RP.$$('[data-tema]', mm).forEach((b) => (b.onclick = () => { aplicarTema(b.dataset.tema); RP.$$('[data-tema]', mm).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    RP.$('#m-dados').onclick = () => { fechaMenu(); meusDados(); };
    const app = RP.$('#app');
    // menu lateral encolhido (só ícones), lembrado neste navegador
    const mini = RP.$('#minibtn');
    const setMini = (on) => { app.classList.toggle('mini', on); mini.setAttribute('aria-pressed', String(on)); mini.title = mini.ariaLabel = on ? 'Expandir o menu' : 'Encolher o menu'; try { localStorage.setItem('rp-side-mini', on ? '1' : '0'); } catch (_) { /* sem armazenamento */ } };
    let miniIni = false; try { miniIni = localStorage.getItem('rp-side-mini') === '1'; } catch (_) { /* sem armazenamento */ }
    setMini(miniIni);
    mini.onclick = () => setMini(!app.classList.contains('mini'));
    abas(key, title);
    RP.$('.burger')?.addEventListener('click', () => app.classList.toggle('open'));
    app.addEventListener('click', (e) => { if (app.classList.contains('open') && !e.target.closest('.side') && !e.target.closest('.burger')) app.classList.remove('open'); });

    const modTela = (MENU.find((m) => m.key === key) || {}).mod;
    if (modTela ? !pode(modTela) : (perfis && !perfis.includes(user.perfil) && user.perfil !== 'admin')) {
      RP.$('#content').innerHTML = '<div class="card empty">Seu perfil não tem acesso a esta tela.</div>';
      return new Promise(() => {});
    }
    return { user, content: RP.$('#content'), actions: RP.$('#actions'), sub: RP.$('#sub') };
  }

  // ---------- Abas das telas abertas (ficam salvas neste navegador) e voltar ----------
  function abas(key, title) {
    const ler = () => { try { return JSON.parse(localStorage.getItem('rp-abas') || '[]').filter((x) => x && x.k && x.u); } catch (_) { return []; } };
    const gravar = (l) => { try { localStorage.setItem('rp-abas', JSON.stringify(l)); } catch (_) { /* sem armazenamento */ } };
    const m = MENU.find((x) => x.key === key);
    let l = ler();
    const aqui = { k: key, t: m ? m.label : title, i: m ? m.icon : 'proj', u: location.pathname + location.search };
    const pos = l.findIndex((x) => x.k === key);
    if (pos >= 0) l[pos] = aqui; else l.push(aqui);
    while (l.length > 8) { const o = l.findIndex((x) => x.k !== key); l.splice(o, 1); }
    gravar(l);
    // a URL da tela muda (filtros, projeto aberto): guarda a última para reabrir no mesmo ponto
    addEventListener('pagehide', () => { const a = ler(); const x = a.find((y) => y.k === key); if (x) { x.u = location.pathname + location.search; gravar(a); } });
    let anterior = null; try { anterior = sessionStorage.getItem('rp-ant'); sessionStorage.setItem('rp-ant', key); } catch (_) { /* sem armazenamento */ }
    const nav = RP.$('#abas');
    const desenhar = () => {
      l = ler();
      nav.innerHTML = l.map((x) => `<div class="aba${x.k === key ? ' on' : ''}"><a href="${RP.esc(x.u)}" ${x.k === key ? 'aria-current="page"' : ''} title="${RP.esc(x.t)}">${svg(x.i || 'proj')}<span>${RP.esc(x.t)}</span></a>`
        + `<button type="button" class="abx" data-fechar="${RP.esc(x.k)}" title="Fechar ${RP.esc(x.t)}" aria-label="Fechar ${RP.esc(x.t)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('');
      RP.$$('[data-fechar]', nav).forEach((b) => (b.onclick = (e) => {
        e.preventDefault();
        const a = ler(); const ix = a.findIndex((x) => x.k === b.dataset.fechar); if (ix < 0) return;
        a.splice(ix, 1); gravar(a);
        if (b.dataset.fechar === key) { const prox = a[ix] || a[ix - 1]; location.href = prox ? prox.u : '/app/rota.html'; } else desenhar();
      }));
    };
    desenhar();
    const vb = RP.$('#voltarPg');
    const ant = anterior && anterior !== key ? l.find((x) => x.k === anterior) : null;
    if (vb && (ant || history.length > 1)) {
      vb.hidden = false; vb.title = ant ? 'Voltar para ' + ant.t : 'Voltar';
      vb.onclick = () => { if (ant) location.href = ant.u; else history.back(); };
    }
  }

  // ---------- Tema e meus dados ----------
  function temaAtual() { try { return localStorage.getItem('rp-tema') || 'auto'; } catch (_) { return 'auto'; } }
  function aplicarTema(t) {
    try { localStorage.setItem('rp-tema', t); } catch (_) { /* sem armazenamento */ }
    const r = document.documentElement;
    if (t === 'claro') r.dataset.theme = 'light'; else if (t === 'escuro') r.dataset.theme = 'dark'; else delete r.dataset.theme;
    // telas dentro de moldura (Painel de rotas) acompanham
    document.querySelectorAll('iframe').forEach((f) => { try { f.contentWindow.postMessage({ rpTema: t }, location.origin); } catch (_) { /* outra origem */ } });
  }
  async function meusDados() {
    const u = await RP.api('/auth/meus-dados');
    RP.drawer('Meus dados', `
      <div class="field"><label for="md-n">Nome</label><input class="input" id="md-n" required value="${RP.esc(u.nome)}" autocomplete="name"></div>
      <div class="field"><label for="md-e">E-mail de acesso</label><input class="input" id="md-e" value="${RP.esc(u.email)}" disabled><small>Para trocar o e-mail, fale com o administrador.</small></div>
      <div class="row"><div class="field" style="flex:1"><label for="md-emp">Empresa</label><input class="input" id="md-emp" value="${RP.esc(u.empresa || '')}" autocomplete="organization"></div>
        <div class="field" style="flex:1"><label for="md-t">Telefone</label><input class="input" id="md-t" value="${RP.esc(u.telefone || '')}" autocomplete="tel" inputmode="tel"></div></div>
      <h3 style="font-size:1.1rem;margin:18px 0 6px">Trocar a senha</h3>
      <p class="muted" style="margin:0 0 10px;font-size:.88rem">Deixe em branco para manter a senha atual.</p>
      <div class="field"><label for="md-sa">Senha atual</label><input class="input" type="password" id="md-sa" autocomplete="current-password"></div>
      <div class="field"><label for="md-sn">Nova senha</label><input class="input" type="password" id="md-sn" autocomplete="new-password"><small>8 caracteres ou mais, com letras e números.</small></div>
      <p class="muted" style="font-size:.82rem">Perfil: ${PERFIL[u.perfil] || u.perfil} · último acesso ${RP.fmtDataHora(u.ultimo_acesso)}</p>`, {
      onSave: async (el) => {
        await RP.api('/auth/meus-dados', { method: 'PUT', body: { nome: RP.$('#md-n', el).value, empresa: RP.$('#md-emp', el).value, telefone: RP.$('#md-t', el).value } });
        const sa = RP.$('#md-sa', el).value, sn = RP.$('#md-sn', el).value;
        if (sa || sn) await RP.api('/auth/senha', { method: 'POST', body: { atual: sa, nova: sn } });
        RP.toast(sa || sn ? 'Dados e senha atualizados' : 'Dados atualizados');
        const who = RP.$('.me .who b'); if (who) who.textContent = RP.$('#md-n', el).value.trim();
      },
    });
  }

  return { init, pode, acao, PERFIL, ESC, GES, TODOS, REABRE, aplicarTema, temaAtual };
})();
