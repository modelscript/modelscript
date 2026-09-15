// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { buildSysML2DiagramData } from "../src/factory.js";

test("SysML v2 In-Model View Discovery & Dynamic Projections", async (t) => {
  const dummyUri = "file:///workspace/InModelViews.sysml";

  // Create mock SymbolIndex with standard parts and an in-model ViewDefinition
  const symbols = new Map<string, any>();
  const childrenOf = new Map<string, string[]>();

  // Root package
  symbols.set("pkg1", {
    id: "pkg1",
    ruleName: "Package",
    name: "VehicleSystem",
    parentId: null,
    metadata: {},
    resourceId: dummyUri,
  });

  // Part 1: Battery
  symbols.set("part1", {
    id: "part1",
    ruleName: "PartUsage",
    name: "battery",
    parentId: "pkg1",
    metadata: {},
    resourceId: dummyUri,
  });

  // Part 2: Motor
  symbols.set("part2", {
    id: "part2",
    ruleName: "PartUsage",
    name: "motor",
    parentId: "pkg1",
    metadata: {},
    resourceId: dummyUri,
  });

  // Part 3: Chassis (not in view)
  symbols.set("part3", {
    id: "part3",
    ruleName: "PartUsage",
    name: "chassis",
    parentId: "pkg1",
    metadata: {},
    resourceId: dummyUri,
  });

  // User-defined in-model view: PowerView exposing battery & motor
  symbols.set("view1", {
    id: "view1",
    ruleName: "ViewDefinition",
    name: "PowerView",
    parentId: "pkg1",
    metadata: {},
    resourceId: dummyUri,
  });

  // Expose members under view1
  symbols.set("expose1", {
    id: "expose1",
    ruleName: "ElementFilterMember",
    name: "battery",
    parentId: "view1",
    metadata: {},
    resourceId: dummyUri,
  });

  symbols.set("expose2", {
    id: "expose2",
    ruleName: "ElementFilterMember",
    name: "motor",
    parentId: "view1",
    metadata: {},
    resourceId: dummyUri,
  });

  childrenOf.set("pkg1", ["part1", "part2", "part3", "view1"]);
  childrenOf.set("view1", ["expose1", "expose2"]);

  const index = { symbols, childrenOf };

  await t.test("should discover user-written in-model ViewDefinition in availableViews", () => {
    const data = buildSysML2DiagramData(index, dummyUri);

    assert.ok(data.availableViews);
    const powerView = data.availableViews.find((v) => v.id === "PowerView");
    assert.ok(powerView, "PowerView should be discovered dynamically");
    assert.strictEqual(powerView.label, "PowerView");
  });

  await t.test("should filter elements when in-model view is selected as diagramType", () => {
    const data = buildSysML2DiagramData(index, dummyUri, undefined, "PowerView");

    assert.strictEqual(data.diagramType, "PowerView");
    const nodeNames = data.nodes.map((n) => (n.attrs as any)?.label?.text || n.id);

    // battery and motor should be present
    assert.ok(data.nodes.some((n) => n.id === "part1" || (n.attrs as any)?.label?.text?.includes("battery")));
    assert.ok(data.nodes.some((n) => n.id === "part2" || (n.attrs as any)?.label?.text?.includes("motor")));

    // chassis should NOT be present
    assert.ok(!data.nodes.some((n) => n.id === "part3"));
  });
});
