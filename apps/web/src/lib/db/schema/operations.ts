import {
  date,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { operationStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";

export const operations = pgTable(
  "operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    operationDate: date("operation_date").notNull(),
    status: operationStatusEnum("status").notNull().default("OPEN"),
    expectedCount: integer("expected_count").notNull().default(0),
    receivedCount: integer("received_count").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("operations_org_id_operation_date_key").on(table.orgId, table.operationDate),
  ],
);
