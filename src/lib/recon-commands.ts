/**
 * Pre-built recon command templates that map to installed Claude Code skills.
 * Each template defines parameters, generates the CLI command string, and
 * includes a lightweight output parser so launcher-driven runs can persist
 * useful recon_data / scope_targets without bypassing the active PTY flow.
 */

import type { ReconDataType, TargetType } from "../types";

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

export interface ParsedReconDatum {
  dataType: ReconDataType;
  value: Record<string, unknown>;
  targetValue?: string;
}

export interface ParsedScopeTarget {
  targetType: TargetType;
  value: string;
  inScope?: boolean;
  notes?: string;
}

export interface ParsedReconOutput {
  reconEntries: ParsedReconDatum[];
  scopeTargets: ParsedScopeTarget[];
  discoveredHosts: string[];
}

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
  /** Parses terminal output into recon_data / scope_targets payloads. */
  outputParser: (output: string, params: Record<string, string>) => ParsedReconOutput;
  /** Show in Quick Recon shortlist. */
  quickRecon?: boolean;
  /**
   * Position in the Full Recon Pipeline (1 = first).
   * Undefined = not included in the default pipeline.
   */
  pipelineOrder?: number;
}

// ---------------------------------------------------------------------------
// Parser helpers
// ---------------------------------------------------------------------------

const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const DOMAIN_REGEX =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;
const URL_REGEX = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const DNS_LINE_REGEX =
  /\b(?:(A|AAAA|CNAME|MX|NS|TXT|SRV|PTR))\b[:\s-]+([^\s]+)\s*(?:->|=|:)?\s*(.+)?/gi;
const PORT_REGEX =
  /\b(?:(\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z]{2,63})[:\s]+)?(\d{1,5})\/(tcp|udp)\b(?:\s+([a-z0-9._-]+))?(?:\s+([a-z0-9._-]+))?(?:\s+([^\n]+))?/gi;

