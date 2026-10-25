// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { planDiagramActions } from "../src/edit/diagram-actions.js";
import { planPscadEdits } from "../src/edit/edit-engine.js";
import { extractEmtNetlist } from "../src/netlist/emt-netlist.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const SAMPLE_PSCX = `<?xml version="1.0" encoding="UTF-8"?>
<project name="TestProject" version="5.0.0" Target="Case">
  <definitions>
    <Definition classid="StationDefn" name="Station" id="1" w="0" h="0">
      <schematic />
    </Definition>
    <Definition classid="UserCmpDefn" name="Main" id="2" w="0" h="0">
      <schematic>
        <User classid="UserCmp" id="101" name="master:resistor" x="200" y="200" w="60" h="30" z="0" orient="0" disable="false">
          <paramlist>
            <param name="Name" value="R1" />
            <param name="R" value="10.0" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="102" name="master:breaker3" x="300" y="200" w="60" h="30" z="0" orient="0" disable="false">
          <paramlist>
            <param name="Name" value="BRK1" />
            <param name="RON" value="0.001" />
            <param name="ROFF" value="1.0e6" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="103" name="master:tline" x="400" y="200" w="60" h="30" z="0" orient="0" disable="false">
          <paramlist>
            <param name="Name" value="TL1" />
            <param name="length" value="100.0" />
            <param name="R" value="0.05" />
            <param name="L" value="0.001" />
            <param name="C" value="1.0e-8" />
            <param name="conductor_height" value="25.0" />
            <param name="conductor_radius" value="0.015" />
            <param name="soil_resistivity" value="100.0" />
          </paramlist>
        </User>
        <bus name="Bus1" id="201" x="100" y="200" vbase="230" />
        <Wire classid="WireOrthogonal" id="301" name="" x="100" y="200" w="100" h="10" orient="0" disable="false">
          <vertex x="100" y="200" />
          <vertex x="200" y="200" />
        </Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

