// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildFallbackClassInstance,
  scanModelicaClassLayout,
  type ScannedClassLayout,
  type ScannedComponentDecl,
  type ScannedConnectStmt,
} from "../diagram/scanner.js";
import { renderDiagramSvgString } from "../diagram/svg.js";
import type { ModelicaClassInstance } from "../diagram/types.js";

export interface ParsedModifier {
  name: string;
  value: string;
}

export interface ModelicaComponentInfo {
  name: string;
  typeName: string;
  variability: "parameter" | "constant" | "discrete" | "continuous";
  causality: "input" | "output" | "local";
  isFlow: boolean;
  isConnector: boolean;
  description: string;
  modifiers: ParsedModifier[];
  bindingValue?: string | undefined;
  startLine: number;
  endLine: number;
  hasPlacement: boolean;
  origin?: [number, number] | undefined;
}

export interface ModelicaConnectInfo {
  source: string;
  target: string;
  sourceComp: string;
  sourcePort: string;
  targetComp: string;
  targetPort: string;
  startLine: number;
}

export interface ModelicaEquationInfo {
  index: number;
  text: string;
  line: number;
  isConnect: boolean;
  referencedVars: string[];
  derivativeVars: string[];
}

export interface BltBlockInfo {
  blockIndex: number;
  equationIndices: number[];
  variables: string[];
  isAlgebraicLoop: boolean;
  isSolved: boolean;
}

export interface BltAnalysisResult {
  unknowns: string[];
  states: string[];
  equations: ModelicaEquationInfo[];
  /** incidence[eqIdx][varIdx] === true if var appears in eq */
  incidence: boolean[][];
  /** matching[eqIdx] = matched varIdx or -1 */
  matching: number[];
  blocks: BltBlockInfo[];
  status: "balanced" | "underdetermined" | "overdetermined" | "empty";
}

export interface ModelicaLibraryItem {
  id: string;
  domain: string;
  label: string;
  className: string;
  defaultPrefix: string;
  description: string;
  defaultParams?: string | undefined;
  color: string;
}

export interface ParsedModelicaModel {
  className: string;
  classKind: string;
  description: string;
  extendsList: { baseClass: string; line: number }[];
  components: ModelicaComponentInfo[];
  connects: ModelicaConnectInfo[];
  equations: ModelicaEquationInfo[];
  layout: ScannedClassLayout | null;
  classInstance: ModelicaClassInstance | null;
  blt: BltAnalysisResult;
}

