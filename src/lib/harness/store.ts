import { create } from "zustand";
import type { HarnessRun, ModelDiscovery } from "./types";

type HarnessState = {
  runs: HarnessRun[];
  discovery: ModelDiscovery | null;
  unavailable: string[];
  lastDiscoveryAt: string | null;
  setRuns: (runs: HarnessRun[]) => void;
  setDiscovery: (discovery: ModelDiscovery) => void;
  pushRun: (run: HarnessRun) => void;
  clearRuns: () => void;
};

// Presentation cache only. Audit records live server-side; nothing sensitive is
// written to localStorage or another browser persistence mechanism.
export const useHarness = create<HarnessState>((set) => ({
  runs: [],
  discovery: null,
  unavailable: [],
  lastDiscoveryAt: null,
  setRuns: (runs) => set({ runs }),
  setDiscovery: (discovery) =>
    set({
      discovery,
      unavailable: discovery.inventory
        .filter((model) => !model.available)
        .map((model) => model.name),
      lastDiscoveryAt: discovery.discoveredAt,
    }),
  pushRun: (run) => set((state) => ({ runs: [run, ...state.runs].slice(0, 80) })),
  clearRuns: () => set({ runs: [] }),
}));
