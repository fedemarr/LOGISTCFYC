-- PEDIDOS MANUALES (FYM) — pedido de Fede: poder cargar pedidos a mano
-- para hacer pruebas, sin depender de tener Tienda Nube conectada. Un
-- pedido manual es una fila más de `store_orders` (mismo flujo de
-- asignar/entregar/mapa que uno sincronizado) — la única diferencia es
-- `source`, para no intentar avisarle a Tienda Nube de algo que no
-- existe ahí (ver `markOrderDelivered` en `services/orders.ts`).
ALTER TABLE "public"."store_orders"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'tiendanube';
