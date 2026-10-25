// RoutProject · utilitários do navegador
// Tema escolhido pela pessoa (automático segue o sistema): aplicado antes de desenhar a página
(function () { try { const t = localStorage.getItem('rp-tema'); if (t === 'claro') document.documentElement.dataset.theme = 'light'; else if (t === 'escuro') document.documentElement.dataset.theme = 'dark'; } catch (_) { /* sem armazenamento */ } })();
const RP = (() => {
  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, opts); } catch (_) { throw Object.assign(new Error('Sem conexão com o servidor'), { status: 0 }); }
    let data = null;
    try { data = await res.json(); } catch (_) { /* sem corpo */ }
    if (!res.ok) {
      const err = new Error((data && data.erro) || `Erro ${res.status}`);
      err.status = res.status; err.data = data;
      if (res.status === 401 && location.pathname.startsWith('/app/')) {
        location.href = '/?volta=' + encodeURIComponent(location.pathname + location.search);
      }
      throw err;
    }
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
  const fmtData = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—');
  const fmtDataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const iniciais = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

  let toastT;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function showAlert(el, tipo, msg) {
    if (!el) return;
    el.className = 'alert ' + tipo; el.textContent = msg; el.hidden = !msg;
  }

  async function busy(btn, fn) {
    const txt = btn.innerHTML; btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = txt; }
  }

  // Drawer genérico: retorna { el, close }
  function drawer(titulo, html, { onSave, saveLabel = 'Salvar' } = {}) {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML = `<header><h2>${esc(titulo)}</h2><button class="x" type="button" aria-label="Fechar">×</button></header>
      <div class="body"><div class="alert err" hidden></div>${html}</div>
      ${onSave ? `<footer><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="button" data-save>${esc(saveLabel)}</button></footer>` : ''}`;
    const close = () => { scrim.remove(); d.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    scrim.onclick = close; d.querySelector('.x').onclick = close;
    d.querySelector('[data-close]')?.addEventListener('click', close);
    const saveBtn = d.querySelector('[data-save]');
    // campos obrigatórios: asterisco no rótulo e conferência antes de salvar
    d.querySelectorAll('[required]').forEach((inp) => {
      const lb = inp.id && d.querySelector(`label[for="${inp.id}"]`);
      if (lb && !lb.querySelector('.req')) lb.insertAdjacentHTML('beforeend', '<span class="req" title="Obrigatório">*</span>');
      inp.addEventListener('input', () => inp.classList.remove('invalid'));
    });
    if (d.querySelector('[required]') && saveBtn) saveBtn.insertAdjacentHTML('beforebegin', '<span class="muted" style="margin-right:auto;font-size:.82rem"><span class="req">*</span> campo obrigatório</span>');
    if (saveBtn) saveBtn.onclick = () => {
      const vazios = [...d.querySelectorAll('[required]')].filter((i) => !String(i.value || '').trim());
      vazios.forEach((i) => i.classList.add('invalid'));
      if (vazios.length) { showAlert(d.querySelector('.alert'), 'err', 'Preencha os campos obrigatórios marcados com *'); vazios[0].focus(); return; }
      return saveBtn._salvar();
    };
    if (saveBtn) saveBtn._salvar = () => busy(saveBtn, async () => {
      try { await onSave(d); close(); } catch (e) { showAlert(d.querySelector('.alert'), 'err', e.message); }
    });
    document.addEventListener('keydown', onKey);
    document.body.append(scrim, d);
    setTimeout(() => d.querySelector('input,select,textarea,button')?.focus(), 30);
    return { el: d, close };
  }

  const LOGO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#0B3B36" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="6" r="2.2"/><path d="M7 17c5 0 3-10 10-10"/></svg>';
  const logo = (href = '/') => `<a class="logo" href="${href}"><span class="mark">${LOGO_SVG}</span><span>Rout<b>Project</b></span></a>`;

  function checklistHtml(c) {
    if (!c.checklist) return 'Esta atividade não tem checklist.';
    const feito = (i) => i.ok || (i.tipo_resposta === 'foto' && i.fotos > 0);
    const n = c.itens.filter(feito).length, falta = c.itens.filter((i) => i.obrigatorio && !feito(i)).length;
    return `<div style="color:var(--ink);font-weight:600;margin-bottom:6px">${RP.esc(c.checklist.nome)} · ${n}/${c.itens.length}${falta ? ` <span style="color:var(--err);font-weight:500">· ${falta} obrigatório(s) pendente(s)</span>` : ''}</div>
      ${c.itens.map((i) => `<div class="ckrow"><span class="ckb ${feito(i) ? 'on' : (i.obrigatorio ? 'req' : '')}" aria-hidden="true"></span>
        <div style="flex:1"><span style="color:var(--ink)">${RP.esc(i.texto)}</span>${i.obrigatorio ? '<span class="req" title="Obrigatório">*</span>' : ''}
        <div style="font-size:.8rem">${i.tipo_resposta === 'foto' ? (i.fotos ? i.fotos + ' foto(s)' : 'Sem foto') : i.tipo_resposta === 'check' ? (i.ok ? 'Feito' : 'Não marcado') : RP.esc(i.valor || '—')}${i.usuario ? ' · ' + RP.esc(i.usuario) + ' · ' + RP.fmtDataHora(i.criado_em) : ''}</div></div></div>`).join('')}
      <div style="font-size:.78rem;margin-top:6px"><span class="req">*</span> obrigatório</div>`;
  }

  return { checklistHtml, api, esc, $, $$, fmtN, fmtData, fmtDataHora, iniciais, toast, showAlert, busy, drawer, logo, LOGO_SVG };
})();
