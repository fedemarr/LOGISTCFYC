/**
 * CONTROL DE SALIDA DEL CHOFER — pedido explícito de Fede (no está en el
 * documento madre): además de loguearse en la app, depósito escanea el QR
 * personal del chofer (`identificacion.tsx`, `@fyc/shared#driverQrPayload`)
 * antes de que salga con la ruta cargada — mismo espíritu que el chequeo de
 * custodia (§9.3) pero para la PERSONA, no los bultos.
 *
 * Deliberadamente NO bloquea nada del lado del servidor (no impide
 * `startRoute` si no hubo check-in) — es un registro/auditoría, no un
 * gate más. Agregar un gate real implica decidir qué pasa si depósito se
 * olvida de escanear a alguien con la ruta ya en curso, y esa es una
 * decisión operativa que le corresponde a Fede, no algo para inventar acá
 * (mismo criterio de "no sobreingeniería" de ADR-017/033).
 */
import { eq } from "drizzle-orm";
import { parseDriverQrPayload, type Role } from "@fyc/shared";
import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { userRoles, users } from "@/lib/db/schema";
import { logDomainEvent } from "./events";

export interface DriverCheckInResult {
  driverId: string;
  driverName: string;
  occurredAt: string;
}

export async function checkInDriver(
  orgId: string,
  rawCode: string,
  actor: { userId: string; roles: readonly Role[] },
): Promise<DriverCheckInResult> {
  const driverId = parseDriverQrPayload(rawCode);
  if (!driverId) {
    throw Errors.validation("ese código no es un QR de chofer de FYC");
  }

  const [driver] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      orgId: users.orgId,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, driverId));
  if (!driver || driver.orgId !== orgId) {
    throw Errors.notFound("chofer no encontrado");
  }
  if (!driver.isActive) {
    throw Errors.conflict("este chofer está dado de baja");
  }

  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, driverId));
  if (!roles.some((r) => r.role === "driver")) {
    throw Errors.validation("este usuario no tiene rol de chofer");
  }

  const occurredAt = new Date();
  await db.transaction(async (tx) => {
    await logDomainEvent(
      {
        orgId,
        entityType: "USER",
        entityId: driverId,
        eventType: "DRIVER_CHECKED_IN",
        actorId: actor.userId,
        actorRole: actor.roles.join(","),
        metadata: { scannedBy: actor.userId },
        occurredAt,
      },
      tx,
    );
  });

  return { driverId, driverName: driver.fullName, occurredAt: occurredAt.toISOString() };
}