export const MODELICA_LIBRARY_CATALOG: ModelicaLibraryItem[] = [
  {
    id: "elec-resistor",
    domain: "Electrical.Analog",
    label: "Resistor",
    className: "Modelica.Electrical.Analog.Basic.Resistor",
    defaultPrefix: "R",
    description: "Ideal linear electrical resistor (v = R * i)",
    defaultParams: "R=100",
    color: "#3b82f6",
  },
  {
    id: "elec-capacitor",
    domain: "Electrical.Analog",
    label: "Capacitor",
    className: "Modelica.Electrical.Analog.Basic.Capacitor",
    defaultPrefix: "C",
    description: "Ideal linear electrical capacitor (i = C * der(v))",
    defaultParams: "C=1e-3",
    color: "#3b82f6",
  },
  {
    id: "elec-inductor",
    domain: "Electrical.Analog",
    label: "Inductor",
    className: "Modelica.Electrical.Analog.Basic.Inductor",
    defaultPrefix: "L",
    description: "Ideal linear electrical inductor (v = L * der(i))",
    defaultParams: "L=0.1",
    color: "#3b82f6",
  },
  {
    id: "elec-ground",
    domain: "Electrical.Analog",
    label: "Ground",
    className: "Modelica.Electrical.Analog.Basic.Ground",
    defaultPrefix: "G",
    description: "Ground node (v = 0 V)",
    color: "#3b82f6",
  },
  {
    id: "elec-sine-v",
    domain: "Electrical.Analog",
    label: "SineVoltage",
    className: "Modelica.Electrical.Analog.Sources.SineVoltage",
    defaultPrefix: "V",
    description: "Sinusoidal voltage source",
    defaultParams: "V=10, f=50",
    color: "#3b82f6",
  },
  {
    id: "elec-const-v",
    domain: "Electrical.Analog",
    label: "ConstantVoltage",
    className: "Modelica.Electrical.Analog.Sources.ConstantVoltage",
    defaultPrefix: "Vdc",
    description: "DC constant voltage source",
    defaultParams: "V=12",
    color: "#3b82f6",
  },
  {
    id: "mech-inertia",
    domain: "Mechanics.Rotational",
    label: "Inertia",
    className: "Modelica.Mechanics.Rotational.Components.Inertia",
    defaultPrefix: "J",
    description: "1D rotational inertia element",
    defaultParams: "J=0.5",
    color: "#10b981",
  },
  {
    id: "mech-spring-damper",
    domain: "Mechanics.Rotational",
    label: "SpringDamper",
    className: "Modelica.Mechanics.Rotational.Components.SpringDamper",
    defaultPrefix: "sd",
    description: "Linear 1D rotational spring and damper in parallel",
    defaultParams: "c=100, d=1",
    color: "#10b981",
  },
  {
    id: "mech-torque",
    domain: "Mechanics.Rotational",
    label: "ConstantTorque",
    className: "Modelica.Mechanics.Rotational.Sources.ConstantTorque",
    defaultPrefix: "tau",
    description: "Constant driving torque source",
    defaultParams: "tau_constant=5",
    color: "#10b981",
  },
  {
    id: "trans-mass",
    domain: "Mechanics.Translational",
    label: "Mass",
    className: "Modelica.Mechanics.Translational.Components.Mass",
    defaultPrefix: "m",
    description: "Sliding mass with inertia",
    defaultParams: "m=1",
    color: "#14b8a6",
  },
  {
    id: "trans-spring",
    domain: "Mechanics.Translational",
    label: "Spring",
    className: "Modelica.Mechanics.Translational.Components.Spring",
    defaultPrefix: "k",
    description: "Linear 1D translational spring",
    defaultParams: "c=50",
    color: "#14b8a6",
  },
  {
    id: "trans-damper",
    domain: "Mechanics.Translational",
    label: "Damper",
    className: "Modelica.Mechanics.Translational.Components.Damper",
    defaultPrefix: "d",
    description: "Linear 1D translational damper",
    defaultParams: "d=2",
    color: "#14b8a6",
  },
  {
    id: "thermal-cap",
    domain: "Thermal.HeatTransfer",
    label: "HeatCapacitor",
    className: "Modelica.Thermal.HeatTransfer.Components.HeatCapacitor",
    defaultPrefix: "heatCap",
    description: "Lumped thermal element storing heat",
    defaultParams: "C=100",
    color: "#ef4444",
  },
  {
    id: "thermal-cond",
    domain: "Thermal.HeatTransfer",
    label: "ThermalConductor",
    className: "Modelica.Thermal.HeatTransfer.Components.ThermalConductor",
    defaultPrefix: "cond",
    description: "Lumped thermal heat conduction element",
    defaultParams: "G=10",
    color: "#ef4444",
  },
  {
    id: "thermal-temp",
    domain: "Thermal.HeatTransfer",
    label: "FixedTemperature",
    className: "Modelica.Thermal.HeatTransfer.Sources.FixedTemperature",
    defaultPrefix: "Tfix",
    description: "Fixed temperature boundary condition",
    defaultParams: "T=293.15",
    color: "#ef4444",
  },
  {
    id: "blocks-step",
    domain: "Blocks.Sources",
    label: "Step",
    className: "Modelica.Blocks.Sources.Step",
    defaultPrefix: "step",
    description: "Generate step signal of type Real",
    defaultParams: "height=1, startTime=0.5",
    color: "#8b5cf6",
  },
  {
    id: "blocks-pid",
    domain: "Blocks.Continuous",
    label: "PID",
    className: "Modelica.Blocks.Continuous.PID",
    defaultPrefix: "pid",
    description: "P-I-D controller block",
    defaultParams: "k=1, Ti=0.5, Td=0.1",
    color: "#8b5cf6",
  },
  {
    id: "blocks-integrator",
    domain: "Blocks.Continuous",
    label: "Integrator",
    className: "Modelica.Blocks.Continuous.Integrator",
    defaultPrefix: "integrator",
    description: "Output the integral of the input signal",
    defaultParams: "k=1, y_start=0",
    color: "#8b5cf6",
  },
];

const PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);
const MODELICA_KEYWORDS = new Set([
  "der",
  "pre",
  "noEvent",
  "smooth",
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "sqrt",
  "abs",
  "min",
  "max",
  "sign",
  "if",
  "then",
  "else",
  "elseif",
  "and",
  "or",
  "not",
  "true",
  "false",
  "time",
  "pi",
  "connect",
  "for",
  "loop",
  "in",
  "end",
]);

function escapeXml(str: string): string {
  return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' && text[i - 1] !== "\\") {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseModifiersFromSlice(modSlice: string): ParsedModifier[] {
  const trimmed = modSlice.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const result: ParsedModifier[] = [];
  for (const part of splitTopLevelCommas(inner)) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const rawName = part
      .slice(0, eqIdx)
      .trim()
      .replace(/^(each|final|redeclare)\s+/g, "");
    const rawVal = part.slice(eqIdx + 1).trim();
    if (rawName) result.push({ name: rawName, value: rawVal });
  }
  return result;
}

function parsePlacementOrigin(annSlice: string): [number, number] | undefined {
  const m = annSlice.match(/origin\s*=\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}/);
  if (m) return [Number(m[1]), Number(m[2])];
  const ext = annSlice.match(
    /extent\s*=\s*\{\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}\s*,\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}\s*\}/,
  );
  if (ext) {
    return [(Number(ext[1]) + Number(ext[3])) / 2, (Number(ext[2]) + Number(ext[4])) / 2];
  }
  return undefined;
}

function parseComponentInfo(code: string, decl: ScannedComponentDecl): ModelicaComponentInfo {
  const clauseText = code.slice(decl.clauseStartOffset, decl.identStartOffset);
  const variability: ModelicaComponentInfo["variability"] = /\bparameter\b/.test(clauseText)
    ? "parameter"
    : /\bconstant\b/.test(clauseText)
      ? "constant"
      : /\bdiscrete\b/.test(clauseText)
        ? "discrete"
        : "continuous";
  const causality: ModelicaComponentInfo["causality"] = /\binput\b/.test(clauseText)
    ? "input"
    : /\boutput\b/.test(clauseText)
      ? "output"
      : "local";
  const isFlow = /\bflow\b/.test(clauseText);

  let modifiers: ParsedModifier[] = [];
  if (decl.modOpenParenOffset !== null && decl.modCloseParenOffset !== null) {
    modifiers = parseModifiersFromSlice(code.slice(decl.modOpenParenOffset, decl.modCloseParenOffset + 1));
  }

  let bindingValue: string | undefined;
  const afterIdentStart = decl.modCloseParenOffset !== null ? decl.modCloseParenOffset + 1 : decl.identEndOffset;
  const afterIdentEnd = decl.descriptionStartOffset ?? decl.annotationKeywordOffset ?? decl.declEndOffset;
  if (afterIdentEnd > afterIdentStart) {
    const tail = code.slice(afterIdentStart, afterIdentEnd).trim();
    const eqMatch = tail.match(/^=\s*([\s\S]+?)(?:;|$)/);
    if (eqMatch) {
      bindingValue = eqMatch[1]!.replace(/;$/, "").trim();
    }
  }

  let description = "";
  if (decl.descriptionStartOffset !== null && decl.descriptionEndOffset !== null) {
    description = code.slice(decl.descriptionStartOffset, decl.descriptionEndOffset).trim().replace(/^"|"$/g, "");
  }

  let hasPlacement = false;
  let origin: [number, number] | undefined;
  if (decl.annotationOpenParenOffset !== null && decl.annotationCloseParenOffset !== null) {
    const annSlice = code.slice(decl.annotationOpenParenOffset, decl.annotationCloseParenOffset + 1);
    if (annSlice.includes("Placement")) {
      hasPlacement = true;
      origin = parsePlacementOrigin(annSlice);
    }
  }

  return {
    name: decl.name,
    typeName: decl.typeName,
    variability,
    causality,
    isFlow,
    isConnector: /Pin|Flange|Port|Connector/i.test(decl.typeName),
    description,
    modifiers,
    bindingValue,
    startLine: decl.startLine + 1,
    endLine: decl.endLine + 1,
    hasPlacement,
    origin,
  };
}

