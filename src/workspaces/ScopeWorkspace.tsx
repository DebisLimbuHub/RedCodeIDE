import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  Trash2,
  Upload,
  FileText,
  Target,
  ShieldCheck,
  ShieldOff,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { useEngagementStore } from "../stores/engagementStore";
import type { ScopeTarget, ScopeRule, TargetType, RuleType } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_TYPE_COLORS: Record<TargetType, string> = {
  ip: "bg-blue-500/20 text-blue-400",
  domain: "bg-accent-green/20 text-accent-green",
  url: "bg-yellow-500/20 text-yellow-400",
  cidr: "bg-purple-500/20 text-purple-400",
  range: "bg-accent-orange/20 text-accent-orange",
};

const RULE_TYPE_COLORS: Record<RuleType, string> = {
  restriction: "bg-accent-red/20 text-accent-red",
  permission: "bg-accent-green/20 text-accent-green",
  note: "bg-yellow-500/20 text-yellow-400",
};

const RULE_PRESETS: { type: RuleType; label: string; description: string }[] = [
  {
    type: "restriction",
    label: "No DoS",
    description: "No denial-of-service or stress testing against any target.",
  },
  {
    type: "restriction",
    label: "Business hours",
    description: "Testing permitted only during business hours (09:00–17:00 UTC).",
  },
  {
    type: "restriction",
    label: "No social engineering",
    description: "Social engineering attacks against staff are out of scope.",
  },
  {
    type: "restriction",
    label: "Rate limit",
    description: "Rate-limit automated scanning to ≤ 100 requests/sec per host.",
  },
  {
    type: "permission",
    label: "Credential stuffing",
    description: "Credential stuffing and brute-force attacks are in scope.",
  },
  {
    type: "note",
    label: "Emergency contact",
    description: "Emergency contact: security@client.com / +1-555-000-0000.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: TargetType }) {
  return (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
        TARGET_TYPE_COLORS[type] ?? "bg-surface-700 text-gray-400"
      )}
    >
      {type}
    </span>
  );
}

function RuleBadge({ type }: { type: RuleType }) {
  return (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
        RULE_TYPE_COLORS[type] ?? "bg-surface-700 text-gray-400"
      )}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CSV parser (client-side)
// Format: [type,]value[,ports[,protocol[,in_scope[,notes]]]]
// First row may be a header starting with "type" or "value".
// ---------------------------------------------------------------------------

interface ParsedRow {
  target_type?: string;
  value: string;
  ports?: string;
  protocol?: string;
  in_scope: boolean;
  notes?: string;
}

function parseCsvText(raw: string): ParsedRow[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const first = lines[0].toLowerCase();
  const hasHeader = first.startsWith("type") || first.startsWith("value");
  const data = hasHeader ? lines.slice(1) : lines;

  return data
    .map((line): ParsedRow | null => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      // Detect whether first column looks like a type keyword
      const knownTypes = ["ip", "domain", "url", "cidr", "range"];
      let offset = 0;
      let target_type: string | undefined;
      if (knownTypes.includes(cols[0]?.toLowerCase())) {
        target_type = cols[0].toLowerCase();
        offset = 1;
      }
      const value = cols[offset];
      if (!value) return null;
      return {
        target_type,
        value,
        ports: cols[offset + 1] || undefined,
        protocol: cols[offset + 2] || undefined,
        in_scope: cols[offset + 3]?.toLowerCase() !== "false" && cols[offset + 3] !== "0",
        notes: cols[offset + 4] || undefined,
      };
    })
    .filter((r): r is ParsedRow => r !== null);
}

// ---------------------------------------------------------------------------
// Add Target inline form
// ---------------------------------------------------------------------------

interface AddTargetFormProps {
  engagementId: string;
  onAdded: (t: ScopeTarget) => void;
  onCancel: () => void;
}