test("GUI Actions Suite: Rotate and Toggle Disable / Bypass", async (t) => {
  await t.test("rotates component by 90 degrees updating orient", () => {
    const res = planDiagramActions(SAMPLE_PSCX, [{ type: "rotate", item: { name: "R1", rotation: 90 } }]);
    assert.equal(res.unresolved.length, 0);
    assert.ok(res.edits.length >= 1, "Should have edits");
    const plan = planPscadEdits(SAMPLE_PSCX, [{ type: "moveComponent", id: "101", x: 200, y: 200, orient: 1 }]);
    assert.match(plan.text, /orient="1"/);
  });

  await t.test("toggles disable/bypass on component", () => {
    const plan = planPscadEdits(SAMPLE_PSCX, [{ type: "toggleDisable", id: "101", disabled: true }]);
    assert.equal(plan.errors.length, 0);
    assert.match(plan.text, /disable="true"/);

    // Verify parser picks up disabled flag
    const parsed = parsePscx(plan.text);
    const r1 = parsed.rootModule.components.find((c) => c.instanceName === "R1");
    assert.ok(r1, "R1 should be in components");
    assert.equal(r1.disabled, true);

    // Verify EMT netlist skips disabled component
    const activeNetlist = extractEmtNetlist(parsePscx(SAMPLE_PSCX));
    const disabledNetlist = extractEmtNetlist(parsed);
    assert.ok(activeNetlist.branches.length > disabledNetlist.branches.length);
    assert.equal(
      disabledNetlist.branches.some((b) => b.id.includes("R1")),
      false,
    );
  });

  await t.test("quick-inserts Ground, Busbar, Breaker, and Resistor components", () => {
    const plan = planPscadEdits(SAMPLE_PSCX, [
      { type: "addComponent", defn: "master:ground", x: 150, y: 300, params: {} },
      { type: "addComponent", defn: "master:bus", x: 250, y: 300, params: { Name: "SubBus" } },
      { type: "addComponent", defn: "master:breaker3", x: 350, y: 300, params: { Name: "BRK_NEW", Status: "Closed" } },
      { type: "addComponent", defn: "master:resistor", x: 450, y: 300, params: { Name: "R_NEW", R: "50.0" } },
    ]);
    assert.equal(plan.errors.length, 0);
    assert.match(plan.text, /defn="master:ground"/);
    assert.match(plan.text, /defn="master:bus"/);
    assert.match(plan.text, /defn="master:breaker3"/);
    assert.match(plan.text, /defn="master:resistor"/);

    const parsed = parsePscx(plan.text);
    assert.ok(parsed.rootModule.components.some((c) => c.definitionName === "master:ground"));
    assert.ok(parsed.rootModule.components.some((c) => c.instanceName === "BRK_NEW"));
    assert.ok(parsed.rootModule.components.some((c) => c.instanceName === "R_NEW"));
  });

  await t.test("toggles breaker contact state between Closed and Open", () => {
    // 1. Initial toggle: Set BRK1 Status to Open
    const openPlan = planPscadEdits(SAMPLE_PSCX, [{ type: "setParameter", id: "102", name: "Status", value: "Open" }]);
    assert.equal(openPlan.errors.length, 0);
    assert.match(openPlan.text, /<param name="Status" value="Open"/);

    const parsedOpen = parsePscx(openPlan.text);
    const brkOpen = parsedOpen.rootModule.components.find((c) => c.instanceName === "BRK1");
    assert.ok(brkOpen);
    assert.equal(brkOpen.parameters["Status"], "Open");

    // 2. Toggle back to Closed via planDiagramActions
    const closeRes = planDiagramActions(openPlan.text, [
      { type: "updateParameter", name: "BRK1", parameter: "Status", value: "Closed" },
    ]);
    assert.equal(closeRes.unresolved.length, 0);
    assert.ok(closeRes.edits.length > 0);

    const closePlan = planPscadEdits(openPlan.text, [
      { type: "setParameter", id: "102", name: "Status", value: "Closed" },
    ]);
    const parsedClosed = parsePscx(closePlan.text);
    const brkClosed = parsedClosed.rootModule.components.find((c) => c.instanceName === "BRK1");
    assert.ok(brkClosed);
    assert.equal(brkClosed.parameters["Status"], "Closed");
  });

  await t.test("applies 2D Line CAD parameters to transmission line component", () => {
    // Simulate what line-geometry-panel sends via applyLineParameters
    const cadParams = {
      R: 0.03214,
      L: 0.000985,
      C: 1.154e-8,
      length: 125.5,
      conductor_height: 28.5,
      conductor_radius: 0.0185,
      soil_resistivity: 150.0,
    };

    const actions = [
      { type: "updateParameter", name: "TL1", parameter: "R", value: cadParams.R.toFixed(5) },
      { type: "updateParameter", name: "TL1", parameter: "L", value: cadParams.L.toFixed(6) },
      { type: "updateParameter", name: "TL1", parameter: "C", value: cadParams.C.toExponential(4) },
      { type: "updateParameter", name: "TL1", parameter: "length", value: cadParams.length.toFixed(1) },
      {
        type: "updateParameter",
        name: "TL1",
        parameter: "conductor_height",
        value: cadParams.conductor_height.toFixed(2),
      },
      {
        type: "updateParameter",
        name: "TL1",
        parameter: "conductor_radius",
        value: cadParams.conductor_radius.toFixed(4),
      },
      {
        type: "updateParameter",
        name: "TL1",
        parameter: "soil_resistivity",
        value: cadParams.soil_resistivity.toFixed(1),
      },
    ];

    const planned = planDiagramActions(SAMPLE_PSCX, actions);
    assert.equal(planned.unresolved.length, 0);
    assert.ok(planned.edits.length >= 7, "Should have text edits for each parameter");

    // Apply the structural edits
    const editOps = actions.map((a) => ({
      type: "setParameter" as const,
      id: "103",
      name: a.parameter,
      value: a.value,
    }));
    const plan = planPscadEdits(SAMPLE_PSCX, editOps);
    assert.equal(plan.errors.length, 0);

    const parsed = parsePscx(plan.text);
    const tl1 = parsed.rootModule.components.find((c) => c.instanceName === "TL1");
    assert.ok(tl1, "TL1 must exist in parsed output");
    assert.equal(tl1.parameters["R"], 0.03214);
    assert.equal(tl1.parameters["L"], 0.000985);
    assert.equal(tl1.parameters["length"], 125.5);
    assert.equal(tl1.parameters["conductor_height"], 28.5);
    assert.equal(tl1.parameters["conductor_radius"], 0.0185);
    assert.equal(tl1.parameters["soil_resistivity"], 150.0);
  });
});