const TECHNOLOGY_PATTERNS = [
  "React",
  "Angular",
  "Vue",
  "Next.js",
  "Nuxt",
  "Bootstrap",
  "jQuery",
  "Tailwind",
  "Node.js",
  "Express",
  "Django",
  "Flask",
  "Laravel",
  "Rails",
  "Spring",
  "ASP.NET",
  "Nginx",
  "Apache",
  "IIS",
  "Cloudflare",
  "Fastly",
  "Akamai",
  "AWS",
  "Azure",
  "GCP",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "GraphQL",
  "Swagger",
  "OpenAPI",
  "WordPress",
  "Drupal",
  "Joomla",
];

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "").replace(/\r/g, "");
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function safeTrim(value: string): string {
  return value.trim().replace(/^[("'`]+|[)"'`,.;:]+$/g, "");
}

function normalizeDomain(value: string): string | null {
  const candidate = safeTrim(value).toLowerCase();
  if (!candidate || candidate.includes("://")) return null;
  if (!DOMAIN_REGEX.test(candidate)) return null;
  DOMAIN_REGEX.lastIndex = 0;
  return candidate.replace(/\.$/, "");
}

function normalizeUrl(value: string): string | null {
  const candidate = safeTrim(value);
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeHost(value: string): string | null {
  const url = normalizeUrl(value);
  if (url) return new URL(url).hostname.toLowerCase();

  const domain = normalizeDomain(value);
  if (domain) return domain;

  const candidate = safeTrim(value);
  if (IPV4_REGEX.test(candidate)) {
    IPV4_REGEX.lastIndex = 0;
    return candidate;
  }
  IPV4_REGEX.lastIndex = 0;
  return null;
}

function tryParseJson(text: string): unknown[] {
  const payloads: unknown[] = [];
  const trimmed = stripAnsi(text).trim();

  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\n([\s\S]*?)```/gi), (m) => m[1]),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      payloads.push(JSON.parse(candidate));
    } catch {
      // best-effort only
    }
  }

  return payloads;
}

function walkJson(
  value: unknown,
  visitor: (key: string | null, value: unknown) => void,
  parentKey: string | null = null
) {
  visitor(parentKey, value);
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visitor, parentKey));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
      walkJson(item, visitor, key)
    );
  }
}

function collectJsonStrings(text: string, keys: string[]): string[] {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const collected: string[] = [];

  for (const payload of tryParseJson(text)) {
    walkJson(payload, (key, value) => {
      if (typeof value !== "string" || !key) return;
      if (wanted.has(key.toLowerCase())) {
        collected.push(value);
      }
    });
  }

  return collected;
}

function extractDomains(text: string): string[] {
  const cleaned = stripAnsi(text);
  const regex = new RegExp(DOMAIN_REGEX.source, DOMAIN_REGEX.flags);
  return unique(
    Array.from(cleaned.matchAll(regex), (match) => normalizeDomain(match[0]))
      .filter((value): value is string => Boolean(value))
  );
}

function extractUrls(text: string): string[] {
  const cleaned = stripAnsi(text);
  const regex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  return unique(
    Array.from(cleaned.matchAll(regex), (match) => normalizeUrl(match[0]))
      .filter((value): value is string => Boolean(value))
  );
}

function extractDnsRecords(text: string, domainHint?: string): ParsedReconDatum[] {
  const cleaned = stripAnsi(text);
  const results: ParsedReconDatum[] = [];
  const regex = new RegExp(DNS_LINE_REGEX.source, DNS_LINE_REGEX.flags);

  for (const match of cleaned.matchAll(regex)) {
    const type = match[1]?.toUpperCase();
    const name = safeTrim(match[2] ?? "");
    const value = safeTrim(match[3] ?? "");
    if (!type || !name) continue;

    results.push({
      dataType: "dns_record",
      targetValue: normalizeHost(name) ?? domainHint,
      value: {
        type,
        name,
        value,
      },
    });
  }

  return results;
}

function extractPorts(text: string): ParsedReconDatum[] {
  const cleaned = stripAnsi(text);
  const results: ParsedReconDatum[] = [];
  const regex = new RegExp(PORT_REGEX.source, PORT_REGEX.flags);

  for (const match of cleaned.matchAll(regex)) {
    const host = normalizeHost(match[1] ?? "");
    const port = Number(match[2]);
    const protocol = (match[3] ?? "tcp").toLowerCase();
    const service = safeTrim(match[4] ?? "");
    const product = safeTrim(match[5] ?? "");
    const version = safeTrim(match[6] ?? "");

    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;

    results.push({
      dataType: "open_port",
      targetValue: host ?? undefined,
      value: {
        host,
        port,
        protocol,
      },
    });

    if (service || product || version) {
      results.push({
        dataType: "service",
        targetValue: host ?? undefined,
        value: {
          host,
          port,
          protocol,
          name: service,
          product,
          version,
        },
      });
    }
  }

  return results;
}

function extractTechnologies(text: string, targetValue?: string): ParsedReconDatum[] {
  const cleaned = stripAnsi(text);
  const found = unique(
    TECHNOLOGY_PATTERNS.filter((tech) =>
      new RegExp(`\\b${tech.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(cleaned)
    )
  );

  const jsonHits = collectJsonStrings(text, [
    "technology",
    "tech",
    "framework",
    "language",
    "server",
    "database",
    "platform",
    "cdn",
    "waf",
    "provider",
  ]);

  const values = unique([...found, ...jsonHits.map((value) => safeTrim(value)).filter(Boolean)]);
  return values.map((technology) => ({
    dataType: "technology",
    targetValue,
    value: { technology },
  }));
}

function extractApiEndpoints(
  text: string,
  urlHint?: string,
  domainHint?: string
): ParsedReconDatum[] {
  const urls = extractUrls(text);
  const paths = unique(
    Array.from(
      stripAnsi(text).matchAll(
        /\b(?:\/(?:api|graphql|v\d+)[a-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)/gi
      ),
      (match) => safeTrim(match[0])
    ).filter(Boolean)
  );

  const targetUrl = normalizeUrl(urlHint ?? "") ?? (domainHint ? `https://${domainHint}` : null);
  const targetHost = normalizeHost(targetUrl ?? domainHint ?? "");
  const results: ParsedReconDatum[] = urls.map((url) => ({
    dataType: "api_endpoint" as const,
    targetValue: normalizeHost(url) ?? targetHost ?? undefined,
    value: { url },
  }));

  for (const path of paths) {
    results.push({
      dataType: "api_endpoint",
      targetValue: targetHost ?? undefined,
      value: {
        url: targetUrl ? `${targetUrl.replace(/\/+$/, "")}${path}` : path,
        path,
      },
    });
  }

  return unique(
    results.map((item) => JSON.stringify(item))
  ).map((serialized) => JSON.parse(serialized) as ParsedReconDatum);
}

function extractCertificateData(
  text: string,
  params: Record<string, string>
): ParsedReconDatum[] {
  const cleaned = stripAnsi(text);
  const subject =
    cleaned.match(/(?:subject|common name|cn)\s*[:=-]\s*(.+)/i)?.[1]?.trim() ?? "";
  const issuer = cleaned.match(/issuer\s*[:=-]\s*(.+)/i)?.[1]?.trim() ?? "";
  const notAfter =
    cleaned.match(/(?:not after|expiry|expires?)\s*[:=-]\s*(.+)/i)?.[1]?.trim() ?? "";
  const jarm = cleaned.match(/jarm\s*[:=-]\s*([A-Fa-f0-9]+)/i)?.[1]?.trim() ?? "";
  const sans = unique([
    ...collectJsonStrings(text, ["san", "sans", "subject_alt_name"]),
    ...extractDomains(cleaned),
  ]);

  const host = normalizeHost(params.host ?? params.domain ?? params.url ?? "");
  if (!subject && !issuer && !notAfter && !jarm && sans.length === 0 && !host) {
    return [];
  }

  return [
    {
      dataType: "certificate",
      targetValue: host ?? undefined,
      value: {
        host,
        port: params.port ? Number(params.port) : undefined,
        subject,
        common_name: subject || host,
        issuer,
        not_after: notAfter,
        sans,
        jarm,
      },
    },
  ];
}

function buildSubdomainEntries(hosts: string[]): ParsedReconDatum[] {
  return unique(hosts)
    .map((host) => normalizeDomain(host) ?? normalizeHost(host))
    .filter((host): host is string => Boolean(host))
    .map((host) => ({
      dataType: "subdomain" as const,
      targetValue: host,
      value: { subdomain: host },
    }));
}

function buildScopeTargets(hosts: string[]): ParsedScopeTarget[] {
  return unique(hosts)
    .map((host) => normalizeDomain(host) ?? normalizeHost(host))
    .filter((host): host is string => Boolean(host))
    .map((value) => ({
      targetType: "domain" as const,
      value,
      inScope: true,
    }));
}

function buildRawFallback(
  outputDataType: ReconDataType,
  output: string,
  targetValue?: string
): ParsedReconDatum[] {
  const cleaned = stripAnsi(output).trim();
  if (!cleaned) return [];
  return [
    {
      dataType: outputDataType,
      targetValue,
      value: { raw: cleaned },
    },
  ];
}

function mergeOutputs(...outputs: ParsedReconOutput[]): ParsedReconOutput {
  const reconEntries = unique(outputs.flatMap((item) => item.reconEntries.map((entry) => JSON.stringify(entry))))
    .map((entry) => JSON.parse(entry) as ParsedReconDatum);
  const scopeTargets = unique(outputs.flatMap((item) => item.scopeTargets.map((entry) => JSON.stringify(entry))))
    .map((entry) => JSON.parse(entry) as ParsedScopeTarget);
  const discoveredHosts = unique(outputs.flatMap((item) => item.discoveredHosts));

  return { reconEntries, scopeTargets, discoveredHosts };
}

function parseDomainDiscoveryOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const domains = unique([
    ...extractDomains(output),
    ...collectJsonStrings(output, ["domain", "domains", "hostname", "host"])
      .map((value) => normalizeDomain(value))
      .filter((value): value is string => Boolean(value)),
  ]);

  const cleaned = unique(domains.filter((domain) => !params.company_name || domain !== params.company_name.toLowerCase()));
  return {
    reconEntries: [],
    scopeTargets: buildScopeTargets(cleaned),
    discoveredHosts: cleaned,
  };
}

function parseSubdomainOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const hosts = unique([
    ...extractDomains(output),
    ...collectJsonStrings(output, ["subdomain", "domain", "host", "hostname", "san", "sans"])
      .map((value) => normalizeHost(value))
      .filter((value): value is string => Boolean(value)),
    normalizeDomain(params.domain ?? "") ?? "",
  ]).filter(Boolean);

  const reconEntries = buildSubdomainEntries(hosts);
  return {
    reconEntries: reconEntries.length ? reconEntries : buildRawFallback("subdomain", output, params.domain),
    scopeTargets: [],
    discoveredHosts: hosts,
  };
}

function parseCertificateTransparencyOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const hostOutput = parseSubdomainOutput(output, params);
  const certOutput = {
    reconEntries: extractCertificateData(output, params),
    scopeTargets: [] as ParsedScopeTarget[],
    discoveredHosts: hostOutput.discoveredHosts,
  };

  return mergeOutputs(hostOutput, certOutput);
}

function parseDnsIntelligenceOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const domain = normalizeDomain(params.domain ?? "") ?? undefined;
  const dnsEntries = extractDnsRecords(output, domain);
  const techEntries = extractTechnologies(output, domain);
  const hosts = unique([
    ...(domain ? [domain] : []),
    ...extractDomains(output),
  ]);

  return {
    reconEntries:
      dnsEntries.length || techEntries.length
        ? [...dnsEntries, ...techEntries]
        : buildRawFallback("dns_record", output, domain),
    scopeTargets: [],
    discoveredHosts: hosts,
  };
}

function parseTlsCertificateOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const entries = extractCertificateData(output, params);
  const host = normalizeHost(params.host ?? "");
  return {
    reconEntries: entries.length ? entries : buildRawFallback("certificate", output, host ?? undefined),
    scopeTargets: [],
    discoveredHosts: host ? [host] : [],
  };
}

function parseIpAttributionOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const cleaned = stripAnsi(output);
  const provider =
    cleaned.match(/(?:provider|cloud provider)\s*[:=-]\s*(.+)/i)?.[1]?.trim() ?? "";
  const asn = cleaned.match(/\bAS(\d+)\b/i)?.[1] ?? "";
  const organization =
    cleaned.match(/(?:organization|owner|org)\s*[:=-]\s*(.+)/i)?.[1]?.trim() ?? "";
  const ip = safeTrim(params.ip ?? cleaned.match(IPV4_REGEX)?.[0] ?? "");

  const entries: ParsedReconDatum[] =
    ip || provider || asn || organization
      ? [
          {
            dataType: "cloud_resource",
            targetValue: ip || undefined,
            value: {
              ip,
              provider,
              asn: asn ? `AS${asn}` : "",
              organization,
            },
          },
        ]
      : buildRawFallback("cloud_resource", output, params.ip);

  return {
    reconEntries: entries,
    scopeTargets: [],
    discoveredHosts: ip ? [ip] : [],
  };
}

function parseWebApplicationOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const url = normalizeUrl(params.url ?? "") ?? undefined;
  const domain = url ? new URL(url).hostname : undefined;
  const endpoints = extractApiEndpoints(output, url, domain);

  return {
    reconEntries: endpoints.length ? endpoints : buildRawFallback("api_endpoint", output, domain),
    scopeTargets: [],
    discoveredHosts: domain ? [domain] : [],
  };
}

function parseDomainAssessmentOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const domain = normalizeDomain(params.domain ?? "") ?? undefined;
  const subdomains = buildSubdomainEntries(unique([...(domain ? [domain] : []), ...extractDomains(output)]));
  const ports = extractPorts(output);

  return {
    reconEntries:
      subdomains.length || ports.length
        ? [...subdomains, ...ports]
        : buildRawFallback("subdomain", output, domain),
    scopeTargets: [],
    discoveredHosts: unique([...(domain ? [domain] : []), ...extractDomains(output)]),
  };
}

function parseTechnologyOutput(
  output: string,
  params: Record<string, string>,
  outputDataType: ReconDataType
): ParsedReconOutput {
  const targetValue =
    normalizeHost(params.url ?? "") ??
    normalizeHost(params.domain ?? "") ??
    normalizeHost(params.host ?? "");

  const technologyEntries = extractTechnologies(output, targetValue ?? undefined);
  const apiEntries =
    outputDataType === "api_endpoint"
      ? extractApiEndpoints(output, params.url, params.domain)
      : [];
  const cloudEntries =
    outputDataType === "cloud_resource"
      ? [
          ...extractTechnologies(output, targetValue ?? undefined).map((entry) => ({
            ...entry,
            dataType: "cloud_resource" as const,
            value: { provider: entry.value.technology ?? entry.value.raw ?? "" },
          })),
        ]
      : [];

  const reconEntries =
    apiEntries.length || cloudEntries.length || technologyEntries.length
      ? [...technologyEntries, ...apiEntries, ...cloudEntries]
      : buildRawFallback(outputDataType, output, targetValue ?? undefined);

  return {
    reconEntries,
    scopeTargets: [],
    discoveredHosts: targetValue ? [targetValue] : [],
  };
}

