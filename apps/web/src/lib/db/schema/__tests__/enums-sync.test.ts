import { describe, expect, it } from "vitest";
import { PACKAGE_STATUSES } from "@lastmile/state-machine";
import { ROLES } from "@lastmile/shared";
import { packageStatusEnum, userRoleEnum } from "../enums";

/**
 * Los enums de Postgres en `enums.ts` son copias literales (ver comentario
 * ahí y ADR-014) porque drizzle-kit no puede importar paquetes del
 * workspace directamente. Este test es la red de seguridad: si alguien
 * agrega/renombra un estado o un rol en la fuente de verdad y se olvida de
 * actualizar el mirror, esto falla en CI.
 */
describe("enums de Postgres sincronizados con la fuente de verdad", () => {
  it("package_status coincide con @lastmile/state-machine PACKAGE_STATUSES", () => {
    expect(packageStatusEnum.enumValues).toEqual(PACKAGE_STATUSES);
  });

  it("user_role coincide con @lastmile/shared ROLES", () => {
    expect(userRoleEnum.enumValues).toEqual(ROLES);
  });
});
