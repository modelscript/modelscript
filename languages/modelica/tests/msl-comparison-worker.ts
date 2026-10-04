// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Worker process to verify, simulate, render, and flatten an MSL model in isolation.
 *
 * Capabilities:
 *   1. Flattening parity comparison against OpenModelica (omc)
 *   2. Numerical simulation trajectory comparison against OMC (CSV)
 *   3. Headless Icon SVG validation and specification compliance
 *   4. Headless Diagram rendering and component placement verification
 */

import { StringWriter } from "@modelscript/dsl/utils";
import { createWasmParser } from "@modelscript/modelica/parser";
import { ArenaDAEPrinter, initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { AnnotationEvaluator } from "../src/diagram/annotation-evaluator.js";
import { buildDiagramData, getClassIconSvg, renderDiagramSvg, x6MarkupToSvg } from "../src/diagram/data.js";
import type {
  DiagramComparisonResult,
  FlattenResult,
  IconValidationResult,
  SimComparisonResult,
  WorkerResult,
  WorkerTask,
} from "./msl-types.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// ── Hierarchy & Package Reconstruction ──────────────────────────────────────────

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

function resolveSymbolId(context: Context, name: string): number | null {
  const index = context.queryEngine.index;
  const parts = name.split(".");
  let currentIds = index.byName.get(parts[0]);
  if (!currentIds) return null;
  for (let i = 1; i < parts.length && currentIds && currentIds.length > 0; i++) {
    const part = parts[i];
    const nextIds: number[] = [];
    for (const parentId of currentIds) {
      const children = index.childrenOf.get(parentId);
      if (children) {
        for (const childId of children) {
          const childEntry = index.symbols.get(childId);
          if (childEntry && childEntry.name === part) {
            nextIds.push(childId);
          }
        }
      }
    }
    currentIds = nextIds;
  }
  return currentIds && currentIds.length > 0 ? currentIds[0] : null;
}

// ── OpenModelica Execution Helpers ─────────────────────────────────────────────

function cleanFlatText(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("true\n") || cleaned.startsWith("true\r\n")) {
    cleaned = cleaned.replace(/^true\r?\n/, "").trim();
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
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

interface OmcExecResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  cpuMs?: number;
  peakMemoryMB?: number;
}

function runOmcWithStats(cmdArgs: string[], options: { cwd?: string; timeout?: number }): OmcExecResult {
  const t0 = Date.now();
  const pyCode = `import resource, subprocess, sys
res = subprocess.run(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
r = resource.getrusage(resource.RUSAGE_CHILDREN)
sys.stderr.write(f'___OMC_STATS___:{r.ru_utime}:{r.ru_stime}:{r.ru_maxrss}\\n')
sys.stdout.buffer.write(res.stdout)
sys.stderr.buffer.write(res.stderr)
sys.exit(res.returncode)`;

  try {
    const res = spawnSync("python3", ["-c", pyCode, ...cmdArgs], {
      cwd: options.cwd,
      timeout: options.timeout ?? 60_000,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });

    const durationMs = Date.now() - t0;
    const stderrRaw = res.stderr || "";
    let cpuMs: number | undefined;
    let peakMemoryMB: number | undefined;
    let cleanStderr = stderrRaw;

    const statsMatch = stderrRaw.match(/___OMC_STATS___:([0-9.]+):([0-9.]+):([0-9]+)/);
    if (statsMatch) {
      const u = parseFloat(statsMatch[1]);
      const s = parseFloat(statsMatch[2]);
      const rssKb = parseInt(statsMatch[3], 10);
      cpuMs = Math.round((u + s) * 1000);
      peakMemoryMB = Number((rssKb / 1024).toFixed(2));
      cleanStderr = stderrRaw.replace(/___OMC_STATS___:[0-9.]+:[0-9.]+:[0-9]+\n?/, "");
    }

    return {
      stdout: res.stdout || "",
      stderr: cleanStderr,
      durationMs,
      cpuMs,
      peakMemoryMB,
    };
  } catch {
    const stdout = execSync(cmdArgs.map((a) => `"${a}"`).join(" "), {
      cwd: options.cwd,
      timeout: options.timeout ?? 60_000,
      encoding: "utf-8",
    });
    return {
      stdout,
      stderr: "",
      durationMs: Date.now() - t0,
    };
  }
}

function runOmcFlatten(task: WorkerTask): {
  success: boolean;
  cached: boolean;
  durationMs: number;
  cpuMs?: number;
  peakMemoryMB?: number;
  flatText: string;
  error?: string;
} {
  const omcCacheDir = path.join(task.cacheDir, "omc", task.version, "flat");
  fs.mkdirSync(omcCacheDir, { recursive: true });
  const cacheFile = path.join(omcCacheDir, `${task.modelFqn}.mo`);
  const metaFile = path.join(omcCacheDir, `${task.modelFqn}.meta.json`);

  if (!task.forceOmc && fs.existsSync(cacheFile)) {
    const flatText = fs.readFileSync(cacheFile, "utf-8");
    let meta: { durationMs: number; cpuMs?: number; peakMemoryMB?: number } = { durationMs: 0 };
    if (fs.existsSync(metaFile)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      } catch {
        // ignore
      }
    }
    return {
      success: true,
      cached: true,
      durationMs: meta.durationMs,
      cpuMs: meta.cpuMs,
      peakMemoryMB: meta.peakMemoryMB,
      flatText,
    };
  }

  const pkgMo = path.join(task.mslDir, "package.mo");
  const mosScript = `
loadFile("${pkgMo.replace(/\\/g, "/")}");
res := instantiateModel(${task.modelFqn});
err := getErrorString();
if res == "" then
  print("OMC_ERROR: " + err + "\\n");
else
  print(res);
end if;
`;

  const tmpMos = path.join(task.cacheDir, `temp_flat_${process.pid}_${Date.now()}.mos`);
  fs.writeFileSync(tmpMos, mosScript, "utf-8");

  try {
    const omcRes = runOmcWithStats(["omc", tmpMos], { timeout: 45_000 });
    const stdout = omcRes.stdout;
    const durationMs = omcRes.durationMs;
    const cpuMs = omcRes.cpuMs;
    const peakMemoryMB = omcRes.peakMemoryMB;

    if (stdout.includes("OMC_ERROR:") || omcRes.stderr.includes("OMC_ERROR:")) {
      const errLine =
        (stdout + "\n" + omcRes.stderr).split("\n").find((l) => l.includes("OMC_ERROR:")) || "Unknown OMC error";
      return { success: false, cached: false, durationMs, cpuMs, peakMemoryMB, flatText: "", error: errLine };
    }

    const flatText = stdout.trim();
    if (flatText.length > 0 && flatText.includes("class ")) {
      fs.writeFileSync(cacheFile, flatText, "utf-8");
      fs.writeFileSync(metaFile, JSON.stringify({ durationMs, cpuMs, peakMemoryMB }), "utf-8");
      return { success: true, cached: false, durationMs, cpuMs, peakMemoryMB, flatText };
    }
    return {
      success: false,
      cached: false,
      durationMs,
      cpuMs,
      peakMemoryMB,
      flatText: "",
      error: "Empty or invalid OMC output",
    };
  } catch (err: any) {
    return {
      success: false,
      cached: false,
      durationMs: 0,
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

function runOmcSimulate(
  task: WorkerTask,
  startTime: number,
  stopTime: number,
  intervals: number,
): {
  success: boolean;
  cached: boolean;
  durationMs: number;
  cpuMs?: number;
  peakMemoryMB?: number;
  csvContent?: string;
  error?: string;
} {
  const omcSimCacheDir = path.join(task.cacheDir, "omc", task.version, "sim");
  fs.mkdirSync(omcSimCacheDir, { recursive: true });
  const cacheFile = path.join(omcSimCacheDir, `${task.modelFqn}.csv`);
  const metaFile = path.join(omcSimCacheDir, `${task.modelFqn}.meta.json`);

  if (!task.forceOmc && fs.existsSync(cacheFile)) {
    const csvContent = fs.readFileSync(cacheFile, "utf-8");
    let meta: { durationMs: number; cpuMs?: number; peakMemoryMB?: number } = { durationMs: 0 };
    if (fs.existsSync(metaFile)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      } catch {
        // ignore
      }
    }
    return {
      success: true,
      cached: true,
      durationMs: meta.durationMs,
      cpuMs: meta.cpuMs,
      peakMemoryMB: meta.peakMemoryMB,
      csvContent,
    };
  }

  const pkgMo = path.join(task.mslDir, "package.mo");
  const tmpDir = path.join(task.cacheDir, `tmp_sim_${process.pid}_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const mosScript = `
loadFile("${pkgMo.replace(/\\/g, "/")}");
res := simulate(${task.modelFqn}, startTime=${startTime}, stopTime=${stopTime}, numberOfIntervals=${intervals}, outputFormat="csv");
err := getErrorString();
if err <> "" then
  print("OMC_ERROR: " + err + "\\n");
end if;
`;

  const mosPath = path.join(tmpDir, "run.mos");
  fs.writeFileSync(mosPath, mosScript, "utf-8");

  try {
    const omcRes = runOmcWithStats(["omc", mosPath], { cwd: tmpDir, timeout: 60_000 });
    const durationMs = omcRes.durationMs;
    const cpuMs = omcRes.cpuMs;
    const peakMemoryMB = omcRes.peakMemoryMB;

    const csvPath = path.join(tmpDir, `${task.modelFqn}_res.csv`);
    if (fs.existsSync(csvPath)) {
      const csvContent = fs.readFileSync(csvPath, "utf-8");
      fs.writeFileSync(cacheFile, csvContent, "utf-8");
      fs.writeFileSync(metaFile, JSON.stringify({ durationMs, cpuMs, peakMemoryMB }), "utf-8");
      return { success: true, cached: false, durationMs, cpuMs, peakMemoryMB, csvContent };
    }

    const err = omcRes.stdout.includes("OMC_ERROR:")
      ? omcRes.stdout.split("\n").find((l) => l.includes("OMC_ERROR:"))
      : "OMC simulation failed to generate CSV";
    return { success: false, cached: false, durationMs, cpuMs, peakMemoryMB, error: err };
  } catch (err: any) {
    return { success: false, cached: false, durationMs: 0, error: err.message || String(err) };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// ── Modelica Adapter Builder for Headless Diagrams and Icons ───────────────────

function buildClassAdapter(context: Context, symbolId: number, visited = new Set<number>()): any {
  if (visited.has(symbolId)) return null;
  visited.add(symbolId);

  const queryDB = context.queryEngine.toQueryDB();
  const entry = queryDB.symbol(symbolId);
  if (!entry) return null;
  const cstNode = queryDB.cstNode(symbolId);
  const evaluator = new AnnotationEvaluator();
  const children = queryDB.childrenOf(symbolId) || [];
  const components: any[] = [];
  const connectEquations: any[] = [];

  for (const child of children) {
    if (child.kind === "Component" || child.kind === "Variable") {
      const childCst = queryDB.cstNode(child.id);
      const childClassId = queryDB.query("classInstance", child.id);
      const compCls = childClassId ? buildClassAdapter(context, childClassId, new Set(visited)) : null;
      components.push({
        name: child.name,
        classInstance: compCls,
        annotation: (name: string) => (childCst ? evaluator.evaluate(childCst, name) : null),
      });
    } else if (child.kind === "ConnectEquation" || child.ruleName?.includes("connect")) {
      const connCst = queryDB.cstNode(child.id);
      connectEquations.push({
        cstNode: connCst,
        annotation: (name: string) => (connCst ? evaluator.evaluate(connCst, name) : null),
      });
    }
  }

  return {
    id: symbolId,
    db: queryDB,
    name: entry.name,
    components,
    connectEquations,
    extendsClassInstances: [],
    annotation: (name: string) => (cstNode ? evaluator.evaluate(cstNode, name) : null),
  };
}

// ── Verification Stage Executors ───────────────────────────────────────────────

function executeFlattenStage(context: Context, task: WorkerTask): FlattenResult {
  const omcRes = runOmcFlatten(task);
  const omcParsed = parseFlatModel(omcRes.flatText);

  const tStart = Date.now();
  const cpuStart = process.cpuUsage();
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
      msError = "flattenArena returned null (class not resolved)";
    }
  } catch (err: any) {
    msError = err.message || String(err);
  }

  const msDurationMs = Date.now() - tStart;
  const cpuDelta = process.cpuUsage(cpuStart);
  const msCpuMs = Math.round((cpuDelta.user + cpuDelta.system) / 1000);
  const msPeakMemMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
  const msParsed = parseFlatModel(msFlatText);

  const varCountMatch = omcParsed.vars.length === msParsed.vars.length;
  const eqCountMatch = omcParsed.eqs.length === msParsed.eqs.length;
  const diffLines =
    Math.abs(omcParsed.vars.length - msParsed.vars.length) + Math.abs(omcParsed.eqs.length - msParsed.eqs.length);
  const diffSummary =
    diffLines > 0
      ? `Variables: OMC=${omcParsed.vars.length}, MS=${msParsed.vars.length} (Δ${msParsed.vars.length - omcParsed.vars.length}) | Equations: OMC=${omcParsed.eqs.length}, MS=${msParsed.eqs.length} (Δ${msParsed.eqs.length - omcParsed.eqs.length})`
      : undefined;

  return {
    omc: {
      success: omcRes.success,
      cached: omcRes.cached,
      durationMs: omcRes.durationMs,
      cpuMs: omcRes.cpuMs,
      peakMemoryMB: omcRes.peakMemoryMB,
      varCount: omcParsed.vars.length,
      eqCount: omcParsed.eqs.length,
      error: omcRes.error,
    },
    modelscript: {
      success: msSuccess,
      durationMs: msDurationMs,
      cpuMs: msCpuMs,
      peakMemoryMB: msPeakMemMB,
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

async function executeSimulateStage(context: Context, task: WorkerTask): Promise<SimComparisonResult> {
  const isExample = task.modelFqn.includes(".Examples.");
  const arena = context.flattenArena(task.modelFqn, undefined, undefined, { omcCompatibility: true });

  if (!arena) {
    return {
      omc: { success: false, cached: false, durationMs: 0, stepCount: 0, error: "Flattening failed" },
      modelscript: { success: false, durationMs: 0, stepCount: 0, error: "ModelScript flattening failed" },
      comparison: {
        pass: false,
        matchedVariables: 0,
        maxRelativeError: 1.0,
        rmse: 1.0,
        errorSummary: "Flatten failed",
      },
    };
  }

  // Derive simulation parameters
  const exp = arena.experiment;
  const startTime = exp?.startTime ?? 0;
  const stopTime = task.simStopTime ?? exp?.stopTime ?? (isExample ? 1 : 0.1);
  const intervals = task.simIntervals ?? exp?.numberOfIntervals ?? 10;
  const tolerance = task.simTolerance ?? exp?.tolerance ?? 1e-3;

  // 1. Run OMC simulation
  const omcSim = runOmcSimulate(task, startTime, stopTime, intervals);
  if (!omcSim.success || !omcSim.csvContent) {
    return {
      omc: { success: false, cached: omcSim.cached, durationMs: omcSim.durationMs, stepCount: 0, error: omcSim.error },
      modelscript: { success: false, durationMs: 0, stepCount: 0 },
      comparison: { pass: false, matchedVariables: 0, maxRelativeError: 1.0, rmse: 1.0, errorSummary: omcSim.error },
    };
  }

  // 2. Parse OMC CSV
  const lines = omcSim.csvContent.trim().split("\n");
  const header = lines[0].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
  const omcDataByVar = new Map<string, number[]>();
  for (const h of header) omcDataByVar.set(h, []);

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",").map(Number);
    for (let c = 0; c < header.length; c++) {
      omcDataByVar.get(header[c])?.push(row[c]);
    }
  }

  // 3. Run ModelScript simulation
  const t0 = Date.now();
  const cpuStart = process.cpuUsage();
  let msSuccess = false;
  let msError: string | undefined;
  let msRes: any;

  try {
    const outIds: number[] = [];
    for (let i = 0; i < arena.varCount; i++) {
      outIds.push(arena.getVarNameId(i));
    }

    msRes = await simulateArena(arena as any, {
      startTime,
      stopTime,
      numberOfIntervals: intervals,
      outputStringIds: outIds,
    });
    msSuccess = true;
  } catch (err: any) {
    msError = err.message || String(err);
  }

  const msDuration = Date.now() - t0;
  const cpuDelta = process.cpuUsage(cpuStart);
  const msCpuMs = Math.round((cpuDelta.user + cpuDelta.system) / 1000);
  const msPeakMemMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

  if (!msSuccess || !msRes) {
    return {
      omc: {
        success: true,
        cached: omcSim.cached,
        durationMs: omcSim.durationMs,
        cpuMs: omcSim.cpuMs,
        peakMemoryMB: omcSim.peakMemoryMB,
        stepCount: lines.length - 1,
      },
      modelscript: {
        success: false,
        durationMs: msDuration,
        cpuMs: msCpuMs,
        peakMemoryMB: msPeakMemMB,
        stepCount: 0,
        error: msError,
      },
      comparison: { pass: false, matchedVariables: 0, maxRelativeError: 1.0, rmse: 1.0, errorSummary: msError },
    };
  }

  // 4. Compare trajectories across common variables
  let maxRelErr = 0;
  let totalSqErr = 0;
  let totalPoints = 0;
  let matchedVars = 0;

  for (let sIdx = 0; sIdx < msRes.states.length; sIdx++) {
    const varName = msRes.states[sIdx];
    const omcValues = omcDataByVar.get(varName);
    if (!omcValues || omcValues.length === 0) continue;

    matchedVars++;
    const numPoints = Math.min(msRes.y.length, omcValues.length);
    for (let p = 0; p < numPoints; p++) {
      const msVal = msRes.y[p][sIdx];
      const omcVal = omcValues[p];
      if (Number.isFinite(msVal) && Number.isFinite(omcVal)) {
        const diff = Math.abs(msVal - omcVal);
        const rel = diff / (1 + Math.abs(omcVal));
        if (rel > maxRelErr) maxRelErr = rel;
        totalSqErr += diff * diff;
        totalPoints++;
      }
    }
  }

  const rmse = totalPoints > 0 ? Math.sqrt(totalSqErr / totalPoints) : 0;
  const pass = matchedVars > 0 && maxRelErr <= tolerance;
  const errorSummary = !pass
    ? `Max Relative Error: ${maxRelErr.toExponential(2)} (tol: ${tolerance}) | RMSE: ${rmse.toExponential(2)} across ${matchedVars} variables`
    : undefined;

  // Extract a sample trajectory for the primary variable for visualization
  let sampleTrajectory: SimComparisonResult["comparison"]["sampleTrajectory"] | undefined;
  if (matchedVars > 0 && msRes.states.length > 0) {
    for (let sIdx = 0; sIdx < msRes.states.length; sIdx++) {
      const varName = msRes.states[sIdx];
      const omcValues = omcDataByVar.get(varName);
      if (omcValues && omcValues.length > 0) {
        const numPoints = Math.min(msRes.y.length, omcValues.length);
        const sampleTarget = Math.min(30, numPoints);
        const stride = Math.max(1, Math.floor(numPoints / sampleTarget));
        const times: number[] = [];
        const omcVals: number[] = [];
        const msVals: number[] = [];
        for (let p = 0; p < numPoints; p += stride) {
          times.push(Number((msRes.t?.[p] ?? p).toFixed(4)));
          omcVals.push(Number(omcValues[p].toFixed(5)));
          msVals.push(Number(msRes.y[p][sIdx].toFixed(5)));
        }
        const lastIdx = numPoints - 1;
        if (times[times.length - 1] !== Number((msRes.t?.[lastIdx] ?? lastIdx).toFixed(4))) {
          times.push(Number((msRes.t?.[lastIdx] ?? lastIdx).toFixed(4)));
          omcVals.push(Number(omcValues[lastIdx].toFixed(5)));
          msVals.push(Number(msRes.y[lastIdx][sIdx].toFixed(5)));
        }
        sampleTrajectory = {
          variable: varName,
          times,
          omcValues: omcVals,
          msValues: msVals,
        };
        break;
      }
    }
  }

  return {
    omc: {
      success: true,
      cached: omcSim.cached,
      durationMs: omcSim.durationMs,
      cpuMs: omcSim.cpuMs,
      peakMemoryMB: omcSim.peakMemoryMB,
      stepCount: lines.length - 1,
    },
    modelscript: {
      success: true,
      durationMs: msDuration,
      cpuMs: msCpuMs,
      peakMemoryMB: msPeakMemMB,
      stepCount: msRes.t?.length || 0,
    },
    comparison: {
      pass,
      matchedVariables: matchedVars,
      maxRelativeError: maxRelErr,
      rmse,
      errorSummary,
      sampleTrajectory,
    },
  };
}

function executeIconStage(context: Context, task: WorkerTask): IconValidationResult {
  const symId = resolveSymbolId(context, task.modelFqn);
  if (!symId) {
    return {
      modelscript: {
        success: false,
        durationMs: 0,
        cpuMs: 0,
        peakMemoryMB: 0,
        svgLength: 0,
        elementCount: 0,
        error: "Symbol not found in index",
      },
      validSvg: false,
      hasGraphics: false,
    };
  }

  const t0 = Date.now();
  const cpuStart = process.cpuUsage();
  try {
    const cls = buildClassAdapter(context, symId);
    const iconAnn = cls.annotation?.("Icon");
    if (!iconAnn) {
      const cpuDelta = process.cpuUsage(cpuStart);
      return {
        modelscript: {
          success: true,
          durationMs: Date.now() - t0,
          cpuMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
          peakMemoryMB: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
          svgLength: 0,
          elementCount: 0,
        },
        validSvg: true,
        hasGraphics: false,
      };
    }

    const svg = getClassIconSvg(cls, 80, true);
    const durationMs = Date.now() - t0;
    const cpuDelta = process.cpuUsage(cpuStart);
    const cpuMs = Math.round((cpuDelta.user + cpuDelta.system) / 1000);
    const peakMemoryMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

    if (!svg || svg.length === 0) {
      return {
        modelscript: {
          success: false,
          durationMs,
          cpuMs,
          peakMemoryMB,
          svgLength: 0,
          elementCount: 0,
          error: "Icon SVG was empty",
        },
        validSvg: false,
        hasGraphics: false,
      };
    }

    const validSvg = svg.startsWith("<svg") && svg.endsWith("</svg>") && !svg.includes("NaN");
    const elemMatches = svg.match(/<(path|rect|polygon|ellipse|line|text|circle)\b/gi);
    const elementCount = elemMatches ? elemMatches.length : 0;
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    const svgPreview = validSvg && svg.length <= 40_000 ? svg : undefined;

    return {
      modelscript: {
        success: validSvg && elementCount > 0,
        durationMs,
        cpuMs,
        peakMemoryMB,
        svgLength: svg.length,
        elementCount,
        viewBox: viewBoxMatch ? viewBoxMatch[1] : undefined,
        svgPreview,
      },
      validSvg,
      hasGraphics: elementCount > 0,
    };
  } catch (err: any) {
    const cpuDelta = process.cpuUsage(cpuStart);
    return {
      modelscript: {
        success: false,
        durationMs: Date.now() - t0,
        cpuMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
        peakMemoryMB: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
        svgLength: 0,
        elementCount: 0,
        error: err.message,
      },
      validSvg: false,
      hasGraphics: false,
    };
  }
}

async function executeDiagramStage(context: Context, task: WorkerTask): Promise<DiagramComparisonResult> {
  const symId = resolveSymbolId(context, task.modelFqn);
  if (!symId) {
    return {
      modelscript: {
        success: false,
        durationMs: 0,
        cpuMs: 0,
        peakMemoryMB: 0,
        nodeCount: 0,
        edgeCount: 0,
        unresolvedCount: 0,
        svgLength: 0,
        error: "Symbol not found in index",
      },
      hasUnresolvedNodes: true,
      validSvg: false,
    };
  }

  const t0 = Date.now();
  const cpuStart = process.cpuUsage();
  try {
    const cls = buildClassAdapter(context, symId);
    if (!cls || (cls.components.length === 0 && !cls.annotation?.("Diagram"))) {
      const cpuDelta = process.cpuUsage(cpuStart);
      return {
        modelscript: {
          success: true,
          durationMs: Date.now() - t0,
          cpuMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
          peakMemoryMB: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
          nodeCount: 0,
          edgeCount: 0,
          unresolvedCount: 0,
          svgLength: 0,
        },
        hasUnresolvedNodes: false,
        validSvg: true,
      };
    }
    const diagData = await buildDiagramData(cls);
    const nodeCount = diagData.nodes?.length || 0;
    const edgeCount = diagData.edges?.length || 0;
    const unresolved = diagData.nodes?.filter((n: any) => n.markup?.children?.[0]?.attrs?.stroke === "#ef4444") || [];
    let fullSvg = renderDiagramSvg(cls);
    if (!fullSvg && nodeCount > 0) {
      const minX = diagData.coordinateSystem?.extent?.[0]?.[0] ?? -100;
      const minY = diagData.coordinateSystem?.extent?.[0]?.[1] ?? -100;
      const maxX = diagData.coordinateSystem?.extent?.[1]?.[0] ?? 100;
      const maxY = diagData.coordinateSystem?.extent?.[1]?.[1] ?? 100;
      const width = Math.abs(maxX - minX) || 200;
      const height = Math.abs(maxY - minY) || 200;
      const nodeSvgs = diagData.nodes
        .map((n) => `<g transform="translate(${n.x},${n.y})">${n.markup ? x6MarkupToSvg(n.markup) : ""}</g>`)
        .join("");
      fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}">${nodeSvgs}</svg>`;
    }
    const durationMs = Date.now() - t0;
    const cpuDelta = process.cpuUsage(cpuStart);
    const cpuMs = Math.round((cpuDelta.user + cpuDelta.system) / 1000);
    const peakMemoryMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
    const validSvg =
      (fullSvg.startsWith("<svg") && fullSvg.endsWith("</svg>") && !fullSvg.includes("NaN")) ||
      (nodeCount > 0 && unresolved.length === 0);
    const svgPreview = validSvg && fullSvg.length <= 80_000 ? fullSvg : undefined;

    return {
      modelscript: {
        success: validSvg && unresolved.length === 0,
        durationMs,
        cpuMs,
        peakMemoryMB,
        nodeCount,
        edgeCount,
        unresolvedCount: unresolved.length,
        svgLength: fullSvg.length,
        svgPreview,
      },
      hasUnresolvedNodes: unresolved.length > 0,
      validSvg,
    };
  } catch (err: any) {
    const cpuDelta = process.cpuUsage(cpuStart);
    return {
      modelscript: {
        success: false,
        durationMs: Date.now() - t0,
        cpuMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
        peakMemoryMB: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
        nodeCount: 0,
        edgeCount: 0,
        unresolvedCount: 0,
        svgLength: 0,
        error: err.message,
      },
      hasUnresolvedNodes: true,
      validSvg: false,
    };
  }
}

// ── Worker Task Runner ─────────────────────────────────────────────────────────

async function runTask(task: WorkerTask): Promise<WorkerResult> {
  const tTotalStart = Date.now();

  // 1. Initialize WASM & ModelScript context
  await initBltWasm();
  const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const context = new Context(new NodeFileSystem());

  // 2. Hydrate index from cache
  const rawIndex = JSON.parse(fs.readFileSync(task.indexCachePath, "utf-8"));
  const symbolIndex = {
    symbols: new Map<number, any>(rawIndex.symbols),
    byName: new Map<string, number[]>(rawIndex.byName),
    childrenOf: new Map<number, number[]>(rawIndex.childrenOf),
  };

  linkMslPackageHierarchy(symbolIndex, task.mslDir);
  context.setSymbolIndex(symbolIndex);

  // 3. Route according to task.stage
  let status: WorkerResult["status"] = "MATCH";
  let flattenRes: FlattenResult | undefined;
  let simRes: SimComparisonResult | undefined;
  let iconRes: IconValidationResult | undefined;
  let diagRes: DiagramComparisonResult | undefined;

  const stage = task.stage || "all";

  if (stage === "flatten" || stage === "all") {
    flattenRes = executeFlattenStage(context, task);
    if (!flattenRes.omc.success) status = "OMC_ERROR";
    else if (!flattenRes.modelscript.success) status = "MS_ERROR";
    else if (!flattenRes.comparison.varCountMatch || !flattenRes.comparison.eqCountMatch) status = "DIFF";
  }

  if (stage === "simulate" || stage === "all") {
    simRes = await executeSimulateStage(context, task);
    if (stage === "simulate") {
      if (!simRes.omc.success) status = "OMC_ERROR";
      else if (!simRes.modelscript.success) status = "MS_ERROR";
      else if (!simRes.comparison.pass) status = "DIFF";
    } else if (status === "MATCH" && !simRes.comparison.pass) {
      status = "DIFF";
    }
  }

  if (stage === "icon" || stage === "all") {
    iconRes = executeIconStage(context, task);
    if (stage === "icon") {
      if (!iconRes.modelscript.success) {
        status = "MS_ERROR";
      } else if (!iconRes.hasGraphics) {
        status = "SKIPPED";
      }
    }
  }

  if (stage === "diagram" || stage === "all") {
    diagRes = await executeDiagramStage(context, task);
    if (stage === "diagram") {
      if (!diagRes.modelscript.success) {
        status = "MS_ERROR";
      } else if (diagRes.modelscript.nodeCount === 0 && diagRes.modelscript.svgLength === 0) {
        status = "SKIPPED";
      } else if (diagRes.hasUnresolvedNodes) {
        status = "DIFF";
      }
    }
  }

  let error: string | undefined;
  if (status === "MS_ERROR") {
    error =
      diagRes?.modelscript.error ||
      iconRes?.modelscript.error ||
      flattenRes?.modelscript.error ||
      simRes?.modelscript.error;
  }

  const cpuMs =
    (simRes?.modelscript.cpuMs ?? 0) +
    (flattenRes?.modelscript.cpuMs ?? 0) +
    (iconRes?.modelscript.cpuMs ?? 0) +
    (diagRes?.modelscript.cpuMs ?? 0);
  const peakMemoryMB = Math.max(
    simRes?.modelscript.peakMemoryMB ?? 0,
    flattenRes?.modelscript.peakMemoryMB ?? 0,
    iconRes?.modelscript.peakMemoryMB ?? 0,
    diagRes?.modelscript.peakMemoryMB ?? 0,
    Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
  );

  return {
    modelFqn: task.modelFqn,
    status,
    stage,
    durationMs: Date.now() - tTotalStart,
    cpuMs,
    peakMemoryMB,
    flatten: flattenRes,
    simulation: simRes,
    icon: iconRes,
    diagram: diagRes,
    error,
  };
}

// ── Standard Input / Output IPC ───────────────────────────────────────────────

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
