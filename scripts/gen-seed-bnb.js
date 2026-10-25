// Gera db/seeds/bnb.sql a partir de src/data/mapdata.json (sem dependências).
// Uso: node scripts/gen-seed-bnb.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const D = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'mapdata.json'), 'utf8'));
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined || Number.isNaN(+v) ? 'NULL' : String(+v));

const ADITIVO_IDS = new Set([90]); // Centro Cultural Mossoró (5º aditivo)
const P = D.P;

const atividades = [
  { nome: 'Coordenação e contato', curto: 'Coordenação', etapa: 'Planejamento', funcao: 'Coordenador',
    modo: 'fixo', qtd: 1, un: 'dia', rota: false, ck: null, ev: 'Agenda confirmada com a agência' },
  { nome: 'Infraestrutura e cabos', curto: 'Infra', etapa: 'Campo', funcao: 'Técnico de campo',
    modo: 'por_camera', qtd: 0, un: 'hora', mpc: 45, rota: true, ck: null, ev: 'Fotos dos encaminhamentos' },
  { nome: 'Instalação de equipamentos', curto: 'Instalação', etapa: 'Campo', funcao: 'Técnico de campo',
    modo: 'faixa', qtd: 0, un: 'dia', rota: true, ck: 1, ev: 'Fotos de cada câmera instalada',
    faixas: [{ ate: P.FX1, dias: P.FX1D }, { ate: P.FX2, dias: P.FX2D }, { ate: null, dias: P.FX3D }] },
  { nome: 'Configuração do servidor e licença', curto: 'Servidor', etapa: 'Configuração', funcao: 'Analista de configuração',
    modo: 'fixo', qtd: 4, un: 'hora', rota: true, ck: 2, ev: 'Print da licença ativa' },
  { nome: 'Validação das imagens', curto: 'Validação', etapa: 'Validação', funcao: 'Técnico de campo',
    modo: 'fixo', qtd: 2, un: 'hora', rota: true, ck: null, ev: 'Prints de todas as câmeras' },
  { nome: 'Relatório de entrega e handover', curto: 'Handover', etapa: 'Entrega', funcao: 'Administrativo',
    modo: 'fixo', qtd: 1, un: 'dia', rota: false, ck: 3, ev: 'Termo de entrega assinado' },
];

const checklists = [
  { nome: 'Instalação de câmeras', itens: [
    ['Conferir quantidade de câmeras com o projeto', 'check'],
    ['Fixar suportes e câmeras nos pontos marcados', 'check'],
    ['Identificar cabos nas duas pontas', 'check'],
    ['Testar alimentação PoE de cada câmera', 'check'],
    ['Foto de cada câmera instalada', 'foto'],
    ['Limpar o local e recolher sobras', 'check'] ] },
  { nome: 'Configuração do servidor e ISS', itens: [
    ['Atualizar firmware do servidor', 'check'],
    ['Cadastrar câmeras no ISS', 'check'],
    ['Ativar licença (provisória ou definitiva)', 'check'],
    ['Configurar gravação e retenção', 'check'],
    ['Número de série do servidor', 'texto'] ] },
  { nome: 'Relatório de entrega e handover', itens: [
    ['Relatório fotográfico anexado', 'foto'],
    ['Lista de patrimônio preenchida', 'texto'],
    ['Termo de entrega assinado pelo gerente', 'foto'],
    ['Treinamento rápido do responsável local', 'check'] ] },
];

let sql = `-- Carga inicial BNB (gerado por scripts/gen-seed-bnb.js — não editar à mão)\nBEGIN;\n\n`;

sql += `INSERT INTO clientes (id, nome, razao_social, cnpj, segmento, contato_nome)\nVALUES (1, 'BNB', 'Banco do Nordeste do Brasil S.A.', '[CNPJ]', 'Bancário', '[Gestor do contrato]');\n\n`;

sql += `INSERT INTO contratos (id, cliente_id, numero, tipo, objeto, vigencia_inicio, regra_cobranca) VALUES\n` +
  ` (1, 1, '[Nº do contrato]', 'principal', 'Implantação de CFTV em agências', ${q(P.START)}, 'apos_validacao'),\n` +
  ` (2, 1, '5º aditivo', 'aditivo', 'Inclusão do Centro Cultural Mossoró', ${q(P.START)}, 'apos_validacao');\n\n`;

sql += `INSERT INTO checklists (id, nome) VALUES\n` + checklists.map((c, i) => ` (${i + 1}, ${q(c.nome)})`).join(',\n') + `;\n\n`;
const itens = [];
checklists.forEach((c, i) => c.itens.forEach(([t, tp], j) => itens.push(` (${i + 1}, ${j + 1}, ${q(t)}, ${q(tp)})`)));
sql += `INSERT INTO checklist_itens (checklist_id, ordem, texto, tipo_resposta) VALUES\n${itens.join(',\n')};\n\n`;

const ativRows = [];
for (const contrato of [1, 2]) {
  atividades.forEach((a, i) => {
    ativRows.push(` (${contrato}, ${q(a.nome)}, ${q(a.curto)}, ${q(a.etapa)}, ${q(a.funcao)}, ${q(a.modo)}, ${n(a.qtd)}, ${q(a.un)}, ${n(a.mpc)}, ${a.faixas ? q(JSON.stringify(a.faixas)) + '::jsonb' : 'NULL'}, ${a.rota}, ${n(a.ck)}, ${q(a.ev)}, ${i + 1})`);
  });
}
sql += `INSERT INTO atividades (contrato_id, nome, curto, etapa, funcao, tempo_modo, tempo_qtd, tempo_unidade, min_por_camera, faixas, conta_rota, checklist_id, evidencia, ordem) VALUES\n${ativRows.join(',\n')};\n\n`;

const endRows = D.units.map((u) => {
  const contrato = ADITIVO_IDS.has(u.id) ? 2 : 1;
  const codigo = 'BNB-' + String(u.id).padStart(3, '0');
  return ` (${contrato}, ${u.id}, ${q(codigo)}, ${q(u.n)}, ${q(u.m)}, ${q(u.uf)}, ${n(u.la)}, ${n(u.lo)}, ${q(u.ap)}, ${n(u.ka)}, ${n(u.c)})`;
});
sql += `INSERT INTO enderecos (contrato_id, ref_id, codigo, nome, municipio, uf, lat, lon, aeroporto, km_aeroporto, cameras) VALUES\n${endRows.join(',\n')};\n\n`;

sql += `-- Uma tarefa por endereço x atividade do mesmo contrato\nINSERT INTO tarefas (endereco_id, atividade_id)\nSELECT e.id, a.id FROM enderecos e JOIN atividades a ON a.contrato_id = e.contrato_id;\n\n`;

sql += `SELECT setval('clientes_id_seq', (SELECT max(id) FROM clientes));\nSELECT setval('contratos_id_seq', (SELECT max(id) FROM contratos));\nSELECT setval('checklists_id_seq', (SELECT max(id) FROM checklists));\n\nCOMMIT;\n`;

fs.writeFileSync(path.join(root, 'db', 'seeds', 'bnb.sql'), sql);
console.log(`bnb.sql gerado: ${D.units.length} endereços, ${D.units.reduce((s, u) => s + u.c, 0)} câmeras`);
