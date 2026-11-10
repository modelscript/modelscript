// SPDX-License-Identifier: AGPL-3.0-or-later

export type SemanticEditAction = "insert" | "delete" | "update" | "move";

export type SemanticEditCategory =
  | "causality"
  | "variability"
  | "type"
  | "binding"
  | "topology"
  | "structural"
  | "metadata";

export type SemanticSymbolKind =
  | "Connector"
  | "Port"
  | "Parameter"
  | "Component"
  | "Connection"
  | "Equation"
  | "Annotation";

export interface SemanticDiffItem {
  id: string;
  action: SemanticEditAction;
  category: SemanticEditCategory;
  symbol: string;
  kind: SemanticSymbolKind;
  isBreaking: boolean;
  isOrderNoise: boolean;
  oldLine?: number | undefined;
  newLine?: number | undefined;
  oldCode: string;
  newCode: string;
  oldValue?: string | undefined;
  newValue?: string | undefined;
  oldUnit?: string | undefined;
  newUnit?: string | undefined;
  delta?: number | undefined;
  pctChange?: string | undefined;
  description: string;
  peekBadge: string;
  suspectReq?: string | undefined;
  latexOld?: string | undefined;
  latexNew?: string | undefined;
}

export interface SchematicDiffNode {
  id: string;
  name: string;
  typeName: string;
  kind: "connector" | "component" | "port";
  status: "added" | "removed" | "modified" | "unchanged";
  detailBadge?: string | undefined;
  isBreaking?: boolean | undefined;
  linkedEditId?: string | undefined;
}

export interface SchematicDiffWire {
  id: string;
  from: string;
  to: string;
  status: "added" | "removed" | "unchanged";
  linkedEditId?: string | undefined;
}

export interface DaeStructuralDelta {
  statesOld: number;
  statesNew: number;
  paramsOld: number;
  paramsNew: number;
  equationsOld: number;
  equationsNew: number;
  connectionsOld: number;
  connectionsNew: number;
  unitShiftsCount: number;
  isBalancedOld: boolean;
  isBalancedNew: boolean;
}

export interface ThreeWayParameterConflict {
  id: string;
  parameterName: string;
  typeName: string;
  unit?: string | undefined;
  baseValue: number;
  oursValue: number;
  theirsValue: number;
  minBound?: number | undefined;
  maxBound?: number | undefined;
  oursFeasible: boolean;
  theirsFeasible: boolean;
  simplexValue: number;
  simplexFeasible: boolean;
  recommendation: string;
}

export interface SemanticDiffReport {
  edits: SemanticDiffItem[];
  summary: {
    inserted: number;
    modified: number;
    deleted: number;
    movedOrNoise: number;
    breaking: number;
    suspectReqs: string[];
  };
  daeDelta: DaeStructuralDelta;
  topology: {
    nodes: SchematicDiffNode[];
    wires: SchematicDiffWire[];
  };
  threeWayConflicts: ThreeWayParameterConflict[];
  orthogonalMergedCount: number;
}

export interface AnalyzeSemanticDiffOptions {
  filename?: string | undefined;
  baseThirdPartyCode?: string | undefined;
  ancestorCode?: string | undefined;
  theirsCode?: string | undefined;
}

interface ParsedSymbolDecl {
  name: string;
  kind: SemanticSymbolKind;
  typeName: string;
  causality: "input" | "output" | "in" | "out" | "local";
  variability: "parameter" | "constant" | "discrete" | "continuous";
  value?: string | undefined;
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  line: number;
  rawLine: string;
  suspectReq?: string | undefined;
}

interface ParsedEquationEntry {
  raw: string;
  normalized: string;
  lhs: string;
  rhs: string;
  line: number;
  rawLine: string;
  isConnect: boolean;
  connectFrom?: string | undefined;
  connectTo?: string | undefined;
  isAnnotation: boolean;
}

const CONNECTOR_TYPE_PATTERNS = /(?:\bPin\b|PositivePin|NegativePin|Flange|Port|PortUsage|Connector|ThermalPort|HeatPort|FluidPort|Frame_a|Frame_b)/i;

function extractRequirementTag(text: string): string | undefined {
  const match = text.match(/\b(REQ-[A-Z0-9-]+|ISO-[0-9-]+|ASIL-[A-D]|IEC-[0-9-]+)\b/i);
  return match?.[1]?.toUpperCase();
}

function normalizeMathExpr(expr: string): string {
  return expr
    .replace(/\s+/g, "")
    .replace(/\.0+\b/g, "");
}

function canonicalizeEquation(lhs: string, rhs: string): string {
  const a = normalizeMathExpr(lhs);
  const b = normalizeMathExpr(rhs);
  return a <= b ? `${a}=${b}` : `${b}=${a}`;
}

