-- Confirmación de la cantidad declarada de paquetes (pedido de Fede:
-- "pago x paquete", necesita saber que lo que declara el chofer es
-- real). El chofer sube una captura de Flex al arrancar el turno; una IA
-- la analiza y compara contra lo que escribió. Si coincide con
-- confianza, el turno arranca solo. Si no, o si la IA no está
-- configurada, el turno queda PENDING hasta que alguien del depósito lo
-- revise a mano (ve la captura + lo que leyó la IA) y confirme o
-- rechace.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. shift_status: agregar PENDING (Postgres no permite reordenar
--    valores de enum, solo agregar — PENDING queda al final del tipo,
--    no importa para la lógica de la app, que compara por nombre).
-- ═══════════════════════════════════════════════════════════════════════
ALTER TYPE "public"."shift_status" ADD VALUE IF NOT EXISTS 'PENDING';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. driver_shifts: captura de Flex + resultado de la confirmación.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE "public"."driver_shifts"
  ADD COLUMN IF NOT EXISTS "flex_screenshot_path" text,
  ADD COLUMN IF NOT EXISTS "confirmed_by" uuid,
  ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "ai_confirmed" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ai_analysis" jsonb,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "public"."driver_shifts"
  ADD CONSTRAINT "driver_shifts_confirmed_by_fk"
  FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id");

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Bucket privado para las capturas de Flex — SOLO el backend (service
--    role) sube y firma URLs de lectura, nunca el navegador directo: el
--    chofer de FYM no tiene sesión de Supabase Auth (autentica con el QR,
--    ver `requireDriver`), así que no hay policy de `authenticated` que
--    tenga sentido acá — sin policies extra, RLS deja el bucket cerrado
--    a cualquiera que no sea la service role (que la bypasea).
-- ═══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'flex-screenshots'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'flex-screenshots',
      'flex-screenshots',
      false,
      8388608,           -- 8 MB máx por captura
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    );
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RLS de driver_shifts: warehouse ("depósito") también confirma
--    turnos pendientes, no solo admin/dispatcher.
-- ═══════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "shifts_staff_all" ON driver_shifts;
CREATE POLICY "shifts_staff_all" ON driver_shifts FOR ALL
  USING (
    org_id = public.current_org_id()
    AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
  );
