import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Engagement } from "../types";

// ---------------------------------------------------------------------------
// Input shapes — camelCase because Tauri's command macro renames snake_case
// Rust params to camelCase for JS callers.
// ---------------------------------------------------------------------------

export interface CreateEngagementInput {
  name: string;
  clientName: string;
  engagementType: string;
  methodology: string;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export interface UpdateEngagementInput {
  name: string;
  clientName: string;
  engagementType: string;
  methodology: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EngagementStore {
  currentEngagement: Engagement | null;
  engagements: Engagement[];
  loading: boolean;
  error: string | null;

  /** Populate the engagement list. Defaults to all non-archived. */
  listEngagements: (statusFilter?: string | null) => Promise<void>;
  /** Create and immediately set as current. */
  createEngagement: (data: CreateEngagementInput) => Promise<Engagement>;
  /** Fetch a single engagement by id and set as current. */
  loadEngagement: (id: string) => Promise<void>;
  /** Update fields; refreshes current if matching. */
  updateEngagement: (id: string, fields: UpdateEngagementInput) => Promise<void>;
  /** Archive and clear current if matching. */
  archiveEngagement: (id: string) => Promise<void>;
  /** Load the most recent active engagement on app start. */
  loadMostRecent: () => Promise<void>;
  setCurrentEngagement: (e: Engagement | null) => void;
}

export const useEngagementStore = create<EngagementStore>((set, _get) => ({
  currentEngagement: null,
  engagements: [],
  loading: false,
  error: null,

  listEngagements: async (statusFilter) => {
    set({ loading: true, error: null });
    try {
      const engagements = await invoke<Engagement[]>("list_engagements", {
        statusFilter: statusFilter ?? null,
      });
      set({ engagements, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createEngagement: async (data) => {
    const engagement = await invoke<Engagement>("create_engagement", data as unknown as Record<string, unknown>);
    set((s) => ({
      engagements: [engagement, ...s.engagements],
      currentEngagement: engagement,
    }));
    return engagement;
  },

  loadEngagement: async (id) => {
    const engagement = await invoke<Engagement>("get_engagement", { id });
    set({ currentEngagement: engagement });
  },

  updateEngagement: async (id, fields) => {
    const updated = await invoke<Engagement>("update_engagement", {
      id,
      ...fields,
    });
    set((s) => ({
      currentEngagement:
        s.currentEngagement?.id === id ? updated : s.currentEngagement,
      engagements: s.engagements.map((e) => (e.id === id ? updated : e)),
    }));
  },

  archiveEngagement: async (id) => {
    await invoke<boolean>("archive_engagement", { id });
    set((s) => ({
      currentEngagement:
        s.currentEngagement?.id === id ? null : s.currentEngagement,
      engagements: s.engagements.filter((e) => e.id !== id),
    }));
  },

  loadMostRecent: async () => {
    set({ loading: true, error: null });
    try {
      const engagements = await invoke<Engagement[]>("list_engagements", {
        statusFilter: "active",
      });
      set({
        engagements,
        currentEngagement: engagements[0] ?? null,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setCurrentEngagement: (e) => set({ currentEngagement: e }),
}));
