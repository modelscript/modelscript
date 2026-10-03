// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Benchmark harness for GLR and incremental parser performance:
 * - E1: Tree depth & node scaling vs list length
 * - E2: Incremental reuse effectiveness vs position in large model
 * - E2a: Sweep edit position on N=2000
 * - E3: Incremental vs fresh tree equivalence
 * - E4: Successive keystroke latency & drift
 */
import { createWasmParser } from "@modelscript/modelica/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");

let reuseEvents = 0;
const origLog = console.log;
process.env.DEBUG_PARSER = "1";
console.log = (...args: unknown[]) => {
  const s = String(args[0] ?? "");
  if (s.startsWith("[debugLog]")) {
    if (s.includes("id: 9008,")) reuseEvents++;
    return;
  }
  origLog(...args);
};

const { facade, parser } = await createWasmParser(wasmPath);
const f = facade as any;
const mem = (): Uint32Array => new Uint32Array((f.wasmMemory ?? f.exports.memory).buffer);

function rawStats(root: number): { maxDepth: number; nodes: number } {
  const m = mem();
  let maxDepth = 0;
  let nodes = 0;
  const stack: [number, number][] = [[root, 1]];
  while (stack.length) {
    const [n, d] = stack.pop()!;
    nodes++;
    if (d > maxDepth) maxDepth = d;
    let c = m[(n + 12) >>> 2];
    while (c !== 0) {
      stack.push([c, d + 1]);
      c = m[(c + 16) >>> 2];
    }
  }
  return { maxDepth, nodes };
}

function genModel(n: number): string {
  const lines = ["model M", "  Real x;"];
  lines.push("equation");
  for (let i = 0; i < n; i++) lines.push(`  x = ${i}.0 + x * 2.0;`);
  lines.push("end M;");
  return lines.join("\n");
}

origLog("================================================================================");
origLog("ModelScript GLR Incremental Parser Benchmark Suite");
origLog("================================================================================\n");

// E1: list depth growth
origLog("=== E1: Tree depth vs list length ===");
for (const n of [10, 100, 1000, 5000]) {
  const src = genModel(n);
  const t0 = performance.now();
  const root = f.parse(src);
  const dt = performance.now() - t0;
  const st = rawStats(root);
  origLog(
    `N=${n.toString().padStart(4)}: maxDepth=${st.maxDepth.toString().padStart(3)} nodes=${st.nodes.toString().padStart(6)} parse=${dt.toFixed(1)}ms`,
  );
}

// E2a: sweep edit position on N=2000 (minimal digit edit)
origLog("\n=== E2a: Edit position latency sweep (N=2000) ===");
{
  const n = 2000;
  const src = genModel(n);
  const row: string[] = [];
  for (const idx of [0, 1, 2, 3, 5, 8, 10, 15, 20, 21, 22, 30, 50, 100, 200, 500, 1000, 1500, 1990]) {
    const target = `  x = ${idx}.0 + x * 2.0;`;
    const off = src.indexOf(target);
    const d = off + target.indexOf(".0") + 1;
    const src2 = src.slice(0, d) + "5" + src.slice(d + 1);
    const root = f.parse(src);
    const t0 = performance.now();
    f.parse(src2, d, d + 1, d + 1, undefined, root);
    row.push(`eq${idx}:${(performance.now() - t0).toFixed(1)}ms`);
  }
  origLog(row.join("  "));
}

// E2: incremental reuse effectiveness vs position in large list
origLog("\n=== E2: Incremental reuse effectiveness in large model (N=5000) ===");
{
  const n = 5000;
  const src = genModel(n);
  for (const idx of [5, 2500, 4995]) {
    const root = f.parse(src);
    const target = `  x = ${idx}.0 + x * 2.0;`;
    const repl = `  x = ${idx}.5 + x * 2.0;`;
    const off = src.indexOf(target);
    const src2 = src.replace(target, repl);
    reuseEvents = 0;
    const t0 = performance.now();
    const root2 = f.parse(src2, off, off + target.length, off + repl.length, undefined, root);
    const dt = performance.now() - t0;
    const t1 = performance.now();
    f.parse(src2);
    const dtFresh = performance.now() - t1;
    origLog(
      `edit@eq${idx}: incremental=${dt.toFixed(1)}ms fresh=${dtFresh.toFixed(1)}ms reuseEvents=${reuseEvents} rootValid=${root2 !== 0}`,
    );
  }
}

