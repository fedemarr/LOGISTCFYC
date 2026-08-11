import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { syncStatusEnum } from "./enums";
import { users } from "./users";

export const syncQueue = pgTable("sync_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: text("device_id").notNull(),
  userId: uuid("user_id").references(() => users.id),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  operationType: text("operation_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: syncStatusEnum("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  clientTimestamp: timestamp("client_timestamp", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
