-- ALERTAS DE ENTREGA (FYM) — pedido de Fede: "que haya una sección de
-- alerta por paquete no entregado o domicilio no está la persona y que haya
-- una manera de cargarle el número así la parte de control llama y el
-- conductor puede seguir manejando".
--
-- FYM no trackea paquetes individuales (ver MODELO-DATOS.md): esto es un
-- LOG de incidentes del turno, no "marcar el paquete N". El chofer, durante
-- un turno ACTIVE, reporta desde la PWA un problema de entrega (no estaba
-- el destinatario / rechazó / otro) con el teléfono de contacto del
-- destinatario si lo tiene. Fire-and-forget: no bloquea nada. Control
-- (admin/dispatcher) ve la cola y lo marca contactado/resuelto.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═══════════════════════════════════════════════════════════════════════
CREATE TYPE "public"."delivery_alert_reason" AS ENUM('NOT_HOME', 'REFUSED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."delivery_alert_status" AS ENUM('OPEN', 'CONTACTED', 'RESOLVED');--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════
-- 2. TABLA
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "delivery_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"reason" "delivery_alert_reason" NOT NULL,
	"contact_phone" text,
	"note" text,
	"status" "delivery_alert_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "delivery_alerts" ADD CONSTRAINT "delivery_alerts_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "delivery_alerts" ADD CONSTRAINT "delivery_alerts_shift_id_fk"
  FOREIGN KEY ("shift_id") REFERENCES "driver_shifts"("id");
--> statement-breakpoint
ALTER TABLE "delivery_alerts" ADD CONSTRAINT "delivery_alerts_driver_id_fk"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id");
--> statement-breakpoint
CREATE INDEX "delivery_alerts_org_status_idx" ON "delivery_alerts" ("org_id", "status");
CREATE INDEX "delivery_alerts_shift_id_idx" ON "delivery_alerts" ("shift_id");
CREATE INDEX "delivery_alerts_driver_id_idx" ON "delivery_alerts" ("driver_id");

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RLS — mismo patrón que zone_alerts (0011): el staff
--    (admin/dispatcher) lee/actualiza toda la org; el chofer inserta y lee
--    las suyas.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE delivery_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_alerts_select_staff" ON delivery_alerts FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "delivery_alerts_select_own_driver" ON delivery_alerts FOR SELECT
  USING (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "delivery_alerts_insert_own_driver" ON delivery_alerts FOR INSERT
  WITH CHECK (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "delivery_alerts_staff_update" ON delivery_alerts FOR UPDATE
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));