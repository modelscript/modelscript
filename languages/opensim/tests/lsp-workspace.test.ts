// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeOpenSimAction,
  getOpenSimDocumentSymbols,
  openSimLanguage,
  provideOpenSimCompletions,
  provideOpenSimDefinition,
  provideOpenSimHover,
  resolveOpenSimInScope,
  validateOpenSimDocument,
} from "../src/index.js";

const WORKSPACE_OSIM = `
<OpenSimDocument Version="40000">
  <Model name="ankle_model">
    <BodySet>
      <Body name="talus">
        <mass>1.2</mass>
        <mass_center>0 -0.05 0</mass_center>
        <inertia>0.01 0.01 0.01 0 0 0</inertia>
      </Body>
    </BodySet>
    <JointSet>
      <PinJoint name="ankle">
        <socket_parent_frame>ground</socket_parent_frame>
        <socket_child_frame>talus</socket_child_frame>
        <coordinates>
          <Coordinate name="ankle_angle">
            <motion_type>rotational</motion_type>
            <default_value>0.0</default_value>
            <range>-0.8 0.8</range>
          </Coordinate>
        </coordinates>
      </PinJoint>
    </JointSet>
    <ForceSet>
      <Thelen2003Muscle name="tib_ant">
        <max_isometric_force>900</max_isometric_force>
        <optimal_fiber_length>0.098</optimal_fiber_length>
        <tendon_slack_length>0.223</tendon_slack_length>
        <pennation_angle_at_optimal>0.087</pennation_angle_at_optimal>
        <GeometryPath>
          <PathPointSet>
            <PathPoint name="p1"><socket_parent_frame>ground</socket_parent_frame><location>0 0.2 0</location></PathPoint>
            <PathPoint name="p2"><socket_parent_frame>talus</socket_parent_frame><location>0.03 -0.02 0</location></PathPoint>
          </PathPointSet>
        </GeometryPath>
      </Thelen2003Muscle>
    </ForceSet>
    <MarkerSet>
      <Marker name="lat_malleolus">
        <socket_parent_frame>talus</socket_parent_frame>
        <location>0 0 0.04</location>
      </Marker>
    </MarkerSet>
  </Model>
</OpenSimDocument>
`;

describe("OpenSim LSP Providers, Language Registration & UnifiedWorkspace", () => {
  it("indexes symbols in UnifiedWorkspace and resolves by name and scope", () => {
    const uri = "file:///ankle.osim";
    const ws = new UnifiedWorkspace(openSimLanguage);
    ws.setDocument(uri, WORKSPACE_OSIM);

    assert.strictEqual(ws.hasDocument(uri), true);
    assert.strictEqual(ws.fileCount, 1);

    const allSyms = ws.getSymbolsForUri(uri);
    assert(allSyms.length >= 5);

    const talus = ws.findSymbolsByName("talus")[0];
    assert(talus !== undefined);
    assert.strictEqual(talus.ruleName, "opensim_body");

    const ankleJoint = ws.findSymbolsByName("ankle")[0];
    assert(ankleJoint !== undefined);
    const resolvedCoord = resolveOpenSimInScope(ws, "ankle_angle", ankleJoint.id, uri);
    assert(resolvedCoord !== undefined && resolvedCoord !== null);
    assert.strictEqual(resolvedCoord.ruleName, "opensim_coordinate");
  });

  it("provides validation, document symbols, hover, completions, definition, and actions", async () => {
    assert.strictEqual(openSimLanguage.name, "opensim");
    assert(openSimLanguage.fileExtensions.includes(".osim"));

    const diags = validateOpenSimDocument(WORKSPACE_OSIM);
    assert.strictEqual(diags.length, 0);

    const symbols = getOpenSimDocumentSymbols(WORKSPACE_OSIM);
    assert(symbols.some((s) => s.name === "talus"));
    assert(symbols.some((s) => s.name === "ankle" && s.children?.some((c) => c.name === "ankle_angle")));
    assert(symbols.some((s) => s.name === "tib_ant"));

    const muscleOffset = WORKSPACE_OSIM.indexOf("tib_ant");
    const hover = provideOpenSimHover(WORKSPACE_OSIM, muscleOffset);
    assert(hover !== null);
    assert(hover.contents.value.includes("tib_ant"));

    const completions = provideOpenSimCompletions(WORKSPACE_OSIM);
    assert(completions.some((c) => c.label === "talus"));
    assert(completions.some((c) => c.label === "tib_ant"));

    const refOffset = WORKSPACE_OSIM.indexOf("<socket_child_frame>talus");
    const def = provideOpenSimDefinition(WORKSPACE_OSIM, refOffset + 22, "file:///ankle.osim");
    assert(def !== null);
    assert.strictEqual(def.uri, "file:///ankle.osim");

    const simRes = await executeOpenSimAction("opensim_simulate", WORKSPACE_OSIM, {
      duration: 0.05,
      dt: 0.01,
    });
    assert.strictEqual(simRes.steps, 5);

    const daeRes = await executeOpenSimAction("opensim_to_dae", WORKSPACE_OSIM);
    assert(daeRes.variableCount > 0);
    assert(daeRes.equationCount > 0);

    const urdfStr = await executeOpenSimAction("opensim_to_urdf", WORKSPACE_OSIM);
    assert(urdfStr.includes('<robot name="ankle_model">'));
  });
});
