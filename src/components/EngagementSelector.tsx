import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Plus,
  Search,
  X,
  FolderOpen,
  Archive,
  Check,
  Loader2,
} from "lucide-react";
import { clsx } from "clsx";
import {
  useEngagementStore,
  type CreateEngagementInput,
} from "../stores/engagementStore";
import type { Engagement, EngagementStatus, EngagementType, Methodology } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<EngagementType, string> = {
  pentest: "Pentest",
  red_team: "Red Team",
  bug_bounty: "Bug Bounty",
  assessment: "Assessment",
};

const TYPE_COLORS: Record<EngagementType, string> = {
  pentest: "bg-accent-red/20 text-accent-red",
  red_team: "bg-accent-orange/20 text-accent-orange",
  bug_bounty: "bg-yellow-500/20 text-yellow-400",
  assessment: "bg-blue-500/20 text-blue-400",
};

const METHOD_COLORS: Record<Methodology, string> = {
  PTES: "bg-purple-500/20 text-purple-400",
  OWASP: "bg-accent-cyan/20 text-accent-cyan",
  custom: "bg-surface-700 text-gray-400",
};

const STATUS_GROUPS: { status: EngagementStatus; label: string }[] = [
  { status: "active", label: "Active" },
  { status: "paused", label: "Paused" },
  { status: "completed", label: "Completed" },
];

const BLANK_FORM: CreateEngagementInput = {
  name: "",
  clientName: "",
  engagementType: "pentest",
  methodology: "PTES",
  startDate: null,
  endDate: null,
  notes: null,
};

// ---------------------------------------------------------------------------
// Helper: small badge
// ---------------------------------------------------------------------------

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", className)}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Engagement row
// ---------------------------------------------------------------------------

