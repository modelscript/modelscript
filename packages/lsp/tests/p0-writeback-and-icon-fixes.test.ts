// SPDX-License-Identifier: AGPL-3.0-or-later

import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import modelicaLanguage from "@modelscript/modelica/language";
import { reqifLanguage } from "@modelscript/reqif";
import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ModelicaDiagramBackend } from "../src/diagramApi.js";
import { applyIconEditActions, parseIconPrimitive } from "../src/icon-annotation-edits.js";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { computeWritebackEdit } from "../src/services/writeback-service.js";

(globalThis as any).modelicaDiagramOps = modelicaDiagramOps;

test("applyIconEditActions ignores comments/strings, translates Line points, preserves parametric extents, and avoids empty {}", () => {
  const src = `model First
  String note = "Icon(graphics={Rectangle(extent={{-10,-10},{10,10}})})";
  annotation(Icon(graphics={Rectangle(extent={{-50,-50},{50,50}})}));
end First;

model Second
  parameter Real L = 80;
  annotation(
    Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-L,-20},{L,20}}),
        Line(points={{-20,0},{20,0}}, color={0,0,255})
      }
    )
  );
end Second;`;

  // 1. Update Line via move extent -> should translate `points` and NOT inject `extent=...`
  const moved = applyIconEditActions(src, "Second", [
    {
      type: "updateIconPrimitive",
      index: 1,
      patch: {
        extent: [
          [0, 10],
          [40, 10],
        ],
      },
    },
  ]);
  assert.ok(moved.includes("Line(points={{0,10},{40,10}}"), "Line must translate points without adding extent=");
  assert.ok(!moved.includes("NaN"), "Parametric Rectangle extent must not emit NaN");
  assert.ok(moved.includes("extent={{-L,-20},{L,20}}"), "Parametric extent must be preserved intact");
  assert.ok(moved.includes("model First"), "Earlier sibling model and string literal must be untouched");

  // 2. Parametric parse check must not yield NaN coordinates
  const parsedParam = parseIconPrimitive("Rectangle(extent={{-L,-20},{L,20}})");
  assert.ok(parsedParam);
  assert.strictEqual(parsedParam.extent, undefined, "Parametric extent should not populate NaN numeric array");

  // 3. Deleting all primitives from First must NOT emit illegal Modelica `graphics={}` ([M1003])
  const deletedFirst = applyIconEditActions(src, "First", [{ type: "deleteIconPrimitive", index: 0 }]);
  assert.ok(!deletedFirst.includes("graphics={}"), "Must never emit illegal empty {} array constructor");
});

test("ModelicaDiagramBackend executes mixed icon + port actions in one batch without dropping icon edits", async () => {
  let docText = `model MyBlock
  Modelica.Blocks.Interfaces.RealInput u annotation(Placement(transformation(extent={{-120,-20},{-80,20}})));
  annotation(
    Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(extent={{-80,-80},{80,80}})
      }
    )
  );
end MyBlock;`;

  const backend = new ModelicaDiagramBackend({
    getDocumentText: () => docText,
    getDocumentInstances: () => [
      {
        name: "MyBlock",
        components: [{ name: "u", typeName: "Modelica.Blocks.Interfaces.RealInput" }],
        connectEquations: [],
      },
    ],
    resolveClassInstance: () => null,
    getDiagramConfig: () => undefined,
    flushValidation: async () => {},
  });

  const res = await backend.applyEdits({
    uri: "file:///workspace/MyBlock.mo",
    seq: 1,
    className: "MyBlock",
    diagramType: "icon",
    actions: [
      {
        type: "move",
        items: [
          { name: "__icon_gfx_0", x: -60, y: -60, width: 120, height: 120, rotation: 0 },
          { name: "u", x: -110, y: -10, width: 20, height: 20, rotation: 0 },
        ],
      },
    ],
  });

  assert.ok(res.edits.length > 0, "Expected edits from mixed icon + port move");
  const lines = docText.split("\n");
  const sorted = [...res.edits].sort((a, b) =>
    a.range.start.line !== b.range.start.line
      ? b.range.start.line - a.range.start.line
      : b.range.start.character - a.range.start.character,
  );
  for (const e of sorted) {
    const startOff =
      lines.slice(0, e.range.start.line).reduce((acc, l) => acc + l.length + 1, 0) + e.range.start.character;
    const endOff = lines.slice(0, e.range.end.line).reduce((acc, l) => acc + l.length + 1, 0) + e.range.end.character;
    docText = docText.slice(0, startOff) + e.newText + docText.slice(endOff);
  }
  assert.ok(docText.includes("Rectangle(extent={{-60,-60},{60,60}})"), "Icon primitive resize/move must apply");
  assert.ok(
    docText.includes("iconTransformation(origin={-100,0}"),
    "Port icon-layer edit must apply alongside icon edit",
  );
});

