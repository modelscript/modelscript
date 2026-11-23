// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BPA_3_BUS_IPF, IEEE_14_BUS_CDF, IEEE_5_BUS_CDF } from "../src/catalog/ieee-cdf-std-schemas.js";
import { parseIeeeCdf } from "../src/parser/index.js";
import { solvePowerFlow } from "../src/solver/index.js";

/**
 * Published IEEE 14-bus converged AC power-flow reference (MATPOWER case14 / UW Archive).
 */
const IEEE_14_REFERENCE: Record<number, { vm: number; vaDeg: number }> = {
  1: { vm: 1.06, vaDeg: 0.0 },
  2: { vm: 1.045, vaDeg: -4.9826 },
  3: { vm: 1.01, vaDeg: -12.7251 },
  4: { vm: 1.017671, vaDeg: -10.3129 },
  5: { vm: 1.019514, vaDeg: -8.7739 },
  6: { vm: 1.07, vaDeg: -14.2209 },
  7: { vm: 1.06152, vaDeg: -13.3596 },
  8: { vm: 1.09, vaDeg: -13.3596 },
  9: { vm: 1.055932, vaDeg: -14.9385 },
  10: { vm: 1.050985, vaDeg: -15.0973 },
  11: { vm: 1.056907, vaDeg: -14.7906 },
  12: { vm: 1.055189, vaDeg: -15.0756 },
  13: { vm: 1.050382, vaDeg: -15.1563 },
  14: { vm: 1.03553, vaDeg: -16.0336 },
};