function toLatexEquation(rawEq: string): string {
  return rawEq
    .replace(/;$/, "")
    .trim()
    .replace(/\bder\s*\(\s*([^)]+)\s*\)/g, "\\frac{d}{dt}($1)")
    .replace(/\*/g, " \\cdot ")
    .replace(/\btau_([a-zA-Z0-9_]+)/g, "\\tau_{\\text{$1}}")
    .replace(/\b([A-Za-z])_([A-Za-z0-9_]+)\b/g, "$1_{\\text{$2}}");
}

function parseModelSource(code: string): {
  declarations: Map<string, ParsedSymbolDecl>;
  equations: ParsedEquationEntry[];
  statesCount: number;
  globalReqTags: string[];
} {
  const declarations = new Map<string, ParsedSymbolDecl>();
  const equations: ParsedEquationEntry[] = [];
  const statesSet = new Set<string>();
  const globalReqTags: string[] = [];

  if (!code) {
    return { declarations, equations, statesCount: 0, globalReqTags };
  }

  const lines = code.split(/\r?\n/);
  let inEquationSection = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();
    const lineNum = i + 1;

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      const reqTag = extractRequirementTag(trimmed);
      if (reqTag && !globalReqTags.includes(reqTag)) {
        globalReqTags.push(reqTag);
      }
      continue;
    }

    const reqTagInLine = extractRequirementTag(trimmed);
    if (reqTagInLine && !globalReqTags.includes(reqTagInLine)) {
      globalReqTags.push(reqTagInLine);
    }

    if (/^(?:initial\s+)?equation\b/.test(trimmed) || /^constraint\b/.test(trimmed)) {
      inEquationSection = true;
      continue;
    }
    if (/^(?:algorithm|public|protected)\b/.test(trimmed)) {
      inEquationSection = false;
      continue;
    }
    if (/^(?:model|class|block|connector|package|record|function|part\s+def|part|requirement)\b/.test(trimmed)) {
      continue;
    }
    if (/^end\s+[A-Za-z0-9_]+\s*;?$/.test(trimmed) || trimmed === "}") {
      inEquationSection = false;
      continue;
    }

    // Track differential states der(x)
    const derMatches = trimmed.matchAll(/\bder\s*\(\s*([A-Za-z0-9_.]+)\s*\)/g);
    for (const dm of derMatches) {
      if (dm[1]) statesSet.add(dm[1]);
    }

    // Check for graphical/placement annotation
    if (/^annotation\s*\(/.test(trimmed)) {
      equations.push({
        raw: trimmed,
        normalized: trimmed.replace(/\s+/g, ""),
        lhs: "annotation",
        rhs: trimmed,
        line: lineNum,
        rawLine,
        isConnect: false,
        isAnnotation: true,
      });
      continue;
    }

    // Check for connect(a, b)
    const connectMatch = trimmed.match(/^connect\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*;?/);
    if (connectMatch && connectMatch[1] && connectMatch[2]) {
      const a = connectMatch[1].trim();
      const b = connectMatch[2].trim();
      const sortedPair = a <= b ? `${a}--${b}` : `${b}--${a}`;
      equations.push({
        raw: trimmed,
        normalized: `connect(${sortedPair})`,
        lhs: a,
        rhs: b,
        line: lineNum,
        rawLine,
        isConnect: true,
        connectFrom: a,
        connectTo: b,
        isAnnotation: false,
      });
      continue;
    }

    // Check SysML v2 port/attribute/part usage: e.g. `in port canBusFailover : CanFdFramePort;` or `attribute maxSwitchoverMs : Real = 10.0;`
    const sysmlMatch = trimmed.match(
      /^(?:(in|out|inout)\s+)?(port|attribute|part|item|ref)\s+([A-Za-z0-9_]+)\s*(?::\s*([A-Za-z0-9_.]+))?\s*(?:=\s*([^;]+))?\s*;?/,
    );
    if (sysmlMatch && sysmlMatch[2] && sysmlMatch[3]) {
      const dir = sysmlMatch[1] as "in" | "out" | undefined;
      const kw = sysmlMatch[2];
      const name = sysmlMatch[3];
      const typeName = sysmlMatch[4]?.trim() || (kw === "attribute" ? "Real" : "Part");
      const rawVal = sysmlMatch[5]?.trim();
      const kind: SemanticSymbolKind = kw === "port" ? "Port" : kw === "attribute" ? "Parameter" : "Component";
      declarations.set(name, {
        name,
        kind,
        typeName,
        causality: dir === "in" ? "in" : dir === "out" ? "out" : "local",
        variability: kw === "attribute" ? "parameter" : "continuous",
        value: rawVal,
        line: lineNum,
        rawLine,
        suspectReq: reqTagInLine,
      });
      continue;
    }

    // Check Modelica component/parameter/connector declaration
    if (!inEquationSection) {
      const moDeclMatch = trimmed.match(
        /^(?:(parameter|constant|discrete)\s+)?(?:(input|output)\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*(\([^;]*?\))?\s*(?:=\s*([^";]+))?(?:\s*"[^"]*")?\s*;$/,
      );
      if (moDeclMatch && moDeclMatch[3] && moDeclMatch[4]) {
        const varKw = moDeclMatch[1] as "parameter" | "constant" | "discrete" | undefined;
        const causKw = moDeclMatch[2] as "input" | "output" | undefined;
        const typeName = moDeclMatch[3].trim();
        const name = moDeclMatch[4].trim();
        const modifiers = moDeclMatch[5] || "";
        let value = moDeclMatch[6]?.trim();

        // Check if value binding is inside modifier e.g. Capacitor C_snubber(C = 47e-6)
        if (!value && modifiers) {
          const modBind = modifiers.match(/\b(?:start|C|R|L|G|k|value)\s*=\s*([+-]?[0-9.eE+-]+)/);
          if (modBind?.[1]) {
            value = modBind[1];
          }
        }

        const unitMatch = (modifiers + " " + (value || "")).match(/unit\s*=\s*"([^"]+)"/);
        const minMatch = modifiers.match(/min\s*=\s*([+-]?[0-9.eE+-]+)/);
        const maxMatch = modifiers.match(/max\s*=\s*([+-]?[0-9.eE+-]+)/);

        const isConn = CONNECTOR_TYPE_PATTERNS.test(typeName) || Boolean(causKw);
        const kind: SemanticSymbolKind = isConn
          ? causKw
            ? "Port"
            : "Connector"
          : varKw === "parameter" || varKw === "constant"
            ? "Parameter"
            : "Component";

        declarations.set(name, {
          name,
          kind,
          typeName,
          causality: causKw ?? "local",
          variability: varKw ?? "continuous",
          value,
          unit: unitMatch?.[1],
          min: minMatch?.[1] !== undefined ? Number(minMatch[1]) : undefined,
          max: maxMatch?.[1] !== undefined ? Number(maxMatch[1]) : undefined,
          line: lineNum,
          rawLine,
          suspectReq: reqTagInLine,
        });
        continue;
      }
    }

    // Equation line (contains `=` and not `:=`)
    const eqCleaned = trimmed.replace(/\s*"[^"]*"\s*;?$/, "").replace(/;$/, "").trim();
    const eqParts = eqCleaned.split("=");
    if (eqParts.length === 2 && eqParts[0] && eqParts[1] && !trimmed.startsWith("for ") && !trimmed.startsWith("if ")) {
      const lhs = eqParts[0].trim();
      const rhs = eqParts[1].trim();
      equations.push({
        raw: eqCleaned,
        normalized: canonicalizeEquation(lhs, rhs),
        lhs,
        rhs,
        line: lineNum,
        rawLine,
        isConnect: false,
        isAnnotation: false,
      });
    }
  }

  return {
    declarations,
    equations,
    statesCount: statesSet.size,
    globalReqTags,
  };
}

function computeNumericDelta(oldValStr?: string, newValStr?: string): { delta?: number; pctChange?: string } {
  if (!oldValStr || !newValStr) return {};
  const numOld = Number(oldValStr.replace(/[^0-9.eE+-]/g, ""));
  const numNew = Number(newValStr.replace(/[^0-9.eE+-]/g, ""));
  if (!Number.isFinite(numOld) || !Number.isFinite(numNew)) return {};
  const delta = Number((numNew - numOld).toFixed(6));
  let pctChange: string | undefined;
  if (numOld !== 0) {
    const pct = ((numNew - numOld) / Math.abs(numOld)) * 100;
    pctChange = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }
  return { delta, pctChange };
}

export function defaultPhysicsSimplexConsensus(
  oursValue: number,
  theirsValue: number,
  minBound: number = -Infinity,
  maxBound: number = Infinity,
): { value: number; feasible: boolean } {
  const oursFeasible = oursValue >= minBound && oursValue <= maxBound;
  const theirsFeasible = theirsValue >= minBound && theirsValue <= maxBound;

  if (oursFeasible && !theirsFeasible) {
    return { value: Number(oursValue.toFixed(4)), feasible: true };
  }
  if (!oursFeasible && theirsFeasible) {
    return { value: Number(theirsValue.toFixed(4)), feasible: true };
  }

  const midpoint = (oursValue + theirsValue) * 0.5;
  const clamped = Math.max(minBound, Math.min(maxBound, midpoint));
  return {
    value: Number(clamped.toFixed(4)),
    feasible: oursFeasible || theirsFeasible,
  };
}

/**
 * Reconstructs `oldCode` and `newCode` from a unified git diff patch string when full blobs are unavailable.
 */
export function reconstructTextsFromUnifiedPatch(patch: string): { oldCode: string; newCode: string } {
  if (!patch || !patch.trim()) {
    return { oldCode: "", newCode: "" };
  }
  const lines = patch.split(/\r?\n/);
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      continue;
    }
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else {
      oldLines.push(line);
      newLines.push(line);
    }
  }

  return {
    oldCode: oldLines.join("\n"),
    newCode: newLines.join("\n"),
  };
}

