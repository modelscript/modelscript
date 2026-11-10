// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  auditFaultRideThrough,
  auditPqCapability,
  type PqCapabilityEnvelope,
  type PqOperatingPoint,
  STANDARD_GRID_CODE_PROFILES,
  type TrajectorySamplePoint,
} from "../src/solvers/compliance/gridcode-auditor.js";

test("auditFaultRideThrough: verifies compliant ENTSO-E RfG Type D LVRT trajectory", () => {
  const profile = STANDARD_GRID_CODE_PROFILES.entsoe_rfg_type_d!;

  // Synthetic compliant trajectory: 100ms fault dip to 0.15 pu, followed by recovery
  const compliantTrajectory: TrajectorySamplePoint[] = [
    { tSec: 0.0, voltagePu: 1.0, activePowerPu: 1.0, reactiveCurrentPu: 0.0 },
    { tSec: 0.05, voltagePu: 0.15, activePowerPu: 0.2, reactiveCurrentPu: 1.8 }, // in fault
    { tSec: 0.14, voltagePu: 0.15, activePowerPu: 0.2, reactiveCurrentPu: 1.8 },
    { tSec: 0.16, voltagePu: 0.85, activePowerPu: 0.7, reactiveCurrentPu: 0.4 }, // fault cleared
    { tSec: 0.30, voltagePu: 0.95, activePowerPu: 0.95, reactiveCurrentPu: 0.1 }, // active power recovered within 0.3s
    { tSec: 1.00, voltagePu: 1.0, activePowerPu: 1.0, reactiveCurrentPu: 0.0 },
  ];

  const result = auditFaultRideThrough(compliantTrajectory, profile);
  assert.strictEqual(result.compliant, true);
  assert.strictEqual(result.verdict, "PASS");
  assert.strictEqual(result.violatedPoints.length, 0);
  assert.strictEqual(result.activePowerRecovered, true);
  assert.ok(result.minObservedVoltagePu <= 0.15);
});

test("auditFaultRideThrough: flags non-compliant trajectory with voltage collapse / slow recovery", () => {
  const profile = STANDARD_GRID_CODE_PROFILES.ieee_2800_2022!;

  // Non-compliant trajectory: voltage remains at 0.10 pu for 0.5s (IEEE 2800 requires V >= 0.50 after 0.16s)
  const failingTrajectory: TrajectorySamplePoint[] = [
    { tSec: 0.0, voltagePu: 1.0, activePowerPu: 1.0 },
    { tSec: 0.10, voltagePu: 0.10, activePowerPu: 0.1 },
    { tSec: 0.30, voltagePu: 0.10, activePowerPu: 0.1 }, // violation of LVRT curve
    { tSec: 0.50, voltagePu: 0.10, activePowerPu: 0.1 }, // violation of LVRT curve
    { tSec: 1.50, voltagePu: 0.80, activePowerPu: 0.4 }, // slow active recovery
  ];

  const result = auditFaultRideThrough(failingTrajectory, profile);
  assert.strictEqual(result.compliant, false);
  assert.strictEqual(result.verdict, "FAIL");
  assert.ok(result.violatedPoints.length > 0, "Should have boundary violation points");
  assert.ok(result.violatedPoints.some((p) => p.violationType === "LVRT"));
});

test("auditPqCapability: verifies generator active/reactive capability envelope", () => {
  const envelope: PqCapabilityEnvelope = {
    name: "Solar PV Inverter 100MW",
    pMinPu: 0.0,
    pMaxPu: 1.0,
    qMinPu: -0.33, // 0.95 leading
    qMaxPu: 0.33, // 0.95 lagging
    minPowerFactor: 0.95,
    voltageBandPu: [0.90, 1.10],
  };

  const points: PqOperatingPoint[] = [
    { label: "Nominal Full Load", pPu: 1.0, qPu: 0.0, voltagePu: 1.0 },
    { label: "Lagging Limit", pPu: 0.9, qPu: 0.28, voltagePu: 1.0 },
    { label: "Leading Limit", pPu: 0.9, qPu: -0.28, voltagePu: 1.0 },
    { label: "Light Load", pPu: 0.2, qPu: 0.1, voltagePu: 1.02 },
  ];

  const result = auditPqCapability(points, envelope);
  assert.strictEqual(result.compliant, true);
  assert.strictEqual(result.verdict, "PASS");
  assert.strictEqual(result.violatingPoints.length, 0);
  assert.ok(result.qReserveMarginLeadingPu > 0);
  assert.ok(result.qReserveMarginLaggingPu > 0);

  // Test violating point (excessive reactive export Q = 0.50 pu > 0.33 pu)
  const invalidPoints: PqOperatingPoint[] = [
    { label: "Over-reactive Export", pPu: 1.0, qPu: 0.50, voltagePu: 1.0 },
  ];
  const invalidResult = auditPqCapability(invalidPoints, envelope);
  assert.strictEqual(invalidResult.compliant, false);
  assert.strictEqual(invalidResult.verdict, "FAIL");
  assert.strictEqual(invalidResult.violatingPoints.length, 1);
});
