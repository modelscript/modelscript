// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { lintHybridBoundary } from "../src/cosim/hybrid-boundary-linter.js";

test("lintHybridBoundary detects frequency mismatch (H1001), base-kV mismatch (H1002), t=0 power imbalance (H1003), low SCR (H1004), and non-passive FDNE (H1005)", () => {
  const diags = lintHybridBoundary({
    phasorFrequencyHz: 60.0,
    emtFrequencyHz: 50.0,
    baseMva: 100.0,
    ports: [
      {
        phasorBusId: "15",
        emtBusId: "B3",
        phasorBaseKv: 138.0,
        emtBaseKv: 230.0,
        phasorPoiMw: 80.0,
        emtPoiMw: 45.0,
        yEqPosPu: { re: 0.2, im: -1.5 }, // S_sc = 151 MVA; with 100 MW plant => SCR = 1.51 < 3.0
        emtPlantRatedMw: 100.0,
        fdneModel: { d: -0.01, e: 0, poles: [], rmsRelError: 0.05, minRealPart: -0.01, isPassive: false },
      },
    ],
  });

  const codes = new Set(diags.map((d) => d.code));
  assert.ok(codes.has("H1001"));
  assert.ok(codes.has("H1002"));
  assert.ok(codes.has("H1003"));
  assert.ok(codes.has("H1004"));
  assert.ok(codes.has("H1005"));
});

test("lintHybridBoundary passes cleanly on a well-matched 230 kV 60 Hz strong-grid boundary", () => {
  const diags = lintHybridBoundary({
    phasorFrequencyHz: 60.0,
    emtFrequencyHz: 60.0,
    baseMva: 100.0,
    ports: [
      {
        phasorBusId: "5",
        emtBusId: "B3",
        phasorBaseKv: 230.0,
        emtBaseKv: 230.0,
        phasorPoiMw: 60.0,
        emtPoiMw: 58.0,
        yEqPosPu: { re: 0.5, im: -8.0 }, // S_sc = 801 MVA; with 100 MW plant => SCR = 8.01 >= 3.0
        emtPlantRatedMw: 100.0,
        fdneModel: { d: 0.01, e: 0, poles: [], rmsRelError: 0.02, minRealPart: 0.01, isPassive: true },
      },
    ],
  });

  assert.equal(
    diags.length,
    0,
    `Expected 0 diagnostics on clean boundary, got: ${diags.map((d) => d.code).join(", ")}`,
  );
});
