// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal N-File, N-Language Digital Thread & Nelson-Oppen Theory Coordinator.
 *
 * Generalizes cross-language verification from fixed 4-pane scenarios to arbitrary
 * N-file workspaces across all 16 `ThreadDomain`s and all ModelScript languages.
 */

import { CaeContractOracle } from "../formal/oracles/cae_contract_oracle.js";
import { ConstraintTheoryOracle } from "../formal/oracles/constraint_oracle.js";
import {
  DimensionalTheoryOracle,
  areDimensionsEqual,
  type DimensionVector,
} from "../formal/oracles/dimensional_oracle.js";
import { OntologyTheoryOracle } from "../formal/oracles/ontology_oracle.js";
import { ToleranceStackOracle } from "../formal/oracles/tolerance_stack_oracle.js";
import { PolyglotDriftChecker, type PolyglotModelSource } from "../formal/polyglot_drift_checker.js";
import {
  extractModelicaTwinAnnotations,
  parseSysmlRequirements,
  type SysmlRequirement,
} from "../formal/requirement_binder.js";
import { SemanticTheoryCoordinator, type ConflictClause, type SharedEquality } from "../formal/theory_coordinator.js";
import type { SymbolIndex } from "../runtime.js";
import { maskCommentsPreservingOffsets, parseModelicaCst, parseSysml2Cst } from "./cst-polyglot-adapters.js";
import type {
  CoordinatorDomainProviders,
  EvaluatedEquationRecord,
  InpDocLike,
  OpenFoamDocLike,
  ScadEvalResultLike,
  UrdfModelLike,
} from "./polyglot_coordinator_factory.js";
import type { CoordinatorDiagnosticLike } from "./semantic_coordinator_pipeline.js";
import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "./thread_hypergraph.js";

export interface GenericDigitalThreadOptions {
  providers?: Partial<CoordinatorDomainProviders> | undefined;
  symbolIndex?: SymbolIndex | undefined;
  autoAlignByAlias?: boolean | undefined;
  legacyDirectivesEnabled?: boolean | undefined;
  editedFileIndex?: number | undefined;
}

export interface GenericTheoryConstraints {
  namespaceFqn?: string | undefined;
  parameters?: GenericArtifactParameter[] | undefined;
  equations?: Array<{ lhs: string; rhs: string; line: number; unit: string }> | undefined;
  ports?: GenericArtifactPort[] | undefined;
}

export interface GenericWorkspaceFile {
  uri?: string | undefined;
  fileName: string;
  content: string;
  lang?: string | undefined;
  namespaceFqn?: string | undefined;
  threadDomain?: ThreadDomain | undefined;
  theoryConstraints?: GenericTheoryConstraints | undefined;
}

export interface GenericArtifactParameter {
  name: string;
  fqn: string;
  value: number;
  rawValueText: string;
  unit: string;
  line: number;
  startCol: number;
  endCol: number;
  valueStart?: number | undefined;
  valueEnd?: number | undefined;
}

export interface GenericArtifactPort {
  name: string;
  kind: string;
  normal?: [number, number, number] | undefined;
  line: number;
}

export interface GenericDirective {
  fileIndex: number;
  fileName: string;
  line: number;
  kind: "@twin" | "@port_map" | "@mesh_source" | "annotation(twin)" | "subject" | "*INCLUDE" | "geometry" | "owl2";
  sourceExpr: string;
  direction: "->" | "<-" | "<->";
  targetExpr: string;
  rawText: string;
}

export interface GenericExtractedArtifact {
  index: number;
  uri?: string | undefined;
  fileName: string;
  lang: string;
  domain: ThreadDomain;
  domainName: string;
  namespaceFqn: string;
  parameters: Map<string, GenericArtifactParameter>;
  equations: Array<{ lhs: string; rhs: string; line: number; unit: string }>;
  requirements: SysmlRequirement[];
  ports: GenericArtifactPort[];
  directives: GenericDirective[];
  owlAxioms: Array<
    | { kind: "subClassOf"; sub: string; sup: string; line: number }
    | { kind: "disjoint"; clsA: string; clsB: string; line: number }
    | { kind: "type"; individual: string; cls: string; line: number }
  >;
  scadEval?: ScadEvalResultLike | undefined;
  feaDoc?: InpDocLike | undefined;
  cfdDoc?: OpenFoamDocLike | undefined;
  urdfDoc?: UrdfModelLike | undefined;
  stepEntities?: Array<{ id: string; type: string; args: string }> | undefined;
}

export interface GenericVariableLink {
  symbol: string;
  canonicalFqn: string;
  bindingMechanism: string;
  label: string;
  valueFormatted: string;
  boundsFormatted: string;
  unit: string;
  sourceDomain: string;
  targetDomains: string[];
  domainBindings: Array<{
    domainLabel: string;
    fqn: string;
    bindingSyntax: string;
    valueText: string;
  }>;
  oracleName: string;
  status: "SAT" | "UNSAT";
  marginText: string;
}

export interface GenericPortBinding {
  portName: string;
  cadPortType: string;
  cadNormal: [number, number, number];
  cadFileName: string;
  cadLine: number;
  caeFileName: string;
  caeTargetKind: string;
  caePatchSpec: string;
  caeLine: number;
  isBound: boolean;
}

export interface GenericHypergraphNode {
  paneIndex: number;
  fileName: string;
  uri?: string | undefined;
  lang: string;
  formatLabel: string;
  namespaceFqn: string;
  domainName: string;
  oracleName: string;
  status: "SYNCED" | "CONFLICT" | "STALE";
  distanceFromEdit: number;
}

export interface GenericSuggestedEdit {
  fileIndex: number;
  uri?: string | undefined;
  fileName: string;
  line: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  newText: string;
  description: string;
}

export interface GenericDigitalThreadResult {
  mode: "generic" | "scenario";
  scenarioId: string;
  scenarioTitle: string;
  status: "SAT" | "UNSAT";
  isSat: boolean;
  elapsedMs: number;
  iterations: number;
  fileCount: number;
  domains: string[];
  artifacts: Array<{
    index: number;
    fileName: string;
    uri?: string | undefined;
    lang: string;
    domain: string;
    namespaceFqn: string;
    diagnostics: CoordinatorDiagnosticLike[];
  }>;
  hypergraphNodes: GenericHypergraphNode[];
  variableLinks: GenericVariableLink[];
  portBindings: GenericPortBinding[];
  directiveLinks: GenericDirective[];
  evaluatedEquations: EvaluatedEquationRecord[];
  updatedCodes: string[];
  suggestedEdits: GenericSuggestedEdit[];
  sharedEqualities: SharedEquality[];
  conflicts: ConflictClause[];
  summaryText: string;
}

const DOMAIN_META: Record<ThreadDomain, { label: string; oracle: string }> = {
  [ThreadDomain.SysML2]: { label: "SysML2", oracle: "ConstraintTheoryOracle" },
  [ThreadDomain.Modelica]: { label: "Modelica", oracle: "ConstraintTheoryOracle" },
  [ThreadDomain.CAD]: { label: "CAD", oracle: "SpatialPhysicsOracle" },
  [ThreadDomain.Requirements]: { label: "Requirements", oracle: "EntailmentTheoryOracle" },
  [ThreadDomain.FEA]: { label: "FEA", oracle: "CaeContractOracle" },
  [ThreadDomain.CFD]: { label: "CFD", oracle: "CaeContractOracle" },
  [ThreadDomain.BOM]: { label: "BOM", oracle: "ConstraintTheoryOracle" },
  [ThreadDomain.FMU]: { label: "FMU", oracle: "DynamicSimulationOracle" },
  [ThreadDomain.GDT]: { label: "GDT", oracle: "ToleranceStackOracle" },
  [ThreadDomain.Telemetry]: { label: "Telemetry", oracle: "DynamicSimulationOracle" },
  [ThreadDomain.Safety]: { label: "Safety", oracle: "SafetyTheoryOracle" },
  [ThreadDomain.Surrogate]: { label: "Surrogate", oracle: "AbstractDomainOracle" },
  [ThreadDomain.Manufacturing]: { label: "Manufacturing", oracle: "SpatialPhysicsOracle" },
  [ThreadDomain.CostCarbon]: { label: "CostCarbon", oracle: "ConstraintTheoryOracle" },
  [ThreadDomain.Verification]: { label: "Verification", oracle: "ConstraintTheoryOracle" },
  [ThreadDomain.Software]: { label: "Software", oracle: "AbstractDomainOracle" },
  [ThreadDomain.PowerRMS]: { label: "PowerRMS", oracle: "DynamicSimulationOracle" },
  [ThreadDomain.PowerEMT]: { label: "PowerEMT", oracle: "DynamicSimulationOracle" },
};

const EXT_TO_LANG: Array<{ ext: string; lang: string; domain: ThreadDomain }> = [
  { ext: ".sysml", lang: "sysml", domain: ThreadDomain.SysML2 },
  { ext: ".kerml", lang: "sysml", domain: ThreadDomain.SysML2 },
  { ext: ".mo", lang: "modelica", domain: ThreadDomain.Modelica },
  { ext: ".scad", lang: "scad", domain: ThreadDomain.CAD },
  { ext: ".inp", lang: "fea", domain: ThreadDomain.FEA },
  { ext: ".bdf", lang: "fea", domain: ThreadDomain.FEA },
  { ext: ".cfd", lang: "cfd", domain: ThreadDomain.CFD },
  { ext: ".foam", lang: "cfd", domain: ThreadDomain.CFD },
  { ext: ".urdf", lang: "urdf", domain: ThreadDomain.CAD },
  { ext: ".step", lang: "step", domain: ThreadDomain.GDT },
  { ext: ".stp", lang: "step", domain: ThreadDomain.GDT },
  { ext: ".reqif", lang: "reqif", domain: ThreadDomain.Requirements },
  { ext: ".sp", lang: "spice", domain: ThreadDomain.Modelica },
  { ext: ".raw", lang: "psse", domain: ThreadDomain.PowerRMS },
  { ext: ".dyr", lang: "psse", domain: ThreadDomain.PowerRMS },
  { ext: ".seq", lang: "psse", domain: ThreadDomain.PowerRMS },
  { ext: ".cgmes", lang: "cgmes", domain: ThreadDomain.PowerRMS },
  { ext: ".pscx", lang: "pscad", domain: ThreadDomain.PowerEMT },
  { ext: ".dss", lang: "opendss", domain: ThreadDomain.PowerEMT },
  { ext: ".olr", lang: "oneliner", domain: ThreadDomain.PowerEMT },
  { ext: ".p3743", lang: "p3743", domain: ThreadDomain.PowerEMT },
  { ext: ".cfg", lang: "comtrade", domain: ThreadDomain.Telemetry },
  { ext: ".dat", lang: "comtrade", domain: ThreadDomain.Telemetry },
  { ext: ".cff", lang: "comtrade", domain: ThreadDomain.Telemetry },
  { ext: ".soe", lang: "comfede", domain: ThreadDomain.Telemetry },
  { ext: ".comfede", lang: "comfede", domain: ThreadDomain.Telemetry },
  { ext: ".cir", lang: "spice", domain: ThreadDomain.Modelica },
  { ext: ".va", lang: "verilog-a", domain: ThreadDomain.Modelica },
  { ext: ".owl", lang: "owl2", domain: ThreadDomain.Safety },
  { ext: ".omn", lang: "owl2", domain: ThreadDomain.Safety },
  { ext: ".fmu", lang: "fmu", domain: ThreadDomain.FMU },
  { ext: ".ssp", lang: "ssp", domain: ThreadDomain.FMU },
  { ext: ".oscal", lang: "oscal", domain: ThreadDomain.Verification },
  { ext: ".csv", lang: "csv", domain: ThreadDomain.Telemetry },
  { ext: ".las", lang: "las", domain: ThreadDomain.Telemetry },
  { ext: ".sbml", lang: "sbml", domain: ThreadDomain.Modelica },
  { ext: ".cellml", lang: "cellml", domain: ThreadDomain.Modelica },
  { ext: ".c", lang: "c", domain: ThreadDomain.Software },
  { ext: ".h", lang: "c", domain: ThreadDomain.Software },
];

