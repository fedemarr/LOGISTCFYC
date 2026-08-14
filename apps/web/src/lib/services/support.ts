/**
 * MÓDULO DE SOPORTE / TICKETS — PROMPT-MAESTRO §7 (FASE 12).
 *
 * `support_tickets` + `ticket_messages` (ver `db/schema/support.ts`): el
 * chofer abre un ticket desde la app (o el staff desde el panel) y ambos
 * lados chatean en el hilo. RLS ya existe desde FASE 2 — el staff ve
 * todos los de su org, el chofer solo los suyos.
 *
 * Escrituras de estado:
 *   - El STAFF (admin/dispatcher) crea tickets, cambia status/prioridad y
 *     asigna; puede responder en cualquier hilo de la org.
 *   - El CHOFER abre tickets y responde en los suyos; NO cambia status
 *     (eso lo cierra staff) — inferido del RLS y del rol pasivo de la
 *     matriz de §3.
 * Los mensajes son append-only (solo INSERT, sin UPDATE/DELETE en RLS).
 */
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import {
  packages,
  supportTickets,
  ticketMessages,
  userRoles,
  users,
} from "@/lib/db/schema";
import { logDomainEvent } from "./events";

export type TicketCategory =
  "GENERAL" | "TECHNICAL" | "PAYMENT" | "ROUTE" | "VEHICLE" | "OTHER";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface CreateTicketInput {
  category: TicketCategory;
  subject: string;
  message: string;
  priority?: TicketPriority;
  packageId?: string;
  routeId?: string;
  driverId?: string;
}

export interface TicketListItem {
  id: string;
  ticketNumber: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  driverName: string | null;
  packageCode: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
}

export interface TicketMessageItem {
  id: string;
  ticketId: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  message: string;
  attachmentUrl: string | null;
  createdAt: string;
}

export interface TicketDetail {
  id: string;
  ticketNumber: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  driverName: string | null;
  assignedToName: string | null;
  packageCode: string | null;
  routeNumber: number | null;
  createdAt: string;
  closedAt: string | null;
  messages: TicketMessageItem[];
}

/** Número de ticket legible y único por org: TK-<yyyy>-<seq> */
async function nextTicketNumber(orgId: string): Promise<string> {
  const rows = await db
    .select({ n: count() })
    .from(supportTickets)
    .where(eq(supportTickets.orgId, orgId));
  const n = rows[0]?.n ?? 0;
  return `TK-${new Date().getFullYear()}-${String(n + 1).padStart(4, "0")}`;
}

/** ¿Este usuario (chofer) es dueño del ticket? — para chequear RLS a mano. */
async function isTicketOwner(
  orgId: string,
  ticketId: string,
  driverId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.id, ticketId),
        eq(supportTickets.orgId, orgId),
        eq(supportTickets.driverId, driverId),
      ),
    );
  return rows.length > 0;
}

/** Crea un ticket con su primer mensaje en el hilo (todo atómico + evento). */
export async function createTicket(
  orgId: string,
  input: CreateTicketInput,
  actor: { userId: string; roles: readonly string[] },
): Promise<{ id: string; ticketNumber: string }> {
  const isStaff = actor.roles.some((r) => r === "admin" || r === "dispatcher");

  if (!isStaff && !input.driverId) {
    throw Errors.forbidden("un chofer solo puede abrir tickets a su nombre");
  }
  if (!input.subject.trim()) throw Errors.validation("el asunto es obligatorio");
  if (!input.message.trim()) throw Errors.validation("el primer mensaje es obligatorio");

  if (input.packageId) {
    const [pkg] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(and(eq(packages.id, input.packageId), eq(packages.orgId, orgId)));
    if (!pkg) throw Errors.notFound("el paquete no existe en tu organización");
  }

  const ticketNumber = await nextTicketNumber(orgId);
  const driverId = isStaff ? (input.driverId ?? null) : actor.userId;

  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        orgId,
        ticketNumber,
        driverId,
        packageId: input.packageId ?? null,
        routeId: input.routeId ?? null,
        category: input.category,
        subject: input.subject.trim(),
        status: "OPEN",
        priority: input.priority ?? "MEDIUM",
      })
      .returning({ id: supportTickets.id });

    if (!ticket) throw Errors.internal("no se pudo crear el ticket");

    await tx.insert(ticketMessages).values({
      ticketId: ticket.id,
      userId: actor.userId,
      message: input.message.trim(),
    });

    await logDomainEvent(
      {
        orgId,
        entityType: "OPERATION",
        entityId: ticket.id,
        eventType: "TICKET_CREATED",
        actorId: actor.userId,
        actorRole: actor.roles.join(","),
        toStatus: "OPEN",
        metadata: {
          ticketNumber,
          category: input.category,
          subject: input.subject.trim(),
        },
      },
      tx,
    );

    return { id: ticket.id, ticketNumber };
  });
}

