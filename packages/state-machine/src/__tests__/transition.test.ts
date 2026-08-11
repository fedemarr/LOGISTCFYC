import { describe, expect, it, vi } from "vitest";
import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  transition,
  type TransitionDeps,
} from "../index";

function makeDeps(currentStatus: string, eventId = "evt_1"): TransitionDeps {
  return {
    getCurrentStatus: vi.fn().mockResolvedValue(currentStatus),
    applyTransition: vi.fn().mockResolvedValue({ eventId }),
  };
}

describe("transition() — orquestador con inyección de dependencias", () => {
  it("aplica la transición cuando es legal y devuelve el resultado", async () => {
    const deps = makeDeps("PENDIENTE_RESOLUCION");

    const result = await transition(
      {
        packageId: "pkg_1",
        toStatus: "RECIBIDO",
        actorId: "user_1",
        actorRoles: ["warehouse"],
      },
      deps,
    );

    expect(result).toEqual({
      packageId: "pkg_1",
      fromStatus: "PENDIENTE_RESOLUCION",
      toStatus: "RECIBIDO",
      eventId: "evt_1",
    });
    expect(deps.getCurrentStatus).toHaveBeenCalledWith("pkg_1");
    expect(deps.applyTransition).toHaveBeenCalledWith({
      packageId: "pkg_1",
      fromStatus: "PENDIENTE_RESOLUCION",
      toStatus: "RECIBIDO",
      actorId: "user_1",
      actorRoles: ["warehouse"],
      metadata: {},
    });
  });

  it("NO llama a applyTransition si la transición es ilegal", async () => {
    const deps = makeDeps("PENDIENTE_RESOLUCION");

    await expect(
      transition(
        {
          packageId: "pkg_1",
          toStatus: "ENTREGADO",
          actorId: "u1",
          actorRoles: ["admin"],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    expect(deps.applyTransition).not.toHaveBeenCalled();
  });

  it("NO llama a applyTransition si el rol no está permitido", async () => {
    const deps = makeDeps("ASIGNADO");

    await expect(
      transition(
        { packageId: "pkg_1", toStatus: "CARGADO", actorId: "u1", actorRoles: ["admin"] },
        deps,
      ),
    ).rejects.toBeInstanceOf(ForbiddenTransitionError);

    expect(deps.applyTransition).not.toHaveBeenCalled();
  });

  it("lee el estado actual en cada llamada — nunca confía en un estado pasado por el caller", async () => {
    const deps = makeDeps("EN_DOMICILIO");

    await transition(
      {
        packageId: "pkg_1",
        toStatus: "ENTREGADO",
        actorId: "driver_1",
        actorRoles: ["driver"],
        metadata: { receiverName: "Ana", gps: { lat: -34.6, lng: -58.4 } },
      },
      deps,
    );

    expect(deps.getCurrentStatus).toHaveBeenCalledOnce();
  });

  it("propaga los metadata al escribir el evento", async () => {
    const deps = makeDeps("EN_DOMICILIO");
    const metadata = { receiverName: "Ana", gps: { lat: -34.6, lng: -58.4 } };

    await transition(
      {
        packageId: "pkg_1",
        toStatus: "ENTREGADO",
        actorId: "driver_1",
        actorRoles: ["driver"],
        metadata,
      },
      deps,
    );

    expect(deps.applyTransition).toHaveBeenCalledWith(
      expect.objectContaining({ metadata }),
    );
  });
});
