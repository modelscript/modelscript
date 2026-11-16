// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOY_MATERIAL_PRESETS,
  GDT_CHAR_SYMBOLS,
  ManifoldWorker,
  SECTION_CAP_FRAGMENT_SHADER,
  SECTION_CAP_VERTEX_SHADER,
  STUDIO_GRID_FRAGMENT_SHADER,
  STUDIO_GRID_VERTEX_SHADER,
  STUDIO_SOFTBOX_LOBES,
  assembly,
  box,
  classifyAlloyPreset,
  compileAssemblyToStep,
  computeMeshVolumeAndArea,
  cylinder,
  evaluateStudioDomeColor,
  extractStepGdtOverlay,
  formatFeatureControlFrameText,
  formatMaterialModifierGlyph,
  part,
  sliceSectionContoursAtPlane,
  subtract,
  synthesizeBrushedAlloyTextures,
} from "../src/index.js";

describe("Studio PBR & GD&T Overlay Shared Primitives", () => {
  it("synthesizes brushed alloy normal, roughness, AO, and iridescence textures with expected dimensions", () => {
    const tex = synthesizeBrushedAlloyTextures(64);
    assert.strictEqual(tex.size, 64);
    assert.strictEqual(tex.normalRgba.length, 64 * 64 * 4);
    assert.strictEqual(tex.roughnessRgba.length, 64 * 64 * 4);
    assert.strictEqual(tex.aoWidth, 64);
    assert.strictEqual(tex.aoRgba.length, 64 * 4);
    assert.strictEqual(tex.iridescenceSize, 128);
    assert.strictEqual(tex.iridescenceRgba.length, 128 * 128 * 4);

    // Every normal texel must have valid opaque alpha and unit-length encoded tangent normal
    for (let i = 0; i < 64 * 64; i++) {
      const idx = i * 4;
      assert.strictEqual(tex.normalRgba[idx + 3], 255);
      const nx = (tex.normalRgba[idx]! / 255 - 0.5) * 2;
      const ny = (tex.normalRgba[idx + 1]! / 255 - 0.5) * 2;
      const nz = (tex.normalRgba[idx + 2]! / 255 - 0.5) * 2;
      const len = Math.hypot(nx, ny, nz);
      assert.ok(len > 0.85 && len < 1.15, `Normal texel ${i} should be roughly unit length, got ${len}`);
    }
  });

  it("evaluates 7-lobe aerospace softbox studio dome brightness cleanly over all view directions", () => {
    assert.strictEqual(STUDIO_SOFTBOX_LOBES.length, 7);
    const keyLobeDir = STUDIO_SOFTBOX_LOBES[0]!.pos;
    const len = Math.hypot(keyLobeDir[0], keyLobeDir[1], keyLobeDir[2]);
    const hot = evaluateStudioDomeColor(keyLobeDir[0] / len, keyLobeDir[1] / len, keyLobeDir[2] / len);
    const floor = evaluateStudioDomeColor(0, -1, 0);

    assert.ok(
      hot[0] > 0.1 && hot[1] > 0.1 && hot[2] > 0.1,
      "Key lobe direction should produce bright specular response",
    );
    assert.ok(hot[0] > floor[0] * 3, "Overhead softbox should strongly outshine dark studio nadir");
    assert.ok(Number.isFinite(floor[0]) && Number.isFinite(floor[1]) && Number.isFinite(floor[2]));
  });

  it("classifies CAD components into matching physical aerospace alloy presets", () => {
    assert.strictEqual(classifyAlloyPreset("intake_nacelle"), "al-li-nacelle");
    assert.strictEqual(classifyAlloyPreset("fan_lp_stage"), "titanium-fan");
    assert.strictEqual(classifyAlloyPreset("combustor_liner"), "combustor-liner");
    assert.strictEqual(classifyAlloyPreset("lpt_nozzle_stage"), "nickel-superalloy");
    assert.strictEqual(classifyAlloyPreset("hpc_core_drum"), "compressor-blade");
    assert.strictEqual(classifyAlloyPreset("main_shaft_drum"), "rotor-drum");
    assert.strictEqual(classifyAlloyPreset("unknown_bracket"), "default-machined");
    assert.ok(ALLOY_MATERIAL_PRESETS["combustor-liner"].iridescence! > 0.2);
    assert.ok(ALLOY_MATERIAL_PRESETS["combustor-liner"].emissiveIntensity! > 0.3);
  });

  it("formats ASME Y14.5 Feature Control Frames with geometric symbols, material modifiers, and datums", () => {
    assert.strictEqual(formatMaterialModifierGlyph("MMC"), "Ⓜ");
    assert.strictEqual(formatMaterialModifierGlyph("LMC"), "Ⓛ");
    assert.strictEqual(formatMaterialModifierGlyph("RFS"), "");

    const fcf = formatFeatureControlFrameText({
      id: "C_SHAFT_POS",
      label: "HP/LP Journal Coaxiality",
      characteristic: "position",
      symbol: GDT_CHAR_SYMBOLS.position,
      diametrical: true,
      tolerance: 0.025,
      unit: "mm",
      materialCondition: "MMC",
      datums: [{ label: "A" }, { label: "B" }, { label: "C" }],
      anchor: [-0.3, 0.56, 0.08],
    });
    assert.strictEqual(fcf, "[⌖ | ⌀0.025 Ⓜ | A | B | C]");
  });

  it("extracts DATUM_FEATURE and tolerance PMI callouts from STEP AP242 text", () => {
    const sampleStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Test'),'2;1');
FILE_NAME('t.step','2026-01-01T00:00:00Z',('A'),('B'),'C','D','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#16=PRODUCT_DEFINITION_SHAPE('','',#15);
#20=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#61=DIRECTION('PX',(1.0,0.0,0.0));
#63=DIRECTION('PY',(0.0,1.0,0.0));
#70=CARTESIAN_POINT('C_FanTip',(-1.92,1.48,0.20));
#71=CARTESIAN_POINT('C_ShaftPos',(-0.30,0.56,0.08));
#80=AXIS2_PLACEMENT_3D('FanTipFrame',#70,#61,#63);
#81=AXIS2_PLACEMENT_3D('ShaftPosFrame',#71,#61,#63);
#90=DATUM_FEATURE('A',#80);
#91=DATUM_FEATURE('B',#81);
#95=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.025),#20);
#96=POSITION_TOLERANCE('HP_Shaft_Coaxiality','Positional tolerance rel A|B',#95,#16,(#90,#91));
ENDSEC;
END-ISO-10303-21;`;

    const overlay = extractStepGdtOverlay(sampleStep);
    assert.strictEqual(overlay.datums.length, 2);
    assert.deepStrictEqual(
      overlay.datums.map((d) => d.label),
      ["A", "B"],
    );
    assert.strictEqual(overlay.callouts.length, 1);
    assert.strictEqual(overlay.callouts[0]!.characteristic, "position");
    assert.strictEqual(overlay.callouts[0]!.tolerance, 0.025);
    assert.deepStrictEqual(
      overlay.callouts[0]!.datums.map((d) => d.label),
      ["A", "B"],
    );
  });

  it("exports valid GLSL uniforms and varyings for stencil section caps and studio grid", () => {
    for (const shader of [
      SECTION_CAP_VERTEX_SHADER,
      SECTION_CAP_FRAGMENT_SHADER,
      STUDIO_GRID_VERTEX_SHADER,
      STUDIO_GRID_FRAGMENT_SHADER,
    ]) {
      assert.ok(shader.includes("main()"), "Shader must define entry point main()");
    }
    assert.ok(SECTION_CAP_FRAGMENT_SHADER.includes("uniform vec3 uColor"));
    assert.ok(SECTION_CAP_FRAGMENT_SHADER.includes("uniform float uPitch"));
    assert.ok(SECTION_CAP_FRAGMENT_SHADER.includes("fwidth(h)"));
    assert.ok(STUDIO_GRID_FRAGMENT_SHADER.includes("uniform float uOpacity"));
    assert.ok(STUDIO_GRID_FRAGMENT_SHADER.includes("fwidth(q)"));
  });

  it("slices closed box triangle mesh against arbitrary section plane with sliceSectionContoursAtPlane", () => {
    const boxMesh = ManifoldWorker.evaluateSolid(box({ width: 2, height: 2, depth: 2, name: "unit_box" }));
    const segs = sliceSectionContoursAtPlane(boxMesh.vertices, boxMesh.indices, [1, 0, 0], 0);
    assert.ok(
      segs.length >= 24 && segs.length % 6 === 0,
      `Expected >=4 contour segments on X=0 cut, got ${segs.length / 6}`,
    );
    for (let i = 0; i < segs.length; i += 3) {
      assert.ok(Math.abs(segs[i]!) < 1e-6, `Expected sliced vertex X == 0, got ${segs[i]}`);
    }
  });

  it("evaluates coaxial CSG shroud ring subtraction via ManifoldWorker with analytical volume parity", () => {
    const outerRadius = 1.6;
    const innerRadius = 1.5;
    const length = 3.65;
    const segments = 24;
    const shroud = subtract(
      cylinder({ radius: outerRadius, height: length, segments, name: "nacelle_outer" }),
      cylinder({ radius: innerRadius, height: length + 0.06, segments, name: "nacelle_inner" }),
    );
    const mesh = ManifoldWorker.evaluateSolid(shroud);
    assert.ok(mesh.vertices.length > 0 && mesh.indices.length > 0);
    const { volume } = computeMeshVolumeAndArea(mesh);
    const ngonFactor = (segments / 2) * Math.sin((2 * Math.PI) / segments);
    const expected = ngonFactor * (outerRadius * outerRadius - innerRadius * innerRadius) * length;
    const relErr = Math.abs(volume - expected) / expected;
    assert.ok(
      relErr < 0.01,
      `CSG hollow shroud ring volume ${volume.toFixed(4)} should match 24-gon annular analytical ${expected.toFixed(4)} within 1% (got ${(relErr * 100).toFixed(2)}%)`,
    );
  });

  it("compiles turbofan CAD assembly solids to valid ISO-10303-21 STEP text", () => {
    const fanHub = cylinder({ radius: 0.38, height: 0.4, segments: 24, name: "fan_lp_hub" });
    const liner = subtract(
      cylinder({ radius: 0.6, height: 0.68, segments: 24, name: "combustor_outer" }),
      cylinder({ radius: 0.42, height: 0.72, segments: 24, name: "combustor_inner" }),
    );
    const turbineAsm = assembly("TurbofanCore", [
      part(fanHub, { material: "Ti-6Al-4V" }),
      part(liner, { material: "Inconel718" }),
    ]);
    const stepText = compileAssemblyToStep(turbineAsm);
    assert.ok(stepText.includes("ISO-10303-21;"));
    assert.ok(stepText.includes("END-ISO-10303-21;"));
    assert.ok(stepText.includes("ADVANCED_BREP_SHAPE_REPRESENTATION"));
    assert.ok(stepText.includes("PRODUCT_DEFINITION('TurbofanCore_fan_lp_hub_0'"));
    assert.ok(stepText.includes("TurbofanCore_Subtract_combustor_outer_combustor_inner_1"));
  });
});