export function classifyWorkspaceFile(f: GenericWorkspaceFile): {
  lang: string;
  domain: ThreadDomain;
  domainName: string;
} {
  const lower = f.fileName.toLowerCase();
  const matched = EXT_TO_LANG.find((e) => lower.endsWith(e.ext));
  const lang = f.lang && f.lang !== "txt" ? f.lang.toLowerCase() : (matched?.lang ?? "txt");
  const domain = f.threadDomain ?? matched?.domain ?? ThreadDomain.Verification;
  return {
    lang,
    domain,
    domainName: DOMAIN_META[domain]?.label ?? "Domain",
  };
}

interface UnitSpec {
  baseUnit: string;
  scale: number;
  offset?: number;
  dim: DimensionVector;
}

const DIM_RESISTANCE: DimensionVector = [2, 1, -3, -2, 0, 0, 0];
const DIM_CAPACITANCE: DimensionVector = [-2, -1, 4, 2, 0, 0, 0];
const DIM_INDUCTANCE: DimensionVector = [2, 1, -2, -2, 0, 0, 0];
const DIM_FREQUENCY: DimensionVector = [0, 0, -1, 0, 0, 0, 0];

const UNIT_TABLE: Record<string, UnitSpec> = {
  m: { baseUnit: "m", scale: 1, dim: [1, 0, 0, 0, 0, 0, 0] },
  mm: { baseUnit: "m", scale: 1e-3, dim: [1, 0, 0, 0, 0, 0, 0] },
  cm: { baseUnit: "m", scale: 1e-2, dim: [1, 0, 0, 0, 0, 0, 0] },
  um: { baseUnit: "m", scale: 1e-6, dim: [1, 0, 0, 0, 0, 0, 0] },
  km: { baseUnit: "m", scale: 1e3, dim: [1, 0, 0, 0, 0, 0, 0] },
  kg: { baseUnit: "kg", scale: 1, dim: [0, 1, 0, 0, 0, 0, 0] },
  g: { baseUnit: "kg", scale: 1e-3, dim: [0, 1, 0, 0, 0, 0, 0] },
  s: { baseUnit: "s", scale: 1, dim: [0, 0, 1, 0, 0, 0, 0] },
  ms: { baseUnit: "s", scale: 1e-3, dim: [0, 0, 1, 0, 0, 0, 0] },
  us: { baseUnit: "s", scale: 1e-6, dim: [0, 0, 1, 0, 0, 0, 0] },
  a: { baseUnit: "A", scale: 1, dim: [0, 0, 0, 1, 0, 0, 0] },
  ma: { baseUnit: "A", scale: 1e-3, dim: [0, 0, 0, 1, 0, 0, 0] },
  ka: { baseUnit: "A", scale: 1e3, dim: [0, 0, 0, 1, 0, 0, 0] },
  k: { baseUnit: "K", scale: 1, dim: [0, 0, 0, 0, 1, 0, 0] },
  degc: { baseUnit: "K", scale: 1, offset: 273.15, dim: [0, 0, 0, 0, 1, 0, 0] },
  n: { baseUnit: "N", scale: 1, dim: [1, 1, -2, 0, 0, 0, 0] },
  kn: { baseUnit: "N", scale: 1e3, dim: [1, 1, -2, 0, 0, 0, 0] },
  mn: { baseUnit: "N", scale: 1e-3, dim: [1, 1, -2, 0, 0, 0, 0] },
  pa: { baseUnit: "Pa", scale: 1, dim: [-1, 1, -2, 0, 0, 0, 0] },
  kpa: { baseUnit: "Pa", scale: 1e3, dim: [-1, 1, -2, 0, 0, 0, 0] },
  mpa: { baseUnit: "Pa", scale: 1e6, dim: [-1, 1, -2, 0, 0, 0, 0] },
  gpa: { baseUnit: "Pa", scale: 1e9, dim: [-1, 1, -2, 0, 0, 0, 0] },
  w: { baseUnit: "W", scale: 1, dim: [2, 1, -3, 0, 0, 0, 0] },
  kw: { baseUnit: "W", scale: 1e3, dim: [2, 1, -3, 0, 0, 0, 0] },
  mw: { baseUnit: "W", scale: 1e-3, dim: [2, 1, -3, 0, 0, 0, 0] },
  v: { baseUnit: "V", scale: 1, dim: [2, 1, -3, -1, 0, 0, 0] },
  mv: { baseUnit: "V", scale: 1e-3, dim: [2, 1, -3, -1, 0, 0, 0] },
  kv: { baseUnit: "V", scale: 1e3, dim: [2, 1, -3, -1, 0, 0, 0] },
  ohm: { baseUnit: "Ohm", scale: 1, dim: DIM_RESISTANCE },
  kohm: { baseUnit: "Ohm", scale: 1e3, dim: DIM_RESISTANCE },
  mohm: { baseUnit: "Ohm", scale: 1e6, dim: DIM_RESISTANCE },
  f: { baseUnit: "F", scale: 1, dim: DIM_CAPACITANCE },
  uf: { baseUnit: "F", scale: 1e-6, dim: DIM_CAPACITANCE },
  nf: { baseUnit: "F", scale: 1e-9, dim: DIM_CAPACITANCE },
  pf: { baseUnit: "F", scale: 1e-12, dim: DIM_CAPACITANCE },
  h: { baseUnit: "H", scale: 1, dim: DIM_INDUCTANCE },
  mh: { baseUnit: "H", scale: 1e-3, dim: DIM_INDUCTANCE },
  uh: { baseUnit: "H", scale: 1e-6, dim: DIM_INDUCTANCE },
  hz: { baseUnit: "Hz", scale: 1, dim: DIM_FREQUENCY },
  khz: { baseUnit: "Hz", scale: 1e3, dim: DIM_FREQUENCY },
  mhz: { baseUnit: "Hz", scale: 1e6, dim: DIM_FREQUENCY },
  "n*m": { baseUnit: "N*m", scale: 1, dim: [2, 1, -2, 0, 0, 0, 0] },
  nm: { baseUnit: "N*m", scale: 1, dim: [2, 1, -2, 0, 0, 0, 0] },
  "n·m": { baseUnit: "N*m", scale: 1, dim: [2, 1, -2, 0, 0, 0, 0] },
};

export function normalizeValueToBaseUnit(
  value: number,
  unit: string,
): { value: number; baseUnit: string; dim?: DimensionVector } {
  const key = unit
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!key) return { value, baseUnit: "" };
  const spec = UNIT_TABLE[key];
  if (!spec) return { value, baseUnit: unit.trim() };
  return {
    value: value * spec.scale + (spec.offset ?? 0),
    baseUnit: spec.baseUnit,
    dim: spec.dim,
  };
}

function parseSpiceNumber(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  const m = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(meg|g|k|m|u|n|p|f)?$/.exec(s);
  if (!m) return undefined;
  const base = Number.parseFloat(m[1]!);
  if (!Number.isFinite(base)) return undefined;
  const suffix = m[2];
  const scale =
    suffix === "meg"
      ? 1e6
      : suffix === "g"
        ? 1e9
        : suffix === "k"
          ? 1e3
          : suffix === "m"
            ? 1e-3
            : suffix === "u"
              ? 1e-6
              : suffix === "n"
                ? 1e-9
                : suffix === "p"
                  ? 1e-12
                  : suffix === "f"
                    ? 1e-15
                    : 1;
  return base * scale;
}

function stripCommentTrailer(token: string): string {
  return token
    .replace(/\*\/$/, "")
    .replace(/--!?>$/, "")
    .replace(/\*\)$/, "")
    .trim();
}

function lineColAtOffset(text: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(0, clamped);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    col: lines[lines.length - 1]!.length + 1,
  };
}

function extractDirectivesFromLines(
  fileIndex: number,
  fileName: string,
  content: string,
): { directives: GenericDirective[]; unitHints: Map<string, string> } {
  const directives: GenericDirective[] = [];
  const unitHints = new Map<string, string>();
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    const lineNum = i + 1;

    const twinIdx = lineText.indexOf("@twin:");
    const portIdx = lineText.indexOf("@port_map:");
    const markerIdx = twinIdx >= 0 ? twinIdx : portIdx;
    const markerLen = twinIdx >= 0 ? "@twin:".length : "@port_map:".length;
    if (markerIdx >= 0) {
      const rest = lineText.slice(markerIdx + markerLen).trim();
      const arrow = rest.includes("<->") ? "<->" : rest.includes("->") ? "->" : rest.includes("<-") ? "<-" : undefined;
      if (arrow) {
        const arrowPos = rest.indexOf(arrow);
        const src = rest.slice(0, arrowPos).trim().split(/\s+/)[0] ?? "";
        const afterArrow = rest.slice(arrowPos + arrow.length).trim();
        const dst = stripCommentTrailer(afterArrow.split(/\s+/)[0] ?? "");
        if (src && dst) {
          directives.push({
            fileIndex,
            fileName,
            line: lineNum,
            kind: twinIdx >= 0 ? "@twin" : "@port_map",
            sourceExpr: src,
            direction: arrow,
            targetExpr: dst,
            rawText: lineText.trim(),
          });
        }
      }
    }

    const meshIdx = lineText.indexOf("@mesh_source:");
    if (meshIdx >= 0) {
      const rest = stripCommentTrailer(lineText.slice(meshIdx + "@mesh_source:".length).trim());
      if (rest) {
        directives.push({
          fileIndex,
          fileName,
          line: lineNum,
          kind: "@mesh_source",
          sourceExpr: fileName,
          direction: "<-",
          targetExpr: rest,
          rawText: lineText.trim(),
        });
      }
    }

    const unitIdx = lineText.indexOf("@unit:");
    if (unitIdx >= 0) {
      const rest = stripCommentTrailer(lineText.slice(unitIdx + "@unit:".length).trim());
      const eqIdx = rest.indexOf("=");
      if (eqIdx > 0) {
        const sym = rest.slice(0, eqIdx).trim();
        const unit = rest.slice(eqIdx + 1).trim();
        if (sym && unit) unitHints.set(sym, unit);
      }
    }

    const trimmedUpper = lineText.trim().toUpperCase();
    if (trimmedUpper.startsWith("*INCLUDE")) {
      const inpPos = trimmedUpper.indexOf("INPUT=");
      if (inpPos >= 0) {
        const target = lineText
          .trim()
          .slice(inpPos + "INPUT=".length)
          .split(/[,\s]/)[0]
          ?.trim();
        if (target) {
          directives.push({
            fileIndex,
            fileName,
            line: lineNum,
            kind: "*INCLUDE",
            sourceExpr: "*INCLUDE, INPUT",
            direction: "<-",
            targetExpr: target,
            rawText: lineText.trim(),
          });
        }
      }
    }
  }

  return { directives, unitHints };
}

