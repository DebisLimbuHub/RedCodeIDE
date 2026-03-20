/**
 * ReconLauncher — modal for browsing, configuring, and executing recon skill
 * commands through the active embedded terminal session.
 *
 * The launcher preserves the existing PTY injection flow, but now wraps each
 * launcher-driven run with capture markers so output can be parsed and stored
 * in recon_data / scope_targets after the command completes.
 */

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { useTerminalStore } from "../stores/terminalStore";
import { useEngagementStore } from "../stores/engagementStore";
import {
  executeAndPersistReconCommand,
  getPersistedSubdomainHosts,
  type ReconRunResult,
} from "../lib/recon-execution";
import {
  PIPELINE_DISCOVERY_IDS,
  PIPELINE_HOST_FANOUT_IDS,
  QUICK_RECON_IDS,
  RECON_CATEGORIES,
  RECON_COMMAND_BY_ID,
  RECON_COMMANDS,
  type ReconCategory,
  type ReconCommand,
} from "../lib/recon-commands";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LauncherMode = "browse" | "quickRecon" | "pipeline";
type PipelineStatus = "idle" | "running" | "paused" | "done" | "cancelled";
type PipelineStepStatus = "pending" | "running" | "done" | "skipped" | "error";

interface PipelineStep {
  key: string;
  label: string;
  command: ReconCommand;
  params: Record<string, string>;
  status: PipelineStepStatus;
  host?: string;
}

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

function validateParams(
  cmd: ReconCommand,
  values: Record<string, string>
): string | null {
  for (const param of cmd.params) {
    if (param.required && !values[param.name]?.trim()) {
      return `"${param.label}" is required.`;
    }
  }
  return null;
}

function applyParamDefaults(
  cmd: ReconCommand,
  values: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    cmd.params.map((param) => [
      param.name,
      values[param.name] ?? param.defaultValue ?? "",
    ])
  );
}

function buildPreviewParams(
  cmd: ReconCommand,
  values: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    cmd.params.map((param) => [
      param.name,
      values[param.name] ?? param.defaultValue ?? param.placeholder,
    ])
  );
}

function deriveSeedParams(initialTargetValue?: string | null): Record<string, string> {
  if (!initialTargetValue) return {};
  const trimmed = initialTargetValue.trim();
  if (!trimmed) return {};

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return {
        domain: parsed.hostname,
        url: parsed.toString(),
        company_name: parsed.hostname.replace(/\.[^.]+$/, "").replace(/[.-]+/g, " "),
      };
    } catch {
      return {};
    }
  }

  return {
    domain: trimmed,
    url: `https://${trimmed}`,
    company_name: trimmed.replace(/\.[^.]+$/, "").replace(/[.-]+/g, " "),
  };
}

function deriveCompanyName(params: Record<string, string>): string {
  if (params.company_name?.trim()) return params.company_name.trim();
  if (!params.domain?.trim()) return "";
  return params.domain
    .trim()
    .split(".")[0]
    .replace(/[-_]+/g, " ");
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).filter(Boolean))];
}

function buildPipelineDiscoverySteps(sharedParams: Record<string, string>): PipelineStep[] {
  return PIPELINE_DISCOVERY_IDS.map((id, index) => {
    const command = RECON_COMMAND_BY_ID[id];
    const params: Record<string, string> = {};

    if (id === "domain_discovery") {
      params.company_name = deriveCompanyName(sharedParams);
    }
    if (
      id === "subdomain_enumeration" ||
      id === "certificate_transparency" ||
      id === "dns_intelligence"
    ) {
      params.domain = sharedParams.domain ?? "";
    }

    return {
      key: `${id}-${index}`,
      label: command.name,
      command,
      params,
      status: "pending",
    };
  });
}

