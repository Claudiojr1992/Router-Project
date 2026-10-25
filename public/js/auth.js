// Telas de acesso: painel da marca, mostrar senha, campos de código e força de senha
(() => {
  const brand = document.getElementById('brand');
  if (brand) {
    brand.innerHTML = `
      <svg class="routes" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g fill="none" stroke="#3FC1AE" stroke-width="1.4" stroke-dasharray="4 7">
          <path d="M40 700 C 160 560, 120 420, 260 380 S 460 260, 560 120"/>
          <path d="M80 160 C 200 220, 260 320, 360 330 S 520 470, 580 620"/>
          <path d="M20 420 C 140 400, 240 520, 330 560 S 470 700, 600 720"/>
        </g>
        <g fill="#E9B23A"><circle cx="260" cy="380" r="5"/><circle cx="360" cy="330" r="5"/><circle cx="330" cy="560" r="5"/><circle cx="560" cy="120" r="5"/><circle cx="40" cy="700" r="5"/><circle cx="80" cy="160" r="5"/></g>
      </svg>
      ${RP.logo('/')}
      <div class="pitch">
        <h2>Rotas, equipes e entregas no mesmo lugar.</h2>
        <p>Planeje a implantação de cada endereço, distribua as atividades e acompanhe o que já foi feito em campo.</p>
        <ul>
          <li><i></i>Painel de rotas com meta mensal</li>
          <li><i></i>Projetos por contrato, endereço e atividade</li>
          <li><i></i>Delegação para técnicos, coordenação e administrativo</li>
        </ul>
      </div>
      <div class="foot">© ${new Date().getFullYear()} RoutProject</div>`;
  }
  const ml = document.querySelector('.mobile-logo');
  if (ml) ml.outerHTML = RP.logo('/').replace('class="logo"', 'class="logo mobile-logo"');

  // Mostrar/ocultar senha
  document.querySelectorAll('.pw').forEach((w) => {
    const input = w.querySelector('input');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Mostrar'; b.setAttribute('aria-label', 'Mostrar senha');
    b.onclick = () => { const s = input.type === 'password'; input.type = s ? 'text' : 'password'; b.textContent = s ? 'Ocultar' : 'Mostrar'; };
    w.appendChild(b);
  });

  // Força da senha
  document.querySelectorAll('[data-strength]').forEach((input) => {
    const bar = document.getElementById(input.dataset.strength);
    const label = document.getElementById(input.dataset.strength + '-t');
    input.addEventListener('input', () => {
      const s = input.value; let p = 0;
      if (s.length >= 8) p++; if (/[A-Za-z]/.test(s) && /\d/.test(s)) p++; if (s.length >= 12) p++; if (/[^A-Za-z0-9]/.test(s)) p++;
      const cores = ['var(--err)', 'var(--err)', 'var(--warn)', 'var(--ok)', 'var(--ok)'];
      const txt = ['Use 8+ caracteres com letras e números', 'Fraca', 'Razoável', 'Boa', 'Forte'];
      bar.style.width = (p * 25) + '%'; bar.style.background = cores[p];
      if (label) label.textContent = s ? txt[p] : txt[0];
    });
  });

  // Campos de código de 6 dígitos
  const box = document.querySelector('.code-inputs');
  if (box) {
    const ins = Array.from(box.querySelectorAll('input'));
    ins.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/g, '').slice(-1);
        if (inp.value && ins[i + 1]) ins[i + 1].focus();
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && ins[i - 1]) ins[i - 1].focus(); });
      inp.addEventListener('paste', (e) => {
        const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!t) return; e.preventDefault();
        t.split('').forEach((d, j) => { if (ins[j]) ins[j].value = d; });
        (ins[t.length] || ins[5]).focus();
      });
    });
    window.lerCodigo = () => ins.map((i) => i.value).join('');
  }
})();
