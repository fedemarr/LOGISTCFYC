-- DATOS DE QUIEN RECIBE (FYM) — pedido de Fede: "al entregar pedido
-- tenés que marcar a quién se lo entregás y el DNI y la foto". Se piden
-- junto con la foto obligatoria al marcar entregado desde la PWA del
-- chofer (markOrderDeliveredByDriver).
ALTER TABLE "public"."store_orders"
  ADD COLUMN IF NOT EXISTS "recipient_name" text,
  ADD COLUMN IF NOT EXISTS "recipient_dni" text;
