/**
 * Final benchmark: Cascade_1000 full pipeline timing.
 */
import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import type { FileSystem } from "../src/compiler/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class NodeFileSystem {
  basename(p: string) {
    return path.basename(p);
  }
  extname(p: string) {
    return path.extname(p);
  }
  join(...paths: string[]) {
    return path.join(...paths);
  }
  read(p: string) {
    return fs.readFileSync(p, "utf8");
  }
  readBinary(p: string) {
    return fs.readFileSync(p);
  }
  readdir(p: string) {
    return fs.readdirSync(p, { withFileTypes: true }) as unknown;
  }
  resolve(...paths: string[]) {
    return path.resolve(...paths);
  }
  get sep() {
    return path.sep;
  }
  stat(p: string) {
    return fs.statSync(p, { throwIfNoEntry: false }) as unknown;
  }
}

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

function generateCascade(n: number): string {
  const lines = [`model Cascade_${n}`];
  for (let i = 1; i <= n; i++) lines.push(`  Real x${i}(start=1.0);`);
  lines.push("equation");
  lines.push("  der(x1) = -x1;");
  for (let i = 2; i <= n; i++) lines.push(`  der(x${i}) = x${i - 1} - x${i};`);
  lines.push(`end Cascade_${n};`);
  return lines.join("\n");
}

async function run() {
  for (const N of [100000]) {
    const modelCode = generateCascade(N);
    const tmpDir = path.resolve(__dirname, "../../build");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `Cascade_${N}.mo`);
    fs.writeFileSync(tmpFile, modelCode);

    const ctx = Context.createBatch(new NodeFileSystem() as unknown as FileSystem);

    const t0 = performance.now();
    await ctx.addLibrary(tmpFile);
    const t1 = performance.now();

    const arena = ctx.flattenArena(`Cascade_${N}`);
    const t2 = performance.now();

    console.log(
      `Cascade_${String(N).padStart(4)}: parse=${(t1 - t0).toFixed(0).padStart(5)}ms  ` +
        `flatten=${(t2 - t1).toFixed(0).padStart(5)}ms  ` +
        `total=${(t2 - t0).toFixed(0).padStart(5)}ms  ` +
        `vars=${arena?.varCount ?? 0}  eqs=${arena?.eqCount ?? 0}`,
    );
  }
}

run().catch(console.error);
