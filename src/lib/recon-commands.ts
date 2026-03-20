/**
 * Pre-built recon command templates that map to installed Claude Code skills.
 * Each template defines parameters, generates the CLI command string, and
 * declares what type of recon_data its output produces.
 *
 * Commands are invoked by calling:
 *   claude -p "<skill> <params>"
 * from the embedded terminal.  The Rust write_terminal handler runs a scope
 * check on the target embedded in the command before letting it execute.
 */

import type { ReconDataType } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParamType = "text" | "domain" | "url" | "ip" | "number";

export interface ParamDef {
  name: string;
  label: string;
  type: ParamType;
  required: boolean;
  placeholder: string;
  defaultValue?: string;
}

export type ReconCategory =
  | "Subdomain Discovery"
  | "DNS & Network"
  | "Application Mapping"
  | "Technology Fingerprinting"
  | "OSINT";

export interface ReconCommand {
  id: string;
  name: string;
  description: string;
  category: ReconCategory;
  /** Slash-command skill name, e.g. "/subdomain_enumeration" */
  skill: string;
  params: ParamDef[];
  /** Generates the shell command string from filled param values. */
  buildCommand: (params: Record<string, string>) => string;
  /** Primary recon_data type this skill produces. */
  outputDataType: ReconDataType;
  /** Show in Quick Recon shortlist. */
  quickRecon?: boolean;
  /**
   * Position in the Full Recon Pipeline (1 = first).
   * Undefined = not included in the default pipeline.
   */
  pipelineOrder?: number;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export const RECON_COMMANDS: ReconCommand[] = [
  // ── Subdomain Discovery ──────────────────────────────────────────────────

  {
    id: "domain_discovery",
    name: "Domain Discovery",
    description:
      "Discover the official company domain via web search, WHOIS, and common TLD patterns.",
    category: "Subdomain Discovery",
    skill: "/domain_discovery",
    params: [
      {
        name: "company_name",
        label: "Company Name",
        type: "text",
        required: true,
        placeholder: "Acme Corp",
      },
    ],
    buildCommand: ({ company_name }) =>
      `claude -p "/domain_discovery ${company_name}"`,
    outputDataType: "subdomain",
    quickRecon: true,
    pipelineOrder: 1,
  },

  {
    id: "subdomain_enumeration",
    name: "Subdomain Enumeration",
    description:
      "Enumerate subdomains using CT logs, passive DNS, and search engine dorks.",
    category: "Subdomain Discovery",
    skill: "/subdomain_enumeration",
    params: [
      {
        name: "domain",
        label: "Target Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/subdomain_enumeration ${domain}"`,
    outputDataType: "subdomain",
    quickRecon: true,
    pipelineOrder: 2,
  },

  {
    id: "certificate_transparency",
    name: "Certificate Transparency",
    description:
      "Query CT logs for certificates and extract SANs for subdomain discovery.",
    category: "Subdomain Discovery",
    skill: "/certificate_transparency",
    params: [
      {
        name: "domain",
        label: "Target Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/certificate_transparency ${domain}"`,
    outputDataType: "certificate",
    pipelineOrder: 3,
  },

  // ── DNS & Network ────────────────────────────────────────────────────────

  {
    id: "dns_intelligence",
    name: "DNS Intelligence",
    description:
      "Extract technology signals from DNS records (MX, TXT, NS, CNAME, SRV).",
    category: "DNS & Network",
    skill: "/dns_intelligence",
    params: [
      {
        name: "domain",
        label: "Target Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/dns_intelligence ${domain}"`,
    outputDataType: "dns_record",
    quickRecon: true,
    pipelineOrder: 4,
  },

  {
    id: "tls_certificate_analysis",
    name: "TLS Certificate Analysis",
    description:
      "Analyse TLS certificates for issuer, SAN, expiry, and JARM fingerprints.",
    category: "DNS & Network",
    skill: "/tls_certificate_analysis",
    params: [
      {
        name: "host",
        label: "Host",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
      {
        name: "port",
        label: "Port",
        type: "number",
        required: false,
        placeholder: "443",
        defaultValue: "443",
      },
    ],
    buildCommand: ({ host, port }) =>
      `claude -p "/tls_certificate_analysis ${host}:${port || "443"}"`,
    outputDataType: "certificate",
    pipelineOrder: 5,
  },

  {
    id: "ip_attribution",
    name: "IP Attribution",
    description:
      "Map an IP address to its cloud provider, ASN, and owning organisation via WHOIS.",
    category: "DNS & Network",
    skill: "/ip_attribution",
    params: [
      {
        name: "ip",
        label: "IP Address",
        type: "ip",
        required: true,
        placeholder: "1.2.3.4",
      },
    ],
    buildCommand: ({ ip }) =>
      `claude -p "/ip_attribution ${ip}"`,
    outputDataType: "cloud_resource",
  },

  // ── Application Mapping ──────────────────────────────────────────────────

  {
    id: "web_application_mapping",
    name: "Web Application Mapping",
    description:
      "Comprehensive passive + active endpoint discovery, attack surface analysis, and headless browser recon.",
    category: "Application Mapping",
    skill: "/web_application_mapping",
    params: [
      {
        name: "url",
        label: "Target URL",
        type: "url",
        required: true,
        placeholder: "https://example.com",
      },
    ],
    buildCommand: ({ url }) =>
      `claude -p "/web_application_mapping ${url}"`,
    outputDataType: "api_endpoint",
    quickRecon: true,
    pipelineOrder: 6,
  },

  {
    id: "domain_assessment",
    name: "Domain Assessment",
    description:
      "Orchestrates subdomain discovery and port scanning to build a complete domain attack surface inventory.",
    category: "Application Mapping",
    skill: "/domain_assessment",
    params: [
      {
        name: "domain",
        label: "Target Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/domain_assessment ${domain}"`,
    outputDataType: "subdomain",
    quickRecon: true,
  },

  // ── Technology Fingerprinting ────────────────────────────────────────────

  {
    id: "frontend_inferencer",
    name: "Frontend Tech Detection",
    description:
      "Detect frontend frameworks: React, Angular, Vue, jQuery, Bootstrap, etc.",
    category: "Technology Fingerprinting",
    skill: "/frontend_inferencer",
    params: [
      {
        name: "url",
        label: "Target URL",
        type: "url",
        required: true,
        placeholder: "https://example.com",
      },
    ],
    buildCommand: ({ url }) =>
      `claude -p "/frontend_inferencer ${url}"`,
    outputDataType: "technology",
    pipelineOrder: 7,
  },

  {
    id: "backend_inferencer",
    name: "Backend Tech Detection",
    description:
      "Infer backend stack: servers, languages, frameworks, databases, and CMS.",
    category: "Technology Fingerprinting",
    skill: "/backend_inferencer",
    params: [
      {
        name: "url",
        label: "Target URL",
        type: "url",
        required: true,
        placeholder: "https://example.com",
      },
    ],
    buildCommand: ({ url }) =>
      `claude -p "/backend_inferencer ${url}"`,
    outputDataType: "technology",
    pipelineOrder: 8,
  },

  {
    id: "cdn_waf_fingerprinter",
    name: "CDN / WAF Detection",
    description:
      "Identify CDNs (Cloudflare, Akamai, Fastly) and WAFs from HTTP headers, cookies, and error pages.",
    category: "Technology Fingerprinting",
    skill: "/cdn_waf_fingerprinter",
    params: [
      {
        name: "url",
        label: "Target URL",
        type: "url",
        required: true,
        placeholder: "https://example.com",
      },
    ],
    buildCommand: ({ url }) =>
      `claude -p "/cdn_waf_fingerprinter ${url}"`,
    outputDataType: "technology",
  },

  {
    id: "cloud_infra_detector",
    name: "Cloud Infrastructure",
    description:
      "Detect cloud providers (AWS, Azure, GCP) and PaaS platforms from DNS and HTTP signals.",
    category: "Technology Fingerprinting",
    skill: "/cloud_infra_detector",
    params: [
      {
        name: "domain",
        label: "Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/cloud_infra_detector ${domain}"`,
    outputDataType: "cloud_resource",
  },

  {
    id: "security_posture_analyzer",
    name: "Security Posture",
    description:
      "Analyse security headers, CSP, HSTS, WAF presence, and security.txt.",
    category: "Technology Fingerprinting",
    skill: "/security_posture_analyzer",
    params: [
      {
        name: "url",
        label: "Target URL",
        type: "url",
        required: true,
        placeholder: "https://example.com",
      },
    ],
    buildCommand: ({ url }) =>
      `claude -p "/security_posture_analyzer ${url}"`,
    outputDataType: "technology",
    pipelineOrder: 9,
  },

  {
    id: "api_portal_discovery",
    name: "API Portal Discovery",
    description:
      "Discover public API portals, developer docs, and OpenAPI / Swagger endpoints.",
    category: "Technology Fingerprinting",
    skill: "/api_portal_discovery",
    params: [
      {
        name: "domain",
        label: "Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/api_portal_discovery ${domain}"`,
    outputDataType: "api_endpoint",
  },

  // ── OSINT ────────────────────────────────────────────────────────────────

  {
    id: "code_repository_intel",
    name: "Code Repository Intel",
    description:
      "Scan GitHub / GitLab for public repos, exposed secrets, dependencies, and CI configs.",
    category: "OSINT",
    skill: "/code_repository_intel",
    params: [
      {
        name: "org_name",
        label: "Org / Username",
        type: "text",
        required: true,
        placeholder: "acmecorp",
      },
    ],
    buildCommand: ({ org_name }) =>
      `claude -p "/code_repository_intel ${org_name}"`,
    outputDataType: "subdomain",
  },

  {
    id: "web_archive_analysis",
    name: "Web Archive Analysis",
    description:
      "Use the Wayback Machine to detect technology migrations and historical asset exposure.",
    category: "OSINT",
    skill: "/web_archive_analysis",
    params: [
      {
        name: "domain",
        label: "Domain",
        type: "domain",
        required: true,
        placeholder: "example.com",
      },
    ],
    buildCommand: ({ domain }) =>
      `claude -p "/web_archive_analysis ${domain}"`,
    outputDataType: "subdomain",
  },

  {
    id: "job_posting_analysis",
    name: "Job Posting Analysis",
    description:
      "Extract technology requirements from job postings and career pages.",
    category: "OSINT",
    skill: "/job_posting_analysis",
    params: [
      {
        name: "company_name",
        label: "Company Name",
        type: "text",
        required: true,
        placeholder: "Acme Corp",
      },
    ],
    buildCommand: ({ company_name }) =>
      `claude -p "/job_posting_analysis ${company_name}"`,
    outputDataType: "technology",
  },
];

// ---------------------------------------------------------------------------
// Derived sets
// ---------------------------------------------------------------------------

export const RECON_CATEGORIES: ReconCategory[] = [
  "Subdomain Discovery",
  "DNS & Network",
  "Application Mapping",
  "Technology Fingerprinting",
  "OSINT",
];

/** Commands shown in the Quick Recon shortlist. */
export const QUICK_RECON_IDS = RECON_COMMANDS
  .filter((c) => c.quickRecon)
  .map((c) => c.id);

/** Ordered steps for the Full Recon Pipeline. */
export const PIPELINE_COMMANDS = [...RECON_COMMANDS]
  .filter((c) => c.pipelineOrder !== undefined)
  .sort((a, b) => (a.pipelineOrder ?? 0) - (b.pipelineOrder ?? 0));
