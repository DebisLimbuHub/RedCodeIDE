import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEngagementStore } from "../stores/engagementStore";
import type { ScopeCheckResult } from "../types";

export type { ScopeCheckResult };

export function useScopeCheck() {
  const [isChecking, setIsChecking] = useState(false);
  const [lastResult, setLastResult] = useState<ScopeCheckResult | null>(null);

  /**
   * Run check_scope for the current engagement.
   * Reads engagement from the store at call time (not via a closure) to avoid
   * stale-engagement bugs when the hook was created before the engagement loaded.
   * Returns null if no engagement is active — the Rust PTY backup handles it.
   */
  const checkScope = useCallback(
    async (command: string): Promise<ScopeCheckResult | null> => {
      const currentEngagement = useEngagementStore.getState().currentEngagement;
      if (!currentEngagement) {
        setLastResult(null);
        return null;
      }
      setIsChecking(true);
      try {
        const result = await invoke<ScopeCheckResult>("check_scope", {
          engagementId: currentEngagement.id,
          command,
        });
        setLastResult(result);
        return result;
      } finally {
        setIsChecking(false);
      }
    },
    [] // reads from store at call time — no stale closure possible
  );

  /** Persist a command execution record. Fire-and-forget — errors are silently swallowed. */
  const logCommand = useCallback(
    (command: string, result: ScopeCheckResult, executed: boolean): void => {
      const currentEngagement = useEngagementStore.getState().currentEngagement;
      if (!currentEngagement) return;

      let scopeDetail: string | null = null;
      if (result.type === "OutOfScope") scopeDetail = result.reason;
      else if (result.type === "Unknown") scopeDetail = result.message;
      else if (result.type === "PartiallyInScope")
        scopeDetail = result.out_of_scope.join(", ");

      invoke("log_command", {
        engagementId: currentEngagement.id,
        command,
        scopeType: result.type,
        scopeDetail,
        executed,
      }).catch(() => {
        /* non-critical */
      });
    },
    [] // reads from store at call time — no stale closure possible
  );

  return { checkScope, logCommand, lastResult, isChecking };
}
