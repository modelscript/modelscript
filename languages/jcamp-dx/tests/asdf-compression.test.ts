// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeXyData, encodeAsdf, parseAsdfLine } from "../src/parser/asdf.js";
import type { AsdfMode, JcampDataPoint } from "../src/types.js";

describe("@modelscript/jcamp-dx ASDF/DIFDUP Compression Codec", () => {
  it("decodes SQZ (@, A-I, a-i) pseudo-digits accurately", () => {
    const res = parseAsdfLine("4000 @A23b5I9i0");
    assert.strictEqual(res.rawX, 4000);
    assert.deepStrictEqual(res.rawYs, [0, 123, -25, 99, -90]);
    assert.strictEqual(res.endedInDif, false);
  });

  it("decodes DIF (%, J-R, j-r) differences accurately", () => {
    // Start at A00 (+100), +0 (%), +15 (J5), -20 (k0), +5 (N)
    const res = parseAsdfLine("1000 A00%J5k0N");
    assert.deepStrictEqual(res.rawYs, [100, 100, 115, 95, 100]);
    assert.strictEqual(res.endedInDif, true);
  });

  it("decodes DUP (S-Z, s) repeat counts on both SQZ values and DIF deltas", () => {
    // SQZ + DUP: A0 (+10) repeated 4 times (V), then b0 (-20) repeated 2 times (T)
    const sqzDup = parseAsdfLine("500 A0Vb0T");
    assert.deepStrictEqual(sqzDup.rawYs, [10, 10, 10, 10, -20, -20]);

    // DIF + DUP: A0 (+10), then diff +5 (N) repeated 3 times (U) -> 10, 15, 20, 25
    const difDup = parseAsdfLine("500 A0NU");
    assert.deepStrictEqual(difDup.rawYs, [10, 15, 20, 25]);
  });

  it("verifies DIFDUP line-to-line checkpoints and detects discontinuities", () => {
    // Line 1: 100, 110, 120, 130 (ends at 130 in DIF mode)
    // Line 2 valid checkpoint: starts at A30 (=130), then +5 -> 135, 140
    const valid = decodeXyData(["1000 A00J0U", "1003 A30NT"], {
      firstX: 1000,
      lastX: 1005,
    });
    assert.strictEqual(valid.checkpointErrors.length, 0);
    assert.deepStrictEqual(
      valid.points.map((p) => p.y),
      [100, 110, 120, 130, 135, 140],
    );

    // Line 2 corrupted checkpoint: starts at A45 (=145 != 130)
    const broken = decodeXyData(["1000 A00J0U", "1003 A45NT"], {
      firstX: 1000,
      lastX: 1005,
    });
    assert.strictEqual(broken.checkpointErrors.length, 1);
    assert.strictEqual(broken.checkpointErrors[0]!.expectedY, 130);
    assert.strictEqual(broken.checkpointErrors[0]!.actualY, 145);
  });

  it("round-trips AFFN, PAC, SQZ, DIF, DUP, and DIFDUP with zero data loss", () => {
    const points: JcampDataPoint[] = [];
    for (let i = 0; i < 40; i++) {
      const x = 4000 - i * 2;
      const y = Math.round(500 + 300 * Math.sin(i * 0.25) - (i % 5 === 0 ? 0 : 12));
      points.push({ x, y: y * 0.001 });
    }

    const modes: AsdfMode[] = ["AFFN", "PAC", "SQZ", "DIF", "DUP", "DIFDUP"];
    for (const mode of modes) {
      const encoded = encodeAsdf(points, { mode, xFactor: 1, yFactor: 0.001, pointsPerLine: 7 });
      const decoded = decodeXyData(encoded, {
        xFactor: 1,
        yFactor: 0.001,
        firstX: points[0]!.x,
        lastX: points[points.length - 1]!.x,
      });
      assert.strictEqual(decoded.checkpointErrors.length, 0, `${mode} should have zero checkpoint errors`);
      assert.strictEqual(decoded.points.length, points.length, `${mode} point count mismatch`);
      for (let i = 0; i < points.length; i++) {
        assert.ok(Math.abs(decoded.points[i]!.x - points[i]!.x) < 1e-10, `${mode} X mismatch at ${i}`);
        assert.ok(Math.abs(decoded.points[i]!.y - points[i]!.y) < 1e-10, `${mode} Y mismatch at ${i}`);
      }
    }
  });
});
