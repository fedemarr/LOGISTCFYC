import {
  ForbiddenTransitionError,
  IllegalTransitionError,
  PreconditionFailedError,
} from "@lastmile/state-machine";
import { describe, expect, it, vi } from "vitest";
import { AppError, Errors, errorToBody, toAppError } from "../errors";
import { fail, jsonError, jsonOk, ok, paginationMeta } from "../response";
import { createLogger } from "../logger";

describe("AppError / Errors", () => {
  it("arma un AppError con code, message y httpStatus", () => {
    const err = Errors.notFound("paquete no existe");
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.httpStatus).toBe(404);
    expect(err.message).toBe("paquete no existe");
  });

  it("toAppError devuelve AppError sin tocar si ya lo es", () => {
    const err = Errors.forbidden();
    expect(toAppError(err)).toBe(err);
  });

  it("toAppError mapea los errores de la máquina de estados", () => {
    expect(toAppError(new IllegalTransitionError("A", "B")).code).toBe(
      "ILLEGAL_TRANSITION",
    );
    expect(toAppError(new IllegalTransitionError("A", "B")).httpStatus).toBe(409);

    const forbidden = toAppError(new ForbiddenTransitionError("A", "B", ["driver"]));
    expect(forbidden.code).toBe("FORBIDDEN_TRANSITION");
    expect(forbidden.httpStatus).toBe(403);

    const precondition = toAppError(
      new PreconditionFailedError("A", "B", "falta evidencia"),
    );
    expect(precondition.code).toBe("PRECONDITION_FAILED");
    expect(precondition.httpStatus).toBe(422);
  });

  it("toAppError mapea lo desconocido a INTERNAL_ERROR sin filtrar detalles", () => {
    const err = toAppError(new Error("password de la db: secreto"));
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.httpStatus).toBe(500);
    expect(err.message).toBe("error interno del servidor");
  });

  it("errorToBody no incluye details si no hay", () => {
    expect(errorToBody(Errors.unauthorized())).toEqual({
      code: "UNAUTHORIZED",
      message: "no autenticado",
    });
  });
});

describe("Envoltorio de respuesta estándar", () => {
  it("ok() arma { success: true, data } y acepta meta", () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
    expect(ok({ a: 1 }, { page: 1 })).toEqual({
      success: true,
      data: { a: 1 },
      meta: { page: 1 },
    });
  });

  it("fail() arma el shape de error", () => {
    expect(fail(Errors.forbidden("sin acceso"))).toEqual({
      success: false,
      error: { code: "FORBIDDEN", message: "sin acceso" },
    });
  });

  it("jsonOk/jsonError producen Responses con status correctos", async () => {
    const okRes = jsonOk({ x: 1 }, undefined, { status: 201 });
    expect(okRes.status).toBe(201);
    expect(await okRes.json()).toEqual({ success: true, data: { x: 1 } });

    const errRes = jsonError(Errors.rateLimited());
    expect(errRes.status).toBe(429);
    expect((await errRes.json()).success).toBe(false);
  });

  it("paginationMeta calcula páginas", () => {
    expect(paginationMeta(1, 20, 45)).toEqual({
      page: 1,
      pageSize: 20,
      total: 45,
      pages: 3,
    });
  });
});

describe("logger estructurado", () => {
  it("child() mergea bindings y escribe una línea JSON por evento", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const log = createLogger({ service: "test" }).child({ requestId: "req-1" });
      log.info("hola", { extra: 1 });

      const lines = writeSpy.mock.calls.map((c) => JSON.parse(String(c[0])));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "info",
        msg: "hola",
        service: "test",
        requestId: "req-1",
        extra: 1,
      });
      expect(typeof lines[0].time).toBe("string");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("respeta LOG_LEVEL: en 'info' no se emiten líneas debug", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const originalLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    try {
      const log = createLogger();
      log.debug("no debería salir");
      log.info("sí debería salir");
      expect(writeSpy.mock.calls).toHaveLength(1);
      const call = writeSpy.mock.calls[0] as [string];
      const line = JSON.parse(call[0]);
      expect(line.msg).toBe("sí debería salir");
    } finally {
      writeSpy.mockRestore();
      if (originalLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = originalLevel;
    }
  });
});
