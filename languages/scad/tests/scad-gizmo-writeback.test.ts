// SPDX-License-Identifier: AGPL-3.0-or-later

import { ParameterInversionEngine, type SafeRegionGuard } from "@modelscript/cad";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { ScadEvaluator } from "../src/evaluator.js";
import { ScadPatcher } from "../src/patcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

async function runGizmoWritebackTest() {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const initialSource = `// Parametric Drone Arm
arm_length = 150.0; // Span in mm
width = 20.0;

// Base Mount
cube([arm_length, width, 8.0])
  .translate([10.0, 0.0, 0.0]);
`;

  // 1. Parse and evaluate to verify sourceMetadata tagging
  const tree1 = parser.parse(initialSource);
  assert.ok(tree1 && tree1.rootNode, "Must parse initial SCAD document");

  const evaluator = new ScadEvaluator();
  const solid1 = evaluator.evaluate(tree1.rootNode);
  assert.ok(solid1, "Must evaluate solid tree");

  // Verify solid has sourceMetadata attached
  assert.ok(solid1.sourceMetadata, "Solid must carry sourceMetadata");
  assert.strictEqual(solid1.sourceMetadata.transformMethod, "translate");

  // 2. Simulate 3D Viewport Gizmo Drag along X axis: delta = +50 mm (arm_length: 150 -> 200)
  const metaParam = "arm_length";
  const newParamValue = 200.0;

  const patchVarRes = ScadPatcher.patchVariable(initialSource, tree1.rootNode, metaParam, newParamValue);
  assert.ok(patchVarRes, "Must successfully patch arm_length variable");
  assert.strictEqual(patchVarRes.oldValue, "150.0");
  assert.strictEqual(patchVarRes.newValue, "200");
  assert.ok(
    patchVarRes.updatedSource.includes("arm_length = 200; // Span in mm"),
    "Inline comment and formatting must be preserved",
  );

  // 3. Simulate Viewport Transform Gizmo Drag: translate by delta [15, 5, 0] -> new pos [25, 5, 0]
  const tree2 = parser.parse(patchVarRes.updatedSource);
  const patchVecRes = ScadPatcher.patchTransformArgument(
    patchVarRes.updatedSource,
    tree2.rootNode,
    "translate",
    0,
    [25.0, 5.0, 0.0],
  );
  assert.ok(patchVecRes, "Must successfully patch translate vector");
  assert.ok(patchVecRes.updatedSource.includes(".translate([25, 5, 0]);"));

  // 4. Test Single Component Vector Patch (e.g. dragging only Y axis)
  const tree3 = parser.parse(patchVecRes.updatedSource);
  const patchCompRes = ScadPatcher.patchVectorComponent(
    patchVecRes.updatedSource,
    tree3.rootNode,
    "translate",
    0,
    1, // Y component
    12.5,
  );
  assert.ok(patchCompRes, "Must successfully patch single Y component of vector");
  assert.ok(patchCompRes.updatedSource.includes(".translate([25, 12.5, 0]);"));

  // 5. Test Parameter Inversion Engine Safe Region Guard during gizmo commit
  const guard: SafeRegionGuard = {
    parameterBounds: {
      arm_length: { min: 50.0, max: 250.0 },
    },
    constraints: [
      {
        name: "MaxAspectRatio",
        evaluate: (params) => (params.arm_length || 150) / 20.0 <= 12.0, // length / width <= 12
        description: "Arm length exceeds aerodynamic stiffness ratio.",
      },
    ],
  };

  // Safe update: arm_length = 220 -> 220/20 = 11 <= 12 (Safe)
  const safeRes = ParameterInversionEngine.patchMcadSourceCertified(initialSource, { arm_length: 220.0 }, guard);
  assert.strictEqual(safeRes.isSuccess, true);
  assert.strictEqual(safeRes.isCertifiedSafe, true);
  assert.ok(safeRes.updatedSource.includes("arm_length = 220;"));

  // Unsafe update: arm_length = 300 -> exceeds max bound 250 & aspect ratio (Rejected)
  const unsafeRes = ParameterInversionEngine.patchMcadSourceCertified(initialSource, { arm_length: 300.0 }, guard);
  assert.strictEqual(unsafeRes.isSuccess, false);
  assert.strictEqual(unsafeRes.isCertifiedSafe, false);
  assert.strictEqual(unsafeRes.violations.length, 2);
  assert.strictEqual(unsafeRes.updatedSource, initialSource); // Untouched!

  // 6. Multi-Solid Byte-Range Targeted Gizmo Patching (ensuring 2nd translate is patched, not 1st)
  const multiSolidScad = `
translate([10, 20, 30]) cube([15, 15, 15], center = true);
translate([100, 200, 300]) rotate([0, 45, 0]) color("steelblue") cylinder(h = 20, r1 = 8, r2 = 4, center = true);
cube([12, 12, 12]);
`;
  const { extractScadCadComponents } = await import("../src/index.js");
  const multiTree = parser.parse(multiSolidScad);
  const comps = await extractScadCadComponents(multiSolidScad, multiTree.rootNode, "file:///test.scad");
  assert.strictEqual(comps.length, 3, "Must extract 3 selectable CAD components");

  // Verify 2nd component has steelblue color and exact translateRange / rotateRange
  const secondComp = comps[1];
  assert.deepEqual(secondComp.cad.position, [100, 200, 300]);
  assert.ok(secondComp.proceduralMesh.color, "Second component must carry color('steelblue')");
  assert.ok(secondComp.sourceMetadata?.translateRange, "Second component must carry translateRange");
  assert.ok(secondComp.sourceMetadata?.rotateRange, "Second component must carry rotateRange");

  // Patch the 2nd component's translate via patchOrInsertTransform -> must NOT modify the 1st translate([10, 20, 30])!
  const patchSecondTranslate = ScadPatcher.patchOrInsertTransform(
    multiSolidScad,
    multiTree.rootNode,
    "translate",
    [125, 210, 305],
    secondComp.sourceMetadata,
  );
  assert.ok(patchSecondTranslate, "Must patch second solid's translate");
  assert.ok(
    patchSecondTranslate.updatedSource.includes("translate([10, 20, 30])"),
    "First solid's translate([10, 20, 30]) must remain untouched!",
  );
  assert.ok(
    patchSecondTranslate.updatedSource.includes("translate([125, 210, 305])"),
    "Second solid's translate must be updated to [125, 210, 305]",
  );

  // Patch the 2nd component's rotate via patchOrInsertTransform
  const patchSecondRotate = ScadPatcher.patchOrInsertTransform(
    multiSolidScad,
    multiTree.rootNode,
    "rotate",
    [15, 60, 0],
    secondComp.sourceMetadata,
  );
  assert.ok(patchSecondRotate, "Must patch second solid's rotate");
  assert.ok(
    patchSecondRotate.updatedSource.includes("rotate([15, 60, 0])"),
    "Second solid's rotate must be updated to [15, 60, 0]",
  );

  // 7. Dragging gizmo on 3rd component (untransformed bare primitive `cube([12, 12, 12])`) wraps it with translate
  const thirdComp = comps[2];
  const wrapThirdRes = ScadPatcher.patchOrInsertTransform(
    multiSolidScad,
    multiTree.rootNode,
    "translate",
    [50, 0, -10],
    thirdComp.sourceMetadata,
  );
  assert.ok(wrapThirdRes, "Must wrap untransformed primitive with translate");
  assert.ok(
    wrapThirdRes.updatedSource.includes("translate([50, 0, -10]) cube([12, 12, 12]);"),
    "Bare cube primitive must be wrapped with translate([50, 0, -10])",
  );

  console.log("✔ All Viewport Gizmo Writeback & Safe Guard tests passed cleanly!");
}

runGizmoWritebackTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
