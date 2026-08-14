-- FASE 10 — Bucket privado de evidencia de entregas (§9.6).
--
-- `delivery-evidence` es un bucket PRIVADO: nadie lo lee sin URL firmado
-- (el servidor lo firma con la service role key, ver
-- `apps/web/src/lib/storage.ts`). La app del chofer SOLO puede subir
-- objetos autenticada (session token de Supabase Auth); los paths llevan
-- org_id/route_id delante para auditar quién subió qué (el nombre del
-- objeto incluye el device_id de la app).

-- 1. Crear el bucket (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'delivery-evidence'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'delivery-evidence',
      'delivery-evidence',
      false,
      10485760,          -- 10 MB máx por foto
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    );
  END IF;
END
$$;

-- 2. Políticas RLS del bucket.
--    Subida: cualquier usuario autenticado de la organización (la app del
--    chofer usa el token de sesión; el org se valida en el path y el
--    servidor es quien referencía el path en `deliveries`).
DROP POLICY IF EXISTS "drivers_upload_evidence" ON storage.objects;
CREATE POLICY "drivers_upload_evidence"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'delivery-evidence');

--    Actualizar (re-subir una foto fallida con el mismo nombre / attach
--    posterior): solo el dueño del objeto o un rol staff.
DROP POLICY IF EXISTS "evidence_update_owner_or_staff" ON storage.objects;
CREATE POLICY "evidence_update_owner_or_staff"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'delivery-evidence'
    AND (owner_id = auth.uid()::text OR public.has_role('admin'::user_role) OR public.has_role('dispatcher'::user_role))
  );

--    Lectura: NUNCA público. El servidor firma URLs con la service role
--    key; el navegador y la app leen solo a través de esos URLs firmados.
--    (No se crea policy de SELECT a propósito — bucket privado.)
