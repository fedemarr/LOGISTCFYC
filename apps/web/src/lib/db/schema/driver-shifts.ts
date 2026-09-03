import {
  boolean,
  jsonb,
  pgTable,
  integer,
  text,
  timestamp,
  uuid,
  date,
} from "drizzle-orm/pg-core";
import { shiftStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";
import { zones } from "./zones";

/**
 * Turno de un chofer en un día (FYM). El chofer arranca el turno desde el
 * depósito: entra la cantidad de paquetes con la que sale (+ una captura
 * de Flex como evidencia, pedido de Fede — "pago x paquete"), la zona que
 * le tocó, y se activa el GPS. Arranca en `PENDING` hasta que la IA (o,
 * si no está segura, alguien del depósito) confirma que la cantidad
 * declarada es real — recién ahí pasa a `ACTIVE` y corre la geocerca.
 * Durante el turno reporta avances cada 2-3 h (`shift_reports`). Al
 * terminar carga cuántos entregó de verdad y la hora de fin.
 */
export const driverShifts = pgTable("driver_shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  driverId: uuid("driver_id")
    .notNull()
    .references(() => users.id),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => zones.id),
  /** Fecha del día de reparto (timezone de la org). */
  shiftDate: date("shift_date").notNull(),
  /** Cantidad de paquetes con la que salió del depósito (declarada). */
  packageCount: integer("package_count").notNull(),
  status: shiftStatusEnum("status").notNull().default("PENDING"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /** Paquetes que quedaron sin repartir al cerrar el turno. */
  undeliveredCount: integer("undelivered_count"),
  notes: text("notes"),
  /** Path dentro del bucket privado `flex-screenshots` (no una URL — se
   * firma al vuelo cuando el panel necesita mostrarla). */
  flexScreenshotPath: text("flex_screenshot_path"),
  /** Quién confirmó el turno a mano (null si lo confirmó la IA sola). */
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  aiConfirmed: boolean("ai_confirmed").notNull().default(false),
  /** Lectura cruda de la IA (cantidad detectada, confianza, motivo) —
   * auditoría para cuando haya dudas después. */
  aiAnalysis: jsonb("ai_analysis").$type<{
    detectedCount: number | null;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  } | null>(),
  /** El admin/despachante pre-armó este turno (zona + paquetes) para el
   * chofer en vez de que lo declare él — pedido de Fede: "que el admin
   * pueda pre-armar el turno". Arranca igual en PENDING, pero sin
   * captura de Flex ni confirmación de IA/depósito: el chofer solo tiene
   * que tocar "Iniciar" (`startAssignedShift`) para pasar a ACTIVE. */
  assignedByAdmin: boolean("assigned_by_admin").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const driverShiftsToSelect = {
  id: driverShifts.id,
  orgId: driverShifts.orgId,
  driverId: driverShifts.driverId,
  zoneId: driverShifts.zoneId,
  shiftDate: driverShifts.shiftDate,
  packageCount: driverShifts.packageCount,
  status: driverShifts.status,
  startedAt: driverShifts.startedAt,
  endedAt: driverShifts.endedAt,
  undeliveredCount: driverShifts.undeliveredCount,
  notes: driverShifts.notes,
  flexScreenshotPath: driverShifts.flexScreenshotPath,
  confirmedBy: driverShifts.confirmedBy,
  confirmedAt: driverShifts.confirmedAt,
  aiConfirmed: driverShifts.aiConfirmed,
  aiAnalysis: driverShifts.aiAnalysis,
  assignedByAdmin: driverShifts.assignedByAdmin,
} as const;

export type DriverShift = typeof driverShifts.$inferSelect;
export type NewDriverShift = typeof driverShifts.$inferInsert;
