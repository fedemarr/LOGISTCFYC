import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "./api";
import { getDeviceId } from "./device";

const CHANNEL_ID = "default";

/**
 * Push notifications (FASE 12 §5) — la app del chofer registra su token
 * Expo Push contra el backend (`POST /api/notifications/register`) y lo
 * borra al desloguearse. El handler se setea acá a nivel de módulo para
 * que las notificaciones se muestren aunque la app esté en foreground.
 *
 * ⚠️ Desde SDK 53 push remoto NO funciona en Expo Go en Android: requiere
 * dev build (ver AGENTS.md / docs v57 expo-notifications).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function isPushSupported(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Notificaciones",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

/**
 * Pide el token Expo Push del dispositivo (creando el canal de Android y
 * solicitando permiso al usuario la primera vez). Devuelve `null` si el
 * usuario no otorga permiso o no hay projectId configurado — el registro
 * se reintenta en el próximo arranque.
 */
export async function getPushToken(): Promise<string | null> {
  if (!isPushSupported()) return null;
  await ensureAndroidChannel();

  const settings = await Notifications.getPermissionsAsync();
  let granted = settings.granted;
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}

export async function registerPushWithBackend(token: string): Promise<void> {
  const deviceId = await getDeviceId();
  await api.post("/api/notifications/register", {
    token,
    deviceId,
    platform: Platform.OS,
  });
}

export async function unregisterPushWithBackend(token: string): Promise<void> {
  await api.del("/api/notifications/register", { token });
}
