// RoutProject · app do técnico (PWA)
// Funciona sem internet: os dados do dia ficam no aparelho (IndexedDB), as ações entram numa fila
// e as fotos ficam guardadas até a conexão voltar. A sincronização envia fotos primeiro, depois as ações.
(() => {
  'use strict';
  const VERSAO = '1.5.0';
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
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
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
    for (const t of bundle.tarefas || []) if (t._st_srv === undefined) t._st_srv = t.status;
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
    if (a.tipo === 'excluir_foto') { bundle.fotos[a.tarefa_id] = (bundle.fotos[a.tarefa_id] || []).filter((x) => x.id !== a.foto_id); }
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
            mime: reg.blob.type || 'image/jpeg', base64: await blobBase64(reg.blob), lat: m.lat ?? null, lon: m.lon ?? null, tirada_em: new Date(m.ts).toISOString(),
            altitude: m.altitude ?? null, precisao: m.precisao ?? null, local_texto: m.local_texto || null } });
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

  // Percentual de conclusão do endereço pelas atividades (de todos, não só as do técnico); conta o que ainda está na fila
  function avancoEnd(e) {
    let total = e.end_atv_total || 0, feitas = e.end_atv_concluidas || 0;
    if (!total) return null;
    for (const t of B.tarefas.filter((x) => x.endereco_id === e.endereco_id)) {
      const srv = t._st_srv ?? t.status; // status que veio do servidor
      if (t.status === 'concluida' && srv !== 'concluida') feitas++;
      if (t.status !== 'concluida' && srv === 'concluida') feitas--;
    }
    feitas = Math.max(0, Math.min(total, feitas));
    return { total, feitas, pc: Math.round((feitas / total) * 100) };
  }
  const barraAvanco = (a) => a ? `<div class="avm"><div class="bar"><i style="width:${a.pc}%"></i></div><span><b>${a.pc}%</b> · ${a.feitas} de ${a.total} atividades</span></div>` : '';

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
            <h2>${esc(e.endereco)}</h2><div class="meta">${esc(e.municipio)}/${esc(e.uf)} · ${e.cameras} câmeras · ${esc(e.cliente)}</div>${barraAvanco(avancoEnd(e))}
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
          ${avancoEnd(e) ? `<dt>Conclusão</dt><dd>${barraAvanco(avancoEnd(e))}</dd>` : ''}
          ${e.aeroporto ? `<dt>Aeroporto</dt><dd>${esc(e.aeroporto)}${e.km_aeroporto ? ` · ${e.km_aeroporto} km` : ''}</dd>` : ''}
        </dl><a class="btn block" style="margin-top:12px" href="${mapa}" target="_blank" rel="noopener">Abrir no mapa</a></div>
        <div class="sec">Suas atividades aqui</div>
        ${ts.map((t) => { const p = progresso(t); const nf = (B.fotos[t.id] || []).length; return `<a class="card end" href="#/t/${t.id}">
          <div class="act"><span class="n"><b>${esc(t.atividade)}</b>${t.extra ? ` <span class="xtag">Extra ×${String(t.quantidade).replace('.', ',')}</span>` : ''}</span><span class="pill ${t.status}"><i></i>${ST[t.status]}</span></div>
          <div class="meta">${p ? `Checklist ${p.feitos}/${p.total} · ` : ''}${nf} foto(s)${t.prevista_inicio ? ` · previsto ${fmtData(t.prevista_inicio)}` : ''}</div>
          ${p ? `<div class="bar" style="margin-top:8px"><i style="width:${p.total ? Math.round(p.feitos / p.total * 100) : 0}%"></i></div>` : ''}</a>`; }).join('')}
        ${secExtra(e, ts)}`,
    });
    ligarExtra(e, ts, () => telaEndereco(id));
  }

  // ---------- Atividade extra no endereço (ex.: escavação, poste): o técnico inclui no campo, com quantidade e motivo ----------
  function secExtra(e, ts) {
    const cat = ((B.extras || {})[e.contrato_id] || []).filter((x) => !ts.some((t) => t.atividade_id === x.id));
    const naFila = fila.filter((a) => a.tipo === 'extra' && a.endereco_id === e.endereco_id);
    if (!cat.length && !naFila.length) return '';
    return `<div class="sec">Atividade extra</div>
      <div class="card pad">
        ${naFila.map((a) => `<div class="act" style="margin-bottom:8px"><span class="n"><b>${esc(a.nome)}</b> <span class="xtag">Extra ×${String(a.quantidade).replace('.', ',')}</span></span><span class="pill aguardando"><i></i>na fila</span></div>`).join('')}
        ${cat.length ? `<p class="muted" style="font-size:.85rem;margin:0 0 8px">Precisou de algo que não estava previsto? Inclua aqui. Fica registrado com você como responsável.</p>
        <label class="lb" for="xa">Atividade</label><select class="in" id="xa">${cat.filter((x) => !naFila.some((a) => a.atividade_id === x.id)).map((x) => `<option value="${x.id}">${esc(x.nome)}${x.item ? ' · fatura ' + esc(x.item) : ''}</option>`).join('')}</select>
        <label class="lb" for="xq">Quantidade</label><input class="in" id="xq" inputmode="decimal" value="1" placeholder="Ex.: 1 poste, 12,5 metros">
        <label class="lb" for="xm">Motivo</label><textarea class="in" id="xm" placeholder="Ex.: fachada sem ponto de fixação"></textarea>
        <button class="btn primary block" style="margin-top:10px" id="xok">Incluir atividade extra</button>
        <p class="muted" style="font-size:.8rem;margin:8px 0 0">Sem internet, fica guardada e é enviada na próxima sincronização. Depois aparece na lista acima, com checklist se tiver.</p>` : ''}
      </div>`;
  }
  function ligarExtra(e, ts, redesenhar) {
    const ok = $('#xok'); if (!ok) return;
    ok.onclick = async () => {
      const sel = $('#xa'); if (!sel || !sel.value) { toast('Escolha a atividade'); return; }
      const q = Number($('#xq').value.replace(',', '.'));
      if (!(q > 0)) { toast('Quantidade inválida'); return; }
      const motivo = $('#xm').value.trim();
      const nome = sel.options[sel.selectedIndex].text.split(' · ')[0];
      await enfileirar({ tipo: 'extra', endereco_id: e.endereco_id, atividade_id: +sel.value, quantidade: q, motivo: motivo || null, nome });
      toast(navigator.onLine ? 'Atividade extra incluída' : 'Atividade extra guardada para enviar');
      redesenhar();
    };
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
  // quem pode apagar: foto ainda no aparelho; ou quem tirou, com a atividade aberta; ou quem pode excluir registros
  const podeApagar = (t, f) => f.local || (B.usuario.perfil === 'admin' || (B.usuario.acoes && B.usuario.acoes.excluir)) || (String(f.usuario_id) === String(B.usuario.id) && t.status !== 'concluida');
  const thumbs = (lista, t) => lista.map((f) => `<div class="thumbw"><img class="thumb" alt="Foto${f.legenda ? ': ' + esc(f.legenda) : ''}" data-cid="${esc(f.client_id || '')}" data-fid="${f.id || ''}" src="${esc(fotoSrc(f))}" loading="lazy">${f.local ? '<span class="q">na fila</span>' : ''}${t && podeApagar(t, f) ? `<button type="button" class="tdel" data-apaga="${esc(f.client_id || '')}|${f.id || ''}" aria-label="Excluir esta foto">${ICON.lixo}</button>` : ''}</div>`).join('');
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
          ${t.extra ? `<div class="note"><span class="xtag">Extra</span> Quantidade: <b>${String(t.quantidade).replace('.', ',')}</b>${t.motivo ? ` · ${esc(t.motivo)}` : ''}</div>` : ''}
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
            if (i.tipo_resposta === 'foto') return `<div class="it" data-it="${i.id}"><div class="tx">${esc(i.texto)}${obr}<div class="thumbs">${thumbs(fi, t)}${botaoCam(i.id)}</div></div></div>`;
            if (i.tipo_resposta === 'texto' || i.tipo_resposta === 'numero') return `<div class="it" data-it="${i.id}"><div class="tx">${esc(i.texto)}${obr}
              <input class="in" data-item="${i.id}" ${i.tipo_resposta === 'numero' ? 'inputmode="decimal"' : ''} value="${esc(r.valor || '')}" placeholder="${i.tipo_resposta === 'numero' ? 'Número' : 'Escreva aqui'}" aria-label="${esc(i.texto)}"></div></div>`;
            return `<div class="it" data-it="${i.id}"><button class="box" role="checkbox" aria-checked="${!!r.ok}" data-check="${i.id}" aria-label="${esc(i.texto)}"></button><div class="tx">${esc(i.texto)}${obr}</div></div>`;
          }).join('')}</div>` : ''}
        ${secPatrimonio(t)}
        <div class="sec">Fotos da atividade (${fotos.filter((f) => !f.item_id).length})</div>
        <div class="card pad"><div class="thumbs" style="margin-top:0">${thumbs(fotos.filter((f) => !f.item_id), t)}${botaoCam('')}</div>
          <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:.88rem;color:var(--muted)"><input type="checkbox" id="gps" ${meta.gps !== false ? 'checked' : ''}> Guardar a localização nas fotos</label>
          <label style="display:flex;gap:8px;align-items:center;margin-top:6px;font-size:.88rem;color:var(--muted)"><input type="checkbox" id="carimbo" ${meta.carimbo !== false ? 'checked' : ''}> Carimbar data, hora, endereço e mapa na foto</label></div>
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
    $$('[data-apaga]').forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); const [cid, fid] = b.dataset.apaga.split('|'); apagarFoto(t, cid, fid ? +fid : null, () => telaTarefa(id)); }));
    $('#gps').onchange = async (e) => { meta.gps = e.target.checked; await salvarMeta(); };
    $('#carimbo').onchange = async (e) => { meta.carimbo = e.target.checked; await salvarMeta(); };
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

  // Apaga a foto: se ainda está no aparelho, sai da fila; se já foi enviada, a exclusão vai para a fila (funciona sem internet)
  async function apagarFoto(t, cid, fid, redesenhar) {
    if (!confirm('Excluir esta foto? Ela sai da atividade e do relatório.')) return;
    const pend = fotosPend.find((x) => x.client_id === cid && cid);
    const lista = B.fotos[t.id] || [];
    const f = lista.find((x) => (fid && x.id === fid) || (cid && x.client_id === cid));
    if (pend && !(f && f.id)) {
      fotosPend = fotosPend.filter((x) => x.client_id !== cid);
      await idb.del('fotos', cid);
      if (urls.has(cid)) { URL.revokeObjectURL(urls.get(cid)); urls.delete(cid); }
      B.fotos[t.id] = lista.filter((x) => x.client_id !== cid);
      await salvarBundle();
      toast('Foto excluída');
    } else if (f && f.id) {
      await enfileirar({ tipo: 'excluir_foto', tarefa_id: t.id, foto_id: f.id });
      toast(navigator.onLine ? 'Foto excluída' : 'Exclusão guardada para enviar');
    }
    redesenhar();
  }

  function verFoto(im) {
    const v = document.createElement('div'); v.className = 'viewer';
    v.innerHTML = `<img alt="Foto ampliada" src="${esc(im.src)}"><div class="bar2"><span>${esc(im.alt)}</span><button class="btn sm">Fechar</button></div>`;
    v.querySelector('button').onclick = () => v.remove(); document.body.appendChild(v);
  }

  // Comprime a foto no aparelho (máx. 1600 px, JPEG 80%) antes de guardar
  async function lerImagem(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { bmp = null; }
    if (!bmp) bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    return bmp;
  }
  async function comprimir(bmp, carimbo) {
    const max = 1600; const w = bmp.width, h = bmp.height; const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (carimbo) carimbar(g, c.width, c.height, carimbo);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('falha ao gerar a imagem'))), 'image/jpeg', 0.82));
  }

  // ---------- Carimbo da foto: data e hora, endereço, coordenadas, altitude e mini mapa (como as câmeras de obra) ----------
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const p2 = (n) => String(n).padStart(2, '0');
  const dataLonga = (d) => `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const gms = (v, pos, neg) => { const a = Math.abs(v); const g = Math.floor(a); const m = Math.floor((a - g) * 60); const s2 = Math.round(((a - g) * 60 - m) * 60); return `${g}°${p2(m)}'${p2(s2 === 60 ? 59 : s2)}"${v >= 0 ? pos : neg}`; };
  async function enderecoDoPonto(pos) {
    if (!navigator.onLine) return null;
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 4500);
      const r = await fetch(`/api/mobile/local?lat=${pos.lat.toFixed(6)}&lon=${pos.lon.toFixed(6)}`, { credentials: 'same-origin', signal: ctl.signal });
      clearTimeout(tm);
      return r.ok ? (await r.json()).endereco : null;
    } catch (_) { return null; }
  }
  // Mini mapa: 2x2 imagens do mapa de ruas (nível 16) centradas no ponto; sem internet, não entra
  async function imagemDeBlob(bl) {
    try { return await createImageBitmap(bl); } catch (_) { /* SVG e outros: via <img> */ }
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagem')); i.src = URL.createObjectURL(bl); });
  }
  async function miniMapa(pos) {
    if (!navigator.onLine) return null;
    try {
      const z = 16, n = 2 ** z, rad = pos.lat * Math.PI / 180;
      const fx = ((pos.lon + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
      const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5);
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
      const imgs = await Promise.all([[0, 0], [1, 0], [0, 1], [1, 1]].map(async ([dx, dy]) => {
        const r = await fetch(`/tiles/${z}/${x0 + dx}/${y0 + dy}.png`, { credentials: 'same-origin', signal: ctl.signal });
        if (!r.ok) throw new Error('mapa');
        return { dx, dy, img: await imagemDeBlob(await r.blob()) };
      }));
      clearTimeout(tm);
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const g = c.getContext('2d');
      for (const t2 of imgs) g.drawImage(t2.img, t2.dx * 256, t2.dy * 256, 256, 256);
      return { canvas: c, px: (fx - x0) * 256, py: (fy - y0) * 256 };
    } catch (_) { return null; }
  }
  function carimbar(g, W, H, { quando, local, pos, mapa, unidade }) {
    const u = Math.min(W, H) / 100; // unidade relativa ao tamanho da foto
    const m = 2.2 * u, pad = 2.4 * u, raio = 1.6 * u;
    const fT = 3.9 * u, fL = 2.9 * u, fS = 2.6 * u;
    const ladoMapa = mapa ? Math.min(25 * u, H * 0.25) : 0;
    const larg = W - 2 * m - (mapa ? ladoMapa + 1.4 * u : 0);
    const quebra = (txt, font, maxW) => { g.font = font; const out = []; let l = ''; for (const w of String(txt).split(/\s+/)) { const t2 = l ? l + ' ' + w : w; if (g.measureText(t2).width <= maxW || !l) l = t2; else { out.push(l); l = w; } } if (l) out.push(l); return out; };
    const FT = `600 ${fT}px system-ui, -apple-system, Roboto, sans-serif`, FL = `400 ${fL}px system-ui, -apple-system, Roboto, sans-serif`, FS = `500 ${fS}px system-ui, -apple-system, Roboto, sans-serif`;
    const lt = quebra(dataLonga(quando), FT, larg - 2 * pad);
    const ll = local ? quebra(local, FL, larg - 2 * pad).slice(0, 3) : [];
    const coord = pos ? `◎ ${gms(pos.lat, 'N', 'S')} ${gms(pos.lon, 'E', 'W')}${pos.altitude != null ? `   ▲ ${String(Math.round(pos.altitude * 10) / 10).replace('.', ',')}m` : ''}${pos.precisao != null ? `   ± ${Math.round(pos.precisao)}m` : ''}` : 'Sem localização do GPS';
    const lu = unidade ? (() => { g.font = FS; let t2 = unidade; while (t2.length > 4 && g.measureText(t2).width > larg - 2 * pad) t2 = t2.slice(0, -2); return [t2 === unidade ? t2 : t2.replace(/[\s·-]+$/, '') + '…']; })() : [];
    const altura = pad * 2 + lt.length * fT * 1.22 + (ll.length ? 0.6 * u + ll.length * fL * 1.3 : 0) + 0.9 * u + fS * 1.3 + (lu.length ? fS * 1.35 : 0);
    const y0 = H - m - Math.max(altura, ladoMapa);
    const caixa = (x, y, w, h) => { g.beginPath(); g.moveTo(x + raio, y); g.arcTo(x + w, y, x + w, y + h, raio); g.arcTo(x + w, y + h, x, y + h, raio); g.arcTo(x, y + h, x, y, raio); g.arcTo(x, y, x + w, y, raio); g.closePath(); };
    const yb = H - m - altura;
    g.save();
    caixa(m, yb, larg, altura); g.fillStyle = 'rgba(40,40,40,0.72)'; g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'top';
    let y = yb + pad;
    g.font = FT; for (const l of lt) { g.fillText(l, m + pad, y); y += fT * 1.22; }
    if (ll.length) { y += 0.6 * u; g.font = FL; g.fillStyle = 'rgba(255,255,255,0.92)'; for (const l of ll) { g.fillText(l, m + pad, y); y += fL * 1.3; } }
    y += 0.9 * u; g.font = FS; g.fillStyle = '#fff'; g.fillText(coord, m + pad, y); y += fS * 1.3;
    if (lu.length) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(lu[0], m + pad, y + 0.2 * u); }
    if (mapa) {
      const xm = W - m - ladoMapa, ym = H - m - ladoMapa;
      caixa(xm, ym, ladoMapa, ladoMapa); g.save(); g.clip();
      const meia = 128; // recorte de 256 px em volta do ponto
      g.drawImage(mapa.canvas, mapa.px - meia, mapa.py - meia, meia * 2, meia * 2, xm, ym, ladoMapa, ladoMapa);
      g.restore();
      caixa(xm, ym, ladoMapa, ladoMapa); g.lineWidth = 0.35 * u; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
      // alfinete vermelho no centro
      const cx = xm + ladoMapa / 2, cy = ym + ladoMapa / 2, r = 2.6 * u;
      g.beginPath(); g.arc(cx, cy - r * 1.6, r, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(cx, cy); g.closePath(); g.fillStyle = '#E53935'; g.fill();
      g.beginPath(); g.arc(cx, cy - r * 1.6, r * 0.42, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.font = `500 ${1.8 * u}px system-ui, sans-serif`; g.fillStyle = 'rgba(0,0,0,0.6)'; g.textBaseline = 'bottom'; g.fillText('© OpenStreetMap', xm + 0.8 * u, ym + ladoMapa - 0.5 * u);
    }
    g.restore();
    return y0;
  }
  // Localização é opcional: nunca segura a foto por mais de 4 s (nem se o pedido de permissão ficar aberto)
  const posicao = () => new Promise((res) => {
    if (meta.gps === false || !navigator.geolocation) return res(null);
    const t = setTimeout(() => res(null), 4000);
    navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); res({ lat: p.coords.latitude, lon: p.coords.longitude, altitude: p.coords.altitude, precisao: p.coords.accuracy }); },
      () => { clearTimeout(t); res(null); }, { timeout: 4000, maximumAge: 60000, enableHighAccuracy: true });
  });

  async function novaFoto(t, itemId, file) {
    if (!file) return;
    toast('Guardando foto…');
    try {
      const quando = new Date(file.lastModified && Math.abs(Date.now() - file.lastModified) < 10 * 60000 ? file.lastModified : Date.now());
      const [bmp, pos] = await Promise.all([lerImagem(file), posicao()]);
      // carimbo: endereço do ponto (com internet) ou o endereço da atividade (sem internet), coordenadas, altitude e mapa
      const endAtv = [[t.logradouro, t.bairro].filter(Boolean).join(' - '), `${t.municipio} - ${t.uf}`, t.cep, 'Brasil'].filter(Boolean).join(', ');
      const local = meta.carimbo === false ? null : (pos ? await enderecoDoPonto(pos) : null) || endAtv;
      const mapa = meta.carimbo !== false && pos ? await miniMapa(pos) : null;
      const blob = await comprimir(bmp, meta.carimbo === false ? null : { quando, local, pos, mapa, unidade: `${t.endereco}${t.codigo ? ' · ' + t.codigo : ''}` });
      const m = { client_id: uuid(), tarefa_id: t.id, item_id: itemId, legenda: itemId ? (B.checklists[t.checklist_id].itens.find((i) => i.id === itemId) || {}).texto : null,
        lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, altitude: pos && pos.altitude != null ? Math.round(pos.altitude * 10) / 10 : null,
        precisao: pos && pos.precisao != null ? Math.round(pos.precisao * 10) / 10 : null, local_texto: local, ts: quando.getTime(), usuario_id: B.usuario.id };
      await idb.put('fotos', { ...m, blob });
      fotosPend.push(m);
      urls.set(m.client_id, URL.createObjectURL(blob));
      (B.fotos[t.id] = B.fotos[t.id] || []).push({ client_id: m.client_id, item_id: itemId, legenda: m.legenda, criado_em: new Date().toISOString(), local: true, usuario_id: B.usuario.id });
      await salvarBundle();
      toast(navigator.onLine ? 'Foto guardada, enviando…' : 'Foto guardada no aparelho');
      telaTarefa(t.id);
      agendarSync();
    } catch (e) {
      toast('Não foi possível guardar a foto: ' + (e.message || e));
    }
  }

  function nomeTarefa(id) { if (!id) return ''; const t = B && B.tarefas.find((x) => x.id === id); return t ? `${t.atividade} · ${t.endereco}` : `Atividade ${id}`; }
  const ROT = { excluir_foto: () => 'Excluir foto', extra: (a) => `Atividade extra: ${a.nome || ''} (${String(a.quantidade || 1).replace('.', ',')})`, status: (a) => `Status → ${ST[a.status]}`, resposta: (a) => `Checklist: ${a.ok ? 'item marcado' : 'item desmarcado'}`, comentario: () => 'Comentário', foto: () => 'Foto', ativo: (a) => `Patrimônio ${a.patrimonio || a.numero_serie}` };

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
        <a class="btn block" href="/app/">Abrir o sistema completo</a>
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
    // Versão nova publicada: o app se atualiza sozinho (procura ao abrir e ao voltar para a tela) e recarrega uma vez
    if ('serviceWorker' in navigator) {
      const tinha = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('/m/sw.js', { scope: '/m/', updateViaCache: 'none' }).then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      }).catch(() => {});
      let recarregou = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !recarregou) { recarregou = true; location.reload(); } });
    }
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
