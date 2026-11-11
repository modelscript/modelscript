// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import React, { useMemo, useState } from "react";
import { indexLocalSymbolLines, scanModelicaStructure } from "../modelica-scanner.js";

export interface DaeAdvancedInspectorProps {
  code: string;
  sourceCode?: string | undefined;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

// 7-tuple SI dimension vector: [M (kg), L (m), T (s), I (A), Θ (K), N (mol), J (cd)]
type DimVec = readonly [number, number, number, number, number, number, number];

const ZERO_DIM: DimVec = [0, 0, 0, 0, 0, 0, 0];

const KNOWN_UNITS: Record<string, DimVec> = {
  "1": [0, 0, 0, 0, 0, 0, 0],
  rad: [0, 0, 0, 0, 0, 0, 0],
  deg: [0, 0, 0, 0, 0, 0, 0],
  "%": [0, 0, 0, 0, 0, 0, 0],
  kg: [1, 0, 0, 0, 0, 0, 0],
  g: [1, 0, 0, 0, 0, 0, 0],
  m: [0, 1, 0, 0, 0, 0, 0],
  mm: [0, 1, 0, 0, 0, 0, 0],
  cm: [0, 1, 0, 0, 0, 0, 0],
  km: [0, 1, 0, 0, 0, 0, 0],
  s: [0, 0, 1, 0, 0, 0, 0],
  ms: [0, 0, 1, 0, 0, 0, 0],
  h: [0, 0, 1, 0, 0, 0, 0],
  Hz: [0, 0, -1, 0, 0, 0, 0],
  A: [0, 0, 0, 1, 0, 0, 0],
  mA: [0, 0, 0, 1, 0, 0, 0],
  kA: [0, 0, 0, 1, 0, 0, 0],
  K: [0, 0, 0, 0, 1, 0, 0],
  degC: [0, 0, 0, 0, 1, 0, 0],
  mol: [0, 0, 0, 0, 0, 1, 0],
  cd: [0, 0, 0, 0, 0, 0, 1],
  N: [1, 1, -2, 0, 0, 0, 0],
  kN: [1, 1, -2, 0, 0, 0, 0],
  Pa: [1, -1, -2, 0, 0, 0, 0],
  kPa: [1, -1, -2, 0, 0, 0, 0],
  MPa: [1, -1, -2, 0, 0, 0, 0],
  bar: [1, -1, -2, 0, 0, 0, 0],
  J: [1, 2, -2, 0, 0, 0, 0],
  kJ: [1, 2, -2, 0, 0, 0, 0],
  W: [1, 2, -3, 0, 0, 0, 0],
  kW: [1, 2, -3, 0, 0, 0, 0],
  MW: [1, 2, -3, 0, 0, 0, 0],
  C: [0, 0, 1, 1, 0, 0, 0],
  V: [1, 2, -3, -1, 0, 0, 0],
  kV: [1, 2, -3, -1, 0, 0, 0],
  Ohm: [1, 2, -3, -2, 0, 0, 0],
  Ω: [1, 2, -3, -2, 0, 0, 0],
  S: [-1, -2, 3, 2, 0, 0, 0],
  F: [-1, -2, 4, 2, 0, 0, 0],
  uF: [-1, -2, 4, 2, 0, 0, 0],
  H: [1, 2, -2, -2, 0, 0, 0],
  mH: [1, 2, -2, -2, 0, 0, 0],
  Wb: [1, 2, -2, -1, 0, 0, 0],
  T: [1, 0, -2, -1, 0, 0, 0],
};

const TYPE_DEFAULT_UNITS: Record<string, string> = {
  Voltage: "V",
  ElectricPotential: "V",
  Current: "A",
  ElectricCurrent: "A",
  Resistance: "Ohm",
  Conductance: "S",
  Capacitance: "F",
  Inductance: "H",
  Frequency: "Hz",
  Time: "s",
  Length: "m",
  Position: "m",
  Distance: "m",
  Velocity: "m/s",
  Acceleration: "m/s2",
  Angle: "rad",
  AngularVelocity: "rad/s",
  AngularAcceleration: "rad/s2",
  Mass: "kg",
  Force: "N",
  Torque: "N.m",
  MomentOfInertia: "kg.m2",
  Inertia: "kg.m2",
  Pressure: "Pa",
  AbsolutePressure: "Pa",
  Temperature: "K",
  ThermodynamicTemperature: "K",
  Power: "W",
  HeatFlowRate: "W",
  Energy: "J",
  MassFlowRate: "kg/s",
  VolumeFlowRate: "m3/s",
  Area: "m2",
  Volume: "m3",
  Density: "kg/m3",
};

function addDim(a: DimVec, b: DimVec, scale = 1): DimVec {
  return [
    a[0] + b[0] * scale,
    a[1] + b[1] * scale,
    a[2] + b[2] * scale,
    a[3] + b[3] * scale,
    a[4] + b[4] * scale,
    a[5] + b[5] * scale,
    a[6] + b[6] * scale,
  ];
}

function sameDim(a: DimVec, b: DimVec): boolean {
  for (let i = 0; i < 7; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-6) return false;
  }
  return true;
}

