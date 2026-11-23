// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseApdl } from "../parser/deck-parser.js";
import type { ApdlAnalysisType, ApdlModel, ApdlParsedDeck, ApdlSection, ApdlStatement } from "../types.js";

const MAX_LOOP_ITERATIONS = 100_000;

interface ExprToken {
  type: "num" | "ident" | "op" | "lparen" | "rparen" | "comma";
  value: string;
}

function tokenizeExpr(expr: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i++;
      continue;
    }
    if (ch === "*" && expr[i + 1] === "*") {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "op", value: ch === "^" ? "**" : ch });
      i++;
      continue;
    }
    const numMatch = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?/.exec(expr.slice(i));
    if (numMatch) {
      tokens.push({ type: "num", value: numMatch[0].replace(/[dD]/g, "e") });
      i += numMatch[0].length;
      continue;
    }
    const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i));
    if (identMatch) {
      tokens.push({ type: "ident", value: identMatch[0].toUpperCase() });
      i += identMatch[0].length;
      continue;
    }
    // Skip unknown characters gracefully
    i++;
  }
  return tokens;
}

/**
 * Evaluates an APDL arithmetic expression using the provided parameter and array tables.
 */
export function evaluateApdlExpression(
  expr: string,
  params: Map<string, number>,
  arrays?: Map<string, number[]>,
): number {
  const trimmed = expr.trim();
  if (!trimmed) return 0;

  const tokens = tokenizeExpr(trimmed);
  if (tokens.length === 0) return 0;

  let pos = 0;
  const peek = (): ExprToken | undefined => tokens[pos];
  const consume = (): ExprToken | undefined => tokens[pos++];

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (peek()?.type === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = consume()!.value;
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePower();
    while (peek()?.type === "op" && (peek()!.value === "*" || peek()!.value === "/")) {
      const op = consume()!.value;
      const right = parsePower();
      left = op === "*" ? left * right : right !== 0 ? left / right : NaN;
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (peek()?.type === "op" && peek()!.value === "**") {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek()?.type === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = consume()!.value;
      const val = parseUnary();
      return op === "-" ? -val : val;
    }
    return parsePrimary();
  };

  const evalBuiltin = (name: string, args: number[]): number => {
    const a = args[0] ?? 0;
    const b = args[1] ?? 0;
    switch (name) {
      case "SIN":
        return Math.sin(a);
      case "COS":
        return Math.cos(a);
      case "TAN":
        return Math.tan(a);
      case "ASIN":
        return Math.asin(a);
      case "ACOS":
        return Math.acos(a);
      case "ATAN":
        return Math.atan(a);
      case "ATAN2":
        return Math.atan2(a, b);
      case "SQRT":
        return Math.sqrt(a);
      case "ABS":
        return Math.abs(a);
      case "EXP":
        return Math.exp(a);
      case "LOG":
        return Math.log(a);
      case "LOG10":
        return Math.log10(a);
      case "NINT":
        return Math.round(a);
      case "INT":
        return Math.trunc(a);
      case "MOD":
        return b !== 0 ? a % b : 0;
      case "SIGN":
        return Math.abs(a) * (b < 0 ? -1 : 1);
      case "MIN":
        return Math.min(...args);
      case "MAX":
        return Math.max(...args);
      default: {
        // Check array access (1-based indexing in APDL)
        const arr = arrays?.get(name);
        if (arr) {
          const idx = Math.round(a) - 1;
          return arr[idx] ?? 0;
        }
        return params.get(name) ?? 0;
      }
    }
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) return 0;

    if (tok.type === "num") {
      consume();
      return Number.parseFloat(tok.value);
    }

    if (tok.type === "lparen") {
      consume();
      const val = parseAddSub();
      if (peek()?.type === "rparen") consume();
      return val;
    }

    if (tok.type === "ident") {
      consume();
      const name = tok.value;
      if (peek()?.type === "lparen") {
        consume();
        const args: number[] = [];
        if (peek()?.type !== "rparen") {
          args.push(parseAddSub());
          while (peek()?.type === "comma") {
            consume();
            args.push(parseAddSub());
          }
        }
        if (peek()?.type === "rparen") consume();
        return evalBuiltin(name, args);
      }
      if (name === "PI") return Math.PI;
      return params.get(name) ?? 0;
    }

    consume();
    return 0;
  };

  return parseAddSub();
}

