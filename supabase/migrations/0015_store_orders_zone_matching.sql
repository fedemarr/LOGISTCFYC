-- AGRUPAR PEDIDOS POR ZONA (pedido de Fede, 03/09/2026): geocodificar cada
-- pedido sincronizado de Tienda Nube y sugerir la zona (geocerca) más
-- cercana, para poder asignarlos en bloque a un chofer en vez de uno por
-- uno. `suggested_zone_id` es una SUGERENCIA (se recalcula al sincronizar,
-- el dispatcher puede asignar a cualquier turno igual) — no reemplaza el
-- `zone_id` del turno del chofer.

ALTER TABLE "public"."store_orders"
  ADD COLUMN IF NOT EXISTS "lat" double precision,
  ADD COLUMN IF NOT EXISTS "lng" double precision,
  ADD COLUMN IF NOT EXISTS "suggested_zone_id" uuid;
--> statement-breakpoint
ALTER TABLE "public"."store_orders" ADD CONSTRAINT "store_orders_suggested_zone_id_fk"
  FOREIGN KEY ("suggested_zone_id") REFERENCES "public"."zones"("id");
--> statement-breakpoint
CREATE INDEX "store_orders_suggested_zone_id_idx" ON "public"."store_orders" ("suggested_zone_id");
