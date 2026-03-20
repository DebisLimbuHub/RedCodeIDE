import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEngagementStore } from "../stores/engagementStore";
import type { ScopeCheckResult } from "../types";

export type { ScopeCheckResult };

export function useScopeCheck() {
  const [isChecking, setIsChecking] = useState(false);
  const currentEngagement = useEngagementStore((s) => s.currentEngagement);

  /** Run check_scope for the current engagement. Returns null if no engagement active. */
  const checkScope = useCallback(
    async (command: string): Promise<ScopeCheckResult | null> => {
      if (!currentEngagement) return null;
      setIsChecking(true);
      try {
        return await invoke<ScopeCheckResult>("check_scope", {
          engagementId: currentEngagement.id,
          command,
        });
      } finally {
        setIsChecking(false);
      }
    },
    [currentEngagement]
  );

  /** Persist a command execution record. Fire-and-forget — errors are silently swallowed. */
  const logCommand = useCallback(
    (command: string, result: ScopeCheckResult, executed: boolean): void => {
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
    [currentEngagement]
  );

  return { checkScope, logCommand, isChecking };
}
