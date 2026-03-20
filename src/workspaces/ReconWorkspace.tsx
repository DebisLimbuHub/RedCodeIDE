import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Globe,
  Server,
  Cpu,
  Shield,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
  Upload,
  Trash2,
  Copy,
  Activity,
  Network,
  FileJson,
  Key,
  Cloud,
  Link,
  Layers,
  Brain,
  X,
  Crosshair,
  Zap,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import ReconLauncher from "../components/ReconLauncher";
import TerminalPanel from "../components/TerminalPanel";
import { useEngagementStore } from "../stores/engagementStore";
import type {
  ScopeTarget,
  ReconEntry,
  ReconSummary,
  PaginatedReconData,
  ReconDataType,
} from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabId =
  | "overview"
  | "subdomains"
  | "ports"
  | "technologies"
  | "dns"
  | "certificates"
  | "raw";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "subdomains", label: "Subdomains", icon: Globe },
  { id: "ports", label: "Ports & Services", icon: Network },
  { id: "technologies", label: "Technologies", icon: Cpu },
  { id: "dns", label: "DNS Records", icon: Server },
  { id: "certificates", label: "Certificates", icon: Shield },
  { id: "raw", label: "Raw Data", icon: FileJson },
];

const TAB_TO_DTYPE: Partial<Record<TabId, ReconDataType>> = {
  subdomains: "subdomain",
  ports: "open_port",
  technologies: "technology",
  dns: "dns_record",
  certificates: "certificate",
};

const TARGET_TYPE_ICONS: Record<string, LucideIcon> = {
  ip: Server,
  cidr: Network,
  range: Network,
  domain: Globe,
  url: Link,
};

const TOOL_OPTIONS = [
  "nmap",
  "subfinder",
  "amass",
  "gobuster",
  "ffuf",
  "nuclei",
  "nuclei-json",
  "custom-json",
  "other",
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function safeParseJson(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val);
  } catch {
    return { raw: val };
  }
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function truncate(s: string, n = 60) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Target tree
// ---------------------------------------------------------------------------

interface TargetTreeProps {
  targets: ScopeTarget[];
  counts: Record<string, number>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  search: string;
  onSearchChange: (v: string) => void;
}

