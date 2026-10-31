// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler } from "../src/index.js";
import {
  extractModelicaModel,
  extractStepModel,
  extractSysML2Model,
  resolvePolyglotModel,
} from "../src/polyglot/resolver.js";

test("ModelScript polyglot query over a Modelica model using FLWOR", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const modelicaSource = `
model ElectricalCircuit
  parameter Real R1 = 100.0;
  parameter Real R2 = 220.0;
  parameter Real R3 = 47.0;
  parameter Real C1 = 0.001;
  parameter Real L1 = 0.05;
equation
  // equations...
end ElectricalCircuit;
`;

  // 1. In ModelScript polyglot runtime, importing "./Circuit.mo" resolves the Modelica model:
  const circuit = extractModelicaModel(null, modelicaSource);
  assert.equal(circuit.components.length, 5);
  assert.equal(circuit.parameters.length, 5);

  // 2. Query the imported Modelica model using ModelScript FLWOR:
  const modelScriptCode = `
import { ElectricalCircuit } from "./models/ElectricalCircuit.mo";

let largeResistors = 
  for comp in circuit.components
  where comp.name.startsWith("R") && comp.value > 50.0
  order by comp.value descending
  return {
    component: comp.name,
    resistance: comp.value,
    type: comp.type
  };

return largeResistors;
`;

  const { js } = compiler.compileToJs(modelScriptCode);
  assert.ok(
    js.includes('import { ElectricalCircuit } from "./models/ElectricalCircuit.mo";'),
    "JS emitter should emit valid ES module import statement",
  );

  const results = compiler.executeJs(modelScriptCode, { circuit }) as any[];

  assert.ok(Array.isArray(results), "Results should be an array");
  assert.equal(results.length, 2, "Should match R1 (100) and R2 (220)");
  assert.deepEqual(results, [
    { component: "R2", resistance: 220.0, type: "Real" },
    { component: "R1", resistance: 100.0, type: "Real" },
  ]);
});

test("Structural Polyglot Resolver: extracts parameters, variables, equations, and ports from Modelica, SysML2, and STEP", () => {
  const moSource = `
model PendulumDrive
  parameter Real m = 2.5 "Mass";
  parameter Real L = 1.2;
  Real theta(start = 0.1);
  Real omega;
  input Real u_torque;
  output Real y_angle;
  Modelica.Mechanics.Rotational.Interfaces.Flange_a flange;
equation
  der(theta) = omega;
  m * L * L * der(omega) = u_torque - 9.81 * m * L * sin(theta);
  connect(flange.tau, u_torque);
end PendulumDrive;
`;
  const moModel = resolvePolyglotModel("PendulumDrive.mo", moSource);
  assert.equal(moModel.language, "modelica");
  assert.equal(moModel.name, "PendulumDrive");
  assert.equal(moModel.parameters.length, 2);
  assert.deepEqual(
    moModel.parameters.map((p) => ({ name: p.name, value: p.value })),
    [
      { name: "m", value: 2.5 },
      { name: "L", value: 1.2 },
    ],
  );
  assert.ok(moModel.variables.some((v) => v.name === "theta") && moModel.variables.some((v) => v.name === "omega"));
  assert.ok(
    moModel.ports.some((p) => p.name === "u_torque" && p.direction === "in") &&
      moModel.ports.some((p) => p.name === "y_angle" && p.direction === "out") &&
      moModel.ports.some((p) => p.name === "flange"),
  );
  assert.equal(moModel.equations.length, 3);
  assert.ok(moModel.equations.some((e) => e.kind === "connect"));

  const sysmlSource = `
package ThermalControl {
  part def HeatExchanger {
    in port coolantIn : FluidPort;
    out port coolantOut : FluidPort;
    attribute thermalResistance : Real = 0.45;
    attribute maxTemp : Real = 393.15;
    attribute deltaT : Real;
    part core : FinArray;
    assert constraint { deltaT <= maxTemp }
  }
}
`;
  const sysmlModel = extractSysML2Model(null, sysmlSource);
  assert.equal(sysmlModel.language, "sysml2");
  assert.equal(sysmlModel.parameters.length, 2);
  assert.ok(sysmlModel.parameters.some((p) => p.name === "thermalResistance" && p.value === 0.45));
  assert.ok(sysmlModel.variables.some((v) => v.name === "deltaT"));
  assert.equal(sysmlModel.ports.length, 2);
  assert.ok(sysmlModel.ports.some((p) => p.name === "coolantIn" && p.direction === "in"));
  assert.ok(sysmlModel.ports.some((p) => p.name === "coolantOut" && p.direction === "out"));
  assert.ok(sysmlModel.equations.length >= 1);

  const stepSource = `
ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('Origin', (0.0, 0.0, 0.0));
#20 = DIRECTION('AxisZ', (0.0, 0.0, 1.0));
#30 = CYLINDRICAL_SURFACE('Bore', #10, 25.4);
#40 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO1', 'Mate', 'Bolt', #10, #30, $);
ENDSEC;
END-ISO-10303-21;
`;
  const stepModel = extractStepModel(null, stepSource);
  assert.equal(stepModel.language, "step");
  assert.ok(stepModel.parameters.some((p) => p.type === "CYLINDRICAL_SURFACE" && p.value === 25.4));
  assert.ok(stepModel.ports.some((p) => p.type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE"));
  assert.ok(stepModel.equations.some((e) => e.kind === "connect" && e.lhs === "#10" && e.rhs === "#30"));
});
