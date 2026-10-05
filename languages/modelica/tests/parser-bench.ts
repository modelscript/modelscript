// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Local GLR parser benchmark (run manually; not part of the test suite).
 *
 *   npx tsx languages/modelica/tests/parser-bench.ts [--out=file.json] [--compare=file.json]
 *
 * Measures median parse time over the largest MSL files for three workloads:
 *   clean   - the file as-is
 *   errors  - the file with deterministic injected errors (stray token, dropped ';', unclosed '(')
 *   typing  - a 100-keystroke incremental replay in the middle of the file
 * It also records a hash of the diagnostics so later optimizations can prove their output is
 * byte-identical (performance changes must not change recovery behavior).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MSL_ROOT = path.resolve(__dirname, "../../../apps/api/data/libraries/Modelica/4.1.0/extracted/Modelica");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? "true"];
    }),
);
const KEYSTROKES = Number(args.keystrokes ?? 200);
const FILE_COUNT = Number(args.files ?? 20);
const RUNS = Number(args.runs ?? 5);
// Files >= ~106 KB currently trap the parser (WASM `unreachable`), so cap the input size by default.
const MAX_KB = Number(args.maxkb ?? 100);

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".mo")) out.push(p);
  }
}

/** Deterministic xorshift so injected errors are identical across runs. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

function injectErrors(src: string, seed: number): string {
  const r = rng(seed);
  let out = src;
  // Candidate positions: ends of lines that end with ';'.
  const semi: number[] = [];
  for (let i = 0; i < out.length; i++) if (out[i] === ";" && out[i + 1] === "\n") semi.push(i);
  if (semi.length < 6) return out;
  const picks = [
    semi[Math.floor(r() * semi.length)],
    semi[Math.floor(r() * semi.length)],
    semi[Math.floor(r() * semi.length)],
  ].sort((a, b) => b - a);
  // Apply back-to-front so earlier offsets stay valid.
  const edits = [" 1 1", "", "("];
  picks.forEach((pos, i) => {
    if (i === 1)
      out = out.slice(0, pos) + out.slice(pos + 1); // drop ';'
    else out = out.slice(0, pos + 1) + edits[i] + out.slice(pos + 1); // stray token / unclosed '('
  });
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main(): Promise<void> {
  const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");

  const all: string[] = [];
  walk(MSL_ROOT, all);
  const files = all
    .map((f) => ({ f, size: fs.statSync(f).size }))
    .filter((x) => x.size <= MAX_KB * 1024)
    .sort((a, b) => b.size - a.size)
    .slice(0, FILE_COUNT);

  let facade: any;
  const parse = (
    src: string,
  ): {
    ms: number;
    diagHash: string;
    diagCount: number;
    lexCalls: number;
    expectedCalls: number;
    memoHits: number;
    memoMisses: number;
    peakHeads: number;
  } => {
    facade.lastAstRoot = 0;
    const t0 = performance.now();
    const root = facade.parseIncremental(src, 0, 0, src.length);
    const ms = performance.now() - t0;
    const diags = facade.getDiagnostics(root) as { message: string; range: unknown }[];
    const h = createHash("sha1")
      .update(JSON.stringify(diags.map((d) => [d.message, d.range])))
      .digest("hex")
      .slice(0, 12);
    const getCounter = (idx: number) =>
      typeof facade.exports?.getDebugCounter === "function" ? facade.exports.getDebugCounter(idx) : 0;
    return {
      ms,
      diagHash: h,
      diagCount: diags.length,
      lexCalls: getCounter(0),
      expectedCalls: getCounter(1),
      memoHits: getCounter(2),
      memoMisses: getCounter(3),
      peakHeads: getCounter(4),
    };
  };

  const results: Record<string, Record<string, unknown>> = {};
  for (const { f, size } of files) {
    ({ facade } = await createWasmParser(wasmPath));
    const name = path.relative(MSL_ROOT, f);
    console.error(`[bench] ${name} (${Math.round(size / 1024)} KB)`);
    const src = fs.readFileSync(f, "utf8");
    const bad = injectErrors(src, 12345);
    const row: Record<string, unknown> = { kb: Math.round(size / 1024) };

    for (const [label, text] of [
      ["clean", src],
      ["errors", bad],
    ] as const) {
      parse(text); // warm-up
      const times: number[] = [];
      let last: ReturnType<typeof parse> = {
        ms: 0,
        diagHash: "",
        diagCount: 0,
        lexCalls: 0,
        expectedCalls: 0,
        memoHits: 0,
        memoMisses: 0,
        peakHeads: 0,
      };
      for (let i = 0; i < RUNS; i++) {
        const r = parse(text);
        times.push(r.ms);
        last = r;
      }
      row[label] = {
        ms: +median(times).toFixed(2),
        diags: last.diagCount,
        hash: last.diagHash,
        lex: last.lexCalls,
        exp: last.expectedCalls,
        memoHits: last.memoHits,
        memoMisses: last.memoMisses,
        peakHeads: last.peakHeads,
      };
      console.error(
        `[bench]   ${label}: median ${(row[label] as { ms: number }).ms} ms, diags=${last.diagCount}, lex=${last.lexCalls}, exp=${last.expectedCalls}, peakH=${last.peakHeads}`,
      );
    }

    // Incremental typing replay: type KEYSTROKES chars of a stray identifier after a ';' near the middle.
    facade.lastAstRoot = 0;
    let len = src.length;
    facade.parseIncremental(src, 0, 0, len);
    const mid = src.indexOf(";\n", Math.floor(src.length / 2)) + 1;
    const typed = "x1 ".repeat(Math.ceil(KEYSTROKES / 3)).slice(0, KEYSTROKES);
    const keyTimes: number[] = [];
    let lastHash = "";
    for (let i = 0; i < typed.length; i++) {
      const t0 = performance.now();
      const root = facade.parseIncremental(typed[i], mid + i, 0, ++len);
      keyTimes.push(performance.now() - t0);
      if (i === 0 || i === 9 || i === 49 || i === 99 || i === 199) {
        console.error(`[bench]   typing keystroke ${i + 1}: ${keyTimes[i].toFixed(1)} ms`);
      }
      if (i === typed.length - 1) {
        const diags = facade.getDiagnostics(root) as { message: string; range: unknown }[];
        lastHash = createHash("sha1")
          .update(JSON.stringify(diags.map((d) => [d.message, d.range])))
          .digest("hex")
          .slice(0, 12);
      }
    }
    row.typing = { medianMs: +median(keyTimes).toFixed(2), maxMs: +Math.max(...keyTimes).toFixed(2), hash: lastHash };
    results[name] = row;
  }

  // Report
  console.log(
    "file".padEnd(46),
    "KB".padStart(5),
    "clean ms".padStart(9),
    "err ms".padStart(8),
    "clean lex/exp".padStart(15),
    "err lex/exp".padStart(15),
    "peakH".padStart(6),
    "type med".padStart(9),
    "type max".padStart(9),
  );
  let totalClean = 0;
  let totalErr = 0;
  for (const [name, row] of Object.entries(results)) {
    const c = row.clean as { ms: number; lex: number; exp: number };
    const e = row.errors as { ms: number; lex: number; exp: number; peakHeads: number };
    const t = row.typing as { medianMs: number; maxMs: number };
    totalClean += c.ms;
    totalErr += e.ms;
    console.log(
      name.slice(-46).padEnd(46),
      String(row.kb).padStart(5),
      String(c.ms).padStart(9),
      String(e.ms).padStart(8),
      `${c.lex}/${c.exp}`.padStart(15),
      `${e.lex}/${e.exp}`.padStart(15),
      String(e.peakHeads).padStart(6),
      String(t.medianMs).padStart(9),
      String(t.maxMs).padStart(9),
    );
  }
  console.log(`\nTOTAL clean=${totalClean.toFixed(1)}ms errors=${totalErr.toFixed(1)}ms`);

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify({ totalClean, totalErr, results }, null, 2));
    console.log(`wrote ${args.out}`);
  }
  if (args.compare) {
    const base = JSON.parse(fs.readFileSync(args.compare, "utf8"));
    let mismatches = 0;
    for (const [name, row] of Object.entries(results)) {
      const b = base.results[name];
      if (!b) continue;
      for (const k of ["clean", "errors", "typing"]) {
        const cur = (row[k] as { hash: string }).hash;
        const old = (b[k] as { hash: string }).hash;
        if (cur !== old) {
          mismatches++;
          console.log(`DIAGNOSTICS CHANGED: ${name} [${k}] ${old} -> ${cur}`);
        }
      }
    }
    console.log(
      `\nvs baseline: clean ${(100 * (totalClean / base.totalClean - 1)).toFixed(1)}%  errors ${(100 * (totalErr / base.totalErr - 1)).toFixed(1)}%  diagnostics mismatches: ${mismatches}`,
    );
    if (mismatches > 0) process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
