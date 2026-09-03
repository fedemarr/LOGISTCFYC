-- CONFIRMAR ENTREGA CON FOTO + MAPA EN LA PWA (pedido de Fede, 03/09/2026):
-- el chofer ve sus pedidos asignados en un apartado de mapa, marca cada uno
-- entregado con una foto de confirmación, y tiene un link directo a Google
-- Maps para llegar. La foto queda en un bucket privado nuevo (separado de
-- `flex-screenshots`, otro propósito) — solo el backend sube/firma.

ALTER TABLE "public"."store_orders"
  ADD COLUMN IF NOT EXISTS "evidence_photo_path" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'order-delivery-evidence'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'order-delivery-evidence',
      'order-delivery-evidence',
      false,
      8388608,           -- 8 MB máx por foto
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    );
  END IF;
END
$$;
