-- INTEGRACIÓN CON TIENDA NUBE (pedido de un cliente por WhatsApp,
-- 03/09/2026): sincronizar el estado de los pedidos y poder generar el
-- envío por fuera de Tienda Nube. Ver `docs/DECISIONES.md` si hace falta
-- el ADR — resumen acá:
--
--   - Cada org conecta UNA tienda (`tiendanube_connections`, 1:1) con un
--     token de "aplicación a medida" generado directo desde el admin de
--     Tienda Nube (no hace falta ser Partner ni publicar nada — ver
--     https://ayuda.tiendanube.com/es_ES/aplicaciones-a-medida).
--   - Cada pedido sincronizado es una fila en `store_orders` — EXCEPCIÓN
--     deliberada a la regla de "FYM no trackea paquetes individuales"
--     (ver el comentario de cabecera en `packages/shared/src/constants/fym.ts`):
--     acá sí hace falta, porque hay que devolverle a Tienda Nube el
--     estado de cada pedido por separado.
--   - `store_orders.shift_id` (nullable) es el link opcional a un turno
--     de chofer — se arma cuando un dispatcher asigna el pedido a alguien
--     para repartir. No es obligatorio: la sincronización + visibilidad
--     del estado funciona aunque todavía no se haya asignado nada.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. ENUM
-- ═══════════════════════════════════════════════════════════════════════
CREATE TYPE "public"."store_order_status" AS ENUM('PENDING', 'ASSIGNED', 'DELIVERED', 'FAILED', 'CANCELLED');--> statement-breakpoint

-- Ampliar el enum de entidades del event log (append-only, ver 0001) con
-- ORDER — mismo patrón que 0011 (agregar valores nuevos sin borrar los
-- viejos, Postgres no lo permite y `events` ya tiene filas).
DO $tiendanube$
BEGIN
  ALTER TYPE public.event_entity_type ADD VALUE IF NOT EXISTS 'ORDER';
EXCEPTION WHEN duplicate_object THEN NULL;
END
$tiendanube$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. CONEXIÓN CON LA TIENDA (1:1 por org)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "tiendanube_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" text NOT NULL,
	-- Token de la app a medida — sensible, NUNCA se expone al cliente
	-- (solo se usa server-side para llamar a la API de Tienda Nube). Sin
	-- cifrar por ahora (mismo nivel que otras claves de API en `.env` de
	-- este proyecto) — si hace falta subir el estándar, cifrar acá y en
	-- la lectura de `services/tiendanube.ts`.
	"access_token" text NOT NULL,
	"shop_name" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tiendanube_connections" ADD CONSTRAINT "tiendanube_connections_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "tiendanube_connections" ADD CONSTRAINT "tiendanube_connections_connected_by_fk"
  FOREIGN KEY ("connected_by") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "tiendanube_connections" ADD CONSTRAINT "tiendanube_connections_org_id_unique"
  UNIQUE ("org_id");

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PEDIDOS SINCRONIZADOS
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE "store_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	-- id numérico del pedido en Tienda Nube, como texto (evita overflow de
	-- bigint en distintos drivers/ORMs y no necesitamos aritmética sobre
	-- este valor).
	"external_id" text NOT NULL,
	"order_number" text NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"shipping_address" text,
	"shipping_city" text,
	"shipping_province" text,
	"status" "store_order_status" DEFAULT 'PENDING' NOT NULL,
	-- shipping_status crudo de Tienda Nube (unpacked/shipped/delivered/…) —
	-- referencia, no es lo que maneja nuestra máquina de estados.
	"external_status" text,
	"shift_id" uuid,
	"raw_payload" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_shift_id_fk"
  FOREIGN KEY ("shift_id") REFERENCES "driver_shifts"("id");
--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_org_id_external_id_unique"
  UNIQUE ("org_id", "external_id");
--> statement-breakpoint
CREATE INDEX "store_orders_org_status_idx" ON "store_orders" ("org_id", "status");
CREATE INDEX "store_orders_shift_id_idx" ON "store_orders" ("shift_id");

-- ═══════════════════════════════════════════════════════════════════════
-- 4. RLS — solo staff (admin/dispatcher/warehouse). Los choferes no leen
--    esto todavía por RLS directo: la asignación pedido→turno la arma el
--    dispatcher desde el panel, no es un flujo de la PWA en esta primera
--    versión.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE tiendanube_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tiendanube_connections_staff_all" ON tiendanube_connections FOR ALL
  USING (org_id = public.current_org_id() AND public.has_role('admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role('admin'));

CREATE POLICY "store_orders_staff_all" ON store_orders FOR ALL
  USING (
    org_id = public.current_org_id()
    AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
  );