// E3: incremental vs fresh equivalence
origLog("\n=== E3: Incremental vs fresh tree equivalence verification ===");
function check(name: string, oldSrc: string, newSrc: string) {
  let s = 0;
  while (s < oldSrc.length && s < newSrc.length && oldSrc[s] === newSrc[s]) s++;
  let eo = oldSrc.length;
  let en = newSrc.length;
  while (eo > s && en > s && oldSrc[eo - 1] === newSrc[en - 1]) {
    eo--;
    en--;
  }
  const oldTree = parser.parse(oldSrc);
  const incTree = parser.parse(newSrc, oldTree, s, eo, en);
  const freshTree = parser.parse(newSrc);
  const a = (incTree!.rootNode as any).toString();
  const b = (freshTree!.rootNode as any).toString();
  origLog(`  ${a === b ? "PASS" : "FAIL"} ${name}`);
  if (a !== b) {
    origLog("    incremental: " + a.slice(0, 300));
    origLog("    fresh:       " + b.slice(0, 300));
  }
}

check(
  "comment-bridged lookahead (a + b /*k*/ ; -> a + b /*k*/ * c;)",
  "model M\n  Real y;\nequation\n  y = a + b /*k*/ ;\nend M;",
  "model M\n  Real y;\nequation\n  y = a + b /*k*/ * c;\nend M;",
);
check(
  "line-comment-bridged lookahead",
  "model M\n  Real y;\nequation\n  y = a + b // k\n  ;\nend M;",
  "model M\n  Real y;\nequation\n  y = a + b // k\n  * c;\nend M;",
);
check(
  "whitespace lookahead (control)",
  "model M\n  Real y;\nequation\n  y = a + b ;\nend M;",
  "model M\n  Real y;\nequation\n  y = a + b * c;\nend M;",
);
check("insert equation at list head", genModel(50), genModel(50).replace("equation\n", "equation\n  x = 42.0;\n"));
check("delete equation mid list", genModel(50), genModel(50).replace("  x = 25.0 + x * 2.0;\n", ""));

for (const n of [300, 2000]) {
  const big = genModel(n);
  for (const idx of [3, Math.floor(n / 2), n - 3]) {
    check(`N=${n} edit eq${idx}`, big, big.replace(`  x = ${idx}.0 + x * 2.0;`, `  x = ${idx}.5 + x * 2.0;`));
    check(
      `N=${n} insert after eq${idx}`,
      big,
      big.replace(`  x = ${idx}.0 + x * 2.0;\n`, `  x = ${idx}.0 + x * 2.0;\n  x = 7.0;\n`),
    );
  }
}

// E4: repeated incremental edits (typing simulation)
origLog("\n=== E4: 200 successive keystrokes at list head (N=2000) ===");
{
  let src = genModel(2000);
  let tree = parser.parse(src)!;
  const at = src.indexOf("  x = 0.0");
  const times: number[] = [];
  const depths: number[] = [];
  const t0 = performance.now();
  for (let k = 0; k < 200; k++) {
    const ins = "1";
    const src2 = src.slice(0, at + 6) + ins + src.slice(at + 6);
    const ti = performance.now();
    tree = parser.parse(src2, tree, at + 6, at + 6, at + 7)!;
    times.push(performance.now() - ti);
    if (k < 5) depths.push(rawStats((tree as any).rootPtr ?? (tree.rootNode as any).id).maxDepth);
    src = src2;
  }
  const dt = performance.now() - t0;
  const fresh = parser.parse(src)!;
  const same = (tree.rootNode as any).toString() === (fresh.rootNode as any).toString();
  origLog(
    `First 5 edit latencies: ${times
      .slice(0, 5)
      .map((t) => t.toFixed(2))
      .join(", ")} ms; depths: ${depths.join(", ")}`,
  );
  origLog(
    `200 keystrokes: total=${dt.toFixed(0)}ms avg=${(dt / 200).toFixed(2)}ms sameAsFresh=${same} finalDepth=${rawStats((tree as any).rootPtr ?? (tree.rootNode as any).id).maxDepth}`,
  );
}

origLog("\n================================================================================");
origLog("All benchmarks completed successfully.");
origLog("================================================================================");
