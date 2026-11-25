// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractStepGdtOverlay,
  normalizePosixPath,
  parseScadSpoolDirectives,
  parseStepProvenanceMeta,
  resolveStepPairingFromFileMap,
  type GdtOverlayPayload,
  type ModelicaTelemetryParams,
  type ResolvedStepPairing,
  type SpoolKinematicsSpec,
} from "@modelscript/cad";
import type { CadComponent } from "../cad-viewer";
import type {
  CompileStepFromSourcesAnsatzParams,
  CompileStepFromSourcesAnsatzResult,
  StepMeshAnsatzResult,
} from "./lsp-bridge";

export interface AnsatzSpoolRule {
  readonly match: string;
  readonly axisIndex: 0 | 1 | 2;
  readonly degPerSec: number;
  readonly varName: string;
}

export function deriveAnsatzUri(pathOrName: string | undefined, fallbackUri: string): string {
  if (!pathOrName) return fallbackUri;
  const clean = normalizePosixPath(pathOrName).replace(/^\/+/, "");
  return clean ? `file:///${clean}` : fallbackUri;
}

export function buildAnsatzEffectiveFileMap(
  projectFiles: Readonly<Record<string, string>> | undefined,
  activeFileName: string | undefined,
  documentUri: string,
  dialect: string,
  editorValue: string,
): { readonly files: Record<string, string>; readonly activePath: string } {
  const files: Record<string, string> = {};
  if (projectFiles) {
    for (const [k, v] of Object.entries(projectFiles)) {
      const norm = normalizePosixPath(k);
      if (norm) files[norm] = v;
    }
  }

  let activePath = activeFileName ? normalizePosixPath(activeFileName) : "";
  if (!activePath) {
    if (documentUri.startsWith("file:///")) {
      activePath = normalizePosixPath(documentUri.slice("file:///".length));
    } else {
      const ext = dialect === "scad" ? "scad" : dialect === "qif" ? "qif" : dialect === "step" ? "step" : "mo";
      activePath = `document.${ext}`;
    }
  }

  files[activePath] = editorValue;
  return { files, activePath };
}

