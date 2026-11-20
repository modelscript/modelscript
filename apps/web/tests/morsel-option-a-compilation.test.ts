// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileStepFromSources } from "@modelscript/lsp/handlers/cadStepCompiler";
import stepLanguage from "@modelscript/step";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompileStepFromSourcesMorselParams,
  type StepMeshMorselResult,
} from "../../../packages/editor/src/workbench/util/lsp-bridge.js";
import {
  buildMorselEmbedHtmlPage,
  compressMorselPayload,
  decompressMorselPayload,
} from "../../../packages/editor/src/workbench/util/permalink.js";
import {
  buildMorselEffectiveFileMap,
  compileMorselOptionAAssembly,
  resolveSpoolRulesForMorsel,
  stepMeshesToCadComponents,
} from "../../../packages/editor/src/workbench/util/step-pairing.js";

const CROSS_FOLDER_SCAD = `// @qif_source: ../qa/inspection.qif
// @step_output: ../build/rotor.step
// @modelica_source: ../dynamics/turbine.mo
// @spool(part = "fan_lp_stage", spool = "n1", axis = [1, 0, 0])
// @spool(part = "hpc_core_drum", spool = "n2", axis = [1, 0, 0])

$fn = 16;

module fan_lp_stage() {
  translate([-1.2, 0, 0])
    tag_port("FanTipAcousticLiner", "aerodynamic_surface", [0, 1, 0])
      rotate([0, 90, 0])
        cylinder(h = 0.25, r = 0.9, center = true);
}

module hpc_core_drum() {
  translate([0.2, 0, 0])
    tag_port("MainShaft_Centerline", "datum_axis", [0, 0, 0])
      rotate([0, 90, 0])
        cylinder(h = 0.8, r = 0.35, center = true);
}

fan_lp_stage();
hpc_core_drum();
`;

const CROSS_FOLDER_QIF = `// @scad_source: ../cad/rotor.scad
// @step_output: ../build/rotor.step
// @modelica_source: ../dynamics/turbine.mo
QIF 3.0.0 qpId="a4e91c10-6b44-4d8a-9c21-100000000002"
FEATURE F_DATUM_B Cylinder "MainShaft_Centerline" size=0.35 points=8
DATUM B id=D2 feature=F_DATUM_B
FEATURE F_FAN_SHROUD Cylinder "FanTipAcousticLiner" size=1.80 points=10
CHARACTERISTIC C_FAN_RUNOUT TotalRunout "Fan Tip Shroud Runout" zone=0.040 material=RFS datums=[B] features=[F_FAN_SHROUD]
ACTUAL ACT1 characteristic=C_FAN_RUNOUT serial="TF2S-002" value=0.021 status=PASS
`;

const CROSS_FOLDER_MO = `model RotorDrive
  parameter Real n1_rpm = 7700.0;
  parameter Real n2_rpm = 7100.0;
  parameter Real T_04 = 1720.0;
equation
end RotorDrive;
`;

async function realGetStepMeshes(uri: string, documentText?: string): Promise<StepMeshMorselResult[]> {
  const handler = stepLanguage.lsp?.handlers?.["modelscript/getStepMeshes"];
  assert.ok(handler, "Expected modelscript/getStepMeshes request handler on stepLanguage");
  const res = await handler({} as any, { uri, ...(documentText !== undefined ? { documentText } : {}) });
  return Array.isArray(res) ? (res as StepMeshMorselResult[]) : [];
}

