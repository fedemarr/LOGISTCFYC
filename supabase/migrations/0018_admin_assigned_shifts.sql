-- TURNO ASIGNADO POR EL ADMIN (FYM) — pedido de Fede: "que el admin
-- pueda pre-armar el turno" (zona + paquetes) para que el chofer, al
-- escanear su QR, solo tenga que tocar "Iniciar" en vez de tipear todo.
ALTER TABLE "public"."driver_shifts"
  ADD COLUMN IF NOT EXISTS "assigned_by_admin" boolean NOT NULL DEFAULT false;