function buildPipelineHostSteps(hosts: string[]): PipelineStep[] {
  const normalizedHosts = unique(hosts.map((host) => host.trim().toLowerCase()));
  const steps: PipelineStep[] = [];

  normalizedHosts.forEach((host) => {
    PIPELINE_HOST_FANOUT_IDS.forEach((id) => {
      const command = RECON_COMMAND_BY_ID[id];
      const params: Record<string, string> = {};

      if (id === "tls_certificate_analysis") {
        params.host = host;
        params.port = "443";
      } else {
        params.url = `https://${host}`;
      }

      steps.push({
        key: `${id}-${host}`,
        label: `${command.name} • ${host}`,
        command,
        params,
        status: "pending",
        host,
      });
    });
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Shared param form
// ---------------------------------------------------------------------------

function ParamForm({
  cmd,
  values,
  onChange,
  disabled = false,
}: {
  cmd: ReconCommand;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {cmd.params.map((param) => (
        <div key={param.name} className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-400">
            {param.label}
            {param.required && <span className="ml-0.5 text-accent-red">*</span>}
          </label>
          <input
            type={param.type === "number" ? "number" : "text"}
            value={values[param.name] ?? param.defaultValue ?? ""}
            onChange={(event) => onChange(param.name, event.target.value)}
            placeholder={param.placeholder}
            disabled={disabled}
            className="rounded border border-surface-600 bg-surface-800 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50 disabled:opacity-50"
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command card
// ---------------------------------------------------------------------------

function CommandCard({
  cmd,
  sessionId,
  onRun,
}: {
  cmd: ReconCommand;
  sessionId: string | null;
  onRun: (cmd: ReconCommand, params: Record<string, string>) => Promise<ReconRunResult>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = cmd.buildCommand(buildPreviewParams(cmd, params));

  async function handleRun() {
    setError(null);
    setSuccess(null);

    const prepared = applyParamDefaults(cmd, params);
    const err = validateParams(cmd, prepared);
    if (err) {
      setError(err);
      return;
    }
    if (!sessionId) {
      setError("No active terminal session. Open the Recon workspace first.");
      return;
    }

    setBusy(true);
    try {
      const result = await onRun(cmd, prepared);
      const savedCount = result.persistedReconCount + result.persistedScopeTargetCount;
      const savedLabel = savedCount === 1 ? "1 parsed result" : `${savedCount} parsed results`;
      setSuccess(
        result.exitCode === 0
          ? `Completed and saved ${savedLabel}.`
          : `Exited ${result.exitCode}; processed ${savedLabel}.`
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
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
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-200">{cmd.name}</span>
            <span className="rounded bg-surface-700 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
              {cmd.skill}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">
            {cmd.description}
          </p>
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
        <div className="space-y-3 border-t border-surface-700 px-3 py-3">
          <ParamForm
            cmd={cmd}
            values={params}
            onChange={(name, value) =>
              setParams((previous) => ({ ...previous, [name]: value }))
            }
            disabled={busy}
          />

          <div className="flex items-center gap-1.5 rounded bg-surface-950 px-2 py-1.5">
            <span className="flex-1 truncate font-mono text-[10px] text-gray-400">
              {preview}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(preview).catch(() => {})}
              className="shrink-0 text-gray-600 hover:text-gray-300"
              title="Copy command"
            >
              <Copy size={11} />
            </button>
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {success && <p className="text-[11px] text-accent-green">{success}</p>}

          <button
            onClick={handleRun}
            disabled={!sessionId || busy}
            className={clsx(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
              success && !busy
                ? "bg-accent-green/20 text-accent-green"
                : "bg-accent-red text-white hover:bg-red-700"
            )}
          >
            {busy ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : success ? (
              <CheckCircle size={12} />
            ) : (
              <Play size={12} />
            )}
            {busy ? "Running…" : success ? "Run Again" : "Run"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Recon view
// ---------------------------------------------------------------------------

function QuickReconView({
  sessionId,
  initialParams,
  onRun,
}: {
  sessionId: string | null;
  initialParams: Record<string, string>;
  onRun: (cmd: ReconCommand, params: Record<string, string>) => Promise<ReconRunResult>;
}) {
  const quickCmds = RECON_COMMANDS.filter((cmd) => QUICK_RECON_IDS.includes(cmd.id));
  const [sharedParams, setSharedParams] = useState<Record<string, string>>(initialParams);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function toggleQueue(id: string) {
    setQueue((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    );
  }

  async function runAll() {
    setError(null);
    setSent([]);

    if (!sessionId) {
      setError("No active terminal session.");
      return;
    }

    const toRun =
      queue.length > 0
        ? quickCmds.filter((command) => queue.includes(command.id))
        : quickCmds;

    for (const command of toRun) {
      const prepared = applyParamDefaults(command, sharedParams);
      const err = validateParams(command, prepared);
      if (err) {
        setError(`${command.name}: ${err}`);
        return;
      }
    }

    setBusy(true);
    try {
      for (const command of toRun) {
        const prepared = applyParamDefaults(command, sharedParams);
        await onRun(command, prepared);
        setSent((previous) => [...previous, command.id]);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Fill in the target and click <strong className="text-gray-300">Run All</strong> to execute
        the most common starting recon commands in sequence. Parsed results are
        saved after each step.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {["domain", "url", "company_name", "org_name"].map((key) => {
          const needsKey = quickCmds.some((command) =>
            command.params.some((param) => param.name === key)
          );
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
              <label className="text-[11px] font-medium text-gray-400">
                {labels[key]}
              </label>
              <input
                type="text"
                value={sharedParams[key] ?? ""}
                onChange={(event) =>
                  setSharedParams((previous) => ({
                    ...previous,
                    [key]: event.target.value,
                  }))
                }
                placeholder={placeholders[key]}
                disabled={busy}
                className="rounded border border-surface-600 bg-surface-800 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50 disabled:opacity-50"
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {quickCmds.map((command) => {
          const isQueued = queue.length === 0 || queue.includes(command.id);
          const isSent = sent.includes(command.id);
          return (
            <label
              key={command.id}
              className="flex cursor-pointer items-start gap-2.5 rounded border border-surface-700 px-3 py-2 hover:border-surface-600"
            >
              <input
                type="checkbox"
                checked={isQueued}
                onChange={() => toggleQueue(command.id)}
                disabled={busy}
                className="mt-0.5 accent-accent-red"
              />
              <div className="min-w-0 flex-1">
                <span
                  className={clsx(
                    "text-xs font-medium",
                    isSent ? "text-accent-green" : "text-gray-200"
                  )}
                >
                  {command.name}
                  {isSent && (
                    <CheckCircle size={11} className="ml-1.5 inline text-accent-green" />
                  )}
                </span>
                <p className="truncate text-[11px] text-gray-600">{command.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={runAll}
        disabled={!sessionId || busy}
        className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 hover:bg-red-700"
      >
        {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Zap size={13} />}
        {busy ? "Running…" : "Run All Discovery"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline view
// ---------------------------------------------------------------------------

function PipelineView({
  sessionId,
  engagementId,
  initialParams,
  onRun,
}: {
  sessionId: string | null;
  engagementId: string;
  initialParams: Record<string, string>;
  onRun: (cmd: ReconCommand, params: Record<string, string>) => Promise<ReconRunResult>;
}) {
  const [sharedParams, setSharedParams] = useState<Record<string, string>>(initialParams);
  const [steps, setSteps] = useState<PipelineStep[]>(() =>
    buildPipelineDiscoverySteps(initialParams)
  );
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stepsRef = useRef<PipelineStep[]>(steps);
  const pauseRequestedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const nextIndexRef = useRef(0);
  const hostExpansionRef = useRef(false);
  const loopInFlightRef = useRef(false);

  function syncSteps(nextSteps: PipelineStep[]) {
    stepsRef.current = nextSteps;
    setSteps(nextSteps);
  }

  function updateStepStatus(index: number, status: PipelineStepStatus) {
    syncSteps(
      stepsRef.current.map((step, currentIndex) =>
        currentIndex === index ? { ...step, status } : step
      )
    );
  }

  async function maybeExpandHostSteps(seedDomain: string) {
    if (hostExpansionRef.current) return;
    const discovered = await getPersistedSubdomainHosts(engagementId);
    const hosts = unique([seedDomain, ...discovered]);
    if (hosts.length === 0) return;

    hostExpansionRef.current = true;
    syncSteps([...stepsRef.current, ...buildPipelineHostSteps(hosts)]);
  }

  async function runLoop() {
    if (loopInFlightRef.current) return;
    loopInFlightRef.current = true;

    try {
      while (nextIndexRef.current < stepsRef.current.length) {
        if (cancelRequestedRef.current) {
          setPipelineStatus("cancelled");
          return;
        }

        const step = stepsRef.current[nextIndexRef.current];
        const params = applyParamDefaults(step.command, {
          ...sharedParams,
          ...step.params,
        });

        const missing = validateParams(step.command, params);
        if (missing) {
          updateStepStatus(nextIndexRef.current, "skipped");
          nextIndexRef.current += 1;
          continue;
        }

        setCurrentStepIndex(nextIndexRef.current);
        updateStepStatus(nextIndexRef.current, "running");

        try {
          const result = await onRun(step.command, params);

          if (result.exitCode !== 0) {
            updateStepStatus(nextIndexRef.current, "error");
            setError(`Step "${step.label}" exited with status ${result.exitCode}.`);
            setPipelineStatus("paused");
            return;
          }

          updateStepStatus(nextIndexRef.current, "done");

          if (step.command.id === "dns_intelligence") {
            await maybeExpandHostSteps(params.domain ?? "");
          }
        } catch (cause) {
          updateStepStatus(nextIndexRef.current, "error");
          setError(`Step "${step.label}" failed: ${String(cause)}`);
          setPipelineStatus("paused");
          return;
        }

        nextIndexRef.current += 1;

        if (pauseRequestedRef.current) {
          pauseRequestedRef.current = false;
          setPipelineStatus("paused");
          return;
        }
      }

      setPipelineStatus("done");
    } finally {
      loopInFlightRef.current = false;
    }
  }

  async function startPipeline() {
    if (!sessionId) {
      setError("No active terminal session.");
      return;
    }

    const seededParams = {
      ...sharedParams,
      company_name: deriveCompanyName(sharedParams),
    };
    const discoverySteps = buildPipelineDiscoverySteps(seededParams);

    setSharedParams(seededParams);
    setError(null);
    setCurrentStepIndex(0);
    pauseRequestedRef.current = false;
    cancelRequestedRef.current = false;
    hostExpansionRef.current = false;
    nextIndexRef.current = 0;
    syncSteps(discoverySteps);
    setPipelineStatus("running");
    await runLoop();
  }

  async function resumePipeline() {
    if (!sessionId) {
      setError("No active terminal session.");
      return;
    }

    setError(null);
    cancelRequestedRef.current = false;
    pauseRequestedRef.current = false;

    const nextIndex = stepsRef.current.findIndex(
      (step) => step.status === "pending" || step.status === "error"
    );

    if (nextIndex === -1) {
      setPipelineStatus("done");
      return;
    }

    nextIndexRef.current = nextIndex;
    if (stepsRef.current[nextIndex]?.status === "error") {
      updateStepStatus(nextIndex, "pending");
    }

    setPipelineStatus("running");
    await runLoop();
  }

  function pausePipeline() {
    pauseRequestedRef.current = true;
  }

  function cancelPipeline() {
    cancelRequestedRef.current = true;
    if (pipelineStatus !== "running") {
      setPipelineStatus("cancelled");
    }
  }

  function resetPipeline() {
    pauseRequestedRef.current = false;
    cancelRequestedRef.current = false;
    hostExpansionRef.current = false;
    nextIndexRef.current = 0;
    setCurrentStepIndex(0);
    setError(null);
    setPipelineStatus("idle");
    syncSteps(buildPipelineDiscoverySteps(sharedParams));
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
        The Full Recon Pipeline runs discovery first, then fans out the host-level
        TLS and fingerprinting steps for each discovered host. Pause and cancel
        take effect after the current terminal command finishes.
      </p>

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
              onChange={(event) =>
                setSharedParams((previous) => ({
                  ...previous,
                  [name]: event.target.value,
                }))
              }
              placeholder={placeholder}
              className="rounded border border-surface-600 bg-surface-800 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50 disabled:opacity-40"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {steps.map((step, index) => {
          const isCurrent = index === currentStepIndex && pipelineStatus === "running";
          return (
            <div
              key={step.key}
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
              <span className="w-4 shrink-0 text-center text-[10px] text-gray-600">
                {index + 1}
              </span>
              <span
                className={clsx(
                  "flex-1 font-medium",
                  step.status === "done" ? "text-gray-400 line-through" : "text-gray-200"
                )}
              >
                {step.label}
              </span>
              <span className="max-w-[140px] truncate font-mono text-[10px] text-gray-600">
                {step.command.skill}
              </span>
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        {(pipelineStatus === "idle" || pipelineStatus === "cancelled" || pipelineStatus === "done") && (
          <button
            onClick={startPipeline}
            disabled={!sessionId}
            className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 hover:bg-red-700"
          >
            <Play size={13} />
            {pipelineStatus === "idle" ? "Start Pipeline" : "Restart Pipeline"}
          </button>
        )}

        {pipelineStatus === "running" && (
          <>
            <button
              onClick={pausePipeline}
              className="flex items-center gap-1.5 rounded border border-surface-600 px-4 py-2 text-xs font-semibold text-gray-300 hover:bg-surface-700"
            >
              <Pause size={13} />
              Pause
            </button>
            <button
              onClick={cancelPipeline}
              className="flex items-center gap-1.5 rounded border border-red-700/50 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-900/20"
            >
              <Square size={13} />
              Cancel
            </button>
          </>
        )}

        {pipelineStatus === "paused" && (
          <>
            <button
              onClick={resumePipeline}
              className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
            >
              <Play size={13} />
              Resume
            </button>
            <button
              onClick={cancelPipeline}
              className="flex items-center gap-1.5 rounded border border-red-700/50 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-900/20"
            >
              <Square size={13} />
              Cancel
            </button>
          </>
        )}

        {(pipelineStatus === "done" || pipelineStatus === "cancelled" || pipelineStatus === "paused") && (
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
// Main launcher
// ---------------------------------------------------------------------------

interface ReconLauncherProps {
  initialMode?: LauncherMode;
  initialTargetValue?: string | null;
  onClose: () => void;
}

export default function ReconLauncher({
  initialMode = "browse",
  initialTargetValue = null,
  onClose,
}: ReconLauncherProps) {
  const queryClient = useQueryClient();
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const engagementId = useEngagementStore((state) => state.currentEngagement?.id ?? "");
  const [mode, setMode] = useState<LauncherMode>(initialMode);
  const [activeCategory, setActiveCategory] = useState<ReconCategory>(
    "Subdomain Discovery"
  );
  const [search, setSearch] = useState("");

  const initialParams = useMemo(
    () => deriveSeedParams(initialTargetValue),
    [initialTargetValue]
  );

  const filteredCommands = RECON_COMMANDS.filter((command) => {
    if (command.category !== activeCategory) return false;
    if (!search) return true;
    const query = search.toLowerCase();
    return (
      command.name.toLowerCase().includes(query) ||
      command.description.toLowerCase().includes(query) ||
      command.skill.toLowerCase().includes(query)
    );
  });

  const noSession = !activeSessionId;

  async function runCommand(
    command: ReconCommand,
    params: Record<string, string>
  ): Promise<ReconRunResult> {
    if (!activeSessionId) {
      throw new Error("No active terminal session. Open the Recon workspace first.");
    }
    if (!engagementId) {
      throw new Error("No active engagement selected.");
    }

    const result = await executeAndPersistReconCommand({
      engagementId,
      sessionId: activeSessionId,
      command,
      params,
    });

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scope_targets", engagementId] }),
      queryClient.invalidateQueries({ queryKey: ["recon_summary", engagementId] }),
      queryClient.invalidateQueries({ queryKey: ["recon_data", engagementId] }),
      queryClient.invalidateQueries({ queryKey: ["recon_data_counts", engagementId] }),
    ]);

    return result;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[80vh] w-[860px] max-w-[95vw] flex-col rounded border border-surface-600 bg-surface-900 shadow-2xl">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-surface-700 px-4">
          <span className="text-sm font-semibold text-gray-100">Recon Launcher</span>
          {noSession && (
            <span className="rounded bg-yellow-900/40 px-2 py-0.5 text-[10px] text-yellow-400">
              No terminal session — open the Recon workspace first
            </span>
          )}
          <div className="flex-1" />

          {(["browse", "quickRecon", "pipeline"] as LauncherMode[]).map((value) => {
            const labels: Record<LauncherMode, string> = {
              browse: "Browse",
              quickRecon: "Quick Recon",
              pipeline: "Full Pipeline",
            };
            return (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={clsx(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  mode === value
                    ? "bg-accent-red text-white"
                    : "text-gray-400 hover:text-gray-200"
                )}
              >
                {labels[value]}
              </button>
            );
          })}

          <button onClick={onClose} className="ml-2 text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {mode === "browse" && (
            <>
              <aside className="flex w-44 shrink-0 flex-col border-r border-surface-700 bg-surface-900 py-2">
                {RECON_CATEGORIES.map((category) => {
                  const Icon = CATEGORY_ICONS[category];
                  const count = RECON_COMMANDS.filter(
                    (command) => command.category === category
                  ).length;
                  return (
                    <button
                      key={category}
                      onClick={() => {
                        setActiveCategory(category);
                        setSearch("");
                      }}
                      className={clsx(
                        "flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                        activeCategory === category
                          ? "bg-accent-red/10 text-accent-red"
                          : "text-gray-400 hover:bg-surface-700 hover:text-gray-200"
                      )}
                    >
                      <Icon size={13} />
                      <span className="flex-1">{category}</span>
                      <span className="text-[10px] text-gray-600">{count}</span>
                    </button>
                  );
                })}
              </aside>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="border-b border-surface-700 p-3">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search commands…"
                    className="w-full rounded border border-surface-600 bg-surface-800 px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-accent-red/50"
                  />
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {filteredCommands.length === 0 && (
                    <p className="py-8 text-center text-xs text-gray-600">
                      No commands match.
                    </p>
                  )}
                  {filteredCommands.map((command) => (
                    <CommandCard
                      key={command.id}
                      cmd={command}
                      sessionId={activeSessionId}
                      onRun={runCommand}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === "quickRecon" && (
            <div className="flex-1 overflow-y-auto p-5">
              <QuickReconView
                sessionId={activeSessionId}
                initialParams={initialParams}
                onRun={runCommand}
              />
            </div>
          )}

          {mode === "pipeline" && (
            <div className="flex-1 overflow-y-auto p-5">
              <PipelineView
                sessionId={activeSessionId}
                engagementId={engagementId}
                initialParams={initialParams}
                onRun={runCommand}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
