import { describe, expect, it } from "vitest";
import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  PreconditionFailedError,
  validateTransition,
} from "../index";
import { FINAL_STATUSES, PACKAGE_STATUSES } from "../statuses";
import { getLegalTransitions, TRANSITIONS } from "../transitions";

function expectOk(result: ReturnType<typeof validateTransition>) {
  expect(result.ok, result.ok ? "" : `esperaba ok, error: ${result.error.message}`).toBe(
    true,
  );
}

function expectError(
  result: ReturnType<typeof validateTransition>,
  ctor: new (...args: never[]) => Error,
) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(ctor);
}

describe("cascada de ingesta y ruteo (staff: admin/dispatcher/warehouse)", () => {
  it.each(["admin", "dispatcher", "warehouse"] as const)(
    "PENDIENTE_RESOLUCION → RECIBIDO permitido para %s",
    (role) => {
      expectOk(validateTransition("PENDIENTE_RESOLUCION", "RECIBIDO", [role]));
    },
  );

  it("PENDIENTE_RESOLUCION → RECIBIDO rechazado para driver", () => {
    expectError(
      validateTransition("PENDIENTE_RESOLUCION", "RECIBIDO", ["driver"]),
      ForbiddenTransitionError,
    );
  });

  it("RECIBIDO → GEOCODIFICADO permitido para warehouse", () => {
    expectOk(validateTransition("RECIBIDO", "GEOCODIFICADO", ["warehouse"]));
  });

  it("GEOCODIFICADO → ASIGNADO permitido para dispatcher", () => {
    expectOk(validateTransition("GEOCODIFICADO", "ASIGNADO", ["dispatcher"]));
  });

  it("ASIGNADO → GEOCODIFICADO (reasignar) permitido para admin", () => {
    expectOk(validateTransition("ASIGNADO", "GEOCODIFICADO", ["admin"]));
  });
});

describe("custodia y reparto — solo el chofer (§3)", () => {
  it("ASIGNADO → CARGADO permitido para driver", () => {
    expectOk(validateTransition("ASIGNADO", "CARGADO", ["driver"]));
  });

  it("ASIGNADO → CARGADO rechazado para admin (la toma de custodia es del chofer)", () => {
    expectError(
      validateTransition("ASIGNADO", "CARGADO", ["admin"]),
      ForbiddenTransitionError,
    );
  });

  it("CARGADO → EN_REPARTO permitido para driver", () => {
    expectOk(validateTransition("CARGADO", "EN_REPARTO", ["driver"]));
  });

  it("EN_REPARTO → EN_DOMICILIO permitido para driver", () => {
    expectOk(validateTransition("EN_REPARTO", "EN_DOMICILIO", ["driver"]));
  });

  it("EN_DOMICILIO → EN_REPARTO (sigue camino) permitido para driver", () => {
    expectOk(validateTransition("EN_DOMICILIO", "EN_REPARTO", ["driver"]));
  });
});

describe("EN_DOMICILIO → ENTREGADO — regla de oro: SOLO el chofer, con evidencia + GPS", () => {
  const withEvidence = { receiverName: "Juan Pérez", gps: { lat: -34.6, lng: -58.4 } };

  it("permitido para driver con evidencia completa", () => {
    expectOk(validateTransition("EN_DOMICILIO", "ENTREGADO", ["driver"], withEvidence));
  });

  it("rechazado para admin aunque tenga la evidencia (nadie más puede marcar ENTREGADO)", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "ENTREGADO", ["admin"], withEvidence),
      ForbiddenTransitionError,
    );
  });

  it("rechazado para dispatcher", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "ENTREGADO", ["dispatcher"], withEvidence),
      ForbiddenTransitionError,
    );
  });

  it("bloqueado sin receiverName", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "ENTREGADO", ["driver"], {
        gps: { lat: 1, lng: 1 },
      }),
      PreconditionFailedError,
    );
  });

  it("bloqueado sin gps", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "ENTREGADO", ["driver"], {
        receiverName: "Juan",
      }),
      PreconditionFailedError,
    );
  });

  it("bloqueado sin metadata en absoluto", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "ENTREGADO", ["driver"]),
      PreconditionFailedError,
    );
  });
});

