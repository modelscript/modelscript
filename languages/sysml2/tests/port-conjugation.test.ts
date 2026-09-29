// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import { GenericModelicaBridge, SysML2GenericDefinition } from "../transformers/generic-modelica-bridge.js";

test("SysML v2 <-> Modelica Port Conjugation Bridge", async (t) => {
  await t.test("translates conjugated physical ports to complementary Modelica connectors", () => {
    const sysmlDef: SysML2GenericDefinition = {
      name: "MechanicalDamper",
      kind: "part def",
      attributes: [{ name: "d", type: "Real", defaultValue: "10.0", isParameter: true }],
      ports: [
        { name: "flange_a", type: "Flange", isConjugated: false },
        { name: "flange_b", type: "Flange", isConjugated: true },
        { name: "heat_port", type: "HeatPort", isConjugated: true },
        { name: "pin_pos", type: "Pin", isConjugated: false },
        { name: "pin_neg", type: "Pin", isConjugated: true },
      ],
      connections: [],
    };

    const modelica = GenericModelicaBridge.emitModelica(sysmlDef);

    // Non-conjugated Flange maps to Flange_a, conjugated Flange maps to Flange_b
    assert.ok(
      modelica.includes("Modelica.Mechanics.Translational.Interfaces.Flange_a flange_a;"),
      "flange_a should map to Flange_a",
    );
    assert.ok(
      modelica.includes("Modelica.Mechanics.Translational.Interfaces.Flange_b flange_b;"),
      "flange_b should map to Flange_b",
    );

    // Conjugated HeatPort maps to HeatPort_b
    assert.ok(
      modelica.includes("Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b heat_port;"),
      "heat_port should map to HeatPort_b",
    );

    // Pin positive vs negative
    assert.ok(
      modelica.includes("Modelica.Electrical.Analog.Interfaces.PositivePin pin_pos;"),
      "pin_pos should map to PositivePin",
    );
    assert.ok(
      modelica.includes("Modelica.Electrical.Analog.Interfaces.NegativePin pin_neg;"),
      "pin_neg should map to NegativePin",
    );
  });

  await t.test("inverts causal signal directions on conjugated ports", () => {
    const sysmlDef: SysML2GenericDefinition = {
      name: "SignalAdapter",
      kind: "part def",
      attributes: [],
      ports: [
        { name: "u_in", type: "RealInput", direction: "in", isConjugated: false },
        { name: "u_inv", type: "RealInput", direction: "in", isConjugated: true },
        { name: "y_out", type: "RealOutput", direction: "out", isConjugated: false },
        { name: "y_inv", type: "RealOutput", direction: "out", isConjugated: true },
      ],
      connections: [],
    };

    const modelica = GenericModelicaBridge.emitModelica(sysmlDef);

    assert.ok(
      modelica.includes("Modelica.Blocks.Interfaces.RealInput u_in;"),
      "Standard RealInput should map to RealInput",
    );
    assert.ok(
      modelica.includes("Modelica.Blocks.Interfaces.RealOutput u_inv;"),
      "Conjugated RealInput should invert to RealOutput",
    );
    assert.ok(
      modelica.includes("Modelica.Blocks.Interfaces.RealOutput y_out;"),
      "Standard RealOutput should map to RealOutput",
    );
    assert.ok(
      modelica.includes("Modelica.Blocks.Interfaces.RealInput y_inv;"),
      "Conjugated RealOutput should invert to RealInput",
    );
  });

  await t.test("parses Modelica connectors into conjugated SysML v2 ports and emits ~ prefix", () => {
    const modelicaSource = `
model Resistor
  parameter Real R = 100.0;
  Modelica.Electrical.Analog.Interfaces.PositivePin p;
  Modelica.Electrical.Analog.Interfaces.NegativePin n;
  Modelica.Blocks.Interfaces.RealOutput lossPower;
equation
  connect(p, n);
end Resistor;
`;

    const parsed = GenericModelicaBridge.parseModelicaToSysML2(modelicaSource);
    assert.strictEqual(parsed.name, "Resistor");
    assert.strictEqual(parsed.ports.length, 3);

    const portP = parsed.ports.find((p) => p.name === "p");
    const portN = parsed.ports.find((p) => p.name === "n");
    const portLoss = parsed.ports.find((p) => p.name === "lossPower");

    assert.ok(portP, "port p exists");
    assert.strictEqual(portP?.isConjugated, false);

    assert.ok(portN, "port n exists");
    assert.strictEqual(portN?.isConjugated, true, "NegativePin should be conjugated");

    assert.ok(portLoss, "port lossPower exists");
    assert.strictEqual(portLoss?.isConjugated, true, "RealOutput should be tagged conjugated");

    // Check SysML v2 emission
    const sysmlSource = GenericModelicaBridge.emitSysML2(parsed);
    assert.ok(sysmlSource.includes("port p : Pin;"), "Port p should not have tilde");
    assert.ok(sysmlSource.includes("port n : ~Pin;"), "Port n should have ~ prefix");
  });

  await t.test("parses SysML v2 source with conjugated ports and round-trips to Modelica", () => {
    const sysmlSource = `
part def ElectricMotor {
  attribute resistance : Real = 2.5;
  port p : Pin;
  port n : ~Pin;
  port shaft : Flange;
  port ~housing : Flange;
  port ctrl : RealInput;
  port ~feedback : RealInput;
}
`;

    const parsed = GenericModelicaBridge.parseSysML2(sysmlSource);
    assert.strictEqual(parsed.name, "ElectricMotor");
    assert.strictEqual(parsed.ports.length, 6);

    const p = parsed.ports.find((x) => x.name === "p");
    const n = parsed.ports.find((x) => x.name === "n");
    const shaft = parsed.ports.find((x) => x.name === "shaft");
    const housing = parsed.ports.find((x) => x.name === "housing");
    const feedback = parsed.ports.find((x) => x.name === "feedback");

    assert.strictEqual(p?.isConjugated, false);
    assert.strictEqual(n?.isConjugated, true);
    assert.strictEqual(shaft?.isConjugated, false);
    assert.strictEqual(housing?.isConjugated, true);
    assert.strictEqual(feedback?.isConjugated, true);

    const modelica = GenericModelicaBridge.emitModelica(parsed);
    assert.ok(modelica.includes("PositivePin p;"));
    assert.ok(modelica.includes("NegativePin n;"));
    assert.ok(modelica.includes("Flange_a shaft;"));
    assert.ok(modelica.includes("Flange_b housing;"));
    assert.ok(modelica.includes("RealOutput feedback;"));
  });
});
