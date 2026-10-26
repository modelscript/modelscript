// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UrdfWorkspaceIndex } from "../src/workspace-index.js";

const ROBOT_A = `<?xml version="1.0"?>
<robot name="robot_alpha">
  <link name="base_link"/>
  <link name="end_effector"/>
  <joint name="j1" type="revolute">
    <parent link="base_link"/>
    <child link="end_effector"/>
  </joint>
</robot>`;

describe("URDF Multi-File Workspace Indexer (@modelscript/urdf)", () => {
  it("should index and resolve robot links, joints, and symbols across workspace files", () => {
    const index = new UrdfWorkspaceIndex();
    index.indexFile("file:///workspace/robot_a.urdf", ROBOT_A);

    const symbols = index.findSymbolsByName("robot_alpha");
    assert.ok(symbols.length > 0);
    assert.equal(symbols[0]?.name, "robot_alpha");

    const links = index.findSymbolsByName("base_link");
    assert.ok(links.length > 0);

    const joints = index.findSymbolsByName("j1");
    assert.ok(joints.length > 0);
  });
});