describe("EN_DOMICILIO → FALLA_REPORTADA — cualquier rol puede reportar (§9.7), foto obligatoria", () => {
  const withReport = { reason: "NO_ONE_HOME", photoUrl: "https://example.com/foto.jpg" };

  it.each(["admin", "dispatcher", "warehouse", "driver"] as const)(
    "permitido para %s con motivo + foto",
    (role) => {
      expectOk(validateTransition("EN_DOMICILIO", "FALLA_REPORTADA", [role], withReport));
    },
  );

  it("bloqueado sin foto (obligatoria, §9.7)", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "FALLA_REPORTADA", ["driver"], {
        reason: "NO_ONE_HOME",
      }),
      PreconditionFailedError,
    );
  });

  it("bloqueado sin motivo", () => {
    expectError(
      validateTransition("EN_DOMICILIO", "FALLA_REPORTADA", ["driver"], {
        photoUrl: "https://example.com/foto.jpg",
      }),
      PreconditionFailedError,
    );
  });
});

describe("FALLA_REPORTADA — resolución exclusiva de Operaciones (admin/dispatcher, §4/§9.7)", () => {
  it.each(["admin", "dispatcher"] as const)(
    "→ REPROGRAMADO permitido para %s",
    (role) => {
      expectOk(validateTransition("FALLA_REPORTADA", "REPROGRAMADO", [role]));
    },
  );

  it.each(["warehouse", "driver"] as const)(
    "→ REPROGRAMADO rechazado para %s",
    (role) => {
      expectError(
        validateTransition("FALLA_REPORTADA", "REPROGRAMADO", [role]),
        ForbiddenTransitionError,
      );
    },
  );

  it("→ DEVUELTO permitido para admin", () => {
    expectOk(validateTransition("FALLA_REPORTADA", "DEVUELTO", ["admin"]));
  });

  it("→ ENTREGADO (excepción) requiere evidencia del chofer", () => {
    expectError(
      validateTransition("FALLA_REPORTADA", "ENTREGADO", ["admin"]),
      PreconditionFailedError,
    );
    expectOk(
      validateTransition("FALLA_REPORTADA", "ENTREGADO", ["admin"], {
        driverEvidencePhotoUrl: "https://example.com/evidencia.jpg",
      }),
    );
  });
});

describe("REPROGRAMADO → GEOCODIFICADO (nuevo día, §4)", () => {
  it("permitido para warehouse", () => {
    expectOk(validateTransition("REPROGRAMADO", "GEOCODIFICADO", ["warehouse"]));
  });
});

describe("DANIADO — mismo abanico de resolución que FALLA_REPORTADA (inferido)", () => {
  it.each(["REPROGRAMADO", "DEVUELTO"] as const)(
    "→ %s permitido para dispatcher",
    (to) => {
      expectOk(validateTransition("DANIADO", to, ["dispatcher"]));
    },
  );

  it("→ ENTREGADO requiere evidencia del chofer", () => {
    expectError(
      validateTransition("DANIADO", "ENTREGADO", ["admin"]),
      PreconditionFailedError,
    );
  });
});

describe("estados de excepción — EXTRAVIADO/DANIADO/CANCELADO (§4)", () => {
  it("PENDIENTE_RESOLUCION → EXTRAVIADO permitido para admin con motivo", () => {
    expectOk(
      validateTransition("PENDIENTE_RESOLUCION", "EXTRAVIADO", ["admin"], {
        reason: "paquete no aparece en el depósito",
      }),
    );
  });

  it("bloqueado sin motivo", () => {
    expectError(
      validateTransition("PENDIENTE_RESOLUCION", "EXTRAVIADO", ["admin"]),
      PreconditionFailedError,
    );
  });

  it("rechazado para warehouse/driver (requiere aprobación de Operaciones, §4)", () => {
    expectError(
      validateTransition("EN_REPARTO", "CANCELADO", ["warehouse"], { reason: "x" }),
      ForbiddenTransitionError,
    );
    expectError(
      validateTransition("EN_REPARTO", "CANCELADO", ["driver"], { reason: "x" }),
      ForbiddenTransitionError,
    );
  });

  it("no se puede ir de un estado de excepción a sí mismo", () => {
    expectError(
      validateTransition("EXTRAVIADO", "EXTRAVIADO", ["admin"], { reason: "x" }),
      IllegalTransitionError,
    );
  });

  it("cualquier estado no-final tiene camino a los 3 estados de excepción", () => {
    const nonFinal = PACKAGE_STATUSES.filter((s) => !FINAL_STATUSES.includes(s));
    for (const from of nonFinal) {
      for (const to of ["EXTRAVIADO", "DANIADO", "CANCELADO"] as const) {
        if (from === to) continue;
        expectOk(validateTransition(from, to, ["admin"], { reason: "test" }));
      }
    }
  });
});

