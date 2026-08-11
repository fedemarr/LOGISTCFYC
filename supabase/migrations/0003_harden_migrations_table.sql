-- El GRANT ALL ON ALL TABLES IN SCHEMA public de 0002 alcanzó también a
-- `_lastmile_migrations` (tabla interna del corredor de migraciones, no es
-- dato de negocio). Sin policies, RLS activada = nadie del lado cliente
-- puede tocarla; solo la conexión directa de administración (que bypassea
-- RLS) puede leer/escribir, que es como debe ser.
ALTER TABLE public._lastmile_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._lastmile_migrations FROM authenticated, anon;
