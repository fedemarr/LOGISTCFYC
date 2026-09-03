/**
 * Unit test del cliente HTTP de Tienda Nube — mockea `fetch` global, no
 * pega contra la API real (no tenemos credenciales de un cliente real
 * todavía). Cubre: headers obligatorios, mapeo de errores, y las tres
 * llamadas que usa `services/orders.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TiendanubeApiError,
  fetchFulfillmentOrders,
  fetchOrders,
  updateFulfillmentOrderStatus,
  verifyConnection,
} from "../tiendanube-client";

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tiendanube-client", () => {
  it("verifyConnection manda Authorization + User-Agent y pega a /store", async () => {
    mockFetchOnce(200, { id: 123, name: "Mi Tienda" });
    const store = await verifyConnection("123", "tok_abc");
    expect(store.name).toBe("Mi Tienda");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tiendanube.com/2025-03/123/store");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_abc");
    expect(headers["User-Agent"]).toBeTruthy();
  });

  it("verifyConnection tira TiendanubeApiError con el status en un 401", async () => {
    mockFetchOnce(401, { error: "invalid_token" });
    await expect(verifyConnection("123", "tok_bad")).rejects.toMatchObject({
      status: 401,
    });
    await expect(verifyConnection("123", "tok_bad")).rejects.toBeInstanceOf(
      TiendanubeApiError,
    );
  });

  it("fetchOrders arma el query string con per_page y updated_at_min", async () => {
    mockFetchOnce(200, []);
    await fetchOrders("123", "tok", {
      perPage: 10,
      updatedAtMin: "2026-01-01T00:00:00Z",
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/orders?");
    expect(url).toContain("per_page=10");
    expect(url).toContain("updated_at_min=2026-01-01T00%3A00%3A00Z");
  });

  it("fetchFulfillmentOrders pega al path correcto", async () => {
    mockFetchOnce(200, [{ id: "ff1", status: "UNPACKED" }]);
    const result = await fetchFulfillmentOrders("123", "tok", 999);
    expect(result[0]?.id).toBe("ff1");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.tiendanube.com/2025-03/123/orders/999/fulfillment-orders",
    );
  });

  it("updateFulfillmentOrderStatus manda PATCH con el status en el body", async () => {
    mockFetchOnce(200, { id: "ff1", status: "DELIVERED" });
    await updateFulfillmentOrderStatus("123", "tok", 999, "ff1", "DELIVERED");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.tiendanube.com/2025-03/123/orders/999/fulfillment-orders/ff1",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "DELIVERED" });
  });
});
