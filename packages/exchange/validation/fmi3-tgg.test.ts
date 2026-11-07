// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileTGGRules,
  tggComplement,
  tggDefaultVal,
  tggEq,
  tggInvertible,
  tggReconcilePhysics,
  tggRule,
  tggTypeMap,
} from "@modelscript/dsl";
import { PolyglotTransformer, type PolyglotNode } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fmi3PolyglotConfig,
  fmi3TggRules,
  projectModelicaToFmi3ViaTgg,
  synchronizeFmi3ToModelica,
} from "../src/fmu/fmi3-tgg.js";

describe("Modelica <-> FMI 3.0 Bidirectional TGG & Polyglot Workflow Compiler", () => {
  it("compiles all 5 declarative Modelica <-> FMI 3.0 TGG rules via compileTGGRules()", () => {
    assert.equal(fmi3TggRules.length, 5);
    const compiled = compileTGGRules(fmi3PolyglotConfig);
    assert.equal(compiled.ruleCount, 5);
    assert.ok(compiled.sourceCode.includes("tgg_forward_ModelicaModelToFmi3CoSimulation"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_ModelicaStateToFmi3Float64State"));
  });

  it("projects Modelica DC_Motor to FMI 3.0 XML and synchronizes FMI 3.0 edits back via shadow complements", () => {
    const moCode = `model DC_Motor
  /* Preserved block comment with fake declaration: parameter Real Fake = 999; */
  parameter Real R = 0.5 "Armature resistance (Ohm)";
  parameter Real Ke = 0.08 "Back-EMF constant (V.s/rad)";
  input Real v_in;
  output Real omega(start = 0.0);
equation
  // Differential equation preserved across FMI 3.0 round-trip
  der(omega) = (Ke * (v_in - Ke * omega) / R - 0.01 * omega) / 0.002;
end DC_Motor;`;

    const { fmi3Xml } = projectModelicaToFmi3ViaTgg(moCode);
    assert.ok(fmi3Xml.includes('<fmiModelDescription fmiVersion="3.0" modelName="DC_Motor">'));
    assert.ok(
      fmi3Xml.includes(
        '<Float64 name="omega" valueReference="3" causality="output" variability="continuous" initial="calculated" start="0" derivative="4"/>',
      ),
    );

    const editedFmi3 = fmi3Xml
      .replace('modelName="DC_Motor"', 'modelName="Servo_Motor"')
      .replace(
        'name="omega" valueReference="3" causality="output" variability="continuous" initial="calculated" start="0"',
        'name="omega" valueReference="3" causality="output" variability="continuous" initial="calculated" start="12.5"',
      );

    const syncRes = synchronizeFmi3ToModelica(moCode, editedFmi3);
    assert.ok(syncRes.updatedText.includes("model Servo_Motor"));
    assert.ok(syncRes.updatedText.includes("/* Preserved block comment with fake declaration"));
    assert.ok(syncRes.updatedText.includes('parameter Real R = 0.5 "Armature resistance (Ohm)";'));
    assert.ok(syncRes.updatedText.includes("output Real omega(start = 12.5);"));
    assert.ok(syncRes.updatedText.includes("// Differential equation preserved across FMI 3.0 round-trip"));
    assert.ok(syncRes.updatedText.includes("der(omega) = (Ke * (v_in - Ke * omega) / R - 0.01 * omega) / 0.002;"));
    assert.ok(syncRes.updatedText.includes("end Servo_Motor;"));
  });

  it("executes a brand-new declarative tggRule forward and backward via PolyglotTransformer without custom synchronizer code", () => {
    const customRule = tggRule({
      name: "ThermalResistorToSysmlPart",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) =>
        $.ThermalComponent({
          name: v("compName"),
          moType: v("srcType"),
          resistance: v("R_th"),
          conductance: v("G_th"),
        }),
      target: ($, v) =>
        $.PartUsage({
          name: v("compName"),
          sysmlType: v("tgtType"),
          R_thermal: v("R_th"),
          G_thermal: v("G_th"),
          status: v("defaultStatus"),
        }),
      where: (v) => [
        tggEq(v("compName"), v("compName")),
        tggEq(v("R_th"), v("R_th")),
        tggTypeMap(v("srcType"), v("tgtType"), "sysml2"),
        tggInvertible("G_th = 100 / R_th", "R_th = 100 / G_th"),
        tggDefaultVal(v("defaultStatus"), "verified"),
        tggReconcilePhysics(v("R_th"), v("R_th"), { min: 1.0, max: 50.0 }),
        tggComplement(["placementAnnotation", "vendorUuid"]),
      ],
    });

    const transformer = new PolyglotTransformer({
      languages: ["modelica", "sysml2"],
      typeMaps: {
        sysml2: {
          ThermalResistor: "HeatTransferElement",
        },
      },
      rules: [customRule],
    });

    const sourceGraph: PolyglotNode = {
      kind: "ModelContainer",
      name: "CoolingLoop",
      children: [
        {
          kind: "ThermalComponent",
          name: "heatsink_1",
          moType: "ThermalResistor",
          resistance: 10,
          placementAnnotation: "Placement(transformation(extent={{-10,-10},{10,10}}))",
          vendorUuid: "uuid-9941-ab",
          properties: {},
        },
      ],
    };

    const projected = transformer.projectGraph(sourceGraph, "modelica", "sysml2");
    const tgtChild = (projected["children"] as PolyglotNode[])[0]!;
    assert.equal(tgtChild.kind, "PartUsage");
    assert.equal(tgtChild.name, "heatsink_1");
    assert.equal(tgtChild["sysmlType"], "HeatTransferElement");
    assert.equal(tgtChild["R_thermal"], 10);
    assert.equal(tgtChild["G_thermal"], 10);
    assert.equal(tgtChild["status"], "verified");

    // Rename element and edit R_thermal in target graph; verify physics-simplex reconciliation and shadow complement recovery
    const editedTarget: PolyglotNode = {
      ...projected,
      children: [
        {
          ...tgtChild,
          name: "heatsink_renamed",
          R_thermal: 30,
          properties: {
            ...tgtChild.properties,
            name: "heatsink_renamed",
            R_thermal: 30,
          },
        },
      ],
    };

    const syncRes = transformer.synchronizeGraph(sourceGraph, editedTarget, "modelica", "sysml2", "physics-simplex");
    const recChild = (syncRes.reconciledSource["children"] as PolyglotNode[])[0]!;
    assert.equal(recChild.kind, "ThermalComponent");
    assert.equal(recChild.name, "heatsink_renamed");
    assert.equal(recChild["moType"], "ThermalResistor");
    // Midpoint of 10 and 30 within [1.0, 50.0] is 20
    assert.equal(recChild["resistance"], 20);
    // Shadow complement preserved across rename via positional fallback!
    assert.equal(recChild["placementAnnotation"], "Placement(transformation(extent={{-10,-10},{10,10}}))");
    assert.equal(recChild["vendorUuid"], "uuid-9941-ab");
    assert.equal(syncRes.changes.length, 1);
  });
});
