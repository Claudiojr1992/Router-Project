-- Carga inicial BNB (gerado por scripts/gen-seed-bnb.js — não editar à mão)
BEGIN;

INSERT INTO clientes (id, nome, razao_social, cnpj, segmento, contato_nome)
VALUES (1, 'BNB', 'Banco do Nordeste do Brasil S.A.', '[CNPJ]', 'Bancário', '[Gestor do contrato]');

INSERT INTO contratos (id, cliente_id, numero, tipo, objeto, vigencia_inicio, regra_cobranca) VALUES
 (1, 1, '[Nº do contrato]', 'principal', 'Implantação de CFTV em agências', '2026-11-03', 'apos_validacao'),
 (2, 1, '5º aditivo', 'aditivo', 'Inclusão do Centro Cultural Mossoró', '2026-11-03', 'apos_validacao');

INSERT INTO checklists (id, nome) VALUES
 (1, 'Instalação de câmeras'),
 (2, 'Configuração do servidor e ISS'),
 (3, 'Relatório de entrega e handover');

INSERT INTO checklist_itens (checklist_id, ordem, texto, tipo_resposta) VALUES
 (1, 1, 'Conferir quantidade de câmeras com o projeto', 'check'),
 (1, 2, 'Fixar suportes e câmeras nos pontos marcados', 'check'),
 (1, 3, 'Identificar cabos nas duas pontas', 'check'),
 (1, 4, 'Testar alimentação PoE de cada câmera', 'check'),
 (1, 5, 'Foto de cada câmera instalada', 'foto'),
 (1, 6, 'Limpar o local e recolher sobras', 'check'),
 (2, 1, 'Atualizar firmware do servidor', 'check'),
 (2, 2, 'Cadastrar câmeras no ISS', 'check'),
 (2, 3, 'Ativar licença (provisória ou definitiva)', 'check'),
 (2, 4, 'Configurar gravação e retenção', 'check'),
 (2, 5, 'Número de série do servidor', 'texto'),
 (3, 1, 'Relatório fotográfico anexado', 'foto'),
 (3, 2, 'Lista de patrimônio preenchida', 'texto'),
 (3, 3, 'Termo de entrega assinado pelo gerente', 'foto'),
 (3, 4, 'Treinamento rápido do responsável local', 'check');

INSERT INTO atividades (contrato_id, nome, curto, etapa, funcao, tempo_modo, tempo_qtd, tempo_unidade, min_por_camera, faixas, conta_rota, checklist_id, evidencia, ordem) VALUES
 (1, 'Coordenação e contato', 'Coordenação', 'Planejamento', 'Coordenador', 'fixo', 1, 'dia', NULL, NULL, false, NULL, 'Agenda confirmada com a agência', 1),
 (1, 'Infraestrutura e cabos', 'Infra', 'Campo', 'Técnico de campo', 'por_camera', 0, 'hora', 45, NULL, true, NULL, 'Fotos dos encaminhamentos', 2),
 (1, 'Instalação de equipamentos', 'Instalação', 'Campo', 'Técnico de campo', 'faixa', 0, 'dia', NULL, '[{"ate":22,"dias":2},{"ate":32,"dias":3},{"ate":null,"dias":4}]'::jsonb, true, 1, 'Fotos de cada câmera instalada', 3),
 (1, 'Configuração do servidor e licença', 'Servidor', 'Configuração', 'Analista de configuração', 'fixo', 4, 'hora', NULL, NULL, true, 2, 'Print da licença ativa', 4),
 (1, 'Validação das imagens', 'Validação', 'Validação', 'Técnico de campo', 'fixo', 2, 'hora', NULL, NULL, true, NULL, 'Prints de todas as câmeras', 5),
 (1, 'Relatório de entrega e handover', 'Handover', 'Entrega', 'Administrativo', 'fixo', 1, 'dia', NULL, NULL, false, 3, 'Termo de entrega assinado', 6),
 (2, 'Coordenação e contato', 'Coordenação', 'Planejamento', 'Coordenador', 'fixo', 1, 'dia', NULL, NULL, false, NULL, 'Agenda confirmada com a agência', 1),
 (2, 'Infraestrutura e cabos', 'Infra', 'Campo', 'Técnico de campo', 'por_camera', 0, 'hora', 45, NULL, true, NULL, 'Fotos dos encaminhamentos', 2),
 (2, 'Instalação de equipamentos', 'Instalação', 'Campo', 'Técnico de campo', 'faixa', 0, 'dia', NULL, '[{"ate":22,"dias":2},{"ate":32,"dias":3},{"ate":null,"dias":4}]'::jsonb, true, 1, 'Fotos de cada câmera instalada', 3),
 (2, 'Configuração do servidor e licença', 'Servidor', 'Configuração', 'Analista de configuração', 'fixo', 4, 'hora', NULL, NULL, true, 2, 'Print da licença ativa', 4),
 (2, 'Validação das imagens', 'Validação', 'Validação', 'Técnico de campo', 'fixo', 2, 'hora', NULL, NULL, true, NULL, 'Prints de todas as câmeras', 5),
 (2, 'Relatório de entrega e handover', 'Handover', 'Entrega', 'Administrativo', 'fixo', 1, 'dia', NULL, NULL, false, 3, 'Termo de entrega assinado', 6);

