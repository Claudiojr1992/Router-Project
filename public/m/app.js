// RoutProject · app do técnico (PWA)
// Funciona sem internet: os dados do dia ficam no aparelho (IndexedDB), as ações entram numa fila
// e as fotos ficam guardadas até a conexão voltar. A sincronização envia fotos primeiro, depois as ações.
(() => {
  'use strict';
  const VERSAO = '1.2.0';
  const ST = { a_fazer: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando', concluida: 'Concluída' };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const fmtData = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '');
  const fmtHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const desde = (d) => {
    if (!d) return 'nunca';
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60); return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dia(s)`;
  };
  const ICON = {
    hoje: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
    sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M21 3v6h-6M3 21v-6h6"/></svg>',
    conta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  };

  // ---------------- IndexedDB ----------------
  const idb = (() => {
    let dbp;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('routproject-tecnico', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('kv');
          d.createObjectStore('fila', { keyPath: 'id' });
          d.createObjectStore('fotos', { keyPath: 'client_id' });
          d.createObjectStore('erros', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    const tx = async (store, mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode); const s = t.objectStore(store);
        let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    };
    return {
      get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
      put: (store, val, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))),
      del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
      all: (store) => tx(store, 'readonly', (s) => s.getAll()),
      clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
    };
  })();

  // ---------------- Estado ----------------
  let B = null;           // pacote do servidor + mudanças locais
  let meta = {};          // { ultimaSync }
  let fila = [];          // ações pendentes
  let fotosPend = [];     // fotos pendentes (metadados; o blob fica no IndexedDB)
  let erros = [];
  let syncing = false;
  let filtro = 'abertas';
  const urls = new Map(); // client_id -> objectURL das fotos locais

  async function carregarLocal() {
    B = (await idb.get('kv', 'bundle')) || null;
    meta = (await idb.get('kv', 'meta')) || {};
    fila = (await idb.all('fila')).sort((a, b) => a.ts - b.ts);
    fotosPend = (await idb.all('fotos')).map(({ blob, ...m }) => m).sort((a, b) => a.ts - b.ts);
    erros = await idb.all('erros');
  }
  const salvarBundle = () => idb.put('kv', B, 'bundle');
  const salvarMeta = () => idb.put('kv', meta, 'meta');
  const pendentes = () => fila.length + fotosPend.length;

  // Aplica as mudanças ainda não enviadas por cima do pacote vindo do servidor
  function aplicarPendentes(bundle) {
    for (const a of fila) aplicarLocal(bundle, a);
    for (const f of fotosPend) {
      const l = (bundle.fotos[f.tarefa_id] = bundle.fotos[f.tarefa_id] || []);
      if (!l.some((x) => x.client_id === f.client_id)) l.push({ client_id: f.client_id, item_id: f.item_id, legenda: f.legenda, criado_em: new Date(f.ts).toISOString(), local: true });
    }
    return bundle;
  }
  function aplicarLocal(bundle, a) {
    const t = bundle.tarefas.find((x) => x.id === a.tarefa_id);
    if (!t) return;
    if (a.tipo === 'status') {
      t.status = a.status; t.atualizado_em = a.em;
      if ((a.status === 'em_andamento' || a.status === 'concluida') && !t.realizada_inicio) t.realizada_inicio = a.em;
      t.realizada_fim = a.status === 'concluida' ? a.em : null;
    }
    if (a.tipo === 'resposta') { (bundle.respostas[a.tarefa_id] = bundle.respostas[a.tarefa_id] || {})[a.item_id] = { valor: a.valor, ok: a.ok }; }
    if (a.tipo === 'ativo') {
      const p = ((bundle.patrimonio = bundle.patrimonio || {})[t.endereco_id] = (bundle.patrimonio || {})[t.endereco_id] || { itens: [], ativos: [] });
      const igual = (x) => (a.patrimonio && x.patrimonio && x.patrimonio.toLowerCase() === a.patrimonio.toLowerCase()) || (a.numero_serie && x.numero_serie && x.numero_serie.toLowerCase() === a.numero_serie.toLowerCase());
      if (!p.ativos.some(igual)) p.ativos.push({ client_id: a.id, item_id: a.item_id, patrimonio: a.patrimonio, numero_serie: a.numero_serie, status: 'instalado', local: true });
    }
  }

  async function enfileirar(acao) {
    const a = { id: uuid(), ts: Date.now(), em: new Date().toISOString(), usuario_id: B.usuario.id, ...acao };
    // respostas repetidas do mesmo item: mantém só a última na fila
    if (a.tipo === 'resposta') {
      for (const x of fila.filter((y) => y.tipo === 'resposta' && y.tarefa_id === a.tarefa_id && y.item_id === a.item_id)) {
        await idb.del('fila', x.id); fila = fila.filter((y) => y.id !== x.id);
      }
    }
    fila.push(a); await idb.put('fila', a);
    aplicarLocal(B, a); await salvarBundle();
    agendarSync();
  }

  // ---------------- API ----------------
  async function api(path, { method = 'GET', body } = {}) {
    const o = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, o); } catch (_) { throw Object.assign(new Error('Sem conexão'), { rede: true }); }
    let data = null; try { data = await res.json(); } catch (_) { /* vazio */ }
    if (res.status === 403 && data && data.trocar_senha) { location.href = '/senha.html?volta=/m/'; throw Object.assign(new Error(data.erro), { status: 403, data }); }
    if (!res.ok) throw Object.assign(new Error((data && data.erro) || `Erro ${res.status}`), { status: res.status, data });
    return data;
  }
  const blobBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

  // ---------------- Sincronização ----------------
  let syncT;
  function agendarSync(ms = 400) { clearTimeout(syncT); syncT = setTimeout(sincronizar, ms); }

  async function sincronizar({ manual = false } = {}) {
    if (syncing) return;
    if (!navigator.onLine) { if (manual) toast('Sem internet. Os dados ficam guardados no aparelho.'); render(); return; }
    syncing = true; renderStatus();
    let ok = true;
    try {
      // 1) fotos
      for (const m of fotosPend.slice()) {
        if (B && m.usuario_id !== B.usuario.id) continue;
        const reg = await idb.get('fotos', m.client_id);
        if (!reg) { fotosPend = fotosPend.filter((x) => x.client_id !== m.client_id); continue; }
        try {
          const r = await api('/mobile/fotos', { method: 'POST', body: {
            client_id: m.client_id, tarefa_id: m.tarefa_id, item_id: m.item_id || null, legenda: m.legenda || null,
            mime: reg.blob.type || 'image/jpeg', base64: await blobBase64(reg.blob), lat: m.lat ?? null, lon: m.lon ?? null, tirada_em: new Date(m.ts).toISOString() } });
          await idb.del('fotos', m.client_id);
          fotosPend = fotosPend.filter((x) => x.client_id !== m.client_id);
          const l = B && B.fotos[m.tarefa_id]; const f = l && l.find((x) => x.client_id === m.client_id);
          if (f) { f.id = r.id; f.local = false; }
          if (urls.has(m.client_id)) { URL.revokeObjectURL(urls.get(m.client_id)); urls.delete(m.client_id); }
        } catch (e) {
          if (e.rede || e.status === 401 || e.status >= 500) throw e;
          await registrarErro({ id: m.client_id, tipo: 'foto', tarefa_id: m.tarefa_id, erro: e.message, ts: m.ts });
          await idb.del('fotos', m.client_id); fotosPend = fotosPend.filter((x) => x.client_id !== m.client_id);
        }
      }
      // 2) ações (na ordem em que foram feitas)
      const minhas = fila.filter((a) => !B || a.usuario_id === B.usuario.id);
      for (let i = 0; i < minhas.length; i += 100) {
        const lote = minhas.slice(i, i + 100);
        const r = await api('/mobile/acoes', { method: 'POST', body: { acoes: lote.map(({ ts, usuario_id, ...a }) => a) } });
        for (const res of r.resultados) {
          const a = fila.find((x) => x.id === res.id);
          if (!res.ok && a) await registrarErro({ id: a.id, tipo: a.tipo, tarefa_id: a.tarefa_id, erro: res.erro, ts: a.ts, acao: a });
          await idb.del('fila', res.id); fila = fila.filter((x) => x.id !== res.id);
        }
      }
      // 3) pacote atualizado
      const novo = await api('/mobile/sync');
      if (B && B.usuario.id !== novo.usuario.id) { await idb.clear('fila'); fila = []; }
      B = aplicarPendentes(novo);
      await salvarBundle();
      meta.ultimaSync = new Date().toISOString(); await salvarMeta();
    } catch (e) {
      ok = false;
      if (e.status === 401) { syncing = false; telaLogin('Sua sessão expirou. Entre de novo para enviar o que está guardado.'); return; }
      if (manual) toast(e.rede ? 'Sem conexão com o servidor. Tentamos de novo depois.' : e.message);
    } finally {
      syncing = false;
    }
    if (ok && manual) toast(erros.length ? 'Sincronizado, com itens para revisar' : 'Tudo sincronizado');
    render();
  }
  async function registrarErro(e) { erros.push(e); await idb.put('erros', e); }

  window.addEventListener('online', () => { renderStatus(); agendarSync(200); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') agendarSync(300); });
  setInterval(() => { if (pendentes() || Date.now() - new Date(meta.ultimaSync || 0).getTime() > 5 * 60000) agendarSync(0); }, 60000);

  // ---------------- Interface ----------------
  const app = $('#app');
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }

  function statusChip() {
    if (syncing) return '<button class="net pend" data-go="#/sync"><i></i>Sincronizando…</button>';
    if (!navigator.onLine) return `<button class="net off" data-go="#/sync"><i></i>Sem internet${pendentes() ? ` · ${pendentes()}` : ''}</button>`;
    if (pendentes()) return `<button class="net pend" data-go="#/sync"><i></i>${pendentes()} para enviar</button>`;
    return `<button class="net" data-go="#/sync"><i></i>${esc(desde(meta.ultimaSync))}</button>`;
  }
  function renderStatus() { const c = $('#chip'); if (c) c.innerHTML = statusChip(); bindGo(c); const bd = $('#badge'); if (bd) { bd.textContent = pendentes() + erros.length; bd.hidden = !(pendentes() + erros.length); } }
  function bindGo(root) { if (!root) return; $$('[data-go]', root).forEach((b) => (b.onclick = () => { location.hash = b.dataset.go; })); }

  function layout({ title, sub = '', back = false, nav = 'hoje', body }) {
    app.innerHTML = `
      <header class="hd"><div class="row1">${back ? '<button class="back" aria-label="Voltar" id="back">‹</button>' : ''}<h1>${esc(title)}</h1><span id="chip">${statusChip()}</span></div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}</header>
      <main class="pg">${body}</main>
      <nav class="nav" aria-label="Navegação">
        <a href="#/" ${nav === 'hoje' ? 'aria-current="page"' : ''}>${ICON.hoje}Atividades</a>
        <a href="#/sync" ${nav === 'sync' ? 'aria-current="page"' : ''}>${ICON.sync}Sincronizar<span class="badge" id="badge" ${pendentes() + erros.length ? '' : 'hidden'}>${pendentes() + erros.length}</span></a>
        <a href="#/conta" ${nav === 'conta' ? 'aria-current="page"' : ''}>${ICON.conta}Conta</a>
      </nav>`;
    if (back) $('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
    bindGo(app);
    window.scrollTo(0, 0);
  }

  // progresso do checklist de uma tarefa
  function progresso(t) {
    const ck = t.checklist_id && B.checklists[t.checklist_id];
    if (!ck) return null;
    const resp = B.respostas[t.id] || {}; const fotos = B.fotos[t.id] || [];
    const feito = (i) => (resp[i.id] && resp[i.id].ok) || (i.tipo_resposta === 'foto' && fotos.some((f) => f.item_id === i.id));
    const obr = ck.itens.filter((i) => i.obrigatorio);
    return { total: ck.itens.length, feitos: ck.itens.filter(feito).length, faltam: obr.filter((i) => !feito(i)) };
  }

  function telaHoje() {
    const ts = B.tarefas;
    const abertas = ts.filter((t) => t.status !== 'concluida');
    const vis = filtro === 'abertas' ? abertas : ts.filter((t) => t.status === 'concluida');
    const grupos = new Map();
    for (const t of vis) { if (!grupos.has(t.endereco_id)) grupos.set(t.endereco_id, []); grupos.get(t.endereco_id).push(t); }
    const nome = (B.usuario.nome || '').split(' ')[0];
    layout({
      title: `Olá, ${nome}`,
      sub: `${abertas.length} atividade(s) em aberto em ${new Set(abertas.map((t) => t.endereco_id)).size} endereço(s)`,
      body: `
        <div class="kpis">
          <div class="kpi"><b>${ts.filter((t) => t.status === 'a_fazer').length}</b><span>A fazer</span></div>
          <div class="kpi"><b>${ts.filter((t) => t.status === 'em_andamento' || t.status === 'aguardando').length}</b><span>Em andamento</span></div>
          <div class="kpi"><b>${ts.filter((t) => t.status === 'concluida').length}</b><span>Concluídas (7 dias)</span></div>
        </div>
        <div class="seg" role="group" aria-label="Filtro"><button aria-pressed="${filtro === 'abertas'}" data-f="abertas">Em aberto</button><button aria-pressed="${filtro === 'feitas'}" data-f="feitas">Concluídas</button></div>
        ${bannerInstalar()}
        ${erros.length ? `<a class="errbox" href="#/sync" style="text-decoration:none;color:inherit">${erros.length} item(ns) não foram aceitos pelo servidor. Toque para revisar.</a>` : ''}
        ${!B.usuario.pessoa_id ? '<div class="warnbox">Seu usuário ainda não está ligado a um técnico. Peça ao administrador.</div>' : ''}
        ${grupos.size ? [...grupos.values()].map((g) => { const e = g[0]; return `<a class="card end" href="#/e/${e.endereco_id}">
            <h2>${esc(e.endereco)}</h2><div class="meta">${esc(e.municipio)}/${esc(e.uf)} · ${e.cameras} câmeras · ${esc(e.cliente)}</div>
            <div class="acts">${g.map((t) => `<div class="act"><span class="n">${esc(t.atividade)}</span><span class="pill ${t.status}"><i></i>${ST[t.status]}</span></div>`).join('')}</div></a>`; }).join('')
          : `<div class="empty">${filtro === 'abertas' ? 'Nenhuma atividade com você agora.<br>Puxe novidades em Sincronizar.' : 'Nada concluído nos últimos 7 dias.'}</div>`}`,
    });
    $$('[data-f]').forEach((b) => (b.onclick = () => { filtro = b.dataset.f; telaHoje(); }));
    ligarBanner();
  }

  function telaEndereco(id) {
    const ts = B.tarefas.filter((t) => t.endereco_id === id);
    if (!ts.length) { location.hash = '#/'; return; }
    const e = ts[0];
    const endTxt = [e.logradouro, e.bairro, e.cep].filter(Boolean).join(' · ');
    const mapa = e.lat != null ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.endereco} ${e.municipio} ${e.uf}`)}`;
    layout({
      title: e.endereco, sub: `${esc(e.municipio)}/${esc(e.uf)} · ${esc(e.codigo || '')}`, back: true,
      body: `
        <div class="card pad"><dl class="info">
          <dt>Cliente</dt><dd>${esc(e.cliente)} · ${esc(e.contrato)}</dd>
          ${endTxt ? `<dt>Endereço</dt><dd>${esc(endTxt)}</dd>` : ''}
          <dt>Câmeras</dt><dd>${e.cameras}</dd>
          ${(e.equipamentos || []).length ? `<dt>Equipamentos</dt><dd>${e.equipamentos.map((q) => `${esc(q.nome)}: <b>${q.quantidade}</b>`).join('<br>')}</dd>` : ''}
          <dt>Situação</dt><dd>${esc(e.endereco_status)}</dd>
          ${e.aeroporto ? `<dt>Aeroporto</dt><dd>${esc(e.aeroporto)}${e.km_aeroporto ? ` · ${e.km_aeroporto} km` : ''}</dd>` : ''}
        </dl><a class="btn block" style="margin-top:12px" href="${mapa}" target="_blank" rel="noopener">Abrir no mapa</a></div>
        <div class="sec">Suas atividades aqui</div>
        ${ts.map((t) => { const p = progresso(t); const nf = (B.fotos[t.id] || []).length; return `<a class="card end" href="#/t/${t.id}">
          <div class="act"><span class="n"><b>${esc(t.atividade)}</b></span><span class="pill ${t.status}"><i></i>${ST[t.status]}</span></div>
          <div class="meta">${p ? `Checklist ${p.feitos}/${p.total} · ` : ''}${nf} foto(s)${t.prevista_inicio ? ` · previsto ${fmtData(t.prevista_inicio)}` : ''}</div>
          ${p ? `<div class="bar" style="margin-top:8px"><i style="width:${p.total ? Math.round(p.feitos / p.total * 100) : 0}%"></i></div>` : ''}</a>`; }).join('')}`,
    });
  }

  // Predecessora: a atividade só conclui depois que a predecessora estiver concluída no mesmo endereço
  function predPendente(t) {
    if (!t.pred_nome) return null;
    const local = B.tarefas.find((x) => x.endereco_id === t.endereco_id && x.atividade === t.pred_nome);
    const st = local ? local.status : t.pred_status;
    return st === 'concluida' ? null : { nome: t.pred_nome, status: st };
  }

  function botoesStatus(t) {
    const b = [];
    if (t.status === 'a_fazer') b.push('<button class="btn primary block" data-s="em_andamento">Iniciar</button>');
    if (t.status === 'em_andamento') b.push('<div class="btns"><button class="btn" data-s="aguardando">Pausar</button><button class="btn ok" data-s="concluida">Concluir</button></div>');
    if (t.status === 'aguardando') b.push('<div class="btns"><button class="btn primary" data-s="em_andamento">Retomar</button><button class="btn ok" data-s="concluida">Concluir</button></div>');
    if (t.status === 'concluida') b.push((B.usuario.perfil === 'admin' || (B.usuario.acoes && B.usuario.acoes.reabrir)) ? '<button class="btn block" data-s="em_andamento">Reabrir</button>' : '<p class="muted" style="text-align:center;font-size:.85rem;margin:4px 0">Concluída. Para reabrir, fale com a coordenação ou a supervisão.</p>');
    return b.join('');
  }

  function fotoSrc(f) {
    if (f.local) {
      if (!urls.has(f.client_id)) { urls.set(f.client_id, ''); idb.get('fotos', f.client_id).then((r) => { if (r) { urls.set(f.client_id, URL.createObjectURL(r.blob)); $$(`img[data-cid="${f.client_id}"]`).forEach((im) => { im.src = urls.get(f.client_id); }); } }); }
      return urls.get(f.client_id) || '';
    }
    return f.id ? `/api/fotos/${f.id}` : '';
  }
  const thumbs = (lista) => lista.map((f) => `<div class="thumbw"><img class="thumb" alt="Foto${f.legenda ? ': ' + esc(f.legenda) : ''}" data-cid="${esc(f.client_id || '')}" data-fid="${f.id || ''}" src="${esc(fotoSrc(f))}" loading="lazy">${f.local ? '<span class="q">na fila</span>' : ''}</div>`).join('');
  const botaoCam = (item) => `<label class="cam" aria-label="Tirar foto">${ICON.cam}<input type="file" accept="image/*" capture="environment" hidden data-foto="${item || ''}"></label>`;

  function telaTarefa(id) {
    const t = B.tarefas.find((x) => x.id === id);
    if (!t) { location.hash = '#/'; return; }
    const ck = t.checklist_id && B.checklists[t.checklist_id];
    const resp = B.respostas[t.id] || {};
    const fotos = B.fotos[t.id] || [];
    const p = progresso(t);
    layout({
      title: t.atividade, sub: `${esc(t.endereco)} · ${esc(t.municipio)}/${esc(t.uf)}`, back: true,
      body: `
        <div class="card pad" style="display:flex;flex-direction:column;gap:10px">
          <div class="act"><span class="n">Status</span><span class="pill ${t.status}"><i></i>${ST[t.status]}</span></div>
          ${botoesStatus(t)}
          ${predPendente(t) ? `<div class="warnbox">🔒 Só pode ser concluída depois de <b>${esc(predPendente(t).nome)}</b>${predPendente(t).status ? ` (agora: ${ST[predPendente(t).status] || 'sem registro'})` : ''}.</div>` : ''}
          <div class="tempos"><div><span>Início</span><b>${t.realizada_inicio ? fmtHora(t.realizada_inicio) : '—'}</b></div><div><span>Conclusão</span><b>${t.realizada_fim ? fmtHora(t.realizada_fim) : '—'}</b></div></div>
          ${t.evidencia ? `<div class="note">Evidência exigida: ${esc(t.evidencia)}</div>` : ''}
          <a class="btn block" id="relPdf" href="/api/tarefas/${t.id}/relatorio.pdf" target="_blank" rel="noopener">${t.status === 'concluida' ? 'Relatório final (PDF)' : 'Relatório parcial (PDF)'}</a>
        </div>
        ${ck ? `<div class="sec">Checklist · ${esc(ck.nome)} (${p.feitos}/${p.total})</div>
          <div class="card ck">${ck.itens.map((i) => {
            const r = resp[i.id] || {}; const fi = fotos.filter((f) => f.item_id === i.id);
            const obr = i.obrigatorio ? '<span class="req" aria-label="obrigatório">*</span><small class="reqt">Obrigatório</small>' : '<small>Opcional</small>';
            if (i.tipo_resposta === 'foto') return `<div class="it" data-it="${i.id}"><div class="tx">${esc(i.texto)}${obr}<div class="thumbs">${thumbs(fi)}${botaoCam(i.id)}</div></div></div>`;
            if (i.tipo_resposta === 'texto' || i.tipo_resposta === 'numero') return `<div class="it" data-it="${i.id}"><div class="tx">${esc(i.texto)}${obr}
              <input class="in" data-item="${i.id}" ${i.tipo_resposta === 'numero' ? 'inputmode="decimal"' : ''} value="${esc(r.valor || '')}" placeholder="${i.tipo_resposta === 'numero' ? 'Número' : 'Escreva aqui'}" aria-label="${esc(i.texto)}"></div></div>`;
            return `<div class="it" data-it="${i.id}"><button class="box" role="checkbox" aria-checked="${!!r.ok}" data-check="${i.id}" aria-label="${esc(i.texto)}"></button><div class="tx">${esc(i.texto)}${obr}</div></div>`;
          }).join('')}</div>` : ''}
        ${secPatrimonio(t)}
        <div class="sec">Fotos da atividade (${fotos.filter((f) => !f.item_id).length})</div>
        <div class="card pad"><div class="thumbs" style="margin-top:0">${thumbs(fotos.filter((f) => !f.item_id))}${botaoCam('')}</div>
          <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:.88rem;color:var(--muted)"><input type="checkbox" id="gps" ${meta.gps !== false ? 'checked' : ''}> Guardar a localização nas fotos</label></div>
        <div class="sec">Comentário</div>
        <div class="card pad"><textarea class="in" id="coment" style="margin-top:0" placeholder="Ex.: gerente pediu para voltar amanhã às 8h"></textarea>
          <button class="btn block" style="margin-top:8px" id="envComent">Adicionar comentário</button></div>`,
    });

    $$('[data-s]').forEach((b) => (b.onclick = async () => {
      const s = b.dataset.s;
      if (s === 'concluida' && predPendente(t)) { toast(`Conclua antes: ${predPendente(t).nome}`); return; }
      if (s === 'concluida' && p && p.faltam.length) {
        p.faltam.forEach((i) => $(`[data-it="${i.id}"]`)?.classList.add('falta'));
        $(`[data-it="${p.faltam[0].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`Preencha os itens obrigatórios (*): faltam ${p.faltam.length}`); return;
      }
      if (s === 'concluida' && !fotos.length && t.evidencia && !confirm('Nenhuma foto registrada. Concluir mesmo assim?')) return;
      await enfileirar({ tipo: 'status', tarefa_id: t.id, status: s });
      toast(s === 'concluida' ? 'Atividade concluída' : s === 'em_andamento' ? 'Atividade em andamento' : 'Atividade pausada');
      telaTarefa(id);
    }));
    $$('[data-check]').forEach((b) => (b.onclick = async () => {
      const ok = b.getAttribute('aria-checked') !== 'true';
      await enfileirar({ tipo: 'resposta', tarefa_id: t.id, item_id: +b.dataset.check, ok, valor: ok ? 'ok' : null });
      telaTarefa(id);
    }));
    $$('[data-item]').forEach((inp) => (inp.onchange = async () => {
      const valor = inp.value.trim();
      await enfileirar({ tipo: 'resposta', tarefa_id: t.id, item_id: +inp.dataset.item, ok: !!valor, valor: valor || null });
      toast('Resposta guardada');
      telaTarefa(id);
    }));
    $$('[data-foto]').forEach((inp) => (inp.onchange = () => novaFoto(t, inp.dataset.foto ? +inp.dataset.foto : null, inp.files[0])));
    ligarPatrimonio(t, () => telaTarefa(id));
    $$('img.thumb').forEach((im) => (im.onclick = () => verFoto(im)));
    $('#gps').onchange = async (e) => { meta.gps = e.target.checked; await salvarMeta(); };
    $('#relPdf').onclick = (e) => {
      if (!navigator.onLine) { e.preventDefault(); toast('O relatório precisa de internet para ser gerado.'); return; }
      if (pendentes()) toast('Há itens ainda não enviados: o relatório mostra só o que já chegou ao servidor.');
    };
    $('#envComent').onclick = async () => {
      const texto = $('#coment').value.trim(); if (!texto) return;
      await enfileirar({ tipo: 'comentario', tarefa_id: t.id, texto });
      $('#coment').value = ''; toast(navigator.onLine ? 'Comentário enviado' : 'Comentário guardado para enviar');
    };
  }

  // ---------- Patrimônio no campo: registra patrimônio / série dos itens controlados deste endereço ----------
  function secPatrimonio(t) {
    const p = (B.patrimonio || {})[t.endereco_id];
    if (!p || !p.itens.length) return '';
    const inst = (i) => p.ativos.filter((a) => a.item_id === i.id && a.status === 'instalado').length;
    const leitor = 'BarcodeDetector' in window;
    return `<div class="sec">Patrimônio deste endereço</div>
      <div class="card pad pat">
        <div class="patc">${p.itens.map((i) => { const n = inst(i); return `<span class="pill ${n >= i.quantidade ? 'concluida' : 'a_fazer'}"><i></i>${esc(i.nome)} ${n}/${i.quantidade}</span>`; }).join('')}</div>
        ${p.ativos.length ? `<ul class="patl">${p.ativos.map((a) => `<li><b>${esc(a.patrimonio || '—')}</b> <span>${esc(a.numero_serie ? 'série ' + a.numero_serie : '')}</span> <small>${esc((p.itens.find((i) => i.id === a.item_id) || {}).nome || '')}${a.local ? ' · na fila' : ''}</small></li>`).join('')}</ul>` : ''}
        <label class="lb" for="pt-i">Item</label><select class="in" id="pt-i">${p.itens.map((i) => `<option value="${i.id}" ${inst(i) < i.quantidade ? '' : ''}>${esc(i.nome)}</option>`).join('')}</select>
        <label class="lb" for="pt-p">Patrimônio</label><div class="row2"><input class="in" id="pt-p" autocomplete="off" placeholder="Ex.: BNB-000123">${leitor ? '<label class="btn sm ler" title="Ler o código com a câmera">Ler<input type="file" accept="image/*" capture="environment" hidden data-ler="pt-p"></label>' : ''}</div>
        <label class="lb" for="pt-s">Número de série</label><div class="row2"><input class="in" id="pt-s" autocomplete="off" placeholder="Opcional se tiver patrimônio">${leitor ? '<label class="btn sm ler" title="Ler o código com a câmera">Ler<input type="file" accept="image/*" capture="environment" hidden data-ler="pt-s"></label>' : ''}</div>
        <button class="btn primary block" style="margin-top:10px" id="pt-ok">Registrar como instalado</button>
        <p class="muted" style="font-size:.8rem;margin:8px 0 0">Sem internet, fica guardado e é enviado na próxima sincronização.</p>
      </div>`;
  }
  function ligarPatrimonio(t, redesenhar) {
    const ok = $('#pt-ok'); if (!ok) return;
    // sugere o primeiro item que ainda falta
    const p = B.patrimonio[t.endereco_id];
    const falta = p.itens.find((i) => p.ativos.filter((a) => a.item_id === i.id && a.status === 'instalado').length < i.quantidade);
    if (falta) $('#pt-i').value = String(falta.id);
    ok.onclick = async () => {
      const patrimonio = $('#pt-p').value.trim(), numero_serie = $('#pt-s').value.trim();
      if (!patrimonio && !numero_serie) { toast('Informe o patrimônio ou o número de série'); return; }
      const dup = p.ativos.some((a) => (patrimonio && a.patrimonio && a.patrimonio.toLowerCase() === patrimonio.toLowerCase()) || (numero_serie && a.numero_serie && a.numero_serie.toLowerCase() === numero_serie.toLowerCase()));
      if (dup) { toast('Esse patrimônio já está registrado aqui'); return; }
      await enfileirar({ tipo: 'ativo', tarefa_id: t.id, item_id: +$('#pt-i').value, patrimonio: patrimonio || null, numero_serie: numero_serie || null });
      toast(navigator.onLine ? 'Patrimônio registrado' : 'Patrimônio guardado para enviar');
      redesenhar();
      setTimeout(() => $('#pt-p')?.focus(), 50);
    };
    $$('[data-ler]').forEach((inp) => (inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const det = new window.BarcodeDetector();
        const r = await det.detect(await createImageBitmap(f));
        if (!r.length) { toast('Não achei código na foto. Aproxime e tente de novo.'); return; }
        $('#' + inp.dataset.ler).value = r[0].rawValue; toast('Código lido');
      } catch (_) { toast('Este aparelho não lê código pela câmera. Digite o número.'); }
      inp.value = '';
    }));
  }

  function verFoto(im) {
    const v = document.createElement('div'); v.className = 'viewer';
    v.innerHTML = `<img alt="Foto ampliada" src="${esc(im.src)}"><div class="bar2"><span>${esc(im.alt)}</span><button class="btn sm">Fechar</button></div>`;
    v.querySelector('button').onclick = () => v.remove(); document.body.appendChild(v);
  }

  // Comprime a foto no aparelho (máx. 1600 px, JPEG 80%) antes de guardar
  async function comprimir(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { bmp = null; }
    if (!bmp) {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const max = 1600; const w = bmp.width, h = bmp.height; const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.8));
  }
  // Localização é opcional: nunca segura a foto por mais de 3 s (nem se o pedido de permissão ficar aberto)
  const posicao = () => new Promise((res) => {
    if (meta.gps === false || !navigator.geolocation) return res(null);
    const t = setTimeout(() => res(null), 3000);
    navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); res({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { clearTimeout(t); res(null); }, { timeout: 3000, maximumAge: 120000, enableHighAccuracy: true });
  });

  async function novaFoto(t, itemId, file) {
    if (!file) return;
    toast('Guardando foto…');
    try {
      const [blob, pos] = await Promise.all([comprimir(file), posicao()]);
      const m = { client_id: uuid(), tarefa_id: t.id, item_id: itemId, legenda: itemId ? (B.checklists[t.checklist_id].itens.find((i) => i.id === itemId) || {}).texto : null,
        lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, ts: Date.now(), usuario_id: B.usuario.id };
      await idb.put('fotos', { ...m, blob });
      fotosPend.push(m);
      urls.set(m.client_id, URL.createObjectURL(blob));
      (B.fotos[t.id] = B.fotos[t.id] || []).push({ client_id: m.client_id, item_id: itemId, legenda: m.legenda, criado_em: new Date().toISOString(), local: true });
      await salvarBundle();
      toast(navigator.onLine ? 'Foto guardada, enviando…' : 'Foto guardada no aparelho');
      telaTarefa(t.id);
      agendarSync();
    } catch (e) {
      toast('Não foi possível guardar a foto: ' + (e.message || e));
    }
  }

  function nomeTarefa(id) { const t = B && B.tarefas.find((x) => x.id === id); return t ? `${t.atividade} · ${t.endereco}` : `Atividade ${id}`; }
  const ROT = { status: (a) => `Status → ${ST[a.status]}`, resposta: (a) => `Checklist: ${a.ok ? 'item marcado' : 'item desmarcado'}`, comentario: () => 'Comentário', foto: () => 'Foto', ativo: (a) => `Patrimônio ${a.patrimonio || a.numero_serie}` };

  function telaSync() {
    layout({
      title: 'Sincronizar', nav: 'sync',
      sub: navigator.onLine ? `Última atualização: ${esc(desde(meta.ultimaSync))}` : 'Você está sem internet. Tudo continua guardado no aparelho.',
      body: `
        <button class="btn primary block" id="syncNow" ${syncing ? 'disabled' : ''}>${syncing ? 'Sincronizando…' : 'Sincronizar agora'}</button>
        <div class="sec">Para enviar (${pendentes()})</div>
        <div class="card">${pendentes() ? [
          ...fotosPend.map((f) => `<div class="it"><div class="tx">📷 Foto${f.legenda ? ' · ' + esc(f.legenda) : ''}<small>${esc(nomeTarefa(f.tarefa_id))} · ${fmtHora(f.ts)}</small></div></div>`),
          ...fila.map((a) => `<div class="it"><div class="tx">${esc(ROT[a.tipo](a))}<small>${esc(nomeTarefa(a.tarefa_id))} · ${fmtHora(a.ts)}</small></div></div>`),
        ].join('') : '<div class="empty" style="padding:20px">Nada pendente.</div>'}</div>
        ${erros.length ? `<div class="sec">Não aceitos pelo servidor (${erros.length})</div>
          <div class="card">${erros.map((e) => `<div class="it"><div class="tx">${esc(ROT[e.tipo] ? ROT[e.tipo](e.acao || {}) : e.tipo)}<small>${esc(nomeTarefa(e.tarefa_id))}</small><small style="color:var(--err)">${esc(e.erro)}</small></div></div>`).join('')}</div>
          <button class="btn block" id="limparErros">Entendi, limpar esta lista</button>` : ''}
        <p style="color:var(--muted);font-size:.85rem;margin:4px 2px">O app envia sozinho quando a internet volta. Fotos vão primeiro, depois as mudanças de status e checklist, na ordem em que foram feitas.</p>`,
    });
    $('#syncNow').onclick = () => sincronizar({ manual: true }).then(() => { if (location.hash === '#/sync') telaSync(); });
    $('#limparErros')?.addEventListener('click', async () => { await idb.clear('erros'); erros = []; telaSync(); });
  }

  function telaConta() {
    layout({
      title: 'Conta', nav: 'conta',
      body: `
        <div class="card pad"><dl class="info"><dt>Nome</dt><dd>${esc(B.usuario.nome)}</dd><dt>Perfil</dt><dd>${esc(B.usuario.perfil)}</dd><dt>Versão</dt><dd>${VERSAO}</dd></dl></div>
        <div class="card pad" id="instalar" hidden><b>Instalar o app</b><p style="margin:6px 0 10px;color:var(--muted);font-size:.9rem">Coloca o RoutProject na tela inicial, com ícone próprio.</p><button class="btn primary block" id="btnInstalar">Instalar</button></div>
        <div class="card pad" id="iosDica" hidden><b>Instalar no iPhone</b><p style="margin:6px 0 0;color:var(--muted);font-size:.9rem">No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p></div>
        <a class="btn block" href="/">Abrir o sistema completo</a>
        <button class="btn block" id="sair" style="color:var(--err)">Sair</button>`,
    });
    if (deferredInstall) { $('#instalar').hidden = false; $('#btnInstalar').onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#instalar').hidden = true; }; }
    else if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) $('#iosDica').hidden = false;
    $('#sair').onclick = async () => {
      if (pendentes() && !confirm(`Há ${pendentes()} item(ns) ainda não enviados. Se sair, eles serão apagados deste aparelho. Sair mesmo assim?`)) return;
      try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* offline */ }
      await Promise.all(['fila', 'fotos', 'erros'].map((s) => idb.clear(s))); await idb.del('kv', 'bundle');
      B = null; fila = []; fotosPend = []; erros = [];
      telaLogin();
    };
  }

  function telaLogin(msg = '') {
    app.innerHTML = `<form class="login" id="f" novalidate>
      <div class="logo"><span class="mark" style="width:42px;height:42px;border-radius:11px"></span><span>Rout<b>Project</b></span></div>
      <h1 style="font-size:2rem">App do técnico</h1>
      <p style="color:var(--muted);margin:6px 0 0">Entre com o mesmo e-mail e senha do sistema.</p>
      ${msg ? `<div class="alert" style="background:var(--accent-soft)">${esc(msg)}</div>` : ''}
      <label for="email">E-mail</label><input class="in" id="email" type="email" autocomplete="email" required value="${esc((B && B.usuario && B.usuario.email) || '')}">
      <label for="senha">Senha</label><input class="in" id="senha" type="password" autocomplete="current-password" required>
      <div class="alert" id="err" hidden></div>
      <button class="btn primary block" style="margin-top:18px" id="go">Entrar</button>
      <p style="text-align:center;margin-top:16px;font-size:.9rem"><a href="/recuperar.html">Esqueci minha senha</a> · <a href="/cadastro.html">Criar cadastro</a></p>
    </form>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#err'); err.hidden = true;
      if (!navigator.onLine) { err.textContent = 'Sem internet. Conecte-se para entrar.'; err.hidden = false; return; }
      $('#go').disabled = true;
      try {
        const r = await api('/auth/login', { method: 'POST', body: { email: $('#email').value.trim(), senha: $('#senha').value, lembrar: true } });
        if (pendentes() && B && B.usuario.id !== r.usuario.id) {
          if (!confirm('Há itens de outro usuário guardados neste aparelho. Eles serão descartados. Continuar?')) { $('#go').disabled = false; return; }
          await Promise.all(['fila', 'fotos', 'erros'].map((s) => idb.clear(s))); fila = []; fotosPend = []; erros = [];
        }
        B = B && B.usuario.id === r.usuario.id ? B : { usuario: r.usuario, tarefas: [], checklists: {}, respostas: {}, fotos: {} };
        await sincronizar();
        rota();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; $('#go').disabled = false; }
    };
  }

  // ---------------- Rotas ----------------
  function rota() {
    if (!B) return telaLogin();
    const h = location.hash || '#/';
    let m;
    if ((m = h.match(/^#\/e\/(\d+)/))) return telaEndereco(+m[1]);
    if ((m = h.match(/^#\/t\/(\d+)/))) return telaTarefa(+m[1]);
    if (h.startsWith('#/sync')) return telaSync();
    if (h.startsWith('#/conta')) return telaConta();
    return telaHoje();
  }
  function render() { if (!B || !$('.hd')) return; const y = window.scrollY; rota(); window.scrollTo(0, y); }
  window.addEventListener('hashchange', rota);

  // Instalar como aplicativo (Chrome/Android: botão; iPhone: instrução). Instalado, abre em tela cheia e funciona sem internet.
  let deferredInstall = null;
  const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const dispensado = () => { try { return Date.now() - (+localStorage.getItem('rp-m-inst-x') || 0) < 7 * 86400000; } catch (_) { return false; } };
  function bannerInstalar() {
    if (instalado() || dispensado()) return '';
    if (!deferredInstall && !ehIOS && !/android/i.test(navigator.userAgent)) return '';
    const txt = deferredInstall ? 'Instale o RoutProject no celular: abre direto da tela inicial e registra checklists e fotos mesmo sem internet (envia sozinho quando a rede voltar).'
      : ehIOS ? 'No Safari, toque em Compartilhar e em “Adicionar à Tela de Início” para usar como aplicativo, inclusive sem internet.'
      : 'No Chrome, toque no menu ⋮ e em “Instalar app” (ou “Adicionar à tela inicial”) para usar como aplicativo, inclusive sem internet.';
    return `<div class="card pad instbox"><div style="display:flex;gap:12px;align-items:flex-start"><img src="/m/icon-192.png" alt="" width="44" height="44" style="border-radius:10px;flex:none">
      <div style="flex:1"><b>Usar como aplicativo</b><p style="margin:4px 0 10px;color:var(--muted);font-size:.88rem">${txt}</p>
      <div style="display:flex;gap:8px">${deferredInstall ? '<button class="btn primary" id="instGo">Instalar aplicativo</button>' : ''}<button class="btn" id="instX">Agora não</button></div></div></div></div>`;
  }
  function ligarBanner() {
    $('#instGo')?.addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; rota(); });
    $('#instX')?.addEventListener('click', () => { try { localStorage.setItem('rp-m-inst-x', String(Date.now())); } catch (_) { /* sem armazenamento */ } rota(); });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (B && (location.hash || '#/') === '#/') rota(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; toast('Aplicativo instalado. Abra pelo ícone na tela inicial.'); });

  // ---------------- Início ----------------
  (async () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' }).catch(() => {});
    try { await carregarLocal(); } catch (_) { /* navegador sem IndexedDB */ }
    if (B) { B = aplicarPendentes(B); rota(); }
    if (!navigator.onLine) { if (!B) telaLogin('Sem internet. Conecte-se uma vez para baixar suas atividades.'); return; }
    try {
      await api('/auth/me');
      await sincronizar();
      rota();
    } catch (e) {
      if (e.status === 401) telaLogin(pendentes() ? 'Sua sessão expirou. Entre de novo para enviar o que está guardado.' : '');
      else if (!B) telaLogin('Não foi possível falar com o servidor agora.');
    }
  })();
})();
