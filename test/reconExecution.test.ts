import test from "node:test";
import assert from "node:assert/strict";
import { wrapReconCommand } from "../src/lib/recon-execution.ts";

test("launcher PTY wrapper avoids zsh readonly status variable collisions", () => {
  const wrapped = wrapReconCommand("run123", 'claude -p "/web-application-mapping https://example.com"');

  assert.match(wrapped, /REDCODE_RECON_START_run123/);
  assert.match(wrapped, /REDCODE_RECON_END_run123:%s/);
  assert.match(wrapped, /redcode_exit_code=\$\?/);
  assert.doesNotMatch(wrapped, /(^|[ ;(])status=\$\?/);
});
