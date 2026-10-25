// RoutProject · leitura amigável do histórico (auditoria): nomes das áreas e campos, antes → depois
const RPH = (() => {
  const AREAS = {
    clientes: 'Clientes', contratos: 'Contratos', contrato_arquivos: 'Arquivos do contrato', contrato_itens: 'Itens do contrato', empresas: 'Empresas',
    enderecos: 'Endereços', etapas: 'Etapas', equipe_regras: 'Regras das equipes', atividades: 'Atividades', checklists: 'Checklists', checklist_itens: 'Itens de checklist',
    pessoas: 'Técnicos e times', times: 'Times', time_membros: 'Membros de time', tarefas: 'Atividades dos endereços', regras_distribuicao: 'Regras de distribuição',
    usuarios: 'Usuários', perfis: 'Permissões', medicoes: 'Medições', medicao_enderecos: 'Endereços da medição', integracoes: 'Conexões',
    monitoramento_ativos: 'Ativos do monitoramento', relatorio_assinaturas: 'Assinaturas de relatório',
  };
  const CAMPOS = {
    nome: 'Nome', codigo: 'Código', logradouro: 'Logradouro', bairro: 'Bairro', cep: 'CEP', municipio: 'Município', uf: 'UF', lat: 'Latitude', lon: 'Longitude',
    cameras: 'Câmeras', status: 'Status', equipe: 'Equipe', inicio_previsto: 'Início previsto', fim_previsto: 'Fim previsto', dias_previstos: 'Dias previstos',
    concluido_em: 'Data de conclusão', entrega_material: 'Entrega do material', despacho_material: 'Despacho do material', modo_logistico: 'Logística',
    na_rota: 'Vai para a rota', etapa_id: 'Etapa', ordem_etapa: 'Ordem na etapa', geo_fonte: 'Origem da localização', licenca: 'Licença', patrimonio: 'Patrimônio',
    responsavel_id: 'Responsável', prevista_inicio: 'Início previsto', prevista_fim: 'Fim previsto', realizada_inicio: 'Início real', realizada_fim: 'Fim real', observacao: 'Observação',
    numero: 'Número', tipo: 'Tipo', valor_camera: 'Valor por câmera', valor_endereco: 'Valor por endereço', regra_cobranca: 'Regra de cobrança', empresa_id: 'Empresa',
    cnpj: 'CNPJ', razao_social: 'Razão social', contato_nome: 'Contato', contato_email: 'E-mail do contato', contato_fone: 'Telefone do contato', segmento: 'Segmento',
    email: 'E-mail', perfil: 'Perfil', telefone: 'Telefone', empresa: 'Empresa', ativo: 'Ativo', equipes: 'Equipes', meta_instalacoes: 'Meta de instalações',
    permissoes: 'Permissões', acoes: 'Ações especiais', descricao: 'Descrição', url: 'URL', opcoes: 'Opções', hostname: 'Hostname', ip: 'IP', interface: 'Interface',
    numero_nf: 'Nota fiscal', valor_total: 'Valor total', competencia: 'Competência', base_nome: 'Base de saída', objeto: 'Objeto', vigencia_inicio: 'Início da vigência', vigencia_fim: 'Fim da vigência',
  };
  const OCULTOS = new Set(['id', 'criado_em', 'atualizado_em', 'contrato_id', 'cliente_id', 'ref_id', 'status_antes', 'geo_tentado_em', 'monitorado_em']);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const area = (t) => AREAS[t] || t || '—';
  const campo = (k) => CAMPOS[k] || k.replace(/_/g, ' ');
  function valor(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (v === true) return 'Sim';
    if (v === false) return 'Não';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 160);
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString('pt-BR');
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }
  const chaves = (l) => Object.keys(l.depois || l.antes || {}).filter((k) => !OCULTOS.has(k));
  const MOD = { rota: 'Painel de rotas', projetos: 'Projetos', delegadas: 'Delegadas', minhas: 'Minhas atividades', app: 'App do técnico', faturamento: 'Faturamento', chat: 'Chat',
    clientes: 'Clientes', empresas: 'Empresas', atividades: 'Atividades', checklists: 'Checklists', equipe: 'Técnicos e times', conexoes: 'Conexões', usuarios: 'Usuários',
    permissoes: 'Permissões', auditoria: 'Auditoria', reabrir: 'Reabrir', excluir: 'Excluir', delegar: 'Delegar', distribuir: 'Distribuir', forcar_monitoramento: 'Forçar monitoramento' };
  const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  // linhas {rotulo, antes, depois}; objetos (permissões, opções) viram uma linha por item que mudou
  function itens(l) {
    const out = [];
    for (const k of chaves(l)) {
      const a = (l.antes || {})[k], d = (l.depois || {})[k];
      if (l.acao === 'update' && obj(a) && obj(d)) {
        for (const sk of new Set([...Object.keys(a), ...Object.keys(d)])) if (JSON.stringify(a[sk]) !== JSON.stringify(d[sk])) out.push({ rotulo: `${campo(k)} · ${MOD[sk] || sk}`, antes: a[sk], depois: d[sk] });
      } else out.push({ rotulo: campo(k), antes: a, depois: d });
    }
    return out;
  }
  function resumoTexto(l) {
    if (l.acao === 'update') return itens(l).map((x) => `${x.rotulo}: ${valor(x.antes)} → ${valor(x.depois)}`).join('; ');
    const r = l.depois || l.antes || {};
    return [r.nome, r.numero, r.codigo, r.hostname, r.municipio && r.uf ? `${r.municipio}/${r.uf}` : null].filter(Boolean).join(' · ');
  }
  function resumo(l) {
    if (l.acao === 'update') {
      const ks = itens(l);
      return ks.slice(0, 3).map((x) => `<span class="audch"><b>${esc(x.rotulo)}</b> <s>${esc(valor(x.antes))}</s> → ${esc(valor(x.depois))}</span>`).join('') + (ks.length > 3 ? `<span class="muted"> +${ks.length - 3}</span>` : '');
    }
    return esc(resumoTexto(l));
  }
  function tabela(l) {
    const ks = itens(l);
    if (!ks.length) return '';
    const comAntes = l.acao !== 'insert', comDepois = l.acao !== 'delete';
    return `<div class="scroll" style="border:1px solid var(--line);border-radius:10px"><table class="tbl"><thead><tr><th>Campo</th>${comAntes ? '<th>Antes</th>' : ''}${comDepois ? '<th>Depois</th>' : ''}</tr></thead><tbody>
      ${ks.map((x) => `<tr><td><b>${esc(x.rotulo)}</b></td>${comAntes ? `<td>${esc(valor(x.antes))}</td>` : ''}${comDepois ? `<td>${esc(valor(x.depois))}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  // Drawer com o histórico de um registro (endereço, contrato, cliente)
  async function abrir(titulo, url) {
    const ls = await RP.api(url);
    const ACAO = { insert: 'Criou', update: 'Alterou', delete: 'Excluiu' };
    const d = RP.drawer(titulo, ls.length ? `<ol class="audtl">${ls.map((l) => `<li><div class="audtl-h"><b>${esc(l.usuario_nome || 'Sistema')}</b> ${ACAO[l.acao] || l.acao} <span class="muted">· ${new Date(l.criado_em).toLocaleString('pt-BR')}${l.ip ? ' · ' + esc(l.ip) : ''}</span></div>
      <div class="audtl-b">${l.acao === 'update' ? resumo(l) : esc(resumoTexto(l)) || '—'}</div></li>`).join('')}</ol>`
      : '<div class="empty">Nenhuma alteração registrada ainda. O histórico começa a contar a partir desta versão do sistema.</div>', { saveLabel: 'Fechar', onSave: async () => {} });
    return d;
  }
  return { area, campo, valor, resumo, resumoTexto, tabela, abrir };
})();
