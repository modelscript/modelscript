// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { solvePowerFlow } from "@modelscript/psse";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import { powerFactoryToModelica } from "../src/projections/powerfactory-to-modelica.js";
import { powerFactoryToPsse } from "../src/projections/powerfactory-to-psse.js";

const twoBusXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_1"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_2"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>

  <DataObject class="ElmLne" loc_name="Line_1_2">
    <bus1>Bus_1</bus1>
    <bus2>Bus_2</bus2>
    <dline>20.0</dline>
    <r1>2.42</r1>
    <x1>7.26</x1>
    <b1>15.0</b1>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_1">
    <bus1>Bus_1</bus1>
    <pgini>60.0</pgini>
    <qgini>10.0</qgini>
    <usetp>1.02</usetp>
  </DataObject>

  <DataObject class="ElmLod" loc_name="Load_2">
    <bus1>Bus_2</bus1>
    <plini>50.0</plini>
    <qlini>15.0</qlini>
  </DataObject>
</PowerFactory>`;

test("powerFactoryToPsse: projects PowerFactory network and solves AC power flow", () => {
  const model = parsePowerFactoryText(twoBusXml, "TwoBusGrid");
  const { psseCase, termToBusMap } = powerFactoryToPsse(model);

  assert.strictEqual(psseCase.buses.size, 2);
  assert.strictEqual(psseCase.branches.length, 1);
  assert.strictEqual(psseCase.generators.length, 1);
  assert.strictEqual(psseCase.loads.length, 1);

  // Solve AC Newton-Raphson power flow using @modelscript/psse solver
  const sol = solvePowerFlow(psseCase);
  assert.ok(sol.converged, "AC Power Flow must converge");
  assert.ok(sol.iterations <= 5, "Should converge within 5 iterations");
  assert.ok(sol.maxMismatchPu < 1e-4, "Mismatch should be below 1e-4 pu");

  // Check solved voltages
  const bus1 = sol.buses.find((b) => b.busNumber === termToBusMap.get("Bus_1"));
  const bus2 = sol.buses.find((b) => b.busNumber === termToBusMap.get("Bus_2"));
  assert.ok(bus1 && bus2);
  assert.ok(Math.abs(bus1.vm - 1.02) < 1e-3, "Bus 1 (generator) voltage should be ~1.02 pu");
  assert.ok(bus2.vm > 0.95 && bus2.vm < 1.05, "Bus 2 (load) voltage should be within nominal limits");
});

test("powerFactoryToModelica: generates valid OpenIPSL Modelica grid code", () => {
  const model = parsePowerFactoryText(twoBusXml, "TwoBusGrid");
  const moCode = powerFactoryToModelica(model, { modelName: "TwoBusGrid" });

  assert.ok(moCode.includes("model TwoBusGrid"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Buses.Bus bus_1"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Buses.Bus bus_2"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Branches.Line line_1"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Machines.PSSE.GENSAL gen_1"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Loads.PSSE.Load load_1"));
  assert.ok(moCode.includes("connect(line_1.p, bus_1.p)"));
  assert.ok(moCode.includes("connect(line_1.n, bus_2.p)"));
});
