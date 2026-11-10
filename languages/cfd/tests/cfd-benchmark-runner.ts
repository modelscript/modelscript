// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Computational Fluid Dynamics (CFD).
 *
 * Evaluates:
 * 1. NASA Langley TMR NACA 0012 transonic airfoil configuration ($M = 0.799$, $\alpha = 1.25^\circ$)
 * 2. SU2 RANS / Spalart-Allmaras boundary condition and turbulence schema validation
 * 3. Aerodynamic force coefficient estimation ($C_L, C_D$) and thin-airfoil theory
 * 4. 1D FVM streamtube fluid dynamics lowering into structurally square DAEBuilder linear arena
 */

import assert from "node:assert/strict";
import {
  cfdToDae,
  getCfdDialect,
  type CfdModelData,
} from "../src/index.js";

export const NACA0012_TRANSONIC_BENCHMARK_CONFIG = `
% NASA Langley TMR NACA 0012 Transonic Airfoil Benchmark
SOLVER= RANS
KIND_TURB_MODEL= SPALART_ALLMARAS
MATH_PROBLEM= NAVIER_STOKES
MACH_NUMBER= 0.799
AOA= 1.25
FREESTREAM_TEMPERATURE= 288.15
FREESTREAM_DENSITY= 1.184
FREESTREAM_PRESSURE= 101325.0
REYNOLDS_NUMBER= 9000000.0
REF_AREA= 1.0
REF_LENGTH= 1.0
REF_ORIGIN_MOMENT_X= 0.25
NUM_METHOD_GRAD= GREEN_GAUSS
CONV_NUM_METHOD_FLOW= ROE
MARKER_HEATFLUX= ( airfoil, 0.0 )
MARKER_FAR= ( farfield )
`;

export interface CfdBenchmarkMetrics {
  dialect: string;
  mathProblem: string;
  machNumber: number;
  aoaDeg: number;
  reynoldsNumber: number;
  clEstimated: number;
  cdEstimated: number;
  liftNewtons: number;
  dragNewtons: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runCfdBenchmark(
  configStr = NACA0012_TRANSONIC_BENCHMARK_CONFIG,
): CfdBenchmarkMetrics {
  const dialect = getCfdDialect("su2");
  const model: CfdModelData = dialect.parse(configStr);

  assert.equal(model.dialect, "su2");
  assert.equal(model.mathProblem, "NAVIER_STOKES");
  assert.equal(model.machNumber, 0.799);
  assert.equal(model.aoa, 1.25);
  assert.equal(model.reynoldsNumber, 9000000.0);
  assert.ok(model.wallMarkers.includes("airfoil"));

  // 1D FVM Streamtube DAE Lowering
  const dae = cfdToDae(model, { numCells: 5 });
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // 4 global aero vars (CL, CD, Lift, Drag) + 5 cells * 3 (rho, u, p) = 19 vars
  // 4 aero eqs + 5 cells * 3 (mass, momentum, state) = 19 eqs
  assert.equal(varCount, 19, `Expected 19 DAE variables, got ${varCount}`);
  assert.equal(eqCount, 19, `Expected 19 DAE equations, got ${eqCount}`);
  assert.equal(varCount, eqCount, "CFD DAE must be structurally square");

  // Verify variable lookup
  const clVar = dae.lookupVariable("C_L");
  const cdVar = dae.lookupVariable("C_D");
  const liftVar = dae.lookupVariable("Lift");
  const dragVar = dae.lookupVariable("Drag");

  assert.ok(clVar !== -1);
  assert.ok(cdVar !== -1);
  assert.ok(liftVar !== -1);
  assert.ok(dragVar !== -1);

  // Theoretical values: CL = 2*pi * alpha_rad, CD = CD0 + 0.05 * CL^2
  const aoaRad = (1.25 * Math.PI) / 180.0;
  const clTheory = 2 * Math.PI * aoaRad;
  const cdTheory = 0.02 + 0.05 * clTheory * clTheory;
  const uInf = 0.799 * 340.29;
  const qInf = 0.5 * 1.184 * uInf * uInf;

  return {
    dialect: model.dialect,
    mathProblem: model.mathProblem,
    machNumber: model.machNumber,
    aoaDeg: model.aoa,
    reynoldsNumber: model.reynoldsNumber,
    clEstimated: clTheory,
    cdEstimated: cdTheory,
    liftNewtons: qInf * clTheory,
    dragNewtons: qInf * cdTheory,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("cfd-benchmark-runner.ts")) {
  const m = runCfdBenchmark();
  console.log("CFD Benchmark Results:", m);
}
