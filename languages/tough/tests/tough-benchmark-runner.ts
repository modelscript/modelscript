// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for TOUGH2 / TOUGH3 Multiphase Subsurface Heat & Fluid Flow.
 *
 * Evaluates:
 * 1. 5-block non-isothermal geothermal reservoir with production and injection wells
 * 2. Inter-block Darcy fluid flux and conductive heat exchange
 * 3. Geothermal well thermal power output and steam quality estimation
 * 4. Structurally square DAEBuilder linear memory arena lowering
 */

import assert from "node:assert/strict";
import {
  lowerToughToDae,
  parseTough,
  solveGeothermalWells,
  type ToughDeck,
} from "../src/index.js";

export const TOUGH_GEOTHERMAL_RESERVOIR_BENCHMARK = `
TOUGH2 EOS1 Geothermal Reservoir Benchmark
ROCKS
GRAN1  2650.0  0.12  1.5e-14  1.5e-14  1.0e-14  2.8  1050.0
BASA1  2800.0  0.08  5.0e-15  5.0e-15  2.0e-15  2.1   950.0

ELEME
EL101  GRAN1  1000.0
EL102  GRAN1  1000.0
EL103  GRAN1  1000.0
EL104  BASA1  1200.0
EL105  BASA1  1200.0

CONNE
EL101  EL102  50.0  50.0  100.0  0.0
EL102  EL103  50.0  50.0  100.0  0.0
EL103  EL104  50.0  60.0  120.0  0.0
EL104  EL105  60.0  60.0  120.0  0.0

GENER
EL101  INJ01  MASS   15.0   500000.0
EL105  PROD1  MASS  -25.0  1450000.0

INCON
EL101  1.2e7  220.0
EL102  1.1e7  230.0
EL103  1.0e7  245.0
EL104  0.9e7  255.0
EL105  0.8e7  265.0
`;

export interface ToughBenchmarkMetrics {
  rocksCount: number;
  elementsCount: number;
  connectionsCount: number;
  generatorsCount: number;
  incondsCount: number;
  wellsCount: number;
  totalThermalPowerMW: number;
  prodSteamFraction: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runToughBenchmark(
  deckContent = TOUGH_GEOTHERMAL_RESERVOIR_BENCHMARK,
): ToughBenchmarkMetrics {
  const deck: ToughDeck = parseTough(deckContent);

  assert.equal(deck.rocks.length, 2);
  assert.equal(deck.elements.length, 5);
  assert.equal(deck.connections.length, 4);
  assert.equal(deck.generators.length, 2);
  assert.equal(deck.inconds.length, 5);

  // 1. Solve geothermal wells
  const wells = solveGeothermalWells(deck);
  assert.equal(wells.length, 2);

  const prodWell = wells.find((w) => w.wellName === "PROD1")!;
  assert.ok(prodWell);
  assert.ok(prodWell.thermalPowerMW > 0, "Production well thermal power must be > 0");
  assert.ok(prodWell.steamFraction >= 0, "Steam fraction must be >= 0");

  let totalPower = 0;
  for (const w of wells) {
    totalPower += w.thermalPowerMW;
  }

  // 2. Lower to DAEBuilder linear arena
  const dae = lowerToughToDae(deck);
  const vars = dae.variables();
  const eqs = dae.equations();

  // 5 elements * 2 + 2 generators + 4 connections = 16 variables & 16 equations
  assert.equal(vars.length, 16, `Expected 16 DAE variables, got ${vars.length}`);
  assert.equal(eqs.length, 16, `Expected 16 DAE equations, got ${eqs.length}`);
  assert.equal(vars.length, eqs.length, "DAE must be structurally square");

  return {
    rocksCount: deck.rocks.length,
    elementsCount: deck.elements.length,
    connectionsCount: deck.connections.length,
    generatorsCount: deck.generators.length,
    incondsCount: deck.inconds.length,
    wellsCount: wells.length,
    totalThermalPowerMW: totalPower,
    prodSteamFraction: prodWell.steamFraction,
    daeVarCount: vars.length,
    daeEqCount: eqs.length,
    isSquare: vars.length === eqs.length,
  };
}
