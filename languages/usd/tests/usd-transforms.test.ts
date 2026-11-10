// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseUsd } from "../src/index.js";

test("OpenUSD Transforms & Scenegraph — parses time-sampled transformations", () => {
  const animatedUsd = `#usda 1.0
(
    startTimeCode = 0.0
    endTimeCode = 10.0
    timeCodesPerSecond = 24.0
)

def Xform "AnimatedObject" {
    double3 xformOp:translate.timeSamples = {
        0.0: (0.0, 0.0, 0.0),
        5.0: (1.5, 2.0, 3.5),
        10.0: (3.0, 4.0, 7.0),
    }
    double3 xformOp:rotateXYZ.timeSamples = {
        0.0: (0.0, 0.0, 0.0),
        10.0: (0.0, 180.0, 0.0),
    }
    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]
}
`;
  const stage = parseUsd(animatedUsd);
  assert.strictEqual(stage.metadata.startTimeCode, 0.0);
  assert.strictEqual(stage.metadata.endTimeCode, 10.0);
  assert.strictEqual(stage.metadata.timeCodesPerSecond, 24.0);

  const prim = stage.prims.get("/AnimatedObject");
  assert.ok(prim);

  const transAttr = prim.attributes.get("xformOp:translate");
  assert.ok(transAttr?.timeSamples);
  assert.strictEqual(transAttr.timeSamples.size, 3);
  assert.deepStrictEqual(transAttr.timeSamples.get(5.0), [1.5, 2.0, 3.5]);

  const rotAttr = prim.attributes.get("xformOp:rotateXYZ");
  assert.ok(rotAttr?.timeSamples);
  assert.strictEqual(rotAttr.timeSamples.size, 2);
  assert.deepStrictEqual(rotAttr.timeSamples.get(10.0), [0.0, 180.0, 0.0]);
});

test("OpenUSD Transforms & Scenegraph — parses nested prim hierarchy and kinds", () => {
  const hierarchyUsd = `#usda 1.0
def Xform "World" ( kind = "group" ) {
    def Xform "Robot" ( kind = "assembly" ) {
        def Xform "Base" ( kind = "component" ) {
            def Mesh "Geometry" {}
        }
    }
}
`;
  const stage = parseUsd(hierarchyUsd);
  assert.strictEqual(stage.prims.size, 4);

  const world = stage.prims.get("/World");
  assert.strictEqual(world?.kind, "group");

  const robot = stage.prims.get("/World/Robot");
  assert.strictEqual(robot?.kind, "assembly");

  const base = stage.prims.get("/World/Robot/Base");
  assert.strictEqual(base?.kind, "component");

  const geom = stage.prims.get("/World/Robot/Base/Geometry");
  assert.strictEqual(geom?.typeName, "Mesh");
});
