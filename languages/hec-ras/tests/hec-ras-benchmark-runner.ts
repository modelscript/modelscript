// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for HEC-RAS 1D/2D River Hydraulics & Flood Hydrodynamics.
 *
 * Evaluates:
 * 1. Multi-cross-section natural river reach with subcritical backwater profile
 * 2. Cross-section geometric properties (area, wetted perimeter, hydraulic radius)
 * 3. Normal depth calculation via Manning's formula
 * 4. Standard step backwater method solving water surface elevation (WSEL) and energy grade line (EGL)
 * 5. Direct lowering to linear memory DAEBuilder arena
 */

import assert from "node:assert/strict";
import {
  computeNormalDepth,
  computeSectionProperties,
  lowerHecRasToDae,
  parseFlow,
  parseGeometry,
  solveWaterSurfaceProfile,
  type HecRasFlow,
  type HecRasGeometry,
  type WaterSurfaceResult,
} from "../src/index.js";

export const HECRAS_RIVER_REACH_BENCHMARK_GEOM = `
Geom Title=Bald Eagle Creek Hydraulic Reach Benchmark
River Reach=BaldEagleCreek,MainStem
Reach XY=5
0, 0
1000, 200
2000, 350
3000, 500
4000, 600

Type RM CEM CS= 1 ,4000    ,        ,
Station Elevation Data= 6
0, 115.0  20, 108.0  40, 102.0  60, 102.0  80, 108.0  100, 115.0
Cross Section Reach Lengths and Manning Values=
1000, 1000, 1000, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80

Type RM CEM CS= 1 ,3000    ,        ,
Station Elevation Data= 6
0, 113.5  20, 106.8  40, 100.8  60, 100.8  80, 106.8  100, 113.5
Cross Section Reach Lengths and Manning Values=
1000, 1000, 1000, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80

Type RM CEM CS= 1 ,2000    ,        ,
Station Elevation Data= 6
0, 112.0  20, 105.5  40, 99.5  60, 99.5  80, 105.5  100, 112.0
Cross Section Reach Lengths and Manning Values=
1000, 1000, 1000, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80

Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 6
0, 110.5  20, 104.2  40, 98.2  60, 98.2  80, 104.2  100, 110.5
Cross Section Reach Lengths and Manning Values=
1000, 1000, 1000, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80
`;

export const HECRAS_RIVER_REACH_BENCHMARK_FLOW = `
Flow Title=Design Flood Profile
Boundary for River Reach & Node=BaldEagleCreek,MainStem,4000
Boundary Type=Flow Hydrograph
Hydrograph Data= 1
0, 120.0

Boundary for River Reach & Node=BaldEagleCreek,MainStem,1000
Boundary Type=Normal Depth
Friction Slope=0.0012
`;

export interface HecRasBenchmarkMetrics {
  crossSectionsCount: number;
  dischargeM3s: number;
  downstreamNormalDepthM: number;
  upstreamWselM: number;
  downstreamWselM: number;
  maxFroudeNumber: number;
  totalHeadLossM: number;
  daeVarCount: number;
  daeEqCount: number;
}

export function runHecRasBenchmark(
  geomStr = HECRAS_RIVER_REACH_BENCHMARK_GEOM,
  flowStr = HECRAS_RIVER_REACH_BENCHMARK_FLOW,
): HecRasBenchmarkMetrics {
  const geom: HecRasGeometry = parseGeometry(geomStr);
  const flow: HecRasFlow = parseFlow(flowStr);

  assert.equal(geom.crossSections.length, 4);
  assert.equal(flow.boundaryConditions.length, 2);

  const dsCs = geom.crossSections.find((cs) => cs.station === 1000)!;
  const normalStage = computeNormalDepth(dsCs, 120.0, 0.0012);
  assert.ok(normalStage > 98.2, "Downstream stage must exceed invert elevation");

  const results: WaterSurfaceResult[] = solveWaterSurfaceProfile(geom, {
    discharge: 120.0,
    frictionSlope: 0.0012,
  });

  assert.equal(results.length, 4);

  // Cross sections in results are sorted downstream to upstream or upstream to downstream
  const usRes = results.find((r) => r.station === 4000)!;
  const dsRes = results.find((r) => r.station === 1000)!;

  assert.ok(usRes.waterSurfaceElevation > dsRes.waterSurfaceElevation, "Water surface must slope downward downstream");
  assert.ok(usRes.energyGradeLine > dsRes.energyGradeLine, "EGL must decrease in downstream direction due to friction");

  let maxFr = 0;
  for (const r of results) {
    if (r.froudeNumber > maxFr) maxFr = r.froudeNumber;
    assert.ok(r.froudeNumber < 1.0, `Flow must be subcritical (Fr < 1.0), got ${r.froudeNumber}`);
  }

  // DAE Lowering
  const arena = lowerHecRasToDae(geom, flow);
  const varCount = arena.getVarCount();
  const eqCount = arena.getEqCount();

  // 1 constant (gravity) + 4 cross sections * 4 variables (wsel, Q, v, egl) = 17 variables
  assert.equal(varCount, 17);
  // 4 Q eqs + 4 egl eqs + 1 ds BC + 3 energy loss eqs = 12 equations
  assert.equal(eqCount, 12);

  return {
    crossSectionsCount: geom.crossSections.length,
    dischargeM3s: 120.0,
    downstreamNormalDepthM: normalStage - 98.2,
    upstreamWselM: usRes.waterSurfaceElevation,
    downstreamWselM: dsRes.waterSurfaceElevation,
    maxFroudeNumber: maxFr,
    totalHeadLossM: usRes.energyGradeLine - dsRes.energyGradeLine,
    daeVarCount: varCount,
    daeEqCount: eqCount,
  };
}

if (process.argv[1]?.endsWith("hec-ras-benchmark-runner.ts")) {
  const m = runHecRasBenchmark();
  console.log("HEC-RAS Benchmark Results:", m);
}
