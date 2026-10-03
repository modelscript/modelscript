// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Differential regression tests for the incremental GLR parser:
 * an incremental reparse must always produce the same tree as a fresh parse.
 *
 * Seeds come from the GLR parser review:
 * - reused subtrees must respect their recorded reduction lookahead (a comment between
 *   a reduced expression and an edit must not hide a precedence change);
 * - list splicing / reuse at the head, middle and tail of long equation lists;
 * - repeated keystrokes must not drift from the fresh parse.
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser, facade } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

/** Maximum raw (arena) depth of the tree rooted at `root`, including invisible list chunks. */
function rawDepth(root: number): number {
  const f = facade as any;
  const m = new Uint32Array((f.wasmMemory ?? f.exports.memory).buffer);
  let maxDepth = 0;
  const stack: [number, number][] = [[root, 1]];
  while (stack.length) {
    const [n, d] = stack.pop()!;
    if (d > maxDepth) maxDepth = d;
    for (let c = m[(n + 12) >>> 2]; c !== 0; c = m[(c + 16) >>> 2]) stack.push([c, d + 1]);
  }
  return maxDepth;
}

function genModel(n: number): string {
  const lines = ["model M", "  Real x;", "equation"];
  for (let i = 0; i < n; i++) lines.push(`  x = ${i}.0 + x * 2.0;`);
  lines.push("end M;");
  return lines.join("\n");
}

/** Computes the minimal single edit (start, oldEnd, newEnd) transforming oldSrc into newSrc. */
function diffEdit(oldSrc: string, newSrc: string): [number, number, number] {
  let s = 0;
  while (s < oldSrc.length && s < newSrc.length && oldSrc[s] === newSrc[s]) s++;
  let eo = oldSrc.length;
  let en = newSrc.length;
  while (eo > s && en > s && oldSrc[eo - 1] === newSrc[en - 1]) {
    eo--;
    en--;
  }
  return [s, eo, en];
}

function assertIncrementalMatchesFresh(oldSrc: string, newSrc: string): void {
  const [s, eo, en] = diffEdit(oldSrc, newSrc);
  const oldTree = parser.parse(oldSrc);
  const incTree = parser.parse(newSrc, oldTree, s, eo, en);
  const freshTree = parser.parse(newSrc);
  const inc = String((incTree!.rootNode as any).toString());
  const fresh = String((freshTree!.rootNode as any).toString());
  assert.strictEqual(inc, fresh, "incremental tree must equal fresh tree");
}

describe("incremental parse equals fresh parse", () => {
  describe("reduction lookahead across extras", () => {
    it("block comment between reduced expression and edit", () => {
      assertIncrementalMatchesFresh(
        "model M\n  Real y;\nequation\n  y = a + b /*k*/ ;\nend M;",
        "model M\n  Real y;\nequation\n  y = a + b /*k*/ * c;\nend M;",
      );
    });

    it("line comment between reduced expression and edit", () => {
      assertIncrementalMatchesFresh(
        "model M\n  Real y;\nequation\n  y = a + b // k\n  ;\nend M;",
        "model M\n  Real y;\nequation\n  y = a + b // k\n  * c;\nend M;",
      );
    });

    it("whitespace only (control)", () => {
      assertIncrementalMatchesFresh(
        "model M\n  Real y;\nequation\n  y = a + b ;\nend M;",
        "model M\n  Real y;\nequation\n  y = a + b * c;\nend M;",
      );
    });

    it("operator change behind a comment (^ binds tighter than *)", () => {
      assertIncrementalMatchesFresh(
        "model M\n  Real y;\nequation\n  y = a * b /*k*/ ;\nend M;",
        "model M\n  Real y;\nequation\n  y = a * b /*k*/ ^ c;\nend M;",
      );
    });
  });

  describe("terminal reuse", () => {
    it("token extended by an adjacent edit (< to <=)", () => {
      assertIncrementalMatchesFresh(
        "model M\n  Boolean b;\n  Real x;\nequation\n  b = x < 1.0;\nend M;",
        "model M\n  Boolean b;\n  Real x;\nequation\n  b = x <= 1.0;\nend M;",
      );
    });
  });

  describe("list edits", () => {
    it("insert equation at list head", () => {
      const src = genModel(50);
      assertIncrementalMatchesFresh(src, src.replace("equation\n", "equation\n  x = 42.0;\n"));
    });

    it("delete equation mid list", () => {
      const src = genModel(50);
      assertIncrementalMatchesFresh(src, src.replace("  x = 25.0 + x * 2.0;\n", ""));
    });

    for (const n of [300, 2000]) {
      const big = genModel(n);
      for (const idx of [3, Math.floor(n / 2), n - 3]) {
        it(`N=${n}: edit equation ${idx}`, () => {
          assertIncrementalMatchesFresh(big, big.replace(`  x = ${idx}.0 + x * 2.0;`, `  x = ${idx}.5 + x * 2.0;`));
        });
        it(`N=${n}: insert after equation ${idx}`, () => {
          assertIncrementalMatchesFresh(
            big,
            big.replace(`  x = ${idx}.0 + x * 2.0;\n`, `  x = ${idx}.0 + x * 2.0;\n  x = 7.0;\n`),
          );
        });
      }
    }
  });

  it("50 successive keystrokes at list head stay equal to fresh parse", () => {
    let src = genModel(500);
    let tree = parser.parse(src)!;
    const at = src.indexOf("  x = 0.0") + 6;
    for (let k = 0; k < 50; k++) {
      const src2 = src.slice(0, at) + "1" + src.slice(at);
      tree = parser.parse(src2, tree, at, at, at + 1)!;
      src = src2;
    }
    const fresh = parser.parse(src)!;
    assert.strictEqual(String((tree.rootNode as any).toString()), String((fresh.rootNode as any).toString()));
  });
});