function extractGenericArtifact(
  file: GenericWorkspaceFile,
  index: number,
  options?: GenericDigitalThreadOptions,
): GenericExtractedArtifact {
  const { lang, domain, domainName } = classifyWorkspaceFile(file);
  const baseStem =
    file.fileName
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? `Artifact${index}`;
  let namespaceFqn = file.namespaceFqn ?? `${domainName}::${baseStem}`;
  const parameters = new Map<string, GenericArtifactParameter>();
  const equations: GenericExtractedArtifact["equations"] = [];
  const ports: GenericArtifactPort[] = [];
  const owlAxioms: GenericExtractedArtifact["owlAxioms"] = [];
  let requirements: SysmlRequirement[] = [];
  let scadEval: GenericExtractedArtifact["scadEval"];
  let feaDoc: GenericExtractedArtifact["feaDoc"];
  let cfdDoc: GenericExtractedArtifact["cfdDoc"];
  let urdfDoc: GenericExtractedArtifact["urdfDoc"];
  let stepEntities: GenericExtractedArtifact["stepEntities"];

  const { directives, unitHints } = extractDirectivesFromLines(index, file.fileName, file.content);
  const providers = options?.providers;

  const addCommentMaskedAssignments = () => {
    const masked = maskCommentsPreservingOffsets(file.content);
    const lines = masked.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const lhs = line.slice(0, eqIdx).trim().split(/\s+/).pop() ?? "";
        const rhsRaw = line.slice(eqIdx + 1).replace(/;.*$/, "");
        const rhsTrim = rhsRaw.trim();
        const num = Number.parseFloat(rhsTrim);
        if (lhs && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(lhs) && Number.isFinite(num) && !parameters.has(lhs)) {
          const col = Math.max(1, line.indexOf(lhs) + 1);
          const rhsStartInLine = line.indexOf(rhsTrim, eqIdx + 1);
          const numMatch = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rhsTrim);
          const vStart = rhsStartInLine >= 0 ? offset + rhsStartInLine : undefined;
          const vEnd = vStart !== undefined && numMatch ? vStart + numMatch[0]!.length : undefined;
          parameters.set(lhs, {
            name: lhs,
            fqn: `${namespaceFqn}::${lhs}`,
            value: num,
            rawValueText: rhsTrim,
            unit: unitHints.get(lhs) ?? "",
            line: i + 1,
            startCol: col,
            endCol: col + lhs.length,
            valueStart: vStart,
            valueEnd: vEnd,
          });
        }
      }
      offset += line.length + 1;
    }
  };

  if (lang === "sysml" || lang === "sysml2") {
    const cst = parseSysml2Cst(file.content);
    requirements = parseSysmlRequirements(file.content);
    const pkgMatch = /\bpackage\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(maskCommentsPreservingOffsets(file.content));
    const pkgName = requirements[0]?.packageName ?? pkgMatch?.[1];
    if (pkgName) {
      namespaceFqn = `SysML2::${pkgName}`;
    }
    for (const part of cst.partDefs) {
      for (const [attrName, rawVal] of Object.entries(part.attributes)) {
        const bracketOpen = rawVal.indexOf("[");
        const bracketClose = rawVal.indexOf("]", bracketOpen + 1);
        const unitFromVal =
          bracketOpen >= 0 && bracketClose > bracketOpen ? rawVal.slice(bracketOpen + 1, bracketClose).trim() : "";
        const num = Number.parseFloat(rawVal);
        if (Number.isFinite(num)) {
          const attrSpan = part.attributeSpans?.[attrName];
          let startOff = part.span.start;
          let spanLen = attrName.length;
          if (attrSpan?.declSpan) {
            const declText = file.content.slice(attrSpan.declSpan.start, attrSpan.declSpan.end);
            const escapedName = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const nameMatch = new RegExp(`\\b${escapedName}\\b`).exec(declText);
            startOff = nameMatch ? attrSpan.declSpan.start + nameMatch.index : attrSpan.declSpan.start;
          } else if (attrSpan?.valueSpan) {
            startOff = attrSpan.valueSpan.start;
            spanLen = Math.max(1, attrSpan.valueSpan.end - attrSpan.valueSpan.start);
          } else if (attrSpan && "start" in attrSpan) {
            startOff = (attrSpan as { start: number }).start;
          }
          const lc = lineColAtOffset(file.content, startOff);
          const fqn = `${namespaceFqn}::${part.name}.${attrName}`;
          parameters.set(attrName, {
            name: attrName,
            fqn,
            value: num,
            rawValueText: rawVal,
            unit: unitHints.get(attrName) ?? unitFromVal,
            line: lc.line,
            startCol: lc.col,
            endCol: lc.col + spanLen,
            valueStart: attrSpan?.valueSpan?.start,
            valueEnd: attrSpan?.valueSpan?.end,
          });
        }
      }
    }
    const maskedSysml = maskCommentsPreservingOffsets(file.content);
    const importedTargets: Array<{ pkg: string; line: number }> = [];
    const importRegex = /\bimport\s+([A-Za-z_][A-Za-z0-9_:]*)(?:::\*|::([A-Za-z_]\w*))?\s*;/g;
    let impMatch: RegExpExecArray | null;
    while ((impMatch = importRegex.exec(maskedSysml)) !== null) {
      const targetPkg = impMatch[1]!.replace(/::+$/, "");
      if (targetPkg) {
        importedTargets.push({ pkg: targetPkg, line: lineColAtOffset(file.content, impMatch.index).line });
      }
    }

    const findAttrLine = (attr: string, fallback: number): number => {
      const short = attr.split(/::|\./).pop() ?? attr;
      const idx = maskedSysml.indexOf(attr);
      if (idx >= 0) return lineColAtOffset(file.content, idx).line;
      const shortIdx = maskedSysml.indexOf(short);
      if (shortIdx >= 0) return lineColAtOffset(file.content, shortIdx).line;
      return fallback;
    };

    for (const req of requirements) {
      const reqLine = req.targetAttribute ? findAttrLine(req.targetAttribute, 1) : 1;
      if (req.subjectName) {
        directives.push({
          fileIndex: index,
          fileName: file.fileName,
          line: reqLine,
          kind: "subject",
          sourceExpr: req.subjectName,
          direction: "<->",
          targetExpr: req.targetAttribute,
          rawText: `subject ${req.subjectName};`,
        });
      }
      if (req.targetAttribute) {
        const attrLine = findAttrLine(req.targetAttribute, reqLine);
        if (req.targetAttribute.includes(".") || req.targetAttribute.includes("::")) {
          directives.push({
            fileIndex: index,
            fileName: file.fileName,
            line: attrLine,
            kind: "subject",
            sourceExpr: req.targetAttribute,
            direction: "<->",
            targetExpr: req.targetAttribute.replace(/\./g, "::"),
            rawText: req.expressionText ?? req.targetAttribute,
          });
        } else {
          for (const imp of importedTargets) {
            directives.push({
              fileIndex: index,
              fileName: file.fileName,
              line: attrLine > 1 ? attrLine : imp.line,
              kind: "subject",
              sourceExpr: req.targetAttribute,
              direction: "<->",
              targetExpr: `${imp.pkg}::${req.targetAttribute}`,
              rawText: `import ${imp.pkg}::*; // ${req.targetAttribute}`,
            });
          }
        }
      }
    }
  } else if (lang === "modelica") {
    const cst = parseModelicaCst(file.content);
    const twins = extractModelicaTwinAnnotations(file.content);
    if (cst.modelName && cst.modelName !== "Model") {
      namespaceFqn = `Modelica::${cst.modelName}`;
    }
    for (const comp of cst.components) {
      const fqn = `${namespaceFqn}.${comp.name}`;
      if (comp.bindingExpr !== undefined) {
        const num = Number.parseFloat(comp.bindingExpr);
        const unit = unitHints.get(comp.name) ?? comp.modifications["unit"]?.replace(/^"|"$/g, "") ?? "";
        const lc = lineColAtOffset(file.content, comp.span.start);
        parameters.set(comp.name, {
          name: comp.name,
          fqn,
          value: Number.isFinite(num) ? num : 0,
          rawValueText: comp.bindingExpr,
          unit,
          line: lc.line,
          startCol: lc.col,
          endCol: lc.col + comp.name.length,
          valueStart: comp.bindingSpan?.start,
          valueEnd: comp.bindingSpan?.end,
        });
      }
      if (comp.typeSpecifier.toLowerCase().includes("port") || comp.typeSpecifier.toLowerCase().includes("flange")) {
        ports.push({
          name: comp.name,
          kind: comp.typeSpecifier,
          line: lineColAtOffset(file.content, comp.span.start).line,
        });
      }
    }
    for (const eq of cst.equations) {
      const lc = lineColAtOffset(file.content, eq.span.start);
      const lhsParam = parameters.get(eq.lhs);
      equations.push({
        lhs: eq.lhs,
        rhs: eq.rhs,
        line: lc.line,
        unit: lhsParam?.unit ?? unitHints.get(eq.lhs) ?? "",
      });
    }
    for (const [compName, twinTargetFqn] of twins.entries()) {
      const compParam = parameters.get(compName);
      directives.push({
        fileIndex: index,
        fileName: file.fileName,
        line: compParam?.line ?? 1,
        kind: "annotation(twin)",
        sourceExpr: compName,
        direction: "<->",
        targetExpr: twinTargetFqn,
        rawText: `annotation(twin = "${twinTargetFqn}")`,
      });
    }
  } else if (lang === "spice") {
    const lines = file.content.split("\n");
    let lineStartOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const curLineStart = lineStartOffset;
      lineStartOffset += raw.length + 1;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("*")) continue;
      if (trimmed.toLowerCase().startsWith(".param")) {
        const body = trimmed.slice(".param".length).trim();
        let scanPos = raw.toLowerCase().indexOf(".param") + ".param".length;
        for (const assign of body.split(/\s+/)) {
          const eq = assign.indexOf("=");
          if (eq > 0) {
            const name = assign.slice(0, eq).trim();
            const valStr = assign.slice(eq + 1).trim();
            const parsed = parseSpiceNumber(valStr);
            const assignPos = raw.indexOf(assign, scanPos);
            if (assignPos >= 0) scanPos = assignPos + assign.length;
            if (parsed !== undefined) {
              const col = Math.max(1, raw.indexOf(name) + 1);
              const valInAssign = assign.indexOf(valStr, eq + 1);
              const valStart = assignPos >= 0 && valInAssign >= 0 ? curLineStart + assignPos + valInAssign : undefined;
              const valEnd = valStart !== undefined ? valStart + valStr.length : undefined;
              parameters.set(name, {
                name,
                fqn: `${namespaceFqn}::${name}`,
                value: parsed,
                rawValueText: valStr,
                unit: unitHints.get(name) ?? "",
                line: i + 1,
                startCol: col,
                endCol: col + name.length,
                valueStart: valStart,
                valueEnd: valEnd,
              });
            }
          }
        }
      } else {
        // Basic passive component card: e.g. R1 in out 10k  | V1 in 0 12V
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 4 && /^[rclv]/i.test(parts[0]!)) {
          const devName = parts[0]!;
          const rawVal = parts[parts.length - 1]!;
          const unitGuess =
            devName[0]!.toUpperCase() === "R"
              ? "Ohm"
              : devName[0]!.toUpperCase() === "C"
                ? "F"
                : devName[0]!.toUpperCase() === "L"
                  ? "H"
                  : "V";
          const parsed = parseSpiceNumber(
            rawVal.replace(/[a-z]+$/i, (s) => (["v", "a", "ohm"].includes(s.toLowerCase()) ? "" : s)),
          );
          if (parsed !== undefined) {
            const col = Math.max(1, raw.indexOf(devName) + 1);
            const valInRaw = raw.replace(/\r$/, "").lastIndexOf(rawVal);
            const valStart = valInRaw >= 0 ? curLineStart + valInRaw : undefined;
            const valEnd = valStart !== undefined ? valStart + rawVal.length : undefined;
            parameters.set(devName, {
              name: devName,
              fqn: `${namespaceFqn}::${devName}`,
              value: parsed,
              rawValueText: rawVal,
              unit: unitHints.get(devName) ?? unitGuess,
              line: i + 1,
              startCol: col,
              endCol: col + devName.length,
              valueStart: valStart,
              valueEnd: valEnd,
            });
          }
        }
      }
    }
  } else if (lang === "scad") {
    addCommentMaskedAssignments();
    if (providers?.evaluateScad) {
      try {
        scadEval = providers.evaluateScad(file.content);
        for (const [vName, vVal] of Object.entries(scadEval.variables ?? {})) {
          if (typeof vVal === "number" && Number.isFinite(vVal)) {
            const existing = parameters.get(vName);
            if (existing) {
              existing.value = vVal;
            } else {
              parameters.set(vName, {
                name: vName,
                fqn: `${namespaceFqn}::${vName}`,
                value: vVal,
                rawValueText: String(vVal),
                unit: unitHints.get(vName) ?? "",
                line: 1,
                startCol: 1,
                endCol: Math.max(2, vName.length + 1),
              });
            }
          }
        }
        const seenPortNames = new Set<string>();
        const collectSolidTags = (
          root: unknown,
          out: Array<{ portName: string; portType: string; normal?: readonly [number, number, number] | undefined }>,
        ): void => {
          const stack: unknown[] = [root];
          while (stack.length > 0) {
            const node = stack.pop() as
              | {
                  tag?: {
                    portName?: string;
                    portType?: string;
                    normal?: readonly [number, number, number] | undefined;
                  };
                  child?: unknown;
                  left?: unknown;
                  right?: unknown;
                  children?: unknown[];
                }
              | null
              | undefined;
            if (!node || typeof node !== "object") continue;
            if (node.tag?.portName) {
              out.push({
                portName: node.tag.portName,
                portType: node.tag.portType || "port",
                normal: node.tag.normal,
              });
            }
            if (node.child) stack.push(node.child);
            if (node.left) stack.push(node.left);
            if (node.right) stack.push(node.right);
            if (Array.isArray(node.children)) {
              for (const c of node.children) stack.push(c);
            }
          }
        };
        const scadAny = scadEval as unknown as {
          solid?: unknown;
          solids?: unknown[];
          mesh?: {
            tags?: ReadonlyArray<{
              portName: string;
              portType: string;
              normal?: readonly [number, number, number] | undefined;
            }>;
          };
        };
        const collectedTags: Array<{
          portName: string;
          portType: string;
          normal?: readonly [number, number, number] | undefined;
        }> = [];
        if (scadAny.solid) collectSolidTags(scadAny.solid, collectedTags);
        if (Array.isArray(scadAny.solids)) {
          for (const s of scadAny.solids) collectSolidTags(s, collectedTags);
        }
        // Only touch lazy .mesh getter when a test mock supplies prebuilt .mesh without .solid/.solids
        const tagsSource =
          collectedTags.length > 0 || scadAny.solid != null || Array.isArray(scadAny.solids)
            ? collectedTags
            : (scadAny.mesh?.tags ?? []);
        for (const tag of tagsSource) {
          if (tag.portName && !seenPortNames.has(tag.portName)) {
            seenPortNames.add(tag.portName);
            const idxTag = file.content.indexOf(`"${tag.portName}"`);
            const line = idxTag >= 0 ? lineColAtOffset(file.content, idxTag).line : 1;
            ports.push({
              name: tag.portName,
              kind: tag.portType || "port",
              normal: tag.normal ? [tag.normal[0], tag.normal[1], tag.normal[2]] : undefined,
              line,
            });
          }
        }
      } catch {
        // Retain comment-masked parameters on partial SCAD edit
      }
    }
  } else if (lang === "fea") {
    if (providers?.InpDialect) {
      try {
        feaDoc = new providers.InpDialect().parse(file.content);
        const firstMat = Array.from(feaDoc.materials.values())[0];
        if (firstMat?.E !== undefined) {
          parameters.set("E", {
            name: "E",
            fqn: `${namespaceFqn}::E`,
            value: firstMat.E,
            rawValueText: String(firstMat.E),
            unit: unitHints.get("E") ?? "MPa",
            line: 1,
            startCol: 1,
            endCol: 2,
          });
        }
        if (firstMat?.nu !== undefined) {
          parameters.set("nu", {
            name: "nu",
            fqn: `${namespaceFqn}::nu`,
            value: firstMat.nu,
            rawValueText: String(firstMat.nu),
            unit: unitHints.get("nu") ?? "",
            line: 1,
            startCol: 1,
            endCol: 3,
          });
        }
        for (const cload of feaDoc.cloads ?? []) {
          const targetKey = String(cload.target);
          if (!parameters.has(targetKey)) {
            parameters.set(targetKey, {
              name: targetKey,
              fqn: `${namespaceFqn}::${targetKey}`,
              value: Math.abs(cload.magnitude),
              rawValueText: String(cload.magnitude),
              unit: unitHints.get(targetKey) ?? "N",
              line: cload.line ?? 1,
              startCol: 1,
              endCol: Math.max(2, targetKey.length + 1),
            });
          }
        }
      } catch {
        // Fallback to comment-masked scanner
      }
    }
    addCommentMaskedAssignments();
  } else if (lang === "cfd") {
    if (providers?.OpenFoamDialect) {
      try {
        cfdDoc = new providers.OpenFoamDialect().parse(file.content);
        const geom =
          cfdDoc.directives instanceof Map ? cfdDoc.directives.get("geometry") : cfdDoc.directives["geometry"];
        if (typeof geom === "string" && geom.trim()) {
          directives.push({
            fileIndex: index,
            fileName: file.fileName,
            line: 1,
            kind: "geometry",
            sourceExpr: file.fileName,
            direction: "<-",
            targetExpr: geom.trim(),
            rawText: `geometry ${geom.trim()};`,
          });
        }
      } catch {
        // Fallback
      }
    }
    addCommentMaskedAssignments();
  } else if (lang === "urdf") {
    const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const findUrdfAttrSpan = (
      tagKind: "link" | "joint",
      elemName: string,
      childAttrRegex: RegExp,
    ): { line: number; startCol: number; endCol: number; valueStart?: number; valueEnd?: number } => {
      const openRe = new RegExp(`<${tagKind}\\b[^>]*\\bname\\s*=\\s*["']${escRe(elemName)}["'][^>]*>`, "i");
      const openMatch = openRe.exec(file.content);
      if (openMatch) {
        const searchStart = openMatch.index + openMatch[0].length;
        const closeIdx = file.content.indexOf(`</${tagKind}>`, searchStart);
        const slice = closeIdx >= 0 ? file.content.slice(searchStart, closeIdx) : file.content.slice(searchStart);
        const attrMatch = childAttrRegex.exec(slice);
        if (attrMatch && attrMatch[2] !== undefined) {
          const valIdxInMatch = attrMatch[0].lastIndexOf(attrMatch[2]);
          if (valIdxInMatch >= 0) {
            const valueStart = searchStart + attrMatch.index + valIdxInMatch;
            const valueEnd = valueStart + attrMatch[2].length;
            const lc = lineColAtOffset(file.content, valueStart);
            return { line: lc.line, startCol: lc.col, endCol: lc.col + attrMatch[2].length, valueStart, valueEnd };
          }
        }
      }
      return { line: 1, startCol: 1, endCol: elemName.length + 6 };
    };
    if (providers?.parseUrdf) {
      try {
        urdfDoc = providers.parseUrdf(file.content);
        for (const [linkName, link] of urdfDoc.links.entries()) {
          if (link.inertial?.mass !== undefined) {
            const span = findUrdfAttrSpan("link", linkName, /<mass\b[^>]*\bvalue\s*=\s*(["'])([^"']+)\1/i);
            parameters.set(`${linkName}.mass`, {
              name: `${linkName}.mass`,
              fqn: `${namespaceFqn}::${linkName}.mass`,
              value: link.inertial.mass,
              rawValueText: String(link.inertial.mass),
              unit: unitHints.get(`${linkName}.mass`) ?? "kg",
              line: span.line,
              startCol: span.startCol,
              endCol: span.endCol,
              valueStart: span.valueStart,
              valueEnd: span.valueEnd,
            });
          }
        }
        for (const [jointName, joint] of urdfDoc.joints.entries()) {
          if (joint.limits?.effort !== undefined) {
            const span = findUrdfAttrSpan("joint", jointName, /<limit\b[^>]*\beffort\s*=\s*(["'])([^"']+)\1/i);
            parameters.set(`${jointName}.effort`, {
              name: `${jointName}.effort`,
              fqn: `${namespaceFqn}::${jointName}.effort`,
              value: joint.limits.effort,
              rawValueText: String(joint.limits.effort),
              unit: unitHints.get(`${jointName}.effort`) ?? "N*m",
              line: span.line,
              startCol: span.startCol,
              endCol: span.endCol,
              valueStart: span.valueStart,
              valueEnd: span.valueEnd,
            });
          }
        }
      } catch {
        // Fallback
      }
    }
    addCommentMaskedAssignments();
  } else if (lang === "step") {
    const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (providers?.scanStepEntities) {
      try {
        stepEntities = providers.scanStepEntities(file.content);
        const isLargeStep = file.content.length > 262_144;
        for (const ent of stepEntities) {
          const rawFirstArg = ent.args.split(",")[0]?.trim() ?? "";
          const firstArg = Number.parseFloat(rawFirstArg);
          if (Number.isFinite(firstArg)) {
            const startOff = (ent as { startOffset?: number }).startOffset;
            const searchChunk =
              typeof startOff === "number" && startOff >= 0
                ? file.content.slice(startOff, Math.min(file.content.length, startOff + 512))
                : isLargeStep
                  ? ""
                  : file.content;
            const chunkBase = typeof startOff === "number" && startOff >= 0 ? startOff : 0;
            const entRe = new RegExp(`${escRe(ent.id)}\\s*=\\s*[A-Z0-9_]+\\s*\\(\\s*([^,)\\s]+)`, "i");
            const entMatch = searchChunk ? entRe.exec(searchChunk) : null;
            let valueStart: number | undefined;
            let valueEnd: number | undefined;
            let line = 1;
            let startCol = 1;
            let endCol = ent.id.length + 1;
            if (entMatch && entMatch[1] !== undefined) {
              const argIdx = entMatch[0].lastIndexOf(entMatch[1]);
              if (argIdx >= 0) {
                valueStart = chunkBase + entMatch.index + argIdx;
                valueEnd = valueStart + entMatch[1].length;
                if (!isLargeStep) {
                  const lc = lineColAtOffset(file.content, valueStart);
                  line = lc.line;
                  startCol = lc.col;
                  endCol = lc.col + entMatch[1].length;
                }
              }
            }
            parameters.set(ent.id, {
              name: ent.id,
              fqn: `${namespaceFqn}::${ent.id}`,
              value: firstArg,
              rawValueText: rawFirstArg || String(firstArg),
              unit: unitHints.get(ent.id) ?? "mm",
              line,
              startCol,
              endCol,
              valueStart,
              valueEnd,
            });
          }
        }
      } catch {
        // Fallback
      }
    }
    addCommentMaskedAssignments();
  } else if (lang === "reqif") {
    // Parse XML attribute values (<ATTRIBUTE-VALUE-... THE-VALUE="..."/>) & scalar assignments
    const attrRegex = /<ATTRIBUTE-VALUE-[A-Z]+\s+[^>]*THE-VALUE="(-?\d+(?:\.\d+)?)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    let idxReq = 0;
    while ((m = attrRegex.exec(file.content)) !== null) {
      const val = Number.parseFloat(m[1]!);
      if (Number.isFinite(val)) {
        const tvToken = `THE-VALUE="${m[1]!}"`;
        const tvPos = m[0].indexOf(tvToken);
        const valueStart = tvPos >= 0 ? m.index + tvPos + 'THE-VALUE="'.length : undefined;
        const valueEnd = valueStart !== undefined ? valueStart + m[1]!.length : undefined;
        const lc = lineColAtOffset(file.content, valueStart ?? m.index);
        const name = `req_val_${++idxReq}`;
        parameters.set(name, {
          name,
          fqn: `${namespaceFqn}::${name}`,
          value: val,
          rawValueText: m[1]!,
          unit: unitHints.get(name) ?? "",
          line: lc.line,
          startCol: lc.col,
          endCol: lc.col + m[1]!.length,
          valueStart,
          valueEnd,
        });
      }
    }
    addCommentMaskedAssignments();
  } else if (lang === "owl2") {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      const subMatch = /^SubClassOf\(\s*([^\s)]+)\s+([^\s)]+)\s*\)/.exec(trimmed);
      if (subMatch) {
        owlAxioms.push({ kind: "subClassOf", sub: subMatch[1]!, sup: subMatch[2]!, line: i + 1 });
      }
      const disjMatch = /^DisjointClasses\(\s*([^)]+)\)/.exec(trimmed);
      if (disjMatch) {
        const classes = disjMatch[1]!.trim().split(/\s+/);
        for (let a = 0; a < classes.length; a++) {
          for (let b = a + 1; b < classes.length; b++) {
            owlAxioms.push({ kind: "disjoint", clsA: classes[a]!, clsB: classes[b]!, line: i + 1 });
          }
        }
      }
      const typeMatch = /^ClassAssertion\(\s*([^\s)]+)\s+([^\s)]+)\s*\)/.exec(trimmed);
      if (typeMatch) {
        owlAxioms.push({ kind: "type", cls: typeMatch[1]!, individual: typeMatch[2]!, line: i + 1 });
      }
    }
  } else {
    addCommentMaskedAssignments();
  }

  if (file.theoryConstraints) {
    if (file.theoryConstraints.namespaceFqn) {
      namespaceFqn = file.theoryConstraints.namespaceFqn;
    }
    for (const p of file.theoryConstraints.parameters ?? []) {
      if (!parameters.has(p.name)) {
        parameters.set(p.name, p);
      }
    }
    for (const eq of file.theoryConstraints.equations ?? []) {
      equations.push(eq);
    }
    for (const port of file.theoryConstraints.ports ?? []) {
      if (!ports.some((existing) => existing.name === port.name)) {
        ports.push(port);
      }
    }
  }

  return {
    index,
    uri: file.uri,
    fileName: file.fileName,
    lang,
    domain,
    domainName,
    namespaceFqn,
    parameters,
    equations,
    requirements,
    ports,
    directives,
    owlAxioms,
    scadEval,
    feaDoc,
    cfdDoc,
    urdfDoc,
    stepEntities,
  };
}

