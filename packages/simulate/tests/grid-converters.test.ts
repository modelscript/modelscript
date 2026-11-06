// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
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

  // Solve DC-OPF
  const dcOpf = solveDcOpf(pCase);
  assert.equal(dcOpf.status, "OPTIMAL");
  assert.ok(dcOpf.totalGenMw >= 90.0);

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

  // Re-parse
  const reparsed = parseMatpower(serialized);
  assert.equal(reparsed.buses.size, 3);
  assert.equal(reparsed.generators.length, 2);
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