function formatDim(d: DimVec): string {
  const symbols = ["kg", "m", "s", "A", "K", "mol", "cd"];
  const num: string[] = [];
  const den: string[] = [];
  for (let i = 0; i < 7; i++) {
    const exp = d[i]!;
    if (exp > 0) num.push(exp === 1 ? symbols[i]! : `${symbols[i]}^${exp}`);
    else if (exp < 0) den.push(exp === -1 ? symbols[i]! : `${symbols[i]}^${-exp}`);
  }
  if (num.length === 0 && den.length === 0) return "1";
  const lhs = num.length > 0 ? num.join("·") : "1";
  return den.length > 0 ? `${lhs}/${den.join("·")}` : lhs;
}

function parseUnitString(unitStr: string): DimVec | null {
  const clean = unitStr.trim();
  if (!clean) return null;
  if (KNOWN_UNITS[clean]) return KNOWN_UNITS[clean]!;

  const slashParts = clean.split("/");
  if (slashParts.length > 2) return null;

  const parseProduct = (seg: string): DimVec | null => {
    const trimmed = seg.trim().replace(/^\(|\)$/g, "");
    if (!trimmed || trimmed === "1") return ZERO_DIM;
    const factors = trimmed.split(/[.*·\s]+/).filter(Boolean);
    let acc: DimVec = ZERO_DIM;
    for (const f of factors) {
      const m = /^([A-Za-zΩ%]+)(?:\^?(-?\d+))?$/.exec(f);
      if (!m) return null;
      const base = KNOWN_UNITS[m[1]!];
      if (!base) return null;
      const exp = m[2] !== undefined ? Number(m[2]) : 1;
      acc = addDim(acc, base, exp);
    }
    return acc;
  };

  const num = parseProduct(slashParts[0]!);
  if (!num) return null;
  if (slashParts.length === 1) return num;
  const den = parseProduct(slashParts[1]!);
  if (!den) return null;
  return addDim(num, den, -1);
}

interface ExprDimResult {
  dim: DimVec | null;
  conflict: boolean;
}

