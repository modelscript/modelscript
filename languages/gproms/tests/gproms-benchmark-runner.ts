// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Advanced Process Modeling & Distributed DAEs (gPROMS).
 *
 * Evaluates:
 * 1. Distributed parameter system (AxialDispersionPFR, 1D tubular reactor PDE-DAE)
 * 2. Spatial discretization via Method-of-Lines (MOL, 11 axial grid nodes)
 * 3. Coupled convection, axial dispersion, and first-order chemical consumption
 * 4. High-order differential-algebraic equation system lowering into square DAEBuilder arena
 */

import assert from "node:assert/strict";
import {
  parseGproms,
  solveGpromsProcess,
  lowerGpromsToDae,
  type GpromsDocument,
  type ProcessSimulationResult,
} from "../src/index.js";

export const AXIAL_DISPERSION_PFR_BENCHMARK = `
DECLARE
  TYPE
    Concentration = 1.0 : 0.0 : 100.0 UNIT = "mol/L"
  END
END

MODEL AxialDispersionPFR
  PARAMETER
    v    AS REAL DEFAULT 0.5
    D_ax AS REAL DEFAULT 0.01
    k    AS REAL DEFAULT 0.4
    C_in AS REAL DEFAULT 10.0

  DISTRIBUTION_DOMAIN
    Axial AS [ 0.0 : 1.0 ] N = 11

  VARIABLE
    C AS DISTRIBUTION(Axial) OF Concentration

  BOUNDARY
    C(0.0) = C_in ;

  EQUATION
    $C = -v * PARTIAL(C, Axial) + D_ax * PARTIAL(PARTIAL(C, Axial), Axial) - k * C ;
END

PROCESS PfrSimulation
  UNIT
    T101 AS AxialDispersionPFR
  SET
    T101.v := 0.5 ;
    T101.D_ax := 0.01 ;
    T101.k := 0.4 ;
    T101.C_in := 10.0 ;
  INITIAL
    T101.C := 0.0 ;
  SOLUTIONPARAMETERS
    ReportingInterval := 0.05 ;
    TotalTime := 8.0 ;
END
`;

export interface GpromsBenchmarkMetrics {
  modelName: string;
  processName: string;
  gridPoints: number;
  inletConcentration: number;
  outletConcentration: number;
  conversionPercent: number;
  isMonotonic: boolean;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runGpromsBenchmark(src = AXIAL_DISPERSION_PFR_BENCHMARK): GpromsBenchmarkMetrics {
  const doc: GpromsDocument = parseGproms(src);
  assert.equal(doc.models.size, 1);
  assert.equal(doc.processes.size, 1);

  const model = Array.from(doc.models.values())[0]!;
  const proc = Array.from(doc.processes.values())[0]!;

  const sim: ProcessSimulationResult = solveGpromsProcess(doc, { duration: 8.0, timeStep: 0.005 });
  const profile = sim.finalSpatialProfiles["C"];
  assert.ok(profile);
  assert.equal(profile.length, 11);

  // Inlet node C_0 pinned to C_in = 10.0
  assert.ok(Math.abs((profile[0] ?? 0) - 10.0) < 1e-6);

  // Verify monotonic decay
  let isMonotonic = true;
  for (let i = 1; i < profile.length; i++) {
    if ((profile[i] ?? 0) >= (profile[i - 1] ?? 0)) {
      isMonotonic = false;
      break;
    }
  }
  assert.equal(isMonotonic, true);

  const outletC = profile[profile.length - 1] ?? 0;
  assert.ok(outletC > 4.0 && outletC < 5.0);
  const conv = ((10.0 - outletC) / 10.0) * 100.0;

  // Lower into linear memory DAEBuilder arena
  const dae = lowerGpromsToDae(doc);
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 10);
  assert.equal(varCount, eqCount);

  return {
    modelName: model.name,
    processName: proc.name,
    gridPoints: profile.length,
    inletConcentration: profile[0] ?? 0,
    outletConcentration: outletC,
    conversionPercent: conv,
    isMonotonic,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("gproms-benchmark-runner.ts")) {
  const m = runGpromsBenchmark();
  console.log("gPROMS Benchmark Results:", m);
}
