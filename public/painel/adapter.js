// RoutProject · adaptador do Painel de rotas
// O painel original grava em window.claude.use('db') (coleções status/licenca/patrimonio e config/plano2).
// Aqui o mesmo contrato é atendido pela API do RoutProject (PostgreSQL), com atualização a cada 15 s.
(function () {
  const POLL_MS = 15000;
  const BASE = '/api/rota/' + encodeURIComponent(window.RP_CLIENTE) + '/';
  const COLS = ['status', 'licenca', 'patrimonio'];
  const subs = { status: [], licenca: [], patrimonio: [], cfg: [] };
  const last = {};

  function avisar(msg) {
    try {
      if (typeof toast === 'function') toast(msg);
    } catch (_) {
      /* painel ainda carregando */
    }
  }

  async function j(url, opts) {
    const o = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (o.body !== undefined) {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const res = await fetch(url, o);
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* sem corpo */
    }
    if (res.status === 401) {
      (window.top || window).location.href = '/?volta=' + encodeURIComponent('/app/rota.html');
      throw new Error('Sessão expirada');
    }
    if (!res.ok) throw new Error((data && data.erro) || 'Erro ' + res.status);
    return data;
  }

  async function pull(col) {
    const rows = await j(BASE + col);
    const txt = JSON.stringify(rows);
    if (last[col] === txt) return;
    last[col] = txt;
    const snap = { docs: rows.map((r) => ({ id: String(r.id), data: () => r.data })) };
    subs[col].forEach((s) => {
      try {
        s.cb(snap);
      } catch (e) {
        console.error(e);
      }
    });
  }

  async function pullCfg() {
    const r = await j(BASE + 'config/plano2');
    const txt = JSON.stringify(r.data);
    if (last.cfg === txt) return;
    last.cfg = txt;
    const snap = { exists: !!r.exists, data: () => r.data };
    subs.cfg.forEach((s) => {
      try {
        s.cb(snap);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function pullAll() {
    COLS.forEach((c) => {
      if (subs[c].length) pull(c).catch(() => {});
    });
    if (subs.cfg.length) pullCfg().catch(() => {});
  }
  setInterval(() => {
    if (document.visibilityState === 'visible') pullAll();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullAll();
  });

  const RoutDB = {
    collection(name) {
      if (!COLS.includes(name)) throw new Error('Coleção desconhecida: ' + name);
      return {
        onSnapshot(cb, err) {
          subs[name].push({ cb, err });
          pull(name).catch((e) => {
            if (err) err(e);
          });
          return () => {
            subs[name] = subs[name].filter((s) => s.cb !== cb);
          };
        },
        doc(id) {
          return {
            async set(value) {
              try {
                await j(BASE + name + '/' + encodeURIComponent(id), { method: 'PUT', body: value });
              } catch (e) {
                avisar('Não foi possível salvar: ' + e.message);
                last[name] = null;
                pull(name).catch(() => {});
                throw e;
              }
              last[name] = null; // força o próximo pull a notificar
            },
          };
        },
      };
    },
    doc(path) {
      if (path !== 'config/plano2') throw new Error('Documento desconhecido: ' + path);
      return {
        onSnapshot(cb, err) {
          subs.cfg.push({ cb, err });
          pullCfg().catch((e) => {
            if (err) err(e);
          });
          return () => {
            subs.cfg = subs.cfg.filter((s) => s.cb !== cb);
          };
        },
        async set(value) {
          try {
            await j(BASE + 'config/plano2', { method: 'PUT', body: value });
            last.cfg = JSON.stringify(value);
          } catch (e) {
            avisar('Não foi possível salvar o plano: ' + e.message);
            throw e;
          }
        },
      };
    },
  };

  // Downloads: sem capacidade especial — o painel cai no download direto pelo navegador
  window.claude = { use: async (n) => (n === 'db' ? RoutDB : null) };
})();