function parseConnectInfo(stmt: ScannedConnectStmt): ModelicaConnectInfo {
  const [sourceComp, ...srcRest] = stmt.source.split(".");
  const [targetComp, ...tgtRest] = stmt.target.split(".");
  return {
    source: stmt.source,
    target: stmt.target,
    sourceComp: sourceComp ?? stmt.source,
    sourcePort: srcRest.join(".") || "p",
    targetComp: targetComp ?? stmt.target,
    targetPort: tgtRest.join(".") || "n",
    startLine: stmt.startLine + 1,
  };
}

function extractEquations(
  code: string,
  layout: ScannedClassLayout | null,
  knownVarNames: Set<string>,
): ModelicaEquationInfo[] {
  if (!layout) return [];
  const equations: ModelicaEquationInfo[] = [];

  for (const sec of layout.sections) {
    if (sec.kind !== "equation") continue;
    const body = code.slice(sec.headerEndOffset, sec.endOffset);
    let stmtStart = 0;
    let depth = 0;
    let inStr = false;

    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === '"' && body[i - 1] !== "\\") {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      else if (ch === ";" && depth === 0) {
        const rawStmt = body.slice(stmtStart, i).trim();
        const absOffset = sec.headerEndOffset + stmtStart;
        stmtStart = i + 1;

        const cleaned = rawStmt
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "")
          .replace(/\bannotation\s*\([\s\S]*\)$/, "")
          .trim();
        if (!cleaned) continue;

        let line = 1;
        for (let k = 0; k < absOffset && k < code.length; k++) {
          if (code.charCodeAt(k) === 10) line++;
        }

        const isConnect = /^connect\s*\(/.test(cleaned);
        const derivativeVars: string[] = [];
        for (const m of cleaned.matchAll(/\bder\s*\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/g)) {
          if (m[1] && !derivativeVars.includes(m[1])) derivativeVars.push(m[1]);
        }

        const referencedVars: string[] = [];
        if (!isConnect) {
          for (const m of cleaned.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
            const ident = m[1]!;
            if (MODELICA_KEYWORDS.has(ident)) continue;
            if (knownVarNames.has(ident) && !referencedVars.includes(ident)) {
              referencedVars.push(ident);
            }
          }
        }

        equations.push({
          index: equations.length,
          text: cleaned.replace(/\s+/g, " "),
          line,
          isConnect,
          referencedVars,
          derivativeVars,
        });
      }
    }
  }

  return equations;
}

/**
 * Computes a browser-safe Block Lower Triangular (BLT) decomposition using
 * maximum bipartite matching (augmenting paths) + Tarjan's SCC algorithm.
 */