test("computeWritebackEdit scopes lookup by documentUri before picking foreign symbols", async () => {
  globalLanguageRegistry.register({
    id: "modelica",
    name: "Modelica",
    extensions: [".mo"],
    languageDef: modelicaLanguage,
  });

  const uriA = "file:///workspace/A.mo";
  const uriB = "file:///workspace/B.mo";
  const textA = "model A\n  parameter Real R = 10;\nend A;\n";
  const textB = "model B\n  parameter Real R = 99;\nend B;\n";

  const symbols = new Map<number, any>([
    [1, { id: 1, name: "A", resourceId: uriA, startOffset: 0, endOffset: textA.length }],
    [2, { id: 2, name: "R", parentId: 1, resourceId: uriA, startOffset: 10, endOffset: 31 }],
    [3, { id: 3, name: "B", resourceId: uriB, startOffset: 0, endOffset: textB.length }],
    [4, { id: 4, name: "R", parentId: 3, resourceId: uriB, startOffset: 10, endOffset: 31 }],
  ]);

  const docs = new Map<string, TextDocument>([
    [uriA, TextDocument.create(uriA, "modelica", 1, textA)],
    [uriB, TextDocument.create(uriB, "modelica", 1, textB)],
  ]);

  const mockCtx: any = {
    workspaceManager: {
      unifiedWorkspace: { getIndex: () => ({ symbols }) },
      getWorkspaceIndex: () => null,
    },
    documents: { get: (u: string) => docs.get(u) },
    documentManager: { documentTrees: new Map() },
  };

  const res = await computeWritebackEdit(mockCtx, {
    target: "R",
    newValue: "42",
    documentUri: uriB,
  });

  assert.strictEqual(res.success, true);
  assert.ok(res.workspaceEdit?.changes?.[uriB], "Must edit documentUri B rather than first workspace entry A");
  assert.strictEqual(res.workspaceEdit?.changes?.[uriA], undefined);
});

test("ReqIF language writeback consumes WritebackContext and emits offset WritebackEdit", () => {
  const sampleReqIf = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <CORE-CONTENT><REQ-IF-CONTENT>
    <SPEC-OBJECTS>
      <SPEC-OBJECT IDENTIFIER="REQ-1" LONG-NAME="Speed Limit"></SPEC-OBJECT>
    </SPEC-OBJECTS>
  </REQ-IF-CONTENT></CORE-CONTENT>
</REQ-IF>`;

  const handler =
    typeof reqifLanguage.writeback === "function" ? reqifLanguage.writeback : reqifLanguage.writeback?.handler;
  assert.ok(handler, "ReqIF writeback handler must exist");
  const edits = handler({
    entry: { name: "REQ-1" } as any,
    fullText: sampleReqIf,
    newValue: "Updated Limit",
    uri: "file:///req.reqif",
    field: "longName",
  } as any);

  assert.ok(Array.isArray(edits) && edits.length > 0, "ReqIF writeback must return offset edits");
  const first = edits[0]!;
  assert.strictEqual(typeof first.startOffset, "number");
  assert.strictEqual(typeof first.endOffset, "number");
  const updated = sampleReqIf.slice(0, first.startOffset) + first.newText + sampleReqIf.slice(first.endOffset);
  assert.ok(updated.includes("Updated Limit"));
});
