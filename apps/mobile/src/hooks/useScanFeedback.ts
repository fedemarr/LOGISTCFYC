import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";

export type ScanFeedbackKind = "ok" | "duplicate" | "error";

/**
 * Feedback sonoro y háptico DIFERENCIADO por resultado (§14 FASE 8: "OK /
 * duplicado / error"). Los tres `.wav` son sintéticos (generados con un
 * script, sin depender de ningún asset de terceros) — un beep agudo
 * corto para OK, dos beeps medios para duplicado, un tono grave más
 * largo para error. Suficiente para distinguir por oído sin mirar la
 * pantalla, que es el punto (§13: "pantalla sucia", trabajo con guantes).
 */
export function useScanFeedback(): (kind: ScanFeedbackKind) => void {
  const okPlayer = useAudioPlayer(require("../../assets/sounds/scan-ok.wav"));
  const duplicatePlayer = useAudioPlayer(
    require("../../assets/sounds/scan-duplicate.wav"),
  );
  const errorPlayer = useAudioPlayer(require("../../assets/sounds/scan-error.wav"));

  return function playScanFeedback(kind: ScanFeedbackKind) {
    const player =
      kind === "ok" ? okPlayer : kind === "duplicate" ? duplicatePlayer : errorPlayer;
    const notificationType =
      kind === "ok"
        ? Haptics.NotificationFeedbackType.Success
        : kind === "duplicate"
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Error;

    void Haptics.notificationAsync(notificationType);
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // el sonido es un plus, no algo que deba tumbar el flujo de escaneo
    }
  };
}
