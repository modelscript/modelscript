// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeEclipseAction, getEclipseDocumentSymbols, getEclipseHover, validateEclipse } from "../src/index.js";

const VALID_DECK = `RUNSPEC
TITLE
  Offshore Reservoir Study
/

DIMENS
  10 10 3 /

FIELD

OIL
WATER

START
  1 'JAN' 2025 /

GRID
DX
  300*100.0 /
DY
  300*100.0 /
DZ
  300*20.0 /
TOPS
  100*7500.0 /
PORO
  300*0.25 /
PERMX
  300*200.0 /
PERMY
  300*200.0 /
PERMZ
  300*50.0 /

PROPS
DENSITY
  50.0 62.4 0.05 /

PVDO
  1000.0 1.10 1.50
  2000.0 1.15 1.30
  3000.0 1.20 1.15 /

SWOF
  0.20 0.00 0.90 5.0
  0.50 0.20 0.35 1.5
  0.80 0.75 0.00 0.0 /

SOLUTION
PRESSURE
  300*3800.0 /

SCHEDULE
WELSPECS
  'PROD_A' 'G1' 2 2 7600.0 'OIL' /
/

COMPDAT
  'PROD_A' 2 2 1 3 'OPEN' 1* 12.0 0.5 /
/

WCONPROD
  'PROD_A' 'OPEN' 'ORAT' 2000.0 1* 1* 1* 1800.0 /
/

TSTEP
  30.0 60.0 /

END
`;

test("ECLIPSE LSP: validateEclipse returns 0 diagnostics on clean deck", () => {
  const diags = validateEclipse(VALID_DECK);
  assert.equal(diags.length, 0);
});

test("ECLIPSE LSP: validateEclipse returns diagnostics on flawed deck", () => {
  const flawed = `RUNSPEC
DIMENS
  0 10 3 /
GRID
PORO
  100*-0.2 /
SCHEDULE
END`;

  const diags = validateEclipse(flawed);
  assert.ok(diags.length >= 2);
  assert.ok(diags.some((d) => d.code === "M8702"));
  assert.ok(diags.some((d) => d.code === "M8703"));
});

test("ECLIPSE LSP: getEclipseDocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getEclipseDocumentSymbols(VALID_DECK);
  assert.equal(symbols.length, 1);
  const root = symbols[0]!;
  assert.equal(root.name, "Offshore Reservoir Study");
  assert.ok(root.children && root.children.length >= 2);
  assert.ok(root.children.some((c) => c.name === "PROD_A"));
  assert.ok(root.children.some((c) => c.name === "GRID"));
});

test("ECLIPSE LSP: getEclipseHover returns markdown hover info for well", () => {
  const prodLine = VALID_DECK.split("\n").findIndex((l) => l.includes("PROD_A"));
  assert.ok(prodLine >= 0, "PROD_A should exist in deck");
  const hover = getEclipseHover(VALID_DECK, { line: prodLine, character: 5 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("ECLIPSE Well: **PROD_A**"));
  assert.ok(hover.contents.value.includes("Completions"));
});

test("ECLIPSE LSP: executeEclipseAction executes solver and export actions", async () => {
  const solveRes = await executeEclipseAction("eclipse_reservoir_solve", VALID_DECK, {
    options: { totalDays: 60.0 },
  });
  assert.ok(solveRes.stoiip > 0);
  assert.ok(solveRes.cumulativeOilProduced > 0);

  const daeRes = await executeEclipseAction("eclipse_to_dae", VALID_DECK);
  assert.ok(daeRes.variableCount >= 10);
  assert.ok(daeRes.equationCount >= 10);

  const moRes = await executeEclipseAction("eclipse_to_modelica", VALID_DECK, {
    modelName: "OffshoreField",
  });
  assert.ok(moRes.includes("model OffshoreField"));
  assert.ok(moRes.includes("der(Np) = Q_oil_total;"));
});
