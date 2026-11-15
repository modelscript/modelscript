// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintStepContent } from "@modelscript/step";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileStepFromSources, parseScadSpoolDirectives } from "../src/handlers/cadStepCompiler.js";
import { registerDiagramHandlers } from "../src/handlers/diagramHandler.js";

const SAMPLE_SCAD = `
$fn = 24;
// @spool(part = "fan_lp_stage", spool = "n1", axis = [1, 0, 0])
// @spool(part = "hpc_core_drum", spool = "n2", axis = [1, 0, 0])

module intake_nacelle() {
  difference() {
    rotate([0, 90, 0]) cylinder(h = 1.2, r = 1.60, center = true);
    rotate([0, 90, 0]) cylinder(h = 1.24, r = 1.50, center = true);
  }
  translate([-1.92, 0, 0])
    tag_port("FanTipAcousticLiner", type="optical_aperture", normal=[0, 1, 0])
      cylinder(h = 0.2, r = 1.48, center = true);
  translate([-2.55, 1.56, 0.0])
    tag_port("FanFrame_MountFace", type="mechanical_flange", normal=[-1, 0, 0])
      cube([0.04, 0.04, 0.04], center = true);
}

module fan_lp_stage() {
  translate([-1.85, 0, 0]) rotate([0, 90, 0]) cylinder(h = 0.4, r = 0.42, center = true);
  translate([-0.30, 0, 0])
    tag_port("MainShaft_Centerline", type="mechanical_flange", normal=[0, 1, 0])
      cylinder(h = 0.2, r = 0.24, center = true);
}

module hpc_core_drum() {
  translate([-0.10, 0, 0]) rotate([0, 90, 0]) cylinder(h = 0.9, r = 0.56, center = true);
  translate([1.95, 0, 0])
    tag_port("ClockingKeyway", type="mechanical_flange", normal=[0, 0, 1])
      cube([0.04, 0.04, 0.04], center = true);
}

intake_nacelle();
fan_lp_stage();
hpc_core_drum();
`;

const SAMPLE_QIF = `
QIF 3.0.0 qpId="a4e91c10-6b44-4d8a-9c21-100000000001"
FEATURE F_DATUM_A Plane "FanFrame_MountFace" points=6
FEATURE F_DATUM_B Cylinder "MainShaft_Centerline" size=0.24 points=8
FEATURE F_DATUM_C Circle "ClockingKeyway" size=0.04 points=4
DATUM A id=D1 feature=F_DATUM_A
DATUM B id=D2 feature=F_DATUM_B
DATUM C id=D3 feature=F_DATUM_C
FEATURE F_FAN_SHROUD Cylinder "FanTipAcousticLiner" size=2.96 points=12
CHARACTERISTIC C_FAN_RUNOUT TotalRunout "Fan Tip Shroud Runout" zone=0.035 material=RFS datums=[B, A] features=[F_FAN_SHROUD]
CHARACTERISTIC C_SHAFT_POS Position "HP/LP Journal Coaxiality" zone=0.025 material=MMC datums=[A, B, C] features=[F_DATUM_B]
ACTUAL ACT1 characteristic=C_FAN_RUNOUT serial="TF2S-001" value=0.019 status=PASS
ACTUAL ACT2 characteristic=C_SHAFT_POS serial="TF2S-001" value=0.012 status=PASS
`;

