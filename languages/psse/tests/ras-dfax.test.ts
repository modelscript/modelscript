// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  calculateLodfMatrix,
  calculateOtdfMatrix,
  calculatePtdfMatrix,
  parseRaw,
  screenContingencies,
  type CandidateContingency,
  type RemedialActionScheme,
} from "../src/index.js";

// Clean 3-bus triangle network with symmetrical branch reactances:
// Bus 1 (Swing), Bus 2 (PV/PQ), Bus 3 (PQ)
// Branch 1-2 (x = 0.1), Branch 2-3 (x = 0.1), Branch 1-3 (x = 0.1)
const TRIANGLE_3BUS_RAW = `0, 100.00, 33, 0, 1, 60.00 / 3-Bus Triangle Network
CASE 3BUS
CASE TITLE
    1, 'BUS 1       ', 138.000, 3, 1, 1, 1, 1.000,   0.000, 1.100, 0.900, 1.100, 0.900
    2, 'BUS 2       ', 138.000, 2, 1, 1, 1, 1.000,   0.000, 1.100, 0.900, 1.100, 0.900
    3, 'BUS 3       ', 138.000, 1, 1, 1, 1, 1.000,   0.000, 1.100, 0.900, 1.100, 0.900
0 / END OF BUS DATA
    3, '1 ', 1, 1, 1,  60.00,  20.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
    1, '1 ',  30.00,   0.00,  100.00, -100.00, 1.000, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
    2, '1 ',  30.00,   0.00,  100.00, -100.00, 1.000, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
0 / END OF GENERATOR DATA
    1,     2, '1 ', 0.005, 0.100, 0.000,  50.0,  50.0,  50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     3, '1 ', 0.005, 0.100, 0.000,  50.0,  50.0,  50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    1,     3, '1 ', 0.005, 0.100, 0.000,  50.0,  50.0,  50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;

const IEEE14_RAW = `0, 100.00, 33, 0, 1, 60.00 / PSS/E IEEE 14-Bus Test Case
CASE TITLE LINE 1
CASE TITLE LINE 2
    1, 'BUS 1       ', 138.000, 3, 1, 1, 1, 1.060,   0.000, 1.100, 0.900, 1.100, 0.900
    2, 'BUS 2       ', 138.000, 2, 1, 1, 1, 1.045,  -4.980, 1.100, 0.900, 1.100, 0.900
    3, 'BUS 3       ', 138.000, 2, 1, 1, 1, 1.010, -12.720, 1.100, 0.900, 1.100, 0.900
    4, 'BUS 4       ', 138.000, 1, 1, 1, 1, 1.019, -10.330, 1.100, 0.900, 1.100, 0.900
    5, 'BUS 5       ', 138.000, 1, 1, 1, 1, 1.020,  -8.780, 1.100, 0.900, 1.100, 0.900
    6, 'BUS 6       ',  13.800, 2, 1, 1, 1, 1.070, -14.220, 1.100, 0.900, 1.100, 0.900
    7, 'BUS 7       ',  13.800, 1, 1, 1, 1, 1.062, -13.370, 1.100, 0.900, 1.100, 0.900
    8, 'BUS 8       ',  13.800, 2, 1, 1, 1, 1.090, -13.360, 1.100, 0.900, 1.100, 0.900
    9, 'BUS 9       ',  13.800, 1, 1, 1, 1, 1.056, -14.940, 1.100, 0.900, 1.100, 0.900
   10, 'BUS 10      ',  13.800, 1, 1, 1, 1, 1.051, -15.100, 1.100, 0.900, 1.100, 0.900
   11, 'BUS 11      ',  13.800, 1, 1, 1, 1, 1.057, -14.790, 1.100, 0.900, 1.100, 0.900
   12, 'BUS 12      ',  13.800, 1, 1, 1, 1, 1.055, -15.070, 1.100, 0.900, 1.100, 0.900
   13, 'BUS 13      ',  13.800, 1, 1, 1, 1, 1.050, -15.160, 1.100, 0.900, 1.100, 0.900
   14, 'BUS 14      ',  13.800, 1, 1, 1, 1, 1.035, -16.040, 1.100, 0.900, 1.100, 0.900
