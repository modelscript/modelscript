// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flattenCifLayout, lowerCifToCadAssembly } from "../src/cad/index.js";
import { cifToDae } from "../src/dae/index.js";
import { parseCif } from "../src/parser/index.js";

describe("CIF 2.0 CAD Geometry & DAE Parasitic Lowering", () => {
  it("flattens hierarchical calls with T, MX, MY, R transforms and computes exact layer areas & bboxes", () => {
    const doc = parseCif(`
      DS 1 100/1;
        L CMF;
        B 4 3 2 1;
      DF;
      C 1;
      C 1 MX T 1000 0;
      C 1 R 0 1 T 0 1000;
      E
    `);
    const layout = flattenCifLayout(doc);
    assert.strictEqual(layout.polygons.length, 3);
    // Each box is 400 x 300 = 120,000 CIF units² (12 µm²); 3 instances = 360,000 CIF units² (36 µm²)
    assert.ok(Math.abs((layout.layerAreas["CMF"] ?? 0) - 360_000) < 1e-6);
    assert.ok(Math.abs((layout.layerAreasUm2["CMF"] ?? 0) - 36) < 1e-6);
    assert.strictEqual(layout.drcViolations.length, 0);
    assert.ok(layout.bbox.maxX >= 1000);
    assert.ok(layout.bbox.maxY >= 1400);
  });

  it("flattens Polygon (P), Roundflash (R), and Wire (W) primitives accurately", () => {
    const doc = parseCif(`
      DS 1 100/1;
        L CAA;
        P 0 0 6 0 6 4 0 4;
        L CPG;
        R 4 10 10;
        L CMF;
        W 3 0 0 10 0 10 10;
      DF;
      C 1;
      E
    `);
    const layout = flattenCifLayout(doc);
    // CAA polygon: 6*4 = 24 µm²
    assert.ok(Math.abs((layout.layerAreasUm2["CAA"] ?? 0) - 24) < 1e-6);
    // CPG roundflash: diameter 4 µm => radius 2 µm => pi * 4 ≈ 12.566 µm² (64-gon within 0.2%)
    const expectedCircleArea = Math.PI * 4;
    const relErrCircle = Math.abs((layout.layerAreasUm2["CPG"] ?? 0) - expectedCircleArea) / expectedCircleArea;
    assert.ok(relErrCircle < 0.005, `Expected circle area relErr < 0.5%, got ${relErrCircle}`);
    // CMF wire: 2 segments of length 10 µm and width 3 µm => 60 µm²
    assert.ok(Math.abs((layout.layerAreasUm2["CMF"] ?? 0) - 60) < 1e-6);
  });

  it("lowers flattened CIF layout to 3D @modelscript/cad Assembly", () => {
    const doc = parseCif(`
      DS 1 100/1;
        L CWN;
        B 14 12 7 6;
        L CAA;
        B 6 4 7 6;
        L CPG;
        B 2 8 7 6;
        L CMF;
        B 10 3 7 6;
      DF;
      C 1;
      E
    `);
    const layout = flattenCifLayout(doc);
    const asm = lowerCifToCadAssembly(layout, "ScmosStack");
    assert.strictEqual(asm.name, "ScmosStack");
    assert.strictEqual(asm.parts.length, 4);
    assert.ok(asm.parts.some((p) => p.material === "CWN"));
    assert.ok(asm.parts.some((p) => p.material === "CMF"));
  });

  it("lowers CIF layout parasitics into @modelscript/runtime DAEBuilder", () => {
    const doc = parseCif(`
      DS 1 100/1;
        L CPG;
        B 20 2 10 1;
        L CMF;
        B 30 3 15 5;
      DF;
      C 1;
      E
    `);
    const daeRes = cifToDae(doc, { modelName: "InterconnectRC", vddVolts: 5.0 });
    assert.ok(daeRes.varCount >= 21, `Expected >= 21 DAE variables, got ${daeRes.varCount}`);
    assert.strictEqual(daeRes.eqCount, 8, "Expected 4 equations per layer × 2 layers = 8 equations");
    assert.ok(daeRes.totalCapacitanceFf > 0);
    assert.ok(daeRes.totalResistanceOhm > 0);
    assert.ok(daeRes.parasitics["CPG"]);
    assert.ok(daeRes.parasitics["CMF"]);
    assert.ok(daeRes.parasitics["CPG"].capacitanceFf > 0);
    assert.ok(daeRes.parasitics["CMF"].rcDelayPs > 0);
  });
});
