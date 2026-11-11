// SPDX-License-Identifier: AGPL-3.0-or-later

import { assembly, box, compileAssemblyToUsd, compileAssemblyToUsdz, cylinder, part } from "@modelscript/cad";
import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { lowerUsdToDae } from "../src/dae/index.js";
import { findUsdPrim } from "../src/indexing.js";
import { usdLanguage } from "../src/language.js";
import { lintUsdStage } from "../src/lints/index.js";
import { UsdLspService } from "../src/lsp.js";
import { parseUsd } from "../src/parser/index.js";

const VALID_ROBOT_STAGE = `#usda 1.0
(
    defaultPrim = "IndustrialArm"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "IndustrialArm" (
    kind = "assembly"
)
{
    def Xform "base_link" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 10.0
        float3 physics:diagonalInertia = (1.0, 1.0, 0.5)

        def Cube "visual_base"
        {
            double size = 1.0
            double3 xformOp:scale = (0.2, 0.2, 0.5)
            uniform token[] xformOpOrder = ["xformOp:scale"]
        }
    }

    def Xform "link_1" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 4.0
        float3 physics:diagonalInertia = (0.4, 0.4, 0.1)

        double3 xformOp:translate.timeSamples = {
            0.0: (0.0, 0.0, 0.5),
            1.0: (0.1, 0.0, 0.6),
        }
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def PhysicsRevoluteJoint "j1"
    {
        rel physics:body0 = </IndustrialArm/base_link>
        rel physics:body1 = </IndustrialArm/link_1>
        uniform token physics:axis = "Z"
        float physics:lowerLimit = -3.14
        float physics:upperLimit = 3.14
    }
}
`;

