// SPDX-License-Identifier: AGPL-3.0-or-later

import { applySwimlaneLayout, type SwimlanePartition } from "@modelscript/diagram/swimlane-layout";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSysML2DiagramData } from "../src/factory.js";

describe("SysML v2 9-View Complete Visual Parity & Swimlanes", () => {
  it("should generate BDD specialization edges with UML hollow triangle marker", () => {
    const fakeIndex = {
      symbols: new Map([
        ["s_pkg", { id: "s_pkg", ruleName: "Package", name: "Vehicles", parentId: null, metadata: {} }],
        [
          "s_vehicle",
          { id: "s_vehicle", ruleName: "PartDefinition", name: "Vehicle", parentId: "s_pkg", metadata: {} },
        ],
        ["s_car", { id: "s_car", ruleName: "PartDefinition", name: "Car", parentId: "s_pkg", metadata: {} }],
        // OwnedSubclassification child on Car referencing Vehicle
        [
          "s_subclass",
          {
            id: "s_subclass",
            ruleName: "OwnedSubclassification",
            name: "Vehicle",
            parentId: "s_car",
            metadata: {},
          },
        ],
      ]),
      childrenOf: new Map([
        ["s_pkg", ["s_vehicle", "s_car"]],
        ["s_car", ["s_subclass"]],
      ]),
    };

    const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, "BDD");
    assert(data, "Diagram data should be generated");

    // Verify specialization edge exists
    const specEdge = data.edges.find((e: any) => e.id.startsWith("specialization_"));
    assert(specEdge, "Specialization edge should be emitted");
    assert.strictEqual(specEdge.target, "n_s_vehicle");
    assert.strictEqual(specEdge.source, "n_s_car");

    // Verify targetMarker is UML hollow triangle
    const targetMarker = specEdge.attrs?.line?.targetMarker as any;
    assert(targetMarker, "targetMarker must be defined");
    assert.strictEqual(targetMarker.name, "path");
    assert.strictEqual(targetMarker.fill, "#ffffff");
  });

  it("should distinguish delegation vs assembly connectors in IBD", () => {
    const fakeIndex = {
      symbols: new Map([
        ["s_system", { id: "s_system", ruleName: "PartDefinition", name: "System", parentId: null, metadata: {} }],
        ["s_extPort", { id: "s_extPort", ruleName: "PortUsage", name: "powerIn", parentId: "s_system", metadata: {} }],
        ["s_sub1", { id: "s_sub1", ruleName: "PartUsage", name: "engine", parentId: "s_system", metadata: {} }],
        ["s_sub1_port", { id: "s_sub1_port", ruleName: "PortUsage", name: "power", parentId: "s_sub1", metadata: {} }],
        ["s_sub2", { id: "s_sub2", ruleName: "PartUsage", name: "transmission", parentId: "s_system", metadata: {} }],
        ["s_sub2_port", { id: "s_sub2_port", ruleName: "PortUsage", name: "drive", parentId: "s_sub2", metadata: {} }],
        // Delegation: System.powerIn -> engine.power
        [
          "c_delegation",
          {
            id: "c_delegation",
            ruleName: "ConnectionUsage",
            name: "c1",
            parentId: "s_system",
            metadata: { source: "powerIn", target: "engine.power" },
          },
        ],
        // Assembly: engine.power -> transmission.drive
        [
          "c_assembly",
          {
            id: "c_assembly",
            ruleName: "ConnectionUsage",
            name: "c2",
            parentId: "s_system",
            metadata: { source: "engine.power", target: "transmission.drive" },
          },
        ],
      ]),
      childrenOf: new Map([
        ["s_system", ["s_extPort", "s_sub1", "s_sub2", "c_delegation", "c_assembly"]],
        ["s_sub1", ["s_sub1_port"]],
        ["s_sub2", ["s_sub2_port"]],
      ]),
    };

    const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, "IBD");
    assert(data, "IBD data should be generated");

    const delEdge = data.edges.find((e: any) => e.id.includes("c_delegation"));
    const asmEdge = data.edges.find((e: any) => e.id.includes("c_assembly"));

    assert(delEdge, "Delegation connector must exist");
    assert(asmEdge, "Assembly connector must exist");

    // Delegation connector has dashed stroke
    assert.strictEqual(delEdge.attrs?.line?.strokeDasharray, "4 2");
    // Assembly connector has solid stroke (undefined or not dashed)
    assert.strictEqual(asmEdge.attrs?.line?.strokeDasharray, undefined);
  });

  it("should generate pseudostates and format transition labels trigger [guard] / effect", () => {
    const fakeIndex = {
      symbols: new Map([
        ["s_sm", { id: "s_sm", ruleName: "StateDefinition", name: "EngineController", parentId: null, metadata: {} }],
        ["s_off", { id: "s_off", ruleName: "StateUsage", name: "Off", parentId: "s_sm", metadata: {} }],
        ["s_running", { id: "s_running", ruleName: "StateUsage", name: "Running", parentId: "s_sm", metadata: {} }],
        [
          "t1",
          {
            id: "t1",
            ruleName: "TransitionUsage",
            name: "startEngine",
            parentId: "s_sm",
            metadata: {
              source: "Off",
              target: "Running",
              trigger: "keyTurn",
              guard: "fuelLevel > 0",
              effect: "ignite()",
            },
          },
        ],
      ]),
      childrenOf: new Map([["s_sm", ["s_off", "s_running", "t1"]]]),
    };

    const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, "StateMachine");
    assert(data, "StateMachine diagram should be generated");

    // Verify initial pseudostate node
    const initialNode = data.nodes.find((n: any) => n.id === "__pseudo_initial__");
    assert(initialNode, "Initial pseudostate node must exist");

    // Verify final pseudostate node
    const finalNode = data.nodes.find((n: any) => n.id === "__pseudo_final__");
    assert(finalNode, "Final pseudostate node must exist");

    // Verify transition edge label formatting
    const transEdge = data.edges.find((e: any) => e.id.includes("t1"));
    assert(transEdge, "Transition edge must exist");
    const label = transEdge.labels?.[0]?.attrs?.text?.text;
    assert.strictEqual(label, "keyTurn [fuelLevel > 0] / ignite()");
  });

  it("should position action nodes within allocated swimlane partition boundaries", () => {
    const data = {
      nodes: [
        { id: "act_steer", width: 120, height: 40, x: 0, y: 0 },
        { id: "act_brake", width: 120, height: 40, x: 0, y: 0 },
        { id: "act_fuel", width: 120, height: 40, x: 0, y: 0 },
      ],
      edges: [],
    };

    const partitions: SwimlanePartition[] = [
      { id: "driver", name: "Driver", nodeIds: ["act_steer", "act_brake"] },
      { id: "powertrain", name: "Powertrain", nodeIds: ["act_fuel"] },
    ];

    applySwimlaneLayout(data, partitions);

    const laneDriver = data.nodes.find((n: any) => n.id === "swimlane_driver");
    const lanePowertrain = data.nodes.find((n: any) => n.id === "swimlane_powertrain");
    assert(laneDriver, "Driver swimlane node must exist");
    assert(lanePowertrain, "Powertrain swimlane node must exist");

    const steer = data.nodes.find((n: any) => n.id === "act_steer")!;
    const fuel = data.nodes.find((n: any) => n.id === "act_fuel")!;

    // Steer must be contained inside driver lane bounds
    assert.ok(steer.x >= laneDriver.x);
    assert.ok(steer.x + steer.width <= laneDriver.x + laneDriver.width);

    // Fuel must be contained inside powertrain lane bounds
    assert.ok(fuel.x >= lanePowertrain.x);
    assert.ok(fuel.x + fuel.width <= lanePowertrain.x + lanePowertrain.width);
  });
});