function resolveParameterByExpr(
  artifacts: GenericExtractedArtifact[],
  originIdx: number,
  expr: string,
): { artifact: GenericExtractedArtifact; param: GenericArtifactParameter } | undefined {
  const clean = expr.trim();
  const norm = (s: string) => s.replace(/\./g, "::");
  const normClean = norm(clean);
  const shortName = clean.split(/::|\./).pop() ?? clean;
  const isQualified = clean.includes("::") || clean.includes(".");

  // 0. Unqualified local name resolves to origin artifact first
  if (!isQualified) {
    const local = artifacts[originIdx]?.parameters.get(shortName);
    if (local) return { artifact: artifacts[originIdx]!, param: local };
  }

  // 1. Exact or qualified-suffix FQN match across artifacts (prefer foreign artifacts when qualified)
  const orderedArts = isQualified
    ? [...artifacts.filter((a) => a.index !== originIdx), ...(artifacts[originIdx] ? [artifacts[originIdx]!] : [])]
    : artifacts;
  for (const art of orderedArts) {
    for (const p of art.parameters.values()) {
      const pNorm = norm(p.fqn);
      if (p.fqn === clean || (isQualified && (pNorm === normClean || pNorm.endsWith(`::${normClean}`)))) {
        return { artifact: art, param: p };
      }
    }
  }
  // 2. Namespace + parameter match
  for (const art of orderedArts) {
    if (clean.includes(art.namespaceFqn) || clean.startsWith(art.domainName + "::")) {
      const p = art.parameters.get(shortName);
      if (p) return { artifact: art, param: p };
    }
  }
  // 3. Cross-file shortName / suffix fallback
  for (const art of orderedArts) {
    if (art.index === originIdx) continue;
    const p = art.parameters.get(shortName);
    if (p) return { artifact: art, param: p };
    for (const cand of art.parameters.values()) {
      if (cand.name.split(/::|\./).pop() === shortName) {
        return { artifact: art, param: cand };
      }
    }
  }
  const localFallback = artifacts[originIdx]?.parameters.get(shortName);
  if (localFallback) return { artifact: artifacts[originIdx]!, param: localFallback };
  return undefined;
}

