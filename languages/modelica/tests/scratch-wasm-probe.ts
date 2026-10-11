// SPDX-License-Identifier: AGPL-3.0-or-later
// Scratch probe: for each WASM/TS parity-gap test, run the strict WASM backend and
// record the kernel's bail-out error code (setError site) so we can separate
// "kernel bailed silently" from "kernel completed but produced wrong output".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { ModelicaFlattener } from "../src/flattener/class-flattener.js";
import { NodeFileSystem } from "./node-filesystem.js";

let lastCode: number | null;
let lastWasmVars: number;
let lastWasmEqs: number;
const proto: any = ModelicaFlattener.prototype;
const orig = proto.recordWasmSourceRanges;
proto.recordWasmSourceRanges = function (dae: any, classId: any) {
  lastCode = dae?.wasmErrorCode ?? null;
  lastWasmVars = dae?.varCount ?? -1;
  lastWasmEqs = dae?.eqCount ?? -1;
  return orig.call(this, dae, classId);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));
Context.registerParser(".mo", parser as any);

const gapFile = process.argv[2]!;
const outFile = process.argv[3]!;
const gap: string[] = JSON.parse(fs.readFileSync(gapFile, "utf-8"));
const results: Record<
  string,
  { code: number | null; vars: number; eqs: number; wv: number; we: number; err?: string; unsupported: boolean }
> = {};

let i = 0;
for (const file of gap) {
  i++;
  const src = fs.readFileSync(file, "utf-8");
  const resIdx = src.search(/^\/\/\s*Result:/m);
  const source = resIdx >= 0 ? src.slice(0, resIdx) : src;
  const expected = resIdx >= 0 ? src.slice(resIdx) : "";
  const nameMeta = src.match(/^\/\/\s*name:\s*(\S+)/m)?.[1] ?? path.basename(file, ".mo");
  const expName = expected.match(/^\/\/\s*(?:class|model|block)\s+([A-Za-z0-9_]+)/m)?.[1];
  try {
    const context = new Context(new NodeFileSystem(), undefined, undefined, {
      loadStdlib: source.includes("ModelScript"),
    });
    context.load(source, file);
    const syms = Array.from(context.queryEngine.index.symbols.values()).filter(
      (s: any) => s.resourceId === file && s.kind === "Class",
    ) as any[];
    const pick =
      (expName && syms.find((s) => s.name === expName && s.parentId == null)) ||
      syms.find((s) => s.name === nameMeta) ||
      [...syms].reverse().find((s) => s.parentId == null);
    const className = pick?.name ?? nameMeta;
    lastCode = null;
    lastWasmVars = -1;
    lastWasmEqs = -1;
    const dae: any = context.flattenArena(className, undefined, undefined, {
      omcCompatibility: true,
      isOldFrontend: source.includes("-d=-newInst"),
      backend: "wasm",
    } as any);
    results[file] = {
      code: lastCode,
      vars: dae?.varCount ?? -1,
      eqs: dae?.eqCount ?? -1,
      wv: lastWasmVars,
      we: lastWasmEqs,
      unsupported: Boolean(dae?.diagnostics?.some((d: any) => d.rule === "wasm-flattener-unsupported")),
    };
  } catch (e: any) {
    results[file] = {
      code: null,
      vars: -1,
      eqs: -1,
      wv: -1,
      we: -1,
      err: String(e?.message ?? e).slice(0, 200),
      unsupported: false,
    };
  }
  if (i % 50 === 0) console.error(`${i}/${gap.length}`);
}
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
console.log("done", Object.keys(results).length);
process.exit(0);