function TargetTree({
  targets,
  counts,
  selected,
  onSelect,
  search,
  onSearchChange,
}: TargetTreeProps) {
  const [ctx, setCtx] = useState<{ x: number; y: number; target: ScopeTarget } | null>(null);

  const filtered = targets.filter(
    (t) =>
      !search ||
      t.value.toLowerCase().includes(search.toLowerCase()) ||
      t.target_type.toLowerCase().includes(search.toLowerCase())
  );

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  function handleCtxMenu(e: React.MouseEvent, target: ScopeTarget) {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, target });
  }

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctx]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search bar */}
      <div className="p-2">
        <div className="flex items-center gap-1.5 rounded border border-surface-700 bg-surface-800 px-2 py-1.5">
          <Search size={12} className="shrink-0 text-gray-500" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter targets…"
            className="min-w-0 flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
          />
          {search && (
            <button onClick={() => onSearchChange("")}>
              <X size={12} className="text-gray-500 hover:text-gray-300" />
            </button>
          )}
        </div>
      </div>

      {/* All Targets row */}
      <button
        onClick={() => onSelect(null)}
        className={clsx(
          "flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
          selected === null
            ? "bg-accent-red/10 text-accent-red"
            : "text-gray-400 hover:bg-surface-700 hover:text-gray-200"
        )}
      >
        <Layers size={13} />
        <span className="flex-1 font-medium">All Targets</span>
        <span className="rounded bg-surface-700 px-1.5 py-0.5 text-[10px] text-gray-400">
          {totalCount}
        </span>
      </button>

      {/* Target list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-gray-600">
            {targets.length === 0 ? "No scope targets defined" : "No matches"}
          </p>
        )}
        {filtered.map((t) => {
          const Icon = TARGET_TYPE_ICONS[t.target_type] ?? Server;
          const count = counts[t.id] ?? 0;
          const isSelected = selected === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(isSelected ? null : t.id)}
              onContextMenu={(e) => handleCtxMenu(e, t)}
              className={clsx(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                isSelected
                  ? "bg-accent-red/10 text-accent-red"
                  : "text-gray-400 hover:bg-surface-700 hover:text-gray-200"
              )}
            >
              <Icon size={12} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono">{t.value}</span>
              {count > 0 && (
                <span className="shrink-0 rounded bg-surface-700 px-1.5 py-0.5 text-[10px] text-gray-400">
                  {count}
                </span>
              )}
              {!t.in_scope && (
                <span className="shrink-0 rounded bg-red-900/40 px-1 py-0.5 text-[10px] text-red-400">
                  excl
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Context menu */}
      {ctx && (
        <div
          className="fixed z-50 min-w-[160px] rounded border border-surface-600 bg-surface-800 py-1 shadow-xl"
          style={{ left: ctx.x, top: ctx.y }}
        >
          {[
            { label: "Copy value", action: () => copyText(ctx.target.value) },
            { label: "Add to scope", action: () => {} },
            { label: "Mark as interesting", action: () => {} },
          ].map(({ label, action }) => (
            <button
              key={label}
              onClick={action}
              className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-surface-700"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ summary }: { summary: ReconSummary | undefined }) {
  const cards = [
    { label: "Subdomains", value: summary?.subdomains ?? 0, icon: Globe, color: "text-blue-400" },
    { label: "Open Ports", value: summary?.open_ports ?? 0, icon: Network, color: "text-green-400" },
    { label: "Services", value: summary?.services ?? 0, icon: Server, color: "text-cyan-400" },
    { label: "Technologies", value: summary?.technologies ?? 0, icon: Cpu, color: "text-purple-400" },
    { label: "DNS Records", value: summary?.dns_records ?? 0, icon: Activity, color: "text-yellow-400" },
    { label: "Certificates", value: summary?.certificates ?? 0, icon: Shield, color: "text-orange-400" },
    { label: "API Endpoints", value: summary?.api_endpoints ?? 0, icon: Key, color: "text-pink-400" },
    { label: "Other", value: summary?.other ?? 0, icon: Cloud, color: "text-gray-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="flex flex-col gap-2 rounded border border-surface-700 bg-surface-800 p-3"
          >
            <div className="flex items-center gap-2">
              <Icon size={14} className={color} />
              <span className="text-xs text-gray-400">{label}</span>
            </div>
            <span className="text-2xl font-bold text-gray-100">{value.toLocaleString()}</span>
          </div>
        ))}
      </div>

      {(summary?.total_count ?? 0) === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Crosshair size={36} className="text-gray-700" />
          <p className="text-sm text-gray-500">No recon data yet.</p>
          <p className="text-xs text-gray-600">
            Run tools from the terminal below or import output using the Import button.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic table tab
// ---------------------------------------------------------------------------

interface ColDef {
  label: string;
  render: (entry: ReconEntry, parsed: Record<string, unknown>) => React.ReactNode;
}

function DataTable({
  entries,
  cols,
  onDelete,
}: {
  entries: ReconEntry[];
  cols: ColDef[];
  onDelete: (id: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Activity size={28} className="text-gray-700" />
        <p className="text-xs text-gray-500">No entries yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-surface-700">
            {cols.map((c) => (
              <th key={c.label} className="px-3 py-2 font-medium text-gray-400">
                {c.label}
              </th>
            ))}
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const parsed = safeParseJson(entry.value);
            return (
              <tr
                key={entry.id}
                className="border-b border-surface-700/50 hover:bg-surface-800/60"
              >
                {cols.map((c) => (
                  <td key={c.label} className="px-3 py-2 text-gray-200">
                    {c.render(entry, parsed)}
                  </td>
                ))}
                <td className="px-2 py-2">
                  <button
                    onClick={() => onDelete(entry.id)}
                    className="text-gray-600 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination bar
// ---------------------------------------------------------------------------

function Pagination({
  page,
  total,
  perPage,
  onChange,
}: {
  page: number;
  total: number;
  perPage: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-surface-700 px-3 py-2 text-xs text-gray-400">
      <span>
        {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
      </span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded px-2 py-1 hover:bg-surface-700 disabled:opacity-30"
        >
          ‹
        </button>
        <button
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="rounded px-2 py-1 hover:bg-surface-700 disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Assistant panel
// ---------------------------------------------------------------------------

interface AIPanelProps {
  engagementName: string;
  summary: ReconSummary | undefined;
}

function AIPanel({ engagementName, summary }: AIPanelProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const summaryText = summary
    ? `Subdomains: ${summary.subdomains}, Open ports: ${summary.open_ports}, Services: ${summary.services}, Technologies: ${summary.technologies}, DNS records: ${summary.dns_records}`
    : "No recon data collected yet.";

  const buttons = [
    {
      label: "Analyse attack surface",
      icon: Crosshair,
      buildPrompt: () =>
        `You are a penetration tester reviewing recon data for the engagement "${engagementName}".\n\nRecon summary:\n${summaryText}\n\nAnalyse the attack surface and identify the most critical areas to focus on. Highlight any high-risk findings or patterns.`,
    },
    {
      label: "Suggest next steps",
      icon: ChevronRight,
      buildPrompt: () =>
        `You are a penetration tester working on "${engagementName}".\n\nCurrent recon summary:\n${summaryText}\n\nBased on this data, suggest the next enumeration and reconnaissance steps. List specific tools and commands.`,
    },
    {
      label: "Identify high-value targets",
      icon: Crosshair,
      buildPrompt: () =>
        `For the engagement "${engagementName}", here is the recon summary:\n${summaryText}\n\nIdentify the highest-value targets and explain why they should be prioritised. Suggest specific attack vectors for each.`,
    },
    {
      label: "Check for known vulns",
      icon: Shield,
      buildPrompt: () =>
        `For engagement "${engagementName}", the following services were discovered:\n${summaryText}\n\nList known CVEs, common vulnerabilities, and recommended testing techniques for the identified services and technologies.`,
    },
  ];

  function handleCopy() {
    if (prompt) {
      copyText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-surface-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-accent-red" />
          <span className="text-xs font-semibold text-gray-300">AI Assistant</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {buttons.map(({ label, icon: Icon, buildPrompt }) => (
          <button
            key={label}
            onClick={() => setPrompt(buildPrompt())}
            className={clsx(
              "flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-xs transition-colors",
              prompt === buildPrompt()
                ? "border-accent-red/40 bg-accent-red/10 text-accent-red"
                : "border-surface-600 bg-surface-800 text-gray-300 hover:border-surface-500 hover:text-gray-100"
            )}
          >
            <Icon size={12} className="shrink-0" />
            {label}
          </button>
        ))}

        {prompt && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Composed Prompt
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-gray-400 hover:text-gray-200"
              >
                <Copy size={10} />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <textarea
              readOnly
              value={prompt}
              className="h-48 w-full resize-none rounded border border-surface-600 bg-surface-900 p-2 font-mono text-[10px] text-gray-300 outline-none"
            />
            <p className="text-[10px] text-gray-600">
              Copy this prompt and paste it into the Claude panel or terminal.
            </p>
          </div>
        )}

        {/* Methodology mini-checklist */}
        <div className="mt-4 rounded border border-surface-700 bg-surface-800/60 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Recon Checklist
          </p>
          {[
            "Subdomain enumeration",
            "Port scanning",
            "Service fingerprinting",
            "Technology detection",
            "DNS intelligence",
            "Certificate transparency",
            "Web application mapping",
          ].map((item) => (
            <label key={item} className="flex cursor-pointer items-center gap-2 py-0.5">
              <input
                type="checkbox"
                className="accent-accent-red"
                defaultChecked={false}
              />
              <span className="text-xs text-gray-400">{item}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

interface ImportModalProps {
  engagementId: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

function ImportModal({ engagementId, onClose, onImported }: ImportModalProps) {
  const [toolName, setToolName] = useState("nmap");
  const [rawOutput, setRawOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!rawOutput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const inserted = await invoke<ReconEntry[]>("import_recon_data", {
        engagementId,
        toolName,
        rawOutput,
      });
      onImported(inserted.length);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex w-[600px] max-w-full flex-col gap-3 rounded border border-surface-600 bg-surface-900 p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">Import Tool Output</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Tool / Format</label>
          <select
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            className="flex-1 rounded border border-surface-600 bg-surface-800 px-2 py-1.5 text-xs text-gray-200 outline-none"
          >
            {TOOL_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <textarea
          value={rawOutput}
          onChange={(e) => setRawOutput(e.target.value)}
          placeholder={
            toolName === "nmap"
              ? "Paste nmap XML output here…"
              : toolName.includes("json")
              ? "Paste JSON array here…"
              : "Paste tool output here (one entry per line)…"
          }
          rows={12}
          className="resize-none rounded border border-surface-600 bg-surface-800 p-2 font-mono text-xs text-gray-200 outline-none focus:border-accent-red/50"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-surface-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-700"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={busy || !rawOutput.trim()}
            className="rounded bg-accent-red px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-red-700"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------

export default function ReconWorkspace() {
  const { currentEngagement } = useEngagementStore();
  const qc = useQueryClient();
  const engId = currentEngagement?.id ?? "";

  // Panel sizing
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [treeSearch, setTreeSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [launcherMode, setLauncherMode] = useState<"browse" | "quickRecon" | "pipeline" | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Reset page when tab/target changes
  useEffect(() => {
    setPage(1);
  }, [activeTab, selectedTarget]);

  // ---------------------------------------------------------------------------
  // Data queries
  // ---------------------------------------------------------------------------

  const scopeTargetsQ = useQuery<ScopeTarget[]>({
    queryKey: ["scope_targets", engId],
    queryFn: () =>
      engId
        ? invoke<ScopeTarget[]>("list_scope_targets", { engagementId: engId })
        : Promise.resolve([]),
    enabled: !!engId,
  });

  const summaryQ = useQuery<ReconSummary>({
    queryKey: ["recon_summary", engId],
    queryFn: () => invoke<ReconSummary>("get_recon_summary", { engagementId: engId }),
    enabled: !!engId,
    refetchInterval: 30_000,
  });

  const dataTypeFilter = TAB_TO_DTYPE[activeTab] ?? null;

  const reconDataQ = useQuery<PaginatedReconData>({
    queryKey: ["recon_data", engId, dataTypeFilter, selectedTarget, page],
    queryFn: () =>
      invoke<PaginatedReconData>("get_recon_data", {
        engagementId: engId,
        dataType: dataTypeFilter,
        targetId: selectedTarget,
        page,
        perPage: 50,
      }),
    enabled: !!engId,
    placeholderData: (prev) => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoke("delete_recon_data", { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon_data", engId] });
      qc.invalidateQueries({ queryKey: ["recon_summary", engId] });
    },
  });

  // Counts per target (from full data, filtered only by engagement)
  const countsQ = useQuery<PaginatedReconData>({
    queryKey: ["recon_data_counts", engId],
    queryFn: () =>
      invoke<PaginatedReconData>("get_recon_data", {
        engagementId: engId,
        dataType: null,
        targetId: null,
        page: 1,
        perPage: 500,
      }),
    enabled: !!engId,
  });

  const targetCounts: Record<string, number> = {};
  (countsQ.data?.data ?? []).forEach((e) => {
    if (e.target_id) targetCounts[e.target_id] = (targetCounts[e.target_id] ?? 0) + 1;
  });

  // ---------------------------------------------------------------------------
  // Panel resize handlers
  // ---------------------------------------------------------------------------

  const handleLeftResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidth;
      const onMove = (ev: MouseEvent) =>
        setLeftWidth(Math.max(160, Math.min(480, startW + ev.clientX - startX)));
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftWidth]
  );

  const handleBottomResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = terminalHeight;
      const onMove = (ev: MouseEvent) =>
        setTerminalHeight(Math.max(80, Math.min(600, startH - (ev.clientY - startY))));
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [terminalHeight]
  );

  // ---------------------------------------------------------------------------
  // Tab content renderer
  // ---------------------------------------------------------------------------

  const entries = reconDataQ.data?.data ?? [];

  function renderTab() {
    if (!engId)
      return (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-gray-500">Select an engagement to view recon data.</p>
        </div>
      );

    if (activeTab === "overview") {
      return <OverviewTab summary={summaryQ.data} />;
    }

    if (activeTab === "raw") {
      return (
        <div className="overflow-auto font-mono text-xs text-gray-300">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-gray-600">No data.</p>
          ) : (
            <pre className="whitespace-pre-wrap break-all">
              {JSON.stringify(entries, null, 2)}
            </pre>
          )}
        </div>
      );
    }

    const colsByTab: Record<string, ColDef[]> = {
      subdomains: [
        {
          label: "Subdomain",
          render: (_, p) => (
            <span className="font-mono text-blue-300">
              {truncate(String(p.subdomain ?? p.host ?? "—"))}
            </span>
          ),
        },
        { label: "IP", render: (_, p) => <span className="font-mono">{String(p.ip ?? "—")}</span> },
        {
          label: "Source",
          render: (e) => (
            <span className="text-gray-500">{e.source ?? "—"}</span>
          ),
        },
        { label: "Discovered", render: (e) => formatDate(e.created_at) },
      ],
      ports: [
        {
          label: "Host",
          render: (_, p) => (
            <span className="font-mono text-cyan-300">{String(p.host ?? "—")}</span>
          ),
        },
        {
          label: "Port",
          render: (_, p) => (
            <span className="font-mono font-bold text-green-400">
              {String(p.port ?? "—")}/{String(p.protocol ?? "tcp")}
            </span>
          ),
        },
        {
          label: "Service",
          render: (_, p) => {
            const svc = String(p.name ?? p.service ?? "");
            const prod = String(p.product ?? "");
            const ver = String(p.version ?? "");
            return (
              <span>
                {svc}
                {prod ? ` ${prod}` : ""}
                {ver ? ` ${ver}` : ""}
              </span>
            );
          },
        },
        { label: "Source", render: (e) => <span className="text-gray-500">{e.source ?? "—"}</span> },
      ],
      technologies: [
        {
          label: "Technology",
          render: (_, p) => (
            <span className="font-medium text-purple-300">
              {truncate(String(p.technology ?? p.tech ?? p.name ?? "—"))}
            </span>
          ),
        },
        {
          label: "Version",
          render: (_, p) => String(p.version ?? "—"),
        },
        {
          label: "Confidence",
          render: (e) => `${Math.round(e.confidence * 100)}%`,
        },
        { label: "Source", render: (e) => <span className="text-gray-500">{e.source ?? "—"}</span> },
      ],
      dns: [
        {
          label: "Type",
          render: (_, p) => (
            <span className="rounded bg-surface-700 px-1.5 py-0.5 font-mono text-[10px] text-yellow-400">
              {String(p.type ?? p.record_type ?? p.dns_type ?? "?")}
            </span>
          ),
        },
        {
          label: "Name",
          render: (_, p) => (
            <span className="font-mono">{truncate(String(p.name ?? p.host ?? "—"))}</span>
          ),
        },
        { label: "Value", render: (_, p) => truncate(String(p.value ?? p.data ?? "—")) },
        { label: "Source", render: (e) => <span className="text-gray-500">{e.source ?? "—"}</span> },
      ],
      certificates: [
        {
          label: "Subject",
          render: (_, p) => (
            <span className="font-mono text-orange-300">
              {truncate(String(p.subject ?? p.common_name ?? "—"))}
            </span>
          ),
        },
        { label: "Issuer", render: (_, p) => truncate(String(p.issuer ?? "—")) },
        { label: "Expires", render: (_, p) => String(p.not_after ?? p.expiry ?? "—") },
        {
          label: "SANs",
          render: (_, p) => {
            const sans = p.san ?? p.sans;
            if (Array.isArray(sans)) return `${sans.length} names`;
            return String(sans ?? "—");
          },
        },
      ],
    };

    const cols = colsByTab[activeTab] ?? [];
    return (
      <DataTable
        entries={entries}
        cols={cols}
        onDelete={(id) => deleteMutation.mutate(id)}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-surface-950">
      {/* ── Workspace header ── */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-surface-700 bg-surface-900 px-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent-red">
          Recon
        </span>
        {currentEngagement && (
          <span className="text-xs text-gray-500">{currentEngagement.name}</span>
        )}
        <div className="flex-1" />

        {/* Quick Recon button */}
        <button
          onClick={() => setLauncherMode("quickRecon")}
          disabled={!engId}
          className="flex items-center gap-1.5 rounded border border-surface-600 px-2 py-1 text-xs text-gray-400 hover:border-accent-red/50 hover:text-accent-red disabled:opacity-40"
          title="Quick Recon — run common starting commands"
        >
          <Zap size={12} />
          Quick Recon
        </button>

        {/* Full Pipeline button */}
        <button
          onClick={() => setLauncherMode("pipeline")}
          disabled={!engId}
          className="flex items-center gap-1.5 rounded border border-surface-600 px-2 py-1 text-xs text-gray-400 hover:border-surface-500 hover:text-gray-200 disabled:opacity-40"
          title="Full Recon Pipeline"
        >
          <GitBranch size={12} />
          Pipeline
        </button>

        {/* Browse all skills */}
        <button
          onClick={() => setLauncherMode("browse")}
          disabled={!engId}
          className="flex items-center gap-1.5 rounded border border-surface-600 px-2 py-1 text-xs text-gray-400 hover:border-surface-500 hover:text-gray-200 disabled:opacity-40"
          title="Browse all recon skills"
        >
          <Search size={12} />
          Skills
        </button>

        {/* Import button */}
        <button
          onClick={() => setShowImport(true)}
          disabled={!engId}
          className="flex items-center gap-1.5 rounded border border-surface-600 px-2 py-1 text-xs text-gray-400 hover:border-surface-500 hover:text-gray-200 disabled:opacity-40"
        >
          <Upload size={12} />
          Import
        </button>

        {/* Refresh button */}
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["recon_summary", engId] });
            qc.invalidateQueries({ queryKey: ["recon_data", engId] });
          }}
          disabled={!engId}
          className="rounded border border-surface-600 p-1 text-gray-400 hover:border-surface-500 hover:text-gray-200 disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {importMsg && (
        <div className="flex items-center justify-between bg-green-900/30 px-3 py-1.5 text-xs text-green-400">
          <span>{importMsg}</span>
          <button onClick={() => setImportMsg(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel */}
        <div
          className="relative flex shrink-0 flex-col border-r border-surface-700 bg-surface-900"
          style={{ width: leftWidth }}
        >
          <div className="border-b border-surface-700 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Targets
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TargetTree
              targets={scopeTargetsQ.data ?? []}
              counts={targetCounts}
              selected={selectedTarget}
              onSelect={setSelectedTarget}
              search={treeSearch}
              onSearchChange={setTreeSearch}
            />
          </div>

          {/* Left resize handle */}
          <div
            onMouseDown={handleLeftResizeStart}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent-red/40"
          />
        </div>

        {/* Center panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex shrink-0 overflow-x-auto border-b border-surface-700 bg-surface-900">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors",
                  activeTab === id
                    ? "border-accent-red text-gray-100"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                )}
              >
                <Icon size={12} />
                {label}
                {id !== "overview" && id !== "raw" && (
                  <span className="rounded bg-surface-700 px-1 py-0.5 text-[10px] text-gray-500">
                    {id === "subdomains"
                      ? summaryQ.data?.subdomains ?? 0
                      : id === "ports"
                      ? summaryQ.data?.open_ports ?? 0
                      : id === "technologies"
                      ? summaryQ.data?.technologies ?? 0
                      : id === "dns"
                      ? summaryQ.data?.dns_records ?? 0
                      : id === "certificates"
                      ? summaryQ.data?.certificates ?? 0
                      : ""}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-auto p-4">
              {reconDataQ.isFetching && activeTab !== "overview" && (
                <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
                  <RefreshCw size={11} className="animate-spin" />
                  Loading…
                </div>
              )}
              {renderTab()}
            </div>

            {activeTab !== "overview" && activeTab !== "raw" && (
              <Pagination
                page={page}
                total={reconDataQ.data?.total ?? 0}
                perPage={50}
                onChange={setPage}
              />
            )}
          </div>
        </div>

        {/* Right panel */}
        {!rightCollapsed && (
          <div className="flex w-80 shrink-0 flex-col border-l border-surface-700 bg-surface-900">
            <AIPanel
              engagementName={currentEngagement?.name ?? "—"}
              summary={summaryQ.data}
            />
          </div>
        )}

        {/* Right collapse toggle */}
        <button
          onClick={() => setRightCollapsed((v) => !v)}
          title={rightCollapsed ? "Expand AI panel" : "Collapse AI panel"}
          className="flex shrink-0 flex-col items-center justify-center border-l border-surface-700 bg-surface-900 px-0.5 text-gray-600 hover:text-gray-300"
        >
          {rightCollapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {/* ── Bottom terminal ── */}
      <div className="shrink-0 border-t border-surface-700">
        {/* Drag + collapse handle */}
        <div
          onMouseDown={handleBottomResizeStart}
          className="flex h-5 cursor-row-resize items-center justify-between bg-surface-800 px-3"
        >
          <span className="text-[10px] text-gray-600">Terminal</span>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setTerminalCollapsed((v) => !v)}
            className="text-gray-600 hover:text-gray-300"
          >
            {terminalCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {!terminalCollapsed && (
          <div style={{ height: terminalHeight }}>
            <TerminalPanel className="h-full" />
          </div>
        )}
      </div>

      {/* ── Import modal ── */}
      {showImport && engId && (
        <ImportModal
          engagementId={engId}
          onClose={() => setShowImport(false)}
          onImported={(count) => {
            setImportMsg(`Imported ${count} new ${count === 1 ? "entry" : "entries"}.`);
            qc.invalidateQueries({ queryKey: ["recon_summary", engId] });
            qc.invalidateQueries({ queryKey: ["recon_data", engId] });
          }}
        />
      )}

      {/* ── Recon Launcher modal ── */}
      {launcherMode !== null && (
        <ReconLauncher
          initialMode={launcherMode}
          onClose={() => setLauncherMode(null)}
        />
      )}
    </div>
  );
}
