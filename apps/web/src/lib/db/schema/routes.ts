import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { routeStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { operations } from "./operations";
import { containers } from "./containers";
import { users } from "./users";
import { vehicles } from "./vehicles";

export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  operationId: uuid("operation_id")
    .notNull()
    .references(() => operations.id),
  routeNumber: integer("route_number").notNull(),
  containerId: uuid("container_id").references(() => containers.id),
  status: routeStatusEnum("status").notNull().default("DRAFT"),
  assignedDriverId: uuid("assigned_driver_id").references(() => users.id),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id),
  plannedDistanceM: doublePrecision("planned_distance_m"),
  plannedDurationS: integer("planned_duration_s"),
  plannedStops: integer("planned_stops"),
  actualDistanceM: doublePrecision("actual_distance_m"),
  actualDurationS: integer("actual_duration_s"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  zoneLabel: text("zone_label"),
  colorHex: text("color_hex"),
  optimizationMetadata: jsonb("optimization_metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
