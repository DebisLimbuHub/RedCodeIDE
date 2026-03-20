use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db::DbState;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconEntry {
    pub id: String,
    pub engagement_id: String,
    pub target_id: Option<String>,
    pub data_type: String,
    pub value: String,
    pub source: Option<String>,
    pub confidence: f64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ReconSummary {
    pub total_count: i64,
    pub subdomains: i64,
    pub open_ports: i64,
    pub services: i64,
    pub technologies: i64,
    pub dns_records: i64,
    pub certificates: i64,
    pub api_endpoints: i64,
    pub other: i64,
}

#[derive(Debug, Serialize)]
pub struct PaginatedReconData {
    pub data: Vec<ReconEntry>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Return per-type counts for the recon dashboard overview.
#[tauri::command]
pub fn get_recon_summary(
    state: State<'_, DbState>,
    engagement_id: String,
) -> Result<ReconSummary, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT data_type, COUNT(*) FROM recon_data WHERE engagement_id = ?1 GROUP BY data_type",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![engagement_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut summary = ReconSummary {
        total_count: 0,
        subdomains: 0,
        open_ports: 0,
        services: 0,
        technologies: 0,
        dns_records: 0,
        certificates: 0,
        api_endpoints: 0,
        other: 0,
    };

    for (dtype, count) in rows {
        summary.total_count += count;
        match dtype.as_str() {
            "subdomain" => summary.subdomains = count,
            "open_port" => summary.open_ports = count,
            "service" => summary.services = count,
            "technology" => summary.technologies = count,
            "dns_record" => summary.dns_records = count,
            "certificate" => summary.certificates = count,
            "api_endpoint" => summary.api_endpoints = count,
            _ => summary.other += count,
        }
    }

    Ok(summary)
}