function computeBltAnalysis(components: ModelicaComponentInfo[], equations: ModelicaEquationInfo[]): BltAnalysisResult {
  const nonConnectEqs = equations.filter((e) => !e.isConnect);
  const unknowns = components
    .filter(
      (c) =>
        PRIMITIVE_TYPES.has(c.typeName) &&
        c.variability !== "parameter" &&
        c.variability !== "constant" &&
        c.causality !== "input",
    )
    .map((c) => c.name);

  const statesSet = new Set<string>();
  for (const eq of nonConnectEqs) {
    for (const d of eq.derivativeVars) {
      statesSet.add(d.split(".")[0] ?? d);
    }
  }
  const states = Array.from(statesSet);

  const nEq = nonConnectEqs.length;
  const nVar = unknowns.length;
  if (nEq === 0 && nVar === 0) {
    return {
      unknowns: [],
      states: [],
      equations: nonConnectEqs,
      incidence: [],
      matching: [],
      blocks: [],
      status: "empty",
    };
  }

  const varIndex = new Map<string, number>();
  unknowns.forEach((v, idx) => varIndex.set(v, idx));

  const incidence: boolean[][] = nonConnectEqs.map((eq) => {
    const row = new Array<boolean>(nVar).fill(false);
    for (const v of eq.referencedVars) {
      const idx = varIndex.get(v);
      if (idx !== undefined) row[idx] = true;
    }
    return row;
  });

  // Maximum bipartite matching: match equation i -> variable j
  const varToEq = new Array<number>(nVar).fill(-1);
  const eqToVar = new Array<number>(nEq).fill(-1);

  const tryMatch = (eqIdx: number, visited: boolean[]): boolean => {
    const row = incidence[eqIdx]!;
    for (let v = 0; v < nVar; v++) {
      if (!row[v] || visited[v]) continue;
      visited[v] = true;
      if (varToEq[v] === -1 || tryMatch(varToEq[v]!, visited)) {
        varToEq[v] = eqIdx;
        eqToVar[eqIdx] = v;
        return true;
      }
    }
    return false;
  };

  for (let e = 0; e < nEq; e++) {
    tryMatch(e, new Array<boolean>(nVar).fill(false));
  }

  // Build dependency graph among matched equations and run Tarjan SCC
  const adj: number[][] = Array.from({ length: nEq }, () => []);
  for (let e = 0; e < nEq; e++) {
    const row = incidence[e]!;
    for (let v = 0; v < nVar; v++) {
      if (!row[v]) continue;
      const producerEq = varToEq[v]!;
      if (producerEq !== -1 && producerEq !== e) {
        adj[e]!.push(producerEq);
      }
    }
  }

  let indexCounter = 0;
  const disc = new Array<number>(nEq).fill(-1);
  const low = new Array<number>(nEq).fill(0);
  const onStack = new Array<boolean>(nEq).fill(false);
  const stack: number[] = [];
  const sccs: number[][] = [];

  const strongConnect = (u: number) => {
    disc[u] = low[u] = indexCounter++;
    stack.push(u);
    onStack[u] = true;

    for (const w of adj[u]!) {
      if (disc[w] === -1) {
        strongConnect(w);
        low[u] = Math.min(low[u]!, low[w]!);
      } else if (onStack[w]) {
        low[u] = Math.min(low[u]!, disc[w]!);
      }
    }

    if (low[u] === disc[u]) {
      const comp: number[] = [];
      let w = -1;
      while (w !== u) {
        w = stack.pop()!;
        onStack[w] = false;
        comp.push(w);
      }
      sccs.push(comp);
    }
  };

  for (let e = 0; e < nEq; e++) {
    if (disc[e] === -1) strongConnect(e);
  }

  const blocks: BltBlockInfo[] = sccs.map((eqIndices, idx) => {
    const vars = eqIndices.map((ei) => (eqToVar[ei] !== -1 ? unknowns[eqToVar[ei]!]! : "(unmatched)")).filter(Boolean);
    return {
      blockIndex: idx + 1,
      equationIndices: eqIndices,
      variables: vars,
      isAlgebraicLoop: eqIndices.length > 1,
      isSolved: eqIndices.every((ei) => eqToVar[ei] !== -1),
    };
  });

  const status: BltAnalysisResult["status"] =
    nEq === nVar ? "balanced" : nEq < nVar ? "underdetermined" : "overdetermined";

  return {
    unknowns,
    states,
    equations: nonConnectEqs,
    incidence,
    matching: eqToVar,
    blocks,
    status,
  };
}

