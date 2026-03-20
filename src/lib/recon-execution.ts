import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  PaginatedReconData,
  ReconEntry,
  ScopeCheckResult,
  ScopeTarget,
} from "../types";
import type {
  ParsedReconOutput,
  ReconCommand,
  ParsedScopeTarget,
} from "./recon-commands";

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

interface TerminalDataPayload {
  id: string;
  data: number[];
}

interface ScopeWarningPayload {
  session_id: string;
  command: string;
  result: ScopeCheckResult;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconRunResult {
  command: string;
  output: string;
  exitCode: number;
  parsed: ParsedReconOutput;
  persistedReconCount: number;
  persistedScopeTargetCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const START_SENTINEL_PREFIX = "\x1eREDCODE_RECON_START_";
const END_SENTINEL_PREFIX = "\x1eREDCODE_RECON_END_";
const SENTINEL_SUFFIX = "\x1f";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeTerminalWrite(command: string): number[] {
  return Array.from(textEncoder.encode(command + "\r"));
}

export function wrapReconCommand(runId: string, command: string): string {
  return [
    "(",
    `printf $'\\x1eREDCODE_RECON_START_${runId}\\x1f\\n'`,
    ";",
    command,
    ";",
    "redcode_exit_code=$?",
    ";",
    `printf $'\\n\\x1eREDCODE_RECON_END_${runId}:%s\\x1f\\n' "$redcode_exit_code"`,
    ")",
  ].join(" ");
}

function normalizeTargetValue(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function extractHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return normalizeTargetValue(trimmed);
  }
}

function matchesScopeTarget(targetValue: string, scopeTarget: ScopeTarget): boolean {
  const candidate = extractHost(targetValue);
  const scopeValue = extractHost(scopeTarget.value);
  if (!candidate || !scopeValue) return false;

  if (candidate === scopeValue) return true;
  if (scopeTarget.target_type === "domain") {
    return candidate === scopeValue || candidate.endsWith(`.${scopeValue}`);
  }
  return false;
}

async function listScopeTargets(engagementId: string): Promise<ScopeTarget[]> {
  return invoke<ScopeTarget[]>("list_scope_targets", { engagementId });
}

async function addScopeTarget(
  engagementId: string,
  target: ParsedScopeTarget
): Promise<ScopeTarget> {
  return invoke<ScopeTarget>("create_scope_target", {
    engagementId,
    targetType: target.targetType,
    value: target.value,
    ports: null,
    protocol: null,
    inScope: target.inScope ?? true,
    notes: target.notes ?? null,
  });
}

async function addReconEntry(
  engagementId: string,
  targetId: string | null,
  dataType: string,
  value: string,
  source: string
): Promise<ReconEntry> {
  return invoke<ReconEntry>("add_recon_data", {
    engagementId,
    targetId,
    dataType,
    value,
    source,
  });
}

export async function executeReconCommand({
  sessionId,
  command,
  timeoutMs = 300_000,
}: {
  sessionId: string;
  command: string;
  timeoutMs?: number;
}): Promise<{ output: string; exitCode: number }> {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const wrappedCommand = wrapReconCommand(runId, command);
  const startMarker = `${START_SENTINEL_PREFIX}${runId}${SENTINEL_SUFFIX}`;
  const endMarkerPrefix = `${END_SENTINEL_PREFIX}${runId}:`;
  const decoder = new TextDecoder();

  return new Promise((resolve, reject) => {
    let settled = false;
    let captureStarted = false;
    let capturedOutput = "";
    let buffer = "";

    const cleanup = async () => {
      await Promise.all([unlistenDataPromise, unlistenWarningPromise].map(async (promise) => {
        try {
          const unlisten = await promise;
          unlisten();
        } catch {
          // listener setup may fail if command rejected early
        }
      }));
      window.clearTimeout(timeoutId);
    };

    const finish = async (
      handler: () => void
    ) => {
      if (settled) return;
      settled = true;
      await cleanup();
      handler();
    };

    const processBuffer = () => {
      while (buffer.length > 0) {
        if (!captureStarted) {
          const startIndex = buffer.indexOf(startMarker);
          if (startIndex === -1) {
            buffer = buffer.slice(-Math.max(startMarker.length * 2, 256));
            return;
          }
          buffer = buffer.slice(startIndex + startMarker.length);
          buffer = buffer.replace(/^\n/, "");
          captureStarted = true;
        }

        const endIndex = buffer.indexOf(endMarkerPrefix);
        if (endIndex === -1) {
          capturedOutput += buffer;
          buffer = "";
          return;
        }

        const suffixIndex = buffer.indexOf(
          SENTINEL_SUFFIX,
          endIndex + endMarkerPrefix.length
        );
        if (suffixIndex === -1) {
          capturedOutput += buffer.slice(0, endIndex);
          buffer = buffer.slice(endIndex);
          return;
        }

        capturedOutput += buffer.slice(0, endIndex);
        const exitCodeStr = buffer
          .slice(endIndex + endMarkerPrefix.length, suffixIndex)
          .trim();
        const exitCode = Number.parseInt(exitCodeStr, 10);

        void finish(() =>
          resolve({
            output: capturedOutput.trim(),
            exitCode: Number.isFinite(exitCode) ? exitCode : 1,
          })
        );
        return;
      }
    };

    const timeoutId = window.setTimeout(() => {
      void finish(() =>
        reject(new Error(`Timed out waiting for "${command}" to finish.`))
      );
    }, timeoutMs);

    const unlistenDataPromise = listen<TerminalDataPayload>("terminal-data", (event) => {
      if (event.payload.id !== sessionId || settled) return;
      buffer += decoder.decode(new Uint8Array(event.payload.data), { stream: true });
      processBuffer();
    });

    const unlistenWarningPromise = listen<ScopeWarningPayload>("scope-warning", (event) => {
      if (event.payload.session_id !== sessionId || settled) return;
      const message =
        event.payload.result.type === "OutOfScope"
          ? event.payload.result.reason
          : event.payload.result.type === "PartiallyInScope"
          ? event.payload.result.out_of_scope.join(", ")
          : event.payload.result.type === "Unknown"
          ? event.payload.result.message
          : "Command was blocked by the scope guardrail.";
      void finish(() =>
        reject(new Error(message))
      );
    });

    Promise.all([unlistenDataPromise, unlistenWarningPromise])
      .then(() =>
        invoke("write_terminal", {
          id: sessionId,
          data: encodeTerminalWrite(wrappedCommand),
        })
      )
      .catch((error) => {
        void finish(() =>
          reject(error instanceof Error ? error : new Error(String(error)))
        );
      });
  });
}

export async function persistReconCommandOutput({
  engagementId,
  command,
  params,
  output,
}: {
  engagementId: string;
  command: ReconCommand;
  params: Record<string, string>;
  output: string;
}): Promise<{ parsed: ParsedReconOutput; persistedReconCount: number; persistedScopeTargetCount: number }> {
  const parsed = command.outputParser(output, params);
  let scopeTargets = await listScopeTargets(engagementId);
  let persistedScopeTargetCount = 0;
  let persistedReconCount = 0;

  for (const target of parsed.scopeTargets) {
    const exists = scopeTargets.some(
      (existing) =>
        existing.target_type === target.targetType &&
        normalizeTargetValue(existing.value) === normalizeTargetValue(target.value)
    );

    if (exists) continue;
    const created = await addScopeTarget(engagementId, target);
    scopeTargets = [...scopeTargets, created];
    persistedScopeTargetCount += 1;
  }

  for (const entry of parsed.reconEntries) {
    const targetId =
      entry.targetValue
        ? scopeTargets.find((scopeTarget) => matchesScopeTarget(entry.targetValue ?? "", scopeTarget))?.id ?? null
        : null;

    await addReconEntry(
      engagementId,
      targetId,
      entry.dataType,
      JSON.stringify(entry.value),
      command.skill
    );
    persistedReconCount += 1;
  }

  return { parsed, persistedReconCount, persistedScopeTargetCount };
}

export async function executeAndPersistReconCommand({
  engagementId,
  sessionId,
  command,
  params,
  timeoutMs,
}: {
  engagementId: string;
  sessionId: string;
  command: ReconCommand;
  params: Record<string, string>;
  timeoutMs?: number;
}): Promise<ReconRunResult> {
  const commandString = command.buildCommand(params);
  const execution = await executeReconCommand({
    sessionId,
    command: commandString,
    timeoutMs,
  });
  const persistence = await persistReconCommandOutput({
    engagementId,
    command,
    params,
    output: execution.output,
  });

  return {
    command: commandString,
    output: execution.output,
    exitCode: execution.exitCode,
    parsed: persistence.parsed,
    persistedReconCount: persistence.persistedReconCount,
    persistedScopeTargetCount: persistence.persistedScopeTargetCount,
  };
}

export async function getPersistedSubdomainHosts(
  engagementId: string
): Promise<string[]> {
  const results = await invoke<PaginatedReconData>("get_recon_data", {
    engagementId,
    dataType: "subdomain",
    targetId: null,
    page: 1,
    perPage: 500,
  });

  return Array.from(
    new Set(
      results.data
        .map((entry) => {
          try {
            const parsed = JSON.parse(entry.value) as Record<string, unknown>;
            const subdomain = parsed.subdomain;
            return typeof subdomain === "string" ? extractHost(subdomain) : "";
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    )
  );
}
