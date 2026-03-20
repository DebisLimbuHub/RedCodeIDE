import { create } from "zustand";

/**
 * Minimal store so external components (ReconLauncher, etc.) can inject
 * commands into the active terminal session.
 *
 * TerminalPanel sets activeSessionId after create_terminal succeeds and
 * clears it on teardown.  Any component that needs to send bytes to the
 * shell calls invoke("write_terminal", { id: activeSessionId, data: [...] })
 * directly — the Rust handler still performs the full scope-check before
 * letting the newline reach the PTY.
 */
interface TerminalStore {
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
}));