/** Lista paginada de tickets de la org (staff) o propios (chofer). */
export async function listTickets(params: {
  orgId: string;
  actor: { userId: string; roles: readonly string[] };
  page: number;
  pageSize: number;
  search?: string;
  status?: TicketStatus;
}): Promise<{ items: TicketListItem[]; total: number }> {
  const { orgId, actor, page, pageSize, search, status } = params;
  const isStaff = actor.roles.some((r) => r === "admin" || r === "dispatcher");

  const where = and(
    eq(supportTickets.orgId, orgId),
    ...(isStaff ? [] : [eq(supportTickets.driverId, actor.userId)]),
    ...(search?.trim() ? [ilike(supportTickets.subject, `%${search.trim()}%`)] : []),
    ...(status ? [eq(supportTickets.status, status)] : []),
  );

  const totalRows = await db.select({ total: count() }).from(supportTickets).where(where);
  const total = totalRows[0]?.total ?? 0;

  const rows = await db
    .select({
      id: supportTickets.id,
      ticketNumber: supportTickets.ticketNumber,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      driverName: users.fullName,
      packageCode: packages.internalCode,
      createdAt: supportTickets.createdAt,
      lastMessageAt: sql<string>`(
        select max(m.created_at)::text
        from ticket_messages m
        where m.ticket_id = ${supportTickets.id}
      )`.as("last_message_at"),
      messageCount: sql<number>`(
        select count(*) from ticket_messages m where m.ticket_id = ${supportTickets.id}
      )`.as("message_count"),
    })
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.driverId))
    .leftJoin(packages, eq(packages.id, supportTickets.packageId))
    .where(where)
    .orderBy(desc(supportTickets.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => ({
      id: r.id,
      ticketNumber: r.ticketNumber,
      category: r.category,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      driverName: r.driverName,
      packageCode: r.packageCode,
      createdAt: r.createdAt.toISOString(),
      lastMessageAt: r.lastMessageAt,
      messageCount: Number(r.messageCount ?? 0),
    })),
    total,
  };
}

