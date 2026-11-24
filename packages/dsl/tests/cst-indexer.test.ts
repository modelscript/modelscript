// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractValidWasmCstRoot, indexSymbolsFromWasmCst, type SyntaxNode } from "../src/index.js";

function makeNode(
  type: string,
  startIndex: number,
  endIndex: number,
  text: string,
  opts?: {
    fields?: Record<string, SyntaxNode>;
    children?: SyntaxNode[];
    hasError?: boolean;
    isError?: boolean;
    isMissing?: boolean;
  },
): SyntaxNode {
  const children = opts?.children ?? Object.values(opts?.fields ?? {});
  const fields = opts?.fields ?? {};
  return {
    type,
    startIndex,
    endIndex,
    text,
    hasError: opts?.hasError ?? false,
    isError: opts?.isError ?? false,
    isMissing: opts?.isMissing ?? false,
    namedChildren: children,
    children,
    childForFieldName(fieldName: string) {
      return fields[fieldName] ?? null;
    },
  } as unknown as SyntaxNode;
}

describe("WASM CST-first symbol indexer (@modelscript/dsl)", () => {
  it("extractValidWasmCstRoot unwraps { rootNode } and rejects errors or invalid inputs", () => {
    assert.equal(extractValidWasmCstRoot(null), null);
    assert.equal(extractValidWasmCstRoot(undefined), null);
    assert.equal(extractValidWasmCstRoot({}), null);

    const validNode = makeNode("SourceFile", 0, 10, "entity A");
    assert.equal(extractValidWasmCstRoot(validNode), validNode);
    assert.equal(extractValidWasmCstRoot({ rootNode: validNode }), validNode);

    const erroredNode = makeNode("SourceFile", 0, 10, "entity A", { hasError: true });
    assert.equal(extractValidWasmCstRoot(erroredNode), null);
    assert.equal(extractValidWasmCstRoot({ rootNode: erroredNode }), null);

    const isErrNode = makeNode("ERROR", 0, 5, "???", { isError: true });
    assert.equal(extractValidWasmCstRoot(isErrNode), null);
  });

  it("indexSymbolsFromWasmCst extracts top-level and nested declarations while skipping comments/strings/errors", () => {
    const source = "entity Adder is port (a : in bit); end entity; -- comment\n";
    const entityName = makeNode("Identifier", 7, 12, "Adder");
    const portName = makeNode("Identifier", 22, 23, "a");
    const portDecl = makeNode("PortDecl", 22, 32, "a : in bit", {
      fields: { name: portName },
    });
    const commentNode = makeNode("LineComment", 47, 57, "-- comment", {
      fields: { name: makeNode("Identifier", 50, 57, "comment") },
    });
    const stringNode = makeNode("StringLiteral", 0, 5, '"str"', {
      fields: { name: makeNode("Identifier", 1, 4, "str") },
    });
    const errorNode = makeNode("EntityDeclaration", 0, 5, "bad", {
      isError: true,
      fields: { name: makeNode("Identifier", 0, 3, "bad") },
    });
    const entityDecl = makeNode("EntityDeclaration", 0, 46, source.slice(0, 46), {
      fields: { name: entityName },
      children: [entityName, portDecl],
    });
    const root = makeNode("SourceFile", 0, source.length, source, {
      children: [entityDecl, commentNode, stringNode, errorNode],
    });

    const symbols = indexSymbolsFromWasmCst(root, source, {
      kindMap: { EntityDeclaration: "Class", PortDecl: "Variable" },
    });

    assert.equal(symbols.length, 2);
    assert.deepEqual(symbols[0], {
      name: "Adder",
      kind: "Class",
      startOffset: 0,
      endOffset: 46,
      nameStartOffset: 7,
      nameEndOffset: 12,
    });
    assert.deepEqual(symbols[1], {
      name: "a",
      kind: "Variable",
      startOffset: 22,
      endOffset: 32,
      nameStartOffset: 22,
      nameEndOffset: 23,
    });
  });

  it("supports custom nameFields such as INI head/sectionName", () => {
    const source = "[JUNCTIONS]\nJ1 100 0.5\n";
    const secName = makeNode("IniIdentifier", 1, 10, "JUNCTIONS");
    const secHeader = makeNode("IniSectionHeader", 0, 11, "[JUNCTIONS]", {
      fields: { sectionName: secName },
    });
    const head = makeNode("IniScalar", 12, 14, "J1");
    const record = makeNode("IniRecord", 12, 22, "J1 100 0.5", {
      fields: { head },
    });
    const root = makeNode("Document", 0, source.length, source, {
      children: [secHeader, record],
    });

    const symbols = indexSymbolsFromWasmCst(root, source, {
      kindMap: { IniSectionHeader: "section", IniRecord: "record" },
      nameFields: ["head", "sectionName", "name", "id"],
    });

    assert.equal(symbols.length, 2);
    assert.equal(symbols[0]?.name, "JUNCTIONS");
    assert.equal(symbols[0]?.nameStartOffset, 1);
    assert.equal(symbols[0]?.nameEndOffset, 10);
    assert.equal(symbols[1]?.name, "J1");
    assert.equal(symbols[1]?.startOffset, 12);
    assert.equal(symbols[1]?.endOffset, 22);
    assert.equal(symbols[1]?.nameStartOffset, 12);
    assert.equal(symbols[1]?.nameEndOffset, 14);
  });
});
