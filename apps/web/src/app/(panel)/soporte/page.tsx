"use client";

import * as React from "react";
import { MessageSquarePlus, Send } from "lucide-react";
import { api, type Page } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { useToast } from "@/components/ui/toast";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
type TicketCategory = "GENERAL" | "TECHNICAL" | "PAYMENT" | "ROUTE" | "VEHICLE" | "OTHER";

interface TicketListItem {
  id: string;
  ticketNumber: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  driverName: string | null;
  packageCode: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
}

interface TicketMessageItem {
  id: string;
  ticketId: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  message: string;
  attachmentUrl: string | null;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  ticketNumber: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  driverName: string | null;
  assignedToName: string | null;
  packageCode: string | null;
  routeNumber: number | null;
  createdAt: string;
  closedAt: string | null;
  messages: TicketMessageItem[];
}

const STATUS_BADGE: Record<TicketStatus, "neutral" | "warning" | "success" | "danger"> = {
  OPEN: "warning",
  IN_PROGRESS: "neutral",
  RESOLVED: "success",
  CLOSED: "danger",
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  GENERAL: "General",
  TECHNICAL: "Técnico",
  PAYMENT: "Pagos",
  ROUTE: "Ruta",
  VEHICLE: "Vehículo",
  OTHER: "Otro",
};

/**
 * `/soporte` — tickets de soporte con hilo (FASE 12 §7): lista paginada
 * (staff ve todos, chofer los suyos), detalle con mensajes y respuesta
 * en línea. Los choferes abren tickets desde la app móvil; acá el staff
 * también puede crear.
 */