function inferExprDim(expr: string, varDims: Map<string, DimVec>): ExprDimResult {
  // Lightweight recursive-descent dimensional evaluator over +, -, *, /, ^, der(...)
  const tokens: string[] = [];
  let idx = 0;
  while (idx < expr.length) {
    const ch = expr[idx]!;
    if (/\s/.test(ch)) {
      idx++;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push(ch);
      idx++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(expr[idx + 1] ?? ""))) {
      const start = idx;
      idx++;
      while (idx < expr.length && /[0-9.]/.test(expr[idx]!)) idx++;
      if (idx < expr.length && (expr[idx] === "e" || expr[idx] === "E")) {
        idx++;
        if (expr[idx] === "+" || expr[idx] === "-") idx++;
        while (idx < expr.length && /[0-9]/.test(expr[idx]!)) idx++;
      }
      tokens.push(expr.slice(start, idx));
      continue;
    }
    if (ch === "'") {
      const start = idx;
      idx++;
      while (idx < expr.length && expr[idx] !== "'") {
        if (expr[idx] === "\\") idx++;
        idx++;
      }
      if (idx < expr.length) idx++;
      tokens.push(expr.slice(start, idx));
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = idx;
      idx++;
      while (idx < expr.length) {
        const c = expr[idx]!;
        if (/[A-Za-z0-9_.]/.test(c)) {
          idx++;
        } else if (c === "[") {
          let depth = 1;
          idx++;
          while (idx < expr.length && depth > 0) {
            if (expr[idx] === "[") depth++;
            else if (expr[idx] === "]") depth--;
            idx++;
          }
        } else {
          break;
        }
      }
      tokens.push(expr.slice(start, idx));
      continue;
    }
    idx++;
  }

  let pos = 0;
  let hasKnownVar = false;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseAdd = (): ExprDimResult => {
    let left = parseMul();
    while (peek() === "+" || peek() === "-") {
      consume();
      const right = parseMul();
      if (left.conflict || right.conflict) return { dim: null, conflict: true };
      if (left.dim && right.dim) {
        // Ignore pure zero literal on one side of +/-
        if (!sameDim(left.dim, right.dim)) {
          return { dim: null, conflict: true };
        }
      } else if (!left.dim && right.dim) {
        left = right;
      }
    }
    return left;
  };

  const parseMul = (): ExprDimResult => {
    let left = parsePow();
    while (peek() === "*" || peek() === "/") {
      const op = consume()!;
      const right = parsePow();
      if (left.conflict || right.conflict) return { dim: null, conflict: true };
      if (left.dim && right.dim) {
        left = { dim: addDim(left.dim, right.dim, op === "*" ? 1 : -1), conflict: false };
      } else {
        left = { dim: null, conflict: false };
      }
    }
    return left;
  };

  const parsePow = (): ExprDimResult => {
    const base = parseUnary();
    if (peek() === "^") {
      consume();
      let sign = 1;
      if (peek() === "-") {
        consume();
        sign = -1;
      } else if (peek() === "+") {
        consume();
      }
      const expTok = consume();
      const expVal = expTok !== undefined ? Number(expTok) * sign : NaN;
      if (base.conflict) return base;
      if (base.dim && Number.isFinite(expVal)) {
        return { dim: addDim(ZERO_DIM, base.dim, expVal), conflict: false };
      }
      return { dim: null, conflict: false };
    }
    return base;
  };

  const parseUnary = (): ExprDimResult => {
    if (peek() === "+" || peek() === "-") {
      consume();
      return parseUnary();
    }
    const tok = peek();
    if (!tok) return { dim: null, conflict: false };

    if (tok === "(") {
      consume();
      const inner = parseAdd();
      if (peek() === ")") consume();
      return inner;
    }

    if (/^[0-9.]/.test(tok)) {
      consume();
      if (Number(tok) === 0) {
        // Additive zero is dimension-polymorphic
        return { dim: null, conflict: false };
      }
      return { dim: ZERO_DIM, conflict: false };
    }

    consume();
    if (peek() === "(") {
      consume();
      const args: ExprDimResult[] = [];
      if (peek() !== ")") {
        args.push(parseAdd());
        while (peek() === ",") {
          consume();
          args.push(parseAdd());
        }
      }
      if (peek() === ")") consume();
      const fn = tok.toLowerCase();
      if (fn === "der" && args[0]?.dim) {
        hasKnownVar = true;
        return { dim: addDim(args[0].dim, [0, 0, -1, 0, 0, 0, 0], 1), conflict: args[0].conflict };
      }
      if (fn === "sqrt" && args[0]?.dim) {
        return { dim: addDim(ZERO_DIM, args[0].dim, 0.5), conflict: args[0].conflict };
      }
      if (fn === "abs" || fn === "pre" || fn === "noevent" || fn === "smooth") {
        return args[0] ?? { dim: null, conflict: false };
      }
      if (["sin", "cos", "tan", "exp", "log", "log10", "sinh", "cosh", "tanh"].includes(fn)) {
        return { dim: ZERO_DIM, conflict: Boolean(args[0]?.conflict) };
      }
      return { dim: null, conflict: false };
    }

    if (tok === "time") {
      hasKnownVar = true;
      return { dim: [0, 0, 1, 0, 0, 0, 0], conflict: false };
    }
    if (tok === "pi" || tok === "Modelica.Constants.pi") {
      return { dim: ZERO_DIM, conflict: false };
    }

    const direct = varDims.get(tok) ?? varDims.get(tok.replace(/\[[^\]]*\]/g, ""));
    if (direct) {
      hasKnownVar = true;
      return { dim: direct, conflict: false };
    }
    return { dim: null, conflict: false };
  };

  const result = parseAdd();
  if (!hasKnownVar && !result.conflict) {
    return { dim: null, conflict: false };
  }
  return result;
}

