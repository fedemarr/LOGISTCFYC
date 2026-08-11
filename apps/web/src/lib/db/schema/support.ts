import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ticketCategoryEnum, ticketPriorityEnum, ticketStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";
import { packages } from "./packages";
import { routes } from "./routes";

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  ticketNumber: text("ticket_number").notNull().unique(),
  driverId: uuid("driver_id").references(() => users.id),
  packageId: uuid("package_id").references(() => packages.id),
  routeId: uuid("route_id").references(() => routes.id),
  category: ticketCategoryEnum("category").notNull().default("GENERAL"),
  subject: text("subject").notNull(),
  status: ticketStatusEnum("status").notNull().default("OPEN"),
  priority: ticketPriorityEnum("priority").notNull().default("MEDIUM"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => supportTickets.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  message: text("message").notNull(),
  attachmentUrl: text("attachment_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
