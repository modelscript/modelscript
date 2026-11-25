// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { comparePowerFlowSnapshots, type PowerFlowSnapshot } from "../src/cosim/powerflow-comparison.js";

test("comparePowerFlowSnapshots reports PASS when PSS/E, PSCAD, and OpenDSS match within tolerance", () => {
  const psse: PowerFlowSnapshot = {
    solver: "psse",
    converged: true,
    frequencyHz: 60,
    sbaseMva: 100,
    buses: [
      { busId: "1", baseKv: 230, vmPu: 1.02, vaDeg: 0.0 },
      { busId: "2", baseKv: 230, vmPu: 1.005, vaDeg: -3.4 },
      { busId: "3", baseKv: 230, vmPu: 0.992, vaDeg: -6.1 },
    ],
    branches: [{ id: "1-2-1", fromBus: "1", toBus: "2", ckt: "1", pFlowMw: 45.2, qFlowMvar: 8.1 }],
  };

  const pscad: PowerFlowSnapshot = {
    solver: "pscad",
    converged: true,
    frequencyHz: 60,
    sbaseMva: 100,
    buses: [
      { busId: "1", baseKv: 230, vmPu: 1.0205, vaDeg: 0.05 },
      { busId: "2", baseKv: 230, vmPu: 1.0042, vaDeg: -3.48 },
      { busId: "3", baseKv: 230, vmPu: 0.9915, vaDeg: -6.15 },
    ],
    branches: [{ id: "1-2-1", fromBus: "1", toBus: "2", ckt: "1", pFlowMw: 45.4, qFlowMvar: 8.3 }],
  };

  const opendss: PowerFlowSnapshot = {
    solver: "opendss",
    converged: true,
    frequencyHz: 60,
    sbaseMva: 100,
    buses: [
      { busId: "Bus_1", baseKv: 230, vmPu: 1.0198, vaDeg: -0.02 },
      { busId: "Bus_2", baseKv: 230, vmPu: 1.0048, vaDeg: -3.38 },
      { busId: "Bus_3", baseKv: 230, vmPu: 0.9921, vaDeg: -6.08 },
    ],
    branches: [],
  };

  const report = comparePowerFlowSnapshots(psse, [pscad, opendss]);
  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.pairs.length, 2);
  assert.equal(report.pairs[0]!.matchedBuses, 3);
  assert.equal(report.pairs[1]!.matchedBuses, 3);
  assert.ok(report.maxDeltaVmPu < 0.005);
  assert.ok(report.maxDeltaVaDeg < 0.5);
});

test("comparePowerFlowSnapshots flags FAIL when voltage deviation exceeds 3x tolerance", () => {
  const base: PowerFlowSnapshot = {
    solver: "psse",
    converged: true,
    frequencyHz: 60,
    sbaseMva: 100,
    buses: [{ busId: "1", vmPu: 1.02, vaDeg: 0 }],
    branches: [],
  };
  const drifted: PowerFlowSnapshot = {
    solver: "pscad",
    converged: true,
    frequencyHz: 60,
    sbaseMva: 100,
    buses: [{ busId: "1", vmPu: 0.98, vaDeg: 0 }],
    branches: [],
  };

  const report = comparePowerFlowSnapshots(base, [drifted]);
  assert.equal(report.overallStatus, "FAIL");
  assert.equal(report.pairs[0]!.busDeltas[0]!.withinTolerance, false);
});
