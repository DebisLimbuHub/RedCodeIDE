use crate::db::DbState;
use chrono::{Timelike, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ScopeCheckResult {
    InScope,
    OutOfScope {
        reason: String,
    },
    Unknown {
        message: String,
    },
    PartiallyInScope {
        in_scope: Vec<String>,
        out_of_scope: Vec<String>,
    },
}

// ---------------------------------------------------------------------------
// Internal DB row structs
// ---------------------------------------------------------------------------

struct ScopeEntry {
    target_type: String,
    value: String,
    in_scope: bool,
}

struct RuleEntry {
    rule_type: String,
    description: String,
}

#[derive(Debug)]
enum TargetVerdict {
    InScope,
    Excluded(String),
    Unknown,
}

// ---------------------------------------------------------------------------
// IPv4 helpers
// ---------------------------------------------------------------------------

fn looks_like_ip(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok())
}

fn parse_ipv4(s: &str) -> Option<u32> {
    let s = s.trim();
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let octets: Option<Vec<u8>> = parts.iter().map(|p| p.parse::<u8>().ok()).collect();
    octets.map(|o| u32::from_be_bytes([o[0], o[1], o[2], o[3]]))
}

fn ip_in_cidr(ip: u32, cidr: &str) -> bool {
    let slash = match cidr.find('/') {
        Some(p) => p,
        None => return false,
    };
    let net = match parse_ipv4(&cidr[..slash]) {
        Some(v) => v,
        None => return false,
    };
    let prefix: u32 = match cidr[slash + 1..].parse::<u8>() {
        Ok(v) if v <= 32 => v as u32,
        _ => return false,
    };
    let mask: u32 = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix)
    };
    (ip & mask) == (net & mask)
}

