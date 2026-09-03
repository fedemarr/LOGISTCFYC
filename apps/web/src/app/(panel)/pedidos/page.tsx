"use client";

import * as React from "react";
import { Check, Link2, Plus, RefreshCw, ShoppingBag, Unlink, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { ErrorState, TableSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

/**
 * PEDIDOS — TIENDA NUBE (FYM) — pedido de un cliente por WhatsApp
 * (03/09/2026): sincronizar el estado de los pedidos y poder generar el
 * envío por fuera de Tienda Nube. Ver `PROMPT-ALERTAS-FINANZAS.md` para
 * el resto del contexto de negocio y `docs/DECISIONES.md` para el ADR.
 */

type OrderStatus = "PENDING" | "ASSIGNED" | "DELIVERED" | "FAILED" | "CANCELLED";

interface Connection {
  id: string;
  storeId: string;
  shopName: string | null;
  connectedAt: string;
}

interface OrderItem {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  status: OrderStatus;
  source: "tiendanube" | "manual";
  shiftId: string | null;
  suggestedZoneId: string | null;
  suggestedZoneName: string | null;
  syncedAt: string;
}

interface AssignableShift {
  id: string;
  driver: { id: string; fullName: string };
  zone: { id: string; name: string };
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Sin asignar",
  ASSIGNED: "Asignado",
  DELIVERED: "Entregado",
  FAILED: "No entregado",
  CANCELLED: "Cancelado",
};

const STATUS_VARIANT: Record<OrderStatus, "neutral" | "info" | "success" | "warning"> = {
  PENDING: "neutral",
  ASSIGNED: "info",
  DELIVERED: "success",
  FAILED: "warning",
  CANCELLED: "neutral",
};

export default function PedidosPage() {
  const { toast } = useToast();
  const [connection, setConnection] = React.useState<Connection | null | undefined>(
    undefined,
  );
  const [connecting, setConnecting] = React.useState(false);
  const [storeId, setStoreId] = React.useState("");
  const [accessToken, setAccessToken] = React.useState("");

  // Pedido manual (pedido de Fede: cargar pedidos a mano para probar,
  // sin depender de tener Tienda Nube conectada) — mismo listado y
  // flujos de acá en más que uno sincronizado.
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualCreating, setManualCreating] = React.useState(false);
  const [manualForm, setManualForm] = React.useState({
    orderNumber: "",
    customerName: "",
    customerPhone: "",
    shippingAddress: "",
    shippingCity: "",
    shippingProvince: "",
  });

  const [orders, setOrders] = React.useState<OrderItem[]>([]);
  const [shifts, setShifts] = React.useState<AssignableShift[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<OrderStatus | "">("");
  const [syncing, setSyncing] = React.useState(false);
  const [busyOrderId, setBusyOrderId] = React.useState<string | null>(null);
  const [zonePicks, setZonePicks] = React.useState<Record<string, string>>({});
  const [busyZoneKey, setBusyZoneKey] = React.useState<string | null>(null);

  async function loadConnection() {
    try {
      const data = await api.get<{ connection: Connection | null }>(
        "/api/tiendanube/connection",
      );
      setConnection(data.connection);
    } catch {
      setConnection(null);
    }
  }

  async function loadOrders() {
    try {
      const path = statusFilter ? `/api/orders?status=${statusFilter}` : "/api/orders";
      const [ordersData, shiftsData] = await Promise.all([
        api.get<{ orders: OrderItem[] }>(path),
        api.get<{ shifts: AssignableShift[] }>("/api/orders/assignable-shifts"),
      ]);
      setError(null);
      setOrders(ordersData.orders);
      setShifts(shiftsData.shifts);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial, no hay nada externo a lo que "sincronizar"
    void loadConnection();
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial/al cambiar el filtro
    setLoading(true);
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se re-corre a mano cuando cambia statusFilter
  }, [statusFilter]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const data = await api.post<{ connection: Connection }>(
        "/api/tiendanube/connection",
        {
          storeId: storeId.trim(),
          accessToken: accessToken.trim(),
        },
      );
      setConnection(data.connection);
      setStoreId("");
      setAccessToken("");
      toast({
        title: `Conectado con ${data.connection.shopName ?? "Tienda Nube"}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo conectar",
        variant: "error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setConnecting(true);
    try {
      await api.del("/api/tiendanube/connection");
      setConnection(null);
      toast({ title: "Tienda desconectada", variant: "success" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo desconectar",
        variant: "error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleCreateManual() {
    setManualCreating(true);
    try {
      await api.post("/api/orders/manual", {
        orderNumber: manualForm.orderNumber.trim() || undefined,
        customerName: manualForm.customerName.trim() || undefined,
        customerPhone: manualForm.customerPhone.trim() || undefined,
        shippingAddress: manualForm.shippingAddress.trim() || undefined,
        shippingCity: manualForm.shippingCity.trim() || undefined,
        shippingProvince: manualForm.shippingProvince.trim() || undefined,
      });
      toast({ title: "Pedido manual cargado", variant: "success" });
      setManualForm({
        orderNumber: "",
        customerName: "",
        customerPhone: "",
        shippingAddress: "",
        shippingCity: "",
        shippingProvince: "",
      });
      setManualOpen(false);
      await loadOrders();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo cargar el pedido",
        variant: "error",
      });
    } finally {
      setManualCreating(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const data = await api.post<{ synced: number }>("/api/tiendanube/sync");
      toast({ title: `${data.synced} pedidos sincronizados`, variant: "success" });
      await loadOrders();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo sincronizar",
        variant: "error",
      });
    } finally {
      setSyncing(false);
    }
  }

  const pendingByZone = React.useMemo(() => {
    const groups = new Map<string, { name: string; count: number }>();
    for (const order of orders) {
      if (order.status !== "PENDING") continue;
      const key = order.suggestedZoneId ?? "__none__";
      const name = order.suggestedZoneName ?? "Sin zona sugerida";
      const entry = groups.get(key) ?? { name, count: 0 };
      entry.count += 1;
      groups.set(key, entry);
    }
    return [...groups.entries()]
      .filter(([key]) => key !== "__none__")
      .map(([zoneId, v]) => ({ zoneId, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [orders]);

  async function handleBulkAssign(zoneId: string) {
    const shiftId = zonePicks[zoneId];
    if (!shiftId) return;
    setBusyZoneKey(zoneId);
    try {
      const data = await api.post<{ assigned: number }>("/api/orders/assign-zone", {
        zoneId,
        shiftId,
      });
      toast({ title: `${data.assigned} pedidos asignados`, variant: "success" });
      await loadOrders();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo asignar en bloque",
        variant: "error",
      });
    } finally {
      setBusyZoneKey(null);
    }
  }

  async function handleAssign(orderId: string, shiftId: string) {
    if (!shiftId) return;
    setBusyOrderId(orderId);
    try {
      await api.post(`/api/orders/${orderId}/assign`, { shiftId });
      toast({ title: "Pedido asignado", variant: "success" });
      await loadOrders();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo asignar",
        variant: "error",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleDeliver(order: OrderItem) {
    setBusyOrderId(order.id);
    try {
      const data = await api.post<{ pushedToTiendaNube: boolean; pushError?: string }>(
        `/api/orders/${order.id}/deliver`,
      );
      toast({
        title: data.pushedToTiendaNube
          ? "Marcado entregado — avisado a Tienda Nube"
          : `Marcado entregado acá, pero no se pudo avisar a Tienda Nube: ${data.pushError}`,
        variant: data.pushedToTiendaNube ? "success" : "error",
      });
      await loadOrders();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo marcar como entregado",
        variant: "error",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  async function handleFail(orderId: string) {
    setBusyOrderId(orderId);
    try {
      await api.post(`/api/orders/${orderId}/fail`);
      toast({ title: "Marcado como no entregado", variant: "success" });
      await loadOrders();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "No se pudo actualizar",
        variant: "error",
      });
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Pedidos"
        description="Sincronizá los pedidos de Tienda Nube y gestioná el envío desde acá."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="text-primary size-4" /> Tienda Nube
          </CardTitle>
        </CardHeader>
        <CardContent>
          {connection === undefined && (
            <p className="text-text-muted text-sm">Cargando…</p>
          )}
          {connection === null && (
            <div className="flex flex-col gap-3">
              <p className="text-text-muted text-sm">
                Generá un token desde{" "}
                <a
                  href="https://ayuda.tiendanube.com/es_ES/aplicaciones-a-medida/como-crear-una-aplicacion-a-medida-y-acceder-al-token-en-mi-tiendanube"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Aplicaciones a medida
                </a>{" "}
                en el admin de Tienda Nube (plan Escala o Evolución) y pegalo acá.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="store-id">Store ID</Label>
                  <Input
                    id="store-id"
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    placeholder="ej. 123456"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="access-token">Access token</Label>
                  <Input
                    id="access-token"
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <Button
                disabled={connecting || !storeId.trim() || !accessToken.trim()}
                onClick={() => void handleConnect()}
                className="w-fit"
              >
                <Link2 className="size-4" /> {connecting ? "Conectando…" : "Conectar"}
              </Button>
            </div>
          )}
          {connection && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {connection.shopName ?? "Tienda Nube"}
                </p>
                <p className="text-text-muted text-xs">Store ID: {connection.storeId}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={syncing} onClick={() => void handleSync()}>
                  <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />{" "}
                  {syncing ? "Sincronizando…" : "Sincronizar ahora"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={connecting}
                  onClick={() => void handleDisconnect()}
                >
                  <Unlink className="size-4" /> Desconectar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="text-primary size-4" /> Pedido manual
          </CardTitle>
          {!manualOpen && (
            <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
              <Plus className="size-4" /> Cargar pedido
            </Button>
          )}
        </CardHeader>
        {manualOpen && (
          <CardContent className="flex flex-col gap-3">
            <p className="text-text-muted text-sm">
              Para probar sin depender de Tienda Nube — entra al mismo flujo de acá en más
              (asignar, mapa, marcar entregado).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-number">Número de pedido (opcional)</Label>
                <Input
                  id="m-number"
                  value={manualForm.orderNumber}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, orderNumber: e.target.value }))
                  }
                  placeholder="se genera uno si lo dejás vacío"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-name">Nombre del cliente</Label>
                <Input
                  id="m-name"
                  value={manualForm.customerName}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, customerName: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-phone">Teléfono</Label>
                <Input
                  id="m-phone"
                  type="tel"
                  value={manualForm.customerPhone}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, customerPhone: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-address">Dirección</Label>
                <Input
                  id="m-address"
                  value={manualForm.shippingAddress}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, shippingAddress: e.target.value }))
                  }
                  placeholder="calle y número — se geocodifica para sugerir zona"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-city">Ciudad</Label>
                <Input
                  id="m-city"
                  value={manualForm.shippingCity}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, shippingCity: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-province">Provincia</Label>
                <Input
                  id="m-province"
                  value={manualForm.shippingProvince}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, shippingProvince: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button disabled={manualCreating} onClick={() => void handleCreateManual()}>
                {manualCreating ? "Cargando…" : "Cargar pedido"}
              </Button>
              <Button
                variant="ghost"
                disabled={manualCreating}
                onClick={() => setManualOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {pendingByZone.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asignar por zona</CardTitle>
            <p className="text-text-muted text-sm">
              Pedidos sin asignar, agrupados por la zona más cercana — asignalos todos
              juntos al chofer que corresponda en vez de uno por uno.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingByZone.map((group) => {
              const matchingShifts = shifts.filter((s) => s.zone.id === group.zoneId);
              return (
                <div
                  key={group.zoneId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{group.name}</p>
                    <p className="text-text-muted text-xs">
                      {group.count} {group.count === 1 ? "pedido" : "pedidos"} sin asignar
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label={`Asignar pedidos de ${group.name} a`}
                      className="w-44"
                      value={zonePicks[group.zoneId] ?? ""}
                      onChange={(e) =>
                        setZonePicks((prev) => ({
                          ...prev,
                          [group.zoneId]: e.target.value,
                        }))
                      }
                    >
                      <option value="" disabled>
                        Elegí un chofer…
                      </option>
                      {(matchingShifts.length > 0 ? matchingShifts : shifts).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.driver.fullName} · {s.zone.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={!zonePicks[group.zoneId] || busyZoneKey === group.zoneId}
                      onClick={() => void handleBulkAssign(group.zoneId)}
                    >
                      Asignar todos
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Pedidos</CardTitle>
          <Select
            aria-label="Filtrar por estado"
            className="w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")}
          >
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </CardHeader>
        {loading && !orders.length && <TableSkeleton columns={5} rows={5} />}
        {error && (
          <ErrorState
            title="No se pudieron cargar los pedidos"
            description={error.message}
            onRetry={() => void loadOrders()}
          />
        )}
        {!loading && !error && orders.length === 0 && (
          <p className="text-text-muted p-6 text-sm">
            {connection
              ? 'No hay pedidos todavía — probá "Sincronizar ahora".'
              : 'No hay pedidos todavía — conectá Tienda Nube o cargá un "Pedido manual".'}
          </p>
        )}
        {orders.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-data">
                    #{order.orderNumber}
                    {order.source === "manual" && (
                      <Badge variant="neutral" className="ml-2">
                        Manual
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{order.customerName ?? "—"}</p>
                    <p className="text-text-muted text-xs">{order.customerPhone ?? ""}</p>
                  </TableCell>
                  <TableCell className="text-text-muted text-sm">
                    {[order.shippingAddress, order.shippingCity]
                      .filter(Boolean)
                      .join(", ") || "—"}
                    {order.suggestedZoneName && (
                      <p className="text-text-muted-2 text-xs">
                        Zona sugerida: {order.suggestedZoneName}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[order.status]}>
                      {STATUS_LABEL[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {(order.status === "PENDING" || order.status === "ASSIGNED") && (
                        <Select
                          aria-label="Asignar a turno"
                          className="w-36"
                          value={order.shiftId ?? ""}
                          disabled={busyOrderId === order.id}
                          onChange={(e) => void handleAssign(order.id, e.target.value)}
                        >
                          <option value="" disabled>
                            Asignar a…
                          </option>
                          {shifts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.driver.fullName} · {s.zone.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      {order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
                        <Button
                          size="icon-sm"
                          variant="outline"
                          disabled={busyOrderId === order.id}
                          title="Marcar entregado"
                          onClick={() => void handleDeliver(order)}
                        >
                          <Check className="size-4" />
                        </Button>
                      )}
                      {order.status !== "DELIVERED" &&
                        order.status !== "FAILED" &&
                        order.status !== "CANCELLED" && (
                          <Button
                            size="icon-sm"
                            variant="outline"
                            disabled={busyOrderId === order.id}
                            title="Marcar no entregado"
                            onClick={() => void handleFail(order.id)}
                          >
                            <X className="size-4" />
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