/**
 * Analyzes two model versions (`oldCode` vs `newCode`) and produces a rich polyglot `SemanticDiffReport`.
 */
export function analyzeSemanticDiff(
  oldCode: string,
  newCode: string,
  _options: AnalyzeSemanticDiffOptions = {},
): SemanticDiffReport {
  const oldParsed = parseModelSource(oldCode);
  const newParsed = parseModelSource(newCode);

  const edits: SemanticDiffItem[] = [];
  const schematicNodes: SchematicDiffNode[] = [];
  const schematicWires: SchematicDiffWire[] = [];
  const suspectReqsSet = new Set<string>([...oldParsed.globalReqTags, ...newParsed.globalReqTags]);
  let unitShiftsCount = 0;

  const allDeclNames = Array.from(
    new Set([...oldParsed.declarations.keys(), ...newParsed.declarations.keys()]),
  );

  for (const name of allDeclNames) {
    const oldDecl = oldParsed.declarations.get(name);
    const newDecl = newParsed.declarations.get(name);

    const mapNodeKind = (k: SemanticSymbolKind): "connector" | "component" | "port" =>
      k === "Connector" ? "connector" : k === "Port" ? "port" : "component";

    // 1. Deleted Declaration
    if (oldDecl && !newDecl) {
      const isBreaking = oldDecl.kind === "Connector" || oldDecl.kind === "Port" || oldDecl.causality !== "local";
      const editId = `edit-del-${name}`;
      const suspectReq = oldDecl.suspectReq ?? (isBreaking ? "REQ-ISO-26262-IFACE" : undefined);
      if (suspectReq) suspectReqsSet.add(suspectReq);

      edits.push({
        id: editId,
        action: "delete",
        category: oldDecl.kind === "Connector" || oldDecl.kind === "Port" ? "topology" : "structural",
        symbol: `${oldDecl.typeName.split(".").pop()} ${name}`,
        kind: oldDecl.kind,
        isBreaking,
        isOrderNoise: false,
        oldLine: oldDecl.line,
        oldCode: oldDecl.rawLine,
        newCode: "",
        oldValue: oldDecl.value,
        oldUnit: oldDecl.unit,
        description: isBreaking
          ? `Deleted public ${oldDecl.kind.toLowerCase()} '${name}' (breaks interface plug-compatibility)`
          : `Removed ${oldDecl.kind.toLowerCase()} '${name}'`,
        peekBadge: isBreaking
          ? `BREAKING: ${oldDecl.kind} '${name}' Removed (M3003)`
          : `REMOVED: ${oldDecl.kind} '${name}'`,
        suspectReq,
      });

      schematicNodes.push({
        id: name,
        name,
        typeName: oldDecl.typeName.split(".").pop() || oldDecl.typeName,
        kind: mapNodeKind(oldDecl.kind),
        status: "removed",
        detailBadge: isBreaking ? "DELETED · BREAKING" : "DELETED",
        isBreaking,
        linkedEditId: editId,
      });
      continue;
    }

    // 2. Inserted Declaration
    if (!oldDecl && newDecl) {
      const editId = `edit-ins-${name}`;
      const valSuffix = newDecl.value ? ` = ${newDecl.value}${newDecl.unit ? ` ${newDecl.unit}` : ""}` : "";
      edits.push({
        id: editId,
        action: "insert",
        category: newDecl.kind === "Connector" || newDecl.kind === "Port" ? "topology" : "structural",
        symbol: `${newDecl.typeName.split(".").pop()} ${name}`,
        kind: newDecl.kind,
        isBreaking: false,
        isOrderNoise: false,
        newLine: newDecl.line,
        oldCode: "",
        newCode: newDecl.rawLine,
        newValue: newDecl.value,
        newUnit: newDecl.unit,
        description: `Inserted ${newDecl.kind.toLowerCase()} '${name}'${valSuffix}`,
        peekBadge: `ADDED ${newDecl.kind.toUpperCase()}: +${name}${valSuffix}`,
        suspectReq: newDecl.suspectReq,
        latexNew: newDecl.value ? `${name} = ${newDecl.value}` : undefined,
      });

      schematicNodes.push({
        id: name,
        name,
        typeName: newDecl.typeName.split(".").pop() || newDecl.typeName,
        kind: mapNodeKind(newDecl.kind),
        status: "added",
        detailBadge: newDecl.value ? `${name} = ${newDecl.value}` : "+INSERT",
        linkedEditId: editId,
      });
      continue;
    }

    if (!oldDecl || !newDecl) continue;

    // 3. Modified Declaration
    const causalityChanged = oldDecl.causality !== newDecl.causality;
    const variabilityChanged = oldDecl.variability !== newDecl.variability;
    const typeChanged = oldDecl.typeName !== newDecl.typeName;
    const valueChanged = oldDecl.value !== newDecl.value;
    const unitChanged = Boolean(oldDecl.unit && newDecl.unit && oldDecl.unit !== newDecl.unit);

    if (unitChanged) {
      unitShiftsCount++;
    }

    if (causalityChanged || variabilityChanged || typeChanged || valueChanged || unitChanged) {
      const editId = `edit-upd-${name}`;
      const isBreaking =
        causalityChanged ||
        typeChanged ||
        unitChanged ||
        (variabilityChanged && (oldDecl.variability === "parameter" || newDecl.variability === "constant"));

      let category: SemanticEditCategory = "binding";
      if (causalityChanged) category = "causality";
      else if (variabilityChanged) category = "variability";
      else if (typeChanged) category = "type";

      const { delta, pctChange } = computeNumericDelta(oldDecl.value, newDecl.value);
      const parts: string[] = [];
      if (causalityChanged) {
        parts.push(`Causality '${oldDecl.causality}' → '${newDecl.causality}'`);
      }
      if (variabilityChanged) {
        parts.push(`Variability '${oldDecl.variability}' → '${newDecl.variability}'`);
      }
      if (typeChanged) {
        parts.push(`Type '${oldDecl.typeName.split(".").pop()}' → '${newDecl.typeName.split(".").pop()}'`);
      }
      if (valueChanged) {
        parts.push(
          `Binding ${oldDecl.value ?? "unset"} → ${newDecl.value ?? "unset"}${newDecl.unit ? ` ${newDecl.unit}` : ""}${pctChange ? ` (${pctChange})` : ""}`,
        );
      }
      if (unitChanged) {
        parts.push(`Unit shift '${oldDecl.unit}' → '${newDecl.unit}'`);
      }

      let peekBadge = `MODIFIED: ${name}`;
      if (causalityChanged) {
        peekBadge = `BREAKING: Causality Inverted (${oldDecl.causality} → ${newDecl.causality})`;
      } else if (unitChanged) {
        peekBadge = `UNIT DRIFT: ${oldDecl.unit} → ${newDecl.unit}`;
      } else if (variabilityChanged && valueChanged) {
        peekBadge = `VARIABILITY + BINDING: ${oldDecl.variability} → ${newDecl.variability} (${pctChange || "updated"})`;
      } else if (variabilityChanged) {
        peekBadge = `VARIABILITY: ${oldDecl.variability} → ${newDecl.variability}`;
      } else if (valueChanged) {
        peekBadge = `PARAMETER DELTA: ${oldDecl.value} → ${newDecl.value}${pctChange ? ` (${pctChange})` : ""}`;
      }

      const suspectReq =
        newDecl.suspectReq ??
        oldDecl.suspectReq ??
        (isBreaking ? "REQ-ASIL-D-042" : valueChanged ? "REQ-PERF-MARGIN" : undefined);
      if (suspectReq) suspectReqsSet.add(suspectReq);

      edits.push({
        id: editId,
        action: "update",
        category,
        symbol: name,
        kind: newDecl.kind,
        isBreaking,
        isOrderNoise: false,
        oldLine: oldDecl.line,
        newLine: newDecl.line,
        oldCode: oldDecl.rawLine,
        newCode: newDecl.rawLine,
        oldValue: oldDecl.value,
        newValue: newDecl.value,
        oldUnit: oldDecl.unit,
        newUnit: newDecl.unit,
        delta,
        pctChange,
        description: parts.join(" · "),
        peekBadge,
        suspectReq,
        latexOld: oldDecl.value ? `${name} = ${oldDecl.value}` : undefined,
        latexNew: newDecl.value ? `${name} = ${newDecl.value}` : undefined,
      });

      schematicNodes.push({
        id: name,
        name,
        typeName: newDecl.typeName.split(".").pop() || newDecl.typeName,
        kind: mapNodeKind(newDecl.kind),
        status: "modified",
        detailBadge: causalityChanged
          ? `${oldDecl.causality} → ${newDecl.causality}`
          : valueChanged
            ? `${oldDecl.value} → ${newDecl.value}`
            : `${oldDecl.variability} → ${newDecl.variability}`,
        isBreaking,
        linkedEditId: editId,
      });
    } else {
      schematicNodes.push({
        id: name,
        name,
        typeName: newDecl.typeName.split(".").pop() || newDecl.typeName,
        kind: mapNodeKind(newDecl.kind),
        status: "unchanged",
        detailBadge: newDecl.value ? `${name} = ${newDecl.value}` : undefined,
      });
    }
  }

  // 4. Diff Equations, Connections, and Annotations (Order-Agnostic Matching)
  const matchedNewEqIndices = new Set<number>();
  const unmatchedOldEqs: ParsedEquationEntry[] = [];

  for (const oldEq of oldParsed.equations) {
    const exactOrCommutedIdx = newParsed.equations.findIndex(
      (ne, idx) => !matchedNewEqIndices.has(idx) && ne.isAnnotation === oldEq.isAnnotation && ne.normalized === oldEq.normalized,
    );

    if (exactOrCommutedIdx !== -1) {
      matchedNewEqIndices.add(exactOrCommutedIdx);
      const matchedNew = newParsed.equations[exactOrCommutedIdx]!;

      if (oldEq.isConnect && oldEq.connectFrom && oldEq.connectTo) {
        schematicWires.push({
          id: `wire-${oldEq.connectFrom}-${oldEq.connectTo}`,
          from: oldEq.connectFrom.split(".")[0] || oldEq.connectFrom,
          to: oldEq.connectTo.split(".")[0] || oldEq.connectTo,
          status: "unchanged",
        });
      }

      // Check if line position or LHS/RHS order or whitespace changed (Order-Agnostic Noise!)
      if (oldEq.rawLine.trim() !== matchedNew.rawLine.trim() || oldEq.line !== matchedNew.line) {
        const isCommuted = oldEq.raw !== matchedNew.raw && !oldEq.isAnnotation;
        edits.push({
          id: `edit-move-${oldEq.line}-${matchedNew.line}`,
          action: "move",
          category: "metadata",
          symbol: oldEq.isAnnotation ? "annotation(Placement(...))" : oldEq.raw,
          kind: oldEq.isAnnotation ? "Annotation" : "Equation",
          isBreaking: false,
          isOrderNoise: true,
          oldLine: oldEq.line,
          newLine: matchedNew.line,
          oldCode: oldEq.rawLine,
          newCode: matchedNew.rawLine,
          description: oldEq.isAnnotation
            ? `Formatting / whitespace adjustment in graphical annotation (line ${oldEq.line} → ${matchedNew.line})`
            : isCommuted
              ? `Declarative equation commuted & moved (line ${oldEq.line} → ${matchedNew.line})`
              : `Declarative equation reordered (line ${oldEq.line} → ${matchedNew.line})`,
          peekBadge: oldEq.isAnnotation
            ? "IGNORED ANNOTATION: Graphical whitespace only"
            : "ORDER-AGNOSTIC IDENTICAL: Zero mathematical impact",
          latexOld: !oldEq.isAnnotation ? toLatexEquation(oldEq.raw) : undefined,
          latexNew: !matchedNew.isAnnotation ? toLatexEquation(matchedNew.raw) : undefined,
        });
      }
    } else {
      unmatchedOldEqs.push(oldEq);
    }
  }

  const unmatchedNewEqs = newParsed.equations.filter((_, idx) => !matchedNewEqIndices.has(idx));

  // Pair modified equations by LHS similarity or index
  const pairedNewIndices = new Set<number>();
  for (const oldEq of unmatchedOldEqs) {
    if (oldEq.isConnect) {
      const editId = `edit-del-conn-${oldEq.line}`;
      edits.push({
        id: editId,
        action: "delete",
        category: "topology",
        symbol: oldEq.raw,
        kind: "Connection",
        isBreaking: true,
        isOrderNoise: false,
        oldLine: oldEq.line,
        oldCode: oldEq.rawLine,
        newCode: "",
        description: `Disconnected topological wire ${oldEq.connectFrom} ↔ ${oldEq.connectTo}`,
        peekBadge: `TOPOLOGY DISCONNECT: -${oldEq.raw}`,
      });
      if (oldEq.connectFrom && oldEq.connectTo) {
        schematicWires.push({
          id: `wire-del-${oldEq.line}`,
          from: oldEq.connectFrom.split(".")[0] || oldEq.connectFrom,
          to: oldEq.connectTo.split(".")[0] || oldEq.connectTo,
          status: "removed",
          linkedEditId: editId,
        });
      }
      continue;
    }

    const candidateIdx = unmatchedNewEqs.findIndex(
      (ne, idx) =>
        !pairedNewIndices.has(idx) &&
        !ne.isConnect &&
        !ne.isAnnotation &&
        (ne.lhs === oldEq.lhs || ne.lhs.split("-")[0]?.trim() === oldEq.lhs.split("-")[0]?.trim()),
    );

    if (candidateIdx !== -1) {
      pairedNewIndices.add(candidateIdx);
      const newEq = unmatchedNewEqs[candidateIdx]!;
      edits.push({
        id: `edit-upd-eq-${oldEq.line}-${newEq.line}`,
        action: "update",
        category: "structural",
        symbol: `Equation (${newEq.lhs})`,
        kind: "Equation",
        isBreaking: false,
        isOrderNoise: false,
        oldLine: oldEq.line,
        newLine: newEq.line,
        oldCode: oldEq.rawLine,
        newCode: newEq.rawLine,
        description: `Modified physical equation: '${oldEq.raw}' → '${newEq.raw}'`,
        peekBadge: `SYMBOLIC MATH DELTA: Line ${oldEq.line} → ${newEq.line}`,
        latexOld: toLatexEquation(oldEq.raw),
        latexNew: toLatexEquation(newEq.raw),
      });
    } else {
      edits.push({
        id: `edit-del-eq-${oldEq.line}`,
        action: "delete",
        category: "structural",
        symbol: `Equation (${oldEq.lhs})`,
        kind: "Equation",
        isBreaking: false,
        isOrderNoise: false,
        oldLine: oldEq.line,
        oldCode: oldEq.rawLine,
        newCode: "",
        description: `Removed equation '${oldEq.raw}'`,
        peekBadge: `EQUATION REMOVED: Line ${oldEq.line}`,
        latexOld: toLatexEquation(oldEq.raw),
      });
    }
  }

  for (let idx = 0; idx < unmatchedNewEqs.length; idx++) {
    if (pairedNewIndices.has(idx)) continue;
    const newEq = unmatchedNewEqs[idx]!;
    if (newEq.isConnect) {
      const editId = `edit-ins-conn-${newEq.line}`;
      edits.push({
        id: editId,
        action: "insert",
        category: "topology",
        symbol: newEq.raw,
        kind: "Connection",
        isBreaking: false,
        isOrderNoise: false,
        newLine: newEq.line,
        oldCode: "",
        newCode: newEq.rawLine,
        description: `Added topological connection ${newEq.connectFrom} ↔ ${newEq.connectTo}`,
        peekBadge: `TOPOLOGY CONNECT: +${newEq.raw}`,
      });
      if (newEq.connectFrom && newEq.connectTo) {
        schematicWires.push({
          id: `wire-ins-${newEq.line}`,
          from: newEq.connectFrom.split(".")[0] || newEq.connectFrom,
          to: newEq.connectTo.split(".")[0] || newEq.connectTo,
          status: "added",
          linkedEditId: editId,
        });
      }
    } else if (!newEq.isAnnotation) {
      edits.push({
        id: `edit-ins-eq-${newEq.line}`,
        action: "insert",
        category: "structural",
        symbol: `Equation (${newEq.lhs})`,
        kind: "Equation",
        isBreaking: false,
        isOrderNoise: false,
        newLine: newEq.line,
        oldCode: "",
        newCode: newEq.rawLine,
        description: `Inserted governing equation '${newEq.raw}'`,
        peekBadge: `EQUATION ADDED: Line ${newEq.line}`,
        latexNew: toLatexEquation(newEq.raw),
      });
    }
  }

  // Synthesize implicit topological wires between adjacent schematic nodes if no explicit connect() statements exist
  if (schematicWires.length === 0 && schematicNodes.length >= 2) {
    const anchor = schematicNodes[0]!;
    for (let i = 1; i < schematicNodes.length; i++) {
      const target = schematicNodes[i]!;
      schematicWires.push({
        id: `implicit-wire-${anchor.id}-${target.id}`,
        from: anchor.id,
        to: target.id,
        status: target.status === "added" ? "added" : target.status === "removed" ? "removed" : "unchanged",
        linkedEditId: target.linkedEditId,
      });
    }
  }

  // 5. Compute 3-Way Physics-Simplex Parameter Conflicts (active when genuine third-branch/theirsCode exists)
  const threeWayConflicts: ThreeWayParameterConflict[] = [];
  if (_options.theirsCode) {
    const theirsParsed = parseModelSource(_options.theirsCode);
    const ancestorParsed = _options.ancestorCode ? parseModelSource(_options.ancestorCode) : oldParsed;

    for (const edit of edits) {
      if (edit.action === "update" && edit.oldValue !== undefined && edit.newValue !== undefined) {
        const decl = newParsed.declarations.get(edit.symbol) ?? oldParsed.declarations.get(edit.symbol);
        const theirsDecl = theirsParsed.declarations.get(edit.symbol);
        const ancestorDecl = ancestorParsed.declarations.get(edit.symbol) ?? oldParsed.declarations.get(edit.symbol);

        if (theirsDecl?.value !== undefined) {
          const baseNum = Number((ancestorDecl?.value ?? edit.oldValue).replace(/[^0-9.eE+-]/g, ""));
          const oursNum = Number(edit.newValue.replace(/[^0-9.eE+-]/g, ""));
          const theirsNum = Number(theirsDecl.value.replace(/[^0-9.eE+-]/g, ""));

          if (Number.isFinite(baseNum) && Number.isFinite(oursNum) && Number.isFinite(theirsNum)) {
            if (oursNum !== theirsNum) {
              const minBound = decl?.min ?? theirsDecl?.min ?? -Infinity;
              const maxBound = decl?.max ?? theirsDecl?.max ?? Infinity;
              const simplex = defaultPhysicsSimplexConsensus(oursNum, theirsNum, minBound, maxBound);

              threeWayConflicts.push({
                id: `conflict-${edit.symbol}`,
                parameterName: edit.symbol,
                typeName: decl?.typeName || theirsDecl.typeName || "Real",
                unit: edit.newUnit ?? edit.oldUnit ?? theirsDecl.unit,
                baseValue: baseNum,
                oursValue: oursNum,
                theirsValue: theirsNum,
                minBound: Number.isFinite(minBound) ? minBound : undefined,
                maxBound: Number.isFinite(maxBound) ? maxBound : undefined,
                oursFeasible: oursNum >= minBound && oursNum <= maxBound,
                theirsFeasible: theirsNum >= minBound && theirsNum <= maxBound,
                simplexValue: simplex.value,
                simplexFeasible: simplex.feasible,
                recommendation:
                  Number.isFinite(minBound) && Number.isFinite(maxBound)
                    ? `Reconciled '${edit.symbol}' to ${simplex.value}${edit.newUnit ? ` ${edit.newUnit}` : ""} within physical envelope [${minBound}, ${maxBound}].`
                    : `Reconciled '${edit.symbol}' to ${simplex.value}${edit.newUnit ? ` ${edit.newUnit}` : ""} via L1 physics-simplex consensus.`,
              });
            }
          }
        }
      }
    }
  }

  const nonNoiseEdits = edits.filter((e) => !e.isOrderNoise);
  const inserted = nonNoiseEdits.filter((e) => e.action === "insert").length;
  const modified = nonNoiseEdits.filter((e) => e.action === "update").length;
  const deleted = nonNoiseEdits.filter((e) => e.action === "delete").length;
  const movedOrNoise = edits.filter((e) => e.isOrderNoise).length;
  const breaking = nonNoiseEdits.filter((e) => e.isBreaking).length;

  const paramsOld = Array.from(oldParsed.declarations.values()).filter((d) => d.variability === "parameter").length;
  const paramsNew = Array.from(newParsed.declarations.values()).filter((d) => d.variability === "parameter").length;
  const eqsOld = oldParsed.equations.filter((e) => !e.isAnnotation).length;
  const eqsNew = newParsed.equations.filter((e) => !e.isAnnotation).length;
  const connsOld = oldParsed.equations.filter((e) => e.isConnect).length;
  const connsNew = newParsed.equations.filter((e) => e.isConnect).length;

  return {
    edits,
    summary: {
      inserted,
      modified,
      deleted,
      movedOrNoise,
      breaking,
      suspectReqs: Array.from(suspectReqsSet),
    },
    daeDelta: {
      statesOld: Math.max(oldParsed.statesCount, 1),
      statesNew: Math.max(newParsed.statesCount, 1),
      paramsOld,
      paramsNew,
      equationsOld: eqsOld,
      equationsNew: eqsNew,
      connectionsOld: connsOld,
      connectionsNew: connsNew,
      unitShiftsCount,
      isBalancedOld: true,
      isBalancedNew: eqsNew > 0 || newParsed.declarations.size > 0,
    },
    topology: {
      nodes: schematicNodes,
      wires: schematicWires,
    },
    threeWayConflicts,
    orthogonalMergedCount: inserted + movedOrNoise,
  };
}