describe("LSP CAD+QIF -> AP242 STEP Compiler (cadStepCompiler)", () => {
  it("parses @spool directives with spool group and axis vectors", () => {
    const spools = parseScadSpoolDirectives(SAMPLE_SCAD);
    assert.deepStrictEqual(spools, [
      { part: "fan_lp_stage", spool: "n1", axis: [1, 0, 0] },
      { part: "hpc_core_drum", spool: "n2", axis: [1, 0, 0] },
    ]);
  });

  it("compiles SCAD + symbolic QIF into lint-clean ISO-10303-21 AP242 STEP and live GD&T overlay", () => {
    const result = compileStepFromSources({
      scadText: SAMPLE_SCAD,
      qifText: SAMPLE_QIF,
      assemblyName: "Turbofan2Spool",
    });

    assert.strictEqual(result.error, undefined);
    assert.ok(result.stepText.includes("ISO-10303-21"));
    assert.deepStrictEqual(lintStepContent(result.stepText), [], "Compiled AP242 STEP must produce 0 STEP diagnostics");
    assert.deepStrictEqual(result.partNames, ["intake_nacelle", "fan_lp_stage", "hpc_core_drum"]);
    assert.strictEqual(result.spools.length, 2);

    const anchorNames = new Set(result.featureAnchors.map((a) => a.name));
    assert.ok(anchorNames.has("FanTipAcousticLiner"));
    assert.ok(anchorNames.has("FanFrame_MountFace"));
    assert.ok(anchorNames.has("MainShaft_Centerline"));
    assert.ok(anchorNames.has("ClockingKeyway"));

    assert.deepStrictEqual(
      result.gdtOverlay.datums.map((d) => d.label),
      ["A", "B", "C"],
    );
    assert.strictEqual(result.gdtOverlay.callouts.length, 2);
    assert.strictEqual(result.gdtOverlay.callouts[0]?.status, "PASS");
    assert.strictEqual(result.gdtOverlay.callouts[0]?.measured, 0.019);

    // Editing QIF ACTUAL value past tolerance zone updates live overlay status immediately
    const qifOutOfSpec = SAMPLE_QIF.replace("value=0.019 status=PASS", "value=0.055 status=FAIL");
    const failedResult = compileStepFromSources({
      scadText: SAMPLE_SCAD,
      qifText: qifOutOfSpec,
      assemblyName: "Turbofan2Spool",
    });
    assert.strictEqual(failedResult.gdtOverlay.callouts[0]?.id, "C_FAN_RUNOUT");
    assert.strictEqual(failedResult.gdtOverlay.callouts[0]?.measured, 0.055);
    assert.strictEqual(failedResult.gdtOverlay.callouts[0]?.status, "FAIL");
  });

  it("registers modelscript/compileStepFromSources on diagramHandler", async () => {
    const handlers = new Map<string, (params: any) => Promise<any>>();
    const fakeContext = {
      connection: {
        onRequest(method: string, fn: (params: any) => Promise<any>) {
          handlers.set(method, fn);
        },
        console: { warn: () => {}, error: () => {} },
      },
    } as any;

    registerDiagramHandlers(fakeContext);
    const compileHandler = handlers.get("modelscript/compileStepFromSources");
    assert.strictEqual(typeof compileHandler, "function");

    const res = await compileHandler!({ scadText: SAMPLE_SCAD, qifText: SAMPLE_QIF });
    assert.strictEqual(res.error, undefined);
    assert.strictEqual(res.gdtOverlay.callouts.length, 2);
  });

  it("derives generic assembly name from scadUri stem or falls back to 'Assembly' instead of hardcoding", () => {
    const fromUri = compileStepFromSources({
      scadText: SAMPLE_SCAD,
      qifText: SAMPLE_QIF,
      scadUri: "file:///workspace/assemblies/actuator_housing.scad",
    });
    assert.strictEqual(fromUri.error, undefined);
    assert.ok(fromUri.stepText.includes("/* name */ 'actuator_housing.stp'"));
    assert.ok(!fromUri.stepText.includes("Turbofan2Spool"));

    const fallback = compileStepFromSources({
      scadText: SAMPLE_SCAD,
      qifText: SAMPLE_QIF,
    });
    assert.strictEqual(fallback.error, undefined);
    assert.ok(fallback.stepText.includes("/* name */ 'Assembly.stp'"));
    assert.ok(!fallback.stepText.includes("Turbofan2Spool"));
  });

  it("embeds cross-folder @modelscript-meta provenance in STEP HEADER; with 0 STEP diagnostics", async () => {
    const { parseStepProvenanceMeta } = await import("@modelscript/cad");
    const compiled = compileStepFromSources({
      scadText: SAMPLE_SCAD,
      qifText: SAMPLE_QIF,
      scadUri: "file:///workspace/cad/rotor.scad",
      qifUri: "file:///workspace/pmi/inspection.qif",
      stepUri: "file:///workspace/build/rotor.step",
      modelicaUri: "file:///workspace/sim/dynamics.mo",
    });
    assert.strictEqual(compiled.error, undefined);
    assert.deepStrictEqual(lintStepContent(compiled.stepText), []);
    const meta = parseStepProvenanceMeta(compiled.stepText);
    assert.ok(meta !== null);
    assert.strictEqual(meta.scadSource, "../cad/rotor.scad");
    assert.strictEqual(meta.qifSource, "../pmi/inspection.qif");
    assert.strictEqual(meta.modelicaSource, "../sim/dynamics.mo");
    assert.strictEqual(meta.assemblyName, "rotor");
    assert.strictEqual(meta.spools?.length, 2);
  });
});
