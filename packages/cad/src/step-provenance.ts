// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Shared STEP provenance metadata, source-linking directives,
 * Modelica telemetry extractors, and browser/Node-portable multi-file pairing.
 *
 * Used uniformly by `@modelscript/lsp`, `@modelscript/ide-client`, `/morsel`,
 * and Docs Studio so compiled `.step` artifacts embed full provenance metadata
 * (`/* @modelscript-meta {...} *\/`) without separate sidecar manifests.
 */

import type { StepFeatureAnchor } from "./step-compiler.js";

export type SpoolId = "n1" | "n2";

export interface SpoolKinematicsSpec {
  readonly part: string;
  readonly spool: SpoolId;
  readonly axis: readonly [number, number, number];
}

export interface ScadSourceDirectives {
  readonly qifSource?: string | undefined;
  readonly stepOutput?: string | undefined;
  readonly modelicaSource?: string | undefined;
  readonly assemblyName?: string | undefined;
}

export interface QifSourceDirectives {
  readonly scadSource?: string | undefined;
  readonly stepOutput?: string | undefined;
  readonly modelicaSource?: string | undefined;
  readonly assemblyName?: string | undefined;
}

export interface ModelicaTelemetryParams {
  readonly n1Rpm?: number | undefined;
  readonly n2Rpm?: number | undefined;
  readonly t04K?: number | undefined;
  readonly cutX?: number | undefined;
}

export interface StepProvenanceMeta {
  readonly version: 1;
  readonly generator: "modelscript-cad";
  readonly scadSource?: string | undefined;
  readonly qifSource?: string | undefined;
  readonly modelicaSource?: string | undefined;
  readonly assemblyName?: string | undefined;
  readonly spools?: readonly SpoolKinematicsSpec[] | undefined;
  readonly featureAnchors?: readonly StepFeatureAnchor[] | undefined;
  readonly compiledAt?: string | undefined;
}

export interface ResolvedStepPairing {
  readonly scadPath?: string | undefined;
  readonly qifPath?: string | undefined;
  readonly modelicaPath?: string | undefined;
  readonly stepPath?: string | undefined;
  readonly assemblyName: string;
  readonly scadDirectives: ScadSourceDirectives;
  readonly qifDirectives: QifSourceDirectives;
  readonly stepMeta: StepProvenanceMeta | null;
  readonly spools: readonly SpoolKinematicsSpec[];
  readonly modelicaTelemetry: ModelicaTelemetryParams;
}

// ── Pure POSIX Path Utilities (Browser + Worker + Node safe) ─────────────────

export function normalizePosixPath(rawPath: string): string {
  const clean = rawPath
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/");
  const isAbs = clean.startsWith("/");
  const segments: string[] = [];
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (!isAbs) {
        segments.push("..");
      }
      continue;
    }
    segments.push(part);
  }
  const joined = segments.join("/");
  return isAbs ? `/${joined}` : joined;
}

export function dirnamePosix(filePath: string): string {
  const norm = normalizePosixPath(filePath);
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return "";
  if (idx === 0) return "/";
  return norm.slice(0, idx);
}

