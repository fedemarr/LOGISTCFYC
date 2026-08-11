import {
  date,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { vehicleStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";

export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  plate: text("plate").notNull().unique(),
  brand: text("brand"),
  model: text("model"),
  year: integer("year"),
  capacityPackages: integer("capacity_packages"),
  capacityM3: doublePrecision("capacity_m3"),
  capacityKg: doublePrecision("capacity_kg"),
  status: vehicleStatusEnum("status").notNull().default("AVAILABLE"),
  currentOdometer: integer("current_odometer"),
  insuranceExpiry: date("insurance_expiry"),
  vtvExpiry: date("vtv_expiry"),
  assignedDriverId: uuid("assigned_driver_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