/// Paginated recon data with optional data_type and target_id filters.
#[tauri::command]
pub fn get_recon_data(
    state: State<'_, DbState>,
    engagement_id: String,
    data_type: Option<String>,
    target_id: Option<String>,
    page: i64,
    per_page: i64,
) -> Result<PaginatedReconData, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;

    let page = page.max(1);
    let per_page = per_page.clamp(1, 500);
    let offset = (page - 1) * per_page;

    // Count query
    let total: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM recon_data \
             WHERE engagement_id = ?1 \
               AND (?2 IS NULL OR data_type = ?2) \
               AND (?3 IS NULL OR target_id = ?3)",
            params![engagement_id, data_type, target_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Data query
    let mut stmt = db
        .prepare(
            "SELECT id, engagement_id, target_id, data_type, value, source, confidence, created_at \
             FROM recon_data \
             WHERE engagement_id = ?1 \
               AND (?2 IS NULL OR data_type = ?2) \
               AND (?3 IS NULL OR target_id = ?3) \
             ORDER BY created_at DESC \
             LIMIT ?4 OFFSET ?5",
        )
        .map_err(|e| e.to_string())?;

    let data: Vec<ReconEntry> = stmt
        .query_map(params![engagement_id, data_type, target_id, per_page, offset], |row| {
            Ok(ReconEntry {
                id: row.get(0)?,
                engagement_id: row.get(1)?,
                target_id: row.get(2)?,
                data_type: row.get(3)?,
                value: row.get(4)?,
                source: row.get(5)?,
                confidence: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(PaginatedReconData { data, total, page, per_page })
}

/// Insert a single recon entry.  Duplicate (engagement, data_type, value) is silently ignored.
#[tauri::command]
pub fn add_recon_data(
    state: State<'_, DbState>,
    engagement_id: String,
    target_id: Option<String>,
    data_type: String,
    value: String,
    source: Option<String>,
) -> Result<ReconEntry, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let confidence = 0.9_f64;

    let inserted = db.execute(
        "INSERT OR IGNORE INTO recon_data \
         (id, engagement_id, target_id, data_type, value, source, confidence, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, engagement_id, target_id, data_type, value, source, confidence, now],
    )
    .map_err(|e| e.to_string())?;

    if inserted == 0 {
        return db
            .query_row(
                "SELECT id, engagement_id, target_id, data_type, value, source, confidence, created_at \
                 FROM recon_data \
                 WHERE engagement_id = ?1 AND data_type = ?2 AND value = ?3",
                params![engagement_id, data_type, value],
                |row| {
                    Ok(ReconEntry {
                        id: row.get(0)?,
                        engagement_id: row.get(1)?,
                        target_id: row.get(2)?,
                        data_type: row.get(3)?,
                        value: row.get(4)?,
                        source: row.get(5)?,
                        confidence: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                },
            )
            .map_err(|e| e.to_string());
    }

    Ok(ReconEntry {
        id,
        engagement_id,
        target_id,
        data_type,
        value,
        source,
        confidence,
        created_at: now,
    })
}

/// Parse raw tool output and bulk-insert the resulting recon entries.
/// Supported tools/formats:
///   - nmap (XML output)
///   - subfinder / amass (plain-text, one host per line)
///   - Any tool whose output is a JSON array
#[tauri::command]
pub fn import_recon_data(
    state: State<'_, DbState>,
    engagement_id: String,
    tool_name: String,
    raw_output: String,
) -> Result<Vec<ReconEntry>, String> {
    let parsed = parse_tool_output(&tool_name, &raw_output);

    let db = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut inserted: Vec<ReconEntry> = Vec::new();

    for (data_type, value) in parsed {
        let id = Uuid::new_v4().to_string();
        let n = db
            .execute(
                "INSERT OR IGNORE INTO recon_data \
                 (id, engagement_id, target_id, data_type, value, source, confidence, created_at) \
                 VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0.9, ?6)",
                params![id, engagement_id, data_type, value, tool_name, now],
            )
            .map_err(|e| e.to_string())?;

        if n > 0 {
            inserted.push(ReconEntry {
                id,
                engagement_id: engagement_id.clone(),
                target_id: None,
                data_type,
                value,
                source: Some(tool_name.clone()),
                confidence: 0.9,
                created_at: now.clone(),
            });
        }
    }

    Ok(inserted)
}

/// Delete a single recon entry by ID.
#[tauri::command]
pub fn delete_recon_data(
    state: State<'_, DbState>,
    id: String,
) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let n = db
        .execute("DELETE FROM recon_data WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------------
// Tool output parsers
// ---------------------------------------------------------------------------

fn parse_tool_output(tool_name: &str, output: &str) -> Vec<(String, String)> {
    let trimmed = output.trim();

    // nmap: tool name hint or XML content
    if tool_name.to_lowercase().contains("nmap")
        || trimmed.starts_with("<?xml")
        || trimmed.starts_with("<nmaprun")
        || trimmed.starts_with("<host")
    {
        return parse_nmap_xml(trimmed);
    }

    // JSON array/object
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Some(results) = parse_json_output(trimmed) {
            if !results.is_empty() {
                return results;
            }
        }
    }

    // Plain text: subfinder / amass / anything line-based
    parse_plain_text(output)
}

// --- Attribute extraction helpers ---

/// Pull `attr="value"` from a fragment of XML/HTML text.
fn attr_value(text: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let pos = text.find(&needle)?;
    let rest = &text[pos + needle.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// --- nmap XML parser ---

fn parse_nmap_xml(xml: &str) -> Vec<(String, String)> {
    let mut results: Vec<(String, String)> = Vec::new();
    let mut scan_pos = 0;

    while let Some(rel) = xml[scan_pos..].find("<host") {
        let host_start = scan_pos + rel;

        // Find the closing </host>
        let host_end = xml[host_start..]
            .find("</host>")
            .map(|i| host_start + i + 7)
            .unwrap_or(xml.len());
        let host_xml = &xml[host_start..host_end];
        scan_pos = host_end;

        // Skip hosts that are down
        if host_xml.contains("state=\"down\"") {
            continue;
        }

        // Extract primary IPv4 address
        let ip = extract_ipv4_address(host_xml);

        // Hostnames → subdomain entries
        extract_hostnames(host_xml, &ip, &mut results);

        // Ports → open_port + service entries
        extract_ports(host_xml, &ip, &mut results);
    }

    results
}

fn extract_ipv4_address(host_xml: &str) -> String {
    let mut pos = 0;
    while let Some(rel) = host_xml[pos..].find("<address ") {
        let start = pos + rel;
        let end = host_xml[start..]
            .find("/>")
            .map(|i| start + i + 2)
            .unwrap_or(host_xml.len());
        let tag = &host_xml[start..end];
        if tag.contains("addrtype=\"ipv4\"") {
            if let Some(addr) = attr_value(tag, "addr") {
                return addr;
            }
        }
        pos = end;
    }
    String::new()
}

fn extract_hostnames(
    host_xml: &str,
    ip: &str,
    results: &mut Vec<(String, String)>,
) {
    let mut pos = 0;
    while let Some(rel) = host_xml[pos..].find("<hostname ") {
        let start = pos + rel;
        let end = host_xml[start..]
            .find("/>")
            .map(|i| start + i + 2)
            .unwrap_or(host_xml.len());
        let tag = &host_xml[start..end];
        if let Some(name) = attr_value(tag, "name") {
            let val = serde_json::json!({"subdomain": name, "ip": ip}).to_string();
            results.push(("subdomain".to_string(), val));
        }
        pos = end;
    }
}

fn extract_ports(
    host_xml: &str,
    ip: &str,
    results: &mut Vec<(String, String)>,
) {
    let mut pos = 0;
    while let Some(rel) = host_xml[pos..].find("<port ") {
        let start = pos + rel;
        let end = host_xml[start..]
            .find("</port>")
            .map(|i| start + i + 7)
            .or_else(|| host_xml[start..].find("/>").map(|i| start + i + 2))
            .unwrap_or(host_xml.len());
        let port_xml = &host_xml[start..end];
        pos = end;

        // Only open ports
        if !port_xml.contains("state=\"open\"") {
            continue;
        }

        let portid = attr_value(port_xml, "portid").unwrap_or_default();
        let protocol = attr_value(port_xml, "protocol").unwrap_or_else(|| "tcp".to_string());
        let port_num: u16 = portid.parse().unwrap_or(0);

        // open_port entry
        results.push((
            "open_port".to_string(),
            serde_json::json!({
                "host": ip,
                "port": port_num,
                "protocol": protocol,
            })
            .to_string(),
        ));

        // service entry
        if let Some(svc_rel) = port_xml.find("<service ") {
            let svc_end = port_xml[svc_rel..]
                .find("/>")
                .map(|i| svc_rel + i + 2)
                .or_else(|| port_xml[svc_rel..].find("</service>").map(|i| svc_rel + i))
                .unwrap_or(port_xml.len());
            let svc_xml = &port_xml[svc_rel..svc_end];

            let svc_name = attr_value(svc_xml, "name").unwrap_or_default();
            let svc_product = attr_value(svc_xml, "product").unwrap_or_default();
            let svc_version = attr_value(svc_xml, "version").unwrap_or_default();

            if !svc_name.is_empty() || !svc_product.is_empty() {
                results.push((
                    "service".to_string(),
                    serde_json::json!({
                        "host": ip,
                        "port": port_num,
                        "name": svc_name,
                        "product": svc_product,
                        "version": svc_version,
                    })
                    .to_string(),
                ));
            }
        }
    }
}

// --- Plain-text parser (subfinder / amass) ---

fn parse_plain_text(text: &str) -> Vec<(String, String)> {
    text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|line| {
            // amass sometimes outputs: "subdomain (FQDN) --> ip (A)"
            // subfinder: plain "subdomain"
            // "subdomain IP" (two-column)
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            let host = parts[0].trim_end_matches('.');

            // Must look like a domain or IP
            if host.is_empty() || host.contains('<') || host.contains('>') {
                return None;
            }

            let ip = parts.get(1).map(|s| s.trim()).filter(|s| !s.is_empty());
            let val = if let Some(ip_str) = ip {
                serde_json::json!({"subdomain": host, "ip": ip_str}).to_string()
            } else {
                serde_json::json!({"subdomain": host}).to_string()
            };
            Some(("subdomain".to_string(), val))
        })
        .collect()
}

// --- JSON array parser ---

fn parse_json_output(text: &str) -> Option<Vec<(String, String)>> {
    let json: serde_json::Value = serde_json::from_str(text).ok()?;

    // Accept either a top-level array or a single object
    let items: Vec<&serde_json::Value> = match &json {
        serde_json::Value::Array(arr) => arr.iter().collect(),
        obj @ serde_json::Value::Object(_) => vec![obj],
        _ => return None,
    };

    let results: Vec<(String, String)> = items
        .into_iter()
        .map(|item| {
            // Heuristic type detection from known keys
            let dtype = if item.get("subdomain").is_some()
                || item.get("domain").is_some()
                || item.get("host").is_some() && item.get("port").is_none()
            {
                "subdomain"
            } else if item.get("port").is_some() && item.get("state").is_some() {
                "open_port"
            } else if item.get("port").is_some()
                && (item.get("name").is_some() || item.get("service").is_some())
            {
                "service"
            } else if item.get("technology").is_some()
                || item.get("tech").is_some()
                || item.get("wappalyzer").is_some()
            {
                "technology"
            } else if item.get("record_type").is_some()
                || item.get("dns_type").is_some()
                || item.get("type").is_some() && item.get("name").is_some()
            {
                "dns_record"
            } else if item.get("issuer").is_some()
                || item.get("not_after").is_some()
                || item.get("san").is_some()
            {
                "certificate"
            } else {
                "subdomain" // safe default
            };
            (dtype.to_string(), item.to_string())
        })
        .collect();

    Some(results)
}
