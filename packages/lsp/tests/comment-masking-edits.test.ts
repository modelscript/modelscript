// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { GenericDSLDiagramBackend, maskComments } from "../src/diagramApi.js";

test("maskComments: comment masking preserves offsets while clearing content", () => {
  const code = [
    "// Line comment with text: Component c1;",
    "Component c1; // trailing comment",
    "/* Block comment",
    "   multi-line Component c1; */",
    'Component c2 = "http://example.com/test";',
    "// Another line",
  ].join("\n");

  const masked = maskComments(code);

  // Exact character length and line count must match 100%
  assert.strictEqual(masked.length, code.length);
  assert.strictEqual(masked.split("\n").length, code.split("\n").length);

  const maskedLines = masked.split("\n");

  // Line 0 was entirely a comment -> should be all whitespace
  assert.strictEqual(maskedLines[0].trim(), "");
  assert.ok(!maskedLines[0].includes("Component"));

  // Line 1 had code then trailing comment -> code preserved, trailing comment wiped
  assert.ok(maskedLines[1].startsWith("Component c1;"));
  assert.ok(!maskedLines[1].includes("trailing"));

  // Lines 2 and 3 were block comment -> wiped
  assert.ok(!maskedLines[2].includes("Block"));
  assert.ok(!maskedLines[3].includes("Component"));

  // Line 4 had a string with URL containing '//' -> string content must be preserved!
  assert.ok(maskedLines[4].includes('"http://example.com/test"'));
});

test("GenericDSLDiagramBackend.applyEdits ignores commented-out declarations", async () => {
  const docUri = "file:///workspace/Circuit.dsl";

  const originalDoc = [
    "// Resistor r1; @layout(x=10, y=10)",
    "/* Resistor r1;",
    "   @layout(x=20, y=20) */",
    "Resistor r1; @layout(x=100, y=100)",
    "Resistor r2;",
  ].join("\n");

  let currentDoc = originalDoc;

  const backend = new GenericDSLDiagramBackend({
    getDocumentText: (uri) => (uri === docUri ? currentDoc : undefined),
    getDiagramConfig: () => ({
      placement: {
        persistence: "inline",
      },
    }),
  });

  // 1. Move r1 to (300, 400)
  const moveResult = await backend.applyEdits({
    uri: docUri,
    seq: 1,
    actions: [
      {
        type: "move",
        items: [{ name: "r1", x: 300, y: 400 }],
      },
    ],
  });

  assert.strictEqual(moveResult.edits.length, 1, "Must generate exactly 1 edit for active r1");
  // The edit must target line 3 (index 3), NOT line 0 or lines 1-2!
  assert.strictEqual(moveResult.edits[0].range.start.line, 3);
  assert.strictEqual(moveResult.edits[0].newText, "@layout(x=300, y=400)");

  // 2. Delete r1
  const deleteResult = await backend.applyEdits({
    uri: docUri,
    seq: 2,
    actions: [
      {
        type: "deleteComponents",
        names: ["r1"],
      },
    ],
  });

  assert.strictEqual(deleteResult.edits.length, 1);
  // Must delete line 3, NOT line 0
  assert.strictEqual(deleteResult.edits[0].range.start.line, 3);
});

test("GenericDSLDiagramBackend.applyEdits parameter update ignores commented parameters", async () => {
  const docUri = "file:///workspace/Circuit.dsl";

  const originalDoc = ["// Resistor r1(R = 100);", "Resistor r1(R = 50);"].join("\n");

  const backend = new GenericDSLDiagramBackend({
    getDocumentText: (uri) => (uri === docUri ? originalDoc : undefined),
    getDiagramConfig: () => ({}),
  });

  const paramResult = await backend.applyEdits({
    uri: docUri,
    seq: 1,
    actions: [
      {
        type: "updateParameter",
        name: "r1",
        parameter: "R",
        value: 220,
      },
    ],
  });

  assert.strictEqual(paramResult.edits.length, 1);
  // Target must be line 1 (the active code), NOT line 0 (commented code)
  assert.strictEqual(paramResult.edits[0].range.start.line, 1);
  assert.strictEqual(paramResult.edits[0].newText, "220");
});
