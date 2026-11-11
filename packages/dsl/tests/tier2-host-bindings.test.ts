// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import { Tree } from "../src/bindings/javascript/bindings.js";

test("Tier 2 - Host JS Bindings & Node Wrappers", async (t) => {
  // Create a mock facade and linear memory buffer simulating a WASM AST
  // Node 1 (Root at ptr 32, typeId 1, len 100, pad 0, childPtr = 64, nextSib = 0)
  //   Node 2 (Child 1 at ptr 64, typeId 2, len 40, pad 0, childPtr = 0, nextSib = 96)
  //   Node 3 (Child 2 at ptr 96 [punctuation/anonymous], typeId 3, len 10, pad 0, childPtr = 0, nextSib = 128)
  //   Node 4 (Child 3 at ptr 128, typeId 4, len 40, pad 0, childPtr = 0, nextSib = 0)
  const buffer = new ArrayBuffer(1024);
  const mem32 = new Uint32Array(buffer);

  // Node 1 at ptr 32 (mem32 index 8): typeFlags = 1, len = 100, pad = 0, childPtr = 64, nextChild = 0
  mem32[8] = 1; // typeFlags: typeId = 1, flags = 0
  mem32[9] = 100; // len (bytes) = 100
  mem32[10] = 0; // pad = 0
  mem32[11] = 64; // childPtr = 64
  mem32[12] = 0; // nextChildPtr = 0

  // Node 2 at ptr 64 (mem32 index 16): typeFlags = 2, len = 40, pad = 0, childPtr = 0, nextChild = 96
  mem32[16] = 2; // typeId = 2
  mem32[17] = 40; // len = 40
  mem32[18] = 0; // pad = 0
  mem32[19] = 0; // childPtr = 0
  mem32[20] = 96; // nextChildPtr = 96

  // Node 3 at ptr 96 (mem32 index 24): typeFlags = 3 (anonymous token "="), len = 10, pad = 0, childPtr = 0, nextChild = 128
  mem32[24] = 3; // typeId = 3
  mem32[25] = 10; // len = 10
  mem32[26] = 0; // pad = 0
  mem32[27] = 0; // childPtr = 0
  mem32[28] = 128; // nextChildPtr = 128

  // Node 4 at ptr 128 (mem32 index 32): typeFlags = 4, len = 40, pad = 0, childPtr = 0, nextChild = 0
  mem32[32] = 4; // typeId = 4
  mem32[33] = 40; // len = 40
  mem32[34] = 0; // pad = 0
  mem32[35] = 0; // childPtr = 0
  mem32[36] = 0; // nextChildPtr = 0

  const syntaxNames: Record<number, string> = {
    0: "ERROR",
    1: "Assignment",
    2: "Identifier",
    3: '"="',
    4: "Expression",
  };

  const mockFacade: any = {
    getInputEncoding: () => 1, // UTF-16
    wasmMemory: { buffer },
    syntaxNames,
  };

  const sampleSource = "x = 42";
  const tree = new Tree(mockFacade, 32, sampleSource);

  await t.test("Tree.rootNode memoization and referential equality", () => {
    const root1 = tree.rootNode;
    const root2 = tree.rootNode;
    assert.strictEqual(root1, root2, "Repeated rootNode access must return the memoized SyntaxNode instance");

    // Editing the tree clears memoized rootNode
    tree.edit({
      startIndex: 0,
      oldEndIndex: 1,
      newEndIndex: 1,
      startPosition: { row: 0, column: 0 },
      oldEndPosition: { row: 0, column: 1 },
      newEndPosition: { row: 0, column: 1 },
    });

    const rootAfterEdit = tree.rootNode;
    assert.notStrictEqual(rootAfterEdit, root1, "Tree.edit() must invalidate the memoized rootNode");
  });

  await t.test("SyntaxNode boolean getters conformity with cst-facade", () => {
    const root = tree.rootNode;
    assert.strictEqual(typeof root.isNamed, "boolean", "isNamed must be a boolean property");
    assert.strictEqual(typeof root.hasError, "boolean", "hasError must be a boolean property");
    assert.strictEqual(typeof root.isMissing, "boolean", "isMissing must be a boolean property");
    assert.strictEqual(typeof root.isExtra, "boolean", "isExtra must be a boolean property");
    assert.strictEqual(typeof root.hasChanges, "boolean", "hasChanges must be a boolean property");
    assert.strictEqual(typeof root.isError, "boolean", "isError must be a boolean property");

    assert.strictEqual(root.isNamed, true);
    assert.strictEqual(root.hasError, false);
    assert.strictEqual(root.isMissing, false);
    assert.strictEqual(root.isExtra, false);
    assert.strictEqual(root.hasChanges, false);
    assert.strictEqual(root.isError, false);
  });

  await t.test("Children, namedChildren, and O(1) sibling traversal", () => {
    const root = tree.rootNode;
    const kids = root.children;
    assert.strictEqual(kids.length, 3, "Root must have 3 children");

    const [k1, k2, k3] = kids;
    assert.strictEqual(k1.type, "Identifier");
    assert.strictEqual(k1.isNamed, true);
    assert.strictEqual(k2.type, '"="');
    assert.strictEqual(k2.isNamed, false);
    assert.strictEqual(k3.type, "Expression");
    assert.strictEqual(k3.isNamed, true);

    // Sibling pointers (all children)
    assert.strictEqual(k1.previousSibling, null);
    assert.strictEqual(k1.nextSibling, k2);
    assert.strictEqual(k2.previousSibling, k1);
    assert.strictEqual(k2.nextSibling, k3);
    assert.strictEqual(k3.previousSibling, k2);
    assert.strictEqual(k3.nextSibling, null);

    // Named children
    const named = root.namedChildren;
    assert.strictEqual(named.length, 2, "Root must have 2 named children");
    assert.strictEqual(named[0], k1);
    assert.strictEqual(named[1], k3);

    // Named sibling pointers
    assert.strictEqual(k1.previousNamedSibling, null);
    assert.strictEqual(k1.nextNamedSibling, k3);
    assert.strictEqual(k3.previousNamedSibling, k1);
    assert.strictEqual(k3.nextNamedSibling, null);
  });

  await t.test("descendantCount, childWithDescendant, and firstChildForIndex", () => {
    const root = tree.rootNode;
    const [k1, k2, k3] = root.children;

    // Total descendants: 3 immediate children with 0 children each = 3
    assert.strictEqual(root.descendantCount, 3);
    assert.strictEqual(k1.descendantCount, 0);

    // childWithDescendant
    assert.strictEqual(root.childWithDescendant(k1), k1);
    assert.strictEqual(root.childWithDescendant(k3), k3);
    assert.strictEqual(root.childWithDescendant(root), null);

    // firstChildForIndex
    const firstFor0 = root.firstChildForIndex(0);
    assert.strictEqual(firstFor0, k1);

    // firstNamedChildForIndex (index 20 is within k2 "=", so next named child after index 20 is k3)
    const firstNamedAfterK1 = root.firstNamedChildForIndex(20);
    assert.strictEqual(firstNamedAfterK1, k3);
  });

  await t.test("TreeCursor parity with cst-facade", () => {
    const root = tree.rootNode;
    const cursor = root.walk();

    assert.strictEqual(cursor.nodeType, "Assignment");
    assert.strictEqual(cursor.nodeIsNamed, true);
    assert.strictEqual(cursor.nodeIsMissing, false);
    assert.strictEqual(cursor.isMissing, false);
    assert.strictEqual(cursor.nodeStateId, 0);
    assert.strictEqual(cursor.currentDescendantIndex, 0);

    // Navigation
    assert.strictEqual(cursor.gotoFirstChild(), true);
    assert.strictEqual(cursor.nodeType, "Identifier");

    assert.strictEqual(cursor.gotoNextSibling(), true);
    assert.strictEqual(cursor.nodeType, '"="');

    assert.strictEqual(cursor.gotoParent(), true);
    assert.strictEqual(cursor.nodeType, "Assignment");

    assert.strictEqual(cursor.gotoLastChild(), true);
    assert.strictEqual(cursor.nodeType, "Expression");

    // resetTo
    const cursor2 = root.walk();
    assert.strictEqual(cursor2.nodeType, "Assignment");
    cursor2.resetTo(cursor);
    assert.strictEqual(cursor2.nodeType, "Expression");
  });

  await t.test("Tree.delete() resource cleanup", () => {
    const cleanTree = new Tree(mockFacade, 32, sampleSource);
    assert.ok(cleanTree.rootNode);
    cleanTree.delete();
    assert.strictEqual((cleanTree as any)._mem32, null);
    assert.strictEqual((cleanTree as any)._rootNode, null);
  });
});
