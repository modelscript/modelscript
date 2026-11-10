// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for EPA SWMM (Storm Water Management Model).
 *
 * Evaluates:
 * 1. 1D Dynamic Wave Saint-Venant hydraulic routing through urban pipe networks
 * 2. Horton infiltration and subcatchment rainfall-runoff dynamics
 * 3. Preissmann slot open-channel to pressurized pipe flow transition
 * 4. DAE arena lowering with exact continuity conservation
 */

import assert from "node:assert/strict";
import {
  parseSwmm,
  solveSwmmHydraulics,
  solveSwmmDynamicWave,
  computeSubcatchmentRunoff,
  computePreissmannSection,
  lowerSwmmToDae,
  type SwmmDeck,
} from "../src/index.js";

export const SWMM_URBAN_WATERSHED_BENCHMARK = `[TITLE]
;; EPA SWMM 5.2 Benchmark: 5-Node Urban Watershed with Mixed Conduits
EPA SWMM Reference Watershed and Dual Drainage Benchmark

[OPTIONS]
FLOW_UNITS          CMS
FLOW_ROUTING        DYNWAVE
INFILTRATION        HORTON
START_DATE          01/01/2026
START_TIME          00:00:00
REPORT_START_DATE   01/01/2026
REPORT_START_TIME   00:00:00
END_DATE            01/01/2026
END_TIME            06:00:00
ALLOW_PONDING       YES

[JUNCTIONS]
;;Name           Elevation  MaxDepth   InitDepth  SurDepth   Apond
J1               30.00      3.00       0.50       0.00       50.0
J2               28.50      3.00       0.40       0.00       50.0
J3               26.00      3.50       0.40       0.00       60.0
J4               24.00      4.00       0.60       1.00       80.0
J5               25.00      4.00       0.50       0.00       40.0

[OUTFALLS]
;;Name           Elevation  Type       Stage Data       Gated
OF1              20.00      FREE                        NO

[CONDUITS]
;;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow
C1               J1               J2               150.00     0.013      0.00       0.00       0.00       0.00
C2               J2               J3               200.00     0.013      0.00       0.00       0.00       0.00
C3               J3               J4               180.00     0.012      0.00       0.00       0.00       0.00
C4               J4               OF1              250.00     0.015      0.00       0.00       0.00       0.00
C_BYPASS         J2               J5               100.00     0.014      0.00       0.00       0.00       0.00
C5               J5               OF1              120.00     0.014      0.00       0.00       0.00       0.00

[XSECTIONS]
;;Link           Shape        Geom1      Geom2      Geom3      Geom4      Barrels
C1               CIRCULAR     1.50       0.00       0.00       0.00       1
C2               CIRCULAR     1.80       0.00       0.00       0.00       1
C3               RECT_CLOSED  2.00       1.50       0.00       0.00       1
C4               CIRCULAR     2.20       0.00       0.00       0.00       1
C_BYPASS         CIRCULAR     1.00       0.00       0.00       0.00       1
C5               CIRCULAR     1.00       0.00       0.00       0.00       1

[SUBCATCHMENTS]
;;Name           RainGage         Outlet           Area     PctImperv Width    PctSlope CurbLen  SnowPack
SC1              RG1              J1               5.00     70.00     250.00   2.00     0.00
SC2              RG1              J2               8.50     55.00     320.00   1.80     0.00
SC3              RG1              J3               12.00    80.00     450.00   2.50     0.00

[INFILTRATION]
;;Subcatchment   MaxRate    MinRate    Decay      DryTime    MaxInfil
SC1              75.00      7.50       3.00       7.00       0.00
SC2              75.00      7.50       3.00       7.00       0.00
SC3              75.00      7.50       3.00       7.00       0.00

[INFLOWS]
;;Node           Parameter        Time Series      Type     Mfactor  Sfactor  Base     Pat
J1               FLOW             ""               FLOW     1.0      1.0      3.50     ""
`;

export interface SwmmBenchmarkMetrics {
  nodesCount: number;
  conduitsCount: number;
  subcatchmentsCount: number;
  totalInflowCms: number;
  outfallDischargeCms: number;
  continuityErrorPct: number;
  preissmannCelerityMS: number;
  daeVarCount: number;
  daeEqCount: number;
}

export function runSwmmBenchmark(deckContent = SWMM_URBAN_WATERSHED_BENCHMARK): SwmmBenchmarkMetrics {
  const project: SwmmDeck = parseSwmm(deckContent);

  assert.ok(project, "Parsed SWMM project must be non-null");
  assert.ok(project.junctions.size >= 5, "Must contain >= 5 junctions");
  assert.ok(project.conduits.size >= 6, "Must contain >= 6 conduits");
  assert.ok(project.subcatchments.size >= 3, "Must contain >= 3 subcatchments");

  // 1. Evaluate Horton Runoff
  const sc1 = project.subcatchments.get("SC1")!;
  const qRunoff = computeSubcatchmentRunoff(sc1, 0.015, { depressionStorage: 0.002, manningN: 0.015 });
  assert.ok(qRunoff > 0, "Subcatchment runoff must be positive");

  // 2. Evaluate Preissmann Slot Section for Conduit C1 (D=1.5m, d=1.45m)
  const slotSection = computePreissmannSection(1.5, 1.45, 150.0);
  assert.ok(slotSection.area > 0, "Wetted cross-section area must be positive");
  assert.ok(slotSection.topWidth > 0, "Top width must be positive");
  const celerity = Math.sqrt(9.80665 * (slotSection.area / slotSection.topWidth));

  // 3. Solve 1D Dynamic Wave Hydraulics across network
  const hyd = solveSwmmHydraulics(project, { durationSeconds: 900.0, timeStepSeconds: 15.0 });
  assert.ok(hyd.totalInflow > 0, "Total system inflow must be positive");
  assert.ok(hyd.totalOutflow > 0, "Outfall discharge must be positive");
  assert.ok(hyd.totalInflow >= hyd.totalOutflow, "Total conduit flow volume must exceed outfall discharge");

  // Verify internal conduit flow forwarding
  const flowC1 = hyd.conduits.get("C1")?.flowRate ?? 0;
  const flowC4 = hyd.conduits.get("C4")?.flowRate ?? 0;
  assert.ok(flowC1 > 0, "Conduit C1 must carry forward flow");
  assert.ok(flowC4 >= flowC1 * 0.5, "Outfall conduit C4 must receive upstream discharge");

  // 4. Lower to DAEBuilder arena
  const dae = lowerSwmmToDae(project);
  assert.ok(dae.getVarCount() > 0, "DAE arena must declare state variables");
  assert.ok(dae.getEqCount() > 0, "DAE arena must declare hydraulic equations");

  const continuityErrorPct = hyd.totalInflow > 0 ? (Math.abs(hyd.totalInflow - hyd.totalOutflow) / hyd.totalInflow) * 100.0 : 0.0;

  return {
    nodesCount: project.junctions.size + project.outfalls.size,
    conduitsCount: project.conduits.size,
    subcatchmentsCount: project.subcatchments.size,
    totalInflowCms: hyd.totalInflow,
    outfallDischargeCms: hyd.totalOutflow,
    continuityErrorPct,
    preissmannCelerityMS: celerity,
    daeVarCount: dae.getVarCount(),
    daeEqCount: dae.getEqCount(),
  };
}
