import { Errors } from "@/lib/api/errors";

/**
 * Storage de las capturas de Flex (pedido de Fede: "pago x paquete",
 * confirmar que la cantidad declarada es real — ver
 * `services/package-verification.ts` y el bucket `flex-screenshots`,
 * creado en la migración 0012).
 *
 * El chofer de FYM NO tiene sesión de Supabase Auth (autentica con el QR,
 * `requireDriver`), así que subir directo desde el navegador con RLS no
 * aplica acá — todo pasa por el backend con la service role key, que
 * bypasea RLS. El bucket es privado (sin policies de lectura): para
 * mostrar una captura en el panel hay que firmar su URL acá.
 */

const BUCKET = "flex-screenshots";

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

/**
 * Sube una captura (base64, sin el prefijo `data:...;base64,`) al bucket
 * privado. Devuelve el `path` interno (lo que se guarda en
 * `driver_shifts.flex_screenshot_path`), no una URL — el bucket es
 * privado, no hay URL pública que guardar.
 */
export async function uploadFlexScreenshot(
  orgId: string,
  driverId: string,
  base64Data: string,
  mimeType: string,
): Promise<string> {
  const ext =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const path = `${orgId}/${driverId}/${Date.now()}.${ext}`;
  const binary = Buffer.from(base64Data, "base64");

  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${path}`, {
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
    throw Errors.internal(`no se pudo subir la captura (HTTP ${res.status}): ${body}`);
  }
  return path;
}

/** URL firmada (temporal) para que el panel muestre una captura. */
export async function signFlexScreenshotUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok) {
    throw Errors.internal(`no se pudo firmar el URL de la captura (HTTP ${res.status})`);
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
