// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMacroExpression } from "../src/diagram/data.js";
import { convertSmoothPath } from "../src/diagram/svg.js";

describe("Modelica MSL Parity: Cubic Splines & Macro Evaluation", () => {
  it("should convert smooth points to C1 continuous Catmull-Rom cubic Bezier curve commands", () => {
    const points: [number, number][] = [
      [0, 0],
      [50, 100],
      [100, 50],
      [150, 150],
    ];

    const commands = convertSmoothPath(points);
    assert.strictEqual(commands.length, 4); // M + 3 segments (C)

    assert.strictEqual(commands[0][0], "M");
    assert.strictEqual(commands[0][1], 0);
    assert.strictEqual(commands[0][2], -0); // svg.ts negates y

    for (let i = 1; i < commands.length; i++) {
      const cmd = commands[i];
      assert.strictEqual(cmd[0], "C", `Segment ${i} should be a cubic Bezier command`);
      assert.strictEqual(cmd.length, 7); // C, c1x, c1y, c2x, c2y, p2x, p2y
    }

    // Verify endpoint of final segment matches last point
    const lastCmd = commands[commands.length - 1];
    assert.strictEqual(lastCmd[5], 150);
    assert.strictEqual(lastCmd[6], -150);
  });

  it("should evaluate conditional ternary macros in text annotations", () => {
    // Mock component instance with parameters
    const mockComponentOpen = {
      name: "switch1",
      modification: {
        getModificationArgument: (name: string) => {
          if (name === "isOpen") return { expression: "true" };
          if (name === "R") return { expression: "100" };
          return undefined;
        },
      },
    };

    const mockComponentClosed = {
      name: "switch2",
      modification: {
        getModificationArgument: (name: string) => {
          if (name === "isOpen") return { expression: "false" };
          if (name === "R") return { expression: "20" };
          return undefined;
        },
      },
    };

    // 1. Basic parameter lookup
    const resR = evaluateMacroExpression("R", undefined, mockComponentOpen as any);
    assert.strictEqual(resR, "100");

    // 2. Conditional if-then-else when true
    const resTrue = evaluateMacroExpression('if isOpen then "OPEN" else "CLOSED"', undefined, mockComponentOpen as any);
    assert.strictEqual(resTrue, "OPEN");

    // 3. Conditional if-then-else when false
    const resFalse = evaluateMacroExpression(
      'if isOpen then "OPEN" else "CLOSED"',
      undefined,
      mockComponentClosed as any,
    );
    assert.strictEqual(resFalse, "CLOSED");

    // 4. Comparison expression
    const resCompHigh = evaluateMacroExpression(
      'if R > 50 then "HIGH" else "LOW"',
      undefined,
      mockComponentOpen as any,
    );
    assert.strictEqual(resCompHigh, "HIGH");

    const resCompLow = evaluateMacroExpression(
      'if R > 50 then "HIGH" else "LOW"',
      undefined,
      mockComponentClosed as any,
    );
    assert.strictEqual(resCompLow, "LOW");

    // 5. Negation condition
    const resNot = evaluateMacroExpression(
      'if not isOpen then "INACTIVE" else "ACTIVE"',
      undefined,
      mockComponentOpen as any,
    );
    assert.strictEqual(resNot, "ACTIVE");
  });
});
