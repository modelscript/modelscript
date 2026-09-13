import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDiagramFromDSL } from "../src/polyglot-diagram-builder.js";

describe("DSL to X6 Diagram Adapter", () => {
  it("should adapt raw AST diagram data with DSL diagram configuration", () => {
    const rawData = {
      nodes: [
        {
          id: "node_100",
          nodePtr: 100,
          typeId: 1,
          startByte: 0,
          endByte: 120,
          x: 20,
          y: 40,
          width: 200,
          height: 120,
          rotation: 0,
          text: "model ElectricalCircuit\n  Real voltage = 12.0;\n  Real power;\n  power = voltage;\nend ElectricalCircuit;",
        },
        {
          id: "node_200",
          nodePtr: 200,
          typeId: 2,
          startByte: 26,
          endByte: 47,
          x: 50,
          y: 80,
          width: 140,
          height: 60,
          rotation: 0,
          text: "Real voltage = 12.0;",
        },
        {
          id: "node_201",
          nodePtr: 201,
          typeId: 2,
          startByte: 50,
          endByte: 62,
          x: 50,
          y: 150,
          width: 140,
          height: 60,
          rotation: 0,
          text: "Real power;",
        },
        {
          id: "node_300",
          nodePtr: 300,
          typeId: 3,
          startByte: 65,
          endByte: 82,
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          rotation: 0,
          text: "power = voltage;",
        },
      ],
      edges: [],
    };

    const syntaxNames: Record<number, string> = {
      0: "Program",
      1: "ModelDef",
      2: "Decl",
      3: "Equation",
    };

    const diagramConfig = {
      views: {
        Schematic: { label: "Schematic View" },
        IBD: { label: "Internal Block Diagram" },
      },
      nodes: {
        ModelDef: {
          shape: "subsystem",
          style: { fill: "#1e293b", stroke: "#38bdf8", strokeWidth: 2, rx: 8, ry: 8 },
        },
        Decl: {
          stereotype: "«component»",
          shape: "rect",
          style: { fill: "#0f172a", stroke: "#3b82f6", strokeWidth: 2, rx: 6, ry: 6 },
          ports: {
            group: "auto",
            style: { fill: "#38bdf8", stroke: "#ffffff", size: 6 },
          },
          propertyBindings: {
            label: "%name (%type)",
          },
        },
      },
      edges: {
        Equation: {
          source: "lhs",
          target: "rhs",
          style: {
            router: "manhattan",
            connector: "jumpover",
            stroke: "#60a5fa",
            strokeWidth: 2,
          },
        },
      },
    };

    const result = buildDiagramFromDSL(rawData, diagramConfig, syntaxNames, "Schematic");

    assert.ok(result);
    assert.strictEqual(result.nodes.length, 3); // 1 ModelDef container + 2 Decl components (Program and Equation are filtered/transformed)
    assert.strictEqual(result.edges.length, 1); // 1 Equation edge (voltage -> power)

    const modelNode = result.nodes.find((n) => n.id === "node_100");
    assert.ok(modelNode);
    assert.strictEqual(modelNode?.zIndex, -1); // subsystem container zIndex
    assert.strictEqual(modelNode?.width, 200);

    const voltageNode = result.nodes.find((n) => n.id === "node_200");
    assert.ok(voltageNode);
    assert.strictEqual(voltageNode?.parent, "node_100");
    assert.strictEqual(voltageNode?.ports?.items?.length, 2); // in & out ports

    const powerNode = result.nodes.find((n) => n.id === "node_201");
    assert.ok(powerNode);
    assert.strictEqual(powerNode?.parent, "node_100");

    const edge = result.edges[0];
    assert.deepStrictEqual(edge.source, { cell: "node_200", port: "port_out" });
    assert.deepStrictEqual(edge.target, { cell: "node_201", port: "port_in" });
    assert.deepStrictEqual(edge.router, { name: "manhattan" });
    assert.deepStrictEqual(edge.connector, { name: "jumpover" });
    assert.strictEqual(edge.attrs.line.stroke, "#60a5fa");
  });
});
