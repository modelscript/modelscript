// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EdgeUpdate, PlacementItem } from "@modelscript/diagram/protocol";
import assert from "node:assert";
import { describe, it } from "node:test";
import { evaluateMacroExpression, extractCstNestedModifierValue } from "../src/diagram/data.js";
import {
  computeConnectRemove,
  computeDescriptionEdit,
  computeEdgePointEdits,
  computeParameterEdit,
  computePlacementEdits,
} from "../src/diagram/edits.js";

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

  describe("Component Parameter Edits via CstUnparser", async () => {
    const { createWasmParser } = await import("@modelscript/modelica/parser");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const { parser } = await createWasmParser(modelicaWasm);

    function findNodeByType(node: any, type: string): any {
      if (!node) return null;
      if (node.type === type) return node;
      for (const ch of node.children || []) {
        const found = findNodeByType(ch, type);
        if (found) return found;
      }
      return null;
    }

    it("surgically updates existing parameter value in-place without adding duplicate modifiers", () => {
      const code = `model RLC
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50) annotation(Placement(transformation(origin={-102,20}, extent={{-10,-10},{10,10}}, rotation=270)));
end RLC;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const classInstance = {
        name: "RLC",
        components: [{ name: "Vb", cstNode: compDecl }],
      };

      const edits = computeParameterEdit(classInstance as any, "Vb", "V", "101");
      assert.strictEqual(edits.length, 1);
      const lines = code.split("\n");
      const edit = edits[0]!;
      const modifiedLine =
        lines[edit.range.start.line]!.substring(0, edit.range.start.character) +
        edit.newText +
        lines[edit.range.end.line]!.substring(edit.range.end.character);

      assert.ok(modifiedLine.includes("Vb(V = 101, f = 50)"));
      assert.ok(!modifiedLine.includes("Vb(V=101)("));
    });

    it("appends new parameter to existing class modification using CstUnparser", () => {
      const code = `model RLC
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(f = 50);
end RLC;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const classInstance = {
        name: "RLC",
        components: [{ name: "Vb", cstNode: compDecl }],
      };

      const edits = computeParameterEdit(classInstance as any, "Vb", "V", "101");
      assert.strictEqual(edits.length, 1);
      const lines = code.split("\n");
      const edit = edits[0]!;
      const modifiedLine =
        lines[edit.range.start.line]!.substring(0, edit.range.start.character) +
        edit.newText +
        lines[edit.range.end.line]!.substring(edit.range.end.character);

      assert.ok(modifiedLine.includes("Vb(f = 50, V = 101)"));
    });

    it("deletes parameter when multiple arguments exist in class modification", () => {
      const code = `model RLC
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50);
end RLC;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const classInstance = {
        name: "RLC",
        components: [{ name: "Vb", cstNode: compDecl }],
      };

      const edits = computeParameterEdit(classInstance as any, "Vb", "V", "");
      assert.strictEqual(edits.length, 1);
      const lines = code.split("\n");
      const edit = edits[0]!;
      const modifiedLine =
        lines[edit.range.start.line]!.substring(0, edit.range.start.character) +
        edit.newText +
        lines[edit.range.end.line]!.substring(edit.range.end.character);

      assert.ok(modifiedLine.includes("Vb(f = 50)"));
      assert.ok(!modifiedLine.includes("V = 10"));
    });

    it("removes entire modification when sole parameter is deleted", () => {
      const code = `model RLC
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10);
end RLC;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const classInstance = {
        name: "RLC",
        components: [{ name: "Vb", cstNode: compDecl }],
      };

      const edits = computeParameterEdit(classInstance as any, "Vb", "V", "");
      assert.strictEqual(edits.length, 1);
      const lines = code.split("\n");
      const edit = edits[0]!;
      const modifiedLine =
        lines[edit.range.start.line]!.substring(0, edit.range.start.character) +
        edit.newText +
        lines[edit.range.end.line]!.substring(edit.range.end.character);

      assert.ok(modifiedLine.includes("SineVoltage Vb;"));
      assert.ok(!modifiedLine.includes("("));
    });

    it("inserts modification on component declaration with no existing modifiers", () => {
      const code = `model RLC
  Modelica.Electrical.Analog.Sources.SineVoltage Vb annotation(Placement(transformation(origin={0,0})));
end RLC;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const classInstance = {
        name: "RLC",
        components: [{ name: "Vb", cstNode: compDecl }],
      };

      const edits = computeParameterEdit(classInstance as any, "Vb", "V", "101");
      assert.strictEqual(edits.length, 1);
      const lines = code.split("\n");
      const edit = edits[0]!;
      const modifiedLine =
        lines[edit.range.start.line]!.substring(0, edit.range.start.character) +
        edit.newText +
        lines[edit.range.end.line]!.substring(edit.range.end.character);

      assert.ok(modifiedLine.includes("Vb(V=101) annotation") || modifiedLine.includes("Vb(V = 101) annotation"));
    });

    it("evaluates macro expressions using real CST component instances", () => {
      const code = `model Circuit
  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 230, f = 50);
end Circuit;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const componentInstance = {
        name: "Vb",
        cstNode: compDecl,
      };

      const vVal = evaluateMacroExpression("%V", undefined, componentInstance as any);
      assert.strictEqual(vVal, "230");

      const fVal = evaluateMacroExpression("%f", undefined, componentInstance as any);
      assert.strictEqual(fVal, "50");
    });

    it("extracts nested modifiers e.g. start attribute from real CST component", () => {
      const code = `model Circuit
  Modelica.Electrical.Analog.Basic.Resistor R1(R(start = 100));
  Modelica.Electrical.Analog.Basic.Capacitor C1(C.start = 1e-6);
end Circuit;`;
      const tree = parser.parse(code);
      const compDecls: any[] = [];
      const walk = (node: any) => {
        if (node.type === "component_declaration") compDecls.push(node);
        for (const ch of node.children || []) walk(ch);
      };
      walk(tree.rootNode);

      const rStart = extractCstNestedModifierValue(compDecls[0], "R", "start");
      assert.strictEqual(rStart, "100");

      const cStart = extractCstNestedModifierValue(compDecls[1], "C", "start");
      assert.strictEqual(cStart, "1e-6");
    });

    it("computeDescriptionEdit modifies only description string and preserves Placement annotation", () => {
      const code = `model Circuit
  Modelica.Electrical.Analog.Basic.Resistor R1 "Old Resistor" annotation(Placement(transformation(origin={10,20})));
end Circuit;`;
      const tree = parser.parse(code);
      const compDecl = findNodeByType(tree.rootNode, "component_declaration");
      const classInstance = {
        name: "Circuit",
        components: [{ name: "R1", cstNode: compDecl }],
      };

      // 1. Update description
      const updateEdits = computeDescriptionEdit(code, classInstance as any, "R1", "New Resistor");
      assert.strictEqual(updateEdits.length, 1);
      const lines = code.split("\n");
      const edit = updateEdits[0]!;
      const modifiedLine =
        lines[edit.range.start.line]!.substring(0, edit.range.start.character) +
        edit.newText +
        lines[edit.range.end.line]!.substring(edit.range.end.character);

      assert.ok(modifiedLine.includes('"New Resistor"'));
      assert.ok(modifiedLine.includes("annotation(Placement(transformation(origin={10,20})))"));

      // 2. Clear description
      const clearEdits = computeDescriptionEdit(code, classInstance as any, "R1", "");
      assert.strictEqual(clearEdits.length, 1);
      const clearEdit = clearEdits[0]!;
      const clearedLine =
        lines[clearEdit.range.start.line]!.substring(0, clearEdit.range.start.character) +
        clearEdit.newText +
        lines[clearEdit.range.end.line]!.substring(clearEdit.range.end.character);

      assert.ok(!clearedLine.includes('"Old Resistor"'));
      assert.ok(clearedLine.includes("annotation(Placement(transformation(origin={10,20})))"));
    });

    it("computeConnectRemove removes connect equation when connect object has .lhs and .rhs", () => {
      const code = `model Circuit
  Modelica.Electrical.Analog.Basic.Resistor R1;
  Modelica.Electrical.Analog.Basic.Ground G;
equation
  connect(R1.n, G.p);
end Circuit;`;
      const tree = parser.parse(code);
      const connectNode = findNodeByType(tree.rootNode, "connect_equation");
      const classInstance = {
        name: "Circuit",
        connectEquations: [
          {
            lhs: "R1.n",
            rhs: "G.p",
            cstNode: connectNode,
          },
        ],
      };

      const edits = computeConnectRemove(code, classInstance as any, "R1.n", "G.p");
      assert.strictEqual(edits.length, 1);
      const lines = code.split("\n");
      const edit = edits[0]!;
      const removedText = lines.slice(edit.range.start.line, edit.range.end.line + 1).join("\n");
      assert.ok(removedText.includes("connect(R1.n, G.p);"));
    });
  });
});
