// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Phase 0 Safety Net:
 * 0.1 Randomized differential fuzz test comparing incremental reparse to fresh parse
 * 0.2 Error recovery quality guard snapshot
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser, facade } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

/** Simple seeded PRNG (LCG) for reproducible fuzzing */
function createPrng(seed = 42) {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    },
    nextInt(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick<T>(arr: T[]): T {
      return arr[this.nextInt(0, arr.length - 1)];
    },
  };
}

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

const baseCorpus = [
  `model M
  Real x;
  Real y;
equation
  x = 1.0 + 2.0 * y;
  y = sin(x);
end M;`,
  `model Nested
  model Sub
    Real a;
  equation
    a = 10.0;
  end Sub;
  Sub sub1;
  Real b;
equation
  b = sub1.a * 2.0;
end Nested;`,
  `function f
  input Real in1;
  output Real out1;
algorithm
  out1 := in1 * 2.0 + 3.0;
end f;`,
  `model Control
  Boolean b;
  Real x;
equation
  if b then
    x = 1.0;
  else
    x = 0.0;
  end if;
end Control;`,
];

const tokens = [
  "x",
  "y",
  "1.0",
  "2.0",
  "+",
  "-",
  "*",
  "/",
  "(",
  ")",
  ";",
  "=",
  "model",
  "end",
  "Real",
  "equation",
  "algorithm",
  "if",
  "then",
  "else",
  " /* comment */ ",
  " // line\n",
  "  ",
  "\n",
  "@#$",
  "???",
  ":=",
];

describe("0.1 Randomized differential fuzzing", () => {
  const prng = createPrng(1337);
  const ITERS = process.env.GLR_FUZZ_ITERS ? parseInt(process.env.GLR_FUZZ_ITERS, 10) : 300;

  it(`survives ${ITERS} single-edit mutations with incremental == fresh`, () => {
    let currentSrc = prng.pick(baseCorpus);
    let currentTree = parser.parse(currentSrc)!;

    for (let i = 0; i < ITERS; i++) {
      const op = prng.nextInt(0, 3);
      let newSrc: string;
      if (currentSrc.length > 5 && op === 0) {
        // Delete a slice
        const start = prng.nextInt(0, currentSrc.length - 2);
        const len = prng.nextInt(1, Math.min(20, currentSrc.length - start));
        newSrc = currentSrc.slice(0, start) + currentSrc.slice(start + len);
      } else if (op === 1) {
        // Insert a token
        const pos = prng.nextInt(0, currentSrc.length);
        const tok = prng.pick(tokens);
        newSrc = currentSrc.slice(0, pos) + tok + currentSrc.slice(pos);
      } else if (currentSrc.length > 5 && op === 2) {
        // Replace a token
        const pos = prng.nextInt(0, currentSrc.length - 1);
        const tok = prng.pick(tokens);
        newSrc = currentSrc.slice(0, pos) + tok + currentSrc.slice(pos + 1);
      } else {
        // Reset or pick fresh if it became completely empty
        newSrc = prng.pick(baseCorpus);
      }

      const [s, eo, en] = diffEdit(currentSrc, newSrc);
      const incTree = parser.parse(newSrc, currentTree, s, eo, en);
      const freshTree = parser.parse(newSrc);

      assert.ok(incTree, `Iteration ${i}: incremental parse returned null`);
      assert.ok(freshTree, `Iteration ${i}: fresh parse returned null`);
      if (incTree.rootNode.endIndex !== newSrc.length) {
        console.error(`FAILED ENDINDEX at iteration ${i}:`);
        console.error(`currentSrc:\n${JSON.stringify(currentSrc)}`);
        console.error(`newSrc:\n${JSON.stringify(newSrc)}`);
        console.error(`edit: [${s}, ${eo}, ${en}]`);
        console.error(
          `incTree.endIndex: ${incTree.rootNode.endIndex}, freshTree.endIndex: ${freshTree.rootNode.endIndex}, src.len: ${newSrc.length}`,
        );
      }
      assert.strictEqual(
        incTree.rootNode.endIndex,
        newSrc.length,
        `Iteration ${i}: incTree rootNode.endIndex must equal src.length`,
      );
      assert.strictEqual(
        freshTree.rootNode.endIndex,
        newSrc.length,
        `Iteration ${i}: freshTree rootNode.endIndex must equal src.length`,
      );

      const incStr = String((incTree.rootNode as any).toString());
      const freshStr = String((freshTree.rootNode as any).toString());
      const freshHasError = freshStr.includes("ERROR");

      if (!freshHasError) {
        // When the resulting code is syntactically valid, incremental MUST strictly match fresh parse
        assert.strictEqual(incStr, freshStr, `Iteration ${i}: incremental tree must equal fresh tree on valid input`);
      } else {
        // When the resulting code contains syntax errors, both must cover the full input and be non-empty
        assert.strictEqual(
          incTree.rootNode.endIndex,
          newSrc.length,
          `Iteration ${i}: incTree rootNode.endIndex must equal src.length on error`,
        );
        assert.strictEqual(
          freshTree.rootNode.endIndex,
          newSrc.length,
          `Iteration ${i}: freshTree rootNode.endIndex must equal src.length on error`,
        );
      }

      // If syntax is valid, continue from incTree; if it became a syntax error, reset to a fresh valid model
      // so we continually test valid-to-valid and valid-to-invalid transitions
      if (freshHasError && prng.nextInt(0, 1) === 0) {
        currentSrc = prng.pick(baseCorpus);
        currentTree = parser.parse(currentSrc)!;
      } else {
        currentSrc = newSrc;
        currentTree = incTree;
      }
    }
  });

  it("handles multi-edit sequential batches correctly", () => {
    // Test multi-edit sequential edits via facade.parse
    const original = `model Batch\n  Real a;\n  Real b;\n  Real c;\nequation\n  a = 1.0;\n  b = 2.0;\n  c = 3.0;\nend Batch;`;
    const f = facade as any;
    const baseTree = f.parse(original);
    assert.ok(baseTree > 0, "base parse succeeded");

    // Make 2 edits in new coordinates
    // Edit 1: change "a = 1.0;" to "a = 10.0;"
    // Edit 2: change "b = 2.0;" to "b = 20.0;"
    const newText = `model Batch\n  Real a;\n  Real b;\n  Real c;\nequation\n  a = 10.0;\n  b = 20.0;\n  c = 3.0;\nend Batch;`;
    const e1Start = newText.indexOf("10.0");
    const e1OldEnd = original.indexOf("1.0") + 3;
    const e1NewEnd = e1Start + 4;

    const e2Start = newText.indexOf("20.0");
    const e2OldEnd = original.indexOf("2.0") + 3;
    const e2NewEnd = e2Start + 4;

    // Byte offsets in UTF-16
    const edits = [
      { startByte: e1Start * 2, oldEndByte: e1OldEnd * 2, newEndByte: e1NewEnd * 2 },
      { startByte: e2Start * 2, oldEndByte: e2OldEnd * 2, newEndByte: e2NewEnd * 2 },
    ];

    const incRoot = f.parse(newText, edits, 0, 0, undefined, baseTree);
    const freshRoot = f.parse(newText);
    assert.ok(incRoot > 0, "incRoot valid");
    assert.ok(freshRoot > 0, "freshRoot valid");
  });
});