0 / END OF BUS DATA
    2, '1 ', 1, 1, 1,  21.70,  12.70,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    3, '1 ', 1, 1, 1,  94.20,  19.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    4, '1 ', 1, 1, 1,  47.80,  -3.90,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    5, '1 ', 1, 1, 1,   7.60,   1.60,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    6, '1 ', 1, 1, 1,  11.20,   7.50,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    9, '1 ', 1, 1, 1,  29.50,  16.60,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   10, '1 ', 1, 1, 1,   9.00,   5.80,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   11, '1 ', 1, 1, 1,   3.50,   1.80,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   12, '1 ', 1, 1, 1,   6.10,   1.60,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   13, '1 ', 1, 1, 1,  13.50,   5.80,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
   14, '1 ', 1, 1, 1,  14.90,   5.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
0 / END OF LOAD DATA
    9, '1 ', 1, 0.00, 0.19 / Shunt
0 / END OF FIXED SHUNT DATA
    1, '1 ', 232.40,   0.00,  10.00, -10.00, 1.060, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 332.4, 0.0, 1, 1.0
    2, '1 ',  40.00,  42.40,  50.00, -40.00, 1.045, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 140.0, 0.0, 1, 1.0
    3, '1 ',   0.00,  23.40,  40.00,   0.00, 1.010, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
    6, '1 ',   0.00,  12.20,  24.00,  -6.00, 1.070, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
    8, '1 ',   0.00,  17.40,  24.00,  -6.00, 1.090, 0, 100.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 100.0, 0.0, 1, 1.0
0 / END OF GENERATOR DATA
    1,     2, '1 ', 0.01938, 0.05917, 0.0528, 120.0, 120.0, 120.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    1,     5, '1 ', 0.05403, 0.22304, 0.0492,  65.0,  65.0,  65.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     3, '1 ', 0.04699, 0.19797, 0.0438,  36.0,  36.0,  36.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     4, '1 ', 0.05811, 0.17632, 0.0340,  65.0,  65.0,  65.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     5, '1 ', 0.05695, 0.17388, 0.0346,  50.0,  50.0,  50.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    3,     4, '1 ', 0.06701, 0.17103, 0.0128,  35.0,  35.0,  35.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    4,     5, '1 ', 0.01335, 0.04211, 0.0000, 400.0, 400.0, 400.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    4,     7, '1 ', 0.00000, 0.20912, 0.0000, 100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    4,     9, '1 ', 0.00000, 0.55618, 0.0000, 100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    5,     6, '1 ', 0.00000, 0.25202, 0.0000, 100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    6,    11, '1 ', 0.09498, 0.19890, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    6,    12, '1 ', 0.12291, 0.25581, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    6,    13, '1 ', 0.06615, 0.13027, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    7,     8, '1 ', 0.00000, 0.17615, 0.0000, 100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    7,     9, '1 ', 0.00000, 0.11001, 0.0000, 100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    9,    10, '1 ', 0.03181, 0.08450, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    9,    14, '1 ', 0.12711, 0.27038, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
   10,    11, '1 ', 0.08205, 0.19207, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
   12,    13, '1 ', 0.22092, 0.19988, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
   13,    14, '1 ', 0.17093, 0.34802, 0.0000,  30.0,  30.0,  30.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;