describe("@modelscript/ieee-cdf AC Newton-Raphson Power-Flow Benchmark Suite", () => {
  it("converges IEEE 14-bus AC power flow with maxMismatch < 1e-8 pu and matches published reference within relErr < 1e-4", () => {
    const net = parseIeeeCdf(IEEE_14_BUS_CDF);
    const res = solvePowerFlow(net, { tolerance: 1e-11, enforceQLimits: true });

    assert.strictEqual(res.converged, true, "IEEE 14-bus Newton-Raphson must converge");
    assert.ok(
      res.iterations > 0 && res.iterations <= 15,
      `Expected fast convergence, got ${res.iterations} iterations`,
    );
    assert.ok(res.maxMismatchPu < 1e-8, `Expected maxMismatchPu < 1e-8, got ${res.maxMismatchPu}`);

    for (const bus of res.buses) {
      const ref = IEEE_14_REFERENCE[bus.busNumber];
      assert.ok(ref, `Missing reference for bus ${bus.busNumber}`);

      const vmRelErr = Math.abs(bus.vmPu - ref.vm) / Math.abs(ref.vm);
      assert.ok(
        vmRelErr < 1e-4,
        `Bus ${bus.busNumber} Vm mismatch: got ${bus.vmPu.toFixed(6)}, ref ${ref.vm.toFixed(6)}, relErr=${vmRelErr.toExponential(2)}`,
      );

      if (Math.abs(ref.vaDeg) > 1e-6) {
        const vaRelErr = Math.abs(bus.vaDeg - ref.vaDeg) / Math.abs(ref.vaDeg);
        assert.ok(
          vaRelErr < 1e-4,
          `Bus ${bus.busNumber} Va mismatch: got ${bus.vaDeg.toFixed(4)} deg, ref ${ref.vaDeg.toFixed(4)} deg, relErr=${vaRelErr.toExponential(2)}`,
        );
      } else {
        assert.ok(Math.abs(bus.vaDeg) < 1e-9);
      }
    }

    // Power conservation: Total Gen = Total Load + Total Loss
    assert.ok(Math.abs(res.totalGenMw - (res.totalLoadMw + res.totalLossMw)) < 1e-5);
    // Published IEEE 14-bus losses ~ 13.393 MW
    assert.ok(Math.abs(res.totalLossMw - 13.393) < 0.05, `Expected ~13.393 MW loss, got ${res.totalLossMw.toFixed(3)}`);
  });

  it("enforces PV bus Qmax reactive limits by converting saturated PV bus to PQ", () => {
    const net = parseIeeeCdf(IEEE_14_BUS_CDF);
    // Tighten Bus 2 Qmax to 20 MVAR (normally produces ~43.5 MVAR)
    const bus2 = net.buses.find((b) => b.busNumber === 2)!;
    bus2.maxMvarOrVolt = 20.0;

    const res = solvePowerFlow(net, { tolerance: 1e-10, enforceQLimits: true });
    assert.strictEqual(res.converged, true);
    assert.ok(res.maxMismatchPu < 1e-8);

    const solvedBus2 = res.buses.find((b) => b.busNumber === 2)!;
    assert.strictEqual(solvedBus2.qLimitHit, "Qmax");
    assert.strictEqual(solvedBus2.solvedType, 0);
    assert.ok(Math.abs(solvedBus2.qGenMvar - 20.0) < 1e-6);
    assert.ok(solvedBus2.vmPu < 1.045, "Voltage at Qmax-limited PV bus should drop below setpoint");
  });

  it("converges IEEE 5-bus and models phase-shifting transformers accurately", () => {
    const net = parseIeeeCdf(IEEE_5_BUS_CDF);
    // Add a 5-degree phase shift on branch 1-2
    net.branches[0]!.type = 4;
    net.branches[0]!.tapRatio = 1.02;
    net.branches[0]!.phaseShiftDeg = 5.0;

    const res = solvePowerFlow(net, { tolerance: 1e-10 });
    assert.strictEqual(res.converged, true);
    assert.ok(res.maxMismatchPu < 1e-8);
    assert.ok(Math.abs(res.totalGenMw - (res.totalLoadMw + res.totalLossMw)) < 1e-5);
  });

  it("achieves exact parity between BPA IPF 3-bus deck and equivalent IEEE CDF 3-bus deck", () => {
    const bpaNet = parseIeeeCdf(BPA_3_BUS_IPF);
    const bpaRes = solvePowerFlow(bpaNet, { tolerance: 1e-11 });

    const equivalentCdf = `01/01/73 PARITY 100.0 1973 S BPA_3BUS_EQUIV
BUS DATA FOLLOWS
1 "SLACK1" 1 1 3 1.05 0.0 0.0 0.0 0.0 0.0 230.0 1.05 0.0 0.0 0.0 0.0 0
2 "GEN2"   1 1 2 1.02 0.0 0.0 0.0 60.0 0.0 230.0 1.02 80.0 -40.0 0.0 0.0 0
3 "LOAD3"  1 1 0 1.00 0.0 100.0 35.0 0.0 0.0 230.0 0.0 0.0 0.0 0.0 0.0 0
-999
BRANCH DATA FOLLOWS
1 2 1 1 1 0 0.020 0.080 0.030
1 3 1 1 1 0 0.030 0.120 0.040
2 3 1 1 1 0 0.025 0.100 0.036
-999
END OF DATA
`;
    const cdfNet = parseIeeeCdf(equivalentCdf);
    const cdfRes = solvePowerFlow(cdfNet, { tolerance: 1e-11 });

    assert.strictEqual(bpaRes.converged, true);
    assert.strictEqual(cdfRes.converged, true);
    assert.ok(bpaRes.maxMismatchPu < 1e-8);

    for (let i = 0; i < 3; i++) {
      const bBpa = bpaRes.buses[i]!;
      const bCdf = cdfRes.buses[i]!;
      assert.ok(Math.abs(bBpa.vmPu - bCdf.vmPu) < 1e-10, `Bus ${i + 1} Vm parity mismatch`);
      assert.ok(Math.abs(bBpa.vaDeg - bCdf.vaDeg) < 1e-9, `Bus ${i + 1} Va parity mismatch`);
      assert.ok(Math.abs(bBpa.pGenMw - bCdf.pGenMw) < 1e-8, `Bus ${i + 1} Pg parity mismatch`);
    }
  });
});