describe("Morsel Option-A multi-file STEP compilation & kinematics pairing", () => {
  it("normalizes project files and overlays active editor content into effective file map", () => {
    const { files, activePath } = buildMorselEffectiveFileMap(
      {
        "cad/../cad/part.scad": "cube(1);",
        "./qa/plan.qif": "QIF 3.0.0",
      },
      "cad/../cad/part.scad",
      "file:///cad/part.scad",
      "scad",
      "cube(2);",
    );

    assert.strictEqual(activePath, "cad/part.scad");
    assert.strictEqual(files["cad/part.scad"], "cube(2);");
    assert.strictEqual(files["qa/plan.qif"], "QIF 3.0.0");

    const fallback = buildMorselEffectiveFileMap(
      undefined,
      undefined,
      "file:///nested/Rotor.step",
      "step",
      "ISO-10303-21;",
    );
    assert.strictEqual(fallback.activePath, "nested/Rotor.step");
    assert.strictEqual(fallback.files["nested/Rotor.step"], "ISO-10303-21;");
  });

  it("scales @spool angular rates from Modelica n1_rpm / n2_rpm telemetry", () => {
    const rules = resolveSpoolRulesForMorsel(CROSS_FOLDER_SCAD, undefined, { n1Rpm: 7700, n2Rpm: 7100 });

    assert.strictEqual(rules.length, 2);
    const n1 = rules.find((r) => r.match === "fan_lp_stage");
    const n2 = rules.find((r) => r.match === "hpc_core_drum");
    assert.ok(n1 && n2);
    assert.strictEqual(n1.axisIndex, 0);
    assert.strictEqual(n2.axisIndex, 0);
    // 7700 / 3850 = 2.0 -> 65 * 2 = 130 deg/s; 7100 / 14200 = 0.5 -> -140 * 0.5 = -70 deg/s
    assert.ok(Math.abs(n1.degPerSec - 130) < 1e-6, `Expected n1 degPerSec ~130, got ${n1.degPerSec}`);
    assert.ok(Math.abs(n2.degPerSec - -70) < 1e-6, `Expected n2 degPerSec ~-70, got ${n2.degPerSec}`);
  });

  it("converts typed-array STEP meshes into CadComponents and filters degenerate entries", () => {
    const components = stepMeshesToCadComponents([
      {
        id: 1,
        name: "rotor_hub",
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
      },
      {
        id: 2,
        name: "empty_part",
        vertices: [],
        normals: [],
        indices: [],
      },
    ]);

    assert.strictEqual(components.length, 1);
    assert.strictEqual(components[0]?.name, "rotor_hub");
    assert.strictEqual(components[0]?.cad.uri, "step://compiled/rotor_hub");
    assert.deepStrictEqual(components[0]?.proceduralMesh?.indices, [0, 1, 2]);
  });

  it("compiles cross-folder SCAD + QIF + MO -> STEP with cache-hit loop prevention and provenance recovery", async () => {
    let compileCalls = 0;
    const files: Record<string, string> = {
      "cad/rotor.scad": CROSS_FOLDER_SCAD,
      "qa/inspection.qif": CROSS_FOLDER_QIF,
      "dynamics/turbine.mo": CROSS_FOLDER_MO,
    };

    const runCompile = async (params: CompileStepFromSourcesMorselParams) => {
      compileCalls++;
      return compileStepFromSources(params as any);
    };

    // 1. Trigger from QIF tab across folders
    const outcome1 = await compileMorselOptionAAssembly({
      files,
      activePath: "qa/inspection.qif",
      dialect: "qif",
      documentUri: "file:///qa/inspection.qif",
      isStepText: false,
      cachedCompilation: null,
      compileStepFromSources: runCompile,
      getStepMeshes: realGetStepMeshes,
    });

    assert.ok(outcome1, "Expected Option-A outcome from cross-folder QIF/SCAD/MO project");
    assert.strictEqual(compileCalls, 1);
    assert.strictEqual(outcome1.stepPath, "build/rotor.step");
    assert.strictEqual(outcome1.updatedStepArtifact, true);
    assert.ok(outcome1.stepText?.includes("ISO-10303-21;"));
    assert.ok(outcome1.stepText?.includes("@modelscript-meta"));
    assert.ok(outcome1.components.length > 0, "Expected tessellated STEP components");
    assert.strictEqual(outcome1.gdtOverlay?.datums.map((d) => d.label).join(","), "B");
    assert.strictEqual(outcome1.gdtOverlay?.callouts.length, 1);
    assert.strictEqual(outcome1.gdtOverlay?.callouts[0]?.status, "PASS");
    assert.strictEqual(outcome1.telemetry.n1Rpm, 7700);
    assert.strictEqual(outcome1.telemetry.n2Rpm, 7100);
    assert.strictEqual(outcome1.spools.length, 2);

    // 2. Write compiled .step back to workspace files and re-run with cachedCompilation -> must NOT recompile
    files[outcome1.stepPath] = outcome1.stepText!;
    const outcome2 = await compileMorselOptionAAssembly({
      files,
      activePath: "qa/inspection.qif",
      dialect: "qif",
      documentUri: "file:///qa/inspection.qif",
      isStepText: false,
      cachedCompilation: outcome1.cachedCompilation,
      compileStepFromSources: runCompile,
      getStepMeshes: realGetStepMeshes,
    });

    assert.ok(outcome2);
    assert.strictEqual(compileCalls, 1, "Cache hit after .step writeback must avoid redundant compilation loop");
    assert.strictEqual(outcome2.updatedStepArtifact, false);
    assert.strictEqual(outcome2.components.length, outcome1.components.length);

    // 3. View generated STEP file directly even in isolation -> provenance recovers spools & GD&T overlay
    const stepOnlyOutcome = await compileMorselOptionAAssembly({
      files: { "build/rotor.step": outcome1.stepText! },
      activePath: "build/rotor.step",
      dialect: "step",
      documentUri: "file:///build/rotor.step",
      isStepText: true,
      cachedCompilation: null,
      compileStepFromSources: runCompile,
      getStepMeshes: realGetStepMeshes,
    });

    assert.ok(stepOnlyOutcome);
    assert.strictEqual(compileCalls, 1, "Direct STEP view must not invoke source compiler");
    assert.strictEqual(stepOnlyOutcome.spools.length, 2);
    assert.strictEqual(stepOnlyOutcome.gdtOverlay?.callouts.length, 1);
    assert.ok(stepOnlyOutcome.components.length > 0);
  });

  it("preserves multi-file project maps through HTML iframe embed export and permalink round-trip", () => {
    const projectFiles = {
      "cad/rotor.scad": CROSS_FOLDER_SCAD,
      "qa/inspection.qif": CROSS_FOLDER_QIF,
      "dynamics/turbine.mo": CROSS_FOLDER_MO,
    };
    const token = compressMorselPayload({
      v: 1,
      lang: "scad",
      code: CROSS_FOLDER_SCAD,
      files: projectFiles,
      activeFile: "cad/rotor.scad",
      isMultiFile: true,
      title: 'Turbofan <"Rig"> & Assembly',
      view: "3d",
    });
    const embedSrc = `https://modelscript.org/embed/morsel#m=${token}`;
    const html = buildMorselEmbedHtmlPage({
      embedSrc,
      title: 'Turbofan <"Rig"> & Assembly',
    });

    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>Turbofan Rig  Assembly — ModelScript Embed</title>"));
    assert.ok(html.includes(`src="${embedSrc}"`));

    const hashMatch = /#m=([^"&]+)/.exec(html);
    assert.ok(hashMatch && hashMatch[1], "Expected compressed #m= hash inside iframe src");

    const decoded = decompressMorselPayload(`#m=${hashMatch[1]}`);
    assert.ok(decoded, "Expected decoded payload from HTML iframe src");
    assert.strictEqual(decoded.lang, "scad");
    assert.strictEqual(decoded.activeFile, "cad/rotor.scad");
    assert.strictEqual(decoded.isMultiFile, true);
    assert.strictEqual(decoded.view, "3d");
    assert.deepStrictEqual(decoded.files, projectFiles);
    assert.strictEqual(decoded.code, CROSS_FOLDER_SCAD);
  });
});
