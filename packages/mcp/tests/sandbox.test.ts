// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDiagnostic,
  formatDiagnosticText,
  getSandboxMemoryBytes,
  McpMemoryLimitError,
  McpTimeoutError,
  runInSandbox,
  SANDBOX_ERROR_CATALOG,
  withSandbox,
} from "../src/sandbox.js";

describe("Deterministic MCP Execution Sandbox Suite", () => {
  describe("runInSandbox Deadlines and Timeouts", () => {
    it("executes quick asynchronous tasks successfully within deadline", async () => {
      const res = await runInSandbox(
        async () => {
          return 42 * 2;
        },
        {
          toolName: "quick_task",
          limits: { timeoutMs: 1000 },
        },
      );
      assert.equal(res, 84);
    });

    it("aborts and throws McpTimeoutError (M6017) when deadline is exceeded", async () => {
      let abortedSignalSeen = false;
      const startTime = Date.now();

      await assert.rejects(
        async () => {
          await runInSandbox(
            async (signal) => {
              signal.addEventListener("abort", () => {
                abortedSignalSeen = true;
              });
              // Simulate long-running / hanging simulation
              await new Promise((resolve) => setTimeout(resolve, 500));
              return "should_not_reach";
            },
            {
              toolName: "hanging_simulation",
              limits: { timeoutMs: 50 },
            },
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof McpTimeoutError, "Must throw McpTimeoutError");
          assert.equal(err.diagnostic.code, "M6017");
          assert.equal(err.diagnostic.rule, "execution-deadline-timeout");
          assert.equal(err.diagnostic.severity, "error");
          assert.ok(err.diagnostic.message.includes("hanging_simulation"));
          assert.ok(err.diagnostic.remediation.includes("stiff"));
          return true;
        },
      );

      const elapsed = Date.now() - startTime;
      assert.ok(elapsed < 400, `Must cancel promptly, took ${elapsed}ms`);
      assert.equal(abortedSignalSeen, true, "AbortSignal must have been triggered");
    });

    it("chains external AbortSignal into sandbox controller", async () => {
      const externalController = new AbortController();

      const taskPromise = runInSandbox(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "never";
        },
        {
          toolName: "external_abort_test",
          limits: { timeoutMs: 5000, signal: externalController.signal },
        },
      );

      // Abort externally after 20ms
      setTimeout(() => externalController.abort(), 20);

      // Node.js will reject when external signal triggers
      await assert.rejects(taskPromise);
    });
  });

  describe("runInSandbox Memory Ceilings", () => {
    it("reports positive process memory from getSandboxMemoryBytes", () => {
      const bytes = getSandboxMemoryBytes();
      assert.ok(bytes > 0, "Process memory bytes must be strictly positive");
    });

    it("rejects immediately if pre-flight memory ceiling is already breached", async () => {
      const currentMem = getSandboxMemoryBytes();

      await assert.rejects(
        async () => {
          await runInSandbox(async () => "ok", {
            toolName: "tight_memory_task",
            limits: { maxMemoryBytes: Math.floor(currentMem / 2) },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof McpMemoryLimitError);
          assert.equal(err.diagnostic.code, "M7014");
          assert.equal(err.diagnostic.rule, "memory-arena-exceeded");
          assert.ok(err.diagnostic.message.includes("exceeded memory limit"));
          return true;
        },
      );
    });

    it("rejects if tool execution exceeds maxDeltaBytes threshold", async () => {
      await assert.rejects(
        async () => {
          await runInSandbox(
            async () => {
              // Allocate 10 MB ArrayBuffer
              const _buf = new Uint8Array(10 * 1024 * 1024);
              return _buf.byteLength;
            },
            {
              toolName: "memory_growth_task",
              limits: { maxDeltaBytes: 1024 * 1024 }, // 1 MB cap on growth
            },
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof McpMemoryLimitError);
          assert.equal(err.diagnostic.code, "M7014");
          return true;
        },
      );
    });
  });

  describe("Diagnostic Classification & Catalog Mapping", () => {
    it("classifies timeout error as M6017 with actionable solver guidance", () => {
      const diag = classifyDiagnostic(new Error("Simulation timed out after 15000ms"), "pscad_simulate", 15002);
      assert.equal(diag.code, "M6017");
      assert.equal(diag.rule, "execution-deadline-timeout");
      assert.equal(diag.severity, "error");
      assert.ok(diag.remediation.includes("stiff eigenvalues"));
      assert.ok(diag.remediation.includes("dt"));
    });

    it("classifies floating electrical node as M6001", () => {
      const diag = classifyDiagnostic(new Error("Electrical node 'Bus4' is floating with no closed connections"));
      assert.equal(diag.code, "M6001");
      assert.equal(diag.rule, "floating-electrical-node");
      assert.ok(diag.remediation.includes("topology"));
    });

    it("classifies transformer winding voltage mismatch as M6002", () => {
      const diag = classifyDiagnostic(
        new Error("Transformer primary rating 230kV does not match connected bus base kV 500kV"),
      );
      assert.equal(diag.code, "M6002");
      assert.equal(diag.rule, "transformer-winding-mismatch");
    });

    it("classifies weak grid condition as M6004", () => {
      const diag = classifyDiagnostic(
        new Error("Point of Interconnection 'POI_Bus' has low Short-Circuit Ratio (SCR < 1.5)"),
      );
      assert.equal(diag.code, "M6004");
      assert.equal(diag.rule, "weak-grid-warning");
      assert.ok(diag.remediation.includes("grid-forming"));
    });

    it("classifies transmission line travel time underflow as M6006", () => {
      const diag = classifyDiagnostic(new Error("Bergeron travel time underflow: dt > tau"));
      assert.equal(diag.code, "M6006");
      assert.equal(diag.rule, "line-travel-time-underflow");
    });

    it("classifies singular kinematics / algebraic loop as M6012", () => {
      const diag = classifyDiagnostic(new Error("Singular Jacobian matrix encountered in kinematic loop"));
      assert.equal(diag.code, "M6012");
      assert.equal(diag.rule, "algebraic-loop-singular-system");
      assert.ok(diag.remediation.includes("redundant constraints"));
    });

    it("classifies parallel ideal voltage sources as M6013", () => {
      const diag = classifyDiagnostic(new Error("Parallel ideal voltage sources connected without impedance"));
      assert.equal(diag.code, "M6013");
      assert.equal(diag.rule, "parallel-ideal-sources");
    });

    it("classifies wheel-rail derailment quotient and Prud'homme violations as M6015", () => {
      const diag = classifyDiagnostic(new Error("Derailment quotient (Y/Q) exceeded Nadal criterion limit"));
      assert.equal(diag.code, "M6015");
      assert.equal(diag.rule, "wheel-rail-derailment-risk");
      assert.ok(diag.remediation.includes("speed"));
    });

    it("classifies harmonic distortion as M6016", () => {
      const diag = classifyDiagnostic(new Error("Inverter total harmonic distortion THD exceeds IEEE 2800 ceiling"));
      assert.equal(diag.code, "M6016");
      assert.equal(diag.rule, "harmonic-distortion-violation");
    });

    it("classifies acoustic Courant (CFL) time step violation as M7003", () => {
      const diag = classifyDiagnostic(new Error("Acoustic-courant condition violated: dt > dx / c"));
      assert.equal(diag.code, "M7003");
      assert.equal(diag.rule, "acoustic-courant-violation");
      assert.ok(diag.remediation.includes("Courant"));
    });

    it("classifies hydrostatic instability as M7001", () => {
      const diag = classifyDiagnostic(new Error("Floater hydrostatic instability: negative GM metacentric height"));
      assert.equal(diag.code, "M7001");
      assert.equal(diag.rule, "negative-metacentric-height");
    });

    it("catalog has definitions for all pre-flight and runtime codes", () => {
      const expectedCodes = [
        "M6001",
        "M6002",
        "M6003",
        "M6004",
        "M6005",
        "M6006",
        "M6012",
        "M6013",
        "M6014",
        "M6015",
        "M6016",
        "M6017",
        "M7001",
        "M7002",
        "M7003",
        "M7004",
        "M7006",
        "M7008",
        "M7013",
        "M7014",
        "M6000",
      ];
      for (const code of expectedCodes) {
        assert.ok(SANDBOX_ERROR_CATALOG[code as keyof typeof SANDBOX_ERROR_CATALOG], `Missing code ${code} in catalog`);
      }
    });
  });

  describe("Formatting and withSandbox Tool Integration", () => {
    it("formats human-readable text and embedded JSON payload for LLM consumption", () => {
      const diag = classifyDiagnostic(new Error("Floating bus 'B1'"), "pscad_simulate", 12.5);
      const text = formatDiagnosticText(diag);

      assert.ok(text.includes("=== ModelScript Diagnostic [M6001] ==="));
      assert.ok(text.includes("Tool: pscad_simulate"));
      assert.ok(text.includes("Elapsed Time: 12.5ms"));
      assert.ok(text.includes("Actionable Remediation for AI Agent:"));
      assert.ok(text.includes("Diagnostic Payload (JSON):"));
      assert.ok(text.includes('"code": "M6001"'));
    });

    it("withSandbox passes successful results through transparently", async () => {
      const toolHandler = withSandbox("test_tool", async (args: { x: number; y: number }) => {
        return { content: [{ type: "text" as const, text: `Result: ${args.x + args.y}` }] };
      });

      const res = await toolHandler({ x: 10, y: 32 });
      assert.ok(!("isError" in res && res.isError));
      assert.equal((res as any).content[0].text, "Result: 42");
    });

    it("withSandbox enriches plain isError responses with ModelScript diagnostic codes", async () => {
      const toolHandler = withSandbox("pscad_test", async () => {
        return {
          content: [{ type: "text" as const, text: "Simulation error: Electrical node 'B_gen' is floating" }],
          isError: true,
        };
      });

      const res = await toolHandler({});
      assert.ok(res.isError);
      assert.ok(res.diagnostic);
      assert.equal(res.diagnostic.code, "M6001");
      assert.ok(res.content[0]?.text.includes("[M6001]"));
    });

    it("withSandbox enforces dynamic invocation timeout arguments", async () => {
      const toolHandler = withSandbox(
        "sim_timeout_tool",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { content: [{ type: "text" as const, text: "done" }] };
        },
        () => ({ timeoutMs: 5000 }),
      );

      // Invoke with overriding timeoutMs: 50ms
      const res = await toolHandler({ timeoutMs: 50 });
      assert.ok(res.isError);
      assert.ok(res.diagnostic);
      assert.equal(res.diagnostic.code, "M6017");
      assert.ok(res.content[0]?.text.includes("M6017"));
      assert.ok(res.content[0]?.text.includes("sim_timeout_tool"));
    });
  });
});
