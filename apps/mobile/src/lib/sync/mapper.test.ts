import { describe, expect, it } from "vitest";
import type { SyncActionResult } from "@fyc/shared";
import type { OutboxRow } from "../db/schema";
import { partitionSyncResults, rowToSyncAction } from "./mapper";

function makeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    idempotency_key: "11111111-1111-1111-1111-111111111111",
    operation_type: "GPS_PING",
    payload: JSON.stringify({ lat: -34.5, lng: -58.5 }),
    client_timestamp: "2026-08-12T10:00:00.000Z",
    status: "pending",
    attempts: 0,
    last_error: null,
    next_attempt_at: "2026-08-12T10:00:00.000Z",
    created_at: "2026-08-12T10:00:00.000Z",
    ...overrides,
  };
}

describe("rowToSyncAction", () => {
  it("deserializa el payload de texto a objeto", () => {
    const action = rowToSyncAction(makeRow());
    expect(action.payload).toEqual({ lat: -34.5, lng: -58.5 });
    expect(action.operationType).toBe("GPS_PING");
    expect(action.idempotencyKey).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("partitionSyncResults", () => {
  it("COMPLETED y DUPLICATE se pueden borrar del outbox", () => {
    const results: SyncActionResult[] = [
      { idempotencyKey: "a", status: "COMPLETED" },
      { idempotencyKey: "b", status: "DUPLICATE" },
    ];
    const { toDelete, toRetry } = partitionSyncResults(results);
    expect(toDelete.sort()).toEqual(["a", "b"]);
    expect(toRetry).toHaveLength(0);
  });

  it("FAILED queda para reintentar, nunca se borra sin confirmación", () => {
    const results: SyncActionResult[] = [
      { idempotencyKey: "c", status: "FAILED", error: "lat fuera de rango" },
    ];
    const { toDelete, toRetry } = partitionSyncResults(results);
    expect(toDelete).toHaveLength(0);
    expect(toRetry).toEqual([{ idempotencyKey: "c", error: "lat fuera de rango" }]);
  });

  it("un lote mixto separa cada resultado según corresponde", () => {
    const results: SyncActionResult[] = [
      { idempotencyKey: "a", status: "COMPLETED" },
      { idempotencyKey: "b", status: "FAILED", error: "boom" },
      { idempotencyKey: "c", status: "DUPLICATE" },
    ];
    const { toDelete, toRetry } = partitionSyncResults(results);
    expect(toDelete.sort()).toEqual(["a", "c"]);
    expect(toRetry).toEqual([{ idempotencyKey: "b", error: "boom" }]);
  });
});
