function makeEngine(D) {
  const P = D.P,
    KM = D.km,
    U = {};
  D.units.forEach((u) => (U[u.id] = u));
  const trav = (km) => {
    const h = km / P.VEL;
    return h <= P.HLIVRE ? 0 : Math.ceil(h / P.HDIA / 0.5) * 0.5;
  };
  const instd = (c) => (c <= P.FX1 ? P.FX1D : c <= P.FX2 ? P.FX2D : P.FX3D);
  const hDias = (u) => (D.cadDias && u.dp > 0 ? u.dp : D.tempoAtiv && u.d > 0 ? u.d : instd(u.c));
  /* datas (UTC) */
  const HOL = new Set(D.hol);
  const iso = (d) => d.toISOString().slice(0, 10);
  const parse = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const isWork = (d) => {
    const w = d.getUTCDay();
    return w !== 0 && w !== 6 && !HOL.has(iso(d));
  };
  function workday(s, n) {
    const d = new Date(s.getTime());
    if (n === 0) return d;
    const st = n > 0 ? 1 : -1;
    let c = Math.abs(n);
    while (c > 0) {
      d.setUTCDate(d.getUTCDate() + st);
      if (isWork(d)) c--;
    }
    return d;
  }
  const nextWork = (d) => {
    const x = new Date(d.getTime());
    while (!isWork(x)) x.setUTCDate(x.getUTCDate() + 1);
    return x;
  };
  const lastWorkOfMonth = (d) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    while (!isWork(x)) x.setUTCDate(x.getUTCDate() - 1);
    return x;
  };
  const mkey = (d) => iso(d).slice(0, 7);
  /* cronograma contínuo (igual à planilha) */
  function team(path) {
    let prev = 0,
      S = 0,
      U_ = 0,
      W = 0,
      AA = 0,
      AB = 0;
    const rows = [];
    path.forEach((x, s) => {
      const u = U[x],
        H = hDias(u),
        I = KM[prev][x],
        sd = !!((D.semDesl && D.semDesl.includes(u.uf)) || u.ml === 'aviao'),
        K = sd ? 0 : trav(I),
        M = sd ? 0 : u.ml === 'estrada' ? K : I > P.LIMAEREO ? P.DIAVOO + trav(u.ka) : K,
        N = D.tr[u.uf],
        O = KM[prev][0],
        Pk = KM[0][x];
      const Q = sd ? 0 : s > 0 && s % P.CAPKITS === 0 ? trav(O) + trav(Pk) + P.RECARGA : K;
      const retA = s > 0 && AB + M + H > P.CICLO;
      const R = Math.max((s ? S : 0) + M + (retA ? P.RETAEREO : 0), D.estEntrega && u.ml !== 'leva' ? N + P.FOLGA : 0);
      const S2 = R + H;
      AB = retA ? H : (s ? AB : 0) + M + H;
      const T = (s ? U_ : 0) + Q,
        U2 = T + H;
      const retC = s > 0 && AA + K + H > P.CICLO;
      const V = Math.max((s ? W : 0) + (retC && !sd ? trav(O) + trav(Pk) : K), D.estEntrega && u.ml !== 'leva' ? N + P.FOLGA : 0);
      const W2 = V + H;
      AA = retC ? H : (s ? AA : 0) + K + H;
      rows.push({ id: x, seq: s + 1, H, km: I, h: I / P.VEL, K, M, Q, N, A: [R, S2], B: [T, U2], C: [V, W2], retA, retC });
      S = S2;
      U_ = U2;
      W = W2;
      prev = x;
    });
    return rows;
  }
  function continuous(paths, mode, startIso) {
    const S0 = parse(startIso);
    return paths.map((p, ti) =>
      team(p).map((r) => {
        const [a, b] = r[mode];
        r.team = ti + 1;
        r.d0 = workday(S0, Math.ceil(a));
        r.d1 = workday(S0, Math.ceil(b));
        r.mon = mkey(r.d0);
        r.ret = (mode === 'A' && r.retA) || (mode === 'C' && r.retC) || (mode === 'B' && r.seq > 1 && (r.seq - 1) % P.CAPKITS === 0);
        if (mode !== 'B') {
          const dd = workday(r.d0, -(r.N + P.FOLGA));
          r.disp = dd < S0 ? S0 : dd;
          r.deliv = workday(r.disp, r.N);
        } else {
          r.disp = r.d0;
          r.deliv = r.d0;
        }
        return r;
      }),
    );
  }
  /* planejamento por meta mensal
     opts: {paths, mode, start, quota (0 = sem meta), over:{'aaaa-mm':n}, pins:{id:'aaaa-mm'}, skip:Set(ids já concluídas)} */
  function monthly(o) {
    const S0 = parse(o.start),
      mode = o.mode,
      k = o.paths.length;
    const pos = {};
    o.paths.forEach((p, t) => p.forEach((id, i) => (pos[id] = [t, i])));
    const pins = o.pins || {},
      over = o.over || {},
      skip = o.skip || new Set();
    const queues = o.paths.map((p) => p.filter((id) => !skip.has(id) && !pins[id]));
    const pinned = {};
    Object.keys(pins).forEach((id) => {
      id = +id;
      if (pos[id] === undefined || skip.has(id)) return;
      const key = pins[id];
      (pinned[key] = pinned[key] || []).push(id);
    });
    const rows = [],
      months = [];
    let mStart = nextWork(S0),
      guard = 0;
    const anyLeft = () => queues.some((q) => q.length) || Object.keys(pinned).some((k2) => pinned[k2].length);
    while (anyLeft() && guard++ < 60) {
      const key = mkey(mStart),
        mEnd = lastWorkOfMonth(mStart);
      // fixadas deste mês (e de meses que já passaram)
      const pinsNow = [];
      Object.keys(pinned).forEach((k2) => {
        if (k2 <= key) {
          pinsNow.push(...pinned[k2]);
          pinned[k2] = [];
        }
      });
      const quota = over[key] != null ? +over[key] : +o.quota || 0;
      const free = quota > 0 ? Math.max(0, quota - pinsNow.length) : Infinity;
      // divisão da meta entre equipes, proporcional ao que falta em cada uma
      const left = queues.map((q) => q.length),
        tot = left.reduce((a, b) => a + b, 0);
      let share;
      if (free === Infinity) share = left.slice();
      else {
        const raw = left.map((l) => (tot ? (free * l) / tot : 0));
        share = raw.map(Math.floor);
        let rest = Math.min(free, tot) - share.reduce((a, b) => a + b, 0);
        raw
          .map((v, i) => [v - Math.floor(v), i])
          .sort((a, b) => b[0] - a[0])
          .forEach(([, i]) => {
            if (rest > 0 && share[i] < left[i]) {
              share[i]++;
              rest--;
            }
          });
      }
      const lists = queues.map((q, t) => q.splice(0, share[t]));
      pinsNow.forEach((id) => lists[pos[id][0]].push(id));
      lists.forEach((l) => l.sort((a, b) => pos[a][1] - pos[b][1]));
      const mrow = { key, quota, planned: 0, teams: [], pins: pinsNow.length, start: mStart, end: mEnd };
      lists.forEach((list, t) => {
        let prev = 0,
          tt = 0,
          kits = 0;
        const sched = [],
          back = [];
        for (let i = 0; i < list.length; i++) {
          const id = list[i],
            u = U[id],
            H = hDias(u),
            km = KM[prev][id],
            N = D.tr[u.uf];
          let leg;
          if (mode === 'A') leg = km > P.LIMAEREO ? P.DIAVOO + trav(u.ka) : trav(km);
          else if (mode === 'B') {
            if (kits >= P.CAPKITS) {
              leg = trav(KM[prev][0]) + trav(KM[0][id]) + P.RECARGA;
              kits = 0;
            } else leg = trav(km);
            kits++;
          } else leg = trav(km);
          let s = tt + leg;
          if (mode !== 'B' && key === mkey(nextWork(S0))) {
            const abs = s;
            if (abs < N + P.FOLGA) s = N + P.FOLGA;
          }
          const e = s + H,
            d0 = workday(mStart, Math.ceil(s)),
            d1 = workday(mStart, Math.ceil(e));
          const pinnedHere = pins[id] && pins[id] <= key;
          if (d1 > mEnd && sched.length > 0 && !pinnedHere) {
            back.push(...list.slice(i).filter((x) => !(pins[x] && pins[x] <= key)));
            list
              .slice(i)
              .filter((x) => pins[x] && pins[x] <= key)
              .forEach((x) => back.push(x));
            break;
          }
          let disp, deliv;
          if (mode === 'B') {
            disp = d0;
            deliv = d0;
          } else {
            disp = workday(d0, -(N + P.FOLGA));
            if (disp < S0) disp = S0;
            deliv = workday(disp, N);
          }
          sched.push({
            id,
            team: t + 1,
            seq: sched.length + 1,
            H,
            km,
            h: km / P.VEL,
            K: leg,
            N,
            d0,
            d1,
            disp,
            deliv,
            mon: key,
            ret: sched.length === 0,
            over: d1 > mEnd,
            pinned: !!pins[id],
          });
          tt = e;
          prev = id;
        }
        // o que não coube volta para o início da fila da equipe
        const keep = back.filter((x) => !pins[x]);
        queues[t].unshift(...keep);
        back
          .filter((x) => pins[x])
          .forEach((x) => {
            const nk = mkey(workday(mEnd, 1));
            (pinned[nk] = pinned[nk] || []).push(x);
          });
        rows.push(...sched);
        mrow.teams.push({ team: t + 1, n: sched.length, days: tt, back: back.length });
        mrow.planned += sched.length;
      });
      months.push(mrow);
      mStart = nextWork(new Date(Date.UTC(mStart.getUTCFullYear(), mStart.getUTCMonth() + 1, 1)));
    }
    return { rows, months };
  }

  /* planejamento por meta mensal (v3)
     - cada equipe tem uma região fixa: rotas da estratégia, ou setores contíguos dos estados selecionados
     - a meta do mês é dividida entre as equipes; cada uma pega as próximas agências da sua região (mais próximas primeiro)
     - o que não cabe nos dias úteis do mês volta para a frente da fila da equipe e entra no mês seguinte
     o: {paths, mode, start, quota, over, pins, order:[ids], states:[UF], moves:{id:alvo}} */
  function monthly2(o) {
    if (o.ddesp) {
      o.dent = Object.assign({}, o.dent || {});
      for (const k in o.ddesp) {
        if (!o.dent[k] && U[k]) o.dent[k] = iso(workday(parse(o.ddesp[k]), D.tr[U[k].uf] || 0));
      }
    }
    const S0 = parse(o.start),
      mode = o.mode,
      paths = o.paths,
      k = paths.length;
    const pins = o.pins || {},
      over = o.over || {},
      ord = o.order || [],
      sts = o.states || [],
      mv = o.moves || {},
      mst = o.mstates || {};
    const bLa = (D.base && D.base.la) || -3.73,
      bLo = (D.base && D.base.lo) || -38.53,
      cs = Math.cos((12 * Math.PI) / 180);
    const oRank = {};
    ord.forEach((id, i) => (oRank[id] = i));
    const nnChain = (ids, from) => {
      const rest = new Set(ids),
        out = [];
      let cur = from || 0;
      while (rest.size) {
        let b = null,
          bd = 1e9;
        rest.forEach((id) => {
          if (KM[cur][id] < bd) {
            bd = KM[cur][id];
            b = id;
          }
        });
        out.push(b);
        rest.delete(b);
        cur = b;
      }
      return out;
    };
    // regiões
    // equipes montadas manualmente no mapa: {equipe(1..k): [agências]}
    const asg = {};
    Object.keys(o.assign || {}).forEach((t) => {
      const ti = +t - 1;
      if (ti >= 0 && ti < k && Array.isArray(o.assign[t])) asg[ti] = o.assign[t].map(Number).filter((id) => U[id]);
    });
    const manualIds = new Set(Object.values(asg).flat());
    const manualT = Object.keys(asg).map(Number);
    const autoT = [...Array(k).keys()].filter((t) => !manualT.includes(t));
    let regions;
    if (sts.length || manualT.length) {
      const pool = paths.flat().filter((id) => (!sts.length || sts.includes(U[id].uf)) && !manualIds.has(id));
      const ang = (id) => Math.atan2(U[id].la - bLa, (U[id].lo - bLo) * cs);
      const srt = pool.slice().sort((x, y) => ang(x) - ang(y));
      regions = new Array(k).fill(null).map(() => []);
      const ka = autoT.length;
      let p0 = 0;
      autoT.forEach((t, j) => {
        const n = Math.floor(srt.length / ka) + (j < srt.length % ka ? 1 : 0);
        regions[t] = nnChain(srt.slice(p0, p0 + n));
        p0 += n;
      });
      manualT.forEach((t) => {
        regions[t] = nnChain(asg[t]);
      });
    } else regions = paths.map((p) => p.slice());
    {
      const tfx = o.tfix || {};
      const ids = Object.keys(tfx)
        .map(Number)
        .filter((id) => U[id] && +tfx[id] >= 1 && +tfx[id] <= k && regions.some((r) => r.includes(id)));
      if (ids.length) {
        const S_ = new Set(ids);
        const add = {};
        ids.forEach((id) => {
          const t = +tfx[id] - 1;
          (add[t] = add[t] || []).push(id);
        });
        regions = regions.map((r, t) => {
          const keep = r.filter((id) => !S_.has(id));
          return add[t] ? nnChain(keep.concat(add[t])) : keep;
        });
      }
    }
    const teamOf = {};
    regions.forEach((r, t) => r.forEach((id) => (teamOf[id] = t)));
    // ordem definida no mapa: vai para a frente da fila da sua equipe
    regions = regions.map((r) => {
      const f = r.filter((id) => oRank[id] !== undefined).sort((x, y) => oRank[x] - oRank[y]);
      return f.concat(r.filter((id) => oRank[id] === undefined));
    });
    // agências movidas no mapa: saem da sua região e entram logo depois da agência-alvo
    const att = {};
    Object.keys(mv).forEach((x) => {
      x = +x;
      const y = +mv[x];
      if (teamOf[x] === undefined || teamOf[y] === undefined || x === y) return;
      (att[y] = att[y] || []).push(x);
    });
    const isMoved = new Set(Object.values(att).flat());
    regions = regions.map((r) => r.filter((id) => !isMoved.has(id)));
    const expand = (id) => [id, ...(att[id] || []).flatMap(expand)];
    regions = regions.map((r) => r.flatMap(expand));
    regions.forEach((r, t) => r.forEach((id) => (teamOf[id] = t)));
    // vinculadas pela edição da equipe: {id:{t:equipe(1..k), m:'aaaa-mm'}} — saem de onde estavam e entram na equipe/mês escolhidos
    const force = {};
    Object.keys(o.force || {}).forEach((id) => {
      const f = o.force[id];
      id = +id;
      if (!U[id] || !f || !f.m || !(+f.t >= 1 && +f.t <= k)) return;
      force[id] = { t: +f.t - 1, m: f.m };
    });
    const forcedIds = new Set(Object.keys(force).map(Number));
    if (forcedIds.size) {
      regions = regions.map((r) => r.filter((id) => !forcedIds.has(id)));
      forcedIds.forEach((id) => {
        teamOf[id] = force[id].t;
      });
    }
    // fixadas em um mês
    const pinned = {};
    Object.keys(pins).forEach((id) => {
      id = +id;
      if (teamOf[id] === undefined || isMoved.has(id) || forcedIds.has(id)) return;
      (pinned[pins[id]] = pinned[pins[id]] || []).push(id);
    });
    forcedIds.forEach((id) => {
      (pinned[force[id].m] = pinned[force[id].m] || []).push(id);
    });
    const pinSet = new Set(Object.values(pinned).flat());
    const queues = regions.map((r) => r.filter((id) => !pinSet.has(id)));
    const rows = [],
      months = [];
    let mStart = nextWork(S0),
      guard = 0;
    const free = new Array(k).fill(null);
    const left = () => queues.some((q) => q.length) || Object.keys(pinned).some((x) => pinned[x].length);
    while (left() && guard++ < 72) {
      const key = mkey(mStart),
        mEnd = lastWorkOfMonth(mStart);
      const quota = over[key] != null ? +over[key] : +o.quota || 0;
      const lists = new Array(k).fill(null).map(() => []);
      let cnt = 0;
      const fixedN = new Array(k).fill(0);
      Object.keys(pinned).forEach((x) => {
        if (x <= key) {
          pinned[x].forEach((id) => {
            lists[teamOf[id]].push(id);
            fixedN[teamOf[id]]++;
            cnt++;
          });
          pinned[x] = [];
        }
      });
      const allow = mst[key] && mst[key].length ? new Set(mst[key]) : null;
      const okId = (id) => !allow || allow.has(U[id].uf);
      const avail = (t) => queues[t].some(okId);
      const take = (t, src) => {
        const q = queues[src === undefined ? t : src];
        const i = q.findIndex(okId);
        if (i < 0) return 0;
        const id = q.splice(i, 1)[0];
        const grp = [id];
        while (q.length > i && isMoved.has(q[i]) && (att[id] || []).includes(q[i])) grp.push(q.splice(i, 1)[0]);
        lists[t].push(...grp);
        return grp.length;
      };
      if (quota > 0) {
        // meta exata: divisão igual entre as equipes (ex.: 20 / 4 = 5 cada); o resto gira entre as equipes mês a mês
        const mi = months.length,
          base = Math.floor(quota / k),
          rem = quota % k;
        const share = [...Array(k).keys()].map((t) => base + ((((t - mi) % k) + k) % k < rem ? 1 : 0));
        // vinculadas/fixadas contam dentro da cota da sua equipe; o total do mês fica sempre igual à meta
        let slots = Math.max(0, quota - cnt);
        const want = share.map((s2, t) => Math.max(0, s2 - fixedN[t]));
        let sumW = want.reduce((x, y) => x + y, 0);
        while (sumW > slots) {
          let j = want.indexOf(Math.max(...want));
          want[j]--;
          sumW--;
        }
        for (let t = 0; t < k; t++) {
          let n = want[t];
          while (n > 0 && avail(t)) {
            const g = take(t);
            n -= g;
            cnt += g;
          }
        }
        // se alguma equipe não tem mais agências na região, as outras completam a meta
        let g2 = 0;
        const ks = [...Array(k).keys()];
        while (cnt < quota && ks.some(avail) && g2++ < 500) {
          const order = ks.slice().sort((x, y) => lists[x].length - lists[y].length);
          for (const t of order) {
            if (cnt >= quota) break;
            if (avail(t)) cnt += take(t);
            else if (allow) {
              const src = ks.filter(avail).sort((x, y) => queues[y].filter(okId).length - queues[x].filter(okId).length)[0];
              if (src !== undefined) cnt += take(t, src);
            }
          }
        }
        // excedente (agência arrastada que acompanha o alvo): devolve a última automática da equipe mais cheia
        let g3 = 0;
        while (cnt > quota && g3++ < 50) {
          const t = [...Array(k).keys()]
            .sort((x, y) => lists[y].length - lists[x].length)
            .find((t) => lists[t].some((id) => !pinSet.has(id) && !forcedIds.has(id) && !isMoved.has(id) && !(att[id] && att[id].length)));
          if (t === undefined) break;
          const L = lists[t];
          for (let i = L.length - 1; i >= 0; i--) {
            const id = L[i];
            if (!pinSet.has(id) && !forcedIds.has(id) && !isMoved.has(id) && !(att[id] && att[id].length)) {
              L.splice(i, 1);
              queues[t].unshift(id);
              cnt--;
              break;
            }
          }
        }
      } else
        queues.forEach((q, t) => {
          while (avail(t)) cnt += take(t);
        });
      // ordem dentro do mês: ordem definida no mapa primeiro; depois vizinho mais próximo saindo de Fortaleza; movidas logo após o alvo
      for (let t = 0; t < k; t++) {
        const L = lists[t];
        if (L.length < 2) continue;
        const fixed = L.filter((id) => oRank[id] !== undefined).sort((x, y) => oRank[x] - oRank[y]);
        const rest = L.filter((id) => oRank[id] === undefined && !isMoved.has(id));
        const chain = nnChain(rest, fixed.length ? fixed[fixed.length - 1] : 0);
        let seq2 = fixed.concat(chain);
        L.filter((id) => isMoved.has(id) && oRank[id] === undefined).forEach((a) => {
          const tg = +mv[a];
          const i = seq2.indexOf(tg);
          if (i < 0) seq2.push(a);
          else seq2.splice(i + 1, 0, a);
        });
        lists[t] = seq2;
      }
      const mrow = { key, quota, planned: 0, teams: [], back: 0, start: mStart, end: mEnd, est: allow ? [...allow] : null, rest: 0 };
      lists.forEach((seq, t) => {
        const ms0 = o.mstart && o.mstart[key] ? nextWork(parse(o.mstart[key])) : mStart;
        const tStart = free[t] && free[t] > ms0 ? free[t] : ms0;
        let prev = 0,
          tt = 0,
          kits = 0,
          lastEnd = null,
          n = 0;
        const back = [];
        for (let i = 0; i < seq.length; i++) {
          const id = seq[i],
            u = U[id],
            H = hDias(u),
            km = KM[prev][id],
            N = D.tr[u.uf];
          let leg;
          if (mode === 'A') leg = km > P.LIMAEREO ? P.DIAVOO + trav(u.ka) : trav(km);
          else if (mode === 'B') {
            if (kits >= P.CAPKITS) {
              leg = trav(KM[prev][0]) + trav(KM[0][id]) + P.RECARGA;
              kits = 0;
            } else leg = trav(km);
            kits++;
          } else leg = trav(km);
          const etM = !!(o.mstart && o.mstart[key]);
          if (u.ml === 'estrada' && mode === 'A') leg = trav(km);
          if ((o.semDesl && o.semDesl.includes(u.uf)) || u.ml === 'aviao') leg = 0;
          const lv = u.ml === 'leva';
          let s = tt + leg;
          if (mode !== 'B' && !lv && !etM && o.estEntrega && !(o.dent && o.dent[id])) {
            const off = wdBetween(S0, tStart);
            if (off + s < N + P.FOLGA) s = N + P.FOLGA - off;
          }
          if (!lv && o.dent && o.dent[id]) {
            const dm = workday(parse(o.dent[id]), 1);
            if (dm > tStart) {
              const o2 = wdBetween(tStart, dm);
              if (s < o2) s = o2;
            }
          }
          let fx = o.dfix && o.dfix[id] ? nextWork(parse(o.dfix[id])) : null,
            fxp = false;
          if (fx && !lv && mode !== 'B' && o.dent && o.dent[id]) {
            const dm = workday(parse(o.dent[id]), 1);
            if (dm > fx) {
              fx = dm;
              fxp = true;
            }
          }
          if (fx) s = fx >= tStart ? wdBetween(tStart, fx) : -wdBetween(fx, tStart);
          const e = s + H,
            d0 = fx || workday(tStart, Math.ceil(s)),
            d1 = fx
              ? !fxp && o.dfim && o.dfim[id]
                ? nextWork(parse(o.dfim[id]))
                : workday(fx, Math.ceil(H))
              : workday(tStart, Math.ceil(e));
          const forced =
            !!fx ||
            (pins[id] && pins[id] === key) ||
            (force[id] && force[id].m <= key) ||
            isMoved.has(id) ||
            (att[id] && att[id].length > 0 && seq.slice(i + 1).some((x) => (att[id] || []).includes(x)));
          if (o.fit !== false && !(quota > 0) && d1 > mEnd && n > 0 && !forced) {
            back.push(id);
            continue;
          }
          let disp, deliv;
          if (mode === 'B' || lv) {
            disp = d0;
            deliv = d0;
          } else {
            disp = workday(d0, -(N + P.FOLGA));
            if (disp < S0 && !etM) disp = S0;
            deliv = workday(disp, N);
          }
          if (!lv && o.dent && o.dent[id] && mode !== 'B') {
            deliv = parse(o.dent[id]);
            disp = o.ddesp && o.ddesp[id] ? parse(o.ddesp[id]) : workday(deliv, -N);
          }
          n++;
          rows.push({
            id,
            team: t + 1,
            seq: n,
            semData: mode !== 'B' && !lv && !(o.dent && o.dent[id]) && !o.estEntrega,
            lv,
            ml: u.ml || null,
            fxp,
            H,
            km,
            h: km / P.VEL,
            K: leg,
            N,
            d0,
            d1,
            disp,
            deliv,
            mon: key,
            ret: n === 1,
            over: d1 > mEnd,
            pinned: !!pins[id],
            forced: !!force[id],
            ordered: oRank[id] !== undefined,
            moved: isMoved.has(id),
          });
          tt = Math.max(tt, e);
          prev = id;
          lastEnd = lastEnd && lastEnd > d1 ? lastEnd : d1;
        }
        if (back.length) queues[t].unshift(...back);
        free[t] = lastEnd ? workday(lastEnd, 1) : free[t];
        mrow.teams.push({ team: t + 1, n, over: lastEnd && lastEnd > mEnd });
        mrow.planned += n;
        mrow.back += back.length;
      });
      if (allow) mrow.rest = queues.flat().filter(okId).length;
      months.push(mrow);
      mStart = nextWork(new Date(Date.UTC(mStart.getUTCFullYear(), mStart.getUTCMonth() + 1, 1)));
    }
    return { rows, months, regions, manual: manualT.map((t) => t + 1) };
  }
  function wdBetween(a, b) {
    let n = 0;
    const d = new Date(a.getTime());
    while (d < b) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (isWork(d)) n++;
    }
    return n;
  }
  return { team, trav, instd, continuous, monthly, monthly2, parse, iso, workday, mkey };
}
if (typeof module !== 'undefined') module.exports = { makeEngine };