function evalCondition(lhs: number, op: string, rhs: number): boolean {
  switch (op.toUpperCase()) {
    case "EQ":
      return Math.abs(lhs - rhs) <= 1e-12;
    case "NE":
      return Math.abs(lhs - rhs) > 1e-12;
    case "LT":
      return lhs < rhs;
    case "GT":
      return lhs > rhs;
    case "LE":
      return lhs <= rhs;
    case "GE":
      return lhs >= rhs;
    case "ABLT":
      return Math.abs(lhs) < Math.abs(rhs);
    case "ABGT":
      return Math.abs(lhs) > Math.abs(rhs);
    default:
      return false;
  }
}

function computeSectionProperties(
  subtype: string,
  data: number[],
): { area: number; Izz: number; Iyy: number; J: number } {
  const st = subtype.toUpperCase();
  if (st === "RECT") {
    const b = data[0] ?? 0.1;
    const h = data[1] ?? b;
    const area = b * h;
    const Izz = (b * h * h * h) / 12;
    const Iyy = (h * b * b * b) / 12;
    const longSide = Math.max(b, h);
    const shortSide = Math.min(b, h);
    const r = shortSide / Math.max(longSide, 1e-12);
    const J = longSide * shortSide * shortSide * shortSide * (1 / 3 - 0.21 * r * (1 - (r * r * r * r) / 12));
    return { area, Izz, Iyy, J };
  }
  if (st === "CSOLID") {
    const r = data[0] ?? 0.05;
    const area = Math.PI * r * r;
    const I = (Math.PI * r * r * r * r) / 4;
    return { area, Izz: I, Iyy: I, J: 2 * I };
  }
  if (st === "CTUBE") {
    const ri = data[0] ?? 0.04;
    const ro = data[1] ?? 0.05;
    const area = Math.PI * (ro * ro - ri * ri);
    const I = (Math.PI * (ro ** 4 - ri ** 4)) / 4;
    return { area, Izz: I, Iyy: I, J: 2 * I };
  }
  if (st === "ASEC") {
    const area = data[0] ?? 1e-3;
    const Iyy = data[1] ?? 1e-6;
    const Izz = data[3] ?? Iyy;
    const J = data[5] ?? Iyy + Izz;
    return { area, Izz, Iyy, J };
  }
  const area = data[0] ?? 1e-3;
  const Izz = data[1] ?? 1e-6;
  const Iyy = data[2] ?? Izz;
  const J = data[3] ?? Izz + Iyy;
  return { area, Izz, Iyy, J };
}

function findMatchingEnddo(stmts: ApdlStatement[], startIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < stmts.length; i++) {
    const k = stmts[i]!.kind;
    if (k === "do_start") depth++;
    else if (k === "enddo") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return stmts.length - 1;
}

interface IfBranches {
  branches: Array<{ cond: { lhs: string; op: string; rhs: string } | null; body: ApdlStatement[] }>;
  endIdx: number;
}

