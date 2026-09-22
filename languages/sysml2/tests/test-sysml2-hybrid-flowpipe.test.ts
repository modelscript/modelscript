// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyHybridSysml2Reachability } from "../src/hybrid-flowpipe-bridge.js";

describe("SysML v2 Hybrid Flowpipe Reachability Bridge Suite", () => {
  it("should execute validated hybrid flowpipe reachability on SysML v2 models", async () => {
    // Mock QueryDB representing a SysML v2 model with continuous/discrete state machines
    const mockQueryDB = {
      allEntries: () => [
        {
          id: "sys1",
          name: "ClimateControlSystem",
          ruleName: "StateDefinition",
          kind: "State",
          parentId: null,
          metadata: {},
        },
      ],
    };

    const result = await verifyHybridSysml2Reachability(mockQueryDB, {
      modelName: "ClimateControlSystem",
      timeSpan: [0, 4.0],
      dt: 0.1,
      order: 2,
      adaptive: true,
      useQrPreconditioning: true,
    });

    assert(result.isCertifiedSafe, `Expected certified safe: ${result.summary}`);
    assert.strictEqual(result.modelName, "ClimateControlSystem");
    assert(result.totalSteps > 10, `Expected > 10 steps, got ${result.totalSteps}`);
    assert(result.jumpCount >= 1, `Expected at least 1 discrete mode switch jump, got ${result.jumpCount}`);
    assert(result.segments.length >= 2, `Expected at least 2 mode segments, got ${result.segments.length}`);

    // Verify first mode is Heating, second is Cooling
    assert.strictEqual(result.segments[0]!.modeId, "Heating");
    assert.strictEqual(result.segments[1]!.modeId, "Cooling");

    // Verify transition jump recorded
    const jump = result.jumps[0]!;
    assert.strictEqual(jump.transitionId, "HeatToCool");
    assert.strictEqual(jump.sourceModeId, "Heating");
    assert(jump.preJumpNominal[0]! >= 21.0 && jump.preJumpNominal[0]! <= 23.0);
    assert(jump.preJumpEnclosure[0]!.hi >= 21.8);

    assert(result.summary.includes("Hybrid reachability certified safe"));
  });

  it("should handle invalid timeSpan formats gracefully with defaults", async () => {
    const mockQueryDB = { allEntries: () => [] };
    const result = await verifyHybridSysml2Reachability(mockQueryDB, {
      timeSpan: "invalid_json_string",
    });

    assert(result.isCertifiedSafe);
    assert(result.totalSteps > 0);
  });
});
