// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EdgeUpdate, PlacementItem } from "@modelscript/diagram/protocol";
import assert from "node:assert";
import { describe, it } from "node:test";
import { computeEdgePointEdits, computePlacementEdits } from "../src/diagram/edits.js";

describe("Diagram Edits CST Unparser & Edge Cases", () => {
  it("should surgically replace Placement without breaking on string literals with parentheses", () => {
    const docText = `model ComplexAnnotations
  Modelica.Electrical.Analog.Basic.Resistor R1 annotation(Documentation(info="This has (parens) and , commas"), Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}})));
end ComplexAnnotations;`;

    const lines = docText.split("\n");

    // Construct realistic CST node hierarchy as produced by the GLR parser
    const docNode: any = {
      type: "element_modification",
      text: 'Documentation(info="This has (parens) and , commas")',
      startIndex: 58,
      endIndex: 111,
      startPosition: { row: 1, column: 58 },
      endPosition: { row: 1, column: 111 },
      isNamed: true,
      children: [],
    };

    const placementNode: any = {
      type: "element_modification",
      text: "Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}}))",
      startIndex: 113,
      endIndex: 180,
      startPosition: { row: 1, column: 113 },
      endPosition: { row: 1, column: 180 },
      isNamed: true,
      children: [],
    };

    const classModNode: any = {
      type: "class_modification",
      text: '(Documentation(info="This has (parens) and , commas"), Placement(transformation(origin={0,0}, extent={{-10,-10},{10,10}})))',
      startIndex: 57,
      endIndex: 181,
      startPosition: { row: 1, column: 57 },
      endPosition: { row: 1, column: 181 },
      isNamed: true,
      children: [docNode, placementNode],
    };

    const annotationClause: any = {
      type: "annotation_clause",
      text: `annotation${classModNode.text}`,
      startIndex: 47,
      endIndex: 181,
      startPosition: { row: 1, column: 47 },
      endPosition: { row: 1, column: 181 },
      isNamed: true,
      children: [classModNode],
    };

    const compNode: any = {
      type: "component_declaration",
      text: lines[1]!,
      startIndex: 26,
      endIndex: 182,
      startPosition: { row: 1, column: 2 },
      endPosition: { row: 1, column: 182 },
      children: [annotationClause],
      annotationClause,
    };

    const classInstance = {
      name: "ComplexAnnotations",
      components: [
        {
          name: "R1",
          cstNode: compNode,
          annotation: () => ({
            transformation: {
              origin: [0, 0],
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

    const item: PlacementItem = {
      name: "R1",
      x: 100,
      y: 200,
      width: 20,
      height: 20,
    };

    const edits = computePlacementEdits(docText, classInstance, [item]);

    assert.strictEqual(edits.length, 1);
    const edit = edits[0]!;

    // Must target only the placementNode span, leaving Documentation untouched
    assert.strictEqual(edit.range.start.line, 1);
    assert.strictEqual(edit.range.start.character, 113);
    assert.strictEqual(edit.range.end.line, 1);
    assert.strictEqual(edit.range.end.character, 180);

    // Verify replacement text contains the updated coordinates
    assert.ok(edit.newText.includes("origin={110,-210}"));
    assert.ok(edit.newText.includes("extent={{-10,-10},{10,10}}"));

    // Apply edit to text and verify Documentation is preserved perfectly
    const modifiedLine =
      lines[1]!.substring(0, edit.range.start.character) + edit.newText + lines[1]!.substring(edit.range.end.character);

    assert.ok(modifiedLine.includes('Documentation(info="This has (parens) and , commas")'));
    assert.ok(modifiedLine.includes("Placement(transformation(origin={110,-210}"));
  });

  it("should surgically update Line annotations on connect equations using CstUnparser", () => {
    const docText = `model ConnectCircuit
equation
  connect(R1.p, C1.n) annotation(Line(points={{0,0}, {50,50}}, color={0, 0, 255}));
end ConnectCircuit;`;

    const lines = docText.split("\n");

    const lineNode: any = {
      type: "element_modification",
      text: "Line(points={{0,0}, {50,50}}, color={0, 0, 255})",
      startIndex: 54,
      endIndex: 103,
      startPosition: { row: 2, column: 33 },
      endPosition: { row: 2, column: 82 },
      isNamed: true,
      children: [],
    };

    const classModNode: any = {
      type: "class_modification",
      text: "(Line(points={{0,0}, {50,50}}, color={0, 0, 255}))",
      startIndex: 53,
      endIndex: 104,
      startPosition: { row: 2, column: 32 },
      endPosition: { row: 2, column: 83 },
      isNamed: true,
      children: [lineNode],
    };

    const annotationClause: any = {
      type: "annotation_clause",
      text: "annotation(Line(points={{0,0}, {50,50}}, color={0, 0, 255}))",
      startIndex: 43,
      endIndex: 104,
      startPosition: { row: 2, column: 22 },
      endPosition: { row: 2, column: 83 },
      isNamed: true,
      children: [classModNode],
    };

    const eqNode: any = {
      type: "connect_equation",
      text: lines[2]!,
      startIndex: 21,
      endIndex: 105,
      startPosition: { row: 2, column: 2 },
      endPosition: { row: 2, column: 84 },
      children: [annotationClause],
      annotationClause,
    };

    const classInstance = {
      name: "ConnectCircuit",
      components: [],
      connectEquations: [
        {
          componentReference1: { parts: [{ identifier: { text: "R1" } }, { identifier: { text: "p" } }] },
          componentReference2: { parts: [{ identifier: { text: "C1" } }, { identifier: { text: "n" } }] },
          cstNode: eqNode,
        },
      ],
    };

    const edge: EdgeUpdate = {
      source: "R1.p",
      target: "C1.n",
      points: [
        { x: 10, y: 15 },
        { x: 60, y: 75 },
      ],
    };

    const edits = computeEdgePointEdits(lines, classInstance, [edge]);
    assert.strictEqual(edits.length, 1);
    const edit = edits[0]!;

    assert.strictEqual(edit.range.start.line, 2);
    assert.strictEqual(edit.range.start.character, 33);
    assert.strictEqual(edit.range.end.line, 2);
    assert.strictEqual(edit.range.end.character, 82);

    assert.ok(edit.newText.includes("points={{10,15}, {60,75}}"));
  });
});
