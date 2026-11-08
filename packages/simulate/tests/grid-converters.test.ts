// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  exportExagoDeck,
  parseMatpower,
  parseVeraGridJson,
  serializeMatpower,
  serializeVeraGridJson,
  solveAcOpf,
  solveDcOpf,
} from "../src/solvers/opf/index.js";

const SAMPLE_CASE3_MATPOWER = `function mpc = case3
%% MATPOWER IEEE 3-bus benchmark
mpc.version = '2';
mpc.baseMVA = 100.0;

%% bus data
%  bus_i type Pd   Qd   Gs Bs area Vm    Va    baseKV zone Vmax Vmin
mpc.bus = [
  1  3  0.0   0.0  0  0  1  1.0  0.0  230.0  1  1.1  0.9;
  2  2  0.0   0.0  0  0  1  1.0  0.0  230.0  1  1.1  0.9;
  3  1  90.0  30.0 0  0  1  1.0  0.0  230.0  1  1.1  0.9;
];

%% generator data
%  bus Pg    Qg   Qmax  Qmin  Vg  mBase status Pmax   Pmin
mpc.gen = [
  1  50.0  10.0 40.0 -40.0 1.0 100.0 1      100.0  10.0;
  2  40.0  15.0 50.0 -50.0 1.0 100.0 1      80.0   0.0;
];

%% branch data
%  fbus tbus r       x       b     rateA rateB rateC ratio angle status
mpc.branch = [
  1    2    0.02    0.06    0.03  100.0 0     0     0     0     1;
  1    3    0.03    0.08    0.02  70.0  0     0     0     0     1;
  2    3    0.02    0.05    0.02  120.0 0     0     0     0     1;
];

%% generator cost data
%  1  startup  shutdown  n  c2  c1  c0
mpc.gencost = [
  2  0.0  0.0  3  0.0050  25.00  100.0;
  2  0.0  0.0  3  0.0080  40.00  150.0;
];
`;

const SAMPLE_VERAGRID_JSON = `{
  "name": "MicroGrid_3Bus",
  "sbase": 100.0,
  "buses": [
    { "name": "Bus_A", "vnom": 110.0, "is_slack": true, "vm": 1.0, "va": 0.0 },
    { "name": "Bus_B", "vnom": 110.0, "is_slack": false, "vm": 1.0, "va": 0.0 },
    { "name": "Bus_C", "vnom": 110.0, "is_slack": false, "vm": 1.0, "va": 0.0 }
  ],
  "loads": [
    { "bus": "Bus_C", "P": 75.0, "Q": 25.0 }
  ],
  "generators": [
    { "bus": "Bus_A", "P": 50.0, "Q": 10.0, "Pmin": 5.0, "Pmax": 100.0, "Qmin": -40.0, "Qmax": 40.0 },
    { "bus": "Bus_B", "P": 25.0, "Q": 15.0, "Pmin": 0.0, "Pmax": 60.0, "Qmin": -30.0, "Qmax": 30.0 }
  ],
  "lines": [
    { "bus_from": "Bus_A", "bus_to": "Bus_B", "r": 0.015, "x": 0.045, "b": 0.02, "rate": 80.0 },
    { "bus_from": "Bus_A", "bus_to": "Bus_C", "r": 0.025, "x": 0.075, "b": 0.01, "rate": 60.0 },
    { "bus_from": "Bus_B", "bus_to": "Bus_C", "r": 0.018, "x": 0.055, "b": 0.02, "rate": 90.0 }
  ]
}`;

