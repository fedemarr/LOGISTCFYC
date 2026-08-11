import { describe, expect, it } from "vitest";
import { PACKAGE_STATUSES } from "@fyc/state-machine";
import { ROLES } from "@fyc/shared";
import { packageStatusEnum, userRoleEnum } from "../enums";

/**
 * Los enums de Postgres en `enums.ts` son copias literales (ver comentario
 * ahí y ADR-014) porque drizzle-kit no puede importar paquetes del
 * workspace directamente. Este test es la red de seguridad: si alguien
 * agrega/renombra un estado o un rol en la fuente de verdad y se olvida de
 * actualizar el mirror, esto falla en CI.
 */
describe("enums de Postgres sincronizados con la fuente de verdad", () => {
  it("package_status coincide con @fyc/state-machine PACKAGE_STATUSES", () => {
    expect(packageStatusEnum.enumValues).toEqual(PACKAGE_STATUSES);
  });

  it("user_role coincide con @fyc/shared ROLES", () => {
    expect(userRoleEnum.enumValues).toEqual(ROLES);
  });
});
