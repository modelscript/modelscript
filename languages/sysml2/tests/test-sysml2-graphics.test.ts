import assert from "node:assert";
import { describe, it } from "node:test";
import { buildSysML2DiagramData, gfxConfig } from "../src/factory.js";

describe("SysML v2 Graphics & 9-View Diagram Coverage", () => {
  it("should have populated gfxConfig for core SysML2 rules", () => {
    assert(gfxConfig, "gfxConfig must be defined");
    const ruleKeys = Object.keys(gfxConfig);
    assert(ruleKeys.length > 20, `Expected >20 graphics rules, got ${ruleKeys.length}`);

    // Check specific critical rules
    assert(gfxConfig["PartDefinition"], "PartDefinition should have graphics config");
    assert.strictEqual(gfxConfig["PartDefinition"].role, "node");

    assert(gfxConfig["PartUsage"], "PartUsage should have graphics config");
    assert.strictEqual(gfxConfig["PartUsage"].role, "node");

    assert(gfxConfig["PortDefinition"], "PortDefinition should have graphics config");
    assert.strictEqual(gfxConfig["PortDefinition"].role, "node");

    assert(gfxConfig["AttributeDefinition"], "AttributeDefinition should have graphics config");
    assert.strictEqual(gfxConfig["AttributeDefinition"].role, "node");

    assert(gfxConfig["ConnectionUsage"], "ConnectionUsage should have graphics config");
    assert.strictEqual(gfxConfig["ConnectionUsage"].role, "edge");

    assert(gfxConfig["InterfaceUsage"], "InterfaceUsage should have graphics config");
    assert.strictEqual(gfxConfig["InterfaceUsage"].role, "edge");

    assert(gfxConfig["AllocationUsage"], "AllocationUsage should have graphics config");
    assert.strictEqual(gfxConfig["AllocationUsage"].role, "edge");

    assert(gfxConfig["Package"], "Package should have graphics config");
    assert.strictEqual(gfxConfig["Package"].role, "group");
  });

  it("should support all 9 SysML v2 diagram views without crashing", () => {
    const fakeIndex = {
      symbols: new Map([
        ["s1", { id: "s1", ruleName: "Package", name: "Pkg1", parentId: null, metadata: {} }],
        ["s2", { id: "s2", ruleName: "PartDefinition", name: "Vehicle", parentId: "s1", metadata: {} }],
        ["s3", { id: "s3", ruleName: "PartUsage", name: "wheel", parentId: "s2", metadata: {} }],
        ["s4", { id: "s4", ruleName: "PortUsage", name: "p1", parentId: "s3", metadata: {} }],
        ["s5", { id: "s5", ruleName: "StateDefinition", name: "OperationalState", parentId: "s1", metadata: {} }],
        ["s6", { id: "s6", ruleName: "StateUsage", name: "Running", parentId: "s5", metadata: {} }],
        ["s7", { id: "s7", ruleName: "TransitionUsage", name: "t1", parentId: "s5", metadata: {} }],
        ["s8", { id: "s8", ruleName: "ActionDefinition", name: "Steer", parentId: "s1", metadata: {} }],
        ["s9", { id: "s9", ruleName: "ForkNode", name: "fork1", parentId: "s8", metadata: {} }],
        ["s10", { id: "s10", ruleName: "RequirementDefinition", name: "Req1", parentId: "s1", metadata: {} }],
        ["s11", { id: "s11", ruleName: "ConstraintDefinition", name: "MaxSpeed", parentId: "s1", metadata: {} }],
        ["s12", { id: "s12", ruleName: "UseCaseDefinition", name: "DriveVehicle", parentId: "s1", metadata: {} }],
      ]),
      childrenOf: new Map([
        ["s1", ["s2", "s5", "s8", "s10", "s11", "s12"]],
        ["s2", ["s3"]],
        ["s3", ["s4"]],
        ["s5", ["s6", "s7"]],
        ["s8", ["s9"]],
      ]),
    };

    const views = [
      "All",
      "BDD",
      "IBD",
      "StateMachine",
      "Activity",
      "UseCase",
      "Requirement",
      "Parametric",
      "Package",
      "Sequence",
    ] as const;

    for (const view of views) {
      const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, view);
      assert(data, `Diagram data for view ${view} should be defined`);
      assert(Array.isArray(data.nodes), `Nodes for view ${view} should be an array`);
      assert(Array.isArray(data.edges), `Edges for view ${view} should be an array`);
    }
  });
});
