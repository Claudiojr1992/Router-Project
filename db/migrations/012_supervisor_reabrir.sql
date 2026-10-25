-- RoutProject · perfil Supervisor (mesmos acessos da coordenação) e regra de reabrir atividade concluída
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_perfil_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_check CHECK (perfil IN ('admin','coordenador','supervisor','tecnico','administrativo','cliente'));