export function parseModelicaModelForPanel(code: string): ParsedModelicaModel {
  const layout = scanModelicaClassLayout(code);
  const classInstance = buildFallbackClassInstance(code);

  const headerMatch = code.match(
    /\b(model|block|class|connector|record|package|function|type)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+"([^"]*)")?/,
  );
  const classKind = headerMatch?.[1] ?? "model";
  const className = layout?.className ?? headerMatch?.[2] ?? "UnnamedModel";
  const description = headerMatch?.[3] ?? "";

  const extendsList: { baseClass: string; line: number }[] = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((ln, idx) => {
    const m = ln.match(/^\s*extends\s+([a-zA-Z_][a-zA-Z0-9_.]*)/);
    if (m?.[1]) extendsList.push({ baseClass: m[1], line: idx + 1 });
  });

  const components = (layout?.components ?? []).map((decl) => parseComponentInfo(code, decl));
  const connects = (layout?.connects ?? []).map(parseConnectInfo);

  const knownVarNames = new Set(
    components
      .filter((c) => PRIMITIVE_TYPES.has(c.typeName) && c.variability !== "parameter" && c.variability !== "constant")
      .map((c) => c.name),
  );
  const equations = extractEquations(code, layout, knownVarNames);
  const blt = computeBltAnalysis(components, equations);

  return {
    className,
    classKind,
    description,
    extendsList,
    components,
    connects,
    equations,
    layout,
    classInstance,
    blt,
  };
}

function domainColorForType(typeName: string): string {
  const lower = typeName.toLowerCase();
  if (lower.includes("electrical")) return "#3b82f6";
  if (lower.includes("rotational")) return "#10b981";
  if (lower.includes("translational") || lower.includes("multibody")) return "#14b8a6";
  if (lower.includes("thermal") || lower.includes("heat")) return "#ef4444";
  if (lower.includes("fluid")) return "#06b6d4";
  if (lower.includes("blocks")) return "#8b5cf6";
  return "#64748b";
}

/**
 * Renders the Modelica Diagram view as SVG.
 * Uses the native `renderDiagramSvgString` when Placement/Icon graphics exist,
 * and falls back to a clean auto-laid-out schematic SVG with components & connect wires.
 */
