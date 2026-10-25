-- Liga o RLS em todas as tabelas do schema public. O app conecta como dono das tabelas (não é afetado);
-- no Supabase isso fecha a API pública (PostgREST) para quem tiver só a chave anon.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
