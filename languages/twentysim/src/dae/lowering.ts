// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for 20-sim Bond Graphs & SIDOPS Equations.
 *
 * Lowers:
 * - Bond graph junctions (`0`-junction: common effort, zero-sum flow; `1`-junction: common flow, zero-sum effort)
 * - Canonical bond graph elements (`R`, `C`, `I`, `Se`, `Sf`, `MSe`, `MSf`, `TF`, `GY`, `MTF`, `MGY`)
 * - Embedded SIDOPS equations (`ddt(x)`, `int(expr, x0)`, algebraic & differential equations)
 * - Signal connections (`from.port -> to.port`)
 * directly into `@modelscript/runtime`'s `IDaeBuilder` linear-memory arena.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import type { SidopsExpr, TwentySimModel, TwentySimSubmodel } from "../types.js";

export interface TwentySimDaeLoweringResult {
  stateVarIndices: number[];
  parameterVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function mapBinOp(op: Extract<SidopsExpr, { kind: "binary" }>["op"]): BinOp {
  switch (op) {
    case "+":
      return BinOp.Add;
    case "-":
      return BinOp.Sub;
    case "*":
      return BinOp.Mul;
    case "/":
      return BinOp.Div;
    case "^":
      return BinOp.Pow;
    case "==":
      return BinOp.Eq;
    case "<>":
      return BinOp.Neq;
    case "<":
      return BinOp.Lt;
    case "<=":
      return BinOp.Lte;
    case ">":
      return BinOp.Gt;
    case ">=":
      return BinOp.Gte;
    case "and":
      return BinOp.And;
    case "or":
      return BinOp.Or;
  }
}

function getParamNumber(sub: TwentySimSubmodel, names: string[], fallback: number): number {
  for (const name of names) {
    const found = sub.parameters.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found && typeof found.value === "number" && Number.isFinite(found.value)) {
      return found.value;
    }
  }
  return fallback;
}

function evalConst(expr: SidopsExpr | undefined, env: Map<string, number>): number {
  if (!expr) return 0.0;
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "boolean":
      return expr.value ? 1.0 : 0.0;
    case "ident":
      return env.get(expr.name) ?? 0.0;
    case "unary": {
      const v = evalConst(expr.operand, env);
      return expr.op === "-" ? -v : v;
    }
    case "binary": {
      const l = evalConst(expr.left, env);
      const r = evalConst(expr.right, env);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r !== 0 ? l / r : 0.0;
        case "^":
          return Math.pow(l, r);
        default:
          return 0.0;
      }
    }
    default:
      return 0.0;
  }
}

/**
 * Lowers a parsed `TwentySimModel` directly into an `IDaeBuilder` arena.
 */
