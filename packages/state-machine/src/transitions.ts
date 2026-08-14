import type { Role } from "@fyc/shared";
import { EXCEPTION_STATUSES, FINAL_STATUSES, type PackageStatus } from "./statuses";
import {
  type Precondition,
  requireCorrectionReason,
  requireDeliveryEvidence,
  requireDriverEvidenceOverride,
  requireExceptionReason,
  requireIncidentReport,
} from "./preconditions";

export interface TransitionRule {
  from: PackageStatus;
  to: PackageStatus;
  /** Alcanza con tener UNO de estos roles (un usuario puede tener varios, §3). */
  allowedRoles: readonly Role[];
  precondition?: Precondition;
}

const STAFF: readonly Role[] = ["admin", "dispatcher", "warehouse"];
const APPROVERS: readonly Role[] = ["admin", "dispatcher"];
const ALL_ROLES: readonly Role[] = ["admin", "dispatcher", "warehouse", "driver"];

/**
 * Tabla de transiciones legales — reflejo exacto del diagrama de §4 +
 * matriz de permisos de §3. Cualquier par (from, to) que no esté acá es
 * ilegal, sin excepción.
 */
const CORE_TRANSITIONS: readonly TransitionRule[] = [
  // Ingesta y resolución (§2, §9.1) — admin/dispatcher/warehouse.
  { from: "PENDIENTE_RESOLUCION", to: "RECIBIDO", allowedRoles: STAFF },
  { from: "RECIBIDO", to: "GEOCODIFICADO", allowedRoles: STAFF },

  // Ruteo (§8, §9.2) — admin/dispatcher/warehouse.
  { from: "GEOCODIFICADO", to: "ASIGNADO", allowedRoles: STAFF },
  { from: "ASIGNADO", to: "GEOCODIFICADO", allowedRoles: STAFF }, // reasignar

  // Custodia y reparto (§9.3, §9.4, §9.5) — el chofer.
  { from: "ASIGNADO", to: "CARGADO", allowedRoles: ["driver"] },
  { from: "CARGADO", to: "EN_REPARTO", allowedRoles: ["driver"] },
  { from: "EN_REPARTO", to: "EN_DOMICILIO", allowedRoles: ["driver"] },
  { from: "EN_DOMICILIO", to: "EN_REPARTO", allowedRoles: ["driver"] }, // sigue camino

  // Entrega — regla de oro §3: SOLO el chofer marca ENTREGADO.
  {
    from: "EN_DOMICILIO",
    to: "ENTREGADO",
    allowedRoles: ["driver"],
    precondition: requireDeliveryEvidence,
  },

  // Incidencia (§9.7) — cualquier rol puede reportar.
  {
    from: "EN_DOMICILIO",
    to: "FALLA_REPORTADA",
    allowedRoles: ALL_ROLES,
    precondition: requireIncidentReport,
  },

  // Resolución de la incidencia — "decide Operaciones" (§4, §9.7): admin/dispatcher.
  { from: "FALLA_REPORTADA", to: "REPROGRAMADO", allowedRoles: APPROVERS },
  { from: "FALLA_REPORTADA", to: "DEVUELTO", allowedRoles: APPROVERS },
  {
    from: "FALLA_REPORTADA",
    to: "ENTREGADO",
    allowedRoles: APPROVERS,
    precondition: requireDriverEvidenceOverride,
  },
  // RETRY_NOW (§9.7): el chofer reintenta HOY — la parada vuelve a la secuencia
  // activa (route_stops PENDING) y el paquete a EN_REPARTO en la misma ruta.
  { from: "FALLA_REPORTADA", to: "EN_REPARTO", allowedRoles: APPROVERS },

  // Reprogramado → nuevo día de reparto (§4).
  { from: "REPROGRAMADO", to: "GEOCODIFICADO", allowedRoles: STAFF },

  // DANIADO no es final (§4): mismo abanico de resolución que FALLA_REPORTADA
  // (inferido — el documento no lo detalla explícitamente, ver docs/DECISIONES.md).
  { from: "DANIADO", to: "REPROGRAMADO", allowedRoles: APPROVERS },
  { from: "DANIADO", to: "DEVUELTO", allowedRoles: APPROVERS },
  {
    from: "DANIADO",
    to: "ENTREGADO",
    allowedRoles: APPROVERS,
    precondition: requireDriverEvidenceOverride,
  },
];

/**
 * Estados de excepción (§4): "desde casi cualquier estado, requieren
 * aprobación". Se generan automáticamente desde todo estado no-final hacia
 * cada uno de EXTRAVIADO/DANIADO/CANCELADO — admin/dispatcher, con motivo.
 */
const NON_FINAL_STATUSES = (
  [
    "PENDIENTE_RESOLUCION",
    "RECIBIDO",
    "GEOCODIFICADO",
    "ASIGNADO",
    "CARGADO",
    "EN_REPARTO",
    "EN_DOMICILIO",
    "FALLA_REPORTADA",
    "REPROGRAMADO",
    "DANIADO",
  ] as const satisfies readonly PackageStatus[]
).filter((s) => !FINAL_STATUSES.includes(s));

const EXCEPTION_TRANSITIONS: readonly TransitionRule[] = NON_FINAL_STATUSES.flatMap(
  (from) =>
    EXCEPTION_STATUSES.filter((to) => to !== from).map((to): TransitionRule => ({
      from,
      to,
      allowedRoles: APPROVERS,
      precondition: requireExceptionReason,
    })),
);

/**
 * Reapertura de estados finales (§4: "solo un admin puede reabrirlos y
 * queda registrado como evento de corrección"). El documento no dice a qué
 * estado vuelve — se define GEOCODIFICADO como reinicio seguro del proceso
 * de reparto (inferido, ver docs/DECISIONES.md).
 */
const REOPEN_TRANSITIONS: readonly TransitionRule[] = FINAL_STATUSES.map(
  (from): TransitionRule => ({
    from,
    to: "GEOCODIFICADO",
    allowedRoles: ["admin"],
    precondition: requireCorrectionReason,
  }),
);

export const TRANSITIONS: readonly TransitionRule[] = [
  ...CORE_TRANSITIONS,
  ...EXCEPTION_TRANSITIONS,
  ...REOPEN_TRANSITIONS,
];

export function findTransitionRule(
  from: PackageStatus,
  to: PackageStatus,
): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
}

export function getLegalTransitions(from: PackageStatus): readonly TransitionRule[] {
  return TRANSITIONS.filter((rule) => rule.from === from);
}