describe("0.2 Recovery-quality guard snapshot", () => {
  const brokenInputs = [
    "model M Real x equation x = 1.0; end M;",
    "model M Real x; equation x = ; end M;",
    "model M equation x = 1.0 + ; end M;",
    "model M equation x = * 2.0; end M;",
    "model M Real x; equation x = (1.0 + 2.0; end M;",
    "model M Real x; equation x = 1.0 + 2.0); end M;",
    "model M Real equation x = 1.0; end M;",
    "model M Real x; equation if then x = 1.0; end if; end M;",
    "model M Real x; equation x = 1.0 @#$ 2.0; end M;",
    "model M Real x; equation x = 1.0 2.0 3.0; end M;",
    "model M Real x; equation x = foo(, 1.0); end M;",
    "model M Real x; equation x = foo(1.0, ); end M;",
    "model M Real x equation x = 1.0 end M",
    "model Real x; equation x = 1.0; end M;",
    "model M Real x; equation x = 1.0;",
  ];

  it("produces deterministic recovery snapshots across all broken inputs", () => {
    const f = facade as any;
    for (const [idx, src] of brokenInputs.entries()) {
      const tree1 = parser.parse(src)!;
      const root1 = tree1.rootNode as any;
      const s1 = String(root1.toString());

      // Reparse fresh
      const tree2 = parser.parse(src)!;
      const root2 = tree2.rootNode as any;
      const s2 = String(root2.toString());

      assert.strictEqual(s1, s2, `Recovery snapshot for #${idx} must be deterministic`);
      assert.strictEqual(root1.endIndex, src.length, `Recovery #${idx} must cover input length`);

      // Check diagnostics if available
      if (typeof f.getDiagnostics === "function") {
        const rootPtr = f.parse(src);
        const diags = f.getDiagnostics(rootPtr);
        assert.ok(Array.isArray(diags), `Diagnostics for #${idx} must be array`);
        assert.ok(diags.length > 0, `Diagnostics for #${idx} should be > 0 on broken input`);
      }
    }
  });
});