describe("list trees stay balanced", () => {
  it("depth grows logarithmically with list length", () => {
    const f = facade as any;
    const small = rawDepth(f.parse(genModel(10)));
    const large = rawDepth(f.parse(genModel(5000)));
    // A balanced B-tree with fan-out >= 8 adds only a few levels for 500x more items.
    // (Before the fix the depth grew linearly: ~N/20 levels.)
    assert.ok(large - small <= 6, `depth grew from ${small} to ${large}`);
  });

  it("depth does not drift under repeated keystrokes", () => {
    let src = genModel(1000);
    let tree = parser.parse(src)!;
    const at = src.indexOf("  x = 0.0") + 6;
    const rootOf = (t: any): number => t.rootPtr ?? t.rootNode.id;
    const initial = rawDepth(rootOf(tree));
    for (let k = 0; k < 100; k++) {
      const src2 = src.slice(0, at) + "1" + src.slice(at);
      tree = parser.parse(src2, tree, at, at, at + 1)!;
      src = src2;
    }
    assert.ok(rawDepth(rootOf(tree)) <= initial + 2, "incremental edits must not deepen the tree");
  });
});

const treeText = (src: string): string => String((parser.parse(src)!.rootNode as any).toString());

describe("error recovery stays consistent", () => {
  // Runs of skipped tokens extend a head's ERROR node; GLR forks share that node, so it must be
  // copied on write (otherwise forks corrupt each other's byte lengths / children).
  const garbage = [
    "model M\n  Real x;\nequation\n  x = 1.0 @ @ # $ 2.0;\nend M;",
    "model M\n  Real x;\nequation\n  x = 1.0 + + + ;\n  x = 2.0;\nend M;",
    "model M\n  Real x y z w;\nequation\n  x = 1.0;\nend M;",
    "model M\n  Real x;\nequation\n  x = (1.0 + (2.0 * ;\nend M;",
  ];

  for (const [i, src] of garbage.entries()) {
    it(`erroneous input #${i} covers the whole source and parses deterministically`, () => {
      const tree = parser.parse(src)!;
      const root = tree.rootNode as any;
      assert.strictEqual(root.endIndex, src.length, "root must span the entire input");
      assert.strictEqual(treeText(src), String(root.toString()), "re-parsing must give the same tree");
    });

    it(`erroneous input #${i}: incremental re-parse after a far edit equals fresh`, () => {
      const edited = src.replace("model M", "model N").replace("end M;", "end N;");
      const oldTree = parser.parse(src)!;
      const [s, eo, en] = diffEdit(src, edited);
      const inc = parser.parse(edited, oldTree, s, eo, en)!;
      assert.strictEqual(inc.rootNode.endIndex, edited.length);
      assert.strictEqual(String((inc.rootNode as any).toString()), treeText(edited));
    });
  }

  it("interleaving valid and invalid parses does not change results", () => {
    // Guards the lookupActions / expected_tokens memos against stale state across parses.
    const valid = genModel(20);
    const before = garbage.map(treeText);
    const validBefore = treeText(valid);
    for (let r = 0; r < 3; r++) {
      for (const [i, g] of garbage.entries()) {
        assert.strictEqual(treeText(g), before[i]);
        assert.strictEqual(treeText(valid), validBefore);
      }
    }
  });
});