function collectIfBranches(stmts: ApdlStatement[], startIdx: number): IfBranches {
  const first = stmts[startIdx]!;
  if (first.kind !== "if_start") return { branches: [], endIdx: startIdx };

  const branches: Array<{ cond: { lhs: string; op: string; rhs: string } | null; body: ApdlStatement[] }> = [];
  let currentCond: { lhs: string; op: string; rhs: string } | null = {
    lhs: first.lhsExpr,
    op: first.operator,
    rhs: first.rhsExpr,
  };
  let currentBody: ApdlStatement[] = [];
  let depth = 0;

  for (let i = startIdx + 1; i < stmts.length; i++) {
    const s = stmts[i]!;
    if (s.kind === "if_start" && s.action === "THEN") {
      depth++;
      currentBody.push(s);
    } else if (s.kind === "endif") {
      if (depth === 0) {
        branches.push({ cond: currentCond, body: currentBody });
        return { branches, endIdx: i };
      }
      depth--;
      currentBody.push(s);
    } else if (depth === 0 && s.kind === "elseif") {
      branches.push({ cond: currentCond, body: currentBody });
      currentCond = { lhs: s.lhsExpr, op: s.operator, rhs: s.rhsExpr };
      currentBody = [];
    } else if (depth === 0 && s.kind === "else") {
      branches.push({ cond: currentCond, body: currentBody });
      currentCond = null;
      currentBody = [];
    } else {
      currentBody.push(s);
    }
  }

  branches.push({ cond: currentCond, body: currentBody });
  return { branches, endIdx: stmts.length - 1 };
}

/**
 * Expands APDL parametric macros (`*SET`, `*DIM`, `*DO`, `*IF`, `*GET`, `param = expr`)
 * and builds a fully materialized `ApdlModel` ready for FEA solving, DAE lowering, or projection.
 */
