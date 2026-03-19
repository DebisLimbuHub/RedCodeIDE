import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Types that mirror the Rust serialised payloads
// ---------------------------------------------------------------------------

interface TerminalDataPayload {
  id: string;
  /** Vec<u8> → JSON number[] */
  data: number[];
}

// ---------------------------------------------------------------------------
// Xterm theme that matches the RedCode IDE dark palette
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
// Component
// ---------------------------------------------------------------------------

interface TerminalPanelProps {
  /** Extra Tailwind / inline classes for the outer wrapper. */
  className?: string;
}

export default function TerminalPanel({ className = "" }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Strong ref so the cleanup function can always reach the live terminal. */
  const ctxRef = useRef<{
    term: Terminal;
    fitAddon: FitAddon;
    sessionId: string;
    unlistenData: UnlistenFn;
    unlistenExit: UnlistenFn;
    observer: ResizeObserver;
  } | null>(null);

  const teardown = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctxRef.current = null;

    ctx.observer.disconnect();
    ctx.unlistenData();
    ctx.unlistenExit();
    invoke("close_terminal", { id: ctx.sessionId }).catch(() => null);
    ctx.term.dispose();
  }, []);

  useEffect(() => {
    // Guard: only run once even in React 18 StrictMode double-invoke.
    if (!containerRef.current || ctxRef.current) return;

    let cancelled = false;

    (async () => {
      if (!containerRef.current) return;

      // ---- xterm setup ---------------------------------------------------
      const term = new Terminal({
        theme: XTERM_THEME,
        fontFamily:
          '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
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
      fitAddon.fit();

      // ---- Create backend PTY session ------------------------------------
      const { rows, cols } = term;
      const sessionId = await invoke<string>("create_terminal", { rows, cols });

      if (cancelled) {
        // Effect already cleaned up while we were awaiting; destroy immediately.
        invoke("close_terminal", { id: sessionId }).catch(() => null);
        term.dispose();
        return;
      }

      // ---- Listen for PTY output ----------------------------------------
      const unlistenData = await listen<TerminalDataPayload>(
        "terminal-data",
        (event) => {
          if (event.payload.id !== sessionId) return;
          // Vec<u8> arrives as number[] — write raw bytes to xterm.
          term.write(new Uint8Array(event.payload.data));
        }
      );

      const unlistenExit = await listen<string>("terminal-exit", (event) => {
        if (event.payload !== sessionId) return;
        term.writeln("\r\n\x1b[2m[process exited]\x1b[0m");
      });

      // ---- Forward keystrokes → PTY stdin --------------------------------
      term.onData((raw: string) => {
        const bytes = Array.from(new TextEncoder().encode(raw));
        invoke("write_terminal", { id: sessionId, data: bytes }).catch(
          () => null
        );
      });

      // ---- Handle container resize → fit + notify PTY -------------------
      const observer = new ResizeObserver(() => {
        fitAddon.fit();
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
        observer,
      };
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [teardown]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden bg-surface-950 ${className}`}
      // xterm.js manages its own internal scroll — prevent double-scrollbar.
      style={{ padding: "6px 4px" }}
    />
  );
}
