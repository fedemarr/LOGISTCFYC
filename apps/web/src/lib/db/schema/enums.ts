import { pgEnum } from "drizzle-orm/pg-core";

/**
 * ⚠️ Estos dos arrays son copias literales de `PACKAGE_STATUSES`
 * (@fyc/state-machine) y `ROLES` (@fyc/shared) — la fuente de
 * verdad real sigue siendo esa, NO este archivo.
 *
 * No se importan directamente porque el bundler de `drizzle-kit` (esbuild
 * vía `@esbuild-kit/*`) no interopera bien con paquetes del workspace
 * pnpm cuyo `exports` apunta a TypeScript fuente: la importación resuelve
 * a `undefined` en tiempo de `drizzle-kit generate` (aunque funciona
 * perfecto en Next.js/tsx/vitest). Se comprueba que no se desincronicen con
 * un test dedicado: `apps/web/src/lib/db/schema/__tests__/enums-sync.test.ts`.
 * Ver docs/DECISIONES.md ADR-014.
 */
const PACKAGE_STATUSES_MIRROR = [
  "PENDIENTE_RESOLUCION",
  "RECIBIDO",
  "GEOCODIFICADO",
  "ASIGNADO",
  "CARGADO",
  "EN_REPARTO",
  "EN_DOMICILIO",
  "ENTREGADO",
  "FALLA_REPORTADA",
  "REPROGRAMADO",
  "DEVUELTO",
  "EXTRAVIADO",
  "DANIADO",
  "CANCELADO",
] as const;

const ROLES_MIRROR = ["admin", "dispatcher", "warehouse", "driver"] as const;

export const packageStatusEnum = pgEnum("package_status", PACKAGE_STATUSES_MIRROR);

export const userRoleEnum = pgEnum("user_role", ROLES_MIRROR);

export const operationStatusEnum = pgEnum("operation_status", ["OPEN", "CLOSED"]);

export const geocodeAccuracyEnum = pgEnum("geocode_accuracy", [
  "ROOFTOP",
  "INTERPOLATED",
  "APPROXIMATE",
  "MANUAL",
  "FAILED",
]);

export const destinationSourceEnum = pgEnum("destination_source", [
  "MANIFEST",
  "BARCODE_PAYLOAD",
  "OCR",
  "MANUAL",
  "ADDRESS_MEMORY",
]);

export const destinationConfidenceEnum = pgEnum("destination_confidence", [
  "HIGH",
  "MEDIUM",
  "LOW",
]);

export const codeFormatEnum = pgEnum("code_format", [
  "QR",
  "CODE_128",
  "CODE_39",
  "PDF417",
  "DATA_MATRIX",
  "EAN_13",
  "OTHER",
  "MANUAL",
]);

export const scanContextEnum = pgEnum("scan_context", [
  "INTAKE",
  "SORTING",
  "LOADING",
  "DELIVERY",
  "AUDIT",
]);

export const containerTypeEnum = pgEnum("container_type", [
  "BAG",
  "CART",
  "CAGE",
  "SHELF",
]);

export const routeStatusEnum = pgEnum("route_status", [
  "DRAFT",
  "PROPOSED",
  "APPROVED",
  "ASSIGNED",
  "LOADING",
  "LOADED",
  "IN_TRANSIT",
  "COMPLETED",
  "CANCELLED",
]);

export const routeStopStatusEnum = pgEnum("route_stop_status", [
  "PENDING",
  "ARRIVED",
  "COMPLETED",
  "SKIPPED",
  "FAILED",
]);

export const custodyMethodEnum = pgEnum("custody_method", ["COUNT", "FULL_SCAN"]);

export const custodyStatusEnum = pgEnum("custody_status", [
  "OK",
  "DISCREPANCY",
  "RESOLVED",
  "OVERRIDDEN",
]);

export const deliveryOutcomeEnum = pgEnum("delivery_outcome", ["DELIVERED", "FAILED"]);

export const incidentReasonEnum = pgEnum("incident_reason", [
  "NO_ONE_HOME",
  "NO_ANSWER",
  "WRONG_ADDRESS",
  "NONEXISTENT_ADDRESS",
  "REFUSED",
  "NO_ACCESS",
  "UNSAFE_AREA",
  "VEHICLE_ISSUE",
  "DAMAGED",
  "MISSING_BULK",
  "OTHER",
]);

export const incidentStatusEnum = pgEnum("incident_status", [
  "OPEN",
  "ASSIGNED",
  "RESOLVED",
  "ESCALATED",
]);

export const incidentResolutionEnum = pgEnum("incident_resolution", [
  "RETRY_NOW",
  "RESCHEDULE",
  "RETURN",
  "DELIVER_ANYWAY",
  "CANCEL",
]);

/**
 * PROMPT-MAESTRO §7 dice "category (enum)" / "status" / "priority" para
 * support_tickets sin listar los valores — no están definidos en el
 * documento. Set mínimo razonable, a confirmar con el dueño del producto
 * (ver docs/DECISIONES.md ADR-013).
 */
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "GENERAL",
  "TECHNICAL",
  "PAYMENT",
  "ROUTE",
  "VEHICLE",
  "OTHER",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
]);

export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "AVAILABLE",
  "IN_ROUTE",
  "MAINTENANCE",
  "OUT_OF_SERVICE",
]);

export const eventEntityTypeEnum = pgEnum("event_entity_type", [
  "PACKAGE",
  "ROUTE",
  "DELIVERY",
  "INCIDENT",
  "CUSTODY",
  "USER",
  "VEHICLE",
  "OPERATION",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CONFLICT",
]);
