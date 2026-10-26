// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getUrdfDocumentSymbols,
  getUrdfHover,
  urdfLanguage,
  UrdfWorkspaceIndex,
  validateUrdf,
} from "@modelscript/urdf";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const SAMPLE_URDF = `<?xml version="1.0"?>
<robot name="robot_scara">
  <link name="base_link">
    <inertial>
      <mass value="10.0"/>
      <inertia ixx="0.5" ixy="0" ixz="0" iyy="0.5" iyz="0" izz="0.5"/>
    </inertial>
  </link>
  <link name="arm_link">
    <inertial>
      <mass value="3.0"/>
      <inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
    </inertial>
  </link>
  <joint name="pan_joint" type="revolute">
    <parent link="base_link"/>
    <child link="arm_link"/>
    <origin xyz="0 0 0.5"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="50" velocity="2"/>
  </joint>
</robot>`;

describe("ROS URDF / SDFormat LSP Integration Suite", () => {
  it("resolves URDF language plugin for .urdf, .sdf, and .xacro files", () => {
    globalLanguageRegistry.register({
      id: "urdf",
      name: "ROS URDF & SDFormat",
      extensions: [".urdf", ".sdf", ".xacro"],
      languageDef: urdfLanguage,
      workspaceIndex: new UrdfWorkspaceIndex(),
      customHandlers: {
        symbols: (text: string) => getUrdfDocumentSymbols(text),
        hover: (offset: number, text: string) => getUrdfHover(text, offset),
        validate: (doc: any) => {
          const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
          return validateUrdf(text);
        },
      },
      actionHandlers: {
        lint_urdf_robot: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return [];
          const { parseUrdf, lintUrdfRobot } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return lintUrdfRobot(robot);
        },
        compute_urdf_rnea: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseUrdf, computeInverseDynamicsRnea } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          const q = new Map<string, number>();
          const qd = new Map<string, number>();
          const qdd = new Map<string, number>();
          for (const j of robot.joints.keys()) {
            q.set(j, 0.0);
            qd.set(j, 0.0);
            qdd.set(j, 0.0);
          }
          return computeInverseDynamicsRnea(robot, q, qd, qdd);
        },
        export_urdf_modelica: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return "";
          const { parseUrdf, urdfToModelica } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return urdfToModelica(robot);
        },
        export_urdf_simpack: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseUrdf, urdfToSimpack } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return urdfToSimpack(robot);
        },
        export_urdf_adams: async (ctx: any, params: any) => {
          const text = params?.documentText ?? ctx.documentText;
          if (!text) return null;
          const { parseUrdf, urdfToAdams } = await import("@modelscript/urdf");
          const robot = parseUrdf(text);
          return urdfToAdams(robot);
        },
      },
    });

    const pluginUrdf = globalLanguageRegistry.getPluginForUri("file:///workspace/robot.urdf");
    assert.ok(pluginUrdf, "Should find plugin for .urdf");
    assert.equal(pluginUrdf.id, "urdf");

    const pluginSdf = globalLanguageRegistry.getPluginForUri("file:///workspace/world.sdf");
    assert.ok(pluginSdf, "Should find plugin for .sdf");
    assert.equal(pluginSdf.id, "urdf");

    const pluginXacro = globalLanguageRegistry.getPluginForUri("file:///workspace/model.xacro");
    assert.ok(pluginXacro, "Should find plugin for .xacro");
    assert.equal(pluginXacro.id, "urdf");
  });

  it("extracts document symbols, diagnostics, and hover via custom handlers", () => {
    const plugin = globalLanguageRegistry.get("urdf");
    assert.ok(plugin);
    assert.ok(plugin.customHandlers?.symbols);
    assert.ok(plugin.customHandlers?.validate);
    assert.ok(plugin.customHandlers?.hover);

    const symbols = plugin.customHandlers.symbols(SAMPLE_URDF);
    assert.ok(Array.isArray(symbols));
    assert.equal(symbols.length, 3);

    const diags = plugin.customHandlers.validate({ getText: () => SAMPLE_URDF });
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d: any) => d.severity === 1);
    assert.equal(errors.length, 0);

    const offset = SAMPLE_URDF.indexOf("pan_joint");
    const hover = plugin.customHandlers.hover(offset, SAMPLE_URDF);
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("pan_joint"));
  });

  it("executes URDF action handlers for RNEA, Modelica, SIMPACK, and Adams export", async () => {
    const plugin = globalLanguageRegistry.get("urdf");
    assert.ok(plugin);
    assert.ok(plugin.actionHandlers);

    // 1. RNEA inverse dynamics
    const rnea = await plugin.actionHandlers.compute_urdf_rnea({}, { documentText: SAMPLE_URDF });
    assert.ok(rnea);
    assert.ok(rnea.jointTorques.has("pan_joint"));

    // 2. Export Modelica
    const mo = await plugin.actionHandlers.export_urdf_modelica({}, { documentText: SAMPLE_URDF });
    assert.ok(typeof mo === "string");
    assert.ok(mo.includes("model robot_scara"));

    // 3. Export SIMPACK
    const simpack = await plugin.actionHandlers.export_urdf_simpack({}, { documentText: SAMPLE_URDF });
    assert.ok(simpack);
    assert.ok(simpack.bodies && simpack.bodies.size >= 2);

    // 4. Export Adams
    const adams = await plugin.actionHandlers.export_urdf_adams({}, { documentText: SAMPLE_URDF });
    assert.ok(adams);
    assert.ok(adams.parts && adams.parts.size >= 2);
  });
});