function extractModificationAttr(modText: string | undefined, attr: string): string | undefined {
  if (!modText) return undefined;
  const re = new RegExp(`\\b${attr}\\s*=\\s*([^,)]+)`);
  const m = re.exec(modText);
  return m?.[1]?.trim();
}

export interface DaePhysicsSummary {
  pantelides: {
    states: string[];
    algebraicVars: string[];
    constraintEqs: Array<{ expr: string; line: number; needsDiff: boolean }>;
    estimatedIndex: number;
  };
  kirchhoffNodes: Array<{
    nodeId: string;
    ports: string[];
    isStream: boolean;
    hasGround: boolean;
    line: number;
  }>;
  unitChecks: Array<{
    expr: string;
    lhsUnit: string;
    rhsUnit: string;
    isHomogeneous: boolean;
    line: number;
  }>;
  initialBalance: {
    diffOrder: number;
    initialEqCount: number;
    fixedStartCount: number;
    totalSpecified: number;
    status: "balanced" | "under-specified" | "over-specified";
    initialItems: Array<{ kind: "initial equation" | "fixed start" | "start guess"; text: string; line: number }>;
  };
}

export function analyzeDaePhysics(code: string, sourceCode?: string): DaePhysicsSummary {
  const effectiveSource = sourceCode ?? code;
  const localLines = indexLocalSymbolLines(effectiveSource);
  const scan = scanModelicaStructure(code);
  const sourceScan = sourceCode && sourceCode !== code ? scanModelicaStructure(sourceCode) : scan;

  const resolveLine = (ident: string, fallback: number): number => {
    const direct = localLines.get(ident);
    if (direct !== undefined) return direct;
    const base = ident.replace(/\[[^\]]*\]/g, "");
    return localLines.get(base) ?? fallback;
  };

  // 1. Pantelides DAE Index & Algebraic Constraint Analysis
  const stateSet = new Set<string>();
  const derRe = /\bder\s*\(\s*([A-Za-z_][A-Za-z0-9_.[\]]*|'[^']+')\s*\)/g;
  for (const eq of scan.equations) {
    if (eq.kind === "connect" || eq.isAlgorithm) continue;
    let m: RegExpExecArray | null;
    derRe.lastIndex = 0;
    while ((m = derRe.exec(eq.text)) !== null) {
      stateSet.add(m[1]!.trim());
    }
  }
  const states = Array.from(stateSet);

  const algebraicVars: string[] = [];
  const varDims = new Map<string, DimVec>();

  for (const decl of scan.declarations) {
    const shortType = decl.typeName.split(".").pop() ?? decl.typeName;
    const unitStr = decl.unit ?? TYPE_DEFAULT_UNITS[shortType];
    if (unitStr) {
      const dim = parseUnitString(unitStr);
      if (dim) varDims.set(decl.name, dim);
    }

    const isParamOrConst =
      decl.variability === "parameter" || decl.variability === "constant" || decl.variability === "component";
    const isScalarContinuous =
      !isParamOrConst &&
      decl.variability !== "discrete" &&
      (decl.isScalarType || shortType === "Real" || Boolean(TYPE_DEFAULT_UNITS[shortType]));

    if (isScalarContinuous && !stateSet.has(decl.name)) {
      algebraicVars.push(decl.name);
    }
  }

  for (const decl of sourceScan.declarations) {
    if (!varDims.has(decl.name)) {
      const shortType = decl.typeName.split(".").pop() ?? decl.typeName;
      const unitStr = decl.unit ?? TYPE_DEFAULT_UNITS[shortType];
      if (unitStr) {
        const dim = parseUnitString(unitStr);
        if (dim) varDims.set(decl.name, dim);
      }
    }
  }

  const algSet = new Set(algebraicVars);
  const constraintEqs: Array<{ expr: string; line: number; needsDiff: boolean }> = [];

  for (const eq of scan.equations) {
    if (eq.kind === "connect" || eq.isAlgorithm) continue;
    if (/\bder\s*\(/.test(eq.text)) continue;

    // Tokenize identifiers in this algebraic equation
    const idents = eq.text.match(/'[^']+'|[A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]+\])?/g) ?? [];
    let touchesState = false;
    let touchesAlgebraic = false;
    for (const id of idents) {
      if (stateSet.has(id)) touchesState = true;
      if (algSet.has(id)) touchesAlgebraic = true;
    }
    // Pure state holonomic/kinematic constraint (no algebraic unknown to solve for!) requires Pantelides differentiation
    const needsDiff = touchesState && !touchesAlgebraic;
    constraintEqs.push({
      expr: eq.text,
      line: eq.line,
      needsDiff,
    });
  }

  const highIndexCount = constraintEqs.filter((c) => c.needsDiff).length;
  const estimatedIndex = highIndexCount > 0 ? 2 : constraintEqs.length > 0 ? 1 : 0;

  // 2. Kirchhoff Equipotential Junction Synthesis via Union-Find on connect(a, b)
  const connectSources = sourceScan.equations.some((e) => e.kind === "connect") ? sourceScan : scan;
  const streamSymbols = new Set<string>();
  for (const decl of [...sourceScan.declarations, ...scan.declarations]) {
    if (decl.isStream) streamSymbols.add(decl.name);
  }

  const parent = new Map<string, string>();
  const portLine = new Map<string, number>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) && parent.get(cur) !== cur) {
      cur = parent.get(cur)!;
    }
    let walk = x;
    while (parent.get(walk) && parent.get(walk) !== cur) {
      const next = parent.get(walk)!;
      parent.set(walk, cur);
      walk = next;
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const eq of connectSources.equations) {
    if (eq.kind !== "connect") continue;
    const cm = /^connect\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/.exec(eq.text.replace(/;\s*$/, "").trim());
    if (!cm) continue;
    const a = cm[1]!.trim();
    const b = cm[2]!.trim();
    if (!portLine.has(a)) portLine.set(a, eq.line);
    if (!portLine.has(b)) portLine.set(b, eq.line);
    union(a, b);
  }

  const groups = new Map<string, { ports: string[]; line: number }>();
  for (const port of parent.keys()) {
    const root = find(port);
    const existing = groups.get(root);
    const ln = portLine.get(port) ?? 1;
    if (existing) {
      existing.ports.push(port);
      if (ln < existing.line) existing.line = ln;
    } else {
      groups.set(root, { ports: [port], line: ln });
    }
  }

  const kirchhoffNodes = Array.from(groups.values()).map((g, idx) => {
    const hasGround = g.ports.some((p) => /(?:^|\.)(?:ground|gnd|earth|ref)(?:\.|$)/i.test(p) || /\.g$/i.test(p));
    const isStream = g.ports.some((p) => {
      const prefix = p.split(".")[0]!;
      return streamSymbols.has(p) || streamSymbols.has(prefix);
    });
    return {
      nodeId: `Junction_${idx + 1}`,
      ports: g.ports,
      isStream,
      hasGround,
      line: g.line,
    };
  });

  // 3. Dimensional Homogeneity Checker
  const unitChecks: DaePhysicsSummary["unitChecks"] = [];
  for (const eq of scan.equations) {
    if (eq.kind === "connect" || eq.isAlgorithm || !eq.lhs || !eq.rhs) continue;
    const lhsRes = inferExprDim(eq.lhs, varDims);
    const rhsRes = inferExprDim(eq.rhs, varDims);
    if (!lhsRes.dim && !rhsRes.dim && !lhsRes.conflict && !rhsRes.conflict) {
      continue;
    }
    const isHomogeneous =
      !lhsRes.conflict && !rhsRes.conflict && (lhsRes.dim && rhsRes.dim ? sameDim(lhsRes.dim, rhsRes.dim) : true);
    unitChecks.push({
      expr: eq.text,
      lhsUnit: lhsRes.conflict ? "inconsistent sum" : lhsRes.dim ? formatDim(lhsRes.dim) : "inferred",
      rhsUnit: rhsRes.conflict ? "inconsistent sum" : rhsRes.dim ? formatDim(rhsRes.dim) : "inferred",
      isHomogeneous,
      line: eq.line,
    });
  }

  // 4. Initial Condition Balance (initial equations + fixed=true start attributes)
  const initialItems: DaePhysicsSummary["initialBalance"]["initialItems"] = [];
  let initialEqCount = 0;
  let fixedStartCount = 0;

  const initScan = scan.initialEquations.length > 0 ? scan : sourceScan;
  for (const eq of initScan.initialEquations) {
    initialEqCount++;
    initialItems.push({
      kind: "initial equation",
      text: eq.text,
      line: eq.line,
    });
  }

  const seenStartDecl = new Set<string>();
  for (const decl of [...scan.declarations, ...sourceScan.declarations]) {
    if (seenStartDecl.has(decl.name)) continue;
    const startVal = decl.startValue ?? extractModificationAttr(decl.modifiersText, "start");
    const fixedVal =
      decl.fixed !== undefined ? String(decl.fixed) : extractModificationAttr(decl.modifiersText, "fixed");
    if (startVal !== undefined || fixedVal !== undefined) {
      seenStartDecl.add(decl.name);
      const isFixed = fixedVal === "true";
      if (isFixed && (stateSet.has(decl.name) || states.length > 0)) {
        fixedStartCount++;
      }
      initialItems.push({
        kind: isFixed ? "fixed start" : "start guess",
        text: `${decl.name}(start=${startVal ?? "0"}${fixedVal ? `, fixed=${fixedVal}` : ""})`,
        line: resolveLine(decl.name, decl.line),
      });
    }
  }

  const diffOrder = states.length;
  const totalSpecified = initialEqCount + fixedStartCount;
  const status: DaePhysicsSummary["initialBalance"]["status"] =
    totalSpecified > diffOrder
      ? "over-specified"
      : totalSpecified === diffOrder || diffOrder === 0
        ? "balanced"
        : "under-specified";

  return {
    pantelides: { states, algebraicVars, constraintEqs, estimatedIndex },
    kirchhoffNodes,
    unitChecks,
    initialBalance: {
      diffOrder,
      initialEqCount,
      fixedStartCount,
      totalSpecified,
      status,
      initialItems,
    },
  };
}

