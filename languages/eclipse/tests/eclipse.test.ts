// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  EclipseWorkspaceIndex,
  eclipseToModelica,
  lintEclipse,
  lowerEclipseToDae,
  parseEclipse,
  serializeEclipse,
  solveReservoirDepletion,
} from "../src/index.js";

const VALID_ECLIPSE_DECK = `-- ====================================================================
-- 3D 3-Phase Black-Oil Reservoir Model (ECLIPSE 100 Deck)
-- ====================================================================
RUNSPEC
TITLE
  North Sea Brent Sandstone Oil Field Simulation
/

DIMENS
  10 10 3 /

FIELD

OIL
WATER
GAS
DISGAS

START
  1 'JAN' 2025 /

GRID
DX
  300*150.0 /
DY
  300*150.0 /
DZ
  300*25.0 /
TOPS
  100*8000.0 /
PORO
  300*0.22 /
PERMX
  300*150.0 /
PERMY
  300*150.0 /
PERMZ
  300*30.0 /

PROPS
DENSITY
  52.0 64.0 0.065 /

PVTW
  4000.0 1.025 3.0e-6 0.35 0.0 /

PVDO
  1000.0 1.15 1.45
  2000.0 1.20 1.25
  3000.0 1.25 1.10
  4000.0 1.30 0.95
  5000.0 1.28 1.05 /

SWOF
  0.20 0.00 0.85 5.0
  0.30 0.05 0.65 3.2
  0.50 0.22 0.30 1.0
  0.70 0.55 0.08 0.2
  0.85 0.80 0.00 0.0 /

SOLUTION
EQUIL
  8000.0 4200.0 8500.0 0.0 7500.0 0.0 1 0 0 /

PRESSURE
  300*4000.0 /

SWAT
  300*0.22 /

SCHEDULE
WELSPECS
  'PROD1' 'G1' 2 3 8200.0 'OIL' /
  'INJ1'  'G1' 8 8 8200.0 'WATER' /
/

COMPDAT
  'PROD1' 2 3 1 3 'OPEN' 1* 15.5 0.5 /
  'INJ1'  8 8 1 3 'OPEN' 1* 20.0 0.5 /
/

WCONPROD
  'PROD1' 'OPEN' 'ORAT' 2500.0 1* 1* 1* 2000.0 /
/

WCONINJE
  'INJ1' 'WATER' 'OPEN' 'RATE' 3000.0 4500.0 /
/

TSTEP
  30.0 60.0 90.0 185.0 /

END
`;

test("ECLIPSE Parser: parses 3D multiphase black-oil deck into structured AST", () => {
  const deck = parseEclipse(VALID_ECLIPSE_DECK, "brent.data");

  assert.equal(deck.title, "North Sea Brent Sandstone Oil Field Simulation");
  assert.equal(deck.units, "FIELD");
  assert.equal(deck.dimensions.nx, 10);
  assert.equal(deck.dimensions.ny, 10);
  assert.equal(deck.dimensions.nz, 3);
  assert.equal(deck.phases.oil, true);
  assert.equal(deck.phases.water, true);
  assert.equal(deck.phases.gas, true);

  assert.equal(deck.grid.dx, 150.0);
  assert.equal(deck.grid.poro, 0.22);
  assert.equal(deck.grid.permX, 150.0);
  assert.equal(deck.grid.permZ, 30.0);

  assert.equal(deck.props.pvdo.length, 5);
  assert.equal(deck.props.swof.length, 5);
  assert.equal(deck.props.density.oil, 52.0);

  assert.equal(deck.solution.initialPressure, 4000.0);
  assert.equal(deck.solution.initialSwat, 0.22);

  assert.equal(deck.wells.size, 2);
  const prod = deck.wells.get("PROD1");
  assert.ok(prod);
  assert.equal(prod.preferredPhase, "OIL");
  assert.equal(prod.completions.length, 1);
  assert.equal(prod.completions[0]?.wellIndex, 15.5);
  assert.equal(prod.productionControl?.oilRate, 2500.0);
  assert.equal(prod.productionControl?.bhpLimit, 2000.0);

  const inj = deck.wells.get("INJ1");
  assert.ok(inj);
  assert.equal(inj.preferredPhase, "WATER");
  assert.equal(inj.injectionControl?.fluidType, "WATER");
  assert.equal(inj.injectionControl?.rate, 3000.0);
});

test("ECLIPSE Serializer: roundtrips deck into standard ECLIPSE format", () => {
  const deck = parseEclipse(VALID_ECLIPSE_DECK);
  const text = serializeEclipse(deck);

  assert.ok(text.includes("RUNSPEC"));
  assert.ok(text.includes("DIMENS"));
  assert.ok(text.includes("10 10 3 /"));
  assert.ok(text.includes("GRID"));
  assert.ok(text.includes("PROPS"));
  assert.ok(text.includes("SCHEDULE"));
  assert.ok(text.includes("'PROD1'"));
  assert.ok(text.includes("COMPDAT"));
  assert.ok(text.includes("END"));

  const reloaded = parseEclipse(text);
  assert.equal(reloaded.dimensions.nx, deck.dimensions.nx);
  assert.equal(reloaded.grid.poro, deck.grid.poro);
  assert.equal(reloaded.wells.size, deck.wells.size);
});