export function expandApdlMacros(sourceOrDeck: string | ApdlParsedDeck): ApdlModel {
  const deck = typeof sourceOrDeck === "string" ? parseApdl(sourceOrDeck) : sourceOrDeck;

  const model: ApdlModel = {
    title: deck.title,
    units: deck.units,
    analysisType: "STATIC",
    numModes: 5,
    parameters: new Map<string, number>(),
    arrays: new Map<string, number[]>(),
    elementTypes: new Map(),
    materials: new Map(),
    realConstants: new Map(),
    sections: new Map(),
    keypoints: new Map(),
    lines: new Map(),
    areas: new Map(),
    volumes: new Map(),
    nodes: new Map(),
    elements: new Map(),
    constraints: [],
    forces: [],
    surfaceLoads: [],
    hasSolve: false,
    statements: deck.statements,
  };

  let activeType = 1;
  let activeMat = 1;
  let activeReal = 1;
  let activeSec = 1;
  let globalEsize = 0;
  let globalNdiv = 0;
  let nextNodeId = 1;
  let nextElemId = 1;
  let nextLineId = 1;
  let nextAreaId = 1;
  let nextVolId = 1;

  const evalNum = (expr: string | undefined, fallback = 0): number => {
    if (!expr || !expr.trim()) return fallback;
    const val = evaluateApdlExpression(expr, model.parameters, model.arrays);
    return Number.isFinite(val) ? val : fallback;
  };

  const findOrCreateNodeAt = (x: number, y: number, z: number, line: number): number => {
    for (const n of model.nodes.values()) {
      if (Math.hypot(n.x - x, n.y - y, n.z - z) < 1e-9) {
        return n.id;
      }
    }
    while (model.nodes.has(nextNodeId)) nextNodeId++;
    const id = nextNodeId++;
    model.nodes.set(id, { id, x, y, z, line });
    return id;
  };

  const execCommand = (cmd: string, args: string[], line: number): void => {
    switch (cmd) {
      case "ET": {
        const id = Math.round(evalNum(args[0], 1));
        const name = (args[1] ?? "BEAM188").toUpperCase();
        model.elementTypes.set(id, { id, name, keyopts: {}, line });
        break;
      }
      case "KEYOPT": {
        const id = Math.round(evalNum(args[0], 1));
        const knum = Math.round(evalNum(args[1], 1));
        const val = Math.round(evalNum(args[2], 0));
        const et = model.elementTypes.get(id);
        if (et) et.keyopts[knum] = val;
        break;
      }
      case "MP": {
        const lab = (args[0] ?? "").toUpperCase();
        const matId = Math.round(evalNum(args[1], 1));
        const val = evalNum(args[2], 0);
        let mat = model.materials.get(matId);
        if (!mat) {
          mat = { id: matId, properties: {}, line };
          model.materials.set(matId, mat);
        }
        mat.properties[lab] = val;
        if (lab === "EX") mat.EX = val;
        else if (lab === "PRXY" || lab === "NUXY") mat.PRXY = val;
        else if (lab === "DENS") mat.DENS = val;
        else if (lab === "GXY") mat.GXY = val;
        else if (lab === "ALPX") mat.ALPX = val;
        break;
      }
      case "R": {
        const id = Math.round(evalNum(args[0], 1));
        const values = args
          .slice(1)
          .filter((a) => a.length > 0)
          .map((a) => evalNum(a, 0));
        model.realConstants.set(id, { id, values, line });
        break;
      }
      case "SECTYPE": {
        const id = Math.round(evalNum(args[0], 1));
        const type = (args[1] ?? "BEAM").toUpperCase();
        const subtype = (args[2] ?? "RECT").toUpperCase();
        const existing = model.sections.get(id);
        const sec: ApdlSection = {
          id,
          type,
          subtype,
          data: existing?.data ?? [],
          area: existing?.area ?? 1e-3,
          Izz: existing?.Izz ?? 1e-6,
          Iyy: existing?.Iyy ?? 1e-6,
          J: existing?.J ?? 1e-6,
          line,
        };
        model.sections.set(id, sec);
        activeSec = id;
        break;
      }
      case "SECDATA": {
        const data = args.filter((a) => a.length > 0).map((a) => evalNum(a, 0));
        let sec = model.sections.get(activeSec);
        if (!sec) {
          sec = {
            id: activeSec,
            type: "BEAM",
            subtype: "RECT",
            data,
            area: 1e-3,
            Izz: 1e-6,
            Iyy: 1e-6,
            J: 1e-6,
            line,
          };
          model.sections.set(activeSec, sec);
        }
        sec.data = data;
        const props = computeSectionProperties(sec.subtype, data);
        sec.area = props.area;
        sec.Izz = props.Izz;
        sec.Iyy = props.Iyy;
        sec.J = props.J;
        break;
      }
      case "TYPE": {
        activeType = Math.round(evalNum(args[0], 1));
        break;
      }
      case "MAT": {
        activeMat = Math.round(evalNum(args[0], 1));
        break;
      }
      case "REAL": {
        activeReal = Math.round(evalNum(args[0], 1));
        break;
      }
      case "SECNUM": {
        activeSec = Math.round(evalNum(args[0], 1));
        break;
      }
      case "K": {
        const rawId = args[0] ? Math.round(evalNum(args[0], 0)) : 0;
        const id = rawId > 0 ? rawId : model.keypoints.size + 1;
        const x = evalNum(args[1], 0);
        const y = evalNum(args[2], 0);
        const z = evalNum(args[3], 0);
        model.keypoints.set(id, { id, x, y, z, line });
        break;
      }
      case "L": {
        const k1 = Math.round(evalNum(args[0], 0));
        const k2 = Math.round(evalNum(args[1], 0));
        const id = nextLineId++;
        model.lines.set(id, { id, k1, k2, line });
        break;
      }
      case "LESIZE": {
        const lineArg = (args[0] ?? "ALL").toUpperCase();
        const sizeVal = args[1] ? evalNum(args[1], 0) : 0;
        const ndivVal = args[3] ? Math.round(evalNum(args[3], 0)) : 0;
        const targetLines =
          lineArg === "ALL"
            ? Array.from(model.lines.values())
            : [model.lines.get(Math.round(evalNum(lineArg, 0)))].filter((l): l is NonNullable<typeof l> => Boolean(l));
        for (const ln of targetLines) {
          if (ndivVal > 0) {
            ln.ndiv = ndivVal;
          } else if (sizeVal > 0) {
            const p1 = model.keypoints.get(ln.k1);
            const p2 = model.keypoints.get(ln.k2);
            if (p1 && p2) {
              const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
              ln.ndiv = Math.max(1, Math.round(dist / sizeVal));
            }
          }
        }
        break;
      }
      case "A": {
        const keypoints = args.filter((a) => a.length > 0).map((a) => Math.round(evalNum(a, 0)));
        const id = nextAreaId++;
        model.areas.set(id, { id, keypoints, line });
        break;
      }
      case "V": {
        const keypoints = args.filter((a) => a.length > 0).map((a) => Math.round(evalNum(a, 0)));
        const id = nextVolId++;
        model.volumes.set(id, { id, keypoints, line });
        break;
      }
      case "N": {
        const rawId = args[0] ? Math.round(evalNum(args[0], 0)) : 0;
        const id = rawId > 0 ? rawId : nextNodeId++;
        if (id >= nextNodeId) nextNodeId = id + 1;
        const x = evalNum(args[1], 0);
        const y = evalNum(args[2], 0);
        const z = evalNum(args[3], 0);
        model.nodes.set(id, { id, x, y, z, line });
        break;
      }
      case "E": {
        const nodeIds = args.filter((a) => a.length > 0).map((a) => Math.round(evalNum(a, 0)));
        while (model.elements.has(nextElemId)) nextElemId++;
        const id = nextElemId++;
        model.elements.set(id, {
          id,
          typeId: activeType,
          matId: activeMat,
          realId: activeReal,
          secId: activeSec,
          nodes: nodeIds,
          line,
        });
        break;
      }
      case "ESIZE": {
        if (args[0]) globalEsize = evalNum(args[0], 0);
        if (args[1]) globalNdiv = Math.round(evalNum(args[1], 0));
        break;
      }
      case "LMESH": {
        const target = (args[0] ?? "ALL").toUpperCase();
        const targetLines =
          target === "ALL"
            ? Array.from(model.lines.values())
            : [model.lines.get(Math.round(evalNum(target, 0)))].filter((l): l is NonNullable<typeof l> => Boolean(l));

        for (const ln of targetLines) {
          const kp1 = model.keypoints.get(ln.k1);
          const kp2 = model.keypoints.get(ln.k2);
          if (!kp1 || !kp2) continue;
          const dist = Math.hypot(kp2.x - kp1.x, kp2.y - kp1.y, kp2.z - kp1.z);
          let ndiv = ln.ndiv ?? 0;
          if (ndiv <= 0 && globalNdiv > 0) ndiv = globalNdiv;
          if (ndiv <= 0 && globalEsize > 0 && dist > 0) ndiv = Math.max(1, Math.round(dist / globalEsize));
          if (ndiv <= 0) ndiv = 1;

          const lineNodes: number[] = [];
          for (let s = 0; s <= ndiv; s++) {
            const t = s / ndiv;
            const x = kp1.x + t * (kp2.x - kp1.x);
            const y = kp1.y + t * (kp2.y - kp1.y);
            const z = kp1.z + t * (kp2.z - kp1.z);
            lineNodes.push(findOrCreateNodeAt(x, y, z, line));
          }
          for (let s = 0; s < ndiv; s++) {
            while (model.elements.has(nextElemId)) nextElemId++;
            const elemId = nextElemId++;
            model.elements.set(elemId, {
              id: elemId,
              typeId: activeType,
              matId: activeMat,
              realId: activeReal,
              secId: activeSec,
              nodes: [lineNodes[s]!, lineNodes[s + 1]!],
              line,
            });
          }
        }
        break;
      }
      case "D": {
        const nodeArg = (args[0] ?? "").toUpperCase();
        const dof = (args[1] ?? "ALL").toUpperCase();
        const val = evalNum(args[2], 0);
        if (nodeArg === "ALL") {
          for (const n of model.nodes.values()) {
            model.constraints.push({ node: n.id, dof, value: val, line });
          }
        } else {
          const node = Math.round(evalNum(nodeArg, 0));
          model.constraints.push({ node, dof, value: val, line });
        }
        // Additional DOFs on the same D command (fields 6..10 in APDL: D, Node, Lab, VALUE, VALUE2, NEND, NINC, Lab2, Lab3...)
        for (let k = 6; k < args.length; k++) {
          const extraDof = (args[k] ?? "").toUpperCase();
          if (extraDof && /^(UX|UY|UZ|ROTX|ROTY|ROTZ|ALL)$/.test(extraDof)) {
            const node = Math.round(evalNum(nodeArg, 0));
            model.constraints.push({ node, dof: extraDof, value: val, line });
          }
        }
        break;
      }
      case "DK": {
        // Keypoint constraint -> map to coincident node
        const kpId = Math.round(evalNum(args[0], 0));
        const dof = (args[1] ?? "ALL").toUpperCase();
        const val = evalNum(args[2], 0);
        const kp = model.keypoints.get(kpId);
        if (kp) {
          for (const n of model.nodes.values()) {
            if (Math.hypot(n.x - kp.x, n.y - kp.y, n.z - kp.z) < 1e-9) {
              model.constraints.push({ node: n.id, dof, value: val, line });
            }
          }
        }
        break;
      }
      case "F": {
        const nodeArg = (args[0] ?? "").toUpperCase();
        const dof = (args[1] ?? "FY").toUpperCase();
        const val = evalNum(args[2], 0);
        if (nodeArg === "ALL") {
          for (const n of model.nodes.values()) {
            model.forces.push({ node: n.id, dof, value: val, line });
          }
        } else {
          const node = Math.round(evalNum(nodeArg, 0));
          model.forces.push({ node, dof, value: val, line });
        }
        break;
      }
      case "FK": {
        const kpId = Math.round(evalNum(args[0], 0));
        const dof = (args[1] ?? "FY").toUpperCase();
        const val = evalNum(args[2], 0);
        const kp = model.keypoints.get(kpId);
        if (kp) {
          for (const n of model.nodes.values()) {
            if (Math.hypot(n.x - kp.x, n.y - kp.y, n.z - kp.z) < 1e-9) {
              model.forces.push({ node: n.id, dof, value: val, line });
            }
          }
        }
        break;
      }
      case "SF": {
        const entity = Math.round(evalNum(args[0], 0));
        const lab = (args[1] ?? "PRES").toUpperCase();
        const val = evalNum(args[2], 0);
        model.surfaceLoads.push({ entity, lab, value: val, line });
        break;
      }
      case "ANTYPE": {
        const raw = (args[0] ?? "STATIC").toUpperCase();
        const map: Record<string, ApdlAnalysisType> = {
          "0": "STATIC",
          STATIC: "STATIC",
          "1": "BUCKLE",
          BUCKLE: "BUCKLE",
          "2": "MODAL",
          MODAL: "MODAL",
          "3": "HARMIC",
          HARMIC: "HARMIC",
          "4": "TRANS",
          TRANS: "TRANS",
          "7": "SUBSTR",
          SUBSTR: "SUBSTR",
        };
        model.analysisType = map[raw] ?? "STATIC";
        break;
      }
      case "MODOPT": {
        const nmodes = Math.round(evalNum(args[1], 5));
        if (nmodes > 0) model.numModes = nmodes;
        break;
      }
      case "SOLVE": {
        model.hasSolve = true;
        break;
      }
      default:
        break;
    }
  };

  const execStatements = (stmts: ApdlStatement[]): void => {
    let i = 0;
    while (i < stmts.length) {
      const stmt = stmts[i]!;
      switch (stmt.kind) {
        case "title":
          model.title = stmt.title;
          i++;
          break;
        case "units":
          model.units = stmt.system;
          i++;
          break;
        case "processor":
          i++;
          break;
        case "set": {
          const val = evalNum(stmt.expr, 0);
          if (stmt.indexExpr) {
            const idx = Math.round(evalNum(stmt.indexExpr, 1)) - 1;
            let arr = model.arrays.get(stmt.name);
            if (!arr) {
              arr = [];
              model.arrays.set(stmt.name, arr);
            }
            if (idx >= 0) arr[idx] = val;
          } else {
            model.parameters.set(stmt.name, val);
          }
          i++;
          break;
        }
        case "dim": {
          const size = Math.max(1, Math.round(evalNum(stmt.imax, 1)));
          model.arrays.set(stmt.name, new Array<number>(size).fill(0));
          i++;
          break;
        }
        case "do_start": {
          const endIdx = findMatchingEnddo(stmts, i);
          const body = stmts.slice(i + 1, endIdx);
          const startVal = evalNum(stmt.startExpr, 1);
          const endVal = evalNum(stmt.endExpr, 1);
          const incVal = evalNum(stmt.incExpr, 1);

          if (incVal !== 0) {
            let iter = 0;
            if (incVal > 0) {
              for (let v = startVal; v <= endVal + 1e-12 && iter < MAX_LOOP_ITERATIONS; v += incVal, iter++) {
                model.parameters.set(stmt.variable, v);
                execStatements(body);
              }
            } else {
              for (let v = startVal; v >= endVal - 1e-12 && iter < MAX_LOOP_ITERATIONS; v += incVal, iter++) {
                model.parameters.set(stmt.variable, v);
                execStatements(body);
              }
            }
          }
          i = endIdx + 1;
          break;
        }
        case "enddo":
          i++;
          break;
        case "if_start": {
          if (stmt.action === "THEN") {
            const { branches, endIdx } = collectIfBranches(stmts, i);
            for (const br of branches) {
              if (!br.cond) {
                execStatements(br.body);
                break;
              }
              const lhs = evalNum(br.cond.lhs, 0);
              const rhs = evalNum(br.cond.rhs, 0);
              if (evalCondition(lhs, br.cond.op, rhs)) {
                execStatements(br.body);
                break;
              }
            }
            i = endIdx + 1;
          } else {
            // Single-line *IF
            const lhs = evalNum(stmt.lhsExpr, 0);
            const rhs = evalNum(stmt.rhsExpr, 0);
            if (evalCondition(lhs, stmt.operator, rhs) && stmt.inlineCommand) {
              const inlineDeck = parseApdl(stmt.inlineCommand);
              execStatements(inlineDeck.statements);
            }
            i++;
          }
          break;
        }
        case "elseif":
        case "else":
        case "endif":
          i++;
          break;
        case "get": {
          let val = 0;
          if (stmt.entity === "NODE") {
            if (stmt.item1 === "COUNT") val = model.nodes.size;
            else if (stmt.item1 === "NUM" && stmt.it1num === "MAX") {
              val = model.nodes.size > 0 ? Math.max(...model.nodes.keys()) : 0;
            } else if (stmt.item1 === "LOC") {
              const n = model.nodes.get(Math.round(evalNum(stmt.entnum, 0)));
              if (n) val = stmt.it1num === "X" ? n.x : stmt.it1num === "Y" ? n.y : n.z;
            }
          } else if (stmt.entity === "ELEM") {
            if (stmt.item1 === "COUNT") val = model.elements.size;
            else if (stmt.item1 === "NUM" && stmt.it1num === "MAX") {
              val = model.elements.size > 0 ? Math.max(...model.elements.keys()) : 0;
            }
          } else if (stmt.entity === "KP" && stmt.item1 === "COUNT") {
            val = model.keypoints.size;
          }
          if (stmt.param) model.parameters.set(stmt.param, val);
          i++;
          break;
        }
        case "command":
          execCommand(stmt.command, stmt.args, stmt.line);
          i++;
          break;
      }
    }
  };

  execStatements(deck.statements);
  return model;
}
