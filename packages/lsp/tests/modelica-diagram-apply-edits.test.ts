// SPDX-License-Identifier: AGPL-3.0-or-later

import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import assert from "node:assert";
import { describe, it } from "node:test";
import { ModelicaDiagramBackend } from "../src/diagramApi.js";

// Register ops into globalThis as the LSP server does
(globalThis as any).modelicaDiagramOps = modelicaDiagramOps;

describe("Modelica Diagram applyEdits Optimization", () => {
  const uri = "file:///workspace/Circuit.mo";
  const sourceText = `model Circuit
  Modelica.Electrical.Analog.Basic.Resistor R1 annotation(Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}})));
  Modelica.Electrical.Analog.Basic.Capacitor C1 annotation(Placement(transformation(origin={50,0}, extent={{-10,-10},{10,10}})));
end Circuit;`;

  const mockClassInstance = {
    name: "Circuit",
    components: [
      {
        name: "R1",
        cstNode: {
          startPosition: { row: 1, column: 2 },
          endPosition: { row: 1, column: 130 },
          annotationClause: {
            startPosition: { row: 1, column: 44 },
            endPosition: { row: 1, column: 129 },
          },
        },
        annotation: (_name: string) => ({
          transformation: {
            origin: [0, 0],
            extent: [
              [-10, -10],
              [10, 10],
            ],
          },
        }),
      },
      {
        name: "C1",
        cstNode: {
          startPosition: { row: 2, column: 2 },
          endPosition: { row: 2, column: 132 },
          annotationClause: {
            startPosition: { row: 2, column: 46 },
            endPosition: { row: 2, column: 131 },
          },
        },
        annotation: (_name: string) => ({
          transformation: {
            origin: [50, 0],
            extent: [
              [-10, -10],
              [10, 10],
            ],
          },
        }),
      },
    ],
    connectEquations: [],
  };

  it("applies move edits instantly without calling flushValidation when instances are cached", async () => {
    let flushValidationCalled = false;

    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: (u) => (u === uri ? [mockClassInstance] : undefined),
      getDocumentText: (u) => (u === uri ? sourceText : undefined),
      resolveClassInstance: () => mockClassInstance,
      flushValidation: async () => {
        flushValidationCalled = true;
      },
    });

    const res = await backend.applyEdits({
      uri,
      seq: 1,
      actions: [
        {
          type: "move",
          items: [
            {
              name: "R1",
              x: 100,
              y: -50,
              width: 20,
              height: 20,
              rotation: 0,
            },
          ],
        },
      ],
    });

    // flushValidation should NOT have been called because instances are already valid
    assert.strictEqual(flushValidationCalled, false, "flushValidation should be skipped when instances are cached");
    assert.strictEqual(res.edits.length, 1);
    assert.ok(res.edits[0].newText.includes("origin={110,40}"));
    assert.strictEqual(res.renderHint, "none");
  });

  it("falls back to flushValidation when instances are missing", async () => {
    let flushValidationCalled = false;
    let instancesAvailable = false;

    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: (u) => (instancesAvailable && u === uri ? [mockClassInstance] : undefined),
      getDocumentText: (u) => (u === uri ? sourceText : undefined),
      resolveClassInstance: () => mockClassInstance,
      flushValidation: async () => {
        flushValidationCalled = true;
        instancesAvailable = true;
      },
    });

    const res = await backend.applyEdits({
      uri,
      seq: 2,
      actions: [
        {
          type: "move",
          items: [
            {
              name: "R1",
              x: 100,
              y: -50,
              width: 20,
              height: 20,
              rotation: 0,
            },
          ],
        },
      ],
    });

    assert.strictEqual(flushValidationCalled, true, "flushValidation should be called when instances are missing");
    assert.strictEqual(res.edits.length, 1);
    assert.ok(res.edits[0].newText.includes("origin={110,40}"));
  });

  it("handles line shifts gracefully without failing", async () => {
    // Add extra lines before the component declarations to simulate an edit above
    const shiftedDocText = `model Circuit
  // Added comment line 1
  // Added comment line 2
  Modelica.Electrical.Analog.Basic.Resistor R1 annotation(Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}})));
  Modelica.Electrical.Analog.Basic.Capacitor C1 annotation(Placement(transformation(origin={50,0}, extent={{-10,-10},{10,10}})));
end Circuit;`;

    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: () => [mockClassInstance],
      getDocumentText: () => shiftedDocText,
      resolveClassInstance: () => mockClassInstance,
      flushValidation: async () => {},
    });

    const res = await backend.applyEdits({
      uri,
      seq: 3,
      actions: [
        {
          type: "move",
          items: [
            {
              name: "R1",
              x: 200,
              y: -100,
              width: 20,
              height: 20,
              rotation: 0,
            },
          ],
        },
      ],
    });

    assert.strictEqual(res.edits.length, 1);
    // Edit should target line 3 (0-indexed) where R1 is now located
    assert.strictEqual(res.edits[0].range.start.line, 3);
    assert.ok(res.edits[0].newText.includes("origin={210,90}"));
  });

  it("extracts all components, edges and coordinateSystem for demo RLCCircuit", async () => {
    const rlcCode = `model RLCCircuit "RLC circuit with Modelica Standard Library components"
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)
    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));
  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)
    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));
  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)
    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));
  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)
    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));
equation
  connect(Vb.p, L.p)
    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));
  connect(L.n, C.p)
    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));
  connect(L.n, R.p)
    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));
  connect(R.n, Vb.n)
    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));
  connect(C.n, Vb.n)
    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));
  connect(Vb.n, ground.p)
    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));
  annotation(
    Icon(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}})),
    Diagram(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}))
  );
end RLCCircuit;`;

    const rlcUri = "file:///playground/RLCCircuit.mo";
    const ops = modelicaDiagramOps as any;
    assert.ok(typeof ops.buildDiagramData === "function", "buildDiagramData must be exported");

    const rlcMockClass: any = {
      name: "RLCCircuit",
      components: [
        {
          name: "Vb",
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [-70, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
        {
          name: "L",
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [0, 40],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
        {
          name: "C",
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [20, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
        {
          name: "R",
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [60, 0],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                    rotation: 270,
                  },
                }
              : null,
        },
        {
          name: "ground",
          annotation: (name: string) =>
            name === "Placement"
              ? {
                  transformation: {
                    origin: [-70, -40],
                    extent: [
                      [-10, -10],
                      [10, 10],
                    ],
                  },
                }
              : null,
        },
      ],
      connectEquations: [
        { lhs: "Vb.p", rhs: "L.p", annotation: () => ({ color: [0, 0, 255] }) },
        { lhs: "L.n", rhs: "C.p", annotation: () => ({ color: [0, 0, 255] }) },
        { lhs: "L.n", rhs: "R.p", annotation: () => ({ color: [0, 0, 255] }) },
        { lhs: "R.n", rhs: "Vb.n", annotation: () => ({ color: [0, 0, 255] }) },
        { lhs: "C.n", rhs: "Vb.n", annotation: () => ({ color: [0, 0, 255] }) },
        { lhs: "Vb.n", rhs: "ground.p", annotation: () => ({ color: [0, 0, 255] }) },
      ],
      annotation: (name: string) =>
        name === "Diagram"
          ? {
              coordinateSystem: {
                preserveAspectRatio: false,
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
            }
          : null,
    };

    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: () => [rlcMockClass],
      getDocumentText: () => rlcCode,
      resolveClassInstance: () => rlcMockClass,
      flushValidation: async () => {},
    });

    const data = await backend.getData({ uri: rlcUri, className: "RLCCircuit" });
    assert.ok(data, "Diagram data must not be null");
    assert.strictEqual(data.coordinateSystem.extent[0][0], -100);
    assert.strictEqual(data.coordinateSystem.extent[1][1], 100);

    const compNodes = data.nodes.filter((n: any) => !n.id.startsWith("solder_dot_"));
    assert.strictEqual(compNodes.length, 5, "Must contain all 5 circuit components (Vb, L, C, R, ground)");
    assert.deepStrictEqual(compNodes.map((n: any) => n.id).sort(), ["C", "L", "R", "Vb", "ground"]);
    assert.ok(data.edges.length >= 6, "Must contain at least 6 connection edges");
  });

  it("applies resize edits with renderHint: immediate and updates component extent", async () => {
    const backend = new ModelicaDiagramBackend({
      getDocumentInstances: (u) => (u === uri ? [mockClassInstance] : undefined),
      getDocumentText: (u) => (u === uri ? sourceText : undefined),
      resolveClassInstance: () => mockClassInstance,
      flushValidation: async () => {},
    });

    const res = await backend.applyEdits({
      uri,
      seq: 2,
      actions: [
        {
          type: "resize",
          item: {
            name: "R1",
            x: -20,
            y: -30,
            width: 40,
            height: 60,
            rotation: 0,
          },
        },
      ],
    });

    assert.strictEqual(res.renderHint, "immediate", "Resize must return renderHint: immediate");
    assert.strictEqual(res.edits.length, 1);
    // w=40, h=60 => extent={{-20,-30},{20,30}}, origin={0,0}
    assert.ok(
      res.edits[0].newText.includes("extent={{-20,-30},{20,30}}"),
      `Expected newText to contain extent={{-20,-30},{20,30}}, got: ${res.edits[0].newText}`,
    );
  });
});