fn ip_in_range(ip: u32, range: &str) -> bool {
    let parts: Vec<&str> = range.splitn(2, '-').collect();
    if parts.len() != 2 {
        return false;
    }
    // Full range: 10.0.0.1-10.0.0.254
    if let (Some(start), Some(end)) = (parse_ipv4(parts[0].trim()), parse_ipv4(parts[1].trim())) {
        return ip >= start && ip <= end;
    }
    // Last-octet shorthand: 192.168.1.1-254
    if let Some(start) = parse_ipv4(parts[0].trim()) {
        if let Ok(last) = parts[1].trim().parse::<u8>() {
            let end = (start & 0xFFFF_FF00) | (last as u32);
            return ip >= start && ip <= end;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

fn looks_like_domain(s: &str) -> bool {
    if !s.contains('.') || s.contains('/') || s.contains(':') {
        return false;
    }
    if looks_like_ip(s) {
        return false;
    }
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() < 2 || parts[0].is_empty() {
        return false;
    }
    let tld = parts.last().unwrap();
    if tld.len() < 2 || tld.len() > 6 {
        return false;
    }
    s.chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '*')
}

fn domain_matches(target: &str, scope_entry: &str) -> bool {
    let t = target.trim_end_matches('.').to_lowercase();
    let s = scope_entry.trim_end_matches('.').to_lowercase();

    if s.starts_with("*.") {
        let base = &s[2..];
        return t.ends_with(&format!(".{base}")) || t == base;
    }
    t == s || t.ends_with(&format!(".{s}"))
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

fn extract_host_from_url(url: &str) -> Option<String> {
    let after_scheme = if let Some(pos) = url.find("://") {
        &url[pos + 3..]
    } else {
        url
    };
    let host_part = after_scheme.split('/').next()?;
    let host_part = host_part.split('@').last().unwrap_or(host_part);
    // Strip port suffix
    if let Some(colon) = host_part.rfind(':') {
        if host_part[colon + 1..].parse::<u16>().is_ok() {
            return Some(host_part[..colon].to_string());
        }
    }
    Some(host_part.to_string())
}

// ---------------------------------------------------------------------------
// Per-target verdict
// ---------------------------------------------------------------------------

fn check_ip_target(ip_str: &str, entries: &[ScopeEntry]) -> TargetVerdict {
    let ip = match parse_ipv4(ip_str) {
        Some(v) => v,
        None => return TargetVerdict::Unknown,
    };

    let mut excluded: Option<String> = None;
    let mut matched = false;

    for e in entries {
        let hits = match e.target_type.as_str() {
            "ip" => parse_ipv4(&e.value) == Some(ip),
            "cidr" => ip_in_cidr(ip, &e.value),
            "range" => ip_in_range(ip, &e.value),
            "url" => extract_host_from_url(&e.value).and_then(|host| parse_ipv4(&host)) == Some(ip),
            _ => false,
        };
        if hits {
            if !e.in_scope {
                excluded = Some(format!("{ip_str} matches excluded entry '{}'", e.value));
            } else {
                matched = true;
            }
        }
    }

    if let Some(r) = excluded {
        return TargetVerdict::Excluded(r);
    }
    if matched {
        TargetVerdict::InScope
    } else {
        TargetVerdict::Unknown
    }
}

fn check_domain_target(domain: &str, entries: &[ScopeEntry]) -> TargetVerdict {
    let domain_lower = domain.to_lowercase();
    let mut excluded: Option<String> = None;
    let mut matched = false;

    for e in entries {
        let hits = match e.target_type.as_str() {
            "domain" => domain_matches(&domain_lower, &e.value),
            "url" => extract_host_from_url(&e.value)
                .map(|host| domain_matches(&domain_lower, &host))
                .unwrap_or(false),
            _ => false,
        };
        if hits {
            if !e.in_scope {
                excluded = Some(format!("{domain} matches excluded entry '{}'", e.value));
            } else {
                matched = true;
            }
        }
    }

    if let Some(r) = excluded {
        return TargetVerdict::Excluded(r);
    }
    if matched {
        TargetVerdict::InScope
    } else {
        TargetVerdict::Unknown
    }
}

fn check_url_target(url: &str, entries: &[ScopeEntry]) -> TargetVerdict {
    match extract_host_from_url(url) {
        Some(host) if looks_like_ip(&host) => check_ip_target(&host, entries),
        Some(host) => check_domain_target(&host, entries),
        None => TargetVerdict::Unknown,
    }
}

fn check_single_target(target: &str, entries: &[ScopeEntry]) -> TargetVerdict {
    let t = target.trim();

    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("ftp://") {
        return check_url_target(t, entries);
    }

    // IP range: 10.0.0.1-10.0.0.254 or 192.168.1.1-254
    if t.contains('-') {
        if let Some(start_part) = t.splitn(2, '-').next() {
            if looks_like_ip(start_part.trim()) {
                return check_ip_target(start_part.trim(), entries);
            }
        }
    }

    // CIDR: extract network address
    if let Some(slash) = t.find('/') {
        if looks_like_ip(&t[..slash]) {
            return check_ip_target(&t[..slash], entries);
        }
    }

    if looks_like_ip(t) {
        return check_ip_target(t, entries);
    }

    if looks_like_domain(t) {
        return check_domain_target(t, entries);
    }

    TargetVerdict::Unknown
}

// ---------------------------------------------------------------------------
// Command parser helpers
// ---------------------------------------------------------------------------

fn extract_flag_value(parts: &[&str], flags: &[&str]) -> Vec<String> {
    for (i, &part) in parts.iter().enumerate() {
        for &flag in flags {
            if let Some(val) = part.strip_prefix(&format!("{flag}=")) {
                return vec![val.to_string()];
            }
        }
        if flags.iter().any(|&f| f == part) {
            if let Some(&next) = parts.get(i + 1) {
                if !next.starts_with('-') {
                    return vec![next.to_string()];
                }
            }
        }
    }
    vec![]
}

/// Extract positional args that look like targets, skipping flags and their values.
fn extract_positional_targets(parts: &[&str], consuming_flags: &[&str]) -> Vec<String> {
    let mut skip_next = false;
    let mut targets = Vec::new();
    for (i, &part) in parts.iter().enumerate() {
        if i == 0 {
            continue;
        }
        if skip_next {
            skip_next = false;
            continue;
        }
        // Flag=value — don't skip next
        let base = part.split('=').next().unwrap_or(part);
        if consuming_flags.contains(&base) && !part.contains('=') {
            skip_next = true;
            continue;
        }
        if part.starts_with('-') {
            continue;
        }
        if looks_like_ip(part)
            || looks_like_domain(part)
            || looks_like_ip(part.split('/').next().unwrap_or(""))
            || part.starts_with("http://")
            || part.starts_with("https://")
        {
            targets.push(part.to_string());
        }
    }
    targets
}

// ---------------------------------------------------------------------------
// Tool-specific extractors
// ---------------------------------------------------------------------------

pub fn extract_targets_from_command(command: &str) -> Vec<String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return vec![];
    }

    let tool = parts[0].split('/').last().unwrap_or(parts[0]);

    match tool {
        "nmap" => extract_positional_targets(
            &parts,
            &[
                "-p",
                "--port",
                "-e",
                "--interface",
                "-D",
                "-S",
                "--source",
                "--exclude",
                "--excludefile",
                "-iL",
                "--inputfile",
                "-oN",
                "-oX",
                "-oG",
                "-oA",
                "-oJ",
                "-oS",
                "--max-retries",
                "--host-timeout",
                "--scan-delay",
                "--min-rate",
                "--max-rate",
                "-T",
            ],
        ),
        "masscan" => extract_positional_targets(
            &parts,
            &[
                "-p", "--ports", "-c", "--config", "-oB", "-oJ", "-oL", "-oX", "--rate",
            ],
        ),
        "curl" => {
            let mut t = extract_flag_value(&parts, &["-u", "--url"]);
            if t.is_empty() {
                t = extract_positional_targets(
                    &parts,
                    &[
                        "-H",
                        "--header",
                        "-d",
                        "--data",
                        "-o",
                        "--output",
                        "-u",
                        "--user",
                        "-x",
                        "--proxy",
                        "-A",
                        "--user-agent",
                        "-X",
                    ],
                );
            }
            t
        }
        "wget" => extract_positional_targets(
            &parts,
            &[
                "-O",
                "--output-document",
                "-P",
                "--directory-prefix",
                "-U",
                "--user-agent",
                "--header",
            ],
        ),
        "http" | "https" => {
            // HTTPie: http [METHOD] URL
            parts
                .iter()
                .skip(1)
                .filter(|&&p| {
                    p.starts_with("http://")
                        || p.starts_with("https://")
                        || (!p.starts_with('-') && (looks_like_ip(p) || looks_like_domain(p)))
                })
                .take(1)
                .map(|s| s.to_string())
                .collect()
        }
        "nikto" => extract_flag_value(&parts, &["-h", "--host", "-H"]),
        "sqlmap" => extract_flag_value(&parts, &["-u", "--url"]),
        "gobuster" | "ffuf" | "feroxbuster" | "dirsearch" | "wfuzz" | "dirb" => {
            extract_flag_value(&parts, &["-u", "--url", "-U"])
        }
        "nuclei" => extract_flag_value(&parts, &["-u", "--target", "--url"]),
        "amass" | "subfinder" | "assetfinder" | "findomain" | "knockpy" => {
            let mut t = extract_flag_value(&parts, &["-d", "--domain", "-D"]);
            t.retain(|v| looks_like_domain(v));
            t
        }
        "crackmapexec" | "cme" => {
            // crackmapexec smb <target> [opts]
            if parts.len() >= 3 {
                vec![parts[2].to_string()]
            } else {
                vec![]
            }
        }
        "hydra" | "medusa" => extract_positional_targets(
            &parts,
            &[
                "-l", "-L", "-p", "-P", "-e", "-o", "-f", "-t", "-T", "-w", "-W", "-m",
            ],
        ),
        "ssh" | "ftp" | "telnet" | "nc" | "ncat" | "netcat" => {
            extract_positional_targets(&parts, &["-p", "-l", "-e", "-i"])
        }
        "ping" | "ping6" | "traceroute" | "tracert" | "mtr" => {
            extract_positional_targets(&parts, &["-c", "-i", "-t", "-s", "-n", "-w", "-I"])
        }
        "host" | "dig" | "nslookup" | "whois" => parts
            .iter()
            .skip(1)
            .filter(|&&p| !p.starts_with('-') && (looks_like_ip(p) || looks_like_domain(p)))
            .take(1)
            .map(|s| s.to_string())
            .collect(),
        "smbclient" | "rpcclient" | "smbmap" | "enum4linux" => {
            let mut t = extract_flag_value(&parts, &["-H", "--host"]);
            for &p in parts.iter().skip(1) {
                if p.starts_with("//") || p.starts_with('\\') {
                    let stripped = p.trim_start_matches('/').trim_start_matches('\\');
                    if let Some(host) = stripped.split('/').next() {
                        if looks_like_ip(host) || looks_like_domain(host) {
                            t.push(host.to_string());
                        }
                    }
                }
            }
            t
        }
        _ => {
            // Generic: collect anything that looks like a network target
            let mut found = Vec::new();
            for &part in &parts {
                if part.starts_with('-') {
                    continue;
                }
                let stripped = part.trim_matches('"').trim_matches('\'');
                if stripped.starts_with("http://") || stripped.starts_with("https://") {
                    if let Some(host) = extract_host_from_url(stripped) {
                        found.push(host);
                    }
                } else if looks_like_ip(stripped) {
                    found.push(stripped.to_string());
                } else if looks_like_domain(stripped) {
                    found.push(stripped.to_string());
                } else if let Some(net) = stripped.split('/').next() {
                    if looks_like_ip(net) {
                        found.push(stripped.to_string());
                    }
                }
            }
            found
        }
    }
}

// ---------------------------------------------------------------------------
// Time-window rule check
// ---------------------------------------------------------------------------

/// Parse the first `HH:MM-HH:MM` or `HH:MM–HH:MM` (en-dash) found in text.
/// Returns (start_minutes_since_midnight, end_minutes).
fn parse_time_window(text: &str) -> Option<(u32, u32)> {
    let b = text.as_bytes();
    let n = b.len();
    let mut i = 0;

    while i + 5 <= n {
        if b[i].is_ascii_digit()
            && b[i + 1].is_ascii_digit()
            && b[i + 2] == b':'
            && b[i + 3].is_ascii_digit()
            && b[i + 4].is_ascii_digit()
        {
            let h1 = (b[i] - b'0') as u32 * 10 + (b[i + 1] - b'0') as u32;
            let m1 = (b[i + 3] - b'0') as u32 * 10 + (b[i + 4] - b'0') as u32;

            if h1 <= 23 && m1 <= 59 {
                let j = i + 5;
                // Accept '-' or en-dash (UTF-8: 0xE2 0x80 0x93)
                let k = if j < n && b[j] == b'-' {
                    j + 1
                } else if j + 2 < n && b[j] == 0xE2 && b[j + 1] == 0x80 && b[j + 2] == 0x93 {
                    j + 3
                } else {
                    i += 1;
                    continue;
                };

                if k + 5 <= n
                    && b[k].is_ascii_digit()
                    && b[k + 1].is_ascii_digit()
                    && b[k + 2] == b':'
                    && b[k + 3].is_ascii_digit()
                    && b[k + 4].is_ascii_digit()
                {
                    let h2 = (b[k] - b'0') as u32 * 10 + (b[k + 1] - b'0') as u32;
                    let m2 = (b[k + 3] - b'0') as u32 * 10 + (b[k + 4] - b'0') as u32;
                    if h2 <= 23 && m2 <= 59 {
                        return Some((h1 * 60 + m1, h2 * 60 + m2));
                    }
                }
            }
        }
        i += 1;
    }
    None
}

fn check_time_rules(rules: &[RuleEntry]) -> Option<String> {
    let now = Utc::now();
    let current_mins = now.hour() * 60 + now.minute();

    for rule in rules {
        if rule.rule_type != "restriction" {
            continue;
        }
        if let Some((start, end)) = parse_time_window(&rule.description) {
            let in_window = if start <= end {
                current_mins >= start && current_mins < end
            } else {
                // Wraps midnight
                current_mins >= start || current_mins < end
            };
            if !in_window {
                return Some(format!(
                    "Testing outside permitted hours. Current UTC: {:02}:{:02}. Rule: \"{}\"",
                    now.hour(),
                    now.minute(),
                    rule.description
                ));
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Core evaluator (pure — no DB access, easy to unit test)
// ---------------------------------------------------------------------------

fn evaluate_scope_logged(
    entries: &[ScopeEntry],
    rules: &[RuleEntry],
    command: &str,
) -> ScopeCheckResult {
    // 1. Time-window restrictions
    if let Some(reason) = check_time_rules(rules) {
        return ScopeCheckResult::OutOfScope { reason };
    }

    // 2. Extract targets
    let raw_targets = extract_targets_from_command(command);

    if raw_targets.is_empty() {
        return ScopeCheckResult::Unknown {
            message: "No recognizable network targets found in command.".into(),
        };
    }

    // 3. No scope defined at all → warn
    if entries.is_empty() {
        return ScopeCheckResult::Unknown {
            message: format!(
                "No scope defined for this engagement. Targets seen: {}",
                raw_targets.join(", ")
            ),
        };
    }

    // 4. Check each target
    let mut in_scope: Vec<String> = Vec::new();
    let mut excluded: Vec<String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();

    for t in &raw_targets {
        let verdict = check_single_target(t, entries);
        match verdict {
            TargetVerdict::InScope => in_scope.push(t.clone()),
            TargetVerdict::Excluded(r) => excluded.push(r),
            TargetVerdict::Unknown => unknown.push(t.clone()),
        }
    }

    // 5. Aggregate
    if excluded.is_empty() && unknown.is_empty() {
        // Every extracted target matched an in-scope entry
        ScopeCheckResult::InScope
    } else if excluded.is_empty() && in_scope.is_empty() {
        // Targets found, but none match the engagement scope.
        ScopeCheckResult::OutOfScope {
            reason: format!(
                "Targets not found in scope definition: {}",
                unknown.join(", ")
            ),
        }
    } else if excluded.is_empty() && !unknown.is_empty() {
        // Some targets are in scope, others are unrecognized — treat unrecognized as warning
        ScopeCheckResult::PartiallyInScope {
            in_scope: in_scope.clone(),
            out_of_scope: unknown
                .iter()
                .map(|t| format!("{t} (not in scope)"))
                .collect(),
        }
    } else if in_scope.is_empty() && unknown.is_empty() {
        // All targets are explicitly excluded
        ScopeCheckResult::OutOfScope {
            reason: excluded.join("; "),
        }
    } else {
        // Mix of explicitly excluded + in-scope or unknown targets
        let mut safe = in_scope;
        safe.extend(unknown.iter().map(|t| format!("{t} (unverified)")));
        ScopeCheckResult::PartiallyInScope {
            in_scope: safe,
            out_of_scope: excluded,
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Core scope check against an already-locked DB connection.
/// Called both by the `check_scope` Tauri command and directly from
/// `write_terminal` (PTY-level interception).
pub fn check_scope_with_conn(
    db: &rusqlite::Connection,
    engagement_id: &str,
    command: &str,
) -> Result<ScopeCheckResult, String> {
    let entries: Vec<ScopeEntry> = {
        let mut stmt = db
            .prepare(
                "SELECT target_type, value, in_scope \
                 FROM scope_targets WHERE engagement_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<Result<ScopeEntry, String>> = stmt
            .query_map(params![engagement_id], |row| {
                Ok(ScopeEntry {
                    target_type: row.get(0)?,
                    value: row.get(1)?,
                    in_scope: row.get::<_, i64>(2)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .map(|r| r.map_err(|e| e.to_string()))
            .collect();
        rows.into_iter().collect::<Result<_, _>>()?
    };

    let rules: Vec<RuleEntry> = {
        let mut stmt = db
            .prepare(
                "SELECT rule_type, description \
                 FROM scope_rules WHERE engagement_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<Result<RuleEntry, String>> = stmt
            .query_map(params![engagement_id], |row| {
                Ok(RuleEntry {
                    rule_type: row.get(0)?,
                    description: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .map(|r| r.map_err(|e| e.to_string()))
            .collect();
        rows.into_iter().collect::<Result<_, _>>()?
    };
    Ok(evaluate_scope_logged(&entries, &rules, command))
}

#[tauri::command]
pub fn check_scope(
    state: State<'_, DbState>,
    engagement_id: String,
    command: String,
) -> Result<ScopeCheckResult, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    check_scope_with_conn(&db, &engagement_id, &command)
}

#[tauri::command]
pub fn log_command(
    state: State<'_, DbState>,
    engagement_id: String,
    command: String,
    scope_type: String,
    scope_detail: Option<String>,
    executed: bool,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    log_command_with_conn(&db, &engagement_id, &command, &scope_type, scope_detail.as_deref(), executed)
}

fn log_command_with_conn(
    db: &rusqlite::Connection,
    engagement_id: &str,
    command: &str,
    scope_type: &str,
    scope_detail: Option<&str>,
    executed: bool,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let executed_int: i64 = if executed { 1 } else { 0 };

    db.execute(
        "INSERT INTO command_log \
             (id, engagement_id, command, scope_type, scope_detail, executed, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            engagement_id,
            command,
            scope_type,
            scope_detail,
            executed_int,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let db = Connection::open_in_memory().expect("in-memory sqlite");
        db.execute_batch(
            r#"
            CREATE TABLE scope_targets (
                id TEXT PRIMARY KEY,
                engagement_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                value TEXT NOT NULL,
                ports TEXT,
                protocol TEXT,
                in_scope INTEGER NOT NULL DEFAULT 1,
                notes TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE scope_rules (
                id TEXT PRIMARY KEY,
                engagement_id TEXT NOT NULL,
                rule_type TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE command_log (
                id TEXT PRIMARY KEY,
                engagement_id TEXT NOT NULL,
                command TEXT NOT NULL,
                scope_type TEXT NOT NULL,
                scope_detail TEXT,
                executed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            "#,
        )
        .expect("schema");
        db
    }

    fn insert_scope_target(
        db: &Connection,
        engagement_id: &str,
        target_type: &str,
        value: &str,
        in_scope: bool,
    ) {
        db.execute(
            "INSERT INTO scope_targets \
                 (id, engagement_id, target_type, value, in_scope, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                engagement_id,
                target_type,
                value,
                if in_scope { 1_i64 } else { 0_i64 },
                Utc::now().to_rfc3339()
            ],
        )
        .expect("insert scope target");
    }

    fn check(db: &Connection, engagement_id: &str, command: &str) -> ScopeCheckResult {
        check_scope_with_conn(db, engagement_id, command).expect("scope check")
    }

    #[test]
    fn in_scope_exact_ip_returns_in_scope() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "ip", "10.10.10.10", true);

        let result = check(&db, "eng-1", "nmap 10.10.10.10");

        assert!(matches!(result, ScopeCheckResult::InScope));
    }

    #[test]
    fn in_scope_domain_returns_in_scope_for_subdomain_url() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "domain", "example.com", true);

        let result = check(&db, "eng-1", "curl https://app.example.com/login");

        assert!(matches!(result, ScopeCheckResult::InScope));
    }

    #[test]
    fn in_scope_url_target_matches_url_driven_tools() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "url", "https://app.example.com", true);

        let result = check(&db, "eng-1", "sqlmap -u https://app.example.com/login?id=1");

        assert!(matches!(result, ScopeCheckResult::InScope));
    }

    #[test]
    fn excluded_targets_are_out_of_scope() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "ip", "10.10.10.10", false);

        let result = check(&db, "eng-1", "nmap 10.10.10.10");

        match result {
            ScopeCheckResult::OutOfScope { reason } => {
                assert!(reason.contains("excluded"));
            }
            other => panic!("expected OutOfScope, got {other:?}"),
        }
    }

    #[test]
    fn mixed_targets_are_partially_in_scope() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "ip", "10.10.10.10", true);
        insert_scope_target(&db, "eng-1", "ip", "8.8.8.8", false);

        let result = check(&db, "eng-1", "nmap 10.10.10.10 8.8.8.8");

        match result {
            ScopeCheckResult::PartiallyInScope {
                in_scope,
                out_of_scope,
            } => {
                assert_eq!(in_scope, vec!["10.10.10.10"]);
                assert_eq!(out_of_scope.len(), 1);
                assert!(out_of_scope[0].contains("8.8.8.8"));
            }
            other => panic!("expected PartiallyInScope, got {other:?}"),
        }
    }

    #[test]
    fn missing_targets_stay_out_of_scope() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "ip", "10.10.10.1", true);

        let result = check(&db, "eng-1", "nmap 8.8.8.8");

        match result {
            ScopeCheckResult::OutOfScope { reason } => {
                assert!(reason.contains("8.8.8.8"));
            }
            other => panic!("expected OutOfScope, got {other:?}"),
        }
    }

    #[test]
    fn unknown_commands_without_targets_stay_unknown() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "ip", "10.10.10.10", true);

        let result = check(&db, "eng-1", "echo no-target-here");

        match result {
            ScopeCheckResult::Unknown { message } => {
                assert!(message.contains("No recognizable network targets"));
            }
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn bare_target_commands_are_treated_as_out_of_scope() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "ip", "10.10.10.10", true);

        let result = check(&db, "eng-1", "8.8.8.8");

        match result {
            ScopeCheckResult::OutOfScope { reason } => {
                assert!(reason.contains("8.8.8.8"));
            }
            other => panic!("expected OutOfScope, got {other:?}"),
        }
    }

    #[test]
    fn wrapped_launcher_commands_still_extract_targets_for_scope_checks() {
        let db = setup_db();
        insert_scope_target(&db, "eng-1", "domain", "example.com", true);

        let wrapped = "( printf $'\\x1eREDCODE_RECON_START_run123\\x1f\\n' ; \
            claude -p \"/web-application-mapping https://app.example.com\" ; \
            status=$? ; \
            printf $'\\n\\x1eREDCODE_RECON_END_run123:%s\\x1f\\n' \"$status\" )";

        let result = check(&db, "eng-1", wrapped);
        assert!(matches!(result, ScopeCheckResult::InScope));
    }

    #[test]
    fn command_log_rows_are_written_with_expected_scope_result() {
        let db = setup_db();

        log_command_with_conn(
            &db,
            "eng-1",
            "nmap 10.10.10.10",
            "InScope",
            None,
            true,
        )
        .expect("log command");

        let row = db
            .query_row(
                "SELECT command, scope_type, scope_detail, executed \
                 FROM command_log WHERE engagement_id = ?1",
                params!["eng-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .expect("read command log");

        assert_eq!(row.0, "nmap 10.10.10.10");
        assert_eq!(row.1, "InScope");
        assert_eq!(row.2, None);
        assert_eq!(row.3, 1);
    }
}
