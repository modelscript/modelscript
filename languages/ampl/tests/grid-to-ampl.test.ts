// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseMatpower } from "@modelscript/simulate/opf";
import assert from "node:assert/strict";
import test from "node:test";
import { gridToAmplOpf, solveAmplOpf } from "../src/index.js";

const SAMPLE_CASE3_MATPOWER = `function mpc = case3
%% MATPOWER IEEE 3-bus benchmark
mpc.version = '2';
mpc.baseMVA = 100.0;

%% bus data
mpc.bus = [
  1  3  0.0   0.0  0  0  1  1.0  0.0  230.0  1  1.1  0.9;
  2  2  0.0   0.0  0  0  1  1.0  0.0  230.0  1  1.1  0.9;
  3  1  90.0  30.0 0  0  1  1.0  0.0  230.0  1  1.1  0.9;
];

%% generator data
mpc.gen = [
  1  50.0  10.0 40.0 -40.0 1.0 100.0 1      100.0  10.0;
  2  40.0  15.0 50.0 -50.0 1.0 100.0 1      80.0   0.0;
];

%% branch data
mpc.branch = [
  1    2    0.02    0.06    0.03  100.0 0     0     0     0     1;
  1    3    0.03    0.08    0.02  70.0  0     0     0     0     1;
  2    3    0.02    0.05    0.02  120.0 0     0     0     0     1;
];

%% generator cost data
mpc.gencost = [
  2  0.0  0.0  3  0.0050  25.00  100.0;
  2  0.0  0.0  3  0.0080  40.00  150.0;
];
`;

test("AMPL OPF Bridge: Compiles GenericPowerCase to algebraic AMPL .mod/.dat and solves via solveAmplOpf", async () => {
  const pCase = parseMatpower(SAMPLE_CASE3_MATPOWER);

  // 1. Synthesize AMPL code
  const { modText, datText, combinedText } = gridToAmplOpf(pCase, { formulation: "dc" });
  assert.ok(modText.includes("set BUSES;"));
  assert.ok(modText.includes("set GENS;"));
  assert.ok(modText.includes("subject to NodalPowerBalance"));
  assert.ok(datText.includes("set BUSES := 1 2 3;"));
  assert.ok(combinedText.includes("minimize TotalGenerationCost:"));

  // 2. Solve via solveAmplOpf
  const sol = await solveAmplOpf(pCase, { formulation: "dc" });
  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(sol.totalGenMw >= 90.0, `Total generation ${sol.totalGenMw} should cover load`);
  assert.equal(sol.buses.length, 3);
  assert.equal(sol.generators.length, 2);
  assert.ok(sol.averageLmp > 0);

  // 3. User Extensibility: Inject custom AMPL constraint into the OPF model
  // Limit G1 generation to 30 MW (below normal merit order dispatch of 50+ MW)
  const customSol = await solveAmplOpf(pCase, {
    formulation: "dc",
    customAmplConstraints: ["subject to UserGreenCap: Pg['G_1_1'] <= 30.0;"],
  });

  assert.equal(customSol.status, "OPTIMAL");
  const g1Res = customSol.generators.find((g) => g.busNumber === 1);
  assert.ok(g1Res);
  assert.ok(g1Res.pgMw <= 30.01, `Gen 1 dispatch ${g1Res.pgMw} must respect custom user constraint <= 30 MW`);
  const g2Res = customSol.generators.find((g) => g.busNumber === 2);
  assert.ok(g2Res);
  assert.ok(g2Res.pgMw >= 60.0, `Gen 2 must make up remaining load >= 60 MW, got ${g2Res.pgMw}`);
});
