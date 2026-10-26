// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { SANDBOX_WORKER_CODE } from "../src/worker/sandbox-worker-code.js";
import type {
  WorkerOutgoingMessage,
  WorkerStageMessage,
  WorkerSuccessMessage,
  WorkerTaskRequest,
} from "../src/worker/worker-protocol.js";

test("Sandbox WebWorker Protocol & Parser Runner", async (t) => {
  await t.test("Worker script source compiles and contains message listener", () => {
    assert.ok(SANDBOX_WORKER_CODE.includes("self.onmessage"));
    assert.ok(SANDBOX_WORKER_CODE.includes("STAGE_UPDATE"));
    assert.ok(SANDBOX_WORKER_CODE.includes("SUCCESS"));
  });

  await t.test("Simulates background worker parsing on Simulink model payload", async () => {
    const messages: WorkerOutgoingMessage[] = [];

    // Mock worker context simulating browser WebWorker environment
    const mockSelf = {
      postMessage: (msg: WorkerOutgoingMessage) => {
        messages.push(msg);
      },
      onmessage: null as any,
    };

    // Execute sandbox worker code inside mock worker environment
    const runner = new Function("self", "performance", SANDBOX_WORKER_CODE);
    runner(mockSelf, performance);

    assert.strictEqual(typeof mockSelf.onmessage, "function");

    const sampleSimulinkModel = `
      <Model>
        <Block type="Gain" name="DirectFeedthrough_Gain" DirectFeedthrough="yes" />
        <Block type="Sum" name="Sum_Junction" />
        <Block type="Integrator" name="Integrator_Without_IC" />
        <Inport name="Unconnected_Port" />
      </Model>
    `;

    const request: WorkerTaskRequest = {
      id: "req_test_123",
      action: "lint",
      dialect: "simulink",
      content: sampleSimulinkModel,
    };

    mockSelf.onmessage({ data: request });

    // Assert stage updates were published progressively
    const stageUpdates = messages.filter((m): m is WorkerStageMessage => m.type === "STAGE_UPDATE");
    assert.ok(stageUpdates.length >= 3);
    assert.strictEqual(stageUpdates[0]?.stage, "reading");
    assert.strictEqual(stageUpdates[1]?.stage, "parsing");
    assert.strictEqual(stageUpdates[2]?.stage, "linting");

    // Assert final success output
    const successMsg = messages.find((m): m is WorkerSuccessMessage => m.type === "SUCCESS");
    assert.ok(successMsg);
    assert.strictEqual(successMsg.id, "req_test_123");
    assert.ok(successMsg.durationMs >= 0);

    const diagnostics = successMsg.result.diagnostics;
    assert.ok(Array.isArray(diagnostics));

    // Verify rules triggered by worker heuristics
    const hasAlgebraicLoop = diagnostics.some((d: any) => d.code === "M7202");
    const hasUnconnectedPort = diagnostics.some((d: any) => d.code === "M7201");
    const hasMissingIC = diagnostics.some((d: any) => d.code === "M7210");

    assert.strictEqual(hasAlgebraicLoop, true, "Should detect M7202 algebraic loop");
    assert.strictEqual(hasUnconnectedPort, true, "Should detect M7201 unconnected port");
    assert.strictEqual(hasMissingIC, true, "Should detect M7210 missing initial condition");
  });
});
