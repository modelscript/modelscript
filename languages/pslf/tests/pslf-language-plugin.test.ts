// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { pslfLanguage } from "../src/language.js";

const WSCC_9BUS_MINI_EPC = `c WSCC 9-Bus Mini Base Case
case 'WSCC 9-Bus Test'
b 1 'BUS_1' 16.5 3 1 1 1.0400 0.00 1.100 0.900
b 2 'BUS_2' 18.0 2 1 1 1.0250 9.28 1.100 0.900
b 3 'BUS_3' 13.8 2 1 1 1.0250 4.66 1.100 0.900
b 4 'BUS_4' 230.0 1 1 1 1.0258 -2.22 1.100 0.900
b 5 'BUS_5' 230.0 1 1 1 0.9956 -3.99 1.100 0.900
b 6 'BUS_6' 230.0 1 1 1 1.0044 -3.69 1.100 0.900
b 7 'BUS_7' 230.0 1 1 1 1.0258 3.72 1.100 0.900
b 8 'BUS_8' 230.0 1 1 1 1.0159 0.73 1.100 0.900
b 9 'BUS_9' 230.0 1 1 1 1.0324 1.97 1.100 0.900
g 1 '1' 1 71.60 27.00 300.00 -300.00 1.0400 100.0 0.0000 0.0608 250.0 10.0
g 2 '1' 1 163.00 6.70 300.00 -300.00 1.0250 100.0 0.0000 0.1198 300.0 10.0
g 3 '1' 1 85.00 -10.90 300.00 -300.00 1.0250 100.0 0.0000 0.1813 150.0 10.0
ld 5 '1' 1 125.00 50.00 0.0 0.0 0.0 0.0 1 1
ld 6 '1' 1 90.00 30.00 0.0 0.0 0.0 0.0 1 1
ld 8 '1' 1 100.00 35.00 0.0 0.0 0.0 0.0 1 1
ln 4 5 '1' 1 0.01000 0.08500 0.17600 250.0 250.0 250.0
ln 4 6 '1' 1 0.01700 0.09200 0.15800 250.0 250.0 250.0
ln 5 7 '1' 1 0.03200 0.16100 0.30600 250.0 250.0 250.0
ln 6 9 '1' 1 0.03900 0.17000 0.35800 250.0 250.0 250.0
ln 7 8 '1' 1 0.00850 0.07200 0.14900 250.0 250.0 250.0
ln 8 9 '1' 1 0.01190 0.10080 0.20900 250.0 250.0 250.0
t 1 4 '1' 1 0.00000 0.05760 1.0000 0.00 200.0 200.0 200.0
t 2 7 '1' 1 0.00000 0.06250 1.0000 0.00 200.0 200.0 200.0
t 3 9 '1' 1 0.00000 0.05860 1.0000 0.00 150.0 150.0 150.0
`;

test("PSLF Language Plugin: metadata and actions registry", () => {
  assert.equal(pslfLanguage.name, "pslf");
  assert.deepEqual(pslfLanguage.fileExtensions, [".epc", ".dyd"]);
  assert.equal(pslfLanguage.maturity, "beta");
  assert.ok(pslfLanguage.actions && pslfLanguage.actions.length >= 2);

  const solveAction = pslfLanguage.actions.find((a) => a.id === "solve_pslf_powerflow");
  assert.ok(solveAction, "solve_pslf_powerflow action should be registered");

  const lintAction = pslfLanguage.actions.find((a) => a.id === "lint_pslf_model");
  assert.ok(lintAction, "lint_pslf_model action should be registered");
});

test("PSLF Language Plugin: executes solve_pslf_powerflow action", async () => {
  const solveAction = pslfLanguage.actions?.find((a) => a.id === "solve_pslf_powerflow");
  assert.ok(solveAction && solveAction.execute);

  const result = (await solveAction.execute(
    {} as any,
    { documentText: WSCC_9BUS_MINI_EPC } as any,
  )) as any;

  assert.ok(result, "Should return power flow result");
  assert.equal(result.converged, true, "AC power flow should converge");
  assert.ok(result.iterations > 0, "Should take at least 1 iteration");
  assert.ok(result.reportText.includes("POWER FLOW SOLUTION REPORT"));
  assert.ok(result.reportText.includes("WSCC 9-Bus Test"));
});

test("PSLF Language Plugin: executes lint_pslf_model action", async () => {
  const lintAction = pslfLanguage.actions?.find((a) => a.id === "lint_pslf_model");
  assert.ok(lintAction && lintAction.execute);

  const diagnostics = (await lintAction.execute(
    {} as any,
    { documentText: WSCC_9BUS_MINI_EPC } as any,
  )) as any[];

  assert.ok(Array.isArray(diagnostics));
  assert.equal(diagnostics.length, 0, "Clean WSCC 9-bus case should have 0 diagnostics");
});
