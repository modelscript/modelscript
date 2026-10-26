// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getUrdfDocumentSymbols, getUrdfHover, validateUrdf } from "../src/lsp.js";

const ROBOT_XML = `<?xml version="1.0"?>
<robot name="robot_arm">
  <link name="base_link">
    <inertial>
      <mass value="5.0"/>
      <inertia ixx="0.1" iyy="0.1" izz="0.1"/>
    </inertial>
  </link>
  <link name="link_1"/>
  <joint name="shoulder_pan" type="revolute">
    <parent link="base_link"/>
    <child link="link_1"/>
    <limit lower="-3.14" upper="3.14" effort="100" velocity="2"/>
  </joint>
</robot>`;

describe("URDF LSP Services (@modelscript/urdf)", () => {
  it("should validate clean URDF document without errors", () => {
    const diags = validateUrdf(ROBOT_XML);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("should extract document symbol hierarchy for links and joints", () => {
    const symbols = getUrdfDocumentSymbols(ROBOT_XML);
    assert.equal(symbols.length, 3);
    assert.ok(symbols.some((s) => s.name.includes("base_link")));
    assert.ok(symbols.some((s) => s.name.includes("link_1")));
    assert.ok(symbols.some((s) => s.name.includes("shoulder_pan")));
  });

  it("should generate markdown hover for element under offset", () => {
    const offset = ROBOT_XML.indexOf("shoulder_pan");
    const hover = getUrdfHover(ROBOT_XML, offset);
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("shoulder_pan"));
  });
});