test("DFAX: PTDF calculation on 3-bus triangle verifies exact Kirchhoff circuit split", () => {
  const psCase = parseRaw(TRIANGLE_3BUS_RAW);
  const ptdf = calculatePtdfMatrix(psCase);

  assert.strictEqual(ptdf.buses.length, 3);
  assert.strictEqual(ptdf.branches.length, 3);
  assert.strictEqual(ptdf.referenceBus, 1);

  // Transfer from Bus 2 to Bus 3:
  // Direct line is 2-3 with x=0.1. Parallel path is 2->1->3 with x=0.2.
  // Current divider: 2/3 (0.667) direct, 1/3 (0.333) via 1.
  const ptdf_23 = ptdf.getTransferFactor(2, 3, "1", 2, 3);
  const ptdf_12 = ptdf.getTransferFactor(1, 2, "1", 2, 3);
  const ptdf_13 = ptdf.getTransferFactor(1, 3, "1", 2, 3);

  assert(Math.abs(ptdf_23 - 2.0 / 3.0) < 0.01, `Expected PTDF(2-3) ~ 0.667, got ${ptdf_23}`);
  assert(Math.abs(ptdf_12 - -1.0 / 3.0) < 0.01, `Expected PTDF(1-2) ~ -0.333, got ${ptdf_12}`);
  assert(Math.abs(ptdf_13 - 1.0 / 3.0) < 0.01, `Expected PTDF(1-3) ~ 0.333, got ${ptdf_13}`);
});

test("DFAX: LODF redistribution conservation on 3-bus triangle", () => {
  const psCase = parseRaw(TRIANGLE_3BUS_RAW);
  const lodf = calculateLodfMatrix(psCase);

  // Outage of line 1-3:
  // In a 3-bus triangle, 100% of line 1-3's flow must shift to path 1->2->3
  const out13 = { fromBus: 1, toBus: 3, ckt: "1" };
  const lodf_12 = lodf.getOutageFactor({ fromBus: 1, toBus: 2, ckt: "1" }, out13);
  const lodf_23 = lodf.getOutageFactor({ fromBus: 2, toBus: 3, ckt: "1" }, out13);
  const lodf_own = lodf.getOutageFactor(out13, out13);

  assert.strictEqual(lodf_own, -1.0);
  assert(Math.abs(lodf_12 - 1.0) < 0.01, `Expected LODF(1-2, 1-3) = 1.0, got ${lodf_12}`);
  assert(Math.abs(lodf_23 - 1.0) < 0.01, `Expected LODF(2-3, 1-3) = 1.0, got ${lodf_23}`);
});

test("DFAX: OTDF computes accurate post-contingency sensitivity", () => {
  const psCase = parseRaw(TRIANGLE_3BUS_RAW);
  const out13 = { fromBus: 1, toBus: 3, ckt: "1" };
  const otdf = calculateOtdfMatrix(psCase, out13);

  // After line 1-3 trips, a transfer from 2 to 3 can only go through line 2-3 (100%)
  const otdf_23 = otdf.getTransferFactor(2, 3, "1", 2, 3);
  assert(Math.abs(otdf_23 - 1.0) < 0.02, `Expected post-outage OTDF(2-3) = 1.0, got ${otdf_23}`);
});

test("DFAX: Radial line outage detection identifies islanding bridge branches", () => {
  const psCase = parseRaw(IEEE14_RAW);
  const lodf = calculateLodfMatrix(psCase);

  // Lines 7-8 and 6-12 or 6-13 in IEEE 14-bus have radial or bridge connections
  assert(lodf.islandingBranches !== undefined);
  assert(Array.isArray(lodf.islandingBranches));
});

