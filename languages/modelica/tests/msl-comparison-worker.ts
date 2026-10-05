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
import { Cst } from "../src-gen/bindings.js";
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

export function linkMslPackageHierarchy(
  symbolIndex: { symbols: Map<number, any>; byName: Map<string, number[]>; childrenOf: Map<number, number[]> },
  mslDir: string,
): void {
  let nextId = 100000;
  for (const id of symbolIndex.symbols.keys()) {
    if (id > nextId) nextId = id + 1;
  }

  // Pre-index existing package symbols by their FQN
  for (const [id, sym] of symbolIndex.symbols.entries()) {
    if (
      sym.kind === "Class" &&
      sym.ruleName === "class_definition" &&
      sym.resourceId &&
      sym.resourceId.startsWith(mslDir)
    ) {
      const rel = path.relative(mslDir, sym.resourceId).replace(/\\/g, "/");
      if (rel.endsWith("/package.mo") || rel === "package.mo") {
        const parts = rel
          .replace(/\/?package\.mo$/, "")
          .split("/")
          .filter(Boolean);
        const isPkgMatch =
          (parts.length === 0 && sym.name === "Modelica") || (parts.length > 0 && sym.name === parts[parts.length - 1]);
        if (isPkgMatch) {
          const fqn = ["Modelica", ...parts].join(".");
          const list = symbolIndex.byName.get(fqn) || [];
          if (!list.includes(id)) {
            list.unshift(id);
            symbolIndex.byName.set(fqn, list);
          }
        }
      }
    }
  }

  function getOrCreatePackageSymbol(fqn: string): number {
    const parts = fqn.split(".");
    let parentId: number | null = null;
    let currentFQN = "";

    for (const part of parts) {
      currentFQN = currentFQN ? `${currentFQN}.${part}` : part;
      const foundList = symbolIndex.byName.get(currentFQN);
      let symId: number | undefined;

      if (foundList && foundList.length > 0) {
        for (const candidateId of foundList) {
          const candidate = symbolIndex.symbols.get(candidateId);
          if (
            candidate &&
            candidate.kind === "Class" &&
            (candidate.ruleName === "class_definition" || candidate.metadata?.classKind === "package")
          ) {
            symId = candidateId;
            break;
          }
        }
      }

      if (symId !== undefined) {
        if (currentFQN === "Modelica") {
          const modSym = symbolIndex.symbols.get(symId);
          if (modSym) modSym.parentId = null;
        } else if (parentId !== null && symId !== parentId) {
          const existingSym = symbolIndex.symbols.get(symId);
          if (existingSym && (existingSym.parentId === null || existingSym.parentId === undefined)) {
            existingSym.parentId = parentId;
            const childList = symbolIndex.childrenOf.get(parentId) || [];
            if (!childList.includes(symId)) {
              childList.push(symId);
              symbolIndex.childrenOf.set(parentId, childList);
            }
          }
        }
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
        byFQN.unshift(symId);
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
        if (dirParts.length <= 1) {
          parentPkgFQN = "";
        } else {
          const pkgName = dirParts[dirParts.length - 2];
          if (sym.name === pkgName) {
            parentPkgFQN = ["Modelica", ...dirParts.slice(0, -2)].join(".");
          } else {
            parentPkgFQN = ["Modelica", ...dirParts.slice(0, -1)].join(".");
          }
        }
      } else {
        parentPkgFQN = ["Modelica", ...dirParts].join(".");
      }

      if (parentPkgFQN) {
        const parentPkgId = getOrCreatePackageSymbol(parentPkgFQN);
        if (parentPkgId !== id) {
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
}

export function resolveSymbolId(context: Context, name: string): number | null {
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

function runOmcDiagram(
  task: WorkerTask,
  inheritedFqns: string[] = [],
): {
  success: boolean;
  cached: boolean;
  durationMs?: number;
  cpuMs?: number;
  peakMemoryMB?: number;
  nodeCount: number;
  edgeCount: number;
  components: { name: string; type: string; placement?: any }[];
  connections: { from: string; to: string }[];
  error?: string;
  hasInherited?: boolean;
} {
  const omcCacheDir = path.join(task.cacheDir, "omc", task.version, "diagram");
  fs.mkdirSync(omcCacheDir, { recursive: true });
  const cacheFile = path.join(omcCacheDir, `${task.modelFqn}.json`);

  if (!task.forceOmc && fs.existsSync(cacheFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      if (!inheritedFqns || inheritedFqns.length === 0 || data.hasInherited) {
        return {
          ...data,
          cached: true,
        };
      }
    } catch {
      // cache corrupted, re-run
    }
  }

  const pkgMo = path.join(task.mslDir, "package.mo");
  const allClasses = [task.modelFqn, ...inheritedFqns];

  const mosScript = `
loadFile("${pkgMo.replace(/\\/g, "/")}");
${allClasses
  .map(
    (cls, idx) => `
cCount_${idx} := getConnectionCount(${cls});
print("CONN_START_${idx}\\n");
for i in 1:cCount_${idx} loop
  c := getNthConnection(${cls}, i);
  print("CONN:" + c[1] + "->" + c[2] + "\\n");
end for;
print("CONN_END_${idx}\\n");
print("COMPS_START_${idx}\\n");
getComponents(${cls});
print("COMPS_END_${idx}\\n");
print("ANNOTS_START_${idx}\\n");
getComponentAnnotations(${cls});
print("ANNOTS_END_${idx}\\n");
`,
  )
  .join("\n")}
print("DIAG_START\\n");
getDiagramAnnotation(${task.modelFqn});
print("DIAG_END\\n");
`;

  const tmpMos = path.join(task.cacheDir, `temp_diag_${process.pid}_${Date.now()}.mos`);
  fs.writeFileSync(tmpMos, mosScript, "utf-8");

  try {
    const omcRes = runOmcWithStats(["omc", tmpMos], { timeout: 45_000 });
    const stdout = omcRes.stdout;

    if (stdout.includes("Error:") && !stdout.includes("COMPS_START_0")) {
      return {
        success: false,
        cached: false,
        durationMs: omcRes.durationMs,
        cpuMs: omcRes.cpuMs,
        peakMemoryMB: omcRes.peakMemoryMB,
        nodeCount: 0,
        edgeCount: 0,
        components: [],
        connections: [],
        error: stdout.slice(0, 300),
      };
    }

    // Parse connections across all classes
    const connections: { from: string; to: string }[] = [];
    const connSet = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("CONN:")) {
        const arrowIdx = line.indexOf("->");
        if (arrowIdx >= 0) {
          const from = line.slice(5, arrowIdx).trim();
          const to = line.slice(arrowIdx + 2).trim();
          if (from && to) {
            const key = `${from}->${to}`;
            if (!connSet.has(key)) {
              connSet.add(key);
              connections.push({ from, to });
            }
          }
        }
      }
    }

    // Parse components and annotations across all classes
    const placedComps: { name: string; type: string; placement?: any }[] = [];
    const compNameSet = new Set<string>();

    for (let idx = 0; idx < allClasses.length; idx++) {
      const compsStart = stdout.indexOf(`COMPS_START_${idx}`);
      const compsEnd = stdout.indexOf(`COMPS_END_${idx}`);
      const rawComps: { type: string; name: string }[] = [];
      if (compsStart >= 0 && compsEnd > compsStart) {
        const compsSection = stdout.slice(compsStart, compsEnd);
        const compRe = /\{([a-zA-Z0-9_.]+),\s*([a-zA-Z0-9_]+),/g;
        let compM;
        while ((compM = compRe.exec(compsSection)) !== null) {
          rawComps.push({ type: compM[1], name: compM[2] });
        }
      }

      const annotsStart = stdout.indexOf(`ANNOTS_START_${idx}`);
      const annotsEnd = stdout.indexOf(`ANNOTS_END_${idx}`);
      const placements: (any | null)[] = [];
      if (annotsStart >= 0 && annotsEnd > annotsStart) {
        const annotsSection = stdout.slice(annotsStart, annotsEnd);
        let depth = 0;
        let current = "";
        const items: string[] = [];
        const trimmed = annotsSection.trim();
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          const inner = trimmed.slice(firstBrace + 1, lastBrace);
          for (const ch of inner) {
            if (ch === "{" || ch === "(") depth++;
            else if (ch === "}" || ch === ")") depth--;

            if (depth === 0 && ch === ",") {
              items.push(current.trim());
              current = "";
            } else {
              current += ch;
            }
          }
          if (current.trim()) items.push(current.trim());
        }

        const placementRe =
          /Placement\((true|false|-),([-\d.]*|-),([-\d.]*|-),([-\d.]*|-),([-\d.]*|-),([-\d.]*|-),([-\d.]*|-),([-\d.]*|-)/;
        for (let i = 0; i < rawComps.length; i++) {
          const annotStr = items[i] || "";
          const pm = placementRe.exec(annotStr);
          if (pm) {
            placements.push({
              visible: pm[1] === "true",
              origin: [
                pm[2] === "-" || !pm[2] ? 0 : parseFloat(pm[2]),
                pm[3] === "-" || !pm[3] ? 0 : parseFloat(pm[3]),
              ],
              extent: [
                [pm[4] === "-" || !pm[4] ? -10 : parseFloat(pm[4]), pm[5] === "-" || !pm[5] ? -10 : parseFloat(pm[5])],
                [pm[6] === "-" || !pm[6] ? 10 : parseFloat(pm[6]), pm[7] === "-" || !pm[7] ? 10 : parseFloat(pm[7])],
              ],
              rotation: pm[8] === "-" || !pm[8] ? 0 : parseFloat(pm[8]),
            });
          } else {
            placements.push(null);
          }
        }
      }

      for (let i = 0; i < rawComps.length; i++) {
        const c = rawComps[i];
        const p = placements[i];
        if (p != null && !compNameSet.has(c.name)) {
          compNameSet.add(c.name);
          placedComps.push({ ...c, placement: p });
        }
      }
    }

    const result = {
      success: true,
      cached: false,
      durationMs: omcRes.durationMs,
      cpuMs: omcRes.cpuMs,
      peakMemoryMB: omcRes.peakMemoryMB,
      nodeCount: placedComps.length,
      edgeCount: connections.length,
      components: placedComps,
      connections,
      hasInherited: inheritedFqns.length > 0,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(result), "utf-8");
    return result;
  } catch (err: any) {
    return {
      success: false,
      cached: false,
      durationMs: 0,
      nodeCount: 0,
      edgeCount: 0,
      components: [],
      connections: [],
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

// ── Modelica Adapter Builder for Headless Diagrams and Icons ───────────────────

export function getScopeFromResourceId(resId: string): string[] {
  if (!resId) return [];
  const normalized = resId.replace(/\\/g, "/");
  const match = normalized.match(/(?:Modelica[^/]*\/)(.+)\.mo$/);
  if (!match) return [];
  const parts = match[1].split("/").filter(Boolean);
  return ["Modelica", ...parts];
}

export function collectInheritedClassFqns(cls: any, visited = new Set<string>()): string[] {
  const fqns: string[] = [];
  if (!cls || !cls.extendsClassInstances) return fqns;
  for (const ext of cls.extendsClassInstances) {
    const baseCls = ext?.classInstance;
    if (!baseCls) continue;
    let fqn = "";
    if (baseCls.id != null && cls.context) {
      const symIndex = cls.context.queryEngine?.index;
      if (symIndex) {
        const parts: string[] = [];
        let curr = symIndex.symbols.get(baseCls.id);
        while (curr) {
          if (curr.name) parts.unshift(curr.name);
          if (curr.parentId == null || curr.parentId === curr.id) break;
          curr = symIndex.symbols.get(curr.parentId);
        }
        if (parts.length > 0) fqn = parts.join(".");
      }
    }
    if (!fqn && baseCls.entry?.resourceId) {
      const scope = getScopeFromResourceId(baseCls.entry.resourceId);
      if (scope.length > 0) fqn = scope.join(".");
    }
    if (!fqn && baseCls.name) fqn = baseCls.name;
    if (fqn && !visited.has(fqn)) {
      visited.add(fqn);
      if (!fqn.startsWith("Modelica.Icons.")) {
        fqns.push(fqn);
      }
      fqns.push(...collectInheritedClassFqns(baseCls, visited));
    }
  }
  return fqns;
}

export function buildClassAdapter(context: Context, symbolId: number, visited = new Set<number>()): any {
  if (visited.has(symbolId)) return null;
  visited.add(symbolId);

  const queryDB = context.queryEngine.toQueryDB();
  const entry = queryDB.symbol(symbolId);
  if (!entry) return null;
  const cstNode = queryDB.cstNode(symbolId);
  const children = queryDB.childrenOf(symbolId) || [];
  const components: any[] = [];
  const connectEquations: any[] = [];
  const extendsClassInstances: any[] = [];

  for (const child of children) {
    if (child.kind === "Component" || child.kind === "Variable") {
      const childCst = queryDB.cstNode(child.id);
      const childClassId = queryDB.query("classInstance", child.id);
      const compCls = childClassId ? buildClassAdapter(context, childClassId, new Set(visited)) : null;
      const childMod = queryDB.query("effectiveModification", child.id) as any;
      let exprText = childMod?.bindingExpression?.text ?? childMod?.bindingExpression?.value;
      if (exprText === undefined && childMod?.args) {
        const startArg = childMod.args.find((a: any) => a.name === "start");
        if (startArg) {
          exprText = startArg.value?.text ?? startArg.value;
        }
      }
      components.push({
        id: child.id,
        name: child.name,
        entry: child,
        classInstance: compCls,
        modification: {
          expression: exprText !== undefined ? { text: String(exprText) } : undefined,
          getModificationArgument: (argName: string) => {
            const foundArg = childMod?.args?.find((a: any) => a.name === argName);
            if (foundArg) {
              const valText = foundArg.value?.text ?? foundArg.value;
              return { expression: valText !== undefined ? { text: String(valText) } : undefined };
            }
            return undefined;
          },
        },
      });
    } else if (child.kind === "ConnectEquation" || child.ruleName?.includes("connect")) {
      const connCst = queryDB.cstNode(child.id);
      let lhs = "";
      let rhs = "";
      if (connCst) {
        const lhsNode = Cst?.ConnectEquation?.lhs ? Cst.ConnectEquation.lhs(connCst) : null;
        const rhsNode = Cst?.ConnectEquation?.rhs ? Cst.ConnectEquation.rhs(connCst) : null;
        lhs = lhsNode?.text?.trim() ?? "";
        rhs = rhsNode?.text?.trim() ?? "";
        if (!lhs || !rhs) {
          const cRefs = (connCst.children || []).filter(
            (c: any) => c.type === "component_reference" || c.type === "ComponentReference",
          );
          if (!lhs && cRefs.length > 0) lhs = cRefs[0]?.text?.trim() ?? "";
          if (!rhs && cRefs.length > 1) rhs = cRefs[1]?.text?.trim() ?? "";
        }
      }
      if (!lhs && child.metadata?.lhs) lhs = String(child.metadata.lhs);
      if (!rhs && child.metadata?.rhs) rhs = String(child.metadata.rhs);
      connectEquations.push({
        lhs,
        rhs,
        cstNode: connCst,
        annotation: (name: string) => (connCst ? new AnnotationEvaluator().evaluate(connCst, name) : null),
      });
    } else if (child.kind === "Extends" || child.ruleName?.includes("extends")) {
      let baseSym = queryDB.query("resolvedBaseClass", child.id);
      if (!baseSym && child.name) {
        let baseId = resolveSymbolId(context, child.name);
        if (!baseId && entry.resourceId) {
          const fullScope = getScopeFromResourceId(entry.resourceId);
          if (fullScope.length > 0) fullScope.pop(); // drop class or package filename
          while (fullScope.length > 0 && !baseId) {
            baseId = resolveSymbolId(context, `${fullScope.join(".")}.${child.name}`);
            fullScope.pop();
          }
        }
        if (baseId) baseSym = queryDB.symbol(baseId);
      }
      if (baseSym && !visited.has(baseSym.id)) {
        const baseAdapter = buildClassAdapter(context, baseSym.id, new Set(visited));
        if (baseAdapter) {
          extendsClassInstances.push({ classInstance: baseAdapter });
        }
      }
    }
  }

  const adapter: any = {
    id: symbolId,
    db: queryDB,
    context,
    name: entry.name,
    classKind: entry.metadata?.classKind,
    entry,
    components,
    connectEquations,
    extendsClassInstances,
  };

  adapter.resolveName = (parts: string[]): any => {
    if (!parts || parts.length === 0) return null;
    const [first, ...rest] = parts;
    let found = components.find((c) => c.name === first);
    if (!found) {
      for (const ext of extendsClassInstances) {
        found = ext.classInstance?.resolveName?.([first]);
        if (found) break;
      }
    }
    if (!found) return null;
    if (rest.length === 0) return found;
    return found.classInstance?.resolveName?.(rest) ?? null;
  };

  const evaluator = new AnnotationEvaluator(adapter);
  for (const comp of components) {
    const childCst = queryDB.cstNode(comp.id);
    comp.annotation = (name: string) => (childCst ? evaluator.evaluate(childCst, name) : null);
  }

  adapter.annotation = (name: string) => (cstNode ? evaluator.evaluate(cstNode, name) : null);
  return adapter;
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

function hasAnyIconAnnotation(cls: any, visited = new Set<any>()): boolean {
  if (!cls || visited.has(cls)) return false;
  visited.add(cls);
  if (cls.annotation?.("Icon")) return true;
  for (const ext of cls.extendsClassInstances || []) {
    const base = ext.classInstance;
    if (base && hasAnyIconAnnotation(base, visited)) return true;
  }
  return false;
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
    const svg = getClassIconSvg(cls, 80, true);
    const durationMs = Date.now() - t0;
    const cpuDelta = process.cpuUsage(cpuStart);
    const cpuMs = Math.round((cpuDelta.user + cpuDelta.system) / 1000);
    const peakMemoryMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

    if (!svg || svg.length === 0) {
      const hasIcon = hasAnyIconAnnotation(cls);
      return {
        modelscript: {
          success: !hasIcon,
          durationMs,
          cpuMs,
          peakMemoryMB,
          svgLength: 0,
          elementCount: 0,
          error: hasIcon ? "Icon SVG was empty" : undefined,
        },
        validSvg: true,
        hasGraphics: false,
      };
    }

    const validSvg = svg.startsWith("<svg") && svg.endsWith("</svg>") && !svg.includes("NaN");
    const elemMatches = svg.match(/<(path|rect|polygon|polyline|ellipse|line|text|circle|image)\b/gi);
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
      (nodeCount > 0 && unresolved.length === 0) ||
      (nodeCount === 0 && edgeCount === 0);
    const svgPreview = validSvg && fullSvg.length <= 80_000 ? fullSvg : undefined;

    const inheritedFqns = collectInheritedClassFqns(cls);
    const omcDiag = runOmcDiagram(task, inheritedFqns);
    const nodeCountMatch = !omcDiag.success || nodeCount === omcDiag.nodeCount;
    const edgeCountMatch = !omcDiag.success || edgeCount === omcDiag.edgeCount;

    let diffSummary: string | undefined;
    if (omcDiag.success && (!nodeCountMatch || !edgeCountMatch)) {
      const msNames = diagData.nodes?.map((n: any) => n.id) || [];
      const omcNames = omcDiag.components?.map((c: any) => c.name) || [];
      const extraInMs = msNames.filter((n: string) => !omcNames.includes(n));
      const extraInOmc = omcNames.filter((n: string) => !msNames.includes(n));
      diffSummary = `Nodes: MS=${nodeCount} vs OMC=${omcDiag.nodeCount} | Edges: MS=${edgeCount} vs OMC=${omcDiag.edgeCount}`;
      if (extraInMs.length > 0) diffSummary += ` | Extra MS: [${extraInMs.join(", ")}]`;
      if (extraInOmc.length > 0) diffSummary += ` | Extra OMC: [${extraInOmc.join(", ")}]`;
    } else if (unresolved.length > 0) {
      diffSummary = `${unresolved.length} unresolved nodes: ${unresolved.map((u: any) => u.id).join(", ")}`;
    }

    return {
      omc: omcDiag.success
        ? {
            success: true,
            cached: omcDiag.cached,
            durationMs: omcDiag.durationMs,
            cpuMs: omcDiag.cpuMs,
            peakMemoryMB: omcDiag.peakMemoryMB,
            nodeCount: omcDiag.nodeCount,
            edgeCount: omcDiag.edgeCount,
            components: omcDiag.components,
            connections: omcDiag.connections,
          }
        : undefined,
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
      nodeCountMatch,
      edgeCountMatch,
      hasUnresolvedNodes: unresolved.length > 0,
      validSvg,
      diffSummary,
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
  await context.addLibrary(task.mslDir, { skipIndex: true });

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
      } else if (
        diagRes.hasUnresolvedNodes ||
        (diagRes.nodeCountMatch !== undefined && !diagRes.nodeCountMatch) ||
        (diagRes.edgeCountMatch !== undefined && !diagRes.edgeCountMatch)
      ) {
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
