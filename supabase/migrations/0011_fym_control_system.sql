-- FASE FYM — Sistema de control de choferes (reemplaza al sistema de
-- reparto FYC, archivado en el branch `archive/fyc-delivery-system`).
--
-- Nuevo modelo: zonas con geocerca circular, turnos de chofer (con fecha,
-- cantidad de paquetes, aviso cada 2-3 h), reportes de avance y alertas de
-- zona. El QR del chofer autentica SOLO (token aleatorio, se guarda el hash
-- SHA-256 en `users.qr_token_hash`).

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ENUMS FYM
-- ═══════════════════════════════════════════════════════════════════════
CREATE TYPE "public"."shift_status" AS ENUM('ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."zone_alert_type" AS ENUM('LEFT_ZONE');--> statement-breakpoint
CREATE TYPE "public"."zone_alert_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint

-- Ampliar el enum de entidades del event log (append-only, ver 0001) con
-- las entidades FYM. No se borran las viejas: Postgres no permite borrar
-- valores de enum sin recrear el tipo, y la tabla `events` ya tiene filas.
DO $fym$
BEGIN
  ALTER TYPE public.event_entity_type ADD VALUE IF NOT EXISTS 'SHIFT';
  ALTER TYPE public.event_entity_type ADD VALUE IF NOT EXISTS 'ZONE';
  ALTER TYPE public.event_entity_type ADD VALUE IF NOT EXISTS 'ALERT';
EXCEPTION WHEN duplicate_object THEN NULL;
END
$fym$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. USERS: hash del token del QR de identificación del chofer
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "qr_token_hash" text;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. ZONAS (geocerca circular: centro + radio en metros)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color_hex" varchar(7) DEFAULT '#3b82f6' NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
CREATE INDEX "zones_org_id_idx" ON "zones" ("org_id");

-- ═══════════════════════════════════════════════════════════════════════
-- 4. TURNOS DE CHOFER
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "driver_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"package_count" integer NOT NULL,
	"status" "shift_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"undelivered_count" integer,
	"notes" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_driver_id_fk"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_zone_id_fk"
  FOREIGN KEY ("zone_id") REFERENCES "zones"("id");
--> statement-breakpoint
CREATE INDEX "driver_shifts_driver_id_date_idx" ON "driver_shifts" ("driver_id", "shift_date");
CREATE INDEX "driver_shifts_org_status_idx" ON "driver_shifts" ("org_id", "status");

-- ═══════════════════════════════════════════════════════════════════════
-- 5. REPORTES DE AVANCE (aviso cada 2-3 h del chofer)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "shift_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"packages_done" integer NOT NULL,
	"note" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_shift_id_fk"
  FOREIGN KEY ("shift_id") REFERENCES "driver_shifts"("id");
--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_driver_id_fk"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id");
--> statement-breakpoint
CREATE INDEX "shift_reports_shift_id_reported_at_idx" ON "shift_reports" ("shift_id", "reported_at");

-- ═══════════════════════════════════════════════════════════════════════
-- 6. ALERTAS DE ZONA (geocerca: el chofer se salió de su zona)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "zone_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"alert_type" "zone_alert_type" NOT NULL,
	"status" "zone_alert_status" DEFAULT 'OPEN' NOT NULL,
	"distance_outside_m" integer,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "zone_alerts" ADD CONSTRAINT "zone_alerts_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "zone_alerts" ADD CONSTRAINT "zone_alerts_shift_id_fk"
  FOREIGN KEY ("shift_id") REFERENCES "driver_shifts"("id");
--> statement-breakpoint
ALTER TABLE "zone_alerts" ADD CONSTRAINT "zone_alerts_driver_id_fk"
  FOREIGN KEY ("driver_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "zone_alerts" ADD CONSTRAINT "zone_alerts_zone_id_fk"
  FOREIGN KEY ("zone_id") REFERENCES "zones"("id");
--> statement-breakpoint
CREATE INDEX "zone_alerts_org_status_idx" ON "zone_alerts" ("org_id", "status");
CREATE INDEX "zone_alerts_shift_id_idx" ON "zone_alerts" ("shift_id");

-- ═══════════════════════════════════════════════════════════════════════
-- 7. GPS: asociar cada punto con el turno activo del chofer
--    (la columna, ya existe la tabla particionada por mes de 0000/0001)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE "public"."driver_locations"
  ADD COLUMN IF NOT EXISTS "shift_id" uuid;
--> statement-breakpoint
ALTER TABLE "public"."driver_locations" ADD CONSTRAINT "driver_locations_shift_id_fk"
  FOREIGN KEY ("shift_id") REFERENCES "driver_shifts"("id");

-- ═══════════════════════════════════════════════════════════════════════
-- 8. RLS — mismo patrón que 0002 (helpers current_org_id/has_role ya existen)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_alerts ENABLE ROW LEVEL SECURITY;

-- zones: el staff (admin/dispatcher) gestiona; toda la org lee.
CREATE POLICY "zones_select_org" ON zones FOR SELECT
  USING (org_id = public.current_org_id());
CREATE POLICY "zones_staff_write" ON zones FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));

-- driver_shifts: staff gestiona toda la org; el chofer lee/actualiza los suyos.
CREATE POLICY "shifts_staff_all" ON driver_shifts FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "shifts_driver_own" ON driver_shifts FOR ALL
  USING (public.has_role('driver') AND driver_id = auth.uid())
  WITH CHECK (public.has_role('driver') AND driver_id = auth.uid());

-- shift_reports: staff lee toda la org; el chofer crea los suyos.
CREATE POLICY "reports_select_staff" ON shift_reports FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "reports_select_own_driver" ON shift_reports FOR SELECT
  USING (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "reports_insert_driver_own" ON shift_reports FOR INSERT
  WITH CHECK (public.has_role('driver') AND driver_id = auth.uid());

-- zone_alerts: staff gestiona (resuelve); el chofer lee las suyas.
CREATE POLICY "alerts_select_staff" ON zone_alerts FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "alerts_select_own_driver" ON zone_alerts FOR SELECT
  USING (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "alerts_staff_update" ON zone_alerts FOR UPDATE
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));

-- ═══════════════════════════════════════════════════════════════════════
-- 9. EVENT LOG — el motor de geocerca usa el helper log_event() de 0001.
--    El backend inserta con service_role (bypasea RLS), no hace falta
--    policy nueva acá. Comentario para reflejar el nuevo mundo FYM.
-- ═══════════════════════════════════════════════════════════════════════
COMMENT ON TABLE public.events IS
  'Event log append-only (§7). En FYM las entidades son SHIFT, ZONE, ALERT, USER.';