export default function SoportePage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = React.useState<TicketListItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<TicketStatus | "ALL">("ALL");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<TicketDetail | null>(null);
  const [reply, setReply] = React.useState("");
  const [sendingReply, setSendingReply] = React.useState(false);

  // ── Nuevo ticket ──
  const [showNew, setShowNew] = React.useState(false);
  const [newCategory, setNewCategory] = React.useState<TicketCategory>("GENERAL");
  const [newSubject, setNewSubject] = React.useState("");
  const [newMessage, setNewMessage] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const loadList = React.useCallback(
    async (silent = false) => {
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (search.trim()) params.set("search", search.trim());
        if (statusFilter !== "ALL") params.set("status", statusFilter);
        const data = await api.get<Page<TicketListItem>>(
          `/api/tickets?${params.toString()}`,
        );
        setItems(data.items);
        setTotal(data.meta.total);
        setStatus("ready");
      } catch {
        if (!silent) setStatus("error");
      }
    },
    [page, search, statusFilter],
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadList();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  const openTicket = React.useCallback(
    async (id: string) => {
      setSelected(id);
      setDetail(null);
      try {
        const d = await api.get<TicketDetail>(`/api/tickets/${id}`);
        setDetail(d);
      } catch (err) {
        toast({
          title: "No se pudo cargar el ticket",
          description: err instanceof Error ? err.message : "Error de red",
          variant: "error",
        });
      }
    },
    [toast],
  );

  const sendReply = React.useCallback(
    async (ticketId: string) => {
      if (!reply.trim() || sendingReply) return;
      setSendingReply(true);
      try {
        await api.post(`/api/tickets/${ticketId}`, { message: reply.trim() });
        setReply("");
        await openTicket(ticketId);
        await loadList(true);
      } catch (err) {
        toast({
          title: "No se pudo enviar",
          description: err instanceof Error ? err.message : "Error de red",
          variant: "error",
        });
      } finally {
        setSendingReply(false);
      }
    },
    [reply, sendingReply, openTicket, loadList, toast],
  );

  const createTicket = React.useCallback(async () => {
    if (!newSubject.trim() || !newMessage.trim() || creating) return;
    setCreating(true);
    try {
      const created = await api.post<{ id: string }>("/api/tickets", {
        category: newCategory,
        subject: newSubject.trim(),
        message: newMessage.trim(),
      });
      setShowNew(false);
      setNewSubject("");
      setNewMessage("");
      setNewCategory("GENERAL");
      await loadList();
      await openTicket(created.id);
    } catch (err) {
      toast({
        title: "No se pudo crear el ticket",
        description: err instanceof Error ? err.message : "Error de red",
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  }, [newCategory, newSubject, newMessage, creating, loadList, openTicket, toast]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Soporte" description="Tickets y hilo de mensajes (FASE 12)" />
        <TableSkeleton columns={3} rows={5} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Soporte" description="Tickets y hilo de mensajes (FASE 12)" />
        <ErrorState onRetry={() => void loadList()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Soporte"
        description={`${total} ticket(s) · FASE 12 §7`}
        action={
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            <MessageSquarePlus className="size-3.5" />
            Nuevo ticket
          </Button>
        }
      />

      {showNew && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tk-category">Categoría</Label>
                <Select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as TicketCategory)}
                >
                  {(Object.keys(CATEGORY_LABELS) as TicketCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tk-subject">Asunto</Label>
                <Input
                  id="tk-subject"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Resumen corto"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tk-message">Mensaje</Label>
              <Textarea
                id="tk-message"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={3}
                placeholder="¿Qué necesitás reportar?"
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!newSubject.trim() || !newMessage.trim() || creating}
                onClick={() => void createTicket()}
              >
                {creating ? "Creando…" : "Crear ticket"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── Lista ── */}
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar asunto…"
                className="flex-1"
              />
              <Select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as TicketStatus | "ALL");
                  setPage(1);
                }}
                className="w-32"
              >
                <option value="ALL">Todos</option>
                <option value="OPEN">Abierto</option>
                <option value="IN_PROGRESS">En curso</option>
                <option value="RESOLVED">Resuelto</option>
                <option value="CLOSED">Cerrado</option>
              </Select>
            </div>

            {items.length === 0 ? (
              <EmptyState
                title="Sin tickets"
                description="No hay tickets que coincidan."
              />
            ) : (
              <div className="flex flex-col divide-y">
                {items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void openTicket(t.id)}
                    className={cn(
                      "flex flex-col items-start gap-1 py-2.5 text-left",
                      selected === t.id && "opacity-80",
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-text-muted font-mono text-xs">
                        {t.ticketNumber}
                      </span>
                      <Badge variant={STATUS_BADGE[t.status]}>{t.status}</Badge>
                    </div>
                    <span className="text-sm font-medium">{t.subject}</span>
                    <span className="text-text-muted text-xs">
                      {t.driverName ?? "—"} · {fmtDateTime(t.createdAt)}
                      {t.messageCount > 0 && ` · ${t.messageCount} msg`}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {total > 20 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <span className="text-text-muted text-xs">
                  Página {page} · {total} total
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 20 >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Detalle / hilo ── */}
        <Card>
          <CardContent>
            {!selected || !detail ? (
              <EmptyState
                title={selected ? "Cargando…" : "Seleccioná un ticket"}
                description="El hilo de mensajes aparece acá."
              />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_BADGE[detail.status]}>{detail.status}</Badge>
                  <Badge variant="neutral">{CATEGORY_LABELS[detail.category]}</Badge>
                  <span className="font-mono text-sm">{detail.ticketNumber}</span>
                  {detail.packageCode && (
                    <span className="text-text-muted font-mono text-xs">
                      · {detail.packageCode}
                    </span>
                  )}
                </div>
                <h2 className="text-base font-semibold">{detail.subject}</h2>
                <p className="text-text-muted text-xs">
                  {detail.driverName ?? "Sin chofer"} · abierto{" "}
                  {fmtDateTime(detail.createdAt)}
                  {detail.assignedToName && ` · asignado a ${detail.assignedToName}`}
                </p>

                <div className="flex flex-col gap-2 border-t pt-3">
                  {detail.messages.length === 0 && (
                    <p className="text-text-muted py-4 text-center text-sm">
                      Sin mensajes todavía.
                    </p>
                  )}
                  {detail.messages.map((m) => (
                    <div key={m.id} className="bg-muted/40 rounded-lg border p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">
                          {m.userName ?? m.userRole ?? "Sistema"}
                        </span>
                        <span className="text-text-muted text-xs">
                          {fmtDateTime(m.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{m.message}</p>
                    </div>
                  ))}
                </div>

                {detail.status !== "CLOSED" && (
                  <div className="flex flex-col gap-1.5 border-t pt-3">
                    <Textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={2}
                      placeholder="Responder en el hilo…"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={!reply.trim() || sendingReply}
                        onClick={() => void sendReply(detail.id)}
                      >
                        <Send className="size-3.5" />
                        {sendingReply ? "Enviando…" : "Enviar"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} · ${hh}:${min}`;
}
