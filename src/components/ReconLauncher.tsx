/**
 * ReconLauncher — modal for browsing, configuring, and executing recon skill
 * commands in the embedded terminal.
 *
 * Injection mechanism:
 *   When the user clicks "Run", the full command string (+ \r) is written to
 *   the active PTY session via invoke("write_terminal", …).  The Rust handler
 *   performs a scope check before allowing the newline to reach the shell, so
 *   out-of-scope targets are still blocked even when launched from here.
 *
 * Pipeline:
 *   "Full Recon Pipeline" queues the ordered PIPELINE_COMMANDS, sending them
 *   one at a time.  The user clicks "Next Step" after each command finishes in
 *   the terminal, or uses the auto-advance timer.
 */

import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clsx } from "clsx";
import {
  X,
  Play,
  ChevronRight,
  SkipForward,
  Square,
  Pause,
  RotateCcw,
  Zap,
  Globe,
  Server,
  Cpu,
  Shield,
  Search,
  CheckCircle,
  Circle,
  Clock,
  AlertCircle,
  Copy,
  type LucideIcon,
} from "lucide-react";
import { useTerminalStore } from "../stores/terminalStore";
import {
  RECON_COMMANDS,
  RECON_CATEGORIES,
  QUICK_RECON_IDS,
  PIPELINE_COMMANDS,
  type ReconCommand,
  type ReconCategory,
} from "../lib/recon-commands";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LauncherMode = "browse" | "quickRecon" | "pipeline";

type PipelineStepStatus = "pending" | "running" | "done" | "skipped" | "error";

interface PipelineStep {
  command: ReconCommand;
  params: Record<string, string>;
  status: PipelineStepStatus;
}

type PipelineStatus = "idle" | "running" | "paused" | "done" | "cancelled";

