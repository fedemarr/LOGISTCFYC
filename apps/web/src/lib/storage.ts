import { Errors } from "@/lib/api/errors";

/**
 * Storage de evidencia (fotos de entregas e incidencias) — PROMPT-MAESTRO
 * §9.6, bucket privado `delivery-evidence` (creado en la migración 0008).
 *
 * Las fotos se suben SOLO desde la app del chofer con el token de sesión
 * (policy de RLS `auth.role() = 'authenticated'` + `bucket_id =
 * 'delivery-evidence'`); el servidor NUNCA recibe el binario, solo el
 * `path` del objeto (que persiste en `deliveries.photo_urls` /
 * `incidents.photo_urls`). Para leerlas, el panel pide un URL firmado acá
 * con la service role key — el navegador nunca ve esa key.
 *
 * El `path` dentro del bucket es `{orgId}/{routeId}/{date}/{uuid}.jpg`,
 * que es lo que autoriza la policy de lectura del bucket (solo
 * autenticados, cualquier ruta dentro del bucket).
 */

const BUCKET = "delivery-evidence";

export function getBucketName(): string {
  return BUCKET;
}

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw Errors.internal("NEXT_PUBLIC_SUPABASE_URL no está configurada");
  }
  return url.replace(/\/$/, "");
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw Errors.internal("SUPABASE_SERVICE_ROLE_KEY no está configurada");
  }
  return key;
}

/**
 * URL firmada de un objeto del bucket de evidencia. El path puede ser
 * relativo (`org/route/date/uuid.jpg`) o absoluto (`delivery-evidence/...`);
 * si ya es una URL completa se devuelve tal cual (compatibilidad con datos
 * viejos).
 */
export async function signEvidenceUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const clean = path.startsWith("http") ? path : path.replace(/^delivery-evidence\//, "");

  const res = await fetch(`${supabaseUrl()}/storage/v1/object/sign/${BUCKET}/${clean}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });

  if (!res.ok) {
    throw Errors.internal(`no se pudo firmar el URL de evidencia (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { signedURL?: string } | { error?: string };
  if ("error" in data && data.error) {
    throw Errors.internal(`storage no firmó el URL: ${data.error}`);
  }
  const signed = (data as { signedURL?: string }).signedURL;
  if (!signed) {
    throw Errors.internal("storage no devolvió signedURL");
  }
  return signed.startsWith("http") ? signed : `${supabaseUrl()}${signed}`;
}

/** URL firmada de todas las fotos de una evidencia (multi-foto, §9.6). */
export async function signEvidenceUrls(
  paths: string[],
  expiresInSeconds = 3600,
): Promise<string[]> {
  return Promise.all(paths.map((p) => signEvidenceUrl(p, expiresInSeconds)));
}