function EngagementRow({
  eng,
  isCurrent,
  onSelect,
  onArchive,
}: {
  eng: Engagement;
  isCurrent: boolean;
  onSelect: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      className={clsx(
        "group flex cursor-pointer items-center gap-2 rounded px-2 py-2 transition-colors",
        isCurrent
          ? "bg-accent-red/10 text-gray-100"
          : "text-gray-300 hover:bg-surface-700"
      )}
      onClick={onSelect}
    >
      {isCurrent ? (
        <Check size={12} className="shrink-0 text-accent-red" />
      ) : (
        <div className="w-3 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">{eng.name}</span>
          <span className="shrink-0 truncate text-[11px] text-gray-500">
            {eng.client_name}
          </span>
        </div>
        <div className="mt-0.5 flex gap-1">
          <Badge
            label={TYPE_LABELS[eng.engagement_type] ?? eng.engagement_type}
            className={TYPE_COLORS[eng.engagement_type] ?? "bg-surface-700 text-gray-400"}
          />
          <Badge
            label={eng.methodology}
            className={METHOD_COLORS[eng.methodology] ?? "bg-surface-700 text-gray-400"}
          />
        </div>
      </div>

      <button
        className="shrink-0 rounded p-1 text-gray-600 opacity-0 transition-all hover:bg-surface-600 hover:text-gray-300 group-hover:opacity-100"
        title="Archive"
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
      >
        <Archive size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New engagement form
// ---------------------------------------------------------------------------

function NewEngagementForm({
  onSave,
  onCancel,
  saving,
}: {
  onSave: (data: CreateEngagementInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<CreateEngagementInput>(BLANK_FORM);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const set = (k: keyof CreateEngagementInput, v: string | null) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const inputClass =
    "w-full rounded bg-surface-800 border border-surface-600 px-3 py-1.5 text-sm text-gray-100 " +
    "placeholder-gray-600 focus:border-accent-red focus:outline-none transition-colors";

  const labelClass = "mb-1 block text-xs text-gray-500";

  const valid = form.name.trim().length > 0 && form.clientName.trim().length > 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-100">New Engagement</span>
        <button
          className="rounded p-1 text-gray-500 hover:bg-surface-700 hover:text-gray-300"
          onClick={onCancel}
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelClass}>Engagement Name *</label>
          <input
            ref={nameRef}
            className={inputClass}
            placeholder="Q1 2026 Internal Pentest"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <label className={labelClass}>Client Name *</label>
          <input
            className={inputClass}
            placeholder="Acme Corp"
            value={form.clientName}
            onChange={(e) => set("clientName", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Type</label>
          <select
            className={inputClass}
            value={form.engagementType}
            onChange={(e) => set("engagementType", e.target.value)}
          >
            <option value="pentest">Pentest</option>
            <option value="red_team">Red Team</option>
            <option value="bug_bounty">Bug Bounty</option>
            <option value="assessment">Assessment</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>Methodology</label>
          <select
            className={inputClass}
            value={form.methodology}
            onChange={(e) => set("methodology", e.target.value)}
          >
            <option value="PTES">PTES</option>
            <option value="OWASP">OWASP</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>Start Date</label>
          <input
            type="date"
            className={inputClass}
            value={form.startDate ?? ""}
            onChange={(e) => set("startDate", e.target.value || null)}
          />
        </div>

        <div>
          <label className={labelClass}>End Date</label>
          <input
            type="date"
            className={inputClass}
            value={form.endDate ?? ""}
            onChange={(e) => set("endDate", e.target.value || null)}
          />
        </div>

        <div className="col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea
            className={clsx(inputClass, "resize-none")}
            rows={3}
            placeholder="Engagement scope, objectives, contacts…"
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || null)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          className="rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-surface-700 hover:text-gray-200"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className={clsx(
            "flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium transition-colors",
            valid && !saving
              ? "bg-accent-red text-white hover:bg-red-600"
              : "cursor-not-allowed bg-surface-700 text-gray-500"
          )}
          disabled={!valid || saving}
          onClick={() => onSave(form)}
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          Create Engagement
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EngagementSelector() {
  const { currentEngagement, engagements, loading, listEngagements, createEngagement, archiveEngagement, setCurrentEngagement } =
    useEngagementStore();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "create">("list");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Refresh list whenever modal opens
  useEffect(() => {
    if (open) {
      listEngagements("all");
      setView("list");
      setSearch("");
    }
  }, [open]);

  function handleClose() {
    setOpen(false);
    setView("list");
  }

  async function handleCreate(data: CreateEngagementInput) {
    setSaving(true);
    try {
      await createEngagement(data);
      handleClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string) {
    if (!confirm("Archive this engagement?")) return;
    await archiveEngagement(id);
  }

  const filtered = search.trim()
    ? engagements.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.client_name.toLowerCase().includes(search.toLowerCase())
      )
    : engagements;

  return (
    <>
      {/* Trigger button */}
      <button
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-gray-300 transition-colors hover:bg-surface-700 hover:text-gray-100"
        onClick={() => setOpen(true)}
      >
        <FolderOpen size={14} className="text-accent-red" />
        <span className="max-w-[220px] truncate">
          {currentEngagement ? currentEngagement.name : "Select Engagement"}
        </span>
        {currentEngagement && (
          <Badge
            label={TYPE_LABELS[currentEngagement.engagement_type] ?? currentEngagement.engagement_type}
            className={TYPE_COLORS[currentEngagement.engagement_type] ?? "bg-surface-700 text-gray-400"}
          />
        )}
        <ChevronDown size={13} className="text-gray-500" />
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            ref={modalRef}
            className="flex w-[520px] max-h-[80vh] flex-col overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-2xl"
          >
            {view === "create" ? (
              <NewEngagementForm
                onSave={handleCreate}
                onCancel={() => setView("list")}
                saving={saving}
              />
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
                  <span className="text-sm font-semibold text-gray-100">Engagements</span>
                  <div className="flex items-center gap-2">
                    <button
                      className="flex items-center gap-1 rounded bg-accent-red px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-600"
                      onClick={() => setView("create")}
                    >
                      <Plus size={12} />
                      New
                    </button>
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-surface-700 hover:text-gray-300"
                      onClick={handleClose}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Search */}
                <div className="border-b border-surface-700 px-3 py-2">
                  <div className="flex items-center gap-2 rounded bg-surface-800 px-2 py-1.5">
                    <Search size={13} className="text-gray-500" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none"
                      placeholder="Search engagements…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoFocus
                    />
                    {search && (
                      <button onClick={() => setSearch("")}>
                        <X size={12} className="text-gray-500" />
                      </button>
                    )}
                  </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  {loading ? (
                    <div className="flex items-center justify-center py-8 text-gray-600">
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-600">
                      {search ? "No results." : "No engagements yet."}
                    </div>
                  ) : (
                    STATUS_GROUPS.map(({ status, label }) => {
                      const group = filtered.filter((e) => e.status === status);
                      if (group.length === 0) return null;
                      return (
                        <div key={status} className="mb-3">
                          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                            {label}
                          </div>
                          {group.map((eng) => (
                            <EngagementRow
                              key={eng.id}
                              eng={eng}
                              isCurrent={currentEngagement?.id === eng.id}
                              onSelect={() => {
                                setCurrentEngagement(eng);
                                handleClose();
                              }}
                              onArchive={() => handleArchive(eng.id)}
                            />
                          ))}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
