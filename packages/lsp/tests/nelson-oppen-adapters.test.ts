// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPolyglotCoordinator } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";

describe("Phase 2 Typed Nelson-Oppen Adapters & Fiber LSP Validation", () => {
  it("registers typed extractTheoryConstraints adapters for spice, psse, urdf, cantera, and matpower", () => {
    registerBuiltinLanguagePlugins({
      connection: null as any,
      documents: null as any,
      parserService: null as any,
      workspaceManager: {
        getWorkspaceIndex: () => undefined,
        setWorkspaceIndex: () => {},
        getQueryEngine: () => undefined,
        setQueryEngine: () => {},
        unifiedWorkspace: { registerWorkspace: () => {}, registerLanguageDef: () => {} },
      } as any,
    });

    for (const id of ["spice", "psse", "urdf", "cantera", "matpower"]) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      assert.ok(plugin, `Expected plugin '${id}' to be registered`);
      assert.strictEqual(
        typeof plugin.extractTheoryConstraints,
        "function",
        `Expected '${id}' to expose extractTheoryConstraints`,
      );
    }
  });

  it("extracts typed SPICE and URDF parameters with SI units and merges into Nelson-Oppen digital thread", async () => {
    const spicePlugin = globalLanguageRegistry.getPluginById("spice")!;
    const urdfPlugin = globalLanguageRegistry.getPluginById("urdf")!;

    const spiceText = `* Filter
V1 in 0 5
R1 in out 1k
C1 out 0 1u`;
    const spiceConstraints = await spicePlugin.extractTheoryConstraints!(spiceText, "file:///filter.sp");
    assert.ok(spiceConstraints.parameters.some((p: any) => p.name === "R1" && p.value === 1000 && p.unit === "Ohm"));
    assert.ok(spiceConstraints.ports.some((pt: any) => pt.name === "in" && pt.kind === "ElectricalNode"));

    const urdfText = `<robot name="RoverArm">
  <link name="base_link"><inertial><mass value="4.2"/></inertial></link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/><child link="arm_link"/>
    <limit lower="-1.5" upper="1.5" effort="45" velocity="2.0"/>
  </joint>
</robot>`;
    const urdfConstraints = await urdfPlugin.extractTheoryConstraints!(urdfText, "file:///rover.urdf");
    assert.ok(
      urdfConstraints.parameters.some((p: any) => p.name === "base_link_mass" && p.value === 4.2 && p.unit === "kg"),
    );
    assert.ok(
      urdfConstraints.parameters.some((p: any) => p.name === "shoulder_effort" && p.value === 45 && p.unit === "N*m"),
    );

    const sysmlText = `package Spec {
  part def FilterSpec {
    attribute r_target = 1000 [Ohm];
  }
}`;
    const { evaluatePolyglotDigitalThreadFromFiles } = createPolyglotCoordinator({});
    const thread = evaluatePolyglotDigitalThreadFromFiles([
      { uri: "file:///spec.sysml", fileName: "spec.sysml", content: sysmlText },
      {
        uri: "file:///filter.sp",
        fileName: "filter.sp",
        content: `* @twin: R1 <-> Spec::FilterSpec.r_target\n${spiceText}`,
        theoryConstraints: spiceConstraints,
      },
    ]);
    assert.strictEqual(thread.isSat, true);
  });

  it("validates Fiber GeoJSON documents via builtin-plugins customHandlers.validate", async () => {
    const fiberPlugin = globalLanguageRegistry.getPluginById("fiber")!;
    assert.strictEqual(typeof fiberPlugin.customHandlers?.validate, "function");
    const badDiags = await fiberPlugin.customHandlers!.validate!("{ invalid json");
    assert.ok(badDiags.length > 0);
    assert.strictEqual(badDiags[0].code, "FIBER1000");
  });
});
