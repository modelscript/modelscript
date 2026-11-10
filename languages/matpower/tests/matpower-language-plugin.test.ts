// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentSymbols, lowerMatpowerToDae, matpowerLanguage, MatpowerWorkspaceIndex } from "../src/index.js";

const TEST_CASE = `function mpc = case_test
mpc.version = '2';
mpc.baseMVA = 100.0;

mpc.bus = [
	1	3	0.0	0.0	0.0	0.0	1	1.05	0.0	138.0	1	1.1	0.9;
	2	1	50.0	20.0	0.0	0.0	1	1.00	0.0	138.0	1	1.1	0.9;
];

mpc.gen = [
	1	50.0	20.0	100.0	-50.0	1.05	100.0	1	100.0	0.0;
];

mpc.branch = [
	1	2	0.01	0.05	0.02	100.0	0.0	0.0	0.0	0.0	1	-360.0	360.0;
];
`;

test("MATPOWER DAE Lowering: compiles directly into linear memory DAEBuilder arena", () => {
  const mpc = {
    caseName: "case_test",
    version: "2",
    baseMVA: 100.0,
    bus: [
      {
        bus_i: 1,
        type: 3,
        pd: 0,
        qd: 0,
        gs: 0,
        bs: 0,
        area: 1,
        vm: 1.05,
        va: 0,
        baseKv: 138,
        zone: 1,
        vmax: 1.1,
        vmin: 0.9,
      },
      {
        bus_i: 2,
        type: 1,
        pd: 50,
        qd: 20,
        gs: 0,
        bs: 0,
        area: 1,
        vm: 1.0,
        va: 0,
        baseKv: 138,
        zone: 1,
        vmax: 1.1,
        vmin: 0.9,
      },
    ],
    gen: [{ bus: 1, pg: 50, qg: 20, qmax: 100, qmin: -50, vg: 1.05, mbase: 100, status: 1, pmax: 100, pmin: 0 }],
    branch: [
      {
        fbus: 1,
        tbus: 2,
        r: 0.01,
        x: 0.05,
        b: 0.02,
        rateA: 100,
        rateB: 0,
        rateC: 0,
        ratio: 0,
        angle: 0,
        status: 1,
        angmin: -360,
        angmax: 360,
      },
    ],
  };

  const arena = lowerMatpowerToDae(mpc);
  assert.ok(arena.getVarCount() > 0, "DAEBuilder arena should contain state variables");
  assert.ok(arena.getEqCount() > 0, "DAEBuilder arena should contain balance equations");
});

test("MATPOWER LSP & Workspace Index: generates outline symbols and indexes documents", () => {
  const symbols = getDocumentSymbols(TEST_CASE);
  assert.equal(symbols.length, 3, "Should have 3 root categories: Buses, Generators, Branches");

  const busGroup = symbols.find((s) => s.name === "Buses")!;
  assert.ok(busGroup);
  assert.equal(busGroup.children?.length, 2, "Should have 2 buses");

  const index = new MatpowerWorkspaceIndex();
  index.indexDocument("file:///case_test.m", TEST_CASE);
  const model = index.getModel("file:///case_test.m");
  assert.ok(model);
  assert.equal(model.caseData.bus.length, 2);
});

test("MATPOWER Language Plugin: executes language actions", async () => {
  assert.equal(matpowerLanguage.name, "matpower");
  const solveAction = matpowerLanguage.actions?.find((a) => a.id === "solve_matpower_powerflow");
  assert.ok(solveAction);

  const result = await solveAction.execute({} as any, { documentText: TEST_CASE });
  assert.ok(result);
  assert.ok((result as any).converged, "Should solve successfully via action");
});