test("MATPOWER (.m): Parses benchmark case and solves DC-OPF and AC-OPF", () => {
  const pCase = parseMatpower(SAMPLE_CASE3_MATPOWER);

  assert.equal(pCase.header.sbase, 100.0);
  assert.equal(pCase.buses.size, 3);
  assert.equal(pCase.loads.length, 1);
  assert.equal(pCase.loads[0]!.pl, 90.0);
  assert.equal(pCase.generators.length, 2);
  assert.equal(pCase.branches.length, 3);
  assert.ok(pCase.generatorCosts);
  assert.equal(pCase.generatorCosts.has("1_1"), true);
  assert.equal(pCase.generatorCosts.has("2_1"), true);
  const cost1 = pCase.generatorCosts.get("1_1");
  assert.ok(cost1);
  assert.equal(cost1.c1, 25.0);
  assert.equal(cost1.c2, 0.005);
  assert.equal(cost1.c0, 100.0);

  // Solve DC-OPF (should prioritize cheaper Gen 1 @ $25/MWh vs Gen 2 @ $40/MWh)
  const dcOpf = solveDcOpf(pCase);
  assert.equal(dcOpf.status, "OPTIMAL");
  assert.ok(dcOpf.totalGenMw >= 90.0);
  const gen1Result = dcOpf.generators.find((g) => g.busNumber === 1);
  assert.ok(gen1Result);
  assert.ok(gen1Result.pgMw > 40.0); // Merit-order dispatch favored Gen 1

  // Solve AC-OPF
  const acOpf = solveAcOpf(pCase);
  assert.equal(acOpf.status, "OPTIMAL");
  assert.ok(acOpf.totalLossMw >= 0);

  // Round-trip serialization
  const serialized = serializeMatpower(pCase, "case3_roundtrip");
  assert.ok(serialized.includes("mpc.baseMVA = 100.0;"));
  assert.ok(serialized.includes("mpc.bus = ["));
  assert.ok(serialized.includes("mpc.gen = ["));
  assert.ok(serialized.includes("mpc.branch = ["));
  assert.ok(serialized.includes("mpc.gencost = ["));

  // Re-parse
  const reparsed = parseMatpower(serialized);
  assert.equal(reparsed.buses.size, 3);
  assert.equal(reparsed.generators.length, 2);
  assert.ok(reparsed.generatorCosts);
  const reparsedCost1 = reparsed.generatorCosts.get("1_1");
  assert.ok(reparsedCost1);
  assert.equal(reparsedCost1.c1, 25.0);
  assert.equal(reparsedCost1.c2, 0.005);
  assert.equal(reparsedCost1.c0, 100.0);
});

test("VeraGrid Native JSON: Parses circuit and solves DC-OPF and AC-OPF", () => {
  const pCase = parseVeraGridJson(SAMPLE_VERAGRID_JSON);

  assert.equal(pCase.header.sbase, 100.0);
  assert.equal(pCase.buses.size, 3);
  assert.equal(pCase.loads.length, 1);
  assert.equal(pCase.loads[0]!.pl, 75.0);
  assert.equal(pCase.generators.length, 2);
  assert.equal(pCase.branches.length, 3);

  // Solve DC-OPF
  const dcOpf = solveDcOpf(pCase);
  assert.equal(dcOpf.status, "OPTIMAL");
  assert.ok(dcOpf.totalGenMw >= 75.0);

  // Solve AC-OPF
  const acOpf = solveAcOpf(pCase);
  assert.equal(acOpf.status, "OPTIMAL");
  assert.ok(acOpf.totalLossMw >= 0);

  // Round-trip serialization
  const jsonStr = serializeVeraGridJson(pCase);
  assert.ok(jsonStr.includes("MicroGrid_3Bus"));
  assert.ok(jsonStr.includes("Bus_A"));

  const reparsed = parseVeraGridJson(jsonStr);
  assert.equal(reparsed.buses.size, 3);
  assert.equal(reparsed.generators.length, 2);
});

test("ExaGO Deck Exporter: Generates turnkey MATPOWER, .cont, .ini, and Slurm scripts", () => {
  const pCase = parseMatpower(SAMPLE_CASE3_MATPOWER);
  const deck = exportExagoDeck(pCase, {
    caseName: "wecc_cluster",
    optSolver: "hiop",
    mpiRanks: 32,
    contingencies: [
      { id: "LINE_1_2", type: "branch", fromBus: 1, toBus: 2, ckt: "1" },
      { id: "GEN_2", type: "gen", bus: 2, genId: "1" },
    ],
  });

  assert.equal(deck.caseName, "wecc_cluster");
  assert.ok(deck.matpowerCase.includes("function mpc = wecc_cluster"));
  assert.ok(deck.matpowerCase.includes("mpc.gencost = ["));
  assert.ok(deck.contingenciesCont);
  assert.ok(deck.contingenciesCont.includes("BRANCH\t1\t2\t1"));
  assert.ok(deck.contingenciesCont.includes("GEN\t2\t1"));
  assert.ok(deck.configFile.includes("app = scopflow"));
  assert.ok(deck.configFile.includes("opt_solver = hiop"));
  assert.ok(deck.configFile.includes("ctgcfile = contingencies.cont"));
  assert.ok(deck.slurmScript.includes("MPI_RANKS=32"));
  assert.ok(deck.slurmScript.includes("scopflow"));
});