function AddTargetForm({ engagementId, onAdded, onCancel }: AddTargetFormProps) {
  const [type, setType] = useState<string>("domain");
  const [value, setValue] = useState("");
  const [ports, setPorts] = useState("");
  const [protocol, setProtocol] = useState("tcp");
  const [inScope, setInScope] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => { valueRef.current?.focus(); }, []);

  async function handleAdd() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const t = await invoke<ScopeTarget>("create_scope_target", {
        engagementId,
        targetType: type,
        value: value.trim(),
        ports: ports.trim() || null,
        protocol: protocol || null,
        inScope,
        notes: notes.trim() || null,
      });
      onAdded(t);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "rounded bg-surface-800 border border-surface-600 px-2 py-1 text-sm text-gray-100 " +
    "placeholder-gray-600 focus:border-accent-red focus:outline-none transition-colors";

  return (
    <tr className="bg-surface-800/60">
      <td className="px-3 py-2">
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
          {["ip", "domain", "url", "cidr", "range"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          ref={valueRef}
          className={clsx(inputClass, "w-full font-mono")}
          placeholder="192.168.1.0/24 or target.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") onCancel(); }}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={clsx(inputClass, "w-24 font-mono")}
          placeholder="80,443"
          value={ports}
          onChange={(e) => setPorts(e.target.value)}
        />
      </td>
      <td className="px-3 py-2">
        <select className={inputClass} value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="tcp">tcp</option>
          <option value="udp">udp</option>
          <option value="both">both</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <button
          className={clsx(
            "rounded px-2 py-0.5 text-xs font-medium",
            inScope ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"
          )}
          onClick={() => setInScope((v) => !v)}
        >
          {inScope ? "In Scope" : "Excluded"}
        </button>
      </td>
      <td className="px-3 py-2">
        <input
          className={clsx(inputClass, "w-full")}
          placeholder="Optional note"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button
            className="rounded bg-accent-red px-2 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-50"
            onClick={handleAdd}
            disabled={!value.trim() || saving}
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : "Add"}
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-surface-700 hover:text-gray-300"
            onClick={onCancel}
          >
            <X size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Bulk import modal
// ---------------------------------------------------------------------------

