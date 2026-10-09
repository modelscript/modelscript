// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCadBindings,
  patchModelicaCadAnnotation,
  serializeCadAnnotation,
  serializeCadBinding,
  type DynamicBindingConfig,
} from "../src/index.js";

describe("CAD Annotation Serialization, Parsing & Patching", () => {
  it("serializes a single CADBinding record", () => {
    const binding: DynamicBindingConfig = {
      property: "position",
      index: 0, // JS 0-index becomes Modelica index = 1
      variable: "r_0[1]",
      unit: "m",
    };
    const s = serializeCadBinding(binding);
    assert.strictEqual(s, 'CADBinding(property = "position", index = 1, variable = "r_0[1]", unit = "m")');
  });

  it("serializes a CAD annotation with multiple dynamic bindings", () => {
    const annot = serializeCadAnnotation({
      uri: "modelica://MyLib/Resources/box.step",
      position: [0, 0, 0],
      dynamicBindings: [
        { property: "position", index: 0, variable: "r_0[1]", unit: "m" },
        { property: "position", index: 1, variable: "r_0[2]", unit: "m" },
        { property: "rotation", variable: "R.T", format: "matrix3x3" },
      ],
    });

    assert.ok(annot.includes('uri = "modelica://MyLib/Resources/box.step"'));
    assert.ok(annot.includes("position = {0, 0, 0}"));
    assert.ok(annot.includes('property = "position", index = 1, variable = "r_0[1]"'));
    assert.ok(annot.includes('property = "rotation", variable = "R.T", format = "matrix3x3"'));
  });

  it("parses explicit CADBinding calls from annotation string", () => {
    const cadStr = `CAD(
      uri = "modelica://Lib/robot.glb",
      dynamicBindings = {
        CADBinding(property = "position", index = 1, variable = "x_pos", unit = "mm", scale = 1000),
        CADBinding(property = "rotation", format = "matrix3x3", variable = "frame_a.R.T")
      }
    )`;

    const bindings = parseCadBindings(cadStr);
    assert.strictEqual(bindings.length, 2);
    assert.strictEqual(bindings[0].property, "position");
    assert.strictEqual(bindings[0].index, 0); // normalized to 0-based
    assert.strictEqual(bindings[0].variable, "x_pos");
    assert.strictEqual(bindings[0].unit, "mm");
    assert.strictEqual(bindings[0].scale, 1000);

    assert.strictEqual(bindings[1].property, "rotation");
    assert.strictEqual(bindings[1].variable, "frame_a.R.T");
    assert.strictEqual(bindings[1].format, "matrix3x3");
  });

  it("parses shorthand dynamicPosition and dynamicRotation", () => {
    const cadStr = `CAD(uri="part.glb", dynamicPosition="{r[1], r[2], r[3]}", dynamicRotation="R.T")`;
    const bindings = parseCadBindings(cadStr);
    assert.strictEqual(bindings.length, 4);
    assert.strictEqual(bindings[0].variable, "r[1]");
    assert.strictEqual(bindings[1].variable, "r[2]");
    assert.strictEqual(bindings[2].variable, "r[3]");
    assert.strictEqual(bindings[3].variable, "R.T");
    assert.strictEqual(bindings[3].format, "matrix3x3");
  });

  it("patches existing CAD annotation in Modelica code", () => {
    const modelicaCode = `model Robot
  Modelica.Mechanics.MultiBody.Parts.BodyBox body(
    r={0.1, 0, 0},
    annotation(CAD(
      uri = "modelica://Lib/box.step",
      position = {0, 0, 0}
    ))
  );
equation
end Robot;`;

    const result = patchModelicaCadAnnotation(modelicaCode, "body", {
      bindings: [
        { property: "position", index: 0, variable: "r_0[1]", unit: "m" },
        { property: "position", index: 1, variable: "r_0[2]", unit: "m" },
        { property: "rotation", variable: "R.T", format: "matrix3x3" },
      ],
    });

    assert.ok(result.updatedSource.includes('uri = "modelica://Lib/box.step"'));
    assert.ok(result.updatedSource.includes("dynamicBindings = {"));
    assert.ok(result.updatedSource.includes('property = "position", index = 1, variable = "r_0[1]"'));
    assert.ok(result.updatedSource.includes('property = "rotation", variable = "R.T", format = "matrix3x3"'));
    assert.ok(result.updatedSource.includes("end Robot;"));
  });

  it("adds annotation(CAD(...)) to component without existing annotation", () => {
    const modelicaCode = `model Mechanism
  Modelica.Mechanics.MultiBody.Parts.BodyBox link1(r={1, 0, 0});
equation
end Mechanism;`;

    const result = patchModelicaCadAnnotation(modelicaCode, "link1", {
      uri: "modelica://Mech/Resources/link.step",
      bindings: [{ property: "rotation", variable: "phi", unit: "rad" }],
    });

    assert.ok(result.updatedSource.includes("link1(r={1, 0, 0}) annotation(CAD("));
    assert.ok(result.updatedSource.includes('uri = "modelica://Mech/Resources/link.step"'));
    assert.ok(result.updatedSource.includes('property = "rotation", variable = "phi", unit = "rad"'));
  });
});
