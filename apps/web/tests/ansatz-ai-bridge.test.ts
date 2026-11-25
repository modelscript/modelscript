// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureSharedWebLLMEngine,
  getLastLocalAiError,
} from "../../../packages/editor/src/internal/local-ai-runtime.js";
import {
  DEFAULT_ANSATZ_AI_SETTINGS,
  fallbackTaskTitle,
  generateAnsatzTaskTitle,
  runAnsatzAiTurn,
} from "../../../packages/editor/src/workbench/util/ansatz-ai-client.js";
import {
  applyLineRangeEdit,
  executeAnsatzToolCall,
  type AnsatzToolHost,
} from "../../../packages/editor/src/workbench/util/ansatz-tool-bridge.js";

function createMockHost(initialCode: string): AnsatzToolHost & { getView: () => string } {
  let code = initialCode;
  let currentView = "code";
  return {
    getFileName: () => "TestModel.mo",
    getDialect: () => "modelica",
    getCode: () => code,
    getDiagnostics: () => [{ severity: "error", message: "Missing semicolon", line: 2, column: 10 }],
    getSelectedComponent: () => "R1",
    applyCodeEdit: (nextCode) => {
      code = nextCode;
      return true;
    },
    runFlatten: async () => ({ ok: true, output: "Flattened 1 equation" }),
    runSimulate: async () => ({ ok: true, output: "Simulation completed" }),
    switchView: (v) => {
      currentView = v;
    },
    getView: () => currentView,
  };
}

describe("AnsatzToolBridge", () => {
  it("applies line-range edits and executes core tools", async () => {
    const edited = applyLineRangeEdit("line1\nline2\nline3", 2, 2, "updated2");
    assert.equal(edited, "line1\nupdated2\nline3");

    const host = createMockHost("model Test\n  Real x\nend Test;");
    const ctxRes = await executeAnsatzToolCall(host, { name: "ansatz_get_context", arguments: {} });
    assert.equal(ctxRes.ok, true);
    assert.match(ctxRes.output, /TestModel\.mo/);

    const editRes = await executeAnsatzToolCall(host, {
      name: "ansatz_apply_edit",
      arguments: { startLine: 2, endLine: 2, replacement: "  Real x;" },
    });
    assert.equal(editRes.ok, true);
    assert.equal(editRes.previousCode, "model Test\n  Real x\nend Test;");
    assert.equal(host.getCode(), "model Test\n  Real x;\nend Test;");

    const flatRes = await executeAnsatzToolCall(host, { name: "ansatz_flatten", arguments: {} });
    assert.equal(flatRes.ok, true);
    assert.match(flatRes.output, /Flattened 1 equation/);

    const viewRes = await executeAnsatzToolCall(host, {
      name: "ansatz_switch_view",
      arguments: { view: "diagram" },
    });
    assert.equal(viewRes.ok, true);
    assert.equal(host.getView(), "diagram");
  });
});

describe("AnsatzAiClient agentic loop", () => {
  it("executes multi-turn tool calls via Ansatz SSE stream and applies edits", async () => {
    const host = createMockHost("model Test\n  Real x\nend Test;");
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    try {
      globalThis.fetch = (async () => {
        callCount++;
        if (callCount === 1) {
          const sse1 = [
            `data: ${JSON.stringify({
              type: "tool_calls",
              toolCalls: [
                {
                  id: "tc_1",
                  name: "ansatz_apply_edit",
                  arguments: { startLine: 2, endLine: 2, replacement: "  Real x;" },
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({ type: "done", model: "qwen2.5-coder:32b" })}\n\n`,
          ].join("");
          return new Response(sse1, { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }

        const sse2 = [
          `data: ${JSON.stringify({ type: "text", delta: "Fixed missing semicolon in TestModel.mo." })}\n\n`,
          `data: ${JSON.stringify({ type: "done", model: "qwen2.5-coder:32b" })}\n\n`,
        ].join("");
        return new Response(sse2, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }) as typeof fetch;

      const res = await runAnsatzAiTurn([{ role: "user", content: "Fix the error" }], host, {
        ...DEFAULT_ANSATZ_AI_SETTINGS,
        mode: "ansatz",
      });

      assert.equal(callCount, 2);
      assert.equal(res.model, "qwen2.5-coder:32b");
      assert.equal(res.toolResults.length, 1);
      assert.equal(res.toolResults[0]?.ok, true);
      assert.equal(host.getCode(), "model Test\n  Real x;\nend Test;");
      assert.match(res.content, /Fixed missing semicolon/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("generates and sanitizes LLM task titles with fallback", async () => {
    assert.equal(fallbackTaskTitle("   "), "New AI Task");
    assert.equal(fallbackTaskTitle("Fix Chua circuit equation"), "Fix Chua circuit equation");

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        const sse = [
          `data: ${JSON.stringify({ type: "text", delta: '<think>thinking</think>"Fix Chua Circuit Oscillation."' })}\n\n`,
          `data: ${JSON.stringify({ type: "done", model: "qwen2.5-coder:32b" })}\n\n`,
        ].join("");
        return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }) as typeof fetch;

      const title = await generateAnsatzTaskTitle("Why does ChuaCircuit oscillate?", {
        ...DEFAULT_ANSATZ_AI_SETTINGS,
        mode: "ansatz",
      });
      assert.equal(title, "Fix Chua Circuit Oscillation");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports a clear diagnostic when WebGPU is unavailable", async () => {
    const engine = await ensureSharedWebLLMEngine();
    assert.equal(engine, null);
    assert.match(getLastLocalAiError() || "", /WebGPU/i);
  });
});