export function stepMeshesToCadComponents(
  meshes: readonly StepMeshAnsatzResult[],
  uriPrefix = "step://compiled",
): CadComponent[] {
  const out: CadComponent[] = [];
  for (let idx = 0; idx < meshes.length; idx++) {
    const m = meshes[idx]!;
    const vertices = Array.isArray(m.vertices) ? m.vertices : Array.from(m.vertices);
    const normals = Array.isArray(m.normals) ? m.normals : Array.from(m.normals);
    const indices = Array.isArray(m.indices) ? m.indices : Array.from(m.indices);
    if (vertices.length < 9 || indices.length < 3) continue;
    const partName = m.name || `step_solid_${m.id ?? idx + 1}`;
    out.push({
      name: partName,
      cad: {
        uri: `${uriPrefix}/${partName}`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      proceduralMesh: {
        vertices,
        normals,
        indices,
      },
    });
  }
  return out;
}

/**
 * Resolves `@spool(...)` directives (both Option-A `part`/`spool`/`axis=[x,y,z]` and legacy
 * `match`/`axis`/`rpm`/`degPerSec`) scaled by optional paired Modelica `n1_rpm`/`n2_rpm` telemetry.
 */
export function resolveSpoolRulesForAnsatz(
  scadCode: string,
  structuredSpools?: readonly SpoolKinematicsSpec[],
  telemetry?: ModelicaTelemetryParams,
): AnsatzSpoolRule[] {
  const rules: AnsatzSpoolRule[] = [];
  let idx = 0;

  const parsedStructured =
    structuredSpools && structuredSpools.length > 0 ? structuredSpools : parseScadSpoolDirectives(scadCode);

  for (const s of parsedStructured) {
    const ax = Math.abs(s.axis[0]);
    const ay = Math.abs(s.axis[1]);
    const az = Math.abs(s.axis[2]);
    const axisIndex: 0 | 1 | 2 = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const sign = (s.axis[axisIndex] ?? 1) < 0 ? -1 : 1;

    let baseDegPerSec: number;
    if (s.spool === "n2") {
      const ratio = typeof telemetry?.n2Rpm === "number" ? telemetry.n2Rpm / 14200 : 1;
      baseDegPerSec = -140 * Math.max(0.05, Math.abs(ratio));
    } else {
      const ratio = typeof telemetry?.n1Rpm === "number" ? telemetry.n1Rpm / 3850 : 1;
      baseDegPerSec = 65 * Math.max(0.05, Math.abs(ratio));
    }

    rules.push({
      match: s.part.toLowerCase(),
      axisIndex,
      degPerSec: sign * baseDegPerSec,
      varName: `__scad_spool_${idx++}`,
    });
  }

  // Legacy Ansatz syntax: // @spool(match="rotor", axis="x", rpm=1800)
  const legacyRegex = /\/\/\s*@spool\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = legacyRegex.exec(scadCode)) !== null) {
    const body = m[1] || "";
    const matchVal = /(?:name|match)\s*=\s*["']([^"']+)["']/i.exec(body)?.[1];
    if (!matchVal) continue;
    if (rules.some((r) => r.match === matchVal.toLowerCase())) continue;

    const axisStr = /axis\s*=\s*["']?([xyz])["']?/i.exec(body)?.[1]?.toLowerCase() ?? "x";
    const rpmStr = /rpm\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(body)?.[1];
    const degStr = /degPerSec\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(body)?.[1];
    const axisIndex: 0 | 1 | 2 = axisStr === "y" ? 1 : axisStr === "z" ? 2 : 0;
    const degPerSec = degStr
      ? parseFloat(degStr)
      : rpmStr
        ? Math.min(360, Math.max(-360, parseFloat(rpmStr) * 0.04))
        : 85;
    rules.push({
      match: matchVal.toLowerCase(),
      axisIndex,
      degPerSec,
      varName: `__scad_spool_${idx++}`,
    });
  }

  if (rules.length === 0 && /\B\$t\b/.test(scadCode)) {
    rules.push({ match: "", axisIndex: 0, degPerSec: 90, varName: "__scad_t_rot" });
  }

  return rules;
}

export interface CachedAnsatzStepCompilation {
  readonly sig: string;
  readonly result: CompileStepFromSourcesAnsatzResult;
  readonly components: CadComponent[];
}

export interface AnsatzOptionAOutcome {
  readonly pairing: ResolvedStepPairing | null;
  readonly components: CadComponent[];
  readonly gdtOverlay: GdtOverlayPayload | null;
  readonly spools: readonly SpoolKinematicsSpec[];
  readonly telemetry: ModelicaTelemetryParams;
  readonly stepPath?: string | undefined;
  readonly stepText?: string | undefined;
  readonly updatedStepArtifact: boolean;
  readonly cachedCompilation?: CachedAnsatzStepCompilation | undefined;
}

export interface AnsatzOptionARunParams {
  readonly files: Readonly<Record<string, string>>;
  readonly activePath: string;
  readonly dialect: string;
  readonly documentUri: string;
  readonly isStepText: boolean;
  readonly cachedCompilation?: CachedAnsatzStepCompilation | null | undefined;
  readonly compileStepFromSources: (
    params: CompileStepFromSourcesAnsatzParams,
  ) => Promise<CompileStepFromSourcesAnsatzResult>;
  readonly getStepMeshes: (uri: string, documentText?: string) => Promise<StepMeshAnsatzResult[]>;
}

/**
 * Executes the Option-A multi-file STEP compilation & B-Rep meshing workflow for Ansatz:
 * - If active file is `.step`, extracts embedded provenance + QIF overlay + AP242 meshes.
 * - If paired `.scad` (+ optional `.qif`, `.mo`) exists, compiles AP242 `.step` via LSP,
 *   tessellates via `getStepMeshes`, attaches `@spool` + Modelica telemetry, and returns the
 *   generated `.step` text so the host workspace updates `projectFiles`.
 */
