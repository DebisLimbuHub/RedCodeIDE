import type { ScopeCheckResult } from "../types";

export type EscapeParseState = "normal" | "escape" | "csi";
export type BlockingScopeResult = Extract<
  ScopeCheckResult,
  { type: "OutOfScope" | "PartiallyInScope" }
>;

export interface TrackedCommandState {
  value: string;
  escapeState: EscapeParseState;
}

export function resetTrackedCommand(): TrackedCommandState {
  return {
    value: "",
    escapeState: "normal",
  };
}

export function updateTrackedCommand(
  state: TrackedCommandState,
  chunk: string
): TrackedCommandState {
  let next = state.value;
  let escapeState = state.escapeState;

  for (const char of chunk) {
    if (escapeState === "escape") {
      escapeState = char === "[" ? "csi" : "normal";
      continue;
    }

    if (escapeState === "csi") {
      if (char >= "@" && char <= "~") {
        escapeState = "normal";
      }
      continue;
    }

    switch (char) {
      case "\u007f":
      case "\b":
        next = next.slice(0, -1);
        break;
      case "\u0003":
      case "\u0015":
        next = "";
        break;
      case "\u001b":
        escapeState = "escape";
        break;
      case "\u0017": {
        const withoutTrailingSpace = next.replace(/\s+$/, "");
        next = withoutTrailingSpace.replace(/\S+$/, "");
        break;
      }
      default:
        if (char >= " " && char <= "~") {
          next += char;
        }
        break;
    }
  }

  return {
    value: next,
    escapeState,
  };
}

export function isBlockingScopeResult(
  result: ScopeCheckResult
): result is BlockingScopeResult {
  return result.type === "OutOfScope" || result.type === "PartiallyInScope";
}

export function isIndicatorScopeResult(
  result: ScopeCheckResult
): result is Extract<ScopeCheckResult, { type: "Unknown" }> {
  return result.type === "Unknown";
}

export function getScopeGuardrailPrimaryLabel(result: BlockingScopeResult): string {
  return result.type === "OutOfScope"
    ? "Execute Anyway (Out of Scope)"
    : "Execute Mixed Command Anyway";
}

export function isScopeGuardrailCancelKey(key: string): boolean {
  return key === "Escape";
}

export function shouldSuppressGuardrailEnter(
  key: string,
  targetIsContainer: boolean
): boolean {
  return key === "Enter" && targetIsContainer;
}

export interface SerialTaskQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
}

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>) {
      const next = tail.then(task, task);
      tail = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    flush() {
      return tail;
    },
  };
}