/**
 * Evaluates an arbitrary N-file, N-language digital thread workspace without
 * restricting to hardcoded 4-pane scenarios.
 */
export function evaluateGenericDigitalThread(
  files: GenericWorkspaceFile[],
  options?: GenericDigitalThreadOptions,
): GenericDigitalThreadResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const artifacts = files.map((f, idx) => extractGenericArtifact(f, idx, options));
  const paneDiagnostics: CoordinatorDiagnosticLike[][] = artifacts.map(() => []);
  const allDirectives = options?.legacyDirectivesEnabled === false ? [] : artifacts.flatMap((a) => a.directives);
  const conflicts: ConflictClause[] = [];
  const providers = options?.providers;

  const coordinator = new SemanticTheoryCoordinator();
  const constraintOracle = new ConstraintTheoryOracle();
  const dimOracle = new DimensionalTheoryOracle();
  const ontOracle = new OntologyTheoryOracle();
  const caeOracle = new CaeContractOracle();
  const tolOracle = new ToleranceStackOracle();
  coordinator.registerOracle(constraintOracle);
  coordinator.registerOracle(dimOracle);
  coordinator.registerOracle(ontOracle);
  coordinator.registerOracle(caeOracle);
  coordinator.registerOracle(tolOracle);

  const hypergraph = new DigitalThreadHypergraph(Math.max(16, artifacts.length * 4));
  const threadSlot = hypergraph.createThread(2001, 1, ThreadRelation.Verifies);
  const artSlots = artifacts.map((art, idx) => {
    hypergraph.bindDomainNode(threadSlot, art.domain, (idx + 1) * 10);
    const s = hypergraph.createThread(2002 + idx, 1, ThreadRelation.Verifies);
    hypergraph.bindDomainNode(s, art.domain, (idx + 1) * 10);
    return s;
  });

  // 1. Assert all extracted artifact parameters + base units into Coordinator
  const seenParams = new Map<string, { artifact: GenericExtractedArtifact; param: GenericArtifactParameter }>();
  for (const art of artifacts) {
    for (const p of art.parameters.values()) {
      seenParams.set(p.fqn, { artifact: art, param: p });
      const norm = normalizeValueToBaseUnit(p.value, p.unit);
      coordinator.assertLiteral({
        predicate: "bound",
        args: [p.fqn, "==", norm.value],
        domain: "constraint",
        sourceContext: { fileIndex: art.index, fileName: art.fileName, line: p.line, col: p.startCol },
      });
      if (norm.dim) {
        coordinator.assertLiteral({
          predicate: "has_dim",
          args: [p.fqn, norm.dim],
          domain: "constraint",
        });
      }
    }
  }

  // 2. Assert SysML v2 requirements
  for (const art of artifacts) {
    for (const req of art.requirements) {
      const attrSuffix = req.targetAttribute.includes(".")
        ? req.targetAttribute.split(".").pop()!
        : req.targetAttribute;
      const candidateFqn = req.subjectName
        ? `${art.namespaceFqn}::${req.subjectName}.${attrSuffix}`
        : `${art.namespaceFqn}::${req.targetAttribute}`;
      const matched = resolveParameterByExpr(artifacts, art.index, candidateFqn);
      const targetFqn = matched ? matched.param.fqn : candidateFqn;
      const normLimit = normalizeValueToBaseUnit(req.limitValue, matched?.param.unit ?? "");
      coordinator.assertLiteral({
        predicate: "bound",
        args: [targetFqn, req.operator, normLimit.value],
        domain: "constraint",
        sourceContext: { fileIndex: art.index, fileName: art.fileName },
      });
    }
  }

  // 3. Assert OWL2 ontology axioms & check cross-domain type disjointness
  for (const art of artifacts) {
    for (const ax of art.owlAxioms) {
      if (ax.kind === "subClassOf") {
        coordinator.assertLiteral({ predicate: "subClassOf", args: [ax.sub, ax.sup], domain: "ontology" });
      } else if (ax.kind === "disjoint") {
        coordinator.assertLiteral({ predicate: "disjoint", args: [ax.clsA, ax.clsB], domain: "ontology" });
      } else if (ax.kind === "type") {
        coordinator.assertLiteral({ predicate: "type", args: [ax.individual, ax.cls], domain: "ontology" });
      }
    }
  }

  // 4. Process explicit @twin / annotation(twin) links + declarative TGG correspondences, per-component hypergraph slots, & surgical writeback
  const variableLinks: GenericVariableLink[] = [];
  const conflictedFiles = new Set<number>();
  const pendingEdits = new Map<number, Array<{ start: number; end: number; text: string }>>();
  const suggestedEdits: GenericSuggestedEdit[] = [];
  let componentSlotIdx = 0;

  // 4a-pre: Ingest declarative TGG parameter/attribute correspondences from `options?.symbolIndex`
  const tggIdx = options?.symbolIndex as
    | (SymbolIndex & {
        tggProjectionTable?: { areMemberNamesAligned?: (lA: string, nA: string, lB: string, nB: string) => boolean };
        tggCorrespondenceIndexer?: {
          syncIndex?: (idx: SymbolIndex) => { touchedSlots: number[] };
          hypergraph?: DigitalThreadHypergraph;
        };
      })
    | undefined;
  if (tggIdx?.tggCorrespondenceIndexer?.syncIndex && tggIdx.tggCorrespondenceIndexer.hypergraph) {
    const tggSummary = tggIdx.tggCorrespondenceIndexer.syncIndex(tggIdx);
    const tggHg = tggIdx.tggCorrespondenceIndexer.hypergraph;
    const projTable = tggIdx.tggProjectionTable;
    const seenTggPairs = new Set<string>();
    const findArtifactForUri = (u: string | undefined) => {
      if (!u) return undefined;
      const uLower = u.toLowerCase();
      return artifacts.find(
        (a) =>
          (a.uri && a.uri.toLowerCase() === uLower) ||
          uLower.endsWith(`/${a.fileName.toLowerCase()}`) ||
          uLower === a.fileName.toLowerCase(),
      );
    };

    for (const slot of tggSummary.touchedSlots) {
      const rec = tggHg.getRecord(slot);
      if (!rec || rec.isRemoved || !rec.domainNodes) continue;
      const members = Object.values(rec.domainNodes)
        .filter((nid): nid is number => typeof nid === "number" && nid > 0)
        .map((nid) => tggIdx.symbols.get(nid))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const symA = members[i]!;
          const symB = members[j]!;
          const artA = findArtifactForUri(symA.resourceId ?? symA.documentUri);
          const artB = findArtifactForUri(symB.resourceId ?? symB.documentUri);
          if (!artA || !artB || artA.index === artB.index) continue;

          // Match either direct leaf parameter symbols or aligned container parameters (including fieldAliases like m <-> mass)
          const paramPairs: Array<[GenericArtifactParameter, GenericArtifactParameter]> = [];
          const directA = artA.parameters.get(symA.name);
          const directB = artB.parameters.get(symB.name);
          if (directA && directB) {
            paramPairs.push([directA, directB]);
          } else {
            for (const pA of artA.parameters.values()) {
              for (const pB of artB.parameters.values()) {
                const sameCanon =
                  pA.name === pB.name ||
                  (pA.name === "m" && pB.name === "mass") ||
                  (pA.name === "mass" && pB.name === "m") ||
                  Boolean(projTable?.areMemberNamesAligned?.(artA.lang, pA.name, artB.lang, pB.name));
                if (sameCanon) {
                  paramPairs.push([pA, pB]);
                }
              }
            }
          }

          for (const [pA, pB] of paramPairs) {
            const pairKey = [pA.fqn, pB.fqn].sort().join("|");
            if (seenTggPairs.has(pairKey)) continue;
            seenTggPairs.add(pairKey);
            const alreadyExplicit = allDirectives.some(
              (d) =>
                (d.kind === "@twin" || d.kind === "annotation(twin)") &&
                ((d.sourceExpr.endsWith(pA.name) && d.targetExpr.endsWith(pB.name)) ||
                  (d.sourceExpr.endsWith(pB.name) && d.targetExpr.endsWith(pA.name))),
            );
            if (!alreadyExplicit) {
              allDirectives.push({
                fileIndex: artA.index,
                fileName: artA.fileName,
                line: pA.line,
                kind: "@twin",
                sourceExpr: pA.fqn,
                direction: "<->",
                targetExpr: pB.fqn,
                rawText: `TGG(${symA.name} <-> ${symB.name})`,
              });
            }
          }
        }
      }
    }
  }

  for (const d of allDirectives) {
    if (d.kind === "@twin" || d.kind === "annotation(twin)") {
      const lhs = resolveParameterByExpr(artifacts, d.fileIndex, d.sourceExpr);
      const rhs = resolveParameterByExpr(artifacts, d.fileIndex, d.targetExpr);
      if (lhs && rhs) {
        const compSlot = hypergraph.createThread(3000 + ++componentSlotIdx, 1, ThreadRelation.Aligned);
        hypergraph.bindDomainNode(compSlot, lhs.artifact.domain, (lhs.artifact.index + 1) * 100);
        hypergraph.bindDomainNode(compSlot, rhs.artifact.domain, (rhs.artifact.index + 1) * 100);

        const lhsNorm = normalizeValueToBaseUnit(lhs.param.value, lhs.param.unit);
        const rhsNorm = normalizeValueToBaseUnit(rhs.param.value, rhs.param.unit);

        if (lhsNorm.dim && rhsNorm.dim && !areDimensionsEqual(lhsNorm.dim, rhsNorm.dim)) {
          const msg = `Dimensional mismatch across '${lhs.param.fqn}' (${lhs.param.unit}) and '${rhs.param.fqn}' (${rhs.param.unit}).`;
          const conflict: ConflictClause = {
            literals: [],
            explanation: msg,
            culpritEntities: [lhs.param.fqn, rhs.param.fqn],
            theoryName: "DimensionalTheoryOracle",
          };
          conflicts.push(conflict);
          hypergraph.recordTheoryConflict(compSlot, conflict);
          conflictedFiles.add(lhs.artifact.index);
          conflictedFiles.add(rhs.artifact.index);
          paneDiagnostics[lhs.artifact.index]!.push({
            startLine: lhs.param.line,
            startCol: lhs.param.startCol,
            endLine: lhs.param.line,
            endCol: lhs.param.endCol,
            severity: "error",
            code: "POLYGLOT_DIM_MISMATCH",
            message: msg,
          });
        }

        coordinator.assertLiteral({
          predicate: "equal",
          args: [lhs.param.fqn, rhs.param.fqn],
          domain: "constraint",
        });

        const relDiff =
          Math.abs(lhsNorm.value - rhsNorm.value) / Math.max(1e-9, Math.abs(lhsNorm.value), Math.abs(rhsNorm.value));
        const linkSat =
          relDiff <= 1e-3 && !(lhsNorm.dim && rhsNorm.dim && !areDimensionsEqual(lhsNorm.dim, rhsNorm.dim));
        if (!linkSat && relDiff > 1e-3) {
          // Prepare unit-aware surgical writeback & IDE/LSP suggestedEdits
          const authoritativeIdx = options?.editedFileIndex ?? 0;
          const target =
            lhs.artifact.index === authoritativeIdx ? rhs : rhs.artifact.index === authoritativeIdx ? lhs : rhs;
          const source = target === rhs ? lhs : rhs;
          const sourceNorm = source === lhs ? lhsNorm : rhsNorm;
          const targetUnitFactor = target.param.unit ? normalizeValueToBaseUnit(1, target.param.unit).value || 1 : 1;
          const convertedVal = Number((sourceNorm.value / targetUnitFactor).toPrecision(6));
          suggestedEdits.push({
            fileIndex: target.artifact.index,
            uri: target.artifact.uri,
            fileName: target.artifact.fileName,
            line: target.param.line,
            startOffset: target.param.valueStart,
            endOffset: target.param.valueEnd,
            newText: String(convertedVal),
            description: `Sync '${target.param.fqn}' -> ${convertedVal}${target.param.unit ? ` ${target.param.unit}` : ""} (from ${source.artifact.fileName})`,
          });
          if (
            options?.editedFileIndex !== undefined &&
            target.param.valueStart !== undefined &&
            target.param.valueEnd !== undefined
          ) {
            const list = pendingEdits.get(target.artifact.index) ?? [];
            list.push({
              start: target.param.valueStart,
              end: target.param.valueEnd,
              text: String(convertedVal),
            });
            pendingEdits.set(target.artifact.index, list);
          }

          const msg = `Digital thread value divergence: '${lhs.param.fqn}' (${lhs.param.value} ${lhs.param.unit}) != '${rhs.param.fqn}' (${rhs.param.value} ${rhs.param.unit}).`;
          const conflict: ConflictClause = {
            literals: [],
            explanation: msg,
            culpritEntities: [lhs.param.fqn, rhs.param.fqn],
            theoryName: "ConstraintTheoryOracle",
          };
          conflicts.push(conflict);
          hypergraph.recordTheoryConflict(compSlot, conflict);
          conflictedFiles.add(lhs.artifact.index);
          conflictedFiles.add(rhs.artifact.index);
          paneDiagnostics[lhs.artifact.index]!.push({
            startLine: lhs.param.line,
            startCol: lhs.param.startCol,
            endLine: lhs.param.line,
            endCol: lhs.param.endCol,
            severity: "error",
            code: "POLYGLOT_TWIN_DRIFT",
            message: msg,
          });
          paneDiagnostics[rhs.artifact.index]!.push({
            startLine: rhs.param.line,
            startCol: rhs.param.startCol,
            endLine: rhs.param.line,
            endCol: rhs.param.endCol,
            severity: "error",
            code: "POLYGLOT_TWIN_DRIFT",
            message: msg,
          });
        } else if (linkSat) {
          hypergraph.recordTheorySat(compSlot, []);
        }

        variableLinks.push({
          symbol: lhs.param.name,
          canonicalFqn: lhs.param.fqn,
          bindingMechanism: d.kind,
          label: `${lhs.param.name} ↔ ${rhs.param.name}`,
          valueFormatted: `${lhs.param.value}${lhs.param.unit ? ` ${lhs.param.unit}` : ""}`,
          boundsFormatted: `== ${rhs.param.value}${rhs.param.unit ? ` ${rhs.param.unit}` : ""}`,
          unit: lhs.param.unit || rhs.param.unit,
          sourceDomain: lhs.artifact.domainName,
          targetDomains: [rhs.artifact.domainName],
          domainBindings: [
            {
              domainLabel: lhs.artifact.domainName,
              fqn: lhs.param.fqn,
              bindingSyntax: d.kind,
              valueText: `${lhs.param.value} ${lhs.param.unit}`.trim(),
            },
            {
              domainLabel: rhs.artifact.domainName,
              fqn: rhs.param.fqn,
              bindingSyntax: d.kind,
              valueText: `${rhs.param.value} ${rhs.param.unit}`.trim(),
            },
          ],
          oracleName: "ConstraintTheoryOracle",
          status: linkSat ? "SAT" : "UNSAT",
          marginText: linkSat ? "Aligned" : `Δ ${(relDiff * 100).toFixed(2)}%`,
        });
      }
    }
  }

  // 4b. Optional alias-based drift detection (opt-in via autoAlignByAlias)
  if (options?.autoAlignByAlias) {
    const sources: PolyglotModelSource[] = [];
    for (const art of artifacts) {
      for (const p of art.parameters.values()) {
        sources.push({
          lang: art.lang,
          uri: art.uri ?? art.fileName,
          component: art.namespaceFqn,
          param: p.name,
          value: p.value,
          unit: p.unit || undefined,
          startOffset: p.valueStart,
          endOffset: p.valueEnd,
        });
      }
    }
    const violations = PolyglotDriftChecker.checkDrift(sources);
    for (const v of violations) {
      conflicts.push({
        literals: [],
        explanation: v.message,
        culpritEntities: [`${v.sourceA.component}.${v.sourceA.param}`, `${v.sourceB.component}.${v.sourceB.param}`],
        theoryName: "PolyglotDriftChecker",
      });
      const idxA = artifacts.findIndex((a) => (a.uri ?? a.fileName) === v.sourceA.uri);
      const idxB = artifacts.findIndex((a) => (a.uri ?? a.fileName) === v.sourceB.uri);
      if (idxA >= 0) {
        conflictedFiles.add(idxA);
        paneDiagnostics[idxA]!.push({
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 12,
          severity: "warning",
          code: "POLYGLOT_ALIAS_DRIFT",
          message: v.message,
        });
      }
      if (idxB >= 0) {
        conflictedFiles.add(idxB);
      }
    }
  }

  // 5. Evaluate static algebraic Modelica equations via evaluateCfdExpression
  const evaluatedEquations: EvaluatedEquationRecord[] = [];
  if (providers?.evaluateCfdExpression) {
    for (const art of artifacts) {
      if (art.equations.length === 0) continue;
      const resolver = (ident: string): number | undefined => art.parameters.get(ident)?.value;
      for (const eq of art.equations) {
        // Differential or compound LHS equations (e.g. `T_avr * der(Vt) = ...`) are not constant bindings
        if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(eq.lhs.trim())) continue;
        try {
          // Pass a scratch diagnostics array so symbolic equations with state variables fail silently
          const silentDiagnostics: Array<{
            severity: "error" | "info" | "warning";
            message: string;
            expression?: string;
          }> = [];
          const val = providers.evaluateCfdExpression(eq.rhs, resolver, silentDiagnostics);
          if (silentDiagnostics.length === 0 && typeof val === "number" && Number.isFinite(val)) {
            evaluatedEquations.push({
              paneIndex: art.index,
              fileName: art.fileName,
              language: art.lang,
              lhs: eq.lhs,
              rhsExpression: eq.rhs,
              evaluatedValue: val,
              unit: eq.unit,
            });
            const lhsParam = art.parameters.get(eq.lhs);
            const targetFqn = lhsParam ? lhsParam.fqn : `${art.namespaceFqn}::${eq.lhs}`;
            coordinator.assertLiteral({
              predicate: "bound",
              args: [targetFqn, "==", val],
              domain: "constraint",
              sourceContext: { fileIndex: art.index, fileName: art.fileName, line: eq.line },
            });
          }
        } catch {
          // Ignore unevaluatable symbolic equations
        }
      }
    }
  }

  // 6. Run CAD/FEA/CFD/STEP subgraph physics & port bindings when providers are available
  const portBindings: GenericPortBinding[] = [];
  const scadArtifacts = artifacts.filter((a) => a.lang === "scad" && a.scadEval);
  const feaArtifacts = artifacts.filter((a) => a.lang === "fea" && a.feaDoc);
  const cfdArtifacts = artifacts.filter((a) => a.lang === "cfd" && a.cfdDoc);
  const stepArtifacts = artifacts.filter((a) => a.lang === "step" && a.stepEntities);

  const matchCadForCae = (caeArt: GenericExtractedArtifact) => {
    const meshRefs = caeArt.directives
      .filter((d) => d.kind === "@mesh_source" || d.kind === "*INCLUDE")
      .map((d) => d.targetExpr.split(/[\\/]/).pop()?.toLowerCase() ?? "");
    const matched = scadArtifacts.find((cad) => meshRefs.includes(cad.fileName.toLowerCase()));
    return { cad: matched ?? scadArtifacts[0], hasExplicitRef: Boolean(matched || meshRefs.length > 0) };
  };

  if (providers && scadArtifacts.length > 0 && feaArtifacts.length > 0) {
    for (const fea of feaArtifacts) {
      const { cad, hasExplicitRef } = matchCadForCae(fea);
      if (!cad) continue;
      const bbox = cad.scadEval!.boundingBox;
      const width = Math.max(0.01, Math.abs((bbox.max[0] ?? 1) - (bbox.min[0] ?? 0)));
      const height = Math.max(0.01, Math.abs((bbox.max[1] ?? 1) - (bbox.min[1] ?? 0)));
      const depth = Math.max(0.01, Math.abs((bbox.max[2] ?? 1) - (bbox.min[2] ?? 0)));

      for (const p of cad.ports) {
        const boundInFea =
          (fea.feaDoc!.boundaries ?? []).some((b) => String(b.target).toLowerCase() === p.name.toLowerCase()) ||
          (fea.feaDoc!.cloads ?? []).some((c) => String(c.target).toLowerCase() === p.name.toLowerCase()) ||
          fea.directives.some(
            (d) => d.kind === "@port_map" && d.sourceExpr.toLowerCase().includes(p.name.toLowerCase()),
          );
        portBindings.push({
          portName: p.name,
          cadPortType: p.kind,
          cadNormal: p.normal ?? [0, 0, 1],
          cadFileName: cad.fileName,
          cadLine: p.line,
          caeFileName: fea.fileName,
          caeTargetKind: p.kind === "load" ? "*CLOAD" : "*BOUNDARY",
          caePatchSpec: p.name,
          caeLine: 1,
          isBound: boundInFea,
        });
        if (!boundInFea && hasExplicitRef) {
          const msg = `CAD boundary port '${p.name}' (${cad.fileName}:${p.line}) is unbound in FEA model '${fea.fileName}'.`;
          conflicts.push({
            literals: [],
            explanation: msg,
            culpritEntities: [`${cad.namespaceFqn}::${p.name}`, fea.namespaceFqn],
            theoryName: "CaeContractOracle",
          });
          conflictedFiles.add(cad.index);
          conflictedFiles.add(fea.index);
          paneDiagnostics[fea.index]!.push({
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 12,
            severity: "warning",
            code: "POLYGLOT_UNBOUND_PORT",
            message: msg,
          });
        }
      }

      try {
        if (providers.Tet4Mesher && providers.FeaSolver) {
          const firstMat = fea.feaDoc!.materials.values().next().value;
          const E = firstMat?.E ?? fea.parameters.get("E")?.value ?? 2.1e11;
          const nu = firstMat?.nu ?? fea.parameters.get("nu")?.value ?? 0.3;
          const rho = fea.parameters.get("rho")?.value ?? 7850;
          const yieldStrength = fea.parameters.get("yield_strength")?.value ?? 250e6;
          const mesh = providers.Tet4Mesher.createBoxMesh({
            width,
            height,
            depth,
            nx: 6,
            ny: 3,
            nz: 3,
            faceTags: { xmin: "fixed", xmax: "load" },
          });
          providers.MeshQualityAnalyzer?.analyze(mesh);
          const solver = new providers.FeaSolver(mesh, { E, nu, rho, yieldStrength });
          const fixedNodes = new Set<number>(mesh.boundaryNodes.get("xmin") ?? [0]);
          const loadNodes = mesh.boundaryNodes.get("xmax") ?? [mesh.numNodes - 1];
          const totalLoad = fea.feaDoc!.cloads?.[0]?.magnitude ?? 1000;
          const perNode = totalLoad / Math.max(1, loadNodes.length);
          const nodalLoads = new Map<number, [number, number, number]>();
          for (const nid of loadNodes) nodalLoads.set(nid, [perNode, 0, 0]);
          const feaOut = solver.step({ fixedNodes, nodalLoads });
          coordinator.assertLiteral({
            predicate: "bound",
            args: [`${fea.namespaceFqn}::max_von_mises_stress`, "==", feaOut.maxVonMisesStress],
            domain: "constraint",
          });
          if (feaOut.maxVonMisesStress > yieldStrength) {
            const msg = `FEA peak von Mises stress (${(feaOut.maxVonMisesStress / 1e6).toFixed(2)} MPa) exceeds yield strength (${(yieldStrength / 1e6).toFixed(2)} MPa) in '${fea.fileName}'.`;
            conflicts.push({
              literals: [],
              explanation: msg,
              culpritEntities: [`${fea.namespaceFqn}::max_von_mises_stress`],
              theoryName: "CaeContractOracle",
            });
            conflictedFiles.add(fea.index);
            paneDiagnostics[fea.index]!.push({
              startLine: 1,
              startCol: 1,
              endLine: 1,
              endCol: 12,
              severity: "error",
              code: "POLYGLOT_FEA_YIELD_EXCEEDED",
              message: msg,
            });
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }
  }

  if (providers && scadArtifacts.length > 0 && cfdArtifacts.length > 0) {
    for (const cfd of cfdArtifacts) {
      const { cad, hasExplicitRef } = matchCadForCae(cfd);
      if (!cad) continue;
      for (const p of cad.ports) {
        const hasMarker =
          cfd.ports.some((cp) => cp.name.toLowerCase() === p.name.toLowerCase()) ||
          cfd.directives.some(
            (d) => d.kind === "@port_map" && d.sourceExpr.toLowerCase().includes(p.name.toLowerCase()),
          );
        portBindings.push({
          portName: p.name,
          cadPortType: p.kind,
          cadNormal: p.normal ?? [1, 0, 0],
          cadFileName: cad.fileName,
          cadLine: p.line,
          caeFileName: cfd.fileName,
          caeTargetKind: "boundaryField",
          caePatchSpec: p.name,
          caeLine: 1,
          isBound: hasMarker,
        });
        if (!hasMarker && hasExplicitRef) {
          const msg = `CAD fluid port '${p.name}' (${cad.fileName}:${p.line}) has no matching boundary patch in '${cfd.fileName}'.`;
          conflicts.push({
            literals: [],
            explanation: msg,
            culpritEntities: [`${cad.namespaceFqn}::${p.name}`, cfd.namespaceFqn],
            theoryName: "CaeContractOracle",
          });
          conflictedFiles.add(cad.index);
          conflictedFiles.add(cfd.index);
          paneDiagnostics[cfd.index]!.push({
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 12,
            severity: "warning",
            code: "POLYGLOT_UNBOUND_PORT",
            message: msg,
          });
        }
      }

      try {
        if (providers.LbmVoxelizer && providers.WebGPULbmRunner) {
          const vx = cfd.parameters.get("inlet_velocity")?.value ?? cfd.parameters.get("U")?.value ?? 2;
          const density = cfd.parameters.get("density")?.value ?? cfd.parameters.get("rho")?.value ?? 1.225;
          const tau = cfd.parameters.get("tau")?.value ?? 0.65;
          const cfg = {
            nx: 12,
            ny: 8,
            nz: 8,
            dx: 0.002,
            dt: 1e-4,
            tau,
            density,
            inletVelocity: [vx, 0, 0] as [number, number, number],
          };
          const bbox = cad.scadEval?.boundingBox;
          const obstacleBoxes: Array<{ min: [number, number, number]; max: [number, number, number] }> = [];
          if (bbox) {
            const spanX = Math.max(1e-4, Math.abs((bbox.max?.[0] ?? 1) - (bbox.min?.[0] ?? 0)));
            const spanY = Math.max(1e-4, Math.abs((bbox.max?.[1] ?? 1) - (bbox.min?.[1] ?? 0)));
            const spanZ = Math.max(1e-4, Math.abs((bbox.max?.[2] ?? 1) - (bbox.min?.[2] ?? 0)));
            const maxSpan = Math.max(spanX, spanY, spanZ);
            const hx = Math.min(0.3, Math.max(0.08, (spanX / maxSpan) * 0.35));
            const hy = Math.min(0.35, Math.max(0.08, (spanY / maxSpan) * 0.35));
            const hz = Math.min(0.35, Math.max(0.08, (spanZ / maxSpan) * 0.35));
            obstacleBoxes.push({
              min: [0.5 - hx, 0.5 - hy, 0.5 - hz],
              max: [0.5 + hx, 0.5 + hy, 0.5 + hz],
            });
          }
          const grid = providers.LbmVoxelizer.voxelize(cfg, { boxes: obstacleBoxes });
          const runner = new providers.WebGPULbmRunner(cfg, grid);
          const lbmOut = runner.step(20);
          coordinator.assertLiteral({
            predicate: "bound",
            args: [`${cfd.namespaceFqn}::pressure_drop_pa`, "==", lbmOut.pressureDropPa],
            domain: "constraint",
          });
        }
      } catch {
        // Non-fatal fallback
      }
    }
  }

  if (providers?.ToleranceStackVerifier && stepArtifacts.length > 0) {
    for (const stepArt of stepArtifacts) {
      const ents = stepArt.stepEntities ?? [];
      const tolByValueId = new Map<string, { upper: number; lower: number }>();
      const tolByTargetId = new Map<string, { upper: number; lower: number }>();
      let fallbackTol: { upper: number; lower: number } | undefined;

      for (const ent of ents) {
        const tUpper = ent.type.toUpperCase();
        if (tUpper.includes("TOLERANCE_VALUE")) {
          const nums = ent.args
            .split(",")
            .map((s) => Number.parseFloat(s.replace(/[^0-9eE+.-]/g, "")))
            .filter((n) => Number.isFinite(n));
          if (nums.length >= 2) {
            const upper = Math.max(nums[0]!, nums[1]!);
            const lower = Math.min(nums[0]!, nums[1]!);
            const rec = { upper, lower: lower > 0 ? -lower : lower };
            tolByValueId.set(ent.id.toUpperCase(), rec);
            fallbackTol ??= rec;
          }
        }
      }
      for (const ent of ents) {
        if (ent.type.toUpperCase().includes("PLUS_MINUS_TOLERANCE")) {
          const refs = ent.args.match(/#\d+/g) ?? [];
          if (refs.length >= 2) {
            const tolRec = tolByValueId.get(refs[0]!.toUpperCase()) ?? tolByValueId.get(refs[1]!.toUpperCase());
            if (tolRec) {
              tolByTargetId.set(refs[0]!.toUpperCase(), tolRec);
              tolByTargetId.set(refs[1]!.toUpperCase(), tolRec);
            }
          }
        }
      }

      const dims = Array.from(stepArt.parameters.values())
        .slice(0, 6)
        .map((p) => {
          const explicitTol = tolByTargetId.get(p.name.toUpperCase()) ?? fallbackTol;
          const synth = Math.max(0.01, Math.abs(p.value) * 0.01);
          return {
            name: p.name,
            nominal: p.value,
            upperTol: explicitTol ? explicitTol.upper : synth,
            lowerTol: explicitTol ? explicitTol.lower : -synth,
            direction: 1 as const,
          };
        });
      if (dims.length > 0) {
        try {
          providers.ToleranceStackVerifier.verify({
            name: stepArt.namespaceFqn,
            dimensions: dims,
          });
        } catch {
          // Non-fatal fallback
        }
      }
    }
  }

  // 7. Run Nelson-Oppen SAT fixpoint
  const satRes = coordinator.checkSat();
  if (!satRes.isSat && satRes.conflict) {
    conflicts.push(satRes.conflict);
    for (const art of artifacts) {
      if (art.requirements.length > 0) {
        conflictedFiles.add(art.index);
        paneDiagnostics[art.index]!.push({
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 12,
          severity: "error",
          code: "POLYGLOT_THEORY_CONFLICT",
          message: satRes.conflict.explanation,
        });
      }
    }
  }

  const isSat = conflicts.length === 0 && satRes.isSat;
  if (isSat) {
    hypergraph.recordTheorySat(threadSlot, satRes.sharedEqualities);
  } else if (conflicts[0]) {
    hypergraph.recordTheoryConflict(threadSlot, conflicts[0]);
  }
  artifacts.forEach((art, idx) => {
    const slot = artSlots[idx]!;
    if (conflictedFiles.has(art.index)) {
      hypergraph.recordTheoryConflict(slot, conflicts[0] ?? satRes.conflict!);
    } else {
      hypergraph.recordTheorySat(slot, satRes.sharedEqualities);
    }
  });

  // Compute surgical updatedCodes when editedFileIndex triggered writeback edits
  let updatedCodes: string[] | undefined;
  if (pendingEdits.size > 0) {
    updatedCodes = files.map((f, idx) => {
      const edits = pendingEdits.get(idx);
      if (!edits || edits.length === 0) return f.content;
      const sorted = [...edits].sort((a, b) => b.start - a.start);
      let out = f.content;
      for (const e of sorted) {
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
      }
      return out;
    });
  }

  const uniqueDomains = Array.from(new Set(artifacts.map((a) => a.domainName)));
  const hypergraphNodes: GenericHypergraphNode[] = artifacts.map((a) => ({
    paneIndex: a.index,
    fileName: a.fileName,
    uri: a.uri,
    lang: a.lang,
    formatLabel: a.lang.toUpperCase(),
    namespaceFqn: a.namespaceFqn,
    domainName: a.domainName,
    oracleName: DOMAIN_META[a.domain]?.oracle ?? "ConstraintTheoryOracle",
    status: conflictedFiles.has(a.index) ? "CONFLICT" : "SYNCED",
    distanceFromEdit: a.index === (options?.editedFileIndex ?? 0) ? 0 : 1,
  }));

  const elapsedMs = Math.max(
    0.1,
    Number(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0).toFixed(2)),
  );
  return {
    mode: "generic",
    scenarioId: "workspace-digital-thread",
    scenarioTitle: `${uniqueDomains.join(" + ")} (${artifacts.length} Files)`,
    status: isSat ? "SAT" : "UNSAT",
    isSat,
    elapsedMs,
    iterations: Math.max(1, satRes.iterations || 1),
    fileCount: artifacts.length,
    domains: uniqueDomains,
    artifacts: artifacts.map((a, idx) => ({
      index: a.index,
      fileName: a.fileName,
      uri: a.uri,
      lang: a.lang,
      domain: a.domainName,
      namespaceFqn: a.namespaceFqn,
      diagnostics: paneDiagnostics[idx]!,
    })),
    hypergraphNodes,
    variableLinks,
    portBindings,
    directiveLinks: allDirectives,
    sharedEqualities: satRes.sharedEqualities,
    conflicts,
    evaluatedEquations,
    updatedCodes: updatedCodes ?? files.map((f) => f.content),
    suggestedEdits,
    summaryText: isSat
      ? `SAT across ${artifacts.length} files (${uniqueDomains.join(" ↔ ")}) via ${variableLinks.length} linked parameter(s).`
      : `UNSAT: ${conflicts[0]?.explanation ?? "Cross-domain theory contradiction detected."}`,
  };
}
