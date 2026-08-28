import Modelica from "@modelscript/modelica/parser";
import { execSync } from "node:child_process";
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
  const Ns = [10, 100, 1000, 10000];
  const results = {
    Ns,
    modelscript: [] as number[],
    omc: [] as number[],
  };

  const tmpDir = path.resolve(__dirname, "../../build/bench");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const N of Ns) {
    const modelCode = generateCascade(N);
    const tmpFile = path.join(tmpDir, `Cascade_${N}.mo`);
    fs.writeFileSync(tmpFile, modelCode);

    // --- ModelScript ---
    const ctx = Context.createBatch(new NodeFileSystem() as unknown as FileSystem);
    let msTotal: number;
    try {
      const t0 = performance.now();
      await ctx.addLibrary(tmpFile);
      ctx.flattenArena(`Cascade_${N}`);
      msTotal = performance.now() - t0;
      console.log(`[ModelScript] Cascade_${N}: ${msTotal.toFixed(0)}ms`);
    } catch (e) {
      console.error(`[ModelScript] Cascade_${N} failed: ${e}`);
      msTotal = -1;
    }
    results.modelscript.push(msTotal);

    // --- OMC ---
    const mosFile = path.join(tmpDir, `Cascade_${N}.mos`);
    fs.writeFileSync(mosFile, `loadFile("Cascade_${N}.mo");\ninstantiateModel(Cascade_${N});\n`);
    let omcTotal: number;
    try {
      const t0 = performance.now();
      // use --max-old-space-size for safety? Wait, OMC is not Node.js, it's C++
      execSync(`omc ${mosFile}`, { cwd: tmpDir, stdio: "ignore" });
      omcTotal = performance.now() - t0;
      console.log(`[OMC]         Cascade_${N}: ${omcTotal.toFixed(0)}ms`);
    } catch (e) {
      console.error(`[OMC] Cascade_${N} failed: ${e}`);
      omcTotal = -1;
    }
    results.omc.push(omcTotal);
  }

  const resFile = path.join(tmpDir, "results.json");
  fs.writeFileSync(resFile, JSON.stringify(results, null, 2));
  console.log(`Results saved to ${resFile}`);
}

run().catch(console.error);
