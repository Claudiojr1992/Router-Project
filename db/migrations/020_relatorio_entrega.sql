-- Relatório técnico de entrega: símbolo (logo) da empresa executora e pessoas envolvidas no projeto
ALTER TABLE empresas ADD COLUMN logo TEXT;            -- imagem PNG/JPG em data URL (até ~300 KB)
ALTER TABLE contratos ADD COLUMN analista TEXT;       -- analista projetista do projeto
ALTER TABLE contratos ADD COLUMN elaborador TEXT;     -- quem elabora os relatórios de entrega
