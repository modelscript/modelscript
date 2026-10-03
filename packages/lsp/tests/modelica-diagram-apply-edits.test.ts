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
});