export async function compileAnsatzOptionAAssembly(
  params: AnsatzOptionARunParams,
): Promise<AnsatzOptionAOutcome | null> {
  const {
    files,
    activePath,
    dialect,
    documentUri,
    isStepText,
    cachedCompilation,
    compileStepFromSources,
    getStepMeshes,
  } = params;
  const pairing = resolveStepPairingFromFileMap(files, activePath);
  const telemetry = pairing?.modelicaTelemetry ?? {};

  if (isStepText) {
    const stepText = files[activePath] ?? "";
    const meta = parseStepProvenanceMeta(stepText);
    const qifText = pairing?.qifPath ? files[pairing.qifPath] : undefined;
    const rawOverlay = extractStepGdtOverlay(stepText, qifText);
    const gdtOverlay = rawOverlay.callouts.length > 0 || rawOverlay.datums.length > 0 ? rawOverlay : null;
    const spools = (pairing?.spools?.length ? pairing.spools : meta?.spools) ?? [];
    const meshes = await getStepMeshes(deriveAnsatzUri(activePath, documentUri), stepText);
    const components = stepMeshesToCadComponents(meshes, "step://viewer");
    return {
      pairing,
      components,
      gdtOverlay,
      spools,
      telemetry,
      stepPath: activePath,
      stepText,
      updatedStepArtifact: false,
    };
  }

  const scadPath = pairing?.scadPath;
  const shouldRunOptionA =
    Boolean(scadPath) && (dialect === "scad" || dialect === "qif" || Boolean(scadPath && pairing?.qifPath));
  if (!shouldRunOptionA || !scadPath) {
    return null;
  }

  const scadText = files[scadPath] ?? "";
  if (!scadText.trim()) return null;

  const qifPath = pairing.qifPath;
  const qifText = qifPath ? files[qifPath] : undefined;
  const stepPath = pairing.stepPath;
  const modelicaPath = pairing.modelicaPath;
  const assemblyName = pairing.assemblyName;

  const scadUri = deriveAnsatzUri(scadPath, documentUri);
  const qifUri = qifPath ? deriveAnsatzUri(qifPath, documentUri) : undefined;
  const stepUri = deriveAnsatzUri(stepPath, documentUri);
  const modelicaUri = modelicaPath ? deriveAnsatzUri(modelicaPath, documentUri) : undefined;

  const sig = `${scadText}\0${qifText ?? ""}\0${stepPath ?? ""}\0${modelicaPath ?? ""}\0${assemblyName}`;

  let compiled: CompileStepFromSourcesAnsatzResult;
  let components: CadComponent[];
  let updatedStepArtifact = false;

  if (cachedCompilation && cachedCompilation.sig === sig && cachedCompilation.components.length > 0) {
    compiled = cachedCompilation.result;
    components = cachedCompilation.components;
  } else {
    compiled = await compileStepFromSources({
      scadText,
      ...(qifText !== undefined ? { qifText } : {}),
      scadUri,
      ...(qifUri ? { qifUri } : {}),
      stepUri,
      ...(modelicaUri ? { modelicaUri } : {}),
      assemblyName,
    });
    if (!compiled || compiled.error || !compiled.stepText) {
      return null;
    }
    const meshes = await getStepMeshes(stepUri, compiled.stepText);
    components = stepMeshesToCadComponents(meshes, "step://compiled");
    updatedStepArtifact = Boolean(stepPath && files[stepPath] !== compiled.stepText);
  }

  const rawOverlay = compiled.gdtOverlay;
  const gdtOverlay = rawOverlay && (rawOverlay.callouts.length > 0 || rawOverlay.datums.length > 0) ? rawOverlay : null;

  return {
    pairing,
    components,
    gdtOverlay,
    spools: compiled.spools.length > 0 ? compiled.spools : pairing.spools,
    telemetry,
    stepPath,
    stepText: compiled.stepText,
    updatedStepArtifact,
    cachedCompilation: { sig, result: compiled, components },
  };
}
