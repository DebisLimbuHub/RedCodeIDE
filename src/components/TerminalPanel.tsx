import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, ShieldOff, ShieldCheck, AlertCircle, X } from "lucide-react";
import { clsx } from "clsx";
import { useEngagementStore } from "../stores/engagementStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useScopeCheck } from "../hooks/useScopeCheck";
import {
  getScopeGuardrailPrimaryLabel,
  createSerialTaskQueue,
  isBlockingScopeResult,
  isScopeGuardrailCancelKey,
  isIndicatorScopeResult,
  resetTrackedCommand,
  shouldSuppressGuardrailEnter,
  updateTrackedCommand,
  type BlockingScopeResult,
  type TrackedCommandState,
} from "../lib/terminalScope";
import type { ScopeCheckResult } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TerminalDataPayload {
  id: string;
  data: number[];
}

/** Payload emitted by Rust when a command is blocked at the PTY level. */
interface ScopeWarningPayload {
  session_id: string;
  command: string;
  result: ScopeCheckResult;
}

interface ScopeWarning {
  result: BlockingScopeResult;
  pendingCommand: string;
}

interface ScopeIndicator {
  result: Extract<ScopeCheckResult, { type: "Unknown" }>;
  command: string;
}

// ---------------------------------------------------------------------------
// Xterm theme
// ---------------------------------------------------------------------------

