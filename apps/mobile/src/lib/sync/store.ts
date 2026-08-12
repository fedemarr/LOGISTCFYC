import { create } from "zustand";

/**
 * Estado global de sync — lo que la UI necesita mostrar en cualquier
 * pantalla: el badge "3 acciones pendientes de sincronizar" (§12, regla
 * 7) y el estado de conexión. La lógica real vive en `engine.ts`/
 * `outbox.ts`; esto es solo el estado observable por componentes.
 */
interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (count: number) => void;
  setError: (error: string | null) => void;
  setSyncedNow: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  lastError: null,
  lastSyncedAt: null,
  setOnline: (isOnline) => set({ isOnline }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setError: (lastError) => set({ lastError }),
  setSyncedNow: () => set({ lastSyncedAt: new Date().toISOString(), lastError: null }),
}));
