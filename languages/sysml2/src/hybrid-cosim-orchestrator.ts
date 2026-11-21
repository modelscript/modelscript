// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — SysML v2 Polyglot Hybrid Phasor <-> EMT Co-Simulation & Verification Engine
 *
 * Bridges Systems Engineering (MBSE) architecture models in SysML v2 directly to
 * ModelScript's generic polyglot Phasor <-> EMT co-simulation engine (`@modelscript/exchange`)
 * and closes the verification loop by evaluating SysML v2 `requirement` / `constraint` blocks
 * (e.g., IEEE 2800 / NERC PRC-024 LVRT & frequency ride-through envelopes) against the
 * coupled simulation trajectories.
 */

import {
  runHybridPhasorEmtCoSimulation,
  type EmtNetworkParticipant,
  type HybridEmtPlantConfig,
  type HybridPhasorEmtOptions,
  type HybridPhasorEmtResult,
  type PhasorEmtBoundaryPort,
  type PhasorNetworkParticipant,
} from "@modelscript/exchange";
import { verifySysML2Requirements, type RequirementBlockSpec, type SysML2VerificationReport } from "./verification.js";

const PHASOR_SOLVERS = new Set(["psse", "pslf", "powerfactory", "cgmes", "opendss", "rms", "phasor"]);
const EMT_SOLVERS = new Set(["pscad", "atp", "spice", "modelica", "emt"]);

export interface SysML2CoSimPartSpec {
  name: string;
  typeName?: string | undefined;
  domain: "phasor" | "emt" | "system";
  solver?: string | undefined;
  source?: string | undefined;
  dyrSource?: string | undefined;
  seqSource?: string | undefined;
  ports: string[];
  attributes: Record<string, string | number | boolean>;
}

export interface SysML2CoSimConnectionSpec {
  fromPart: string;
  fromPort: string;
  toPart: string;
  toPort: string;
}

export interface SysML2HybridCoSimSpec {
  packageName?: string | undefined;
  systemName?: string | undefined;
  phasorPart?: SysML2CoSimPartSpec | undefined;
  emtParts: SysML2CoSimPartSpec[];
  connections: SysML2CoSimConnectionSpec[];
  options: HybridPhasorEmtOptions;
  requirements: RequirementBlockSpec[];
}

export interface SysML2HybridVerificationResult {
  report: SysML2VerificationReport;
  metrics: Record<string, number | boolean>;
}

export interface SysML2HybridCoSimResult {
  spec: SysML2HybridCoSimSpec;
  simulation: HybridPhasorEmtResult;
  verification: SysML2HybridVerificationResult;
}

export interface RunSysML2HybridCoSimOptions {
  /** Pre-instantiated phasor or EMT participants keyed by SysML v2 part name (e.g. `"grid"`, `"plant1"`). */
  participants?: Record<string, PhasorNetworkParticipant | EmtNetworkParticipant> | undefined;
  /** Optional dynamic participant factory invoked for any part not found in `participants`. */
  resolveParticipant?:
    | ((
        part: SysML2CoSimPartSpec,
      ) => PhasorNetworkParticipant | EmtNetworkParticipant | Promise<PhasorNetworkParticipant | EmtNetworkParticipant>)
    | undefined;
  /** Optional overrides merged onto the simulation options extracted from the SysML v2 model. */
  optionOverrides?: Partial<HybridPhasorEmtOptions> | undefined;
}

// ============================================================================
// Lightweight Structured SysML v2 Block & Attribute Parser
// ============================================================================