const XTERM_THEME = {
  background: "#0a0a0f",
  foreground: "#e2e8f0",
  cursor: "#e53e3e",
  cursorAccent: "#0a0a0f",
  selectionBackground: "#e53e3e33",
  black: "#1a1a2e",
  red: "#e53e3e",
  green: "#38a169",
  yellow: "#d69e2e",
  blue: "#4299e1",
  magenta: "#805ad5",
  cyan: "#00b5d8",
  white: "#e2e8f0",
  brightBlack: "#4a5568",
  brightRed: "#fc8181",
  brightGreen: "#68d391",
  brightYellow: "#f6e05e",
  brightBlue: "#90cdf4",
  brightMagenta: "#b794f4",
  brightCyan: "#76e4f7",
  brightWhite: "#f7fafc",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

function logCommandFire(
  engagementId: string,
  command: string,
  result: ScopeCheckResult,
  executed: boolean
) {
  let scopeDetail: string | null = null;
  if (result.type === "OutOfScope") scopeDetail = result.reason;
  else if (result.type === "Unknown") scopeDetail = result.message;
  else if (result.type === "PartiallyInScope") scopeDetail = result.out_of_scope.join(", ");

  invoke("log_command", {
    engagementId,
    command,
    scopeType: result.type,
    scopeDetail,
    executed,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Scope warning banner
// ---------------------------------------------------------------------------

function ScopeWarningBanner({
  warning,
  onExecute,
  onCancel,
  focusRef,
}: {
  warning: ScopeWarning;
  onExecute: () => void;
  onCancel: () => void;
  focusRef: (node: HTMLDivElement | null) => void;
}) {
  const { result } = warning;
  const isOut     = result.type === "OutOfScope";
  const isPartial = result.type === "PartiallyInScope";
  const primaryLabel = getScopeGuardrailPrimaryLabel(result);

  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      role="alertdialog"
      aria-live="assertive"
      aria-modal="false"
      onKeyDown={(event) => {
        if (isScopeGuardrailCancelKey(event.key)) {
          event.preventDefault();
          onCancel();
          return;
        }
        if (shouldSuppressGuardrailEnter(event.key, event.target === event.currentTarget)) {
          event.preventDefault();
        }
      }}
      className={clsx(
        "shrink-0 border-b px-4 py-3 text-sm shadow-lg outline-none",
        isOut
          ? "border-accent-red/40 bg-accent-red/12 text-accent-red"
          : "border-yellow-500/40 bg-yellow-500/12 text-yellow-300"
      )}
    >
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        {isOut ? (
          <ShieldOff size={14} />
        ) : isPartial ? (
          <AlertTriangle size={14} />
        ) : (
          <AlertCircle size={14} />
        )}
        <span className="font-semibold">
          {isOut ? "Out of Scope" : "Partially Out of Scope"}
        </span>
        <span className="ml-auto text-xs opacity-60">
          cmd: <code className="font-mono">{warning.pendingCommand.slice(0, 60)}</code>
        </span>
      </div>

      {/* Detail text */}
      {isOut && "reason" in result && (
        <p className="mb-2 text-xs opacity-80">{result.reason}</p>
      )}
      {isPartial && "in_scope" in result && (
        <>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-yellow-200/80">
            Blocked Targets
          </div>
          <div className="mb-2 text-xs text-accent-red">
            <ShieldOff size={11} className="mr-1 inline" />
            {result.out_of_scope.join(", ")}
          </div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent-green/80">
            Allowed Targets
          </div>
          <div className="mb-2 text-xs text-accent-green">
            <ShieldCheck size={11} className="mr-1 inline" />
            {result.in_scope.join(", ")}
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          className={clsx(
            "flex items-center gap-1 rounded px-3 py-1 text-xs font-medium",
            isOut
              ? "bg-accent-red/20 hover:bg-accent-red/30"
              : "bg-yellow-500/20 hover:bg-yellow-500/30"
          )}
          onClick={onExecute}
        >
          <ShieldOff size={11} />
          {primaryLabel}
        </button>
        <button
          className="flex items-center gap-1 rounded px-3 py-1 text-xs text-gray-400 hover:bg-surface-700"
          onClick={onCancel}
        >
          <X size={11} />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface TerminalPanelProps {
  className?: string;
}

export default function TerminalPanel({ className = "" }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const guardrailRef = useRef<HTMLDivElement | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const indicatorTimeoutRef = useRef<number | null>(null);
  const writeQueueRef = useRef(createSerialTaskQueue());
  const ctxRef = useRef<{
    term: Terminal;
    fitAddon: FitAddon;
    sessionId: string;
    unlistenData: UnlistenFn;
    unlistenExit: UnlistenFn;
    unlistenWarning: UnlistenFn;
    observer: ResizeObserver;
  } | null>(null);

  const [scopeWarning, setScopeWarning] = useState<ScopeWarning | null>(null);
  const [scopeIndicator, setScopeIndicator] = useState<ScopeIndicator | null>(null);
  const [borderFlash, setBorderFlash] = useState<"safe" | null>(null);
  const commandBufferRef = useRef<TrackedCommandState>(resetTrackedCommand());
  const scopeCheckInFlightRef = useRef(false);
  const handleTerminalInputRef = useRef<(raw: string) => Promise<void> | void>(() => {});

  // Keep a ref so the teardown callback can read the latest warning without
  // being re-created on every state change.
  const scopeWarningRef = useRef(scopeWarning);
  useEffect(() => { scopeWarningRef.current = scopeWarning; }, [scopeWarning]);
  const { checkScope, isChecking } = useScopeCheck();

  // Reactive engagement from the store — used to sync into the Rust session.
  const currentEngagement = useEngagementStore((s) => s.currentEngagement);

  // ---- Sync engagement → Rust whenever it changes -------------------------

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    invoke("set_terminal_engagement", {
      id: ctx.sessionId,
      engagementId: currentEngagement?.id ?? null,
    }).catch(() => null);
  }, [currentEngagement]);

  // ---- Disable xterm stdin while a warning banner is showing --------------

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.term.options.disableStdin = !!scopeWarning || isChecking || scopeCheckInFlightRef.current;
  }, [scopeWarning, isChecking]);

  useEffect(() => {
    if (!scopeWarning) return;
    const rafId = window.requestAnimationFrame(() => {
      guardrailRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [scopeWarning]);

  const queueTerminalText = useCallback((sessionId: string, text: string) => {
    const bytes = textEncoder.encode(text);
    return writeQueueRef.current.enqueue(() =>
      invoke("write_terminal", { id: sessionId, data: Array.from(bytes) })
        .then(() => undefined)
        .catch(() => undefined)
    );
  }, []);

  const flushTerminalWrites = useCallback(() => writeQueueRef.current.flush(), []);

  const pulseSafeBorder = useCallback(() => {
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    setBorderFlash("safe");
    flashTimeoutRef.current = window.setTimeout(() => {
      setBorderFlash(null);
      flashTimeoutRef.current = null;
    }, 450);
  }, []);

  const showScopeIndicator = useCallback((command: string, result: ScopeIndicator["result"]) => {
    if (indicatorTimeoutRef.current !== null) {
      window.clearTimeout(indicatorTimeoutRef.current);
    }
    setScopeIndicator({ command, result });
    indicatorTimeoutRef.current = window.setTimeout(() => {
      setScopeIndicator(null);
      indicatorTimeoutRef.current = null;
    }, 4000);
  }, []);

  const clearScopeIndicator = useCallback(() => {
    if (indicatorTimeoutRef.current !== null) {
      window.clearTimeout(indicatorTimeoutRef.current);
      indicatorTimeoutRef.current = null;
    }
    setScopeIndicator(null);
  }, []);

  // ---- Execute / cancel blocked command -----------------------------------

  const executeAnyway = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx || !scopeWarning) return;

    await flushTerminalWrites();
    clearScopeIndicator();

    const engagement = useEngagementStore.getState().currentEngagement;
    if (engagement) {
      logCommandFire(engagement.id, scopeWarning.pendingCommand, scopeWarning.result, true);
    }

    // force_execute sends Ctrl+U (clear shell line) + command + \r to PTY,
    // bypassing the scope check in write_terminal.
    invoke("force_execute", {
      id: ctx.sessionId,
      command: scopeWarning.pendingCommand,
    }).catch(() => null);

    commandBufferRef.current = resetTrackedCommand();
    setScopeWarning(null);
  }, [clearScopeIndicator, flushTerminalWrites, scopeWarning]);

  const cancelPending = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx || !scopeWarning) return;

    await flushTerminalWrites();
    clearScopeIndicator();

    const engagement = useEngagementStore.getState().currentEngagement;
    if (engagement) {
      logCommandFire(engagement.id, scopeWarning.pendingCommand, scopeWarning.result, false);
    }

    // Ctrl+C clears the shell's current input line.
    await queueTerminalText(ctx.sessionId, "\x03");
    commandBufferRef.current = resetTrackedCommand();
    setScopeWarning(null);
  }, [clearScopeIndicator, flushTerminalWrites, queueTerminalText, scopeWarning]);

  const handleTerminalInput = useCallback(async (raw: string) => {
    const ctx = ctxRef.current;
    if (!ctx || scopeWarningRef.current || scopeCheckInFlightRef.current) return;

    clearScopeIndicator();

    const newlineIndex = raw.search(/[\r\n]/);
    if (newlineIndex === -1) {
      commandBufferRef.current = updateTrackedCommand(commandBufferRef.current, raw);
      void queueTerminalText(ctx.sessionId, raw);
      return;
    }

    const beforeNewline = raw.slice(0, newlineIndex);
    if (beforeNewline) {
      commandBufferRef.current = updateTrackedCommand(commandBufferRef.current, beforeNewline);
      void queueTerminalText(ctx.sessionId, beforeNewline);
    }

    const command = commandBufferRef.current.value.trim();
    commandBufferRef.current = resetTrackedCommand();

    console.log(
      "[ScopeCheck] Enter | cmd:", JSON.stringify(command),
      "| engagement:", useEngagementStore.getState().currentEngagement?.id ?? "NONE"
    );

    if (!command) {
      await queueTerminalText(ctx.sessionId, raw.slice(newlineIndex));
      return;
    }

    scopeCheckInFlightRef.current = true;
    ctx.term.options.disableStdin = true;
    let keepLocked = false;

    try {
      const result = await checkScope(command);
      console.log("[ScopeCheck] result:", result ? result.type : "null (no engagement)");
      if (!result) {
        await queueTerminalText(ctx.sessionId, raw.slice(newlineIndex));
        return;
      }

      if (result.type === "InScope") {
        const engagement = useEngagementStore.getState().currentEngagement;
        if (engagement) {
          logCommandFire(engagement.id, command, result, true);
        }
        pulseSafeBorder();
        await queueTerminalText(ctx.sessionId, raw.slice(newlineIndex));
        return;
      }

      if (isIndicatorScopeResult(result)) {
        const engagement = useEngagementStore.getState().currentEngagement;
        if (engagement) {
          logCommandFire(engagement.id, command, result, true);
        }
        showScopeIndicator(command, result);
        await queueTerminalText(ctx.sessionId, raw.slice(newlineIndex));
        return;
      }

      if (isBlockingScopeResult(result)) {
        keepLocked = true;
        setScopeWarning({
          result,
          pendingCommand: command,
        });
      }
    } finally {
      scopeCheckInFlightRef.current = false;
      const currentCtx = ctxRef.current;
      if (currentCtx) {
        currentCtx.term.options.disableStdin = keepLocked || !!scopeWarningRef.current;
      }
    }
  }, [checkScope, clearScopeIndicator, pulseSafeBorder, queueTerminalText, showScopeIndicator]);

  useEffect(() => {
    handleTerminalInputRef.current = handleTerminalInput;
  }, [handleTerminalInput]);

  // ---- Teardown -----------------------------------------------------------

  const teardown = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctxRef.current = null;
    ctx.observer.disconnect();
    ctx.unlistenData();
    ctx.unlistenExit();
    ctx.unlistenWarning();
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
    if (indicatorTimeoutRef.current !== null) {
      window.clearTimeout(indicatorTimeoutRef.current);
      indicatorTimeoutRef.current = null;
    }
    useTerminalStore.getState().setActiveSessionId(null);
    invoke("close_terminal", { id: ctx.sessionId }).catch(() => null);
    ctx.term.dispose();
  }, []);

  // ---- Terminal setup (runs once on mount) --------------------------------

  useEffect(() => {
    if (!containerRef.current || ctxRef.current) return;

    let cancelled = false;

    (async () => {
      if (!containerRef.current) return;

      const term = new Terminal({
        theme: XTERM_THEME,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10_000,
        allowProposedApi: false,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      // Defer first fit one frame so the renderer dimensions are ready.
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      try { fitAddon.fit(); } catch { /* renderer not ready */ }

      const { rows, cols } = term;
      const sessionId = await invoke<string>("create_terminal", { rows, cols });

      if (cancelled) {
        invoke("close_terminal", { id: sessionId }).catch(() => null);
        term.dispose();
        return;
      }

      // Expose session ID so external components (e.g. ReconLauncher) can
      // inject commands via invoke("write_terminal", ...).
      useTerminalStore.getState().setActiveSessionId(sessionId);

      // Sync the current engagement into the new session immediately.
      const initialEngagement = useEngagementStore.getState().currentEngagement;
      if (initialEngagement) {
        invoke("set_terminal_engagement", {
          id: sessionId,
          engagementId: initialEngagement.id,
        }).catch(() => null);
      }

      // PTY output → xterm display
      const unlistenData = await listen<TerminalDataPayload>("terminal-data", (event) => {
        if (event.payload.id !== sessionId) return;
        term.write(new Uint8Array(event.payload.data));
      });

      const unlistenExit = await listen<string>("terminal-exit", (event) => {
        if (event.payload !== sessionId) return;
        term.writeln("\r\n\x1b[2m[process exited]\x1b[0m");
      });

      // Scope-warning events emitted by write_terminal when a command is blocked.
      const unlistenWarning = await listen<ScopeWarningPayload>("scope-warning", (event) => {
        if (event.payload.session_id !== sessionId) return;
        if (!isBlockingScopeResult(event.payload.result)) return;
        commandBufferRef.current = resetTrackedCommand();
        clearScopeIndicator();
        setScopeWarning({
          result: event.payload.result,
          pendingCommand: event.payload.command,
        });
      });

      // Preflight scope-check on Enter before the shell sees the newline.
      // Rust still enforces the same check at PTY level as a backup.
      term.onData((raw: string) => {
        void handleTerminalInputRef.current(raw);
      });

      // Resize observer
      const observer = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch { /* renderer may not be ready */ }
        invoke("resize_terminal", {
          id: sessionId,
          rows: term.rows,
          cols: term.cols,
        }).catch(() => null);
      });
      observer.observe(containerRef.current!);

      ctxRef.current = {
        term,
        fitAddon,
        sessionId,
        unlistenData,
        unlistenExit,
        unlistenWarning,
        observer,
      };
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [teardown]);

  // ---- Render -------------------------------------------------------------

  const warningBorder =
    scopeWarning?.result.type === "OutOfScope"
      ? "ring-1 ring-inset ring-accent-red/40"
      : scopeWarning?.result.type === "PartiallyInScope"
      ? "ring-1 ring-inset ring-yellow-500/40"
      : "";

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      {/* Scope warning banner (Rust emitted the event) */}
      {scopeWarning && (
        <ScopeWarningBanner
          warning={scopeWarning}
          onExecute={executeAnyway}
          onCancel={cancelPending}
          focusRef={(node) => {
            guardrailRef.current = node;
          }}
        />
      )}

      {/* xterm.js container */}
      <div
        className={clsx(
          "relative flex-1 overflow-hidden bg-surface-950 transition-all duration-300",
          warningBorder,
          borderFlash === "safe" && "ring-1 ring-inset ring-accent-green/50",
          scopeIndicator && "ring-1 ring-inset ring-yellow-500/20"
        )}
      >
        {scopeIndicator && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded border border-yellow-500/30 bg-surface-900/90 px-2.5 py-1 text-[11px] text-yellow-400 shadow-lg">
            <span className="font-semibold">Scope unknown</span>
          </div>
        )}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ padding: "6px 4px" }}
        />
      </div>
    </div>
  );
}