function BulkImportModal({
  engagementId,
  inScopeDefault,
  onImported,
  onClose,
}: {
  engagementId: string;
  inScopeDefault: boolean;
  onImported: (targets: ScopeTarget[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [inScope, setInScope] = useState(inScopeDefault);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const targets = await invoke<ScopeTarget[]>("bulk_import_targets", {
        engagementId,
        text: text.trim(),
        inScope,
      });
      onImported(targets);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-[480px] flex-col overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
          <span className="text-sm font-semibold text-gray-100">Bulk Import Targets</span>
          <button className="rounded p-1 text-gray-500 hover:bg-surface-700 hover:text-gray-300" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-gray-500">
            One target per line. Types are auto-detected (IP, CIDR, range, domain, URL).
            Lines starting with <code className="text-gray-400">#</code> are ignored.
          </p>

          <textarea
            className="h-48 w-full resize-none rounded bg-surface-800 border border-surface-600 p-3 font-mono text-sm text-gray-100 placeholder-gray-600 focus:border-accent-red focus:outline-none"
            placeholder={"192.168.1.0/24\ntarget.com\nhttps://app.target.com\n10.0.0.1-10.0.0.254"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />

          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              className="accent-accent-red"
              checked={inScope}
              onChange={(e) => setInScope(e.target.checked)}
            />
            Mark all as <span className={inScope ? "text-accent-green" : "text-accent-red"}>
              {inScope ? "in scope" : "excluded"}
            </span>
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-surface-700 px-4 py-3">
          <button
            className="rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-surface-700"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
            onClick={handleImport}
            disabled={!text.trim() || saving}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV Import modal (file-based)
// ---------------------------------------------------------------------------

function CsvImportModal({
  engagementId,
  onImported,
  onClose,
}: {
  engagementId: string;
  onImported: (targets: ScopeTarget[]) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [inScope, setInScope] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsvText(text);
    setPreview(rows);
    setError(rows.length === 0 ? "No valid rows found in file." : null);
  }

  async function handleImport() {
    if (preview.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const results: ScopeTarget[] = [];
      for (const row of preview) {
        const t = await invoke<ScopeTarget>("create_scope_target", {
          engagementId,
          targetType: row.target_type ?? "domain",
          value: row.value,
          ports: row.ports ?? null,
          protocol: row.protocol ?? null,
          inScope: row.in_scope && inScope,
          notes: row.notes ?? null,
        });
        results.push(t);
      }
      onImported(results);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-[560px] flex-col overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
          <span className="text-sm font-semibold text-gray-100">Import from CSV</span>
          <button className="rounded p-1 text-gray-500 hover:bg-surface-700 hover:text-gray-300" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-gray-500">
            CSV columns (header optional):{" "}
            <code className="rounded bg-surface-800 px-1 text-gray-300">
              [type,] value [, ports [, protocol [, in_scope [, notes]]]]
            </code>
          </p>

          <button
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-surface-600 py-6 text-sm text-gray-500 transition-colors hover:border-accent-red/50 hover:text-gray-300"
            onClick={() => fileRef.current?.click()}
          >
            <FileText size={16} />
            {preview.length > 0
              ? `${preview.length} rows loaded — click to change file`
              : "Click to select a CSV file"}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />

          {preview.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded border border-surface-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-surface-700 text-gray-500">
                    <th className="px-2 py-1 text-left">Type</th>
                    <th className="px-2 py-1 text-left">Value</th>
                    <th className="px-2 py-1 text-left">Ports</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-b border-surface-700/50 text-gray-400">
                      <td className="px-2 py-1">{r.target_type ?? "auto"}</td>
                      <td className="px-2 py-1 font-mono">{r.value}</td>
                      <td className="px-2 py-1">{r.ports ?? "—"}</td>
                    </tr>
                  ))}
                  {preview.length > 20 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-1 text-center text-gray-600">
                        + {preview.length - 20} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              className="accent-accent-red"
              checked={inScope}
              onChange={(e) => setInScope(e.target.checked)}
            />
            Override: mark all as in-scope
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-surface-700 px-4 py-3">
          <button
            className="rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-surface-700"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 rounded bg-accent-red px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
            onClick={handleImport}
            disabled={preview.length === 0 || saving}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Import {preview.length > 0 ? `${preview.length} rows` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Targets panel
// ---------------------------------------------------------------------------

function TargetsPanel({ engagementId }: { engagementId: string }) {
  const [targets, setTargets] = useState<ScopeTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [filter, setFilter] = useState("");

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      const t = await invoke<ScopeTarget[]>("list_scope_targets", { engagementId });
      setTargets(t);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadTargets(); }, [loadTargets]);

  async function toggleInScope(t: ScopeTarget) {
    const updated = await invoke<ScopeTarget>("update_scope_target", {
      id: t.id,
      targetType: t.target_type,
      value: t.value,
      ports: t.ports ?? null,
      protocol: t.protocol ?? null,
      inScope: !t.in_scope,
      notes: t.notes ?? null,
    });
    setTargets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function deleteTarget(id: string) {
    await invoke<boolean>("delete_scope_target", { id });
    setTargets((prev) => prev.filter((t) => t.id !== id));
  }

  const filtered = filter.trim()
    ? targets.filter(
        (t) =>
          t.value.toLowerCase().includes(filter.toLowerCase()) ||
          t.target_type.includes(filter.toLowerCase())
      )
    : targets;

  const inScopeCount = targets.filter((t) => t.in_scope).length;
  const excludedCount = targets.length - inScopeCount;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-700 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Targets
        </span>
        <div className="flex gap-1.5 text-[10px]">
          <span className="rounded bg-accent-green/20 px-1.5 py-0.5 text-accent-green">
            {inScopeCount} in scope
          </span>
          {excludedCount > 0 && (
            <span className="rounded bg-accent-red/20 px-1.5 py-0.5 text-accent-red">
              {excludedCount} excluded
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <input
            className="w-36 rounded bg-surface-800 border border-surface-700 px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:border-accent-red focus:outline-none"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-surface-700 hover:text-gray-200"
            onClick={() => setShowBulk(true)}
            title="Bulk import from text"
          >
            <Upload size={12} />
            Bulk
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-surface-700 hover:text-gray-200"
            onClick={() => setShowCsv(true)}
            title="Import from CSV file"
          >
            <FileText size={12} />
            CSV
          </button>
          <button
            className="flex items-center gap-1 rounded bg-accent-red px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} />
            Add Target
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-600">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-900">
              <tr className="border-b border-surface-700 text-[11px] uppercase tracking-wider text-gray-600">
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2 text-left">Ports</th>
                <th className="px-3 py-2 text-left">Protocol</th>
                <th className="px-3 py-2 text-left">Scope</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="w-8 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {showAdd && (
                <AddTargetForm
                  engagementId={engagementId}
                  onAdded={(t) => { setTargets((prev) => [...prev, t]); setShowAdd(false); }}
                  onCancel={() => setShowAdd(false)}
                />
              )}
              {filtered.length === 0 && !showAdd ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-sm text-gray-600">
                    {filter ? "No targets match the filter." : "No targets yet — add one above."}
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="group border-b border-surface-700/40 transition-colors hover:bg-surface-800/40"
                  >
                    <td className="px-3 py-2">
                      <TypeBadge type={t.target_type as TargetType} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-200">{t.value}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-400">
                      {t.ports ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {t.protocol ?? <span className="text-gray-600">all</span>}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className={clsx(
                          "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors",
                          t.in_scope
                            ? "bg-accent-green/20 text-accent-green hover:bg-accent-green/30"
                            : "bg-accent-red/20 text-accent-red hover:bg-accent-red/30"
                        )}
                        onClick={() => toggleInScope(t)}
                        title="Toggle scope"
                      >
                        {t.in_scope ? (
                          <><ShieldCheck size={10} /> In Scope</>
                        ) : (
                          <><ShieldOff size={10} /> Excluded</>
                        )}
                      </button>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-xs text-gray-500">
                      {t.notes ?? ""}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded p-1 text-gray-700 opacity-0 transition-all hover:bg-accent-red/10 hover:text-accent-red group-hover:opacity-100"
                        onClick={() => deleteTarget(t.id)}
                        title="Delete target"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {showBulk && (
        <BulkImportModal
          engagementId={engagementId}
          inScopeDefault={true}
          onImported={(ts) => setTargets((prev) => [...prev, ...ts])}
          onClose={() => setShowBulk(false)}
        />
      )}
      {showCsv && (
        <CsvImportModal
          engagementId={engagementId}
          onImported={(ts) => setTargets((prev) => [...prev, ...ts])}
          onClose={() => setShowCsv(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules panel
// ---------------------------------------------------------------------------

function RulesPanel({ engagementId }: { engagementId: string }) {
  const [rules, setRules] = useState<ScopeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [ruleType, setRuleType] = useState<RuleType>("restriction");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const r = await invoke<ScopeRule[]>("list_scope_rules", { engagementId });
      setRules(r);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { if (showAdd) descRef.current?.focus(); }, [showAdd]);

  async function handleAddRule() {
    if (!description.trim()) return;
    setSaving(true);
    try {
      const r = await invoke<ScopeRule>("create_scope_rule", {
        engagementId,
        ruleType,
        description: description.trim(),
      });
      setRules((prev) => [...prev, r]);
      setDescription("");
      setShowAdd(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPreset(preset: (typeof RULE_PRESETS)[number]) {
    const r = await invoke<ScopeRule>("create_scope_rule", {
      engagementId,
      ruleType: preset.type,
      description: preset.description,
    });
    setRules((prev) => [...prev, r]);
  }

  async function deleteRule(id: string) {
    await invoke<boolean>("delete_scope_rule", { id });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  const inputClass =
    "w-full rounded bg-surface-800 border border-surface-600 px-2 py-1.5 text-sm text-gray-100 " +
    "placeholder-gray-600 focus:border-accent-red focus:outline-none transition-colors";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-surface-700 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Rules
        </span>
        <button
          className="flex items-center gap-1 rounded bg-accent-red px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus size={12} />
          Add Rule
        </button>
      </div>

      {/* Add rule form */}
      {showAdd && (
        <div className="shrink-0 border-b border-surface-700 p-3">
          <div className="mb-2 flex gap-2">
            {(["restriction", "permission", "note"] as RuleType[]).map((t) => (
              <button
                key={t}
                className={clsx(
                  "rounded px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors",
                  ruleType === t
                    ? RULE_TYPE_COLORS[t]
                    : "bg-surface-700 text-gray-500 hover:text-gray-300"
                )}
                onClick={() => setRuleType(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            ref={descRef}
            className={clsx(inputClass, "resize-none")}
            rows={2}
            placeholder="Describe the rule…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddRule(); }
              if (e.key === "Escape") setShowAdd(false);
            }}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-surface-700"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
            <button
              className="flex items-center gap-1 rounded bg-accent-red px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
              onClick={handleAddRule}
              disabled={!description.trim() || saving}
            >
              {saving && <Loader2 size={11} className="animate-spin" />}
              Add
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-600">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <>
            {rules.length === 0 && (
              <p className="py-4 text-center text-xs text-gray-600">
                No rules yet. Add one above or use a preset below.
              </p>
            )}
            {rules.map((r) => (
              <div
                key={r.id}
                className="group mb-1.5 flex items-start gap-2 rounded px-2 py-2 hover:bg-surface-800/50"
              >
                <RuleBadge type={r.rule_type as RuleType} />
                <span className="flex-1 text-xs text-gray-300 leading-relaxed">
                  {r.description}
                </span>
                <button
                  className="shrink-0 rounded p-1 text-gray-700 opacity-0 transition-all hover:bg-accent-red/10 hover:text-accent-red group-hover:opacity-100"
                  onClick={() => deleteRule(r.id)}
                  title="Delete rule"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Presets */}
            <div className="mt-4 border-t border-surface-700 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                Common Presets
              </p>
              <div className="flex flex-col gap-1">
                {RULE_PRESETS.map((preset, i) => {
                  const already = rules.some(
                    (r) => r.description === preset.description
                  );
                  return (
                    <button
                      key={i}
                      className={clsx(
                        "flex items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                        already
                          ? "cursor-default text-gray-600"
                          : "text-gray-400 hover:bg-surface-800 hover:text-gray-200"
                      )}
                      onClick={() => !already && handleAddPreset(preset)}
                      disabled={already}
                    >
                      <RuleBadge type={preset.type} />
                      <span className="leading-relaxed">{preset.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace root
// ---------------------------------------------------------------------------

export default function ScopeWorkspace() {
  const currentEngagement = useEngagementStore((s) => s.currentEngagement);

  if (!currentEngagement) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-600">
        <Target size={40} className="opacity-20" />
        <p className="text-sm">No active engagement selected.</p>
        <p className="text-xs text-gray-700">
          Use the engagement selector in the top bar to create or select one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left — Targets (60%) */}
      <div className="flex min-w-0 flex-[3] flex-col border-r border-surface-700">
        <TargetsPanel engagementId={currentEngagement.id} />
      </div>

      {/* Right — Rules (40%) */}
      <div className="flex w-72 shrink-0 flex-col">
        <RulesPanel engagementId={currentEngagement.id} />
      </div>
    </div>
  );
}
