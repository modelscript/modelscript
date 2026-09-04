// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Worker process to flatten and compare a single MSL model in isolation.
 *
 * Runs:
 *   1. OpenModelica (`omc`) flattener with caching
 *   2. ModelScript arena-native flattener (`flattenArena`)
 *   3. Compares variable counts, equation counts, and prints a diff
 */

import { ArenaDAEPrinter } from "@modelscript/language/compiler";
import { StringWriter } from "@modelscript/language/utils";
import { createWasmParser } from "@modelscript/modelica/parser";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WorkerTask {
  modelFqn: string;
  mslDir: string;
  version: string;
  cacheDir: string;
  indexCachePath: string;
  forceOmc?: boolean;
}

export interface WorkerResult {
  modelFqn: string;
  status: "MATCH" | "DIFF" | "MS_ERROR" | "OMC_ERROR" | "TIMEOUT";
  durationMs: number;
  omc: {
    success: boolean;
    cached: boolean;
    durationMs: number;
    varCount: number;
    eqCount: number;
    error?: string;
  };
  modelscript: {
    success: boolean;
    durationMs: number;
    varCount: number;
    eqCount: number;
    error?: string;
  };
  comparison: {
    varCountMatch: boolean;
    eqCountMatch: boolean;
    diffLines: number;
    diffSummary?: string;
  };
}

function cleanFlatText(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("true\n") || cleaned.startsWith("true\r\n")) {
    cleaned = cleaned.replace(/^true\r?\n/, "").trim();
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  // Unescape OMC quotes if stringified
  cleaned = cleaned.replace(/\\"/g, '"');
  return cleaned;
}

function parseFlatModel(rawText: string): { vars: string[]; eqs: string[] } {
  const text = cleanFlatText(rawText);
  const vars: string[] = [];
  const eqs: string[] = [];
  let inEquation = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    if (line === "equation") {
      inEquation = true;
      continue;
    }
    if (line.startsWith("end ")) {
      break;
    }
    if (inEquation) {
      eqs.push(line);
    } else if (!line.startsWith("class ")) {
      vars.push(line);
    }
  }
  return { vars, eqs };
}

