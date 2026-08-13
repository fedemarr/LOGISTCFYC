import type { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { createSupabaseClient } from "./supabase";
import { enqueueAction } from "./sync/outbox";

/**
 * Cola local de evidencia fotográfica (§9.6) — offline-first igual que el
 * outbox:
 *
 *   1. El chofer saca la foto (expo-image-picker) → se guarda en
 *      `local_media` como `pending` con su URI local, ANTES de cualquier
 *      red. La entrega se encola al outbox con `photoUrls: []` (si no hubo
 *      señal para subirla al toque) o con el path si subió.
 *   2. `flushMedia` (corre con el motor de sync) sube las `pending` a
 *      Supabase Storage (bucket privado `delivery-evidence`) con el token
 *      de sesión del chofer.
 *   3. Si la foto pertenece a una entrega (`deliveryKey`), al subir se
 *      encola `DELIVERY_PHOTO_ATTACH` para adjuntarle el path al servidor.
 *
 * El path en el bucket es `{routeId}/{yyyy-mm-dd}/{uuid}{ext}` — el
 * servidor nunca recibe el binario, solo el path.
 */

const BUCKET = "delivery-evidence";
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export interface SavePhotoInput {
  localUri: string;
  mimeType?: string;
  routeId: string;
  stopId: string;
  deliveryKey?: string;
}

/** Guarda la foto local y devuelve su id. NO toca la red. */
export async function enqueueLocalPhoto(
  db: SQLiteDatabase,
  input: SavePhotoInput,
): Promise<string> {
  const id = randomUUID();
  const mime = input.mimeType ?? "image/jpeg";
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO local_media (id, local_uri, status, route_id, stop_id, delivery_key, mime_type, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
    id,
    input.localUri,
    input.routeId,
    input.stopId,
    input.deliveryKey ?? null,
    mime,
    now,
  );
  return id;
}

export function mediaExtension(mimeType: string): string {
  const ext = mimeType.split("/")[1] ?? "jpg";
  if (ext === "jpeg") return "jpg";
  return ext.replace(/[^a-z0-9]/gi, "") || "jpg";
}

async function uploadOne(
  db: SQLiteDatabase,
  media: {
    id: string;
    local_uri: string;
    route_id: string;
    stop_id: string;
    delivery_key: string | null;
    mime_type: string;
  },
): Promise<boolean> {
  const ext = mediaExtension(media.mime_type);
  const date = new Date().toISOString().slice(0, 10);
  const storagePath = `${media.route_id}/${date}/${media.id}.${ext}`;

  try {
    const response = await fetch(media.local_uri);
    const blob = await response.blob();

    const supabase = createSupabaseClient();
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, blob, {
      contentType: media.mime_type in ALLOWED_MIME ? media.mime_type : "image/jpeg",
      upsert: false,
    });
    if (error) return false;

    await db.runAsync(
      `UPDATE local_media SET status = 'uploaded', storage_path = ?, uploaded_at = ? WHERE id = ?`,
      storagePath,
      new Date().toISOString(),
      media.id,
    );

    // La entrega pudo haberse sincronizado sin la foto (offline) — adjuntarla.
    if (media.delivery_key) {
      await enqueueAction(db, "DELIVERY_PHOTO_ATTACH", {
        routeId: media.route_id,
        stopId: media.stop_id,
        deliveryKey: media.delivery_key,
        photoUrl: storagePath,
        attachedAt: new Date().toISOString(),
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Sube todas las fotos pendientes. Devuelve cuántas se subieron. Se llama desde el motor de sync. */
export async function flushMedia(db: SQLiteDatabase): Promise<number> {
  const pending = await db.getAllAsync<{
    id: string;
    local_uri: string;
    route_id: string;
    stop_id: string;
    delivery_key: string | null;
    mime_type: string;
  }>(
    `SELECT id, local_uri, route_id, stop_id, delivery_key, mime_type
     FROM local_media WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`,
  );

  let uploaded = 0;
  for (const media of pending) {
    if (await uploadOne(db, media)) uploaded += 1;
  }
  return uploaded;
}