export const DaeAdvancedInspector: React.FC<DaeAdvancedInspectorProps> = ({
  code,
  sourceCode,
  colorMode,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"pantelides" | "kirchhoff" | "units" | "initial">("pantelides");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const summary = useMemo(() => analyzeDaePhysics(code, sourceCode), [code, sourceCode]);
  const { pantelides, kirchhoffNodes, unitChecks, initialBalance } = summary;
  const unitMismatchCount = unitChecks.filter((u) => !u.isHomogeneous).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Sub-navigation */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "pantelides", label: `🔬 Pantelides Index (${pantelides.estimatedIndex})` },
          { id: "kirchhoff", label: `🔌 Kirchhoff & Stream Nodes (${kirchhoffNodes.length})` },
          {
            id: "units",
            label: `📏 Dimensional SI Units (${unitMismatchCount > 0 ? `${unitMismatchCount} mismatch` : `${unitChecks.length} checked`})`,
          },
          {
            id: "initial",
            label: `⏱️ Initial System (t₀: ${initialBalance.totalSpecified}/${initialBalance.diffOrder})`,
          },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subView === "pantelides" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
              <div style={{ fontSize: 11, color: textMuted, fontWeight: 600 }}>DIFFERENTIAL INDEX</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: pantelides.estimatedIndex > 1 ? "#f0883e" : "#3fb950",
                  fontFamily: "monospace",
                }}
              >
                Index-{pantelides.estimatedIndex} DAE
              </div>
              <div style={{ fontSize: 11, color: textMuted }}>
                {pantelides.estimatedIndex > 1
                  ? "Holonomic state constraint requires Pantelides differentiation"
                  : pantelides.estimatedIndex === 1
                    ? "Semi-explicit ODE + algebraic equations"
                    : "Pure explicit ODE / algebraic system"}
              </div>
            </div>
            <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
              <div style={{ fontSize: 11, color: textMuted, fontWeight: 600 }}>DIFFERENTIATED STATES (ẋ)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#58a6ff", fontFamily: "monospace" }}>
                {pantelides.states.length}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: textMuted,
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pantelides.states.join(", ") || "None"}
              </div>
            </div>
            <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
              <div style={{ fontSize: 11, color: textMuted, fontWeight: 600 }}>ALGEBRAIC UNKNOWNS</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#a371f7", fontFamily: "monospace" }}>
                {pantelides.algebraicVars.length}
              </div>
              <div style={{ fontSize: 11, color: textMuted }}>Zero-derivative continuous variables</div>
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
              Algebraic Equations & Pantelides Constraint Graph ({pantelides.constraintEqs.length})
            </div>
            {pantelides.constraintEqs.length === 0 ? (
              <div style={{ fontSize: 12, color: textMuted }}>
                All active continuous equations contain explicit state derivatives — Index-0 ODE structure.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pantelides.constraintEqs.map((c, idx) => (
                  <div
                    key={idx}
                    onClick={() => onRevealLine?.(c.line)}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: `1px solid ${borderCol}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: textPrimary, overflow: "hidden", textOverflow: "ellipsis" }}>{c.expr}</span>
                    <span style={{ color: c.needsDiff ? "#f0883e" : "#3fb950", fontWeight: 600, flexShrink: 0 }}>
                      {c.needsDiff ? `Differentiate d/dt (L${c.line})` : `Index-1 Algebraic (L${c.line})`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subView === "kirchhoff" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
            Physical Connector Equipotential & Zero-Sum Flow Sets (∑ iₖ = 0, v₁ = v₂ = …)
          </div>
          {kirchhoffNodes.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No acausal <code>connect(a, b)</code> clauses detected in the model source.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kirchhoffNodes.map((n, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(n.line)}
                  style={{
                    padding: "9px 12px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontFamily: "monospace", color: "#58a6ff" }}>
                      {n.nodeId} ({n.ports.length} connected ports)
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {n.hasGround && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 99,
                            backgroundColor: "rgba(63,185,80,0.16)",
                            color: "#3fb950",
                            fontWeight: 700,
                          }}
                        >
                          ⏚ Reference Ground
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 99,
                          backgroundColor: n.isStream ? "rgba(163,113,247,0.18)" : "rgba(88,166,255,0.15)",
                          color: n.isStream ? "#a371f7" : "#58a6ff",
                          fontWeight: 700,
                        }}
                      >
                        {n.isStream ? "inStream() Enthalpy Mixing" : "Kirchhoff KCL + KVL"}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: textMuted }}>
                    Ports: {n.ports.join(" ⟷ ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "units" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            SI Dimensional Homogeneity Audit ([M, L, T, I, Θ, N, J])
          </div>
          {unitChecks.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No explicit SI <code>unit=&quot;...&quot;</code> attributes or standard physical quantity types found on
              active equations. Declare <code>Real v(unit=&quot;V&quot;)</code> or MSL physical types to audit
              dimensional balance.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {unitChecks.map((u, idx) => (
                <div
                  key={idx}
                  onClick={() => onRevealLine?.(u.line)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${u.isHomogeneous ? borderCol : "rgba(248,81,73,0.45)"}`,
                    backgroundColor: u.isHomogeneous ? "transparent" : "rgba(248,81,73,0.06)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", color: textPrimary }}>{u.expr}</span>
                  <span style={{ color: u.isHomogeneous ? "#3fb950" : "#f85149", fontWeight: 600, flexShrink: 0 }}>
                    [{u.lhsUnit}] {u.isHomogeneous ? "≡" : "≠"} [{u.rhsUnit}] {u.isHomogeneous ? "✓" : "⚠"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "initial" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
              Consistent Initialization System Balance (t = t₀)
            </div>
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: textMuted }}>State DOF Required</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{initialBalance.diffOrder}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: textMuted }}>Initial Equations</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#58a6ff" }}>
                  {initialBalance.initialEqCount}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: textMuted }}>Fixed Start Attributes</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#a371f7" }}>
                  {initialBalance.fixedStartCount}
                </div>
              </div>
              <div
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  backgroundColor:
                    initialBalance.status === "balanced"
                      ? "rgba(63,185,80,0.14)"
                      : initialBalance.status === "over-specified"
                        ? "rgba(248,81,73,0.14)"
                        : "rgba(210,153,34,0.14)",
                  color:
                    initialBalance.status === "balanced"
                      ? "#3fb950"
                      : initialBalance.status === "over-specified"
                        ? "#f85149"
                        : "#d29922",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {initialBalance.status === "balanced"
                  ? "✓ Fully Determined Initial System"
                  : initialBalance.status === "over-specified"
                    ? `⚠ Over-Specified (+${initialBalance.totalSpecified - initialBalance.diffOrder} redundant initial conditions)`
                    : `ℹ ${initialBalance.diffOrder - initialBalance.totalSpecified} state(s) use default start=0 fallback`}
              </div>
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
              Declared Initial Equations & State Start Attributes ({initialBalance.initialItems.length})
            </div>
            {initialBalance.initialItems.length === 0 ? (
              <div style={{ fontSize: 12, color: textMuted }}>
                No explicit <code>initial equation</code> clauses or <code>start=...</code> modifiers declared; states
                default to <code>x(t₀) = 0.0</code>.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {initialBalance.initialItems.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => onRevealLine?.(item.line)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${borderCol}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: "monospace",
                    }}
                  >
                    <span style={{ color: textPrimary }}>{item.text}</span>
                    <span
                      style={{
                        color:
                          item.kind === "initial equation"
                            ? "#58a6ff"
                            : item.kind === "fixed start"
                              ? "#3fb950"
                              : textMuted,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {item.kind} (L{item.line})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
