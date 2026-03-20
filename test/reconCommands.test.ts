import test from "node:test";
import assert from "node:assert/strict";
import {
  PIPELINE_DISCOVERY_IDS,
  PIPELINE_HOST_FANOUT_IDS,
  RECON_COMMAND_BY_ID,
  RECON_COMMANDS,
} from "../src/lib/recon-commands.ts";

test("Phase 3.2 recon catalog preserves 17 command templates with parser metadata", () => {
  assert.equal(RECON_COMMANDS.length, 17);

  for (const command of RECON_COMMANDS) {
    assert.ok(command.id.length > 0);
    assert.ok(command.name.length > 0);
    assert.ok(command.description.length > 0);
    assert.ok(command.category.length > 0);
    assert.ok(command.skill.startsWith("/"));
    assert.equal(typeof command.buildCommand, "function");
    assert.equal(typeof command.outputParser, "function");
    assert.ok(command.params.length >= 1);

    for (const param of command.params) {
      assert.ok(param.name.length > 0);
      assert.ok(param.label.length > 0);
      assert.equal(typeof param.required, "boolean");
      assert.ok(param.placeholder.length > 0);
    }
  }
});

test("installed skill-name mismatches are corrected without changing command ids", () => {
  assert.equal(
    RECON_COMMAND_BY_ID.web_application_mapping.skill,
    "/web-application-mapping"
  );
  assert.equal(
    RECON_COMMAND_BY_ID.domain_assessment.skill,
    "/domain-assessment"
  );
  assert.match(
    RECON_COMMAND_BY_ID.web_application_mapping.buildCommand({
      url: "https://example.com",
    }),
    /\/web-application-mapping https:\/\/example\.com/
  );
  assert.match(
    RECON_COMMAND_BY_ID.domain_assessment.buildCommand({
      domain: "example.com",
    }),
    /\/domain-assessment example\.com/
  );
});

test("domain discovery parser produces scope targets for discovered domains", () => {
  const parsed = RECON_COMMAND_BY_ID.domain_discovery.outputParser(
    [
      "Primary domain: redcode.io",
      "Regional brand: redcode.co.uk",
    ].join("\n"),
    { company_name: "RedCode" }
  );

  assert.deepEqual(
    parsed.scopeTargets.map((target) => target.value),
    ["redcode.io", "redcode.co.uk"]
  );
  assert.equal(parsed.reconEntries.length, 0);
});

test("subdomain parser extracts discovered hosts for persistence and pipeline fan-out", () => {
  const parsed = RECON_COMMAND_BY_ID.subdomain_enumeration.outputParser(
    [
      "api.example.com",
      "cdn.example.com",
      "api.example.com",
    ].join("\n"),
    { domain: "example.com" }
  );

  assert.deepEqual(parsed.discoveredHosts, [
    "api.example.com",
    "cdn.example.com",
    "example.com",
  ]);
  assert.equal(parsed.reconEntries.length, 3);
});

test("dns intelligence parser captures DNS records and technology hints", () => {
  const parsed = RECON_COMMAND_BY_ID.dns_intelligence.outputParser(
    [
      "MX example.com -> aspmx.l.google.com",
      "TXT example.com -> v=spf1 include:_spf.google.com ~all",
      "Protected by Cloudflare",
    ].join("\n"),
    { domain: "example.com" }
  );

  assert.equal(
    parsed.reconEntries.some((entry) => entry.dataType === "dns_record"),
    true
  );
  assert.equal(
    parsed.reconEntries.some(
      (entry) =>
        entry.dataType === "technology" &&
        entry.value.technology === "Cloudflare"
    ),
    true
  );
});

test("pipeline blueprint keeps discovery before host fan-out", () => {
  assert.deepEqual(PIPELINE_DISCOVERY_IDS, [
    "domain_discovery",
    "subdomain_enumeration",
    "certificate_transparency",
    "dns_intelligence",
  ]);
  assert.deepEqual(PIPELINE_HOST_FANOUT_IDS, [
    "tls_certificate_analysis",
    "frontend_inferencer",
    "backend_inferencer",
    "security_posture_analyzer",
  ]);
});