// ---------------------------------------------------------------------------
// Category icon map
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<ReconCategory, LucideIcon> = {
  "Subdomain Discovery": Globe,
  "DNS & Network": Server,
  "Application Mapping": Search,
  "Technology Fingerprinting": Cpu,
  OSINT: Shield,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

async function sendCommandToTerminal(
  sessionId: string,
  commandStr: string
): Promise<void> {
  const bytes = textEncoder.encode(commandStr + "\r");
  await invoke("write_terminal", {
    id: sessionId,
    data: Array.from(bytes),
  });
}

function validateParams(
  cmd: ReconCommand,
  values: Record<string, string>
): string | null {
  for (const p of cmd.params) {
    if (p.required && !values[p.name]?.trim()) {
      return `"${p.label}" is required.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ParamForm — shared param input form
// ---------------------------------------------------------------------------

function ParamForm({
  cmd,
  values,
  onChange,
}: {
  cmd: ReconCommand;
  values: Record<string, string>;
  onChange: (name: string, val: string) => void;
}) {
  return (
    <div className="space-y-2">
      {cmd.params.map((p) => (
        <div key={p.name} className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-400">
            {p.label}
            {p.required && <span className="ml-0.5 text-accent-red">*</span>}
          </label>
          <input
            type={p.type === "number" ? "number" : "text"}
            value={values[p.name] ?? p.defaultValue ?? ""}
            onChange={(e) => onChange(p.name, e.target.value)}
            placeholder={p.placeholder}
            className="rounded border border-surface-600 bg-surface-800 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50"
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandCard — single command in browse view
// ---------------------------------------------------------------------------

function CommandCard({
  cmd,
  sessionId,
}: {
  cmd: ReconCommand;
  sessionId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const preview = cmd.buildCommand(
    Object.fromEntries(
      cmd.params.map((p) => [p.name, params[p.name] ?? p.placeholder])
    )
  );

  async function handleRun() {
    setError(null);
    const err = validateParams(cmd, params);
    if (err) { setError(err); return; }
    if (!sessionId) { setError("No active terminal session. Open the Recon workspace first."); return; }
    try {
      await sendCommandToTerminal(sessionId, cmd.buildCommand(params));
      setRan(true);
      setTimeout(() => setRan(false), 3000);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      className={clsx(
        "rounded border transition-colors",
        expanded
          ? "border-surface-500 bg-surface-800"
          : "border-surface-700 bg-surface-900 hover:border-surface-600"
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-200">{cmd.name}</span>
            <span className="rounded bg-surface-700 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
              {cmd.skill}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500 line-clamp-2">{cmd.description}</p>
        </div>
        <ChevronRight
          size={13}
          className={clsx(
            "mt-0.5 shrink-0 text-gray-600 transition-transform",
            expanded && "rotate-90"
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-surface-700 px-3 py-3 space-y-3">
          <ParamForm
            cmd={cmd}
            values={params}
            onChange={(n, v) => setParams((prev) => ({ ...prev, [n]: v }))}
          />

          {/* Command preview */}
          <div className="flex items-center gap-1.5 rounded bg-surface-950 px-2 py-1.5">
            <span className="font-mono text-[10px] text-gray-400 flex-1 truncate">{preview}</span>
            <button
              onClick={() => navigator.clipboard.writeText(preview).catch(() => {})}
              className="shrink-0 text-gray-600 hover:text-gray-300"
              title="Copy command"
            >
              <Copy size={11} />
            </button>
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <button
            onClick={handleRun}
            disabled={!sessionId}
            className={clsx(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
              ran
                ? "bg-accent-green/20 text-accent-green"
                : "bg-accent-red text-white hover:bg-red-700"
            )}
          >
            {ran ? <CheckCircle size={12} /> : <Play size={12} />}
            {ran ? "Sent to terminal" : "Run"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Recon view
// ---------------------------------------------------------------------------

function QuickReconView({ sessionId }: { sessionId: string | null }) {
  const quickCmds = RECON_COMMANDS.filter((c) => QUICK_RECON_IDS.includes(c.id));
  const [sharedParams, setSharedParams] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);

  function toggleQueue(id: string) {
    setQueue((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function runAll() {
    setError(null);
    if (!sessionId) { setError("No active terminal session."); return; }
    const toRun = queue.length > 0 ? quickCmds.filter((c) => queue.includes(c.id)) : quickCmds;

    for (const cmd of toRun) {
      const err = validateParams(cmd, sharedParams);
      if (err) { setError(`${cmd.name}: ${err}`); return; }
    }

    for (const cmd of toRun) {
      await sendCommandToTerminal(sessionId, cmd.buildCommand(sharedParams));
      setSent((prev) => [...prev, cmd.id]);
      // small delay so the terminal can process each command
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Fill in the target and click <strong className="text-gray-300">Run All</strong> to execute
        the most common starting recon commands in sequence. Tick individual commands to run a
        subset only.
      </p>

      {/* Shared param inputs (domain + url cover most quick commands) */}
      <div className="grid grid-cols-2 gap-3">
        {["domain", "url", "company_name", "org_name"].map((key) => {
          const needsKey = quickCmds.some((c) => c.params.some((p) => p.name === key));
          if (!needsKey) return null;
          const labels: Record<string, string> = {
            domain: "Target Domain",
            url: "Target URL",
            company_name: "Company Name",
            org_name: "Org / Username",
          };
          const placeholders: Record<string, string> = {
            domain: "example.com",
            url: "https://example.com",
            company_name: "Acme Corp",
            org_name: "acmecorp",
          };
          return (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-gray-400">{labels[key]}</label>
              <input
                type="text"
                value={sharedParams[key] ?? ""}
                onChange={(e) => setSharedParams((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholders[key]}
                className="rounded border border-surface-600 bg-surface-800 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50"
              />
            </div>
          );
        })}
      </div>

      {/* Command checklist */}
      <div className="space-y-1.5">
        {quickCmds.map((cmd) => {
          const isQueued = queue.length === 0 || queue.includes(cmd.id);
          const isSent = sent.includes(cmd.id);
          return (
            <label
              key={cmd.id}
              className="flex cursor-pointer items-start gap-2.5 rounded border border-surface-700 px-3 py-2 hover:border-surface-600"
            >
              <input
                type="checkbox"
                checked={isQueued}
                onChange={() => toggleQueue(cmd.id)}
                className="mt-0.5 accent-accent-red"
              />
              <div className="flex-1 min-w-0">
                <span className={clsx("text-xs font-medium", isSent ? "text-accent-green" : "text-gray-200")}>
                  {cmd.name}
                  {isSent && <CheckCircle size={11} className="ml-1.5 inline text-accent-green" />}
                </span>
                <p className="text-[11px] text-gray-600 truncate">{cmd.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={runAll}
        disabled={!sessionId}
        className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 hover:bg-red-700"
      >
        <Zap size={13} />
        Run All Discovery
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline view
// ---------------------------------------------------------------------------

function PipelineView({ sessionId }: { sessionId: string | null }) {
  const [sharedParams, setSharedParams] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<PipelineStep[]>(() =>
    PIPELINE_COMMANDS.map((cmd) => ({ command: cmd, params: {}, status: "pending" }))
  );
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  function mergedParams(step: PipelineStep): Record<string, string> {
    // Shared params fill in the gaps; step-specific params override.
    return { ...sharedParams, ...step.params };
  }

  function updateStepStatus(index: number, status: PipelineStepStatus) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, status } : s))
    );
  }

  async function runPipeline() {
    if (!sessionId) { setError("No active terminal session."); return; }
    setError(null);
    cancelRef.current = false;
    setPipelineStatus("running");

    // Reset
    setSteps((prev) => prev.map((s) => ({ ...s, status: "pending" })));
    setCurrentStep(0);

    for (let i = 0; i < steps.length; i++) {
      if (cancelRef.current) {
        setPipelineStatus("cancelled");
        return;
      }

      const step = steps[i];
      const params = mergedParams(step);

      // Validate required params
      const missingParam = step.command.params.find(
        (p) => p.required && !params[p.name]?.trim()
      );
      if (missingParam) {
        updateStepStatus(i, "skipped");
        continue;
      }

      updateStepStatus(i, "running");
      setCurrentStep(i);

      try {
        await sendCommandToTerminal(sessionId, step.command.buildCommand(params));
        // Give the terminal 800 ms before moving on (enough for the
        // write_terminal scope check to complete).
        await new Promise((r) => setTimeout(r, 800));
        updateStepStatus(i, "done");
      } catch (e) {
        updateStepStatus(i, "error");
        setError(`Step "${step.command.name}" failed: ${String(e)}`);
        setPipelineStatus("paused");
        return;
      }
    }

    setPipelineStatus("done");
  }

  function cancelPipeline() {
    cancelRef.current = true;
    setPipelineStatus("cancelled");
  }

  function resetPipeline() {
    cancelRef.current = false;
    setPipelineStatus("idle");
    setCurrentStep(0);
    setError(null);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "pending" })));
  }

  const statusIcon: Record<PipelineStepStatus, React.ReactNode> = {
    pending: <Circle size={13} className="text-gray-600" />,
    running: <Clock size={13} className="animate-pulse text-accent-red" />,
    done: <CheckCircle size={13} className="text-accent-green" />,
    skipped: <SkipForward size={13} className="text-gray-600" />,
    error: <AlertCircle size={13} className="text-red-400" />,
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        The Full Recon Pipeline runs all skill-mapped commands in order. Fill in shared target
        values below and click <strong className="text-gray-300">Start Pipeline</strong>.
        Each command is sent to the terminal in sequence — watch the terminal panel for output.
      </p>

      {/* Shared params */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { name: "domain", label: "Target Domain", placeholder: "example.com" },
          { name: "url", label: "Target URL", placeholder: "https://example.com" },
          { name: "company_name", label: "Company Name", placeholder: "Acme Corp" },
        ].map(({ name, label, placeholder }) => (
          <div key={name} className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-gray-400">{label}</label>
            <input
              type="text"
              value={sharedParams[name] ?? ""}
              disabled={pipelineStatus === "running"}
              onChange={(e) => setSharedParams((p) => ({ ...p, [name]: e.target.value }))}
              placeholder={placeholder}
              className="rounded border border-surface-600 bg-surface-800 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50 disabled:opacity-40"
            />
          </div>
        ))}
      </div>

      {/* Step list */}
      <div className="space-y-1.5">
        {steps.map((step, i) => {
          const isCurrent = i === currentStep && pipelineStatus === "running";
          return (
            <div
              key={step.command.id}
              className={clsx(
                "flex items-center gap-2.5 rounded border px-3 py-2 text-xs transition-colors",
                isCurrent
                  ? "border-accent-red/40 bg-accent-red/5"
                  : step.status === "done"
                  ? "border-surface-700 bg-surface-800/40"
                  : "border-surface-700 bg-surface-900"
              )}
            >
              <span className="shrink-0">{statusIcon[step.status]}</span>
              <span className="shrink-0 w-4 text-center text-[10px] text-gray-600">
                {i + 1}
              </span>
              <span className={clsx("flex-1 font-medium",
                step.status === "done" ? "text-gray-400 line-through" : "text-gray-200"
              )}>
                {step.command.name}
              </span>
              <span className="font-mono text-[10px] text-gray-600 truncate max-w-[120px]">
                {step.command.skill}
              </span>
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Controls */}
      <div className="flex gap-2">
        {pipelineStatus === "idle" || pipelineStatus === "cancelled" ? (
          <button
            onClick={runPipeline}
            disabled={!sessionId}
            className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 hover:bg-red-700"
          >
            <Play size={13} />
            {pipelineStatus === "cancelled" ? "Restart Pipeline" : "Start Pipeline"}
          </button>
        ) : pipelineStatus === "running" ? (
          <button
            onClick={cancelPipeline}
            className="flex items-center gap-1.5 rounded border border-red-700/50 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-900/20"
          >
            <Square size={13} />
            Cancel
          </button>
        ) : pipelineStatus === "paused" ? (
          <>
            <button
              onClick={runPipeline}
              className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
            >
              <Pause size={13} />
              Resume
            </button>
            <button
              onClick={cancelPipeline}
              className="flex items-center gap-1.5 rounded border border-surface-600 px-3 py-2 text-xs text-gray-400 hover:bg-surface-700"
            >
              <Square size={13} />
              Cancel
            </button>
          </>
        ) : null}

        {(pipelineStatus === "done" || pipelineStatus === "cancelled") && (
          <button
            onClick={resetPipeline}
            className="flex items-center gap-1.5 rounded border border-surface-600 px-3 py-2 text-xs text-gray-400 hover:bg-surface-700"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        )}

        {pipelineStatus === "done" && (
          <span className="flex items-center gap-1.5 text-xs text-accent-green">
            <CheckCircle size={13} />
            Pipeline complete
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ReconLauncher
// ---------------------------------------------------------------------------

interface ReconLauncherProps {
  /** Initial mode when the launcher opens. */
  initialMode?: LauncherMode;
  onClose: () => void;
}

export default function ReconLauncher({ initialMode = "browse", onClose }: ReconLauncherProps) {
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);

  const [mode, setMode] = useState<LauncherMode>(initialMode);
  const [activeCategory, setActiveCategory] = useState<ReconCategory>("Subdomain Discovery");
  const [search, setSearch] = useState("");

  const filteredCommands = RECON_COMMANDS.filter((c) => {
    if (c.category !== activeCategory) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.skill.toLowerCase().includes(q)
    );
  });

  const noSession = !activeSessionId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[80vh] w-[860px] max-w-[95vw] flex-col rounded border border-surface-600 bg-surface-900 shadow-2xl">
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-surface-700 px-4">
          <span className="text-sm font-semibold text-gray-100">Recon Launcher</span>
          {noSession && (
            <span className="rounded bg-yellow-900/40 px-2 py-0.5 text-[10px] text-yellow-400">
              No terminal session — open the Recon workspace first
            </span>
          )}
          <div className="flex-1" />

          {/* Mode tabs */}
          {(["browse", "quickRecon", "pipeline"] as LauncherMode[]).map((m) => {
            const labels: Record<LauncherMode, string> = {
              browse: "Browse",
              quickRecon: "Quick Recon",
              pipeline: "Full Pipeline",
            };
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  mode === m
                    ? "bg-accent-red text-white"
                    : "text-gray-400 hover:text-gray-200"
                )}
              >
                {labels[m]}
              </button>
            );
          })}

          <button onClick={onClose} className="ml-2 text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {mode === "browse" && (
            <>
              {/* Category sidebar */}
              <aside className="flex w-44 shrink-0 flex-col border-r border-surface-700 bg-surface-900 py-2">
                {RECON_CATEGORIES.map((cat) => {
                  const Icon = CATEGORY_ICONS[cat];
                  const count = RECON_COMMANDS.filter((c) => c.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => { setActiveCategory(cat); setSearch(""); }}
                      className={clsx(
                        "flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                        activeCategory === cat
                          ? "bg-accent-red/10 text-accent-red"
                          : "text-gray-400 hover:bg-surface-700 hover:text-gray-200"
                      )}
                    >
                      <Icon size={13} />
                      <span className="flex-1">{cat}</span>
                      <span className="text-[10px] text-gray-600">{count}</span>
                    </button>
                  );
                })}
              </aside>

              {/* Command list */}
              <div className="flex min-w-0 flex-1 flex-col">
                {/* Search */}
                <div className="border-b border-surface-700 p-3">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search commands…"
                    className="w-full rounded border border-surface-600 bg-surface-800 px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-accent-red/50"
                  />
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {filteredCommands.length === 0 && (
                    <p className="py-8 text-center text-xs text-gray-600">No commands match.</p>
                  )}
                  {filteredCommands.map((cmd) => (
                    <CommandCard key={cmd.id} cmd={cmd} sessionId={activeSessionId} />
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "quickRecon" && (
            <div className="flex-1 overflow-y-auto p-5">
              <QuickReconView sessionId={activeSessionId} />
            </div>
          )}

          {mode === "pipeline" && (
            <div className="flex-1 overflow-y-auto p-5">
              <PipelineView sessionId={activeSessionId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
