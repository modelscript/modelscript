// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeRelap5Action, getRelap5DocumentSymbols, getRelap5Hover, validateRelap5 } from "../src/index.js";

const VALID_DECK = `100 PWR Primary Circuit
101 new transnt
201 10.0 1.0e-5 0.01
1000000 Core pipe
1000101 4.5 3.8 17.1
1000501 1.55e7 580.0
1100000 Plenum branch
1100101 8.0 2.5 20.0
1100501 1.54e7 595.0
1050000 CoreToPlenum snglj
1050101 100 110 4.5
1050102 0.1 0.2
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
. end`;

test("RELAP5 LSP: validateRelap5 returns 0 diagnostics on clean deck", () => {
  const diags = validateRelap5(VALID_DECK);
  assert.equal(diags.length, 0);
});

test("RELAP5 LSP: validateRelap5 returns diagnostics on flawed deck", () => {
  const flawed = `100 Flawed Deck
101 new transnt
1000000 Core pipe
1000101 1.0 1.0 1.0
1000501 1.55e7 580.0
1050000 BadJunc snglj
1050101 100 999 1.0
1050102 -0.2 0.5
. end`;

  const diags = validateRelap5(flawed);
  assert.ok(diags.length >= 2);
  assert.ok(diags.some((d) => d.code === "M8601"));
  assert.ok(diags.some((d) => d.code === "M8608"));
});

test("RELAP5 LSP: getRelap5DocumentSymbols returns document symbols hierarchy", () => {
  const symbols = getRelap5DocumentSymbols(VALID_DECK);
  assert.equal(symbols.length, 1);
  const root = symbols[0]!;
  assert.equal(root.name, "PWR Primary Circuit");
  assert.ok(root.children && root.children.length >= 4);

  const coreSym = root.children?.find((c) => c.name === "Core");
  assert.ok(coreSym);
  assert.ok(coreSym.detail?.includes("Volume 100"));

  const pkeSym = root.children?.find((c) => c.name === "ReactorPointKinetics");
  assert.ok(pkeSym);
});

test("RELAP5 LSP: getRelap5Hover returns markdown hover info", () => {
  const lines = VALID_DECK.split("\n");
  const coreLineIdx = lines.findIndex((l) => l.includes("1000000 Core pipe"));
  assert.ok(coreLineIdx !== -1);

  const hover = getRelap5Hover(VALID_DECK, { line: coreLineIdx, character: 10 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("RELAP5 Hydrodynamic Volume: **Core**"));
  assert.ok(hover.contents.value.includes("15.50 MPa"));
  assert.ok(hover.contents.value.includes("580.0 K"));
});

test("RELAP5 LSP: executeRelap5Action executes registered actions", async () => {
  // 1. lint
  const lints = await executeRelap5Action("lint_relap5", VALID_DECK);
  assert.equal(lints.length, 0);

  // 2. kinetics solve
  const sim = await executeRelap5Action("relap5_kinetics_solve", VALID_DECK, {
    options: { duration: 2.0, stepSize: 0.005 },
  });
  assert.ok(sim);
  assert.equal(sim.initialPowerMW, 3000.0);

  // 3. to-dae
  const daeSummary = await executeRelap5Action("relap5_to_dae", VALID_DECK);
  assert.ok(daeSummary.variableCount >= 18);
  assert.ok(daeSummary.equationCount >= 18);

  // 4. to-modelica
  const mo = await executeRelap5Action("relap5_to_modelica", VALID_DECK, {
    modelName: "PwrLspTest",
  });
  assert.ok(mo.includes("model PwrLspTest"));
  assert.ok(mo.includes("Real P_100"));
});
