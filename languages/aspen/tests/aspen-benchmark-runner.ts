// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Aspen Plus Chemical Flowsheet Industrial Benchmark Runner:
 * De-Ethanizer / Multi-Stage Hydrocarbon Fractionation Train & Non-Ideal VLE Flash
 * with DAE Arena Lowering and Mass-Energy Balance Parity.
 */

import { parseAspen } from "../src/parser/aspen-parser.js";
import { solveFlashRachfordRice, type FlashSolverResult } from "../src/solvers/flash-solver.js";
import { lowerAspenToDae } from "../src/dae/aspen-to-dae.js";
import { lintAspen } from "../src/lints/index.js";

export interface AspenBenchmarkResult {
  name: string;
  propertyMethod: string;
  numComponents: number;
  numBlocks: number;
  numStreams: number;
  flashVaporFraction: number;
  flashLiquidFlow: number;
  flashVaporFlow: number;
  daeVariableCount: number;
  daeEquationCount: number;
  isSquare: boolean;
  lintDiagnosticsCount: number;
  parsingTimeMs: number;
  flashTimeMs: number;
  daeLoweringTimeMs: number;
  totalTimeMs: number;
}

export const DE_ETHANIZER_BENCHMARK_DECK = `TITLE 'INDUSTRIAL DE-ETHANIZER AND HYDROCARBON FRACTIONATION TRAIN'
IN-UNITS MET
DEF-STREAMS CONV ALL

COMPONENTS
    ETHANE    C2H6
    PROPANE   C3H8
    N-BUTANE  C4H10
    N-PENTANE C5H12

PROPERTIES PENG-ROB

FLOWSHEET
    BLOCK PREFLASH IN=FEED OUT=FLASHVAP FLASHLIQ
    BLOCK PUMP1    IN=FLASHLIQ OUT=COLFEED
    BLOCK COL1     IN=COLFEED FLASHVAP OUT=ETHANEOVHD BUTANEBOTTOMS
    BLOCK HEATER1  IN=COLFEED OUT=HEATEDFEED
    BLOCK MIXER1   IN=ETHANEOVHD HEATEDFEED OUT=COMBINEDPROD

STREAM FEED
    SUBSTREAM MIXED TEMP=45.0 PRES=25.0 MOLE-FLOW=1000.0
    MOLE-FRAC ETHANE 0.25 / PROPANE 0.40 / N-BUTANE 0.25 / N-PENTANE 0.10

BLOCK PREFLASH FLASH2
    PARAM TEMP=55.0 PRES=22.0

BLOCK PUMP1 PUMP
    PARAM PRES=28.0

BLOCK HEATER1 HEATER
    PARAM TEMP=65.0 PRES=28.0

BLOCK COL1 RADFRAC
    PARAM NSTAGE=30
    FEED COLFEED 15 / FLASHVAP 14
    PRODUCTS ETHANEOVHD 1 V / BUTANEBOTTOMS 30 L
    COL-SPECS RR=3.5 D:F=0.35

BLOCK MIXER1 MIXER
`;

export function runAspenBenchmark(): AspenBenchmarkResult {
  const t0 = performance.now();

  // 1. Deck Parsing
  const tParse0 = performance.now();
  const deck = parseAspen(DE_ETHANIZER_BENCHMARK_DECK);
  const parsingTimeMs = performance.now() - tParse0;

  // 2. Multi-Component Flash Solver (Feed pre-flash at 55 deg C, 22 bar)
  const tFlash0 = performance.now();
  const flashResult: FlashSolverResult = solveFlashRachfordRice({
    temperature: 55.0,
    pressure: 2.2, // ~22 bar normalized
    components: ["ETHANE", "PROPANE", "N-BUTANE", "N-PENTANE"],
    moleFractions: [0.25, 0.40, 0.25, 0.10],
    totalFlow: 1000.0,
    propertyMethod: "PENG-ROB",
  });
  const flashTimeMs = performance.now() - tFlash0;

  // 3. Flowsheet Diagnostics Linter
  const lints = lintAspen(deck);

  // 4. Direct DAE Arena Lowering
  const tDae0 = performance.now();
  const dae = lowerAspenToDae(deck);
  const daeLoweringTimeMs = performance.now() - tDae0;

  const totalTimeMs = performance.now() - t0;
  const numVars = dae.variables().length;
  const numEqs = dae.equations().length;

  return {
    name: "Industrial De-Ethanizer & Hydrocarbon Fractionation Train",
    propertyMethod: deck.propertyMethod,
    numComponents: deck.components.size,
    numBlocks: deck.blocks.size,
    numStreams: deck.streams.size,
    flashVaporFraction: flashResult.vaporFraction,
    flashLiquidFlow: flashResult.liquidFlow,
    flashVaporFlow: flashResult.vaporFlow,
    daeVariableCount: numVars,
    daeEquationCount: numEqs,
    isSquare: numVars === numEqs,
    lintDiagnosticsCount: lints.length,
    parsingTimeMs,
    flashTimeMs,
    daeLoweringTimeMs,
    totalTimeMs,
  };
}
