/**
 * Unit test del mapeo puro Tienda Nube → `store_orders` (sin DB).
 */
import { describe, expect, it } from "vitest";
import { mapTiendanubeOrder } from "../orders";
import type { TiendanubeOrder } from "../tiendanube-client";

function order(partial: Partial<TiendanubeOrder> = {}): TiendanubeOrder {
  return {
    id: 555,
    number: 42,
    status: "open",
    payment_status: "paid",
    shipping_status: "unpacked",
    contact_name: "Ana Pérez",
    contact_phone: "+5491122334455",
    contact_email: "ana@example.com",
    shipping_address: {
      address: "Av. Siempre Viva",
      number: "742",
      city: "Springfield",
      province: "Buenos Aires",
      zipcode: "1234",
      country: "AR",
      phone: null,
    },
    ...partial,
  };
}

describe("mapTiendanubeOrder", () => {
  it("mapea los campos básicos, ids como texto", () => {
    const mapped = mapTiendanubeOrder(order());
    expect(mapped.externalId).toBe("555");
    expect(mapped.orderNumber).toBe("42");
    expect(mapped.customerName).toBe("Ana Pérez");
    expect(mapped.customerPhone).toBe("+5491122334455");
    expect(mapped.shippingAddress).toBe("Av. Siempre Viva 742");
    expect(mapped.shippingCity).toBe("Springfield");
    expect(mapped.shippingProvince).toBe("Buenos Aires");
    expect(mapped.externalStatus).toBe("unpacked");
  });

  it("usa el teléfono de la dirección de envío si no hay contact_phone", () => {
    const mapped = mapTiendanubeOrder(
      order({
        contact_phone: null,
        shipping_address: {
          address: "Calle Falsa",
          number: "123",
          phone: "+5491100000000",
        },
      }),
    );
    expect(mapped.customerPhone).toBe("+5491100000000");
  });

  it("no rompe si falta shipping_address del todo", () => {
    const mapped = mapTiendanubeOrder(order({ shipping_address: null }));
    expect(mapped.shippingAddress).toBeNull();
    expect(mapped.shippingCity).toBeNull();
    expect(mapped.customerPhone).toBe("+5491122334455"); // sigue viniendo de contact_phone
  });

  it("usa locality como fallback de ciudad si no hay city", () => {
    const mapped = mapTiendanubeOrder(
      order({
        shipping_address: { address: "X", locality: "Barrio X", city: null },
      }),
    );
    expect(mapped.shippingCity).toBe("Barrio X");
  });
});