function parseOsintSubdomainOutput(
  output: string,
  params: Record<string, string>
): ParsedReconOutput {
  const hosts = extractDomains(output);
  return {
    reconEntries: buildSubdomainEntries(hosts).length
      ? buildSubdomainEntries(hosts)
      : buildRawFallback("subdomain", output, params.domain),
    scopeTargets: [],
    discoveredHosts: hosts,
  };
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export const RECON_COMMANDS: ReconCommand[] = [
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
    outputParser: parseDomainDiscoveryOutput,
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
    outputParser: parseSubdomainOutput,
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
    outputParser: parseCertificateTransparencyOutput,
    pipelineOrder: 3,
  },
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
    outputParser: parseDnsIntelligenceOutput,
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
    outputParser: parseTlsCertificateOutput,
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
    outputParser: parseIpAttributionOutput,
  },
  {
    id: "web_application_mapping",
    name: "Web Application Mapping",
    description:
      "Comprehensive passive + active endpoint discovery, attack surface analysis, and headless browser recon.",
    category: "Application Mapping",
    skill: "/web-application-mapping",
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
      `claude -p "/web-application-mapping ${url}"`,
    outputDataType: "api_endpoint",
    outputParser: parseWebApplicationOutput,
    quickRecon: true,
    pipelineOrder: 6,
  },
  {
    id: "domain_assessment",
    name: "Domain Assessment",
    description:
      "Orchestrates subdomain discovery and port scanning to build a complete domain attack surface inventory.",
    category: "Application Mapping",
    skill: "/domain-assessment",
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
      `claude -p "/domain-assessment ${domain}"`,
    outputDataType: "subdomain",
    outputParser: parseDomainAssessmentOutput,
    quickRecon: true,
  },
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "technology"),
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "technology"),
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "technology"),
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "cloud_resource"),
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "technology"),
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "api_endpoint"),
  },
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
    outputParser: parseOsintSubdomainOutput,
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
    outputParser: parseOsintSubdomainOutput,
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
    outputParser: (output, params) => parseTechnologyOutput(output, params, "technology"),
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

export const RECON_COMMAND_BY_ID = Object.fromEntries(
  RECON_COMMANDS.map((command) => [command.id, command])
) as Record<string, ReconCommand>;

/** Commands shown in the Quick Recon shortlist. */
export const QUICK_RECON_IDS = RECON_COMMANDS
  .filter((c) => c.quickRecon)
  .map((c) => c.id);

/** Ordered steps for the Full Recon Pipeline. */
export const PIPELINE_COMMANDS = [...RECON_COMMANDS]
  .filter((c) => c.pipelineOrder !== undefined)
  .sort((a, b) => (a.pipelineOrder ?? 0) - (b.pipelineOrder ?? 0));

export const PIPELINE_DISCOVERY_IDS = [
  "domain_discovery",
  "subdomain_enumeration",
  "certificate_transparency",
  "dns_intelligence",
] as const;

export const PIPELINE_HOST_FANOUT_IDS = [
  "tls_certificate_analysis",
  "frontend_inferencer",
  "backend_inferencer",
  "security_posture_analyzer",
] as const;
