// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileAssemblyToAp242Step,
  cylinder,
  extractModelicaTelemetryParams,
  parseQifSourceDirectives,
  parseScadSourceDirectives,
  parseScadSpoolDirectives,
  parseStepProvenanceMeta,
  resolveStepPairingFromFileMap,
  type Assembly,
} from "../src/index.js";

describe("Self-Contained STEP Provenance & Cross-Folder Pairing", () => {
  it("parses SCAD spool directives, SCAD/QIF linking headers, and Modelica telemetry", () => {
    const scad = [
      "// @qif_source: ../pmi/turbine_pmi.qif",
      "// @step_output: ../build/turbine.step",
      "// @modelica_source: ../sim/turbofan.mo",
      '// @spool(part = "fan_stage", spool = "n1", axis = [1, 0, 0])',
      '// @spool(part = "hpt_stage", spool = "n2", axis = [1, 0, 0])',
      "cylinder(r = 10, h = 5);",
    ].join("\n");

    const qif = [
      "// @scad_source: ../cad/turbine.scad",
      "// @step_output: ../build/turbine.step",
      "<QIFDocument/>",
    ].join("\n");

    const mo = [
      "model Turbofan",
      "  parameter Real n1_rpm = 4120.5;",
      "  parameter Real n2_rpm = 15300;",
      "  parameter Real T_04 = 1710.2;",
      "  parameter Real cut_x = 0.25;",
      "end Turbofan;",
    ].join("\n");

    const spools = parseScadSpoolDirectives(scad);
    assert.strictEqual(spools.length, 2);
    assert.deepStrictEqual(spools[0], { part: "fan_stage", spool: "n1", axis: [1, 0, 0] });
    assert.deepStrictEqual(spools[1], { part: "hpt_stage", spool: "n2", axis: [1, 0, 0] });

    assert.deepStrictEqual(parseScadSourceDirectives(scad), {
      qifSource: "../pmi/turbine_pmi.qif",
      stepOutput: "../build/turbine.step",
      modelicaSource: "../sim/turbofan.mo",
    });

    assert.deepStrictEqual(parseQifSourceDirectives(qif), {
      scadSource: "../cad/turbine.scad",
      stepOutput: "../build/turbine.step",
    });

    assert.deepStrictEqual(extractModelicaTelemetryParams(mo), {
      n1Rpm: 4120.5,
      n2Rpm: 15300,
      t04K: 1710.2,
      cutX: 0.25,
    });
  });

  it("embeds and round-trips @modelscript-meta inside compiled AP242 STEP headers", () => {
    const asm: Assembly = {
      name: "TurbofanAssembly",
      parts: [{ name: "fan_stage", solid: cylinder({ radius: 0.45, height: 0.2 }) }],
    };

    const result = compileAssemblyToAp242Step(asm, {
      schema: "AP242",
      lengthUnit: "m",
      preservePartNames: true,
      timeStamp: "2026-11-15T12:00:00Z",
      provenance: {
        version: 1,
        generator: "modelscript-cad",
        scadSource: "../cad/turbine.scad",
        qifSource: "../pmi/turbine.qif",
        modelicaSource: "../sim/turbofan.mo",
        spools: [{ part: "fan_stage", spool: "n1", axis: [1, 0, 0] }],
      },
    });

    assert.ok(result.stepText.includes("/* @modelscript-meta "), "Compiled STEP must embed provenance block");
    assert.ok(
      result.stepText.indexOf("@modelscript-meta") < result.stepText.indexOf("DATA;"),
      "Provenance comment must live inside HEADER; before DATA;",
    );

    const parsed = parseStepProvenanceMeta(result.stepText);
    assert.ok(parsed !== null);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.assemblyName, "TurbofanAssembly");
    assert.strictEqual(parsed.scadSource, "../cad/turbine.scad");
    assert.strictEqual(parsed.qifSource, "../pmi/turbine.qif");
    assert.strictEqual(parsed.modelicaSource, "../sim/turbofan.mo");
    assert.strictEqual(parsed.compiledAt, "2026-11-15T12:00:00Z");
    assert.deepStrictEqual(parsed.spools, [{ part: "fan_stage", spool: "n1", axis: [1, 0, 0] }]);
  });

  it("resolves arbitrary cross-folder SCAD + QIF + Modelica + STEP tuples regardless of active file", () => {
    const asm: Assembly = {
      name: "RotorSpool",
      parts: [{ name: "fan_stage", solid: cylinder({ radius: 0.4, height: 0.2 }) }],
    };
    const { stepText } = compileAssemblyToAp242Step(asm, {
      schema: "AP242",
      provenance: {
        version: 1,
        generator: "modelscript-cad",
        scadSource: "../cad/rotor.scad",
        qifSource: "../pmi/inspection.qif",
        modelicaSource: "../sim/dynamics.mo",
        spools: [{ part: "fan_stage", spool: "n1", axis: [1, 0, 0] }],
      },
    });

    const workspace: Record<string, string> = {
      "cad/rotor.scad": '// @spool(part="fan_stage", spool="n1", axis=[1,0,0])\ncylinder(r=0.4, h=0.2);',
      "pmi/inspection.qif": "// @scad_source: ../cad/rotor.scad\n// @step_output: ../build/rotor.step\n<QIFDocument/>",
      "sim/dynamics.mo":
        "model Dynamics\n  parameter Real n1_rpm = 4500.0;\n  parameter Real n2_rpm = 16000.0;\nend Dynamics;",
      "build/rotor.step": stepText,
    };

    const fromQif = resolveStepPairingFromFileMap(workspace, "pmi/inspection.qif");
    assert.ok(fromQif);
    assert.strictEqual(fromQif.scadPath, "cad/rotor.scad");
    assert.strictEqual(fromQif.qifPath, "pmi/inspection.qif");
    assert.strictEqual(fromQif.stepPath, "build/rotor.step");
    assert.strictEqual(fromQif.modelicaPath, "sim/dynamics.mo");
    assert.strictEqual(fromQif.modelicaTelemetry.n1Rpm, 4500);

    const fromStep = resolveStepPairingFromFileMap(workspace, "build/rotor.step");
    assert.ok(fromStep);
    assert.strictEqual(fromStep.scadPath, "cad/rotor.scad");
    assert.strictEqual(fromStep.qifPath, "pmi/inspection.qif");
    assert.strictEqual(fromStep.modelicaPath, "sim/dynamics.mo");
    assert.strictEqual(fromStep.spools[0]?.part, "fan_stage");

    const fromMo = resolveStepPairingFromFileMap(workspace, "sim/dynamics.mo");
    assert.ok(fromMo);
    assert.strictEqual(fromMo.scadPath, "cad/rotor.scad");
    assert.strictEqual(fromMo.qifPath, "pmi/inspection.qif");
    assert.strictEqual(fromMo.modelicaPath, "sim/dynamics.mo");
    assert.strictEqual(fromMo.stepPath, "build/rotor.step");
  });
});