test("ECLIPSE Linter: valid deck produces zero errors", () => {
  const deck = parseEclipse(VALID_ECLIPSE_DECK);
  const diags = lintEclipse(deck);

  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

test("ECLIPSE Linter: detects out-of-bounds grid dimensions and negative porosity", () => {
  const flawedDeck = `RUNSPEC
DIMENS
  0 10 3 /
GRID
PORO
  100*-0.1 /
PERMX
  100*-50.0 /
SCHEDULE
END`;

  const deck = parseEclipse(flawedDeck);
  const diags = lintEclipse(deck);

  const m8702 = diags.find((d) => d.code === 8702);
  assert.ok(m8702, "Expected M8702 invalid dimensions");

  const m8703 = diags.find((d) => d.code === 8703);
  assert.ok(m8703, "Expected M8703 porosity out of range");

  const m8704 = diags.find((d) => d.code === 8704);
  assert.ok(m8704, "Expected M8704 negative permeability");
});

test("ECLIPSE Linter: detects non-monotonic PVT table entries", () => {
  const nonMonoDeck = `RUNSPEC
DIMENS
  10 10 3 /
PROPS
PVDO
  1000.0 1.15 1.45
  500.0  1.20 1.25 /
SCHEDULE
END`;

  const deck = parseEclipse(nonMonoDeck);
  const diags = lintEclipse(deck);

  const m8705 = diags.find((d) => d.code === 8705);
  assert.ok(m8705, "Expected M8705 non-monotonic PVT table pressures");
});

test("ECLIPSE Linter: detects out-of-bounds well completion coordinates", () => {
  const badWellDeck = `RUNSPEC
DIMENS
  5 5 2 /
SCHEDULE
WELSPECS
  'W1' 'G1' 20 20 8000.0 'OIL' /
/
COMPDAT
  'W1' 20 20 1 5 'OPEN' 1* 10.0 0.5 /
/
END`;

  const deck = parseEclipse(badWellDeck);
  const diags = lintEclipse(deck);

  const m8706 = diags.find((d) => d.code === 8706);
  assert.ok(m8706, "Expected M8706 well completion out of grid bounds");
});

test("ECLIPSE Solver: computes STOIIP, GIIP, and reservoir depletion trajectory", () => {
  const deck = parseEclipse(VALID_ECLIPSE_DECK);
  const res = solveReservoirDepletion(deck, { totalDays: 365.0, stepDays: 30.0 });

  assert.ok(res.poreVolume > 1e6, `Expected large pore volume, got ${res.poreVolume}`);
  assert.ok(res.stoiip > 1e6, `Expected large STOIIP, got ${res.stoiip}`);
  assert.ok(res.stepsCount >= 10);
  assert.ok(res.finalPressure < res.initialPressure, "Average pressure should deplete with production");
  assert.ok(res.cumulativeOilProduced > 0);
  assert.ok(res.recoveryFactor > 0 && res.recoveryFactor < 1.0);

  const lastStep = res.trajectory[res.trajectory.length - 1]!;
  assert.ok(lastStep.cumulativeOil > 0);
  assert.equal(lastStep.wells.length, 2);
  const prodWell = lastStep.wells.find((w) => w.wellName === "PROD1");
  assert.ok(prodWell);
  assert.ok(prodWell.oilRate > 0);
});

test("ECLIPSE DAE Lowering: compiles reservoir material balance and well equations into DAEBuilder", () => {
  const deck = parseEclipse(VALID_ECLIPSE_DECK);
  const dae = lowerEclipseToDae(deck);

  assert.ok(dae.variables().length >= 10, "Expected at least 10 variables");
  assert.ok(dae.equations().length >= 10, "Expected at least 10 equations");

  assert.notEqual(dae.lookupVariable("P_avg"), -1);
  assert.notEqual(dae.lookupVariable("S_w"), -1);
  assert.notEqual(dae.lookupVariable("Np"), -1);
  assert.notEqual(dae.lookupVariable("Q_oil_total"), -1);
  assert.notEqual(dae.lookupVariable("q_oil_PROD1"), -1);
  assert.notEqual(dae.lookupVariable("bhp_PROD1"), -1);
});

test("ECLIPSE Modelica Projection: generates syntactically valid Modelica 3.x reservoir model", () => {
  const deck = parseEclipse(VALID_ECLIPSE_DECK);
  const mo = eclipseToModelica(deck, "BrentReservoirModel");

  assert.ok(mo.includes("model BrentReservoirModel"));
  assert.ok(mo.includes("parameter Integer nx = 10;"));
  assert.ok(mo.includes("Real P_avg(start = 4000.00)"));
  assert.ok(mo.includes("Real q_oil_PROD1(start = 0.0)"));
  assert.ok(mo.includes("q_oil_PROD1 = WI_PROD1 * (P_avg - bhp_PROD1);"));
  assert.ok(mo.includes("der(Np) = Q_oil_total;"));
  assert.ok(mo.includes("der(P_avg) = -(Q_oil_total * Bo) / (V_pore * ct);"));
  assert.ok(mo.includes("end BrentReservoirModel;"));
});

test("ECLIPSE Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new EclipseWorkspaceIndex();
  index.indexFile("file:///reservoir/brent.data", VALID_ECLIPSE_DECK);

  assert.equal(index.fileCount, 1);
  const symbols = index.getSymbols("file:///reservoir/brent.data");
  assert.ok(symbols.length >= 4);

  const gridSym = index.findDefinition("ReservoirGrid");
  assert.ok(gridSym);

  const pvtSym = index.findDefinition("PVT_Props");
  assert.ok(pvtSym);

  const prodSym = index.findDefinition("PROD1");
  assert.ok(prodSym);
  assert.equal(prodSym.name, "PROD1");

  const injSym = index.findDefinition("INJ1");
  assert.ok(injSym);
  assert.equal(injSym.name, "INJ1");
});
