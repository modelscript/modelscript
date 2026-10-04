// SPDX-License-Identifier: AGPL-3.0-or-later

import expect from "expect";
import { describe, it } from "node:test";
import { CstUnparser } from "../src/unparser/cst-unparser.js";
import type { SyntaxNode } from "../src/utils/cst-facade.js";

function createMockNode(params: {
  type: string;
  text: string;
  startIndex: number;
  startRow?: number;
  startCol?: number;
  sourceCode?: string;
  children?: SyntaxNode[];
  isNamed?: boolean;
}): SyntaxNode {
  const startIndex = params.startIndex;
  const endIndex = startIndex + params.text.length;
  const startRow = params.startRow ?? 0;
  const startCol = params.startCol ?? startIndex;

  // Compute end row/col
  const lines = params.text.split("\n");
  const endRow = startRow + lines.length - 1;
  const endCol = lines.length === 1 ? startCol + params.text.length : lines[lines.length - 1]!.length;

  const node: any = {
    type: params.type,
    text: params.text,
    startIndex,
    endIndex,
    startPosition: { row: startRow, column: startCol },
    endPosition: { row: endRow, column: endCol },
    isNamed: params.isNamed ?? true,
    children: params.children ?? [],
    namedChildren: (params.children ?? []).filter((c: any) => c.isNamed !== false),
    tree: {
      sourceCode: params.sourceCode ?? params.text,
    },
    childForFieldName: (name: string) => null,
  };

  for (const child of node.children) {
    child.parent = node;
    child.tree = node.tree;
  }

  return node as SyntaxNode;
}

describe("CstUnparser (Generalized Node Unparser & Patch Engine)", () => {
  it("should unparse clean nodes verbatim", () => {
    const node = createMockNode({
      type: "annotation_clause",
      text: "annotation(Placement(transformation(origin={0, 10})))",
      startIndex: 10,
    });

    const unparsed = CstUnparser.unparseNode(node);
    expect(unparsed).toBe("annotation(Placement(transformation(origin={0, 10})))");
  });

  it("should perform direct node replacement with surgical TextEdit", () => {
    const fullSource = "Real x annotation(Placement(origin={0,0}));";
    const placementNode = createMockNode({
      type: "element_modification",
      text: "Placement(origin={0,0})",
      startIndex: 18,
      startRow: 0,
      startCol: 18,
      sourceCode: fullSource,
    });

    const newPlacement = "Placement(transformation(origin={100, 200}))";
    const result = CstUnparser.patchAndUnparse({
      target: placementNode,
      replaceText: newPlacement,
    });

    expect(result.text).toBe(newPlacement);
    expect(result.edit.newText).toBe(newPlacement);
    expect(result.edit.range.start).toEqual({ line: 0, character: 18 });
    expect(result.edit.range.end).toEqual({ line: 0, character: 18 + "Placement(origin={0,0})".length });
    expect(result.startIndex).toBe(18);
  });

  it("should perform single child replacement with surgical child range", () => {
    const fullSource = 'annotation(Documentation(info="Foo"), Placement(origin={0,0}))';
    const docNode = createMockNode({
      type: "element_modification",
      text: 'Documentation(info="Foo")',
      startIndex: 11,
      startRow: 0,
      startCol: 11,
      sourceCode: fullSource,
    });
    const placementNode = createMockNode({
      type: "element_modification",
      text: "Placement(origin={0,0})",
      startIndex: 38,
      startRow: 0,
      startCol: 38,
      sourceCode: fullSource,
    });

    const annNode = createMockNode({
      type: "annotation_clause",
      text: fullSource,
      startIndex: 0,
      startRow: 0,
      startCol: 0,
      sourceCode: fullSource,
      children: [docNode, placementNode],
    });

    const newPlacement = "Placement(origin={50, 75})";
    const replaceMap = new Map<SyntaxNode, string>();
    replaceMap.set(placementNode, newPlacement);

    const result = CstUnparser.patchAndUnparse({
      target: annNode,
      replaceChildren: replaceMap,
    });

    // Highly surgical: targets placementNode directly
    expect(result.edit.newText).toBe(newPlacement);
    expect(result.edit.range.start).toEqual({ line: 0, character: 38 });
    expect(result.edit.range.end).toEqual({ line: 0, character: 38 + "Placement(origin={0,0})".length });
  });

  it("should insert a child into an existing argument list with comma separator", () => {
    const fullSource = 'annotation(Documentation(info="Foo"))';
    const docNode = createMockNode({
      type: "element_modification",
      text: 'Documentation(info="Foo")',
      startIndex: 11,
      startRow: 0,
      startCol: 11,
      sourceCode: fullSource,
    });

    const annNode = createMockNode({
      type: "annotation_clause",
      text: fullSource,
      startIndex: 0,
      startRow: 0,
      startCol: 0,
      sourceCode: fullSource,
      children: [docNode],
    });

    const newPlacement = "Placement(transformation(origin={10, 20}))";
    const result = CstUnparser.patchAndUnparse({
      target: annNode,
      insertChildren: [
        {
          content: newPlacement,
          position: "end",
          separator: ", ",
        },
      ],
    });

    expect(result.edit.newText).toBe(`, ${newPlacement}`);
    expect(result.edit.range.start).toEqual({ line: 0, character: docNode.endIndex });
  });

  it("should insert a child into an empty argument list without comma", () => {
    const fullSource = "annotation()";
    const annNode = createMockNode({
      type: "annotation_clause",
      text: fullSource,
      startIndex: 0,
      startRow: 0,
      startCol: 0,
      sourceCode: fullSource,
      children: [],
    });

    const newPlacement = "Placement(transformation(origin={10, 20}))";
    const result = CstUnparser.patchAndUnparse({
      target: annNode,
      insertChildren: [
        {
          content: newPlacement,
        },
      ],
    });

    expect(result.edit.newText).toBe(newPlacement);
    // Inserts right after '(' at index 11
    expect(result.edit.range.start).toEqual({ line: 0, character: 11 });
  });

  it("should delete a child and clean up trailing comma", () => {
    const fullSource = 'annotation(Placement(origin={0,0}), Documentation(info="Bar"))';
    const placementNode = createMockNode({
      type: "element_modification",
      text: "Placement(origin={0,0})",
      startIndex: 11,
      startRow: 0,
      startCol: 11,
      sourceCode: fullSource,
    });
    const docNode = createMockNode({
      type: "element_modification",
      text: 'Documentation(info="Bar")',
      startIndex: 36,
      startRow: 0,
      startCol: 36,
      sourceCode: fullSource,
    });

    const annNode = createMockNode({
      type: "annotation_clause",
      text: fullSource,
      startIndex: 0,
      startRow: 0,
      startCol: 0,
      sourceCode: fullSource,
      children: [placementNode, docNode],
    });

    const result = CstUnparser.patchAndUnparse({
      target: annNode,
      deleteChildren: [placementNode],
    });

    expect(result.edit.newText).toBe("");
    expect(result.startIndex).toBe(11);
    // Slices through ", " as well
    expect(result.endIndex).toBe(36);
  });
});
