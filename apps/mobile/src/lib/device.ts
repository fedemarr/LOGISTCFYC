import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const DEVICE_ID_KEY = "fyc-device-id";

/**
 * Identificador estable del dispositivo (§12: cada acción del outbox
 * viaja con un `deviceId` — sirve para diagnóstico del lado servidor,
 * "¿qué dispositivo mandó esto?"). Se genera una sola vez y se persiste;
 * reinstalar la app genera uno nuevo (no hay forma más simple de
 * identificar hardware sin permisos adicionales, y no hace falta más
 * precisión que esta para lo que usa FASE 7).
 */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}
