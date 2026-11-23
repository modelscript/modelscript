// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCif } from "../src/parser/index.js";

describe("CIF 2.0 Parser", () => {
  it("parses DS with a/b scale factor, DF, DD, and nested comments", () => {
    const src = `
      ( Top-level comment (with nested parens) );
      DS 1 100/2;
        9 INV_CELL;
        L CAA;
        B 4 6 2 3;
      DF;
      DD 1;
      C 1 T 500 200;
      E
    `;
    const doc = parseCif(src);
    assert.strictEqual(doc.parseErrors.length, 0);
    assert.strictEqual(doc.hasEndCommand, true);
    assert.strictEqual(doc.symbols.size, 1);

    const sym1 = doc.symbols.get(1);
    assert.ok(sym1);
    assert.strictEqual(sym1.name, "INV_CELL");
    assert.strictEqual(sym1.scaleA, 100);
    assert.strictEqual(sym1.scaleB, 2);
    assert.strictEqual(sym1.closed, true);

    const ddCmd = doc.topLevelCommands.find((c) => c.kind === "DD");
    assert.ok(ddCmd && ddCmd.kind === "DD");
    assert.strictEqual(ddCmd.symbolId, 1);

    const commentCmd = doc.topLevelCommands.find((c) => c.kind === "Comment");
    assert.ok(commentCmd && commentCmd.kind === "Comment");
    assert.ok(commentCmd.text.includes("nested parens"));
  });

  it("parses all CIF 2.0 geometry primitives (B with direction, P, R, W) and transforms (T, MX, MY, R)", () => {
    const src = `
      DS 10 100 1;
        L CPG;
        B 10 4 5 2 3 4;
        L CMF;
        P 0 0 10 0 10 10 0 10;
        R 6 20 20;
        W 4 0 0 20 0 20 15;
        94 OUT 20 15 CMF;
      DF;
      C 10 MX MY R 0 1 T -100 250;
      E
    `;
    const doc = parseCif(src);
    assert.strictEqual(doc.parseErrors.length, 0);
    const sym = doc.symbols.get(10)!;
    assert.strictEqual(sym.scaleA, 100);
    assert.strictEqual(sym.scaleB, 1);

    const boxCmd = sym.commands.find((c) => c.kind === "B");
    assert.ok(boxCmd && boxCmd.kind === "B");
    assert.strictEqual(boxCmd.length, 10);
    assert.strictEqual(boxCmd.width, 4);
    assert.deepStrictEqual(boxCmd.center, { x: 5, y: 2 });
    assert.deepStrictEqual(boxCmd.direction, { x: 3, y: 4 });

    const polyCmd = sym.commands.find((c) => c.kind === "P");
    assert.ok(polyCmd && polyCmd.kind === "P");
    assert.strictEqual(polyCmd.points.length, 4);

    const roundCmd = sym.commands.find((c) => c.kind === "R");
    assert.ok(roundCmd && roundCmd.kind === "R");
    assert.strictEqual(roundCmd.diameter, 6);
    assert.deepStrictEqual(roundCmd.center, { x: 20, y: 20 });

    const wireCmd = sym.commands.find((c) => c.kind === "W");
    assert.ok(wireCmd && wireCmd.kind === "W");
    assert.strictEqual(wireCmd.width, 4);
    assert.strictEqual(wireCmd.points.length, 3);

    const userCmd = sym.commands.find((c) => c.kind === "User");
    assert.ok(userCmd && userCmd.kind === "User");
    assert.strictEqual(userCmd.digit, 9);

    const callCmd = doc.topLevelCommands.find((c) => c.kind === "C");
    assert.ok(callCmd && callCmd.kind === "C");
    assert.strictEqual(callCmd.symbolId, 10);
    assert.deepStrictEqual(callCmd.transforms, [
      { kind: "MX" },
      { kind: "MY" },
      { kind: "R", x: 0, y: 1 },
      { kind: "T", x: -100, y: 250 },
    ]);
  });

  it("reports parse errors for malformed commands and unterminated comments", () => {
    const doc = parseCif(`
      DS 1;
        B 10 20;
        ( unterminated comment
    `);
    assert.ok(doc.parseErrors.length >= 2);
    assert.strictEqual(doc.hasEndCommand, false);
  });
});
