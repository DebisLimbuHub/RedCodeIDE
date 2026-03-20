import test from "node:test";
import assert from "node:assert/strict";
import {
  createSerialTaskQueue,
  getScopeGuardrailPrimaryLabel,
  isBlockingScopeResult,
  isScopeGuardrailCancelKey,
  isIndicatorScopeResult,
  resetTrackedCommand,
  shouldSuppressGuardrailEnter,
  updateTrackedCommand,
} from "../src/lib/terminalScope.ts";

// ---------------------------------------------------------------------------
// Buffer tracking
// ---------------------------------------------------------------------------

test("bracketed paste wrappers are ignored in the frontend command tracker", () => {
  let state = resetTrackedCommand();

  state = updateTrackedCommand(state, "\u001b[200~nmap 10.10.10.10");
  state = updateTrackedCommand(state, "\u001b[201~");

  assert.equal(state.value, "nmap 10.10.10.10");
  assert.equal(state.escapeState, "normal");
});

test("backspace removes last character from command buffer", () => {
  let state = resetTrackedCommand();
  state = updateTrackedCommand(state, "nmap 10.10.10.1");
  state = updateTrackedCommand(state, "\u007f"); // DEL
  assert.equal(state.value, "nmap 10.10.10.");
  state = updateTrackedCommand(state, "\b"); // BS
  assert.equal(state.value, "nmap 10.10.10");
});

test("Ctrl+C clears the command buffer", () => {
  let state = resetTrackedCommand();
  state = updateTrackedCommand(state, "nmap 8.8.8.8");
  state = updateTrackedCommand(state, "\u0003"); // Ctrl+C
  assert.equal(state.value, "");
});

test("Ctrl+U kills the whole line", () => {
  let state = resetTrackedCommand();
  state = updateTrackedCommand(state, "nmap 8.8.8.8");
  state = updateTrackedCommand(state, "\u0015"); // Ctrl+U
  assert.equal(state.value, "");
});

test("Ctrl+W removes last word", () => {
  let state = resetTrackedCommand();
  state = updateTrackedCommand(state, "nmap 10.10.10.1");
  state = updateTrackedCommand(state, "\u0017"); // Ctrl+W
  assert.equal(state.value, "nmap ");
});

test("arrow key escape sequences are consumed without polluting the buffer", () => {
  let state = resetTrackedCommand();
  state = updateTrackedCommand(state, "ls");

  // Up arrow: ESC [ A
  state = updateTrackedCommand(state, "\u001b[A");

  // Buffer value is unchanged — escape sequences are stripped, not accumulated.
  // This documents the known limitation: history navigation makes the JS buffer
  // diverge from what the shell's readline actually has queued.
  assert.equal(state.value, "ls");
  assert.equal(state.escapeState, "normal");
});

test("non-printable characters outside ASCII range are ignored", () => {
  let state = resetTrackedCommand();
  state = updateTrackedCommand(state, "echo");
  // BEL, NUL, TAB — nothing printable should be added
  state = updateTrackedCommand(state, "\u0007\u0000\t");
  assert.equal(state.value, "echo");
});

// ---------------------------------------------------------------------------
// Scope result classification
// ---------------------------------------------------------------------------

test("unknown scope results are non-blocking while hard failures still block", () => {
  assert.equal(isBlockingScopeResult({ type: "InScope" }), false);
  assert.equal(
    isBlockingScopeResult({
      type: "Unknown",
      message: "No recognizable network targets found in command.",
    }),
    false
  );
  assert.equal(
    isBlockingScopeResult({
      type: "PartiallyInScope",
      in_scope: ["10.10.10.10"],
      out_of_scope: ["8.8.8.8"],
    }),
    true
  );
  assert.equal(
    isBlockingScopeResult({
      type: "OutOfScope",
      reason: "8.8.8.8 is not in scope",
    }),
    true
  );
  assert.equal(
    isIndicatorScopeResult({
      type: "Unknown",
      message: "No recognizable network targets found in command.",
    }),
    true
  );
  // InScope is neither blocking nor an indicator
  assert.equal(isIndicatorScopeResult({ type: "InScope" }), false);
});

// ---------------------------------------------------------------------------
// Guardrail UI helpers
// ---------------------------------------------------------------------------

test("guardrail helpers keep blocking actions explicit", () => {
  assert.equal(
    getScopeGuardrailPrimaryLabel({
      type: "OutOfScope",
      reason: "8.8.8.8 is not in scope",
    }),
    "Execute Anyway (Out of Scope)"
  );
  assert.equal(
    getScopeGuardrailPrimaryLabel({
      type: "PartiallyInScope",
      in_scope: ["10.10.10.10"],
      out_of_scope: ["8.8.8.8"],
    }),
    "Execute Mixed Command Anyway"
  );
  assert.equal(isScopeGuardrailCancelKey("Escape"), true);
  assert.equal(isScopeGuardrailCancelKey("Enter"), false);
  assert.equal(isScopeGuardrailCancelKey("Backspace"), false);
  assert.equal(shouldSuppressGuardrailEnter("Enter", true), true);
  assert.equal(shouldSuppressGuardrailEnter("Enter", false), false);
  assert.equal(shouldSuppressGuardrailEnter("Escape", true), false);
});

// ---------------------------------------------------------------------------
// Serial task queue
// ---------------------------------------------------------------------------

test("serial task queue preserves terminal write order", async () => {
  const queue = createSerialTaskQueue();
  const events: string[] = [];

  let releaseFirst: (() => void) | null = null;

  const first = queue.enqueue(async () => {
    events.push("command-bytes");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
  });

  const second = queue.enqueue(async () => {
    events.push("newline");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["command-bytes"]);

  releaseFirst?.();

  await first;
  await second;

  assert.deepEqual(events, ["command-bytes", "newline"]);
});

test("serial task queue flush waits for all queued tasks", async () => {
  const queue = createSerialTaskQueue();
  const done: number[] = [];

  queue.enqueue(async () => { done.push(1); });
  queue.enqueue(async () => { done.push(2); });
  queue.enqueue(async () => { done.push(3); });

  await queue.flush();
  assert.deepEqual(done, [1, 2, 3]);
});