function runOmc(
  modelFqn: string,
  mslDir: string,
  version: string,
  cacheDir: string,
  force = false,
): { success: boolean; cached: boolean; durationMs: number; flatText: string; error?: string } {
  const omcCacheDir = path.join(cacheDir, "omc", version);
  fs.mkdirSync(omcCacheDir, { recursive: true });
  const cacheFile = path.join(omcCacheDir, `${modelFqn}.mo`);

  if (!force && fs.existsSync(cacheFile)) {
    const flatText = fs.readFileSync(cacheFile, "utf-8");
    return { success: true, cached: true, durationMs: 0, flatText };
  }

  const pkgMo = path.join(mslDir, "package.mo");
  const mosScript = `
loadFile("${pkgMo.replace(/\\/g, "/")}");
res := instantiateModel(${modelFqn});
err := getErrorString();
if res == "" then
  print("OMC_ERROR: " + err + "\\n");
else
  print(res);
end if;
`;

  const tmpMos = path.join(cacheDir, `temp_${process.pid}_${Date.now()}.mos`);
  fs.writeFileSync(tmpMos, mosScript, "utf-8");

  const t0 = Date.now();
  try {
    const stdout = execSync(`omc "${tmpMos}"`, {
      encoding: "utf-8",
      timeout: 45_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const durationMs = Date.now() - t0;

    if (stdout.includes("OMC_ERROR:")) {
      const errLine = stdout.split("\n").find((l) => l.includes("OMC_ERROR:")) || "Unknown OMC error";
      return { success: false, cached: false, durationMs, flatText: "", error: errLine };
    }

    // Clean OMC output
    const flatText = stdout.trim();
    if (flatText.length > 0 && flatText.includes("class ")) {
      fs.writeFileSync(cacheFile, flatText, "utf-8");
      return { success: true, cached: false, durationMs, flatText };
    }
    return { success: false, cached: false, durationMs, flatText: "", error: "Empty or invalid OMC output" };
  } catch (err: any) {
    return {
      success: false,
      cached: false,
      durationMs: Date.now() - t0,
      flatText: "",
      error: err.message || String(err),
    };
  } finally {
    try {
      if (fs.existsSync(tmpMos)) fs.unlinkSync(tmpMos);
    } catch {
      // ignore
    }
  }
}

function linkMslPackageHierarchy(
  symbolIndex: { symbols: Map<number, any>; byName: Map<string, number[]>; childrenOf: Map<number, number[]> },
  mslDir: string,
): void {
  let nextId = 100000;
  for (const id of symbolIndex.symbols.keys()) {
    if (id > nextId) nextId = id + 1;
  }

  function getOrCreatePackageSymbol(fqn: string): number {
    const parts = fqn.split(".");
    let parentId: number | null = null;
    let currentFQN = "";

    for (const part of parts) {
      currentFQN = currentFQN ? `${currentFQN}.${part}` : part;
      const foundList = symbolIndex.byName.get(currentFQN);
      let symId: number;

      if (foundList && foundList.length > 0) {
        symId = foundList[0];
      } else {
        symId = nextId++;
        const entry = {
          id: symId,
          kind: "Class",
          name: part,
          ruleName: "class_definition",
          namePath: "",
          fieldName: null,
          parentId,
          resourceId: "",
          startByte: 0,
          endByte: 0,
          exports: [],
          inherits: [],
          metadata: { classKind: "package" },
        };
        symbolIndex.symbols.set(symId, entry);

        const byFQN = symbolIndex.byName.get(currentFQN) || [];
        byFQN.push(symId);
        symbolIndex.byName.set(currentFQN, byFQN);

        const childList = symbolIndex.childrenOf.get(parentId ?? 0) || [];
        childList.push(symId);
        symbolIndex.childrenOf.set(parentId ?? 0, childList);
      }
      parentId = symId;
    }
    return parentId ?? 0;
  }

  for (const [id, sym] of symbolIndex.symbols.entries()) {
    if (
      sym.kind === "Class" &&
      sym.ruleName === "class_definition" &&
      sym.resourceId &&
      sym.resourceId.startsWith(mslDir)
    ) {
      const rel = path.relative(mslDir, sym.resourceId);
      const dirParts = rel.replace(/\.mo$/, "").split(path.sep);
      let parentPkgFQN: string;
      if (dirParts[dirParts.length - 1] === sym.name) {
        parentPkgFQN = ["Modelica", ...dirParts.slice(0, -1)].join(".");
      } else if (dirParts[dirParts.length - 1] === "package") {
        parentPkgFQN = ["Modelica", ...dirParts.slice(0, -2)].join(".");
      } else {
        parentPkgFQN = ["Modelica", ...dirParts].join(".");
      }

      if (parentPkgFQN) {
        const parentPkgId = getOrCreatePackageSymbol(parentPkgFQN);
        sym.parentId = parentPkgId;
        const childList = symbolIndex.childrenOf.get(parentPkgId) || [];
        if (!childList.includes(id)) {
          childList.push(id);
          symbolIndex.childrenOf.set(parentPkgId, childList);
        }
      }
    }
  }
}

async function runTask(task: WorkerTask): Promise<WorkerResult> {
  const tTotalStart = Date.now();

  // 1. Run OMC
  const omcRes = runOmc(task.modelFqn, task.mslDir, task.version, task.cacheDir, task.forceOmc);
  const omcParsed = parseFlatModel(omcRes.flatText);

  // 2. Initialize ModelScript context with cached SymbolIndex
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const context = new Context(new NodeFileSystem());

  // Hydrate index from cache
  const rawIndex = JSON.parse(fs.readFileSync(task.indexCachePath, "utf-8"));
  const symbolIndex = {
    symbols: new Map<number, any>(rawIndex.symbols),
    byName: new Map<string, number[]>(rawIndex.byName),
    childrenOf: new Map<number, number[]>(rawIndex.childrenOf),
  };

  linkMslPackageHierarchy(symbolIndex, task.mslDir);
  context.setSymbolIndex(symbolIndex);

  // 3. Flatten with ModelScript
  const tMsStart = Date.now();
  let msSuccess = false;
  let msFlatText = "";
  let msError: string | undefined;

  try {
    const arena = context.flattenArena(task.modelFqn, undefined, undefined, { omcCompatibility: true });
    if (arena) {
      const out = new StringWriter();
      const printer = new ArenaDAEPrinter(out, arena, true);
      printer.printDAE(arena);
      msFlatText = out.toString().trim();
      msSuccess = true;
    } else {
      msError = "flattenArena returned null (class not found or unresolved)";
    }
  } catch (err: any) {
    msError = err.message || String(err);
  }
  const msDurationMs = Date.now() - tMsStart;
  const msParsed = parseFlatModel(msFlatText);

  // 4. Compare
  const varCountMatch = omcParsed.vars.length === msParsed.vars.length;
  const eqCountMatch = omcParsed.eqs.length === msParsed.eqs.length;

  let status: WorkerResult["status"] = "MATCH";
  if (!omcRes.success) {
    status = "OMC_ERROR";
  } else if (!msSuccess) {
    status = "MS_ERROR";
  } else if (!varCountMatch || !eqCountMatch) {
    status = "DIFF";
  }

  // Diff summary
  let diffLines = 0;
  let diffSummary = "";
  if (status === "DIFF") {
    diffLines =
      Math.abs(omcParsed.vars.length - msParsed.vars.length) + Math.abs(omcParsed.eqs.length - msParsed.eqs.length);
    diffSummary = `Variables: OMC=${omcParsed.vars.length}, MS=${msParsed.vars.length} (Δ${msParsed.vars.length - omcParsed.vars.length}) | Equations: OMC=${omcParsed.eqs.length}, MS=${msParsed.eqs.length} (Δ${msParsed.eqs.length - omcParsed.eqs.length})`;
  }

  return {
    modelFqn: task.modelFqn,
    status,
    durationMs: Date.now() - tTotalStart,
    omc: {
      success: omcRes.success,
      cached: omcRes.cached,
      durationMs: omcRes.durationMs,
      varCount: omcParsed.vars.length,
      eqCount: omcParsed.eqs.length,
      error: omcRes.error,
    },
    modelscript: {
      success: msSuccess,
      durationMs: msDurationMs,
      varCount: msParsed.vars.length,
      eqCount: msParsed.eqs.length,
      error: msError,
    },
    comparison: {
      varCountMatch,
      eqCountMatch,
      diffLines,
      diffSummary,
    },
  };
}

// Stdin processing
const rl = readline.createInterface({ input: process.stdin });
let inputBuffer = "";

rl.on("line", (line) => {
  inputBuffer += line;
});

rl.on("close", async () => {
  try {
    const task: WorkerTask = JSON.parse(inputBuffer.trim());
    const result = await runTask(task);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err: any) {
    console.error("Worker fatal error:", err);
    process.exit(1);
  }
});
