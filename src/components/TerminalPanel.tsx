import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, ShieldOff, ShieldCheck, AlertCircle, X } from "lucide-react";
import { clsx } from "clsx";
import { useEngagementStore } from "../stores/engagementStore";
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
  result: ScopeCheckResult;
  pendingCommand: string;
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

function sendBytes(sessionId: string, bytes: Uint8Array) {
  invoke("write_terminal", { id: sessionId, data: Array.from(bytes) }).catch(() => null);
}

function sendText(sessionId: string, text: string) {
  sendBytes(sessionId, new TextEncoder().encode(text));
}

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
}: {
  warning: ScopeWarning;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const { result } = warning;
  const isOut     = result.type === "OutOfScope";
  const isPartial = result.type === "PartiallyInScope";

  return (
    <div
      className={clsx(
        "shrink-0 border-b px-4 py-2.5 text-sm",
        isOut
          ? "border-accent-red/30 bg-accent-red/10 text-accent-red"
          : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
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
          {isOut ? "Out of Scope" : isPartial ? "Partially Out of Scope" : "Scope Unknown"}
        </span>
        <span className="ml-auto text-xs opacity-60">
          cmd: <code className="font-mono">{warning.pendingCommand.slice(0, 60)}</code>
        </span>
      </div>

      {/* Detail text */}
      {isOut && "reason" in result && (
        <p className="mb-2 text-xs opacity-80">{result.reason}</p>
      )}
      {result.type === "Unknown" && "message" in result && (
        <p className="mb-2 text-xs opacity-80">{result.message}</p>
      )}
      {isPartial && "in_scope" in result && (
        <div className="mb-2 flex gap-4 text-xs">
          <span className="text-accent-green">
            <ShieldCheck size={11} className="mr-1 inline" />
            {result.in_scope.join(", ")}
          </span>
          <span className="text-accent-red">
            <ShieldOff size={11} className="mr-1 inline" />
            {result.out_of_scope.join(", ")}
          </span>
        </div>
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
          Execute Anyway
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

  // Keep a ref so the teardown callback can read the latest warning without
  // being re-created on every state change.
  const scopeWarningRef = useRef(scopeWarning);
  useEffect(() => { scopeWarningRef.current = scopeWarning; }, [scopeWarning]);

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
    ctx.term.options.disableStdin = !!scopeWarning;
  }, [scopeWarning]);

  // ---- Execute / cancel blocked command -----------------------------------

  const executeAnyway = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !scopeWarning) return;

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

    setScopeWarning(null);
  }, [scopeWarning]);

  const cancelPending = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !scopeWarning) return;

    const engagement = useEngagementStore.getState().currentEngagement;
    if (engagement) {
      logCommandFire(engagement.id, scopeWarning.pendingCommand, scopeWarning.result, false);
    }

    // Ctrl+C clears the shell's current input line.
    sendText(ctx.sessionId, "\x03");
    setScopeWarning(null);
  }, [scopeWarning]);

  // ---- Teardown -----------------------------------------------------------

  const teardown = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctxRef.current = null;
    ctx.observer.disconnect();
    ctx.unlistenData();
    ctx.unlistenExit();
    ctx.unlistenWarning();
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
        console.log("[ScopeCheck] Blocked:", event.payload);
        setScopeWarning({
          result: event.payload.result,
          pendingCommand: event.payload.command,
        });
      });

      // All keystrokes flow straight to write_terminal — scope logic is in Rust.
      // onData is a pure byte forwarder; no interception here.
      term.onData((raw: string) => {
        sendBytes(sessionId, new TextEncoder().encode(raw));
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

  const borderFlash =
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
        />
      )}

      {/* xterm.js container */}
      <div
        ref={containerRef}
        className={clsx(
          "flex-1 overflow-hidden bg-surface-950 transition-all duration-300",
          borderFlash
        )}
        style={{ padding: "6px 4px" }}
      />
    </div>
  );
}
