/**
 * Roles del sistema — fuente única de verdad.
 *
 * PROMPT-MAESTRO §3: "el nombre visible del rol `dispatcher` está definido
 * en un solo lugar. El dueño puede querer llamarlo 'Control', 'Supervisor'
 * o 'Base'. No hardcodear el label en ningún componente."
 *
 * Este archivo vive en `packages/shared` (no en `apps/web`) porque tanto el
 * panel web como la app móvil necesitan conocer los roles y sus labels
 * (p. ej. la app del chofer muestra "asignado por Operaciones/Control").
 * `apps/web/src/lib/constants/roles.ts` re-exporta este módulo para
 * respetar la ruta que menciona el documento sin duplicar la fuente.
 */

/** Roles internos tal como se persisten en `user_roles.role` (Postgres enum). */
export const ROLES = ["admin", "dispatcher", "warehouse", "driver"] as const;

export type Role = (typeof ROLES)[number];

/**
 * ⚙️ PARÁMETRO EDITABLE: nombre visible del rol `dispatcher`.
 * Cambiar solo este valor para renombrarlo en toda la app (ej: "Control").
 */
const DISPATCHER_LABEL = "Operaciones";

/** Nombres en pantalla por rol. Nunca hardcodear estos strings en un componente. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  dispatcher: DISPATCHER_LABEL,
  warehouse: "Depósito",
  driver: "Chofer",
};

/** Un usuario puede tener múltiples roles simultáneos desde el día 1 (§3). */
export type UserRoles = readonly Role[];

export function hasRole(userRoles: UserRoles, role: Role): boolean {
  return userRoles.includes(role);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
