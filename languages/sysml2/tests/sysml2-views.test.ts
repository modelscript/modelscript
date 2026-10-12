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

  it("should not render attribute badge on top of title when shortName is not declared", () => {
    const fakeIndex = {
      symbols: new Map([
        [
          "s_trans",
          {
            id: "s_trans",
            ruleName: "PartDefinition",
            name: "Transmission",
            parentId: null,
            metadata: { shortName: null },
          },
        ],
        [
          "s_attr1",
          {
            id: "s_attr1",
            ruleName: "AttributeUsage",
            name: "gearRatio",
            parentId: "s_trans",
            metadata: {},
          },
        ],
        [
          "s_attr2",
          {
            id: "s_attr2",
            ruleName: "AttributeUsage",
            name: "numberOfGears",
            parentId: "s_trans",
            metadata: {},
          },
        ],
      ]),
      childrenOf: new Map([["s_trans", ["s_attr1", "s_attr2"]]]),
    };

    const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, "BDD");
    const transNode = data.nodes.find((n: any) => n.id === "n_s_trans");
    assert(transNode, "Transmission node must exist");
    assert.strictEqual(
      transNode.markup.some((m: any) => m.selector === "idBadgeRect"),
      false,
      "Transmission should not have an idBadgeRect",
    );
    assert.strictEqual((transNode.attrs as any)?.idBadgeText, undefined);
  });

  it("should parse documentation doc /* ... */ comments and use cases without syntax errors", async () => {
    const { createWasmParser } = await import("@modelscript/dsl");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const sysmlWasm = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/parser.wasm");
    const { parser } = await createWasmParser(sysmlWasm);

    const code = `
      package VehicleSystem {
        part def Driver { doc /* Primary operator. */ }
        part def Mechanic { doc /* Service technician. */ }
        part def FleetManager { doc /* Oversees fleet. */ }
        part def Passenger { doc /* Rides vehicle. */ }
        part def ChargingStation { doc /* Recharges battery. */ }
        part def Pedestrian { doc /* External actor. */ }

        use case def DriveVehicle {
          subject vehicle : Vehicle;
          actor driver : Driver;
          include use case startUp : StartVehicle;
          include use case navigate : NavigateRoute;
        }

        use case def StartVehicle {
          subject vehicle : Vehicle;
          actor driver : Driver;
        }
      }
    `;

    const tree = parser.parse(code);
    assert.strictEqual(
      tree.rootNode.hasError(),
      false,
      "VehicleSystem actors and use cases must parse with zero errors",
    );
  });

  it("should render UseCaseDefinition as clean ellipse without rectangular headerBody and with bounded chords", () => {
    const fakeIndex = {
      symbols: new Map([
        ["s_pkg", { id: "s_pkg", ruleName: "Package", name: "VehicleSystem", parentId: null, metadata: {} }],
        [
          "s_uc1",
          { id: "s_uc1", ruleName: "UseCaseDefinition", name: "DriveVehicle", parentId: "s_pkg", metadata: {} },
        ],
        ["s_subj", { id: "s_subj", ruleName: "SubjectUsage", name: "vehicle", parentId: "s_uc1", metadata: {} }],
        ["s_inc1", { id: "s_inc1", ruleName: "IncludeUseCaseUsage", name: "startUp", parentId: "s_uc1", metadata: {} }],
        [
          "s_inc2",
          { id: "s_inc2", ruleName: "IncludeUseCaseUsage", name: "navigate", parentId: "s_uc1", metadata: {} },
        ],
        [
          "s_uc2",
          { id: "s_uc2", ruleName: "UseCaseDefinition", name: "StartVehicle", parentId: "s_pkg", metadata: {} },
        ],
      ]),
      childrenOf: new Map([
        ["s_pkg", ["s_uc1", "s_uc2"]],
        ["s_uc1", ["s_subj", "s_inc1", "s_inc2"]],
      ]),
    };

    const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, "All");
    const uc1 = data.nodes.find((n: any) => n.id === "n_s_uc1");
    const uc2 = data.nodes.find((n: any) => n.id === "n_s_uc2");

    assert(uc1, "DriveVehicle node must exist");
    assert.strictEqual(uc1.shape, "ellipse");
    assert.strictEqual(uc1.markup[0].tagName, "ellipse");
    assert.strictEqual((uc1.attrs as any)?.headerBody, undefined, "UseCase must not have rectangular headerBody path");
    assert((uc1.attrs as any)?.headerSep, "UseCase with compartments must have headerSep");
    assert((uc1.attrs as any)?.headerSep.x1 > 0, "headerSep must be chord-bounded (x1 > 0)");
    assert((uc1.attrs as any)?.headerSep.x2 < uc1.width, "headerSep must be chord-bounded (x2 < width)");

    assert(uc2, "StartVehicle node must exist");
    assert.strictEqual(uc2.shape, "ellipse");
    assert.strictEqual(uc2.markup[0].tagName, "ellipse");
    assert.strictEqual((uc2.attrs as any)?.headerBody, undefined);
  });

  it("should position port labels above the line with args.y offset", () => {
    const fakeIndex = {
      symbols: new Map([
        ["s_sys", { id: "s_sys", ruleName: "PartDefinition", name: "Vehicle", parentId: null, metadata: {} }],
        ["s_pIn", { id: "s_pIn", ruleName: "PortUsage", name: "torqueIn", parentId: "s_sys", metadata: {} }],
        ["s_pOut", { id: "s_pOut", ruleName: "PortUsage", name: "torqueOut", parentId: "s_sys", metadata: {} }],
      ]),
      childrenOf: new Map([["s_sys", ["s_pIn", "s_pOut"]]]),
    };

    const data = buildSysML2DiagramData(fakeIndex as any, "file:///test.sysml", undefined, "All");
    const sysNode = data.nodes.find((n: any) => n.id === "n_s_sys");
    assert(sysNode, "Vehicle node must exist");

    const inPort = sysNode.ports?.items?.find((p: any) => p.id === "torqueIn");
    const outPort = sysNode.ports?.items?.find((p: any) => p.id === "torqueOut");

    assert(inPort, "torqueIn port must exist");
    assert.strictEqual(inPort.label?.position?.name, "left");
    assert.strictEqual(
      (inPort.label?.position as any)?.args?.y,
      -10,
      "Port label must be offset above the line (y = -10)",
    );

    assert(outPort, "torqueOut port must exist");
    assert.strictEqual(outPort.label?.position?.name, "right");
    assert.strictEqual(
      (outPort.label?.position as any)?.args?.y,
      -10,
      "Port label must be offset above the line (y = -10)",
    );
  });
});