describe("estados finales — irreversibles salvo reapertura por admin (§4)", () => {
  it.each(FINAL_STATUSES)(
    "%s no tiene transiciones salientes para un rol no-admin",
    (from) => {
      expectError(
        validateTransition(from, "GEOCODIFICADO", ["dispatcher"], {
          correctionReason: "x",
        }),
        ForbiddenTransitionError,
      );
    },
  );

  it.each(FINAL_STATUSES)("admin puede reabrir %s con motivo de corrección", (from) => {
    expectOk(
      validateTransition(from, "GEOCODIFICADO", ["admin"], {
        correctionReason: "error de tipeo",
      }),
    );
  });

  it("reapertura bloqueada sin motivo de corrección", () => {
    expectError(
      validateTransition("ENTREGADO", "GEOCODIFICADO", ["admin"]),
      PreconditionFailedError,
    );
  });

  it.each(FINAL_STATUSES)(
    "%s no tiene transiciones hacia otro estado que no sea GEOCODIFICADO",
    (from) => {
      const rules = getLegalTransitions(from);
      // Salvo las que van a GEOCODIFICADO (reapertura) o a otro estado de excepción.
      for (const rule of rules) {
        expect(
          rule.to === "GEOCODIFICADO" ||
            (["EXTRAVIADO", "DANIADO", "CANCELADO"] as const).includes(rule.to as never),
        ).toBe(true);
      }
    },
  );
});

describe("transiciones ilegales genéricas — cualquier par que no esté en la tabla", () => {
  it("PENDIENTE_RESOLUCION → ENTREGADO es ilegal (salto de todo el flujo)", () => {
    expectError(
      validateTransition("PENDIENTE_RESOLUCION", "ENTREGADO", ["admin"]),
      IllegalTransitionError,
    );
  });

  it("CARGADO → ENTREGADO es ilegal (falta pasar por EN_REPARTO/EN_DOMICILIO)", () => {
    expectError(
      validateTransition("CARGADO", "ENTREGADO", ["driver"]),
      IllegalTransitionError,
    );
  });

  it("GEOCODIFICADO → CARGADO es ilegal (falta ASIGNADO)", () => {
    expectError(
      validateTransition("GEOCODIFICADO", "CARGADO", ["driver"]),
      IllegalTransitionError,
    );
  });
});

describe("multi-rol (§3): alcanza con tener uno de los roles permitidos", () => {
  it("un usuario admin+driver puede tomar custodia (rol driver alcanza)", () => {
    expectOk(validateTransition("ASIGNADO", "CARGADO", ["admin", "driver"]));
  });

  it("un usuario admin+dispatcher+warehouse (el dueño, §3) puede hacer todo lo de staff", () => {
    expectOk(
      validateTransition("PENDIENTE_RESOLUCION", "RECIBIDO", [
        "admin",
        "dispatcher",
        "warehouse",
      ]),
    );
  });
});

describe("sanidad de la tabla completa", () => {
  it("no hay reglas duplicadas (mismo from→to repetido)", () => {
    const seen = new Set<string>();
    for (const rule of TRANSITIONS) {
      const key = `${rule.from}->${rule.to}`;
      expect(seen.has(key), `regla duplicada: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("ninguna regla es un self-loop salvo que sea intencional (no debería haber ninguna)", () => {
    for (const rule of TRANSITIONS) {
      expect(rule.from).not.toBe(rule.to);
    }
  });
});