/** Detalle del ticket con el hilo completo de mensajes. */
export async function getTicket(
  orgId: string,
  ticketId: string,
  actor: { userId: string; roles: readonly string[] },
): Promise<TicketDetail> {
  const isStaff = actor.roles.some((r) => r === "admin" || r === "dispatcher");
  const assigned = alias(users, "assigned");

  const [ticket] = await db
    .select({
      id: supportTickets.id,
      ticketNumber: supportTickets.ticketNumber,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      priority: supportTickets.priority,
      driverName: users.fullName,
      assignedToName: assigned.fullName,
      packageCode: packages.internalCode,
      createdAt: supportTickets.createdAt,
      closedAt: supportTickets.closedAt,
    })
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.driverId))
    .leftJoin(assigned, eq(assigned.id, supportTickets.assignedTo))
    .leftJoin(packages, eq(packages.id, supportTickets.packageId))
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.orgId, orgId)));

  if (!ticket) throw Errors.notFound("el ticket no existe en tu organización");
  if (!isStaff && !(await isTicketOwner(orgId, ticketId, actor.userId))) {
    throw Errors.forbidden("no podés ver el ticket de otro chofer");
  }

  const messages = await db
    .select({
      id: ticketMessages.id,
      ticketId: ticketMessages.ticketId,
      userId: ticketMessages.userId,
      userName: users.fullName,
      userRole: userRoles.role,
      message: ticketMessages.message,
      attachmentUrl: ticketMessages.attachmentUrl,
      createdAt: ticketMessages.createdAt,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.userId))
    .leftJoin(userRoles, eq(userRoles.userId, ticketMessages.userId))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt));

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    driverName: ticket.driverName,
    assignedToName: ticket.assignedToName,
    packageCode: ticket.packageCode,
    routeNumber: null,
    createdAt: ticket.createdAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      ticketId: m.ticketId,
      userId: m.userId,
      userName: m.userName,
      userRole: m.userRole,
      message: m.message,
      attachmentUrl: m.attachmentUrl,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/** Agrega un mensaje al hilo. El chofer solo en sus tickets; staff en todos. */
export async function postTicketMessage(
  orgId: string,
  ticketId: string,
  message: string,
  actor: { userId: string; roles: readonly string[] },
): Promise<{ id: string }> {
  const isStaff = actor.roles.some((r) => r === "admin" || r === "dispatcher");

  if (!message.trim()) throw Errors.validation("el mensaje no puede estar vacío");

  const [ticket] = await db
    .select({ id: supportTickets.id, status: supportTickets.status })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.orgId, orgId)));

  if (!ticket) throw Errors.notFound("el ticket no existe en tu organización");
  if (!isStaff && !(await isTicketOwner(orgId, ticketId, actor.userId))) {
    throw Errors.forbidden("no podés responder el ticket de otro chofer");
  }
  if (ticket.status === "CLOSED") {
    throw Errors.conflict("el ticket está cerrado — no se pueden agregar mensajes");
  }

  const [msg] = await db
    .insert(ticketMessages)
    .values({ ticketId, userId: actor.userId, message: message.trim() })
    .returning({ id: ticketMessages.id });

  if (!msg) throw Errors.internal("no se pudo guardar el mensaje");
  return { id: msg.id };
}

/** Cambia estado/prioridad/asignación del ticket. Solo staff. */
export async function updateTicket(
  orgId: string,
  ticketId: string,
  changes: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignedTo?: string | null;
  },
  actor: { userId: string; roles: readonly string[] },
): Promise<{ id: string }> {
  const isStaff = actor.roles.some((r) => r === "admin" || r === "dispatcher");
  if (!isStaff) throw Errors.forbidden("solo admin/dispatcher puede cambiar un ticket");

  const [ticket] = await db
    .select({ id: supportTickets.id, status: supportTickets.status })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.orgId, orgId)));

  if (!ticket) throw Errors.notFound("el ticket no existe en tu organización");

  await db.transaction(async (tx) => {
    await tx
      .update(supportTickets)
      .set({
        ...(changes.status ? { status: changes.status } : {}),
        ...(changes.status === "CLOSED" ? { closedAt: new Date() } : {}),
        ...(changes.status === "OPEN" ? { closedAt: null } : {}),
        ...(changes.priority ? { priority: changes.priority } : {}),
        ...(changes.assignedTo !== undefined ? { assignedTo: changes.assignedTo } : {}),
      })
      .where(eq(supportTickets.id, ticketId));

    await logDomainEvent(
      {
        orgId,
        entityType: "OPERATION",
        entityId: ticketId,
        eventType: "TICKET_UPDATED",
        actorId: actor.userId,
        actorRole: actor.roles.join(","),
        fromStatus: ticket.status,
        toStatus: changes.status ?? ticket.status,
        metadata: { ...(changes.priority ? { priority: changes.priority } : {}) },
      },
      tx,
    );
  });

  return { id: ticketId };
}