test("OpenUSD Stage Parser & UsdPhysics Engine (@modelscript/usd)", async (t) => {
  await t.test("parseUsd: parses stage metadata, prim hierarchies, attributes, and relationships", () => {
    const stage = parseUsd(VALID_ROBOT_STAGE);

    assert.equal(stage.metadata.defaultPrim, "IndustrialArm");
    assert.equal(stage.metadata.metersPerUnit, 1.0);
    assert.equal(stage.metadata.upAxis, "Z");

    assert.ok(stage.prims.has("/IndustrialArm"));
    assert.ok(stage.prims.has("/IndustrialArm/base_link"));
    assert.ok(stage.prims.has("/IndustrialArm/link_1"));
    assert.ok(stage.prims.has("/IndustrialArm/j1"));

    const baseLink = stage.prims.get("/IndustrialArm/base_link")!;
    assert.equal(baseLink.name, "base_link");
    assert.ok(baseLink.apiSchemas.includes("PhysicsRigidBodyAPI"));
    assert.equal(baseLink.attributes.get("physics:mass")?.value, 10.0);

    const link1 = stage.prims.get("/IndustrialArm/link_1")!;
    const transAttr = link1.attributes.get("xformOp:translate");
    assert.ok(transAttr?.timeSamples);
    assert.equal(transAttr.timeSamples.size, 2);

    const joint = stage.prims.get("/IndustrialArm/j1")!;
    assert.equal(joint.typeName, "PhysicsRevoluteJoint");
    assert.equal(joint.relationships.get("physics:body0")?.targets[0], "/IndustrialArm/base_link");
    assert.equal(joint.relationships.get("physics:body1")?.targets[0], "/IndustrialArm/link_1");
  });

  await t.test("lintUsdStage: semantic validation rules (USD1002, USD1004, USD1006)", () => {
    const validStage = parseUsd(VALID_ROBOT_STAGE);
    const cleanDiags = lintUsdStage(validStage);
    assert.equal(cleanDiags.length, 0, "Valid stage must have zero diagnostics");

    const invalidUsd = `#usda 1.0
def Xform "BadRobot" {
    def Xform "link" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
        float physics:mass = -5.0
    }
    def PhysicsRevoluteJoint "j_bad" {
        rel physics:body0 = </BadRobot/link>
        rel physics:body1 = </BadRobot/non_existent_target>
        uniform token physics:axis = "W"
        float physics:lowerLimit = 10.0
        float physics:upperLimit = 2.0
    }
}
`;
    const badStage = parseUsd(invalidUsd);
    const diags = lintUsdStage(badStage);

    assert.ok(
      diags.some((d) => d.code === "USD1004"),
      "Must detect negative mass",
    );
    assert.ok(
      diags.some((d) => d.code === "USD1002"),
      "Must detect dangling relationship target",
    );
    assert.ok(
      diags.some((d) => d.code === "USD1006"),
      "Must detect inverted joint limits",
    );
    assert.ok(
      diags.some((d) => d.code === "USD1007"),
      "Must detect invalid joint axis token",
    );
  });

  await t.test("lowerUsdToDae: lowers UsdPhysics stage into WebAssembly DAE arena for simulation", () => {
    const stage = parseUsd(VALID_ROBOT_STAGE);
    const dae = lowerUsdToDae(stage);

    assert.ok(dae.varCount > 0, "Must allocate variables in DAE linear memory");
    assert.ok(dae.eqCount > 0, "Must generate differential equations in DAE linear memory");

    // Check joint states: j1.q, j1.qd, j1.tau
    const varNames = Array.from({ length: dae.varCount }, (_, i) => dae.getVarName(i));
    assert.ok(varNames.includes("j1.q"), "Must contain generalized coordinate j1.q");
    assert.ok(varNames.includes("j1.qd"), "Must contain generalized velocity j1.qd");
    assert.ok(varNames.includes("j1.tau"), "Must contain actuator effort j1.tau");

    // Check link tracking states
    assert.ok(varNames.includes("base_link.z"));
    assert.ok(varNames.includes("link_1.z"));
  });

  await t.test("UnifiedWorkspace: indexes and queries prims across multi-file workspace", () => {
    const ws = new UnifiedWorkspace(usdLanguage);
    ws.setDocument("models/arm.usda", VALID_ROBOT_STAGE);

    const hit = findUsdPrim(ws, "/IndustrialArm/j1");
    assert.ok(hit);
    assert.equal(hit.filePath, "models/arm.usda");
    assert.equal(hit.prim.typeName, "PhysicsRevoluteJoint");

    const missing = findUsdPrim(ws, "/NonExistent/Prim");
    assert.equal(missing, null);
  });

  await t.test("UsdLspService: provides diagnostics, outline symbols, and schema hover tooltips", () => {
    const lsp = new UsdLspService();
    const symbols = lsp.getDocumentSymbols(VALID_ROBOT_STAGE);

    assert.ok(symbols.length > 0);
    const hover = lsp.getHover(VALID_ROBOT_STAGE, { line: 12, character: 15 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("PhysicsRigidBodyAPI"));
  });

  await t.test(
    "CAD to OpenUSD: compiles procedural CAD assembly, parses, lints, and verifies USDZ 64-byte alignment",
    () => {
      const b = box({ width: 10, height: 10, depth: 5, name: "MountBase" });
      const c = cylinder({ radius: 2, height: 8, name: "PivotShaft" });
      const asm = assembly("ActuatorAssembly", [part(b), part(c)]);

      // 1. Compile CAD assembly to ASCII OpenUSD
      const usda = compileAssemblyToUsd(asm, {
        stageName: "ActuatorAssembly",
        metersPerUnit: 0.001,
        upAxis: "Z",
      });

      assert.ok(usda.includes('def Xform "ActuatorAssembly"'));
      assert.ok(usda.includes('def Xform "MountBase"'));
      assert.ok(usda.includes('def Xform "PivotShaft"'));

      // 2. Ingest into @modelscript/usd parser
      const stage = parseUsd(usda);
      assert.equal(stage.metadata.defaultPrim, "ActuatorAssembly");
      assert.equal(stage.metadata.metersPerUnit, 0.001);
      assert.equal(stage.metadata.upAxis, "Z");
      assert.ok(stage.prims.has("/ActuatorAssembly/MountBase"));
      assert.ok(stage.prims.has("/ActuatorAssembly/PivotShaft"));

      // 3. Verify zero linter errors
      const diags = lintUsdStage(stage);
      assert.equal(diags.length, 0, "CAD generated OpenUSD stage must produce 0 diagnostic errors");

      // 4. Compile to 64-byte aligned USDZ package and verify AOUSD compliance
      const usdz = compileAssemblyToUsdz(asm, { stageName: "ActuatorPackage" });
      assert.ok(usdz instanceof Uint8Array);
      assert.ok(usdz.length > 100);

      const view = new DataView(usdz.buffer, usdz.byteOffset, usdz.byteLength);
      assert.equal(view.getUint32(0, true), 0x04034b50, "ZIP LFH magic signature must match");

      const fileNameLen = view.getUint16(26, true);
      const extraLen = view.getUint16(28, true);
      const dataOffset = 30 + fileNameLen + extraLen;
      assert.equal(dataOffset % 64, 0, "Payload data offset MUST be strictly 64-byte aligned");
    },
  );
});
