import * as React from "react";
import * as Notifications from "expo-notifications";
import { useSession } from "../context/session";
import {
  getPushToken,
  registerPushWithBackend,
  unregisterPushWithBackend,
} from "../lib/notifications";

/**
 * Registro del token Expo Push (FASE 12 §5). Corre mientras hay sesión:
 * pide el token del dispositivo y lo registra contra el backend. Si el
 * push service rota el token en caliente, `addPushTokenListener` lo
 * vuelve a registrar (los tokens viejos quedan inválidos). Al cerrar
 * sesión borra el token del backend.
 *
 * Errores silenciados a propósito: si no hay red o el usuario no da
 * permiso, el registro se reintenta en el próximo arranque/sesión.
 */
export function usePushRegistration(): void {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const tokenRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!userId) {
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) {
        void unregisterPushWithBackend(token).catch(() => {});
      }
      return;
    }

    let cancelled = false;
    let subscription: Notifications.EventSubscription | null = null;

    const register = (pushToken: string): void => {
      void registerPushWithBackend(pushToken)
        .then(() => {
          if (!cancelled) tokenRef.current = pushToken;
        })
        .catch(() => {
          /* reintentar en el próximo arranque */
        });
    };

    void getPushToken().then((pushToken) => {
      if (!pushToken || cancelled) return;
      register(pushToken);
      subscription = Notifications.addPushTokenListener(({ data }) => register(data));
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [userId]);
}
