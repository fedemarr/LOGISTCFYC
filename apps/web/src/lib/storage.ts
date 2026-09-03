import { Errors } from "@/lib/api/errors";

/**
 * Storage privado de FYM — dos buckets:
 *   - `flex-screenshots`: captura de Flex al arrancar el turno (pedido de
 *     Fede: "pago x paquete", confirmar que la cantidad declarada es
 *     real — ver `services/package-verification.ts`, migración 0012).
 *   - `order-delivery-evidence`: foto de confirmación al marcar un
 *     pedido de Tienda Nube como entregado desde la PWA (pedido de Fede,
 *     migración 0016).
 *
 * El chofer de FYM NO tiene sesión de Supabase Auth (autentica con el QR,
 * `requireDriver`), así que subir directo desde el navegador con RLS no
 * aplica acá — todo pasa por el backend con la service role key, que
 * bypasea RLS. Los buckets son privados (sin policies de lectura): para
 * mostrar una foto en el panel hay que firmar su URL acá.
 */

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw Errors.internal("NEXT_PUBLIC_SUPABASE_URL no está configurada");
  return url.replace(/\/$/, "");
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Errors.internal("SUPABASE_SERVICE_ROLE_KEY no está configurada");
  return key;
}

function extFor(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

/**
 * Sube una foto (base64, sin el prefijo `data:...;base64,`) a un bucket
 * privado. Devuelve el `path` interno, no una URL — el bucket es
 * privado, no hay URL pública que guardar.
 */
async function uploadPrivatePhoto(
  bucket: string,
  path: string,
  base64Data: string,
  mimeType: string,
): Promise<string> {
  const binary = Buffer.from(base64Data, "base64");
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: binary,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Errors.internal(`no se pudo subir la foto (HTTP ${res.status}): ${body}`);
  }
  return path;
}

/** URL firmada (temporal) para que el panel/PWA muestre una foto privada. */
async function signPrivatePhotoUrl(
  bucket: string,
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok) {
    throw Errors.internal(`no se pudo firmar el URL de la foto (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { signedURL?: string; error?: string };
  if (data.error) throw Errors.internal(`storage no firmó el URL: ${data.error}`);
  if (!data.signedURL) throw Errors.internal("storage no devolvió signedURL");
  // `signedURL` viene relativo a `/storage/v1` (ej. "/object/sign/…"), NO
  // relativo a la raíz del proyecto — concatenar directo con `supabaseUrl()`
  // da una URL que 404 (bug real, encontrado viendo la preview rota en
  // /choferes: el <img> nunca cargaba).
  return `${supabaseUrl()}/storage/v1${data.signedURL}`;
}

export async function uploadFlexScreenshot(
  orgId: string,
  driverId: string,
  base64Data: string,
  mimeType: string,
): Promise<string> {
  const path = `${orgId}/${driverId}/${Date.now()}.${extFor(mimeType)}`;
  return uploadPrivatePhoto("flex-screenshots", path, base64Data, mimeType);
}

export function signFlexScreenshotUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return signPrivatePhotoUrl("flex-screenshots", path, expiresInSeconds);
}

/** Foto de confirmación al marcar un pedido entregado desde la PWA. */
export async function uploadDeliveryEvidence(
  orgId: string,
  orderId: string,
  base64Data: string,
  mimeType: string,
): Promise<string> {
  const path = `${orgId}/${orderId}/${Date.now()}.${extFor(mimeType)}`;
  return uploadPrivatePhoto("order-delivery-evidence", path, base64Data, mimeType);
}

export function signDeliveryEvidenceUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return signPrivatePhotoUrl("order-delivery-evidence", path, expiresInSeconds);
}
