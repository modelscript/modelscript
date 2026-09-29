// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSysML2ConnectionDelete,
  computeSysML2ElementDelete,
  findCstEnclosingBlock,
  findCstNodeByName,
} from "../src/diagram/edits.js";

describe("SysML v2 CST-Guided Concrete Syntax Rewriting", () => {
  it("should find declaration nodes by name in CST tree", () => {
    const mockTree = {
      rootNode: {
        type: "Package",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 10, column: 1 },
        namedChildCount: 2,
        namedChild(i: number) {
          if (i === 0) {
            return {
              type: "PartDefinition",
              startPosition: { row: 1, column: 2 },
              endPosition: { row: 4, column: 3 },
              namedChildCount: 1,
              namedChild(ci: number) {
                return { type: "Identification", text: "Vehicle", namedChildCount: 0 };
              },
            };
          }
          return {
            type: "PartUsage",
            startPosition: { row: 5, column: 2 },
            endPosition: { row: 5, column: 18 },
            namedChildCount: 1,
            namedChild(ci: number) {
              return { type: "Name", text: "engine", namedChildCount: 0 };
            },
          };
        },
      },
    };

    const node1 = findCstNodeByName(mockTree.rootNode, "Vehicle");
    assert.ok(node1);
    assert.strictEqual(node1.type, "PartDefinition");

    const node2 = findCstNodeByName(mockTree.rootNode, "engine");
    assert.ok(node2);
    assert.strictEqual(node2.type, "PartUsage");

    const nodeMissing = findCstNodeByName(mockTree.rootNode, "nonExistent");
    assert.strictEqual(nodeMissing, null);
  });

  it("should find enclosing block line for insertion using CST", () => {
    const mockTree = {
      rootNode: {
        type: "Package",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 12, column: 1 },
        namedChildCount: 0,
      },
    };

    const block = findCstEnclosingBlock(mockTree);
    assert.ok(block);
    assert.strictEqual(block.line, 12);
  });

  it("should compute exact CST-based element deletion without string heuristics", () => {
    const docText = `package TestPkg {
  part def Engine {
  }
  part wheel;
}`;
    const mockTree = {
      rootNode: {
        type: "Package",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 5, column: 1 },
        namedChildCount: 2,
        namedChild(i: number) {
          if (i === 0) {
            return {
              type: "PartDefinition",
              startPosition: { row: 1, column: 2 },
              endPosition: { row: 2, column: 3 },
              namedChildCount: 1,
              namedChild() {
                return { type: "Identification", text: "Engine" };
              },
            };
          }
          return {
            type: "PartUsage",
            startPosition: { row: 3, column: 2 },
            endPosition: { row: 3, column: 13 },
            namedChildCount: 1,
            namedChild() {
              return { type: "Name", text: "wheel" };
            },
          };
        },
      },
    };

    const edits = computeSysML2ElementDelete(docText, ["Engine"], mockTree);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].range.start.line, 1);
    assert.strictEqual(edits[0].range.end.line, 3); // deletes through endLine + 1
  });

  it("should compute exact CST-based connection deletion", () => {
    const docText = `package ConnPkg {
  connection c1 : Connect connect a to b;
}`;
    const mockTree = {
      rootNode: {
        type: "Package",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 2, column: 1 },
        namedChildCount: 1,
        namedChild() {
          return {
            type: "ConnectionUsage",
            text: "connection c1 : Connect connect a to b;",
            startPosition: { row: 1, column: 2 },
            endPosition: { row: 1, column: 41 },
            namedChildCount: 0,
          };
        },
      },
    };

    const edits = computeSysML2ConnectionDelete(docText, "a", "b", mockTree);
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].range.start.line, 1);
    assert.strictEqual(edits[0].range.end.line, 2);
  });
});
