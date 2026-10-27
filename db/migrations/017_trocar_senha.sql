-- Troca de senha obrigatória: senha fraca no login ou senha inicial/redefinida pelo administrador.
-- Enquanto estiver marcada, o usuário só acessa a troca de senha.
ALTER TABLE usuarios ADD COLUMN trocar_senha BOOLEAN NOT NULL DEFAULT false;
