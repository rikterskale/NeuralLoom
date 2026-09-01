import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildInventory } from "./spec";
import type { HarnessRun, ModelRecord } from "./types";

type HarnessState = {
  runs: HarnessRun[];
  unavailable: string[];
  lastDiscoveryAt: string | null;
  hydrateDiscovery: () => void;
  setUnavailable: (name: string, available: boolean) => void;
  inventory: () => ModelRecord[];
  pushRun: (run: HarnessRun) => void;
  updateRun: (id: string, patch: Partial<HarnessRun>) => void;
  clearRuns: () => void;
};

export const useHarness = create<HarnessState>()(
  persist(
    (set, get) => ({
      runs: [],
      unavailable: [],
      lastDiscoveryAt: null,
      hydrateDiscovery: () => {
        if (get().lastDiscoveryAt) return;
        set({ lastDiscoveryAt: new Date().toISOString() });
      },
      setUnavailable: (name, available) => {
        set((s) => ({
          unavailable: available
            ? s.unavailable.filter((n) => n !== name)
            : [...new Set([...s.unavailable, name])],
        }));
      },
      inventory: () => buildInventory(get().unavailable),
      pushRun: (run) =>
        set((s) => ({ runs: [run, ...s.runs].slice(0, 80) })),
      updateRun: (id, patch) =>
        set((s) => ({
          runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      clearRuns: () => set({ runs: [] }),
    }),
    {
      name: "neuralloom-harness-v1",
      partialize: (s) => ({
        runs: s.runs,
        unavailable: s.unavailable,
        lastDiscoveryAt: s.lastDiscoveryAt,
      }),
    },
  ),
);
