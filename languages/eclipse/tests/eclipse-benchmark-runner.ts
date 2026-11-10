// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Eclipse Subsurface Reservoir Simulation Industrial Benchmark Runner:
 * SPE 10 / North Sea Brent Multiphase Black-Oil Reservoir with Peaceman Wellbore Inflow,
 * 3D TPFA Solvers & Direct Linear Memory DAE Arena Lowering.
 */

import { lowerEclipseToDae } from "../src/dae/eclipse-to-dae.js";
import { lintEclipse } from "../src/lints/index.js";
import { parseEclipse } from "../src/parser/eclipse-parser.js";
import { solveReservoirDepletion, type ReservoirSimulationResult } from "../src/solvers/reservoir-solver.js";

export interface EclipseBenchmarkResult {
  name: string;
  gridDimensions: [number, number, number];
  numActiveCells: number;
  poreVolumeM3: number;
  stoiipM3: number;
  initialPressurePsi: number;
  finalPressurePsi: number;
  cumulativeOilProducedM3: number;
  recoveryFactor: number;
  daeVariableCount: number;
  daeEquationCount: number;
  lintDiagnosticsCount: number;
  parsingTimeMs: number;
  simulationTimeMs: number;
  daeLoweringTimeMs: number;
  totalTimeMs: number;
}

export const SPE10_BRENT_BENCHMARK_DECK = `-- ====================================================================
-- SPE 10 / North Sea Brent Sandstone Multiphase Black-Oil Benchmark
-- ====================================================================
RUNSPEC
TITLE
  SPE10 / North Sea Multiphase Black-Oil Production Benchmark
/

DIMENS
  12 12 4 /

FIELD

OIL
WATER
GAS
DISGAS

START
  1 'JAN' 2026 /

GRID
DX
  576*100.0 /
DY
  576*100.0 /
DZ
  576*20.0 /
TOPS
  144*7500.0 /
PORO
  576*0.24 /
PERMX
  576*250.0 /
PERMY
  576*250.0 /
PERMZ
  576*50.0 /

PROPS
DENSITY
  51.5 63.8 0.062 /

PVTW
  3800.0 1.022 3.2e-6 0.38 0.0 /

ROCK
  3800.0 4.0e-6 /

PVTO
  500.0  1.120 1.85 /
  1500.0 1.180 1.45 /
  2500.0 1.240 1.15 /
  3800.0 1.310 0.95 /
  5000.0 1.285 1.02 /
/

PVDG
  500.0  0.0350 0.0135 /
  1500.0 0.0105 0.0165 /
  2500.0 0.0058 0.0205 /
  3800.0 0.0036 0.0255 /
/

SWOF
  0.20 0.00 1.00 0.0 /
  0.30 0.05 0.70 0.0 /
  0.40 0.15 0.45 0.0 /
  0.60 0.40 0.15 0.0 /
  0.80 0.75 0.02 0.0 /
  0.90 1.00 0.00 0.0 /
/

SOLUTION
PRESSURE
  576*3800.0 /
SWAT
  576*0.22 /
SOIL
  576*0.78 /

SCHEDULE
RPTSCHED
  'PRES' 'SOIL' 'SWAT' /

WELSPECS
  'PROD_A' 'G1' 3 3 7500.0 'OIL' /
  'PROD_B' 'G1' 10 10 7500.0 'OIL' /
  'INJ_1'  'G1' 1 1 7500.0 'WATER' /
  'INJ_2'  'G1' 12 12 7500.0 'WATER' /
/

COMPDAT
  'PROD_A' 3 3 1 4 'OPEN' 2* 0.25 /
  'PROD_B' 10 10 1 4 'OPEN' 2* 0.25 /
  'INJ_1'  1 1 1 4 'OPEN' 2* 0.25 /
  'INJ_2'  12 12 1 4 'OPEN' 2* 0.25 /
/

WCONPROD
  'PROD_A' 'OPEN' 'BHP' 5* 2500.0 /
  'PROD_B' 'OPEN' 'BHP' 5* 2500.0 /
/

WCONINJE
  'INJ_1' 'WATER' 'OPEN' 'RATE' 1500.0 1* 4500.0 /
  'INJ_2' 'WATER' 'OPEN' 'RATE' 1500.0 1* 4500.0 /
/

TSTEP
  30 30 30 60 60 90 90 /

END
`;

export function runEclipseBenchmark(): EclipseBenchmarkResult {
  const t0 = performance.now();

  // 1. Deck Parsing
  const tParse0 = performance.now();
  const deck = parseEclipse(SPE10_BRENT_BENCHMARK_DECK);
  const parsingTimeMs = performance.now() - tParse0;

  // 2. Syntax & Reservoir Physics Linter
  const lints = lintEclipse(deck);

  // 3. Reservoir Depletion Solver (365 days)
  const tSim0 = performance.now();
  const simRes: ReservoirSimulationResult = solveReservoirDepletion(deck, {
    totalDays: 365.0,
    stepDays: 30.0,
  });
  const simulationTimeMs = performance.now() - tSim0;

  // 4. DAE Arena Lowering
  const tDae0 = performance.now();
  const dae = lowerEclipseToDae(deck);
  const daeLoweringTimeMs = performance.now() - tDae0;

  const totalTimeMs = performance.now() - t0;

  const dims = deck.dimensions ?? { nx: 12, ny: 12, nz: 4 };

  return {
    name: "SPE10 / North Sea Brent Multiphase Black-Oil Reservoir Benchmark",
    gridDimensions: [dims.nx, dims.ny, dims.nz],
    numActiveCells: dims.nx * dims.ny * dims.nz,
    poreVolumeM3: simRes.poreVolume,
    stoiipM3: simRes.stoiip,
    initialPressurePsi: simRes.initialPressure,
    finalPressurePsi: simRes.finalPressure,
    cumulativeOilProducedM3: simRes.cumulativeOilProduced,
    recoveryFactor: simRes.recoveryFactor,
    daeVariableCount: dae.variables().length,
    daeEquationCount: dae.equations().length,
    lintDiagnosticsCount: lints.length,
    parsingTimeMs,
    simulationTimeMs,
    daeLoweringTimeMs,
    totalTimeMs,
  };
}
