// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { assembly, part } from "../src/assembly.js";
import { box, cylinder } from "../src/primitives.js";
import { translate } from "../src/transforms.js";
import {
  compileAssemblyToUsd,
  compileAssemblyToUsdz,
  compileToUsd,
  compileToUsdz,
  createUsdzArchive,
} from "../src/usd-compiler.js";

test("OpenUSD (.usda) & USDZ Archiver Compiler (@modelscript/cad)", async (t) => {
  await t.test("compileToUsd: compiles a Solid into valid ASCII OpenUSD", () => {
    const b = box([10, 20, 30]);
    const usda = compileToUsd(b, { stageName: "MyBox", upAxis: "Z", metersPerUnit: 0.001 });

    assert.ok(usda.startsWith("#usda 1.0"), "Should start with #usda 1.0 header");
    assert.ok(usda.includes('defaultPrim = "MyBox"'), "Should declare defaultPrim");
    assert.ok(usda.includes('upAxis = "Z"'), "Should declare upAxis Z");
    assert.ok(usda.includes("metersPerUnit = 0.001"), "Should declare metersPerUnit");
    assert.ok(usda.includes('def Xform "MyBox"'), "Should create root Xform");
    assert.ok(usda.includes('def Mesh "geometry"'), "Should create Mesh prim");
    assert.ok(usda.includes("int[] faceVertexCounts = [3,"), "Should contain triangulated faceVertexCounts");
    assert.ok(usda.includes("int[] faceVertexIndices = ["), "Should contain faceVertexIndices");
    assert.ok(usda.includes("point3f[] points = ["), "Should contain points");
    assert.ok(usda.includes("normal3f[] normals = ["), "Should contain normals");
    assert.ok(usda.includes('uniform token subdivisionScheme = "none"'), "Should declare subdivisionScheme none");
  });

  await t.test("compileAssemblyToUsd: compiles an Assembly hierarchy with transforms and colors", () => {
    const b = box({ width: 10, height: 10, depth: 10, name: "BaseCube" });
    const c = cylinder({ radius: 5, height: 20, name: "TopCylinder" });
    const transformedC = translate(c, [0, 0, 15]);

    const asm = assembly("RoboticBase", [
      part(b, { color: [1.0, 0.0, 0.0] }),
      part(transformedC, { color: [0.0, 0.0, 1.0] }),
    ]);

    const usda = compileAssemblyToUsd(asm, { stageName: "RoboticBase" });

    assert.ok(usda.includes('defaultPrim = "RoboticBase"'));
    assert.ok(usda.includes('def Xform "RoboticBase" (\n    kind = "assembly"\n)'));
    assert.ok(usda.includes('def Xform "BaseCube"'));
    assert.ok(usda.includes('def Xform "TopCylinder"'));
    assert.ok(usda.includes("matrix4d xformOp:transform = ("));
    assert.ok(usda.includes("color3f[] primvars:displayColor = [(1.0, 0.0, 0.0)]"));
    assert.ok(usda.includes("color3f[] primvars:displayColor = [(0.0, 0.0, 1.0)]"));
  });

  await t.test("createUsdzArchive: enforces 64-byte payload alignment compliant with AOUSD USDZ spec", () => {
    const files = {
      "model.usda": '#usda 1.0\ndef Xform "Test" {}\n',
      "materials/texture.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      "readme.txt": "ModelScript USDZ Test Archive",
    };

    const zipBuffer = createUsdzArchive(files);
    assert.ok(zipBuffer.length > 0, "Zip buffer must not be empty");

    // Inspect local file headers and assert 64-byte alignment
    const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength);
    let offset = 0;
    let fileCount = 0;

    while (offset < zipBuffer.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) {
        // Reached central directory
        break;
      }

      const fileNameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const compSize = view.getUint32(offset + 18, true);

      const payloadOffset = offset + 30 + fileNameLen + extraLen;

      // AOUSD / Apple QuickLook requirement: payload must be aligned to 64 bytes!
      assert.strictEqual(
        payloadOffset % 64,
        0,
        `File payload #${fileCount} at offset ${payloadOffset} MUST be a multiple of 64`,
      );

      offset = payloadOffset + compSize;
      fileCount++;
    }

    assert.strictEqual(fileCount, 3, "All 3 files must be serialized with 64-byte alignment");

    // Check central directory signature
    const cdSig = view.getUint32(offset, true);
    assert.strictEqual(cdSig, 0x02014b50, "Should encounter Central Directory signature");
  });

  await t.test("compileToUsdz & compileAssemblyToUsdz: generate ready-to-stream USDZ buffers", () => {
    const b = box([10, 10, 10]);
    const usdzSolid = compileToUsdz(b, { stageName: "CubeModel" });
    assert.ok(usdzSolid instanceof Uint8Array);
    assert.ok(usdzSolid.length > 100);

    const asm = assembly("AssemblyModel", [part(b)]);
    const usdzAsm = compileAssemblyToUsdz(asm, { stageName: "AssemblyModel" });
    assert.ok(usdzAsm instanceof Uint8Array);
    assert.ok(usdzAsm.length > 100);
  });
});
