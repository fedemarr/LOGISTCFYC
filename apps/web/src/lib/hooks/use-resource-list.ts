"use client";

import * as React from "react";
import type { Page } from "@/lib/api/client";

/**
 * Hook de listado con paginación + búsqueda (FASE 4). Centraliza los
 * estados obligatorios de §13 (loading → skeleton, error → retry, empty)
 * para que cada página de CRUD no repita el patrón.
 */
export function useResourceList<T>(
  fetcher: (params: {
    page: number;
    pageSize: number;
    search?: string;
  }) => Promise<Page<T>>,
) {
  const [data, setData] = React.useState<Page<T> | null>(null);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState<string | undefined>(undefined);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  const load = React.useCallback(async () => {
    try {
      const result = await fetcher({ page, pageSize: 20, search });
      setData(result);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [fetcher, page, search]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetcher({ page, pageSize: 20, search });
        if (cancelled) return;
        setData(result);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher, page, search]);

  return {
    data,
    status,
    page,
    setPage,
    search,
    setSearch,
    reload: load,
  };
}
