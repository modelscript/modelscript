// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractModelicaCadAnnotationsFromCst,
  extractModelicaParametersFromCst,
  extractPrimaryModelicaClassNameFromCst,
} from "../src/document-queries.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica Native WASM GLR CST Document Queries", async () => {
  const { parser } = await createWasmParser(modelicaWasm);

  describe("extractPrimaryModelicaClassNameFromCst", () => {
    it("prefers a model/block/class containing an experiment(...) annotation", () => {
      const src = `
connector Pin
  Real v;
  flow Real i;
end Pin;

model CircuitWithExperiment
  Real x(start = 1.0);
equation
  der(x) = -x;
  annotation(experiment(StartTime = 0, StopTime = 10, Tolerance = 1e-6));
end CircuitWithExperiment;

model TrailingHelper
  Real y;
equation
  y = 1.0;
end TrailingHelper;
`;
      const tree = parser.parse(src);
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(tree.rootNode, src), "CircuitWithExperiment");
    });

    it("falls back to the last model/block/class when no experiment(...) annotation exists", () => {
      const src = `
connector Flange
  Real s;
  flow Real f;
end Flange;

partial model BaseComponent
  Flange a;
end BaseComponent;

block Controller
  input Real u;
  output Real y;
equation
  y = 2 * u;
end Controller;

record Metadata
  Real version = 1;
end Metadata;
`;
      const tree = parser.parse(src);
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(tree.rootNode, src), "Controller");
    });

    it("falls back to the first class definition when no model/block/class exists", () => {
      const src = `
package UtilityTypes
  type Voltage = Real(unit = "V");
  function square
    input Real x;
    output Real y;
  algorithm
    y := x * x;
  end square;
end UtilityTypes;
`;
      const tree = parser.parse(src);
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(tree.rootNode, src), "UtilityTypes");
    });

    it("ignores class-like keywords inside comments and string literals", () => {
      const src = `
// model CommentedOut annotation(experiment(StopTime=1)); end CommentedOut;
/* block AlsoCommented end AlsoCommented; */
model RealModel "Contains text: model FakeModel end FakeModel;"
  Real x;
equation
  der(x) = -x;
end RealModel;
`;
      const tree = parser.parse(src);
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(tree.rootNode, src), "RealModel");
    });

    it("selects a nested model with experiment(...) inside a package", () => {
      const src = `
package DemoPkg
  model SubHelper
    Real a;
  end SubHelper;

  model MainSim
    Real x(start = 0);
  equation
    der(x) = 1;
    annotation(experiment(StopTime = 5));
  end MainSim;
end DemoPkg;
`;
      const tree = parser.parse(src);
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(tree.rootNode, src), "MainSim");
    });

    it("returns null for empty source or null rootNode", () => {
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(null, ""), null);
      const tree = parser.parse("   ");
      assert.strictEqual(extractPrimaryModelicaClassNameFromCst(tree.rootNode, "   "), null);
    });
  });

  describe("extractModelicaParametersFromCst", () => {
    it("extracts scalar numeric parameter and constant bindings with exact offsets and units", () => {
      const src = `model ThermalTank
  parameter Real C(unit="J/K") = 41840.0 "Thermal capacitance";
  parameter Real R(unit="K/W") = 0.08;
  parameter Real offset = -273.15;
  constant Real eps = 1e-6;
  parameter Integer n = 4;
  parameter Real a = 10, b = -2.5;
  parameter Real derived = 2 * C;
  parameter Real vec[3] = {1, 2, 3};
  Real T(start = 293.15);
equation
  C * der(T) = (T - offset) / R;
end ThermalTank;
`;
      const tree = parser.parse(src);
      const params = extractModelicaParametersFromCst(tree.rootNode, src);

      assert.strictEqual(params.length, 7);
      assert.deepStrictEqual(
        params.map((p) => ({ name: p.name, value: p.value, unit: p.unit, line: p.line })),
        [
          { name: "C", value: "41840.0", unit: "J/K", line: 2 },
          { name: "R", value: "0.08", unit: "K/W", line: 3 },
          { name: "offset", value: "-273.15", unit: undefined, line: 4 },
          { name: "eps", value: "1e-6", unit: undefined, line: 5 },
          { name: "n", value: "4", unit: undefined, line: 6 },
          { name: "a", value: "10", unit: undefined, line: 7 },
          { name: "b", value: "-2.5", unit: undefined, line: 7 },
        ],
      );

      // Verify exact CST offset slicing for every parameter
      for (const p of params) {
        assert.strictEqual(src.slice(p.valueStartOffset, p.valueEndOffset), p.value);
        assert.ok(p.startOffset <= p.valueStartOffset);
        assert.ok(p.valueEndOffset <= p.endOffset);
      }

      // Verify regex-free in-place edit using valueStartOffset/valueEndOffset
      const cParam = params[0]!;
      const edited = src.slice(0, cParam.valueStartOffset) + "50000.0" + src.slice(cParam.valueEndOffset);
      assert.ok(edited.includes('parameter Real C(unit="J/K") = 50000.0 "Thermal capacitance";'));
    });
  });

  describe("extractModelicaCadAnnotationsFromCst", () => {
    it("extracts annotation(... CAD(...) / cad(...) / CADPort(...)) clauses", () => {
      const src = `model CadAssembly
  Part housing annotation(CAD(uri="modelica://Lib/housing.glb", position={1, -2.5, 0}, scale={0.5, 0.5, 0.5}));
  Part cover annotation(cad(uri="modelica://Lib/cover.step"));
  Flange portA annotation(CADPort(name="mount", position={0, 0, 1}));
end CadAssembly;
`;
      const tree = parser.parse(src);
      const entries = extractModelicaCadAnnotationsFromCst(tree.rootNode, src);

      assert.strictEqual(entries.length, 3);

      assert.strictEqual(entries[0]!.name, "housing");
      assert.strictEqual(entries[0]!.kind, "annotation");
      assert.strictEqual(
        entries[0]!.cad,
        'CAD(uri="modelica://Lib/housing.glb", position={1, -2.5, 0}, scale={0.5, 0.5, 0.5})',
      );
      assert.deepStrictEqual(entries[0]!.modifiers, {
        uri: "modelica://Lib/housing.glb",
        position: [1, -2.5, 0],
        scale: [0.5, 0.5, 0.5],
      });

      assert.strictEqual(entries[1]!.name, "cover");
      assert.strictEqual(entries[1]!.kind, "annotation");
      assert.strictEqual(entries[1]!.cad, 'CAD(uri="modelica://Lib/cover.step")');

      assert.strictEqual(entries[2]!.name, "portA");
      assert.strictEqual(entries[2]!.kind, "annotation");
      assert.strictEqual(entries[2]!.cad, 'CADPort(name="mount", position={0, 0, 1})');
    });

    it('extracts explicit CAD="CAD(...)" string modifications on components', () => {
      const src = `model ExplicitCadMod
  Body rotor(m = 2.0, CAD = "CAD(uri=\\"modelica://Lib/rotor.glb\\", scale={2, 2, 2})");
end ExplicitCadMod;
`;
      const tree = parser.parse(src);
      const entries = extractModelicaCadAnnotationsFromCst(tree.rootNode, src);

      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.name, "rotor");
      assert.strictEqual(entries[0]!.kind, "modifier");
      assert.strictEqual(entries[0]!.cad, 'CAD(uri="modelica://Lib/rotor.glb", scale={2, 2, 2})');
      assert.strictEqual(entries[0]!.modifiers.m, 2.0);
    });

    it("extracts MSL MultiBody Visualizers, Parts, Forces, and Joints with CST modifiers", () => {
      const src = `model MultiBodyScene
  Modelica.Mechanics.MultiBody.Visualizers.FixedShape beam(
    shapeType = "box",
    length = 1.2,
    width = 0.2,
    height = 0.15,
    r = {0.1, 0.2, 0.3},
    color = {0, 128, 255}
  );
  Visualizers.Torus wheel(ri = 0.5, ro = 0.1, color = {255, 0, 0});
  Modelica.Mechanics.MultiBody.Visualizers.SignalArrow forceVec(diameter = 0.04, length = 0.8, n = {0, 1, 0});
  Modelica.Mechanics.MultiBody.Parts.BodyBox link(r = {0.5, 0, 0});
  Modelica.Mechanics.MultiBody.Forces.Spring coil(numberOfWindings = 8);
  Modelica.Mechanics.MultiBody.Joints.Revolute hinge(n = {0, 0, 1});
end MultiBodyScene;
`;
      const tree = parser.parse(src);
      const entries = extractModelicaCadAnnotationsFromCst(tree.rootNode, src);

      assert.strictEqual(entries.length, 6);

      assert.strictEqual(entries[0]!.name, "beam");
      assert.strictEqual(entries[0]!.kind, "multibody");
      assert.strictEqual(entries[0]!.shortType, "FixedShape");
      assert.strictEqual(entries[0]!.shapeType, "box");
      assert.deepStrictEqual(entries[0]!.modifiers, {
        shapeType: "box",
        length: 1.2,
        width: 0.2,
        height: 0.15,
        r: [0.1, 0.2, 0.3],
        color: [0, 128, 255],
      });

      assert.strictEqual(entries[1]!.name, "wheel");
      assert.strictEqual(entries[1]!.shortType, "Torus");
      assert.strictEqual(entries[1]!.shapeType, "surface:torus");
      assert.strictEqual(entries[1]!.modifiers.ri, 0.5);
      assert.strictEqual(entries[1]!.modifiers.ro, 0.1);

      assert.strictEqual(entries[2]!.name, "forceVec");
      assert.strictEqual(entries[2]!.shortType, "SignalArrow");
      assert.strictEqual(entries[2]!.shapeType, "arrow");
      assert.deepStrictEqual(entries[2]!.modifiers.n, [0, 1, 0]);

      assert.strictEqual(entries[3]!.name, "link");
      assert.strictEqual(entries[3]!.shortType, "BodyBox");
      assert.strictEqual(entries[3]!.shapeType, "box");

      assert.strictEqual(entries[4]!.name, "coil");
      assert.strictEqual(entries[4]!.shortType, "Spring");
      assert.strictEqual(entries[4]!.shapeType, "spring");
      assert.strictEqual(entries[4]!.modifiers.numberOfWindings, 8);

      assert.strictEqual(entries[5]!.name, "hinge");
      assert.strictEqual(entries[5]!.shortType, "Revolute");
      assert.strictEqual(entries[5]!.shapeType, "cylinder");
      assert.deepStrictEqual(entries[5]!.modifiers.n, [0, 0, 1]);
    });
  });
});