export function lowerTwentySimToDae(builder: IDaeBuilder, model: TwentySimModel): TwentySimDaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const parameterVarIndices: number[] = [];
  let equationCount = 0;
  let intCounter = 0;

  const getOrAddVar = (
    name: string,
    variability: Variability = Variability.Continuous,
    startVal = 0.0,
    varType: VarType = VarType.Real,
  ): number => {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const inBuilder = builder.lookupVariable(name);
    if (inBuilder !== -1) {
      variableMap.set(name, inBuilder);
      return inBuilder;
    }
    const idx = builder.addVariable(name, varType, variability, Causality.Local, startVal);
    variableMap.set(name, idx);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      parameterVarIndices.push(idx);
    }
    return idx;
  };

  const addEq = (lhs: number, rhs: number, kind: EqKind = EqKind.Simple): void => {
    builder.addEquation(kind, lhs, rhs);
    equationCount++;
  };

  const qualify = (prefix: string, name: string): string => (prefix ? `${prefix}_${name}` : name);

  const lowerSubmodel = (sub: TwentySimSubmodel, prefix: string): void => {
    const paramEnv = new Map<string, number>([
      ["pi", Math.PI],
      ["e", Math.E],
    ]);

    // 1. Register parameters
    for (const p of sub.parameters) {
      const val = typeof p.value === "number" ? p.value : evalConst(p.expr, paramEnv);
      paramEnv.set(p.name, val);
      getOrAddVar(
        qualify(prefix, p.name),
        p.isConstant ? Variability.Constant : Variability.Parameter,
        val,
        p.type === "integer" ? VarType.Integer : p.type === "boolean" ? VarType.Boolean : VarType.Real,
      );
    }

    // 2. Register declared variables
    for (const v of sub.variables) {
      getOrAddVar(
        qualify(prefix, v.name),
        Variability.Continuous,
        v.initialValue ?? 0.0,
        v.type === "integer" ? VarType.Integer : v.type === "boolean" ? VarType.Boolean : VarType.Real,
      );
    }

    // 3. Register port variables
    for (const port of sub.ports) {
      if (port.kind === "power") {
        getOrAddVar(qualify(prefix, `${port.name}_e`), Variability.Continuous, 0.0);
        getOrAddVar(qualify(prefix, `${port.name}_f`), Variability.Continuous, 0.0);
      } else {
        getOrAddVar(qualify(prefix, port.name), Variability.Continuous, 0.0);
      }
    }

    const resolveSidopsVar = (rawName: string): number => {
      if (rawName === "time") {
        const tId = getOrAddVar("time", Variability.Continuous, 0.0);
        return builder.addName(tId);
      }
      if (rawName === "pi") return builder.addRealLiteral(Math.PI);
      const qName = qualify(prefix, rawName);
      const vId = getOrAddVar(qName, Variability.Continuous, 0.0);
      return builder.addName(vId);
    };

    const lowerExpr = (expr: SidopsExpr): number => {
      switch (expr.kind) {
        case "number":
          return builder.addRealLiteral(expr.value);
        case "boolean":
          return builder.addRealLiteral(expr.value ? 1.0 : 0.0);
        case "string":
          return builder.addRealLiteral(0.0);
        case "ident":
          return resolveSidopsVar(expr.name);
        case "member": {
          const qName = qualify(prefix, `${expr.object}_${expr.field}`);
          const vId = getOrAddVar(qName, Variability.Continuous, 0.0);
          return builder.addName(vId);
        }
        case "unary": {
          const inner = lowerExpr(expr.operand);
          if (expr.op === "+") return inner;
          if (expr.op === "-") return builder.addUnaryExpr(UnaryOp.Negate, inner);
          return builder.addUnaryExpr(UnaryOp.Not, inner);
        }
        case "binary": {
          const l = lowerExpr(expr.left);
          const r = lowerExpr(expr.right);
          return builder.addBinaryExpr(mapBinOp(expr.op), l, r);
        }
        case "if": {
          const c = lowerExpr(expr.condition);
          const t = lowerExpr(expr.thenExpr);
          const e = lowerExpr(expr.elseExpr);
          if (
            typeof (builder as unknown as { addIfExpr?: (c: number, t: number, e: number) => number }).addIfExpr ===
            "function"
          ) {
            return (builder as unknown as { addIfExpr: (c: number, t: number, e: number) => number }).addIfExpr(
              c,
              t,
              e,
            );
          }
          return t;
        }
        case "call": {
          const fn = expr.callee.toLowerCase();
          if (fn === "ddt" || fn === "der") {
            const arg = expr.args[0];
            if (arg) {
              const inner = lowerExpr(arg);
              if (arg.kind === "ident") {
                const vId = getOrAddVar(qualify(prefix, arg.name), Variability.Continuous, 0.0);
                if (!stateVarIndices.includes(vId)) stateVarIndices.push(vId);
              }
              return builder.addDer(inner);
            }
          }
          if (fn === "int") {
            // `int(integrand, initialValue)` -> synthetic state `der(s) = integrand` with start = initialValue
            const integrandExpr = expr.args[0] ? lowerExpr(expr.args[0]) : builder.addRealLiteral(0.0);
            const initVal = evalConst(expr.args[1], paramEnv);
            const stateName = qualify(prefix, `_int_${++intCounter}`);
            const stateVarId = getOrAddVar(stateName, Variability.Continuous, initVal);
            stateVarIndices.push(stateVarId);
            addEq(builder.addDer(builder.addName(stateVarId)), integrandExpr, EqKind.Simple);
            return builder.addName(stateVarId);
          }
          const argIds = expr.args.map((a) => lowerExpr(a));
          if (
            typeof (builder as unknown as { addCallExpr?: (f: string, args: number[]) => number }).addCallExpr ===
            "function"
          ) {
            return (builder as unknown as { addCallExpr: (f: string, args: number[]) => number }).addCallExpr(
              fn,
              argIds,
            );
          }
          return argIds[0] ?? builder.addRealLiteral(0.0);
        }
      }
    };

    // 4. Lower explicit SIDOPS equations if present, else canonical Bond Graph constitutive laws
    if (sub.equations.length > 0) {
      for (const eq of sub.initialEquations) {
        addEq(lowerExpr(eq.lhs), lowerExpr(eq.rhs), EqKind.Simple);
      }
      for (const eq of sub.equations) {
        // Special-case `x = int(rhs, x0)` to directly assign `x` as the state variable
        if (eq.lhs.kind === "ident" && eq.rhs.kind === "call" && eq.rhs.callee.toLowerCase() === "int") {
          const initVal = evalConst(eq.rhs.args[1], paramEnv);
          const stateId = getOrAddVar(qualify(prefix, eq.lhs.name), Variability.Continuous, initVal);
          if (!stateVarIndices.includes(stateId)) stateVarIndices.push(stateId);
          const integrand = eq.rhs.args[0] ? lowerExpr(eq.rhs.args[0]) : builder.addRealLiteral(0.0);
          addEq(builder.addDer(builder.addName(stateId)), integrand, EqKind.Simple);
        } else {
          addEq(lowerExpr(eq.lhs), lowerExpr(eq.rhs), EqKind.Simple);
        }
      }
    } else if (sub.submodels.length === 0) {
      lowerCanonicalElement(sub, prefix, paramEnv);
    }

    // 5. Lower child submodels
    for (const child of sub.submodels) {
      lowerSubmodel(child, qualify(prefix, child.name));
    }

    // 6. Lower bond graph junctions & connections
    if (sub.connections.length > 0) {
      lowerConnections(sub, prefix);
    }
  };

  const lowerCanonicalElement = (sub: TwentySimSubmodel, prefix: string, _paramEnv: Map<string, number>): void => {
    const pE = (): number => builder.addName(getOrAddVar(qualify(prefix, "p_e"), Variability.Continuous, 0.0));
    const pF = (): number => builder.addName(getOrAddVar(qualify(prefix, "p_f"), Variability.Continuous, 0.0));

    switch (sub.elementKind) {
      case "R": {
        const rVal = getParamNumber(sub, ["r", "R", "resistance", "damping", "b"], 1.0);
        const rId = getOrAddVar(qualify(prefix, "r"), Variability.Parameter, rVal);
        // e = r * f
        addEq(pE(), builder.addBinaryExpr(BinOp.Mul, builder.addName(rId), pF()));
        break;
      }
      case "C": {
        const cVal = getParamNumber(sub, ["c", "C", "capacitance", "compliance"], 1.0);
        const q0 = getParamNumber(sub, ["q0", "state_initial", "initial"], 0.0);
        const cId = getOrAddVar(qualify(prefix, "c"), Variability.Parameter, cVal);
        const qId = getOrAddVar(qualify(prefix, "q"), Variability.Continuous, q0);
        stateVarIndices.push(qId);
        // der(q) = p.f ; p.e = q / c
        addEq(builder.addDer(builder.addName(qId)), pF());
        addEq(pE(), builder.addBinaryExpr(BinOp.Div, builder.addName(qId), builder.addName(cId)));
        break;
      }
      case "I": {
        const iVal = getParamNumber(sub, ["i", "I", "m", "mass", "inertia", "L", "inductance"], 1.0);
        const p0 = getParamNumber(sub, ["p0", "state_initial", "initial"], 0.0);
        const iId = getOrAddVar(qualify(prefix, "i"), Variability.Parameter, iVal);
        const momId = getOrAddVar(qualify(prefix, "p_state"), Variability.Continuous, p0);
        stateVarIndices.push(momId);
        // der(p_state) = p.e ; p.f = p_state / i
        addEq(builder.addDer(builder.addName(momId)), pE());
        addEq(pF(), builder.addBinaryExpr(BinOp.Div, builder.addName(momId), builder.addName(iId)));
        break;
      }
      case "Se": {
        const eVal = getParamNumber(sub, ["effort", "e", "value", "F", "V"], 1.0);
        const eId = getOrAddVar(qualify(prefix, "effort"), Variability.Parameter, eVal);
        addEq(pE(), builder.addName(eId));
        break;
      }
      case "Sf": {
        const fVal = getParamNumber(sub, ["flow", "f", "value", "v", "I"], 1.0);
        const fId = getOrAddVar(qualify(prefix, "flow"), Variability.Parameter, fVal);
        addEq(pF(), builder.addName(fId));
        break;
      }
      case "MSe": {
        const sigId = getOrAddVar(qualify(prefix, "effort"), Variability.Continuous, 0.0);
        addEq(pE(), builder.addName(sigId));
        break;
      }
      case "MSf": {
        const sigId = getOrAddVar(qualify(prefix, "flow"), Variability.Continuous, 0.0);
        addEq(pF(), builder.addName(sigId));
        break;
      }
      case "TF": {
        const rVal = getParamNumber(sub, ["r", "m", "ratio", "n"], 1.0);
        const rId = getOrAddVar(qualify(prefix, "r"), Variability.Parameter, rVal);
        const p1E = builder.addName(getOrAddVar(qualify(prefix, "p1_e"), Variability.Continuous, 0.0));
        const p1F = builder.addName(getOrAddVar(qualify(prefix, "p1_f"), Variability.Continuous, 0.0));
        const p2E = builder.addName(getOrAddVar(qualify(prefix, "p2_e"), Variability.Continuous, 0.0));
        const p2F = builder.addName(getOrAddVar(qualify(prefix, "p2_f"), Variability.Continuous, 0.0));
        // p1.e = r * p2.e ; p2.f = r * p1.f
        addEq(p1E, builder.addBinaryExpr(BinOp.Mul, builder.addName(rId), p2E));
        addEq(p2F, builder.addBinaryExpr(BinOp.Mul, builder.addName(rId), p1F));
        break;
      }
      case "GY": {
        const rVal = getParamNumber(sub, ["r", "ratio", "g"], 1.0);
        const rId = getOrAddVar(qualify(prefix, "r"), Variability.Parameter, rVal);
        const p1E = builder.addName(getOrAddVar(qualify(prefix, "p1_e"), Variability.Continuous, 0.0));
        const p1F = builder.addName(getOrAddVar(qualify(prefix, "p1_f"), Variability.Continuous, 0.0));
        const p2E = builder.addName(getOrAddVar(qualify(prefix, "p2_e"), Variability.Continuous, 0.0));
        const p2F = builder.addName(getOrAddVar(qualify(prefix, "p2_f"), Variability.Continuous, 0.0));
        // p1.e = r * p2.f ; p2.e = r * p1.f
        addEq(p1E, builder.addBinaryExpr(BinOp.Mul, builder.addName(rId), p2F));
        addEq(p2E, builder.addBinaryExpr(BinOp.Mul, builder.addName(rId), p1F));
        break;
      }
      case "MTF": {
        const rSig = builder.addName(getOrAddVar(qualify(prefix, "r"), Variability.Continuous, 1.0));
        const p1E = builder.addName(getOrAddVar(qualify(prefix, "p1_e"), Variability.Continuous, 0.0));
        const p1F = builder.addName(getOrAddVar(qualify(prefix, "p1_f"), Variability.Continuous, 0.0));
        const p2E = builder.addName(getOrAddVar(qualify(prefix, "p2_e"), Variability.Continuous, 0.0));
        const p2F = builder.addName(getOrAddVar(qualify(prefix, "p2_f"), Variability.Continuous, 0.0));
        addEq(p1E, builder.addBinaryExpr(BinOp.Mul, rSig, p2E));
        addEq(p2F, builder.addBinaryExpr(BinOp.Mul, rSig, p1F));
        break;
      }
      case "MGY": {
        const rSig = builder.addName(getOrAddVar(qualify(prefix, "r"), Variability.Continuous, 1.0));
        const p1E = builder.addName(getOrAddVar(qualify(prefix, "p1_e"), Variability.Continuous, 0.0));
        const p1F = builder.addName(getOrAddVar(qualify(prefix, "p1_f"), Variability.Continuous, 0.0));
        const p2E = builder.addName(getOrAddVar(qualify(prefix, "p2_e"), Variability.Continuous, 0.0));
        const p2F = builder.addName(getOrAddVar(qualify(prefix, "p2_f"), Variability.Continuous, 0.0));
        addEq(p1E, builder.addBinaryExpr(BinOp.Mul, rSig, p2F));
        addEq(p2E, builder.addBinaryExpr(BinOp.Mul, rSig, p1F));
        break;
      }
      case "Signal": {
        const tNorm = (sub.typeName ?? sub.name).toLowerCase().replace(/[^a-z0-9]/g, "");
        const outExpr = builder.addName(getOrAddVar(qualify(prefix, "output"), Variability.Continuous, 0.0));
        if (tNorm === "gain" || tNorm === "amplifier") {
          const kVal = getParamNumber(sub, ["K", "k", "gain"], 1.0);
          const kId = getOrAddVar(qualify(prefix, "K"), Variability.Parameter, kVal);
          const inExpr = builder.addName(getOrAddVar(qualify(prefix, "input"), Variability.Continuous, 0.0));
          addEq(outExpr, builder.addBinaryExpr(BinOp.Mul, builder.addName(kId), inExpr));
        } else if (tNorm === "plusminus" || tNorm === "sum") {
          const pExpr = builder.addName(getOrAddVar(qualify(prefix, "plus"), Variability.Continuous, 0.0));
          const mExpr = builder.addName(getOrAddVar(qualify(prefix, "minus"), Variability.Continuous, 0.0));
          addEq(outExpr, builder.addBinaryExpr(BinOp.Sub, pExpr, mExpr));
        } else if (tNorm === "integrate" || tNorm === "integrator") {
          const init = getParamNumber(sub, ["initial", "x0"], 0.0);
          const outId = getOrAddVar(qualify(prefix, "output"), Variability.Continuous, init);
          stateVarIndices.push(outId);
          const inExpr = builder.addName(getOrAddVar(qualify(prefix, "input"), Variability.Continuous, 0.0));
          addEq(builder.addDer(builder.addName(outId)), inExpr);
        } else if (tNorm === "constant" || tNorm === "const" || tNorm === "step") {
          const cVal = getParamNumber(sub, ["C", "amplitude", "value"], 1.0);
          const cId = getOrAddVar(qualify(prefix, "C"), Variability.Parameter, cVal);
          addEq(outExpr, builder.addName(cId));
        }
        break;
      }
      default:
        break;
    }
  };

  const lowerConnections = (container: TwentySimSubmodel, prefix: string): void => {
    const subByName = new Map<string, TwentySimSubmodel>();
    for (const s of container.submodels) {
      subByName.set(s.name, s);
    }

    // Track incident bond variables for every 0-junction and 1-junction
    const junctionBonds = new Map<string, Array<{ eVar: number; fVar: number; sign: 1 | -1 }>>();

    for (const conn of container.connections) {
      if (conn.kind === "signal") {
        const fromVar = getOrAddVar(
          qualify(prefix, `${conn.fromSubmodel}_${conn.fromPort}`),
          Variability.Continuous,
          0.0,
        );
        const toVar = getOrAddVar(qualify(prefix, `${conn.toSubmodel}_${conn.toPort}`), Variability.Continuous, 0.0);
        addEq(builder.addName(toVar), builder.addName(fromVar));
        continue;
      }

      const fromSub = subByName.get(conn.fromSubmodel);
      const toSub = subByName.get(conn.toSubmodel);
      if (!fromSub || !toSub) continue;

      const fromIsJunction = fromSub.elementKind === "0" || fromSub.elementKind === "1";
      const toIsJunction = toSub.elementKind === "0" || toSub.elementKind === "1";

      // Create dedicated bond effort/flow variables for junction bonds, or directly equate element-to-element
      if (!fromIsJunction && !toIsJunction) {
        const fe = getOrAddVar(qualify(prefix, `${conn.fromSubmodel}_${conn.fromPort}_e`), Variability.Continuous, 0.0);
        const ff = getOrAddVar(qualify(prefix, `${conn.fromSubmodel}_${conn.fromPort}_f`), Variability.Continuous, 0.0);
        const te = getOrAddVar(qualify(prefix, `${conn.toSubmodel}_${conn.toPort}_e`), Variability.Continuous, 0.0);
        const tf = getOrAddVar(qualify(prefix, `${conn.toSubmodel}_${conn.toPort}_f`), Variability.Continuous, 0.0);
        addEq(builder.addName(fe), builder.addName(te));
        addEq(builder.addName(ff), builder.addName(tf));
        continue;
      }

      // Bond variables: if an endpoint is a non-junction element, reuse its port variables directly
      // to keep the DAE minimal; if junction-to-junction, introduce explicit bond variables.
      let bondE: number;
      let bondF: number;
      if (!fromIsJunction) {
        bondE = getOrAddVar(qualify(prefix, `${conn.fromSubmodel}_${conn.fromPort}_e`), Variability.Continuous, 0.0);
        bondF = getOrAddVar(qualify(prefix, `${conn.fromSubmodel}_${conn.fromPort}_f`), Variability.Continuous, 0.0);
      } else if (!toIsJunction) {
        bondE = getOrAddVar(qualify(prefix, `${conn.toSubmodel}_${conn.toPort}_e`), Variability.Continuous, 0.0);
        bondF = getOrAddVar(qualify(prefix, `${conn.toSubmodel}_${conn.toPort}_f`), Variability.Continuous, 0.0);
      } else {
        bondE = getOrAddVar(qualify(prefix, `${conn.id}_e`), Variability.Continuous, 0.0);
        bondF = getOrAddVar(qualify(prefix, `${conn.id}_f`), Variability.Continuous, 0.0);
      }

      // Power leaves `from` (sign = -1 at `from` junction) and enters `to` (sign = +1 at `to` junction)
      if (fromIsJunction) {
        if (!junctionBonds.has(fromSub.name)) junctionBonds.set(fromSub.name, []);
        junctionBonds.get(fromSub.name)!.push({ eVar: bondE, fVar: bondF, sign: -1 });
      }
      if (toIsJunction) {
        if (!junctionBonds.has(toSub.name)) junctionBonds.set(toSub.name, []);
        junctionBonds.get(toSub.name)!.push({ eVar: bondE, fVar: bondF, sign: 1 });
      }
    }

    // Emit junction conservation laws
    for (const [juncName, list] of junctionBonds.entries()) {
      const junc = subByName.get(juncName);
      if (!junc || list.length === 0) continue;

      if (junc.elementKind === "0") {
        // Common effort: e_1 = e_2 = ... = e_k
        const refE = list[0]!.eVar;
        for (let k = 1; k < list.length; k++) {
          addEq(builder.addName(list[k]!.eVar), builder.addName(refE));
        }
        // Zero-sum flow: sum(sign_k * f_k) = 0
        let sumExpr: number | null = null;
        for (const item of list) {
          const term =
            item.sign === 1
              ? builder.addName(item.fVar)
              : builder.addUnaryExpr(UnaryOp.Negate, builder.addName(item.fVar));
          sumExpr = sumExpr === null ? term : builder.addBinaryExpr(BinOp.Add, sumExpr, term);
        }
        if (sumExpr !== null) {
          addEq(sumExpr, builder.addRealLiteral(0.0));
        }
      } else if (junc.elementKind === "1") {
        // Common flow: f_1 = f_2 = ... = f_k
        const refF = list[0]!.fVar;
        for (let k = 1; k < list.length; k++) {
          addEq(builder.addName(list[k]!.fVar), builder.addName(refF));
        }
        // Zero-sum effort: sum(sign_k * e_k) = 0
        let sumExpr: number | null = null;
        for (const item of list) {
          const term =
            item.sign === 1
              ? builder.addName(item.eVar)
              : builder.addUnaryExpr(UnaryOp.Negate, builder.addName(item.eVar));
          sumExpr = sumExpr === null ? term : builder.addBinaryExpr(BinOp.Add, sumExpr, term);
        }
        if (sumExpr !== null) {
          addEq(sumExpr, builder.addRealLiteral(0.0));
        }
      }
    }
  };

  lowerSubmodel(model.root, "");

  return {
    stateVarIndices,
    parameterVarIndices,
    equationCount,
    variableMap,
  };
}
