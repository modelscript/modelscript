// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramApplyEditsParams } from "@modelscript/diagram/protocol";
import assert from "node:assert";
import { describe, it } from "node:test";
import { GenericDSLDiagramBackend } from "../src/diagramApi.js";

describe("LSP Diagram Phase 4 (Inline Placement & Reconnect)", () => {
  it("generates inline AST placement TextEdits when persistence is 'inline'", async () => {
    let docText = `package MyModel {
  Component comp1;
  Component comp2;
}`;

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => docText,
      getDiagramConfig: () => ({
        placement: {
          persistence: "inline",
          formatPlacement: (x, y) => `@layout(x=${x}, y=${y})`,
        },
      }),
    });

    const params: DiagramApplyEditsParams = {
      seq: 1,
      uri: "file:///test.dsl",
      actions: [
        {
          type: "move",
          items: [{ name: "comp1", x: 120, y: 80, width: 100, height: 50, rotation: 0 }],
        },
      ],
    };

    const res = await backend.applyEdits(params);
    assert.strictEqual(res.edits.length, 1);
    assert.ok(res.edits[0].newText.includes("@layout(x=120, y=80)"));
  });

  it("handles edge reconnection by rewriting connection statement in-place", async () => {
    const docText = `package MyModel {
  connect(pump.out, tank.in);
}`;

    const backend = new GenericDSLDiagramBackend({
      getDocumentText: () => docText,
      getDiagramConfig: () => ({
        mutations: {
          edgeTemplates: {
            FluidFlow: (src: string, tgt: string) => `connect(${src}, ${tgt});`,
          },
        },
      }),
    });

    const params: DiagramApplyEditsParams = {
      seq: 2,
      uri: "file:///test.dsl",
      actions: [
        {
          type: "reconnect",
          oldSource: "pump.out",
          oldTarget: "tank.in",
          newSource: "pump.out",
          newTarget: "filter.in",
        },
      ],
    };

    const res = await backend.applyEdits(params);
    assert.strictEqual(res.edits.length, 1);
    assert.ok(res.edits[0].newText.includes("connect(pump.out, filter.in);"));
  });
});
