// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseAtopile } from "../src/parser/atopile-parser.js";
import { runAtopileToleranceUQ } from "../src/uq.js";

describe("@modelscript/atopile — Worst-Case Corner & Monte Carlo Tolerance UQ", () => {
  it("computes RC cutoff frequency and divider gain uncertainty bounds from +/- % tolerances", () => {
    const file = parseAtopile(`
module FilterAndDivider:
    r1 = new Resistor
    r2 = new Resistor
    c1 = new Capacitor
    r1.resistance = 10kohm +/- 1%
    r2.resistance = 10kohm +/- 1%
    c1.capacitance = 100nF +/- 5%
`);

    const uq = runAtopileToleranceUQ(file, { samples: 1000, seed: 123 });
    assert.strictEqual(uq.parameters.length, 3);
    assert.strictEqual(uq.metrics.length, 2);

    const fc = uq.metrics.find((m) => m.name === "rc_cutoff_freq")!;
    // 1 / (2*pi*10k*100nF) ~= 159.155 Hz
    assert(Math.abs(fc.nominal - 159.155) < 0.1);
    assert(fc.worstCaseMin < fc.nominal && fc.worstCaseMax > fc.nominal);
    assert(fc.mcStdDev > 0);

    const div = uq.metrics.find((m) => m.name === "divider_ratio")!;
    assert(Math.abs(div.nominal - 0.5) < 1e-6);
    assert(div.worstCaseMin > 0.49 && div.worstCaseMax < 0.51);
  });
});
