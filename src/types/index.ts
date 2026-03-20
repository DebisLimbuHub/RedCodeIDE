// Global TypeScript type definitions for RedCode IDE

export type WorkspaceId =
  | "recon"
  | "exploit"
  | "reporting"
  | "scope"
  | "evidence"
  | "settings";

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export type EngagementType = "pentest" | "red_team" | "bug_bounty" | "assessment";
export type Methodology = "PTES" | "OWASP" | "custom";
export type EngagementStatus = "active" | "paused" | "completed" | "archived";

/** Mirrors the Rust `Engagement` struct serialised by serde (snake_case). */
export interface Engagement {
  id: string;
  name: string;
  client_name: string;
  engagement_type: EngagementType;
  methodology: Methodology;
  status: EngagementStatus;
  start_date?: string;
  end_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export type TargetType = "ip" | "domain" | "url" | "cidr" | "range";
export type RuleType = "restriction" | "permission" | "note";

/** Mirrors the Rust `ScopeTarget` struct (snake_case). */
export interface ScopeTarget {
  id: string;
  engagement_id: string;
  target_type: TargetType;
  value: string;
  ports?: string;
  protocol?: string;
  in_scope: boolean;
  notes?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

/** Discriminated union mirroring the Rust `ScopeCheckResult` enum. */
export type ScopeCheckResult =
  | { type: "InScope" }
  | { type: "OutOfScope"; reason: string }
  | { type: "Unknown"; message: string }
  | { type: "PartiallyInScope"; in_scope: string[]; out_of_scope: string[] };

/** Mirrors the Rust `ScopeRule` struct (snake_case). */
export interface ScopeRule {
  id: string;
  engagement_id: string;
  rule_type: RuleType;
  description: string;
  created_at: string;
}