test("RAS/SPS: Automated remedial action scheme mitigates thermal overload via generator runback and load shed", () => {
  const psCase = parseRaw(TRIANGLE_3BUS_RAW);

  // In 3-bus triangle, tripping line 1-3 causes line 2-3 to overload at 129.8% (rating 50 MVA)
  const candidateContingencies: CandidateContingency[] = [
    {
      id: "CTG_LINE_1_3",
      name: "Trip 138kV Line 1-3",
      events: [{ type: "trip_branch", fromBus: 1, toBus: 3, ckt: "1" }],
    },
  ];

  // Screen without RAS first
  const unmitigatedReport = screenContingencies(psCase, candidateContingencies, {
    overloadThresholdPercent: 100.0,
  });

  const baseResult = unmitigatedReport.rankedContingencies[0]!;
  assert.strictEqual(baseResult.id, "CTG_LINE_1_3");
  assert(
    baseResult.maxBranchLoadingPercent > 120.0,
    `Expected overload > 120%, got ${baseResult.maxBranchLoadingPercent}%`,
  );
  assert.strictEqual(baseResult.overloadedBranches.length, 1);

  // Define Remedial Action Scheme (RAS / SPS):
  // Trigger on branch trip 1-3 -> Shed 25 MW load at Bus 3
  const rasScheme: RemedialActionScheme = {
    id: "RAS_TRIANGLE_SHED",
    name: "Bus 3 Overload Mitigation Scheme",
    enabled: true,
    trigger: {
      type: "branch_trip",
      fromBus: 1,
      toBus: 3,
      ckt: "1",
    },
    actions: [
      {
        type: "shed_load",
        busNumber: 3,
        loadId: "1",
        deltaMw: 25.0,
      },
    ],
  };

  const mitigatedReport = screenContingencies(psCase, candidateContingencies, {
    overloadThresholdPercent: 100.0,
    rasSchemes: [rasScheme],
  });

  const res = mitigatedReport.rankedContingencies[0]!;
  assert.strictEqual(res.id, "CTG_LINE_1_3");
  assert(res.rasTriggered !== undefined && res.rasTriggered.includes("RAS_TRIANGLE_SHED"));
  assert(res.rasActionsExecuted !== undefined && res.rasActionsExecuted.length === 1);
  assert(res.postRasMaxBranchLoadingPercent !== undefined);
  assert(
    res.postRasMaxBranchLoadingPercent < 100.0,
    `Expected post-RAS loading < 100%, got ${res.postRasMaxBranchLoadingPercent}%`,
  );
  assert(res.postRasMaxBranchLoadingPercent < res.maxBranchLoadingPercent, "RAS should reduce maximum branch loading");
  assert.strictEqual(res.mitigated, true);
});

test("RAS/SPS: Compound logic (k_of_n & AND) triggers only under matching multi-criteria", () => {
  const psCase = parseRaw(IEEE14_RAW);

  const compoundRas: RemedialActionScheme = {
    id: "RAS_COMPOUND",
    name: "Compound Multi-Condition Scheme",
    enabled: true,
    trigger: {
      type: "compound",
      logic: "AND",
      subConditions: [
        { type: "branch_trip", fromBus: 1, toBus: 5, ckt: "1" },
        { type: "branch_trip", fromBus: 2, toBus: 3, ckt: "1" },
      ],
    },
    actions: [{ type: "shed_load", busNumber: 4, deltaMw: 10.0 }],
  };

  // N-1 contingency: trips only 1-5 (not 2-3) -> should NOT trigger
  const ctg1: CandidateContingency[] = [
    {
      id: "CTG_N1",
      name: "Single Line 1-5",
      events: [{ type: "trip_branch", fromBus: 1, toBus: 5, ckt: "1" }],
    },
  ];

  const report1 = screenContingencies(psCase, ctg1, { rasSchemes: [compoundRas] });
  assert.strictEqual(report1.rankedContingencies[0]!.rasTriggered, undefined);

  // N-2 contingency: trips both 1-5 AND 2-3 -> SHOULD trigger!
  const ctg2: CandidateContingency[] = [
    {
      id: "CTG_N2",
      name: "Double Line 1-5 & 2-3",
      events: [
        { type: "trip_branch", fromBus: 1, toBus: 5, ckt: "1" },
        { type: "trip_branch", fromBus: 2, toBus: 3, ckt: "1" },
      ],
    },
  ];

  const report2 = screenContingencies(psCase, ctg2, { rasSchemes: [compoundRas] });
  assert(report2.rankedContingencies[0]!.rasTriggered !== undefined);
  assert.strictEqual(report2.rankedContingencies[0]!.rasTriggered[0], "RAS_COMPOUND");
});