export function buildModelicaDiagramSvg(
  model: ParsedModelicaModel,
  selectedComponentName: string | null,
  isDark: boolean,
): { svg: string; usedNativeAnnotations: boolean } {
  const hasPlacedComponents = model.components.some((c) => c.hasPlacement);
  if (hasPlacedComponents && model.classInstance) {
    const nativeSvg = renderDiagramSvgString(model.classInstance);
    if (nativeSvg && nativeSvg.includes("<svg")) {
      return { svg: nativeSvg, usedNativeAnnotations: true };
    }
  }

  const blockComps = model.components.filter((c) => !PRIMITIVE_TYPES.has(c.typeName));
  const items = blockComps.length > 0 ? blockComps : model.components;

  const bg = isDark ? "#0d1117" : "#f8fafc";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0";
  const textColor = isDark ? "#e2e8f0" : "#0f172a";
  const mutedColor = isDark ? "#94a3b8" : "#64748b";
  const cardBg = isDark ? "#161b22" : "#ffffff";
  const wireColor = isDark ? "#60a5fa" : "#2563eb";

  if (items.length === 0) {
    return {
      usedNativeAnnotations: false,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320" width="100%" height="100%">
        <rect width="640" height="320" fill="${bg}"/>
        <text x="320" y="150" text-anchor="middle" fill="${textColor}" font-family="system-ui,sans-serif" font-size="14" font-weight="600">${escapeXml(model.className)}</text>
        <text x="320" y="174" text-anchor="middle" fill="${mutedColor}" font-family="system-ui,sans-serif" font-size="12">No components declared yet. Insert one from the Library tab.</text>
      </svg>`,
    };
  }

  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(items.length))));
  const nodeW = 156;
  const nodeH = 68;
  const gapX = 56;
  const gapY = 56;
  const pad = 44;

  const rows = Math.ceil(items.length / cols);
  const width = Math.max(560, pad * 2 + cols * nodeW + (cols - 1) * gapX);
  const height = Math.max(320, pad * 2 + rows * nodeH + (rows - 1) * gapY + 28);

  const positions = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  items.forEach((comp, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = pad + col * (nodeW + gapX);
    const y = pad + 20 + row * (nodeH + gapY);
    positions.set(comp.name, { x, y, cx: x + nodeW / 2, cy: y + nodeH / 2 });
  });

  const wiresSvg: string[] = [];
  for (const conn of model.connects) {
    const src = positions.get(conn.sourceComp);
    const tgt = positions.get(conn.targetComp);
    if (!src || !tgt) continue;
    const x1 = src.x + nodeW;
    const y1 = src.cy;
    const x2 = tgt.x;
    const y2 = tgt.cy;
    const midX = (x1 + x2) / 2;
    const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    wiresSvg.push(
      `<g>
        <path d="${path}" fill="none" stroke="${wireColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${x1}" cy="${y1}" r="3.5" fill="${wireColor}"/>
        <circle cx="${x2}" cy="${y2}" r="3.5" fill="${wireColor}"/>
      </g>`,
    );
  }

  const nodesSvg = items.map((comp) => {
    const pos = positions.get(comp.name)!;
    const accent = domainColorForType(comp.typeName);
    const isSel = selectedComponentName === comp.name;
    const shortType = comp.typeName.split(".").pop() ?? comp.typeName;
    const summaryMod =
      comp.modifiers.length > 0
        ? comp.modifiers
            .slice(0, 2)
            .map((m) => `${m.name}=${m.value}`)
            .join(", ")
        : comp.bindingValue
          ? `= ${comp.bindingValue}`
          : comp.variability !== "continuous"
            ? comp.variability
            : "";

    return `<g data-component="${escapeXml(comp.name)}" style="cursor:pointer">
      <rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="8" fill="${cardBg}" stroke="${isSel ? "#f59e0b" : accent}" stroke-width="${isSel ? 2.5 : 1.5}"/>
      <rect x="${pos.x}" y="${pos.y}" width="6" height="${nodeH}" rx="3" fill="${accent}"/>
      <text x="${pos.x + 14}" y="${pos.y + 22}" fill="${textColor}" font-family="system-ui,sans-serif" font-size="12.5" font-weight="600">${escapeXml(comp.name)}</text>
      <text x="${pos.x + 14}" y="${pos.y + 39}" fill="${mutedColor}" font-family="ui-monospace,monospace" font-size="10.5">${escapeXml(shortType.slice(0, 20))}</text>
      ${summaryMod ? `<text x="${pos.x + 14}" y="${pos.y + 56}" fill="${accent}" font-family="ui-monospace,monospace" font-size="10">${escapeXml(summaryMod.slice(0, 22))}</text>` : ""}
    </g>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <defs>
      <pattern id="mo-grid" width="24" height="24" patternUnits="userSpaceOnUse">
        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${gridColor}" stroke-width="0.7"/>
      </pattern>
    </defs>
    <rect width="${width}" height="${height}" fill="${bg}"/>
    <rect width="${width}" height="${height}" fill="url(#mo-grid)"/>
    <text x="16" y="24" fill="${mutedColor}" font-family="system-ui,sans-serif" font-size="11.5" font-weight="600">${escapeXml(model.classKind)} ${escapeXml(model.className)}</text>
    ${wiresSvg.join("\n")}
    ${nodesSvg.join("\n")}
  </svg>`;

  return { svg, usedNativeAnnotations: false };
}