function stripComments(src: string): string {
  // Remove /* ... */ block comments and // line comments while preserving strings
  let out = "";
  let i = 0;
  let inStr: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += src[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) break;
      out += " ";
      i = end + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = src.indexOf("\n", i + 2);
      if (nl === -1) break;
      out += "\n";
      i = nl + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]!;
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseScalarLiteral(raw: string): string | number | boolean {
  const s = raw.trim().replace(/;$/, "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  const num = Number(s);
  if (s.length > 0 && Number.isFinite(num)) return num;
  return s;
}

function extractDirectBodyContent(body: string): string {
  // Replace nested `{ ... }` blocks with spaces so direct attributes/ports/connects are cleanly isolated
  let out = "";
  let i = 0;
  let inStr: string | null = null;
  while (i < body.length) {
    const ch = body[i]!;
    if (inStr) {
      out += ch;
      if (ch === "\\" && i + 1 < body.length) {
        out += body[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "{") {
      const close = findMatchingBrace(body, i);
      if (close === -1) break;
      out += " ; ";
      i = close + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function parseAttributesAndPorts(body: string): {
  attributes: Record<string, string | number | boolean>;
  ports: string[];
} {
  const direct = extractDirectBodyContent(body);
  const attributes: Record<string, string | number | boolean> = {};
  const ports: string[] = [];

  const attrRe = /\battribute\s+([A-Za-z_][\w]*)\s*(?::\s*[A-Za-z_][\w:]*)?\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(direct)) !== null) {
    attributes[m[1]!] = parseScalarLiteral(m[2]!);
  }

  const portRe = /\bport\s+([A-Za-z_][\w]*)\b/g;
  while ((m = portRe.exec(direct)) !== null) {
    if (!ports.includes(m[1]!)) ports.push(m[1]!);
  }

  return { attributes, ports };
}

function inferDomain(solver: string | undefined, explicitDomain: string | undefined): "phasor" | "emt" | "system" {
  if (explicitDomain) {
    const d = explicitDomain.toLowerCase();
    if (d === "phasor" || d === "rms" || d === "ts") return "phasor";
    if (d === "emt" || d === "electromagnetic") return "emt";
  }
  if (solver) {
    const s = solver.toLowerCase();
    if (PHASOR_SOLVERS.has(s)) return "phasor";
    if (EMT_SOLVERS.has(s)) return "emt";
  }
  return "system";
}

interface RawPartDef {
  name: string;
  attributes: Record<string, string | number | boolean>;
  ports: string[];
  body: string;
}

/**
 * Extracts a complete polyglot Phasor <-> EMT co-simulation specification and
 * verification requirement set directly from a SysML v2 textual architecture model.
 */
export function extractSysML2HybridCoSimSpec(sysmlSource: string): SysML2HybridCoSimSpec {
  const clean = stripComments(sysmlSource);
  const pkgMatch = /\bpackage\s+([A-Za-z_][\w]*)\s*\{/.exec(clean);
  const packageName = pkgMatch?.[1];

  const partDefs = new Map<string, RawPartDef>();
  const parts: SysML2CoSimPartSpec[] = [];
  const connections: SysML2CoSimConnectionSpec[] = [];
  const requirements: RequirementBlockSpec[] = [];

  // 1. Collect all `part def <Name> { ... }`
  const partDefRe = /\bpart\s+def\s+([A-Za-z_][\w]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = partDefRe.exec(clean)) !== null) {
    const name = m[1]!;
    const openIdx = clean.indexOf("{", m.index);
    const closeIdx = findMatchingBrace(clean, openIdx);
    if (closeIdx === -1) continue;
    const body = clean.slice(openIdx + 1, closeIdx);
    const { attributes, ports } = parseAttributesAndPorts(body);
    partDefs.set(name, { name, attributes, ports, body });
  }

  // 2. Collect `part <name> (: <Type>)? { ... }` or `part <name> : <Type>;` usages
  const partUsageRe = /\bpart\s+(?!def\b)([A-Za-z_][\w]*)(?:\s*:\s*([A-Za-z_][\w]*))?\s*(\{|;)/g;
  while ((m = partUsageRe.exec(clean)) !== null) {
    const name = m[1]!;
    const typeName = m[2];
    const delim = m[3]!;
    let body = "";
    if (delim === "{") {
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingBrace(clean, openIdx);
      if (closeIdx !== -1) body = clean.slice(openIdx + 1, closeIdx);
    }
    const def = typeName ? partDefs.get(typeName) : undefined;
    const local = parseAttributesAndPorts(body);
    const attributes: Record<string, string | number | boolean> = {
      ...(def?.attributes ?? {}),
      ...local.attributes,
    };
    const ports = Array.from(new Set([...(def?.ports ?? []), ...local.ports]));
    const solver = typeof attributes["solver"] === "string" ? attributes["solver"] : undefined;
    const domain = inferDomain(solver, typeof attributes["domain"] === "string" ? attributes["domain"] : undefined);

    parts.push({
      name,
      typeName,
      domain,
      solver,
      source: typeof attributes["source"] === "string" ? attributes["source"] : undefined,
      dyrSource: typeof attributes["dyrSource"] === "string" ? attributes["dyrSource"] : undefined,
      seqSource: typeof attributes["seqSource"] === "string" ? attributes["seqSource"] : undefined,
      ports,
      attributes,
    });
  }

  // 3. Collect all `connect <partA>.<portA> to <partB>.<portB>;`
  const connRe = /\bconnect\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s+to\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*;/g;
  while ((m = connRe.exec(clean)) !== null) {
    connections.push({
      fromPart: m[1]!,
      fromPort: m[2]!,
      toPart: m[3]!,
      toPort: m[4]!,
    });
  }

  // 4. Collect `requirement (def)? <Name> { ... require/assert/assume constraint { ... } }`
  const reqRe = /\brequirement\s+(?:def\s+)?([A-Za-z_][\w]*)\s*\{/g;
  while ((m = reqRe.exec(clean)) !== null) {
    const reqName = m[1]!;
    const openIdx = clean.indexOf("{", m.index);
    const closeIdx = findMatchingBrace(clean, openIdx);
    if (closeIdx === -1) continue;
    const reqBody = clean.slice(openIdx + 1, closeIdx);

    let assumption: string | undefined;
    const assumeMatch = /\bassume\s+constraint\s*\{/.exec(reqBody);
    if (assumeMatch) {
      const aOpen = reqBody.indexOf("{", assumeMatch.index);
      const aClose = findMatchingBrace(reqBody, aOpen);
      if (aClose !== -1) assumption = reqBody.slice(aOpen + 1, aClose).trim();
    }

    const cRe = /\b(require|assert)\s+constraint\s*\{/g;
    let cm: RegExpExecArray | null;
    let cIdx = 0;
    while ((cm = cRe.exec(reqBody)) !== null) {
      const kind = cm[1] as "require" | "assert";
      const cOpen = reqBody.indexOf("{", cm.index);
      const cClose = findMatchingBrace(reqBody, cOpen);
      if (cClose === -1) continue;
      const expr = reqBody.slice(cOpen + 1, cClose).trim();
      cIdx++;
      requirements.push({
        name: cIdx === 1 ? reqName : `${reqName}#${cIdx}`,
        constraint: expr,
        assumption,
        kind,
      });
    }
  }

  // 5. Extract simulation options from the composite system `part def` (any partDef with sub-parts or sim attributes)
  let systemName: string | undefined;
  const sysAttrs: Record<string, string | number | boolean> = {};
  for (const def of partDefs.values()) {
    const hasSubPart = /\bpart\s+(?!def\b)/.test(def.body);
    const hasSimAttr =
      "durationSec" in def.attributes ||
      "dtTsSec" in def.attributes ||
      "dtEmtSec" in def.attributes ||
      "faultBusId" in def.attributes;
    if (hasSubPart || hasSimAttr) {
      systemName = def.name;
      Object.assign(sysAttrs, def.attributes);
    }
  }

  const options: HybridPhasorEmtOptions = {};
  if (typeof sysAttrs["durationSec"] === "number") options.durationSec = sysAttrs["durationSec"];
  if (typeof sysAttrs["dtTsSec"] === "number") options.dtTsSec = sysAttrs["dtTsSec"];
  if (typeof sysAttrs["dtEmtSec"] === "number") options.dtEmtSec = sysAttrs["dtEmtSec"];
  if (typeof sysAttrs["frequencyHz"] === "number") options.frequencyHz = sysAttrs["frequencyHz"];
  if (sysAttrs["sequences"] === 1 || sysAttrs["sequences"] === 3) options.sequences = sysAttrs["sequences"];
  if (sysAttrs["mode"] === "direct" || sysAttrs["mode"] === "fmi") options.mode = sysAttrs["mode"];
  if (typeof sysAttrs["useFdne"] === "boolean") options.useFdne = sysAttrs["useFdne"];
  if (typeof sysAttrs["useDynamicEquivalent"] === "boolean") {
    options.useDynamicEquivalent = sysAttrs["useDynamicEquivalent"];
  }
  if (typeof sysAttrs["maxIterations"] === "number") options.maxIterations = sysAttrs["maxIterations"];
  if (typeof sysAttrs["iterationTolerancePu"] === "number") {
    options.iterationTolerancePu = sysAttrs["iterationTolerancePu"];
  }
  if (typeof sysAttrs["trackFrequency"] === "boolean") options.trackFrequency = sysAttrs["trackFrequency"];

  if (sysAttrs["faultBusId"] !== undefined) {
    const faultTypeRaw = typeof sysAttrs["faultType"] === "string" ? sysAttrs["faultType"] : "3ph";
    const faultType =
      faultTypeRaw === "3ph" || faultTypeRaw === "slg" || faultTypeRaw === "ll" || faultTypeRaw === "llg"
        ? faultTypeRaw
        : "3ph";
    options.fault = {
      busId: String(sysAttrs["faultBusId"]),
      startSec: typeof sysAttrs["faultStartSec"] === "number" ? sysAttrs["faultStartSec"] : 0.01,
      clearSec: typeof sysAttrs["faultClearSec"] === "number" ? sysAttrs["faultClearSec"] : 0.03,
      susceptancePu: typeof sysAttrs["faultSusceptancePu"] === "number" ? sysAttrs["faultSusceptancePu"] : -15.0,
      faultType,
    };
  }

  const phasorPart = parts.find((p) => p.domain === "phasor");
  const emtParts = parts.filter((p) => p.domain === "emt");

  return {
    packageName,
    systemName,
    phasorPart,
    emtParts,
    connections,
    options,
    requirements,
  };
}

function resolvePortBusId(part: SysML2CoSimPartSpec, portName: string): string {
  const attrKey = `busId_${portName}`;
  const v = part.attributes[attrKey] ?? part.attributes[portName] ?? part.attributes["busId"];
  if (v !== undefined) return String(v);
  return portName;
}

/**
 * Extracts quantitative KPIs from a `HybridPhasorEmtResult` and evaluates all
 * SysML v2 `requirement` / `constraint` blocks against those metrics.
 */
export function evaluateHybridCoSimRequirements(
  spec: SysML2HybridCoSimSpec,
  simulation: HybridPhasorEmtResult,
): SysML2HybridVerificationResult {
  const recs = simulation.macroRecords;
  const fault = spec.options.fault;

  let vMinPu = Infinity;
  let vMaxPu = -Infinity;
  let vPreFaultPu = 1.0;
  let vFaultMinPu = Infinity;
  let vRecoveryPu = 1.0;
  let vNegMaxPu = 0.0;
  let vZeroMaxPu = 0.0;
  let vEmtPeakMaxKv = 0.0;
  let iEmtMaxAmpRms = 0.0;
  let freqMinHz = spec.options.frequencyHz ?? 60.0;
  let freqMaxHz = spec.options.frequencyHz ?? 60.0;

  const perBusVMin = new Map<string, number>();
  const perBusVMax = new Map<string, number>();
  const perBusVLast = new Map<string, number>();
  const perBusVNegMax = new Map<string, number>();
  const perBusVZeroMax = new Map<string, number>();
  const perPlantVEmtMax = new Map<string, number>();

  for (const r of recs) {
    if (r.vTsMagPu < vMinPu) vMinPu = r.vTsMagPu;
    if (r.vTsMagPu > vMaxPu) vMaxPu = r.vTsMagPu;
    if (r.vNegMagPu > vNegMaxPu) vNegMaxPu = r.vNegMagPu;
    if (r.vZeroMagPu > vZeroMaxPu) vZeroMaxPu = r.vZeroMagPu;
    if (r.vEmtPeakKv > vEmtPeakMaxKv) vEmtPeakMaxKv = r.vEmtPeakKv;
    if (r.iEmtInjAmpRms > iEmtMaxAmpRms) iEmtMaxAmpRms = r.iEmtInjAmpRms;

    if (fault) {
      if (r.timeSec < fault.startSec) vPreFaultPu = r.vTsMagPu;
      if (r.timeSec >= fault.startSec && r.timeSec <= fault.clearSec) {
        if (r.vTsMagPu < vFaultMinPu) vFaultMinPu = r.vTsMagPu;
      }
      if (r.timeSec > fault.clearSec) vRecoveryPu = r.vTsMagPu;
    } else {
      vPreFaultPu = recs[0]?.vTsMagPu ?? 1.0;
      vRecoveryPu = r.vTsMagPu;
    }

    perBusVMin.set(r.phasorBusId, Math.min(perBusVMin.get(r.phasorBusId) ?? Infinity, r.vTsMagPu));
    perBusVMax.set(r.phasorBusId, Math.max(perBusVMax.get(r.phasorBusId) ?? -Infinity, r.vTsMagPu));
    perBusVLast.set(r.phasorBusId, r.vTsMagPu);
    perBusVNegMax.set(r.phasorBusId, Math.max(perBusVNegMax.get(r.phasorBusId) ?? 0, r.vNegMagPu));
    perBusVZeroMax.set(r.phasorBusId, Math.max(perBusVZeroMax.get(r.phasorBusId) ?? 0, r.vZeroMagPu));
    perPlantVEmtMax.set(r.plantId, Math.max(perPlantVEmtMax.get(r.plantId) ?? 0, r.vEmtPeakKv));
  }

  // Extract COI frequency bounds from phasor generator speed states (`omega` columns) if available
  const states = simulation.phasorTrajectory.states;
  const f0 = spec.options.frequencyHz ?? 60.0;
  const omegaCols: number[] = [];
  for (let c = 0; c < states.length; c++) {
    if (states[c]!.toLowerCase().includes("omega")) omegaCols.push(c);
  }
  if (omegaCols.length > 0 && simulation.phasorTrajectory.y.length > 0) {
    freqMinHz = Infinity;
    freqMaxHz = -Infinity;
    for (const row of simulation.phasorTrajectory.y) {
      let sumW = 0.0;
      for (const c of omegaCols) sumW += row[c] ?? 1.0;
      const fInst = f0 * (sumW / omegaCols.length);
      if (fInst < freqMinHz) freqMinHz = fInst;
      if (fInst > freqMaxHz) freqMaxHz = fInst;
    }
  }

  if (!Number.isFinite(vMinPu)) vMinPu = 0.0;
  if (!Number.isFinite(vMaxPu)) vMaxPu = 0.0;
  if (!Number.isFinite(vFaultMinPu)) vFaultMinPu = vMinPu;

  const metrics: Record<string, number | boolean> = {
    vMinPu,
    vMaxPu,
    vPreFaultPu,
    vFaultMinPu,
    vRecoveryPu,
    vNegMaxPu,
    vZeroMaxPu,
    vEmtPeakMaxKv,
    iEmtMaxAmpRms,
    freqMinHz,
    freqMaxHz,
    maxRotorSpreadDeg: simulation.phasorTrajectory.summary.maxRotorAngleSpreadDeg,
    convergedPowerFlow: simulation.phasorTrajectory.summary.convergedPowerFlow,
    stable: simulation.phasorTrajectory.summary.stable,
    totalMacroSteps: simulation.totalMacroSteps,
    totalEmtSubSteps: simulation.totalEmtSubSteps,
    topologyUpdates: simulation.topologyUpdates,
    totalPicardIterations: simulation.totalPicardIterations,
  };

  for (const [busId, val] of perBusVMin) metrics[`vMinPu_${busId}`] = val;
  for (const [busId, val] of perBusVMax) metrics[`vMaxPu_${busId}`] = val;
  for (const [busId, val] of perBusVLast) metrics[`vRecoveryPu_${busId}`] = val;
  for (const [busId, val] of perBusVNegMax) metrics[`vNegMaxPu_${busId}`] = val;
  for (const [busId, val] of perBusVZeroMax) metrics[`vZeroMaxPu_${busId}`] = val;
  for (const [plantId, val] of perPlantVEmtMax) metrics[`vEmtPeakMaxKv_${plantId}`] = val;

  const report = verifySysML2Requirements(spec.requirements, metrics);
  return { report, metrics };
}

/**
 * End-to-end SysML v2 -> Polyglot Hybrid Phasor <-> EMT Co-Simulation -> Requirement Verification.
 */
export async function runSysML2HybridCoSimulation(
  sysmlSource: string,
  options: RunSysML2HybridCoSimOptions = {},
): Promise<SysML2HybridCoSimResult> {
  const spec = extractSysML2HybridCoSimSpec(sysmlSource);
  if (!spec.phasorPart) {
    throw new Error(
      'SysML v2 model does not declare a phasor-domain part (set `attribute solver = "psse"` or `attribute domain = "phasor"`).',
    );
  }
  if (spec.emtParts.length === 0) {
    throw new Error(
      'SysML v2 model does not declare any EMT-domain parts (set `attribute solver = "pscad"` / `"atp"` / `"spice"` / `"modelica"`).',
    );
  }

  const resolve = async (part: SysML2CoSimPartSpec): Promise<PhasorNetworkParticipant | EmtNetworkParticipant> => {
    const provided = options.participants?.[part.name];
    if (provided) return provided;
    if (options.resolveParticipant) return await options.resolveParticipant(part);
    throw new Error(
      `No participant supplied or resolved for SysML v2 part '${part.name}' (solver='${part.solver ?? "unknown"}').`,
    );
  };

  const phasorParticipant = (await resolve(spec.phasorPart)) as PhasorNetworkParticipant;
  const emtPartByName = new Map(spec.emtParts.map((p) => [p.name, p]));

  // Map SysML v2 `connect` statements to `HybridEmtPlantConfig.boundaryPorts`
  const portsByEmtPart = new Map<string, PhasorEmtBoundaryPort[]>();
  for (const emtP of spec.emtParts) portsByEmtPart.set(emtP.name, []);

  for (const conn of spec.connections) {
    let phasorPortName: string | undefined;
    let emtPart: SysML2CoSimPartSpec | undefined;
    let emtPortName: string | undefined;

    if (conn.fromPart === spec.phasorPart.name && emtPartByName.has(conn.toPart)) {
      phasorPortName = conn.fromPort;
      emtPart = emtPartByName.get(conn.toPart);
      emtPortName = conn.toPort;
    } else if (conn.toPart === spec.phasorPart.name && emtPartByName.has(conn.fromPart)) {
      phasorPortName = conn.toPort;
      emtPart = emtPartByName.get(conn.fromPart);
      emtPortName = conn.fromPort;
    }

    if (phasorPortName && emtPart && emtPortName) {
      const phasorBusId = resolvePortBusId(spec.phasorPart, phasorPortName);
      const emtBusId = resolvePortBusId(emtPart, emtPortName);
      const baseKvLL = typeof emtPart.attributes["baseKvLL"] === "number" ? emtPart.attributes["baseKvLL"] : undefined;
      const baseMva = typeof emtPart.attributes["baseMva"] === "number" ? emtPart.attributes["baseMva"] : undefined;
      portsByEmtPart.get(emtPart.name)!.push({
        phasorBusId,
        emtBusId,
        baseKvLL,
        baseMva,
      });
    }
  }

  const plants: HybridEmtPlantConfig[] = [];
  for (const emtPart of spec.emtParts) {
    const boundaryPorts = portsByEmtPart.get(emtPart.name) ?? [];
    if (boundaryPorts.length === 0) {
      throw new Error(
        `SysML v2 EMT part '${emtPart.name}' has no \`connect\` statement linking it to phasor part '${spec.phasorPart.name}'.`,
      );
    }
    const participant = (await resolve(emtPart)) as EmtNetworkParticipant;
    plants.push({
      id: emtPart.name,
      participant,
      boundaryPorts,
    });
  }

  const mergedOptions: HybridPhasorEmtOptions = {
    ...spec.options,
    ...options.optionOverrides,
  };

  const simulation = await runHybridPhasorEmtCoSimulation(phasorParticipant, plants, mergedOptions);
  const verification = evaluateHybridCoSimRequirements(spec, simulation);

  return {
    spec,
    simulation,
    verification,
  };
}
