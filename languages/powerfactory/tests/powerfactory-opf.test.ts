// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import {
  powerFactoryToGenericPowerCase,
  solvePowerFactoryOpf,
  solvePowerFactoryQdsl,
} from "../src/solvers/powerfactory-opf.js";

const threeBusXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_1"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_2"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_3"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>

  <DataObject class="ElmLne" loc_name="Line_1_2">
    <bus1>Bus_1</bus1>
    <bus2>Bus_2</bus2>
    <dline>20.0</dline>
    <r1>2.42</r1>
    <x1>7.26</x1>
    <b1>15.0</b1>
  </DataObject>

  <DataObject class="ElmLne" loc_name="Line_2_3">
    <bus1>Bus_2</bus1>
    <bus2>Bus_3</bus2>
    <dline>15.0</dline>
    <r1>1.81</r1>
    <x1>5.44</x1>
    <b1>12.0</b1>
  </DataObject>

  <DataObject class="ElmLne" loc_name="Line_1_3">
    <bus1>Bus_1</bus1>
    <bus2>Bus_3</bus2>
    <dline>25.0</dline>
    <r1>3.02</r1>
    <x1>9.07</x1>
    <b1>18.0</b1>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_1">
    <bus1>Bus_1</bus1>
    <pgini>70.0</pgini>
    <qgini>15.0</qgini>
    <usetp>1.02</usetp>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_3">
    <bus1>Bus_3</bus1>
    <pgini>30.0</pgini>
    <qgini>10.0</qgini>
    <usetp>1.00</usetp>
  </DataObject>

  <DataObject class="ElmLod" loc_name="Load_2">
    <bus1>Bus_2</bus1>
    <plini>80.0</plini>
    <qlini>25.0</qlini>
  </DataObject>
</PowerFactory>`;

test("powerFactoryToGenericPowerCase: correctly structures PowerFactoryModel for OPF", () => {
  const model = parsePowerFactoryText(threeBusXml, "ThreeBusGrid");
  const pCase = powerFactoryToGenericPowerCase(model);

  assert.equal(pCase.buses.size, 3, "Must have 3 buses");
  assert.equal(pCase.branches.length, 3, "Must have 3 branches");
  assert.equal(pCase.generators.length, 2, "Must have 2 generators");
  assert.equal(pCase.loads.length, 1, "Must have 1 load");
  assert.ok(pCase.generatorCosts && pCase.generatorCosts.size > 0, "Must assign generator cost curves");
});

test("solvePowerFactoryOpf: executes DC-OPF economic dispatch on PowerFactoryModel", () => {
  const model = parsePowerFactoryText(threeBusXml, "ThreeBusGrid");

  // Custom fuel costs: Gen_1 ($20/MWh) cheaper than Gen_3 peaker ($50/MWh)
  const customCosts = new Map([
    ["1_Gen_1", { c0: 50, c1: 20.0, c2: 0.02 }],
    ["3_Gen_3", { c0: 80, c1: 50.0, c2: 0.05 }],
  ]);

  const sol = solvePowerFactoryOpf(model, {
    formulation: "dc",
    generatorCosts: customCosts,
    enforceThermalLimits: true,
  });

  assert.equal(sol.status, "OPTIMAL", "DC-OPF must be OPTIMAL");
  assert.ok(sol.objectiveValue > 0, "Total cost must be positive");
  assert.equal(sol.generators.length, 2, "Must return results for both generators");

  const g1Res = sol.generators.find((g) => g.busNumber === 1)!;
  const g3Res = sol.generators.find((g) => g.busNumber === 3)!;

  assert.ok(g1Res.pgMw > g3Res.pgMw, "Cheaper generator Gen_1 must be dispatched higher than peaker Gen_3");
  assert.ok(sol.buses.every((b) => b.lmpDollarsPerMwh > 0), "All LMPs must be positive");
});

test("solvePowerFactoryOpf: executes AC-OPF with voltage optimization on PowerFactoryModel", () => {
  const model = parsePowerFactoryText(threeBusXml, "ThreeBusGrid");

  const sol = solvePowerFactoryOpf(model, {
    formulation: "ac",
    enforceThermalLimits: true,
  });

  assert.equal(sol.status, "OPTIMAL", "AC-OPF must be OPTIMAL");
  assert.ok(sol.objectiveValue > 0, "Total cost must be positive");
  assert.ok(sol.buses.every((b) => b.vm >= 0.90 && b.vm <= 1.10), "Voltages within limits");
});

test("solvePowerFactoryQdsl: runs 24h Quasi-Dynamic simulation on PowerFactoryModel", () => {
  const model = parsePowerFactoryText(threeBusXml, "ThreeBusGrid");

  const qdslRes = solvePowerFactoryQdsl(model, {
    durationHours: 24.0,
    timeStepHours: 2.0,
  });

  assert.equal(qdslRes.steps.length, 12, "Must execute 12 steps for 24h at dt=2h");
  assert.ok(qdslRes.totalEnergySuppliedMwh > 0, "Must calculate energy supplied");
  assert.ok(qdslRes.totalEnergyLossesMwh > 0, "Must calculate energy losses");
});
