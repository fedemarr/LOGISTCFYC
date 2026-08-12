-- FASE 5 (§2, §9.1): "Paquete de otro cliente — Detectar por prefijo del
-- código; marcar WRONG_CLIENT, apartar físicamente". El prefijo es
-- opcional (hoy hay un solo proveedor, §1) — sin prefijo configurado no se
-- hace detección de cliente equivocado para ese cliente.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS code_prefix text;