INSERT INTO enderecos (contrato_id, ref_id, codigo, nome, municipio, uf, lat, lon, aeroporto, km_aeroporto, cameras) VALUES
 (1, 1, 'BNB-001', 'Nanuque', 'Nanuque', 'MG', -17.84, -40.35, 'Porto Seguro/BA', 268, 19),
 (1, 2, 'BNB-002', 'Açailândia', 'Açailândia', 'MA', -4.95, -47.5, 'Imperatriz/MA', 84, 27),
 (1, 3, 'BNB-003', 'Alagoinhas', 'Alagoinhas', 'BA', -12.14, -38.42, 'Salvador/BA', 112, 22),
 (1, 4, 'BNB-004', 'Araripina', 'Araripina', 'PE', -7.58, -40.5, 'Juazeiro do Norte/CE', 184, 25),
 (1, 5, 'BNB-005', 'Arcoverde', 'Arcoverde', 'PE', -8.42, -37.05, 'Campina Grande/PB', 234, 19),
 (1, 6, 'BNB-006', 'Balsas', 'Balsas', 'MA', -7.53, -46.04, 'Imperatriz/MA', 354, 24),
 (1, 7, 'BNB-007', 'Barra do Corda', 'Barra do Corda', 'MA', -5.5, -45.25, 'Imperatriz/MA', 318, 22),
 (1, 8, 'BNB-008', 'Barreiras', 'Barreiras', 'BA', -12.15, -45, 'Barreiras/BA', 10, 25),
 (1, 9, 'BNB-009', 'Barreirinhas', 'Barreirinhas', 'MA', -2.75, -42.83, 'Parnaíba/PI', 160, 22),
 (1, 10, 'BNB-010', 'Bom Jesus da Lapa', 'Bom Jesus da Lapa', 'BA', -13.25, -43.42, 'Barreiras/BA', 281, 19),
 (1, 11, 'BNB-011', 'Brumado', 'Brumado', 'BA', -14.2, -41.67, 'Vitória da Conquista/BA', 148, 20),
 (1, 12, 'BNB-012', 'Cabedelo', 'Cabedelo', 'PB', -6.98, -34.83, 'João Pessoa/PB', 30, 19),
 (1, 13, 'BNB-013', 'Cajazeiras', 'Cajazeiras', 'PB', -6.89, -38.56, 'Juazeiro do Norte/CE', 112, 30),
 (1, 14, 'BNB-014', 'Campo Formoso', 'Campo Formoso', 'BA', -10.51, -40.32, 'Petrolina/PE', 170, 20),
 (1, 15, 'BNB-015', 'Casa Nova', 'Casa Nova', 'BA', -9.16, -40.97, 'Petrolina/PE', 64, 19),
 (1, 16, 'BNB-016', 'Caxias', 'Caxias', 'MA', -4.86, -43.36, 'Teresina/PI', 83, 27),
 (1, 17, 'BNB-017', 'Ceará-Mirim', 'Ceará-Mirim', 'RN', -5.63, -35.42, 'Natal/RN', 21, 17),
 (1, 18, 'BNB-018', 'Chapadinha', 'Chapadinha', 'MA', -3.74, -43.36, 'Teresina/PI', 206, 30),
 (1, 19, 'BNB-019', 'Codó', 'Codó', 'MA', -4.46, -43.89, 'Teresina/PI', 177, 28),
 (1, 20, 'BNB-020', 'Colatina', 'Colatina', 'ES', -19.54, -40.63, 'Vitória/ES', 114, 23),
 (1, 21, 'BNB-021', 'Conceição do Coité', 'Conceição do Coité', 'BA', -11.56, -39.28, 'Salvador/BA', 237, 23),
 (1, 22, 'BNB-022', 'Coruripe', 'Coruripe', 'AL', -10.13, -36.18, 'Maceió/AL', 105, 22),
 (1, 23, 'BNB-023', 'Cruz das Almas', 'Cruz das Almas', 'BA', -12.67, -39.1, 'Salvador/BA', 114, 18),
 (1, 24, 'BNB-024', 'Euclides da Cunha', 'Euclides da Cunha', 'BA', -10.51, -39.01, 'Petrolina/PE', 277, 20),
 (1, 25, 'BNB-025', 'Eunápolis', 'Eunápolis', 'BA', -16.38, -39.58, 'Porto Seguro/BA', 70, 28),
 (1, 26, 'BNB-026', 'Floriano', 'Floriano', 'PI', -6.77, -43.02, 'Teresina/PI', 249, 28),
 (1, 27, 'BNB-027', 'Garanhuns', 'Garanhuns', 'PE', -8.89, -36.49, 'Maceió/AL', 134, 28),
 (1, 28, 'BNB-028', 'Governador Valadares', 'Governador Valadares', 'MG', -18.85, -41.95, 'Belo Horizonte/MG', 297, 21),
 (1, 29, 'BNB-029', 'Grajaú', 'Grajaú', 'MA', -5.82, -46.14, 'Imperatriz/MA', 194, 20),
 (1, 30, 'BNB-030', 'Guanambi', 'Guanambi', 'BA', -14.22, -42.78, 'Vitória da Conquista/BA', 284, 26),
 (1, 31, 'BNB-031', 'Ilhéus', 'Ilhéus', 'BA', -14.79, -39.05, 'Ilhéus/BA', 5, 23),
 (1, 32, 'BNB-032', 'Ipirá', 'Ipirá', 'BA', -12.16, -39.74, 'Salvador/BA', 227, 18),
 (1, 33, 'BNB-033', 'Irecê', 'Irecê', 'BA', -11.3, -41.86, 'Petrolina/PE', 335, 32),
 (1, 34, 'BNB-034', 'Itaberaba', 'Itaberaba', 'BA', -12.53, -40.31, 'Salvador/BA', 285, 24),
 (1, 35, 'BNB-035', 'Itamaraju', 'Itamaraju', 'BA', -17.04, -39.53, 'Porto Seguro/BA', 107, 25),
 (1, 36, 'BNB-036', 'Itapecuru-Mirim', 'Itapecuru Mirim', 'MA', -3.39, -44.36, 'São Luís/MA', 117, 20),
 (1, 37, 'BNB-037', 'Itapetinga', 'Itapetinga', 'BA', -15.25, -40.25, 'Vitória da Conquista/BA', 102, 27),
 (1, 38, 'BNB-038', 'Jacobina', 'Jacobina', 'BA', -11.18, -40.52, 'Petrolina/PE', 263, 24),
 (1, 39, 'BNB-039', 'Janaúba', 'Janaúba', 'MG', -15.8, -43.31, 'Montes Claros/MG', 149, 26),
 (1, 40, 'BNB-040', 'Januária', 'Januária', 'MG', -15.49, -44.36, 'Montes Claros/MG', 192, 28),
 (1, 41, 'BNB-041', 'Linhares', 'Linhares', 'ES', -19.39, -40.07, 'Vitória/ES', 129, 24),
 (1, 42, 'BNB-042', 'Luís Eduardo Magalhães', 'Luís Eduardo Magalhães', 'BA', -12.09, -45.8, 'Barreiras/BA', 112, 25),
 (1, 43, 'BNB-043', 'Ouricuri', 'Ouricuri', 'PE', -7.88, -40.08, 'Juazeiro do Norte/CE', 150, 32),
 (1, 44, 'BNB-044', 'Palmares', 'Palmares', 'PE', -8.68, -35.59, 'Maceió/AL', 123, 22),
 (1, 45, 'BNB-045', 'Palmeira dos Índios', 'Palmeira dos Índios', 'AL', -9.41, -36.63, 'Maceió/AL', 121, 23),
 (1, 46, 'BNB-046', 'Parnaíba', 'Parnaíba', 'PI', -2.91, -41.78, 'Parnaíba/PI', 8, 26),
 (1, 47, 'BNB-047', 'Patos', 'Patos', 'PB', -7.02, -37.28, 'Campina Grande/PB', 201, 33),
 (1, 48, 'BNB-048', 'Paulo Afonso', 'Paulo Afonso', 'BA', -9.41, -38.21, 'Aracaju/SE', 279, 26),
 (1, 49, 'BNB-049', 'Penedo', 'Penedo', 'AL', -10.29, -36.59, 'Aracaju/SE', 121, 29),
 (1, 50, 'BNB-050', 'Pesqueira', 'Pesqueira', 'PE', -8.36, -36.7, 'Campina Grande/PB', 195, 30),
 (1, 51, 'BNB-051', 'Pinheiro', 'Pinheiro', 'MA', -2.52, -45.08, 'São Luís/MA', 122, 25),
 (1, 52, 'BNB-052', 'Pirapora', 'Pirapora', 'MG', -17.35, -44.94, 'Montes Claros/MG', 180, 35),
 (1, 53, 'BNB-053', 'Porto Seguro', 'Porto Seguro', 'BA', -16.45, -39.06, 'Porto Seguro/BA', 3, 25),
 (1, 54, 'BNB-054', 'Rio Largo', 'Rio Largo', 'AL', -9.48, -35.85, 'Maceió/AL', 10, 20),
 (1, 55, 'BNB-055', 'Salgueiro', 'Salgueiro', 'PE', -8.07, -39.12, 'Juazeiro do Norte/CE', 125, 34),
 (1, 56, 'BNB-056', 'Santo Antônio de Jesus', 'Santo Antônio de Jesus', 'BA', -12.97, -39.26, 'Salvador/BA', 131, 28),
 (1, 57, 'BNB-057', 'São Francisco', 'São Francisco', 'MG', -15.95, -44.86, 'Montes Claros/MG', 181, 22),
 (1, 58, 'BNB-058', 'São Gonçalo do Amarante', 'São Gonçalo do Amarante', 'RN', -5.79, -35.33, 'Natal/RN', 6, 22),
 (1, 59, 'BNB-059', 'São José de Ribamar', 'São José de Ribamar', 'MA', -2.56, -44.05, 'São Luís/MA', 28, 19),
 (1, 60, 'BNB-060', 'São Mateus', 'São Mateus', 'ES', -18.72, -39.86, 'Vitória/ES', 230, 22),
 (1, 61, 'BNB-061', 'São Miguel dos Campos', 'São Miguel dos Campos', 'AL', -9.78, -36.09, 'Maceió/AL', 58, 20),
 (1, 62, 'BNB-062', 'Senhor do Bonfim', 'Senhor do Bonfim', 'BA', -10.46, -40.19, 'Petrolina/PE', 168, 24),
 (1, 63, 'BNB-063', 'Serra Talhada', 'Serra Talhada', 'PE', -7.99, -38.3, 'Juazeiro do Norte/CE', 178, 24),
 (1, 64, 'BNB-064', 'Serrinha', 'Serrinha', 'BA', -11.66, -39.01, 'Salvador/BA', 205, 21),
 (1, 65, 'BNB-065', 'Sousa', 'Sousa', 'PB', -6.76, -38.23, 'Juazeiro do Norte/CE', 163, 24),
 (1, 66, 'BNB-066', 'Teixeira de Freitas', 'Teixeira de Freitas', 'BA', -17.54, -39.74, 'Porto Seguro/BA', 183, 26),
 (1, 67, 'BNB-067', 'Teófilo Otoni', 'Teófilo Otoni', 'MG', -17.86, -41.51, 'Montes Claros/MG', 360, 25),
 (1, 68, 'BNB-068', 'Tutóia', 'Tutóia', 'MA', -2.76, -42.27, 'Parnaíba/PI', 80, 19),
 (1, 69, 'BNB-069', 'União dos Palmares', 'União dos Palmares', 'AL', -9.16, -36.03, 'Maceió/AL', 61, 26),
 (1, 70, 'BNB-070', 'Valença', 'Valença', 'BA', -13.37, -39.07, 'Salvador/BA', 124, 25),
 (1, 71, 'BNB-071', 'Viana', 'Viana', 'MA', -3.22, -45, 'São Luís/MA', 143, 23),
 (1, 72, 'BNB-072', 'Água Branca', 'Água Branca', 'PI', -5.89, -42.64, 'Teresina/PI', 123, 24),
 (1, 73, 'BNB-073', 'Araçuaí', 'Araçuaí', 'MG', -16.85, -42.07, 'Montes Claros/MG', 243, 20),
 (1, 74, 'BNB-074', 'Batalha', 'Batalha', 'AL', -9.68, -37.13, 'Aracaju/SE', 188, 28),
 (1, 75, 'BNB-075', 'Bom Conselho', 'Bom Conselho', 'PE', -9.17, -36.68, 'Maceió/AL', 136, 22),
 (1, 76, 'BNB-076', 'Camacan', 'Camacan', 'BA', -15.42, -39.5, 'Ilhéus/BA', 109, 23),
 (1, 77, 'BNB-077', 'Catolé do Rocha', 'Catolé do Rocha', 'PB', -6.34, -37.75, 'Juazeiro do Norte/CE', 253, 21),
 (1, 78, 'BNB-078', 'Governador Nunes Freire', 'Governador Nunes Freire', 'MA', -2.13, -45.88, 'São Luís/MA', 246, 20),
 (1, 79, 'BNB-079', 'Jaguaribe', 'Jaguaribe', 'CE', -5.89, -38.62, 'Juazeiro do Norte/CE', 214, 25),
 (1, 80, 'BNB-080', 'Oeiras', 'Oeiras', 'PI', -7.02, -42.13, 'Teresina/PI', 300, 31),
 (1, 81, 'BNB-081', 'Pau dos Ferros', 'Pau dos Ferros', 'RN', -6.11, -38.2, 'Juazeiro do Norte/CE', 222, 26),
 (1, 82, 'BNB-082', 'Pombal', 'Pombal', 'PB', -6.77, -37.8, 'Juazeiro do Norte/CE', 221, 26),
 (1, 83, 'BNB-083', 'Salinas', 'Salinas', 'MG', -16.17, -42.29, 'Montes Claros/MG', 226, 31),
 (1, 84, 'BNB-084', 'Solânea', 'Solânea', 'PB', -6.75, -35.66, 'Campina Grande/PB', 83, 23),
 (1, 85, 'BNB-085', 'Sumé', 'Sumé', 'PB', -7.67, -36.88, 'Campina Grande/PB', 152, 21),
 (1, 86, 'BNB-086', 'Viçosa', 'Viçosa', 'AL', -9.37, -36.24, 'Maceió/AL', 67, 21),
 (1, 87, 'BNB-087', 'Centrais Maceió', 'Maceió', 'AL', -9.67, -35.74, 'Maceió/AL', 24, 10),
 (1, 88, 'BNB-088', 'Centro Cultural Fortaleza', 'Fortaleza', 'CE', -3.73, -38.53, 'Fortaleza/CE', 7, 7),
 (1, 89, 'BNB-089', 'Centro Cultural Juazeiro do Norte', 'Juazeiro do Norte', 'CE', -7.21, -39.32, 'Juazeiro do Norte/CE', 7, 2),
 (2, 90, 'BNB-090', 'Centro Cultural Mossoró (Novo 5º aditivo)', 'Mossoró', 'RN', -5.19, -37.34, 'Fortaleza/CE', 266, 29),
 (1, 91, 'BNB-091', 'Centro Cultural Sousa', 'Sousa', 'PB', -6.76, -38.23, 'Juazeiro do Norte/CE', 163, 2),
 (1, 92, 'BNB-092', 'Gapre Brasília', 'Brasília', 'DF', -15.79, -47.88, 'Brasília/DF', 13, 8),
 (1, 93, 'BNB-093', 'Montes Claros Crediamigo Agroamigo', 'Montes Claros', 'MG', -16.73, -43.86, 'Montes Claros/MG', 6, 9),
 (1, 94, 'BNB-094', 'Rio de Janeiro', 'Rio de Janeiro', 'RJ', -22.91, -43.17, 'Rio de Janeiro/RJ', 18, 6),
 (1, 95, 'BNB-095', 'São Paulo', 'São Paulo', 'SP', -23.55, -46.63, 'São Paulo/SP', 27, 5),
 (1, 96, 'BNB-096', 'Superintendência Estadual da Paraíba', 'João Pessoa', 'PB', -7.12, -34.86, 'João Pessoa/PB', 14, 6),
 (1, 97, 'BNB-097', 'Superintendência Estadual de Minas Gerais', 'Montes Claros', 'MG', -16.73, -43.86, 'Montes Claros/MG', 6, 9);

-- Uma tarefa por endereço x atividade do mesmo contrato
INSERT INTO tarefas (endereco_id, atividade_id)
SELECT e.id, a.id FROM enderecos e JOIN atividades a ON a.contrato_id = e.contrato_id;

SELECT setval('clientes_id_seq', (SELECT max(id) FROM clientes));
SELECT setval('contratos_id_seq', (SELECT max(id) FROM contratos));
SELECT setval('checklists_id_seq', (SELECT max(id) FROM checklists));

COMMIT;
