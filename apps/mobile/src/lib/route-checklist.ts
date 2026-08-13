/**
 * Lógica pura del checklist de inicio de ruta (§9.4) — sin imports de RN,
 * testeada en Vitest (patrón del proyecto: la lógica con reglas va en
 * `src/lib/` pura, los componentes solo la renderizan).
 *
 * El checklist completo de §9.4:
 *   - custodia confirmada sin diferencias (la valida el servidor; acá solo
 *     se refleja lo que devuelve `canStart`)
 *   - vehículo AVAILABLE (servidor, no verificable desde el device)
 *   - permiso de ubicación (incluido background) — atestación del device
 *   - GPS con precisión < 50 m — medida del device
 *   - optimización de batería desactivada — atestación del device
 *   - ruta descargada completa a SQLite — device
 *   - batería > 20 % — advertencia NO bloqueante (§9.4)
 */

export interface ChecklistDeviceInput {
  gpsAccuracyM: number | null;
  locationPermissionGranted: boolean;
  batteryOptimizationDisabled: boolean;
  routeDownloaded: boolean;
  batteryLevel: number | null;
  /** La custodia ya se confirmó y la ruta está ASSIGNED (viene del servidor). */
  canStart: boolean;
}

export interface ChecklistItem {
  key:
    | "custody"
    | "vehicle"
    | "location"
    | "gps"
    | "batteryOptimization"
    | "routeDownloaded";
  label: string;
  ok: boolean;
  detail: string;
}

export interface ChecklistEvaluation {
  items: ChecklistItem[];
  /** Todos los items bloqueantes OK (batería es advertencia, no cuenta). */
  canStart: boolean;
  /** Batería <= 20 % — no bloquea, pero hay que avisar (§9.4 "warning, no bloqueante"). */
  batteryLow: boolean;
}

const GPS_THRESHOLD_M = 50;
const BATTERY_WARNING = 0.2;

export function evaluateChecklist(input: ChecklistDeviceInput): ChecklistEvaluation {
  const items: ChecklistItem[] = [
    {
      key: "custody",
      label: "Custodia confirmada",
      ok: input.canStart,
      detail: input.canStart
        ? "Actas sin diferencias"
        : "Custodia pendiente o con diferencias",
    },
    {
      key: "location",
      label: "Permiso de ubicación",
      ok: input.locationPermissionGranted,
      detail: input.locationPermissionGranted
        ? "Permiso en primer plano y background"
        : "Se necesita ubicación (incluido background)",
    },
    {
      key: "gps",
      label: "Precisión GPS",
      ok: input.gpsAccuracyM != null && input.gpsAccuracyM < GPS_THRESHOLD_M,
      detail:
        input.gpsAccuracyM == null
          ? "Sin lectura GPS"
          : `${Math.round(input.gpsAccuracyM)} m de precisión (máx. ${GPS_THRESHOLD_M} m)`,
    },
    {
      key: "batteryOptimization",
      label: "Optimización de batería",
      ok: input.batteryOptimizationDisabled,
      detail: input.batteryOptimizationDisabled
        ? "Desactivada para FYC"
        : "Desactivala en Ajustes → Batería",
    },
    {
      key: "routeDownloaded",
      label: "Ruta descargada",
      ok: input.routeDownloaded,
      detail: input.routeDownloaded
        ? "Completa en este dispositivo"
        : "Descargá la ruta desde Inicio",
    },
  ];

  const blockingOk = items.every((i) => i.ok) && input.canStart;
  const batteryLow = input.batteryLevel != null && input.batteryLevel <= BATTERY_WARNING;

  return {
    items,
    canStart: blockingOk,
    batteryLow,
  };
}
