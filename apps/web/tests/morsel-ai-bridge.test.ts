// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MORSEL_AI_SETTINGS, runMorselAiTurn } from "../src/components/morsel/util/morsel-ai-client.js";
import {
  applyLineRangeEdit,
  executeMorselToolCall,
  type MorselToolHost,
} from "../src/components/morsel/util/morsel-tool-bridge.js";

function createMockHost(initialCode: string): MorselToolHost & { getView: () => string } {
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

describe("MorselToolBridge", () => {
  it("applies line-range edits and executes core tools", async () => {
    const edited = applyLineRangeEdit("line1\nline2\nline3", 2, 2, "updated2");
    assert.equal(edited, "line1\nupdated2\nline3");

    const host = createMockHost("model Test\n  Real x\nend Test;");
    const ctxRes = await executeMorselToolCall(host, { name: "morsel_get_context", arguments: {} });
    assert.equal(ctxRes.ok, true);
    assert.match(ctxRes.output, /TestModel\.mo/);

    const editRes = await executeMorselToolCall(host, {
      name: "morsel_apply_edit",
      arguments: { startLine: 2, endLine: 2, replacement: "  Real x;" },
    });
    assert.equal(editRes.ok, true);
    assert.equal(editRes.previousCode, "model Test\n  Real x\nend Test;");
    assert.equal(host.getCode(), "model Test\n  Real x;\nend Test;");

    const flatRes = await executeMorselToolCall(host, { name: "morsel_flatten", arguments: {} });
    assert.equal(flatRes.ok, true);
    assert.match(flatRes.output, /Flattened 1 equation/);

    const viewRes = await executeMorselToolCall(host, {
      name: "morsel_switch_view",
      arguments: { view: "diagram" },
    });
    assert.equal(viewRes.ok, true);
    assert.equal(host.getView(), "diagram");
  });
});

describe("MorselAiClient agentic loop", () => {
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
                  name: "morsel_apply_edit",
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

      const res = await runMorselAiTurn([{ role: "user", content: "Fix the error" }], host, {
        ...DEFAULT_MORSEL_AI_SETTINGS,
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
});