export function basenamePosix(filePath: string): string {
  const norm = normalizePosixPath(filePath);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function stemPosix(filePath: string): string {
  const base = basenamePosix(filePath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function joinPosix(...parts: string[]): string {
  return normalizePosixPath(parts.filter((p) => p.length > 0).join("/"));
}

export function relativePosix(fromDir: string, toFile: string): string {
  const fromNorm = normalizePosixPath(fromDir);
  const toNorm = normalizePosixPath(toFile);
  if (!fromNorm || fromNorm === ".") return toNorm;

  const fromSegs = fromNorm.split("/").filter(Boolean);
  const toSegs = toNorm.split("/").filter(Boolean);
  let common = 0;
  while (common < fromSegs.length && common < toSegs.length && fromSegs[common] === toSegs[common]) {
    common++;
  }
  const ups = Array(fromSegs.length - common).fill("..");
  const rest = toSegs.slice(common);
  const rel = [...ups, ...rest].join("/");
  return rel || ".";
}

function cleanDirectivePath(raw: string): string | undefined {
  let val = raw.trim();
  // Strip inline comment tails (e.g. `// ...`, `-->`) and optional quotes/semicolons
  val = val.replace(/\s*-->.*$/, "").trim();
  val = val.replace(/\s+\/\/.*$/, "").trim();
  val = val.replace(/^["']|["';]+$/g, "").trim();
  return val.length > 0 ? val : undefined;
}

// ── Directive & Telemetry Parsers ────────────────────────────────────────────

/**
 * Extracts `// @spool(part="...", spool="n1"|"n2", axis=[1,0,0])` metadata
 * comments from an OpenSCAD source document.
 */
export function parseScadSpoolDirectives(scadText: string): SpoolKinematicsSpec[] {
  const out: SpoolKinematicsSpec[] = [];
  const directiveRe = /@spool\s*\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = directiveRe.exec(scadText)) !== null) {
    const body = match[1] ?? "";
    const partMatch = /\bpart\s*=\s*["']([^"']+)["']/i.exec(body);
    const spoolMatch = /\bspool\s*=\s*["']?(n1|n2)["']?/i.exec(body);
    if (!partMatch?.[1] || !spoolMatch?.[1]) continue;

    let axis: readonly [number, number, number] = [1, 0, 0];
    const axisMatch = /\baxis\s*=\s*\[\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\]/i.exec(body);
    if (axisMatch) {
      const ax = parseFloat(axisMatch[1]!);
      const ay = parseFloat(axisMatch[2]!);
      const az = parseFloat(axisMatch[3]!);
      if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
        const len = Math.hypot(ax, ay, az);
        if (len > 1e-6) {
          axis = [ax / len, ay / len, az / len];
        }
      }
    }

    const partName = partMatch[1].trim();
    const spoolId = spoolMatch[1].toLowerCase() as SpoolId;
    const spec: SpoolKinematicsSpec = { part: partName, spool: spoolId, axis };
    const existingIdx = out.findIndex((s) => s.part === partName);
    if (existingIdx >= 0) {
      out[existingIdx] = spec;
    } else {
      out.push(spec);
    }
  }
  return out;
}

/**
 * Parses linking header directives inside a `.scad` file:
 * - `// @qif_source: ../pmi/turbine.qif` (or `@qif:`)
 * - `// @step_output: ../build/turbine.step` (or `@step:`)
 * - `// @modelica_source: ../sim/turbine.mo` (or `@modelica:`)
 * - `// @assembly_name: TurbineAssembly` (or `@assembly:`)
 */
export function parseScadSourceDirectives(scadText: string): ScadSourceDirectives {
  let qifSource: string | undefined;
  let stepOutput: string | undefined;
  let modelicaSource: string | undefined;
  let assemblyName: string | undefined;

  for (const line of scadText.split(/\r?\n/)) {
    const qifMatch = /@(?:qif_source|qif)\s*:\s*(.+)$/i.exec(line);
    if (qifMatch?.[1] && !qifSource) {
      qifSource = cleanDirectivePath(qifMatch[1]);
    }
    const stepMatch = /@(?:step_output|step)\s*:\s*(.+)$/i.exec(line);
    if (stepMatch?.[1] && !stepOutput) {
      stepOutput = cleanDirectivePath(stepMatch[1]);
    }
    const moMatch = /@(?:modelica_source|modelica)\s*:\s*(.+)$/i.exec(line);
    if (moMatch?.[1] && !modelicaSource) {
      modelicaSource = cleanDirectivePath(moMatch[1]);
    }
    const asmMatch = /@(?:assembly_name|assembly)\s*:\s*(.+)$/i.exec(line);
    if (asmMatch?.[1] && !assemblyName) {
      assemblyName = cleanDirectivePath(asmMatch[1]);
    }
    if (qifSource && stepOutput && modelicaSource && assemblyName) break;
  }

  return {
    ...(qifSource ? { qifSource } : {}),
    ...(stepOutput ? { stepOutput } : {}),
    ...(modelicaSource ? { modelicaSource } : {}),
    ...(assemblyName ? { assemblyName } : {}),
  };
}

/**
 * Parses linking directives inside a `.qif` file (`// @scad_source: ...` or XML comments):
 * - `// @scad_source: ../cad/turbine.scad` (or `@scad:`)
 * - `// @step_output: ../build/turbine.step` (or `@step:`)
 * - `// @modelica_source: ../sim/turbine.mo` (or `@modelica:`)
 * - `// @assembly_name: TurbineAssembly` (or `@assembly:`)
 */
export function parseQifSourceDirectives(qifText: string): QifSourceDirectives {
  let scadSource: string | undefined;
  let stepOutput: string | undefined;
  let modelicaSource: string | undefined;
  let assemblyName: string | undefined;

  for (const line of qifText.split(/\r?\n/)) {
    const scadMatch = /@(?:scad_source|scad)\s*:\s*(.+)$/i.exec(line);
    if (scadMatch?.[1] && !scadSource) {
      scadSource = cleanDirectivePath(scadMatch[1]);
    }
    const stepMatch = /@(?:step_output|step)\s*:\s*(.+)$/i.exec(line);
    if (stepMatch?.[1] && !stepOutput) {
      stepOutput = cleanDirectivePath(stepMatch[1]);
    }
    const moMatch = /@(?:modelica_source|modelica)\s*:\s*(.+)$/i.exec(line);
    if (moMatch?.[1] && !modelicaSource) {
      modelicaSource = cleanDirectivePath(moMatch[1]);
    }
    const asmMatch = /@(?:assembly_name|assembly)\s*:\s*(.+)$/i.exec(line);
    if (asmMatch?.[1] && !assemblyName) {
      assemblyName = cleanDirectivePath(asmMatch[1]);
    }
    if (scadSource && stepOutput && modelicaSource && assemblyName) break;
  }

  return {
    ...(scadSource ? { scadSource } : {}),
    ...(stepOutput ? { stepOutput } : {}),
    ...(modelicaSource ? { modelicaSource } : {}),
    ...(assemblyName ? { assemblyName } : {}),
  };
}

/**
 * Extracts rotor telemetry parameters (`n1_rpm`, `n2_rpm`, `T_04`, `cut_x`)
 * from a Modelica `.mo` source string without invoking a full solver.
 */
export function extractModelicaTelemetryParams(moText: string): ModelicaTelemetryParams {
  if (!moText) return {};
  const matchNum = (re: RegExp): number | undefined => {
    const m = re.exec(moText);
    if (!m?.[1]) return undefined;
    const n = Number.parseFloat(m[1]);
    return Number.isFinite(n) ? n : undefined;
  };
  const n1Rpm = matchNum(/^\s*(?:parameter\s+)?(?:Real|Integer)\s+n1_rpm\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/m);
  const n2Rpm = matchNum(/^\s*(?:parameter\s+)?(?:Real|Integer)\s+n2_rpm\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/m);
  const t04K = matchNum(/^\s*(?:parameter\s+)?(?:Real|Integer)\s+T_?04\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/m);
  const cutX = matchNum(/^\s*(?:parameter\s+)?(?:Real|Integer)\s+cut_?x\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/m);
  return {
    ...(n1Rpm !== undefined ? { n1Rpm } : {}),
    ...(n2Rpm !== undefined ? { n2Rpm } : {}),
    ...(t04K !== undefined ? { t04K } : {}),
    ...(cutX !== undefined ? { cutX } : {}),
  };
}

// ── Self-Contained STEP Provenance Block Comment Serializer & Parser ────────

function compactProvenancePayload(meta: StepProvenanceMeta): Record<string, unknown> {
  return {
    version: 1,
    generator: meta.generator || "modelscript-cad",
    ...(meta.assemblyName ? { assemblyName: meta.assemblyName } : {}),
    ...(meta.scadSource ? { scadSource: meta.scadSource } : {}),
    ...(meta.qifSource ? { qifSource: meta.qifSource } : {}),
    ...(meta.modelicaSource ? { modelicaSource: meta.modelicaSource } : {}),
    ...(meta.compiledAt ? { compiledAt: meta.compiledAt } : {}),
    ...(meta.spools && meta.spools.length > 0
      ? {
          spools: meta.spools.map((s) => ({
            part: s.part,
            spool: s.spool,
            axis: [s.axis[0], s.axis[1], s.axis[2]],
          })),
        }
      : {}),
    ...(meta.featureAnchors && meta.featureAnchors.length > 0
      ? {
          featureAnchors: meta.featureAnchors.map((a) => ({
            name: a.name,
            portType: a.portType,
            anchor: [a.anchor[0], a.anchor[1], a.anchor[2]],
            ...(a.normal ? { normal: [a.normal[0], a.normal[1], a.normal[2]] } : {}),
          })),
        }
      : {}),
  };
}

interface RawMetaSpool {
  part?: unknown;
  spool?: unknown;
  axis?: unknown;
}

interface RawMetaAnchor {
  name?: unknown;
  portType?: unknown;
  anchor?: unknown;
  normal?: unknown;
}

interface RawStepMetaJson {
  assemblyName?: unknown;
  scadSource?: unknown;
  qifSource?: unknown;
  modelicaSource?: unknown;
  compiledAt?: unknown;
  spools?: unknown;
  featureAnchors?: unknown;
}

/**
 * Serializes {@link StepProvenanceMeta} as a single-line ISO-10303-21 block comment
 * suitable for placement inside a STEP `HEADER;` section.
 */
export function serializeStepProvenanceMeta(meta: StepProvenanceMeta): string {
  const json = JSON.stringify(compactProvenancePayload(meta)).replace(/\*\//g, "*\\/");
  return `/* @modelscript-meta ${json} */`;
}

/**
 * Extracts {@link StepProvenanceMeta} embedded inside a STEP file's header block comment,
 * returning `null` if no valid metadata block is present.
 */
export function parseStepProvenanceMeta(stepText: string): StepProvenanceMeta | null {
  if (!stepText) return null;
  const dataIdx = stepText.indexOf("DATA;");
  const headerSlice = dataIdx > 0 ? stepText.slice(0, dataIdx) : stepText.slice(0, 16_384);
  const match = /\/\*\s*@modelscript-meta\s+(\{[\s\S]*?\})\s*\*\//.exec(headerSlice);
  if (!match?.[1]) return null;

  try {
    const raw = JSON.parse(match[1].replace(/\*\\\//g, "*/")) as RawStepMetaJson;
    if (!raw || typeof raw !== "object") return null;

    const strOrUndef = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

    const spools: SpoolKinematicsSpec[] = [];
    if (Array.isArray(raw.spools)) {
      for (const item of raw.spools) {
        if (!item || typeof item !== "object") continue;
        const rec = item as RawMetaSpool;
        const part = strOrUndef(rec.part);
        const spool = rec.spool === "n1" || rec.spool === "n2" ? rec.spool : undefined;
        if (!part || !spool) continue;
        let axis: readonly [number, number, number] = [1, 0, 0];
        if (Array.isArray(rec.axis) && rec.axis.length >= 3) {
          const ax = Number(rec.axis[0]);
          const ay = Number(rec.axis[1]);
          const az = Number(rec.axis[2]);
          if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
            axis = [ax, ay, az];
          }
        }
        spools.push({ part, spool, axis });
      }
    }

    const featureAnchors: StepFeatureAnchor[] = [];
    if (Array.isArray(raw.featureAnchors)) {
      for (const item of raw.featureAnchors) {
        if (!item || typeof item !== "object") continue;
        const rec = item as RawMetaAnchor;
        const name = strOrUndef(rec.name);
        const portType = strOrUndef(rec.portType) ?? "datum";
        if (!name || !Array.isArray(rec.anchor) || rec.anchor.length < 3) continue;
        const x = Number(rec.anchor[0]);
        const y = Number(rec.anchor[1]);
        const z = Number(rec.anchor[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        let normal: readonly [number, number, number] | undefined;
        if (Array.isArray(rec.normal) && rec.normal.length >= 3) {
          const nx = Number(rec.normal[0]);
          const ny = Number(rec.normal[1]);
          const nz = Number(rec.normal[2]);
          if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
            normal = [nx, ny, nz];
          }
        }
        featureAnchors.push({
          name,
          portType,
          anchor: [x, y, z],
          ...(normal ? { normal } : {}),
        });
      }
    }

    const scadSource = strOrUndef(raw.scadSource);
    const qifSource = strOrUndef(raw.qifSource);
    const modelicaSource = strOrUndef(raw.modelicaSource);
    const assemblyName = strOrUndef(raw.assemblyName);
    const compiledAt = strOrUndef(raw.compiledAt);

    return {
      version: 1,
      generator: "modelscript-cad",
      ...(scadSource ? { scadSource } : {}),
      ...(qifSource ? { qifSource } : {}),
      ...(modelicaSource ? { modelicaSource } : {}),
      ...(assemblyName ? { assemblyName } : {}),
      ...(compiledAt ? { compiledAt } : {}),
      ...(spools.length > 0 ? { spools } : {}),
      ...(featureAnchors.length > 0 ? { featureAnchors } : {}),
    };
  } catch {
    return null;
  }
}

// ── Cross-Folder / In-Memory Multi-File Pairing Resolution ───────────────────

function buildNormalizedFileMap(files: ReadonlyMap<string, string> | Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  if (files instanceof Map) {
    for (const [k, v] of files.entries()) {
      out.set(normalizePosixPath(k), v);
    }
  } else {
    for (const [k, v] of Object.entries(files)) {
      out.set(normalizePosixPath(k), v);
    }
  }
  return out;
}

function isStepExt(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".step") || lower.endsWith(".stp");
}

function findMatchingPath(
  fromFile: string | undefined,
  targetSpec: string | undefined,
  candidates: readonly string[],
): string | undefined {
  if (!targetSpec || candidates.length === 0) return undefined;
  const specNorm = normalizePosixPath(targetSpec);

  // 1. Direct normalized match
  const exact = candidates.find((c) => normalizePosixPath(c) === specNorm);
  if (exact) return exact;

  // 2. Relative resolution from declaring file directory
  if (fromFile) {
    const resolved = joinPosix(dirnamePosix(fromFile), specNorm);
    const relHit = candidates.find((c) => normalizePosixPath(c) === resolved);
    if (relHit) return relHit;
  }

  // 3. Suffix / stripped `../` match across mounted workspaces
  const stripped = specNorm.replace(/^(\.\.\/)+/, "");
  if (stripped.length > 0) {
    const suffixHits = candidates.filter((c) => c === stripped || c.endsWith(`/${stripped}`));
    if (suffixHits.length === 1) return suffixHits[0];
    if (suffixHits.length > 1) return suffixHits[0];
  }

  // 4. Unique basename match across folders
  const base = basenamePosix(specNorm).toLowerCase();
  const baseHits = candidates.filter((c) => basenamePosix(c).toLowerCase() === base);
  if (baseHits.length > 0) return baseHits[0];
  return undefined;
}

function deriveOutputStepPath(
  scadPath: string | undefined,
  qifPath: string | undefined,
  scadDir: ScadSourceDirectives,
  qifDir: QifSourceDirectives,
  stepFiles: readonly string[],
  stepMetaByPath: ReadonlyMap<string, StepProvenanceMeta | null>,
): string | undefined {
  if (scadPath && scadDir.stepOutput) {
    return joinPosix(dirnamePosix(scadPath), scadDir.stepOutput);
  }
  if (qifPath && qifDir.stepOutput) {
    return joinPosix(dirnamePosix(qifPath), qifDir.stepOutput);
  }
  if (scadPath) {
    for (const sPath of stepFiles) {
      const meta = stepMetaByPath.get(sPath);
      if (!meta?.scadSource) continue;
      if (findMatchingPath(sPath, meta.scadSource, [scadPath]) === scadPath) {
        return sPath;
      }
    }
    const stem = stemPosix(scadPath);
    const dir = dirnamePosix(scadPath);
    const expected = joinPosix(dir, `${stem}.step`);
    const existing = stepFiles.find((s) => s === expected || stemPosix(s) === stem);
    return existing ?? expected;
  }
  if (qifPath) {
    const stem = stemPosix(qifPath);
    const expected = joinPosix(dirnamePosix(qifPath), `${stem}.step`);
    const existing = stepFiles.find((s) => s === expected || stemPosix(s) === stem);
    return existing ?? expected;
  }
  return stepFiles[0];
}

/**
 * Resolves a coordinated `.scad` + `.qif` + `.mo` + `.step` tuple from an arbitrary
 * project file map (e.g., `/morsel` virtual filesystem or test fixture workspace),
 * honoring bidirectional header directives, embedded STEP `@modelscript-meta`,
 * same-folder pairing, and workspace-wide stem/unique fallbacks.
 */
export function resolveStepPairingFromFileMap(
  files: ReadonlyMap<string, string> | Record<string, string>,
  activePathRaw?: string,
): ResolvedStepPairing | null {
  const normMap = buildNormalizedFileMap(files);
  const allPaths = Array.from(normMap.keys()).sort();
  if (allPaths.length === 0) return null;

  const scadFiles = allPaths.filter((p) => p.toLowerCase().endsWith(".scad"));
  const qifFiles = allPaths.filter((p) => p.toLowerCase().endsWith(".qif"));
  const moFiles = allPaths.filter((p) => p.toLowerCase().endsWith(".mo"));
  const stepFiles = allPaths.filter(isStepExt);

  const scadDirByPath = new Map<string, ScadSourceDirectives>();
  for (const p of scadFiles) {
    scadDirByPath.set(p, parseScadSourceDirectives(normMap.get(p) ?? ""));
  }
  const qifDirByPath = new Map<string, QifSourceDirectives>();
  for (const p of qifFiles) {
    qifDirByPath.set(p, parseQifSourceDirectives(normMap.get(p) ?? ""));
  }
  const stepMetaByPath = new Map<string, StepProvenanceMeta | null>();
  for (const p of stepFiles) {
    stepMetaByPath.set(p, parseStepProvenanceMeta(normMap.get(p) ?? ""));
  }

  const activePath = activePathRaw ? normalizePosixPath(activePathRaw) : undefined;
  let scadPath: string | undefined;
  let qifPath: string | undefined;
  let modelicaPath: string | undefined;
  let explicitStepPath: string | undefined;

  if (activePath && normMap.has(activePath)) {
    const lower = activePath.toLowerCase();
    if (lower.endsWith(".scad")) {
      scadPath = activePath;
    } else if (lower.endsWith(".qif")) {
      qifPath = activePath;
      const qDir = qifDirByPath.get(qifPath) ?? {};
      scadPath = findMatchingPath(qifPath, qDir.scadSource, scadFiles);
      modelicaPath = findMatchingPath(qifPath, qDir.modelicaSource, moFiles);
      if (!scadPath) {
        // Check reverse: does a workspace .scad point to this .qif?
        scadPath = scadFiles.find((sp) => {
          const sDir = scadDirByPath.get(sp);
          return findMatchingPath(sp, sDir?.qifSource, [qifPath!]) === qifPath;
        });
      }
    } else if (isStepExt(lower)) {
      explicitStepPath = activePath;
      const meta = stepMetaByPath.get(activePath);
      if (meta) {
        scadPath = findMatchingPath(activePath, meta.scadSource, scadFiles);
        qifPath = findMatchingPath(activePath, meta.qifSource, qifFiles);
        modelicaPath = findMatchingPath(activePath, meta.modelicaSource, moFiles);
      }
      if (!scadPath) {
        scadPath = scadFiles.find((sp) => {
          const sDir = scadDirByPath.get(sp);
          return sDir?.stepOutput && joinPosix(dirnamePosix(sp), sDir.stepOutput) === activePath;
        });
      }
      if (!qifPath) {
        qifPath = qifFiles.find((qp) => {
          const qDir = qifDirByPath.get(qp);
          return qDir?.stepOutput && joinPosix(dirnamePosix(qp), qDir.stepOutput) === activePath;
        });
      }
    } else if (lower.endsWith(".mo")) {
      modelicaPath = activePath;
      scadPath = scadFiles.find((sp) => {
        const sDir = scadDirByPath.get(sp);
        return findMatchingPath(sp, sDir?.modelicaSource, [activePath]) === activePath;
      });
      qifPath = qifFiles.find((qp) => {
        const qDir = qifDirByPath.get(qp);
        return findMatchingPath(qp, qDir?.modelicaSource, [activePath]) === activePath;
      });
    }
  }

  // Fallback root SCAD selection if still unresolved
  if (!scadPath && scadFiles.length > 0) {
    if (qifPath) {
      const sameDirStem = scadFiles.find(
        (sp) => dirnamePosix(sp) === dirnamePosix(qifPath!) && stemPosix(sp) === stemPosix(qifPath!),
      );
      const sameDirAny = scadFiles.find((sp) => dirnamePosix(sp) === dirnamePosix(qifPath!));
      const anyStem = scadFiles.find((sp) => stemPosix(sp) === stemPosix(qifPath!));
      scadPath = sameDirStem ?? sameDirAny ?? anyStem ?? (scadFiles.length === 1 ? scadFiles[0] : scadFiles[0]);
    } else if (explicitStepPath) {
      const sameDirStem = scadFiles.find(
        (sp) => dirnamePosix(sp) === dirnamePosix(explicitStepPath!) && stemPosix(sp) === stemPosix(explicitStepPath!),
      );
      const sameDirAny = scadFiles.find((sp) => dirnamePosix(sp) === dirnamePosix(explicitStepPath!));
      const anyStem = scadFiles.find((sp) => stemPosix(sp) === stemPosix(explicitStepPath!));
      scadPath = sameDirStem ?? sameDirAny ?? anyStem ?? scadFiles[0];
    } else {
      // Pick .scad with directives first, or stem match with .qif/.mo, else first .scad
      scadPath =
        scadFiles.find((sp) => {
          const d = scadDirByPath.get(sp);
          return Boolean(d?.qifSource || d?.stepOutput || d?.modelicaSource);
        }) ?? scadFiles[0];
    }
  }

  const scadDirectives = scadPath ? (scadDirByPath.get(scadPath) ?? {}) : {};

  // Fill QIF counterpart if missing
  if (!qifPath && qifFiles.length > 0) {
    if (scadPath && scadDirectives.qifSource) {
      qifPath = findMatchingPath(scadPath, scadDirectives.qifSource, qifFiles);
    }
    if (!qifPath && scadPath) {
      qifPath =
        qifFiles.find((qp) => {
          const qd = qifDirByPath.get(qp);
          return findMatchingPath(qp, qd?.scadSource, [scadPath!]) === scadPath;
        }) ??
        qifFiles.find((qp) => dirnamePosix(qp) === dirnamePosix(scadPath!) && stemPosix(qp) === stemPosix(scadPath!)) ??
        qifFiles.find((qp) => dirnamePosix(qp) === dirnamePosix(scadPath!)) ??
        qifFiles.find((qp) => stemPosix(qp) === stemPosix(scadPath!)) ??
        (qifFiles.length === 1 ? qifFiles[0] : undefined);
    } else if (!qifPath && qifFiles.length === 1) {
      qifPath = qifFiles[0];
    }
  }

  const qifDirectives = qifPath ? (qifDirByPath.get(qifPath) ?? {}) : {};

  // Fill Modelica counterpart if missing
  if (!modelicaPath && moFiles.length > 0) {
    if (scadPath && scadDirectives.modelicaSource) {
      modelicaPath = findMatchingPath(scadPath, scadDirectives.modelicaSource, moFiles);
    }
    if (!modelicaPath && qifPath && qifDirectives.modelicaSource) {
      modelicaPath = findMatchingPath(qifPath, qifDirectives.modelicaSource, moFiles);
    }
    if (!modelicaPath && scadPath) {
      modelicaPath =
        moFiles.find((mp) => dirnamePosix(mp) === dirnamePosix(scadPath!) && stemPosix(mp) === stemPosix(scadPath!)) ??
        moFiles.find((mp) => stemPosix(mp) === stemPosix(scadPath!)) ??
        moFiles.find((mp) => dirnamePosix(mp) === dirnamePosix(scadPath!)) ??
        (moFiles.length === 1 ? moFiles[0] : undefined);
    } else if (!modelicaPath && moFiles.length === 1) {
      modelicaPath = moFiles[0];
    }
  }

  const stepPath =
    explicitStepPath ??
    deriveOutputStepPath(scadPath, qifPath, scadDirectives, qifDirectives, stepFiles, stepMetaByPath);
  const stepMeta = stepPath ? (stepMetaByPath.get(stepPath) ?? null) : null;

  if (!scadPath && !qifPath && !stepPath) {
    return null;
  }

  const scadText = scadPath ? (normMap.get(scadPath) ?? "") : "";
  const spoolsFromScad = scadText ? parseScadSpoolDirectives(scadText) : [];
  const spools = spoolsFromScad.length > 0 ? spoolsFromScad : (stepMeta?.spools ?? []);

  const moText = modelicaPath ? (normMap.get(modelicaPath) ?? "") : "";
  const modelicaTelemetry = extractModelicaTelemetryParams(moText);

  const rawStem = scadPath
    ? stemPosix(scadPath)
    : stepPath
      ? stemPosix(stepPath)
      : qifPath
        ? stemPosix(qifPath)
        : "Assembly";
  const cleanedStem = rawStem.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  const assemblyName =
    stepMeta?.assemblyName ||
    scadDirectives.assemblyName ||
    qifDirectives.assemblyName ||
    (cleanedStem.length > 0 ? cleanedStem : "Assembly");

  return {
    ...(scadPath ? { scadPath } : {}),
    ...(qifPath ? { qifPath } : {}),
    ...(modelicaPath ? { modelicaPath } : {}),
    ...(stepPath ? { stepPath } : {}),
    assemblyName,
    scadDirectives,
    qifDirectives,
    stepMeta,
    spools,
    modelicaTelemetry,
  };
}
