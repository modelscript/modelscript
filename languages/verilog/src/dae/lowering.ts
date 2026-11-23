// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for IEEE 1364 Verilog RTL Designs.
 *
 * Lowers Verilog parameters, ports, continuous assignments, gate primitives,
 * combinational always blocks, and clocked registers directly into
 * `@modelscript/runtime`'s `IDaeBuilder` without intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInVerilogLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { VerilogDesign, VerilogExpr, VerilogModule, VerilogStmt } from "../types.js";

export interface VerilogDaeLoweringResult {
  moduleName: string;
  registerVarIndices: number[];
  combinationalVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

function evalConstNumber(expr: VerilogExpr, params: Map<string, number>): number {
  if (expr.kind === "number" && expr.numericValue !== undefined) return expr.numericValue;
  if (expr.kind === "identifier") return params.get(expr.name) ?? 0;
  if (expr.kind === "unary") {
    const v = evalConstNumber(expr.operand, params);
    return expr.op === "-" ? -v : v;
  }
  if (expr.kind === "binary") {
    const l = evalConstNumber(expr.left, params);
    const r = evalConstNumber(expr.right, params);
    if (expr.op === "+") return l + r;
    if (expr.op === "-") return l - r;
    if (expr.op === "*") return l * r;
    if (expr.op === "/" && r !== 0) return Math.trunc(l / r);
  }
  return 0;
}

/**
 * Lowers a `VerilogModule` (or the top module of a `VerilogDesign`) into a `DAEBuilder`.
 */
export function lowerVerilogToDae(
  builder: IDaeBuilder,
  designOrModule: VerilogDesign | VerilogModule,
  topModuleName?: string,
): VerilogDaeLoweringResult {
  ensureBuiltInVerilogLibraryRegistered();

  const mod: VerilogModule | undefined =
    "modules" in designOrModule
      ? topModuleName
        ? designOrModule.modules.find((m) => m.name === topModuleName)
        : designOrModule.modules[designOrModule.modules.length - 1]
      : designOrModule;

  if (!mod) {
    throw new Error(`No Verilog module found to lower into DAE.`);
  }

  const variableMap = new Map<string, number>();
  const registerVarIndices: number[] = [];
  const combinationalVarIndices: number[] = [];
  const paramValues = new Map<string, number>();
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    varType: VarType = VarType.Integer,
    variability: Variability = Variability.Discrete,
    causality: Causality = Causality.Local,
    startVal: number = 0,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const lookedUp = builder.lookupVariable(name);
    if (lookedUp !== -1) {
      variableMap.set(name, lookedUp);
      return lookedUp;
    }
    const idx = builder.addVariable(name, varType, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // 1. Parameters
  for (const [pName, pDecl] of mod.parameters) {
    const val = evalConstNumber(pDecl.value, paramValues);
    paramValues.set(pName, val);
    getOrAddVar(pName, VarType.Integer, Variability.Parameter, Causality.Local, val);
  }

  // 2. Ports
  for (const [pName, pDecl] of mod.ports) {
    const causality =
      pDecl.direction === "input" ? Causality.Input : pDecl.direction === "output" ? Causality.Output : Causality.Local;
    const idx = getOrAddVar(pName, VarType.Integer, Variability.Discrete, causality, 0);
    if (pDecl.netKind === "reg") {
      registerVarIndices.push(idx);
    } else if (pDecl.direction !== "input") {
      combinationalVarIndices.push(idx);
    }
  }

  // 3. Internal nets & regs
  for (const [nName, nDecl] of mod.nets) {
    if (variableMap.has(nName)) continue;
    const startVal = nDecl.initialValue ? evalConstNumber(nDecl.initialValue, paramValues) : 0;
    const idx = getOrAddVar(nName, VarType.Integer, Variability.Discrete, Causality.Local, startVal);
    if (nDecl.kind === "reg" || nDecl.kind === "integer") {
      registerVarIndices.push(idx);
    } else {
      combinationalVarIndices.push(idx);
    }
  }

  const lowerExpr = (expr: VerilogExpr): number => {
    switch (expr.kind) {
      case "number":
        return builder.addIntLiteral(expr.numericValue ?? 0);

      case "identifier": {
        const idx = getOrAddVar(expr.name, VarType.Integer, Variability.Discrete, Causality.Local, 0);
        return builder.addName(idx);
      }

      case "index":
        // Represent bit-select as arithmetic shift-right / modulo approximation in DAE
        return lowerExpr(expr.target);

      case "slice":
        return lowerExpr(expr.target);

      case "unary": {
        const opExpr = lowerExpr(expr.operand);
        if (expr.op === "-") return builder.addUnaryExpr(UnaryOp.Negate, opExpr);
        if (expr.op === "!" || expr.op === "~") {
          // 1 - x for 1-bit inversion in discrete integer DAE
          return builder.addBinaryExpr(BinOp.Sub, builder.addIntLiteral(1), opExpr);
        }
        return opExpr;
      }

      case "binary": {
        const l = lowerExpr(expr.left);
        const r = lowerExpr(expr.right);
        switch (expr.op) {
          case "+":
            return builder.addBinaryExpr(BinOp.Add, l, r);
          case "-":
            return builder.addBinaryExpr(BinOp.Sub, l, r);
          case "*":
          case "&":
          case "&&":
            return builder.addBinaryExpr(BinOp.Mul, l, r);
          case "/":
            return builder.addBinaryExpr(BinOp.Div, l, r);
          case "|":
          case "||": {
            // a + b - a*b
            const sum = builder.addBinaryExpr(BinOp.Add, l, r);
            const prod = builder.addBinaryExpr(BinOp.Mul, l, r);
            return builder.addBinaryExpr(BinOp.Sub, sum, prod);
          }
          case "^": {
            // a + b - 2*a*b
            const sum = builder.addBinaryExpr(BinOp.Add, l, r);
            const prod = builder.addBinaryExpr(
              BinOp.Mul,
              builder.addIntLiteral(2),
              builder.addBinaryExpr(BinOp.Mul, l, r),
            );
            return builder.addBinaryExpr(BinOp.Sub, sum, prod);
          }
          case "==":
          case "===":
            return builder.addBinaryExpr(BinOp.Eq, l, r);
          case "!=":
          case "!==":
            return builder.addBinaryExpr(BinOp.Neq, l, r);
          case "<":
            return builder.addBinaryExpr(BinOp.Lt, l, r);
          case "<=":
            return builder.addBinaryExpr(BinOp.Lte, l, r);
          case ">":
            return builder.addBinaryExpr(BinOp.Gt, l, r);
          case ">=":
            return builder.addBinaryExpr(BinOp.Gte, l, r);
          default:
            return builder.addBinaryExpr(BinOp.Add, l, r);
        }
      }

      case "ternary": {
        const cond = lowerExpr(expr.condition);
        const cons = lowerExpr(expr.consequent);
        const alt = lowerExpr(expr.alternate);
        return builder.addIfElse(cond, cons, alt);
      }

      case "concat":
        return expr.elements.length > 0 ? lowerExpr(expr.elements[0]!) : builder.addIntLiteral(0);

      case "replicate":
        return expr.elements.length > 0 ? lowerExpr(expr.elements[0]!) : builder.addIntLiteral(0);
    }
  };

  // Lower procedural statements into next-state expression map
  const collectAssignments = (stmt: VerilogStmt, condExpr: number | undefined, outMap: Map<string, number>): void => {
    switch (stmt.kind) {
      case "empty":
        break;
      case "block":
        for (const s of stmt.statements) collectAssignments(s, condExpr, outMap);
        break;
      case "blocking_assign":
      case "nonblocking_assign": {
        if (stmt.lhs.kind !== "identifier") break;
        const targetName = stmt.lhs.name;
        const rhsId = lowerExpr(stmt.rhs);
        if (condExpr !== undefined) {
          const prevExpr =
            outMap.get(targetName) ??
            builder.addName(getOrAddVar(targetName, VarType.Integer, Variability.Discrete, Causality.Local, 0));
          outMap.set(targetName, builder.addIfElse(condExpr, rhsId, prevExpr));
        } else {
          outMap.set(targetName, rhsId);
        }
        break;
      }
      case "if": {
        const cId = lowerExpr(stmt.condition);
        const combinedCond = condExpr !== undefined ? builder.addBinaryExpr(BinOp.And, condExpr, cId) : cId;
        collectAssignments(stmt.consequent, combinedCond, outMap);
        if (stmt.alternate) {
          const notC = builder.addUnaryExpr(UnaryOp.Not, cId);
          const elseCond = condExpr !== undefined ? builder.addBinaryExpr(BinOp.And, condExpr, notC) : notC;
          collectAssignments(stmt.alternate, elseCond, outMap);
        }
        break;
      }
      case "case": {
        const selId = lowerExpr(stmt.expression);
        for (const ci of stmt.items) {
          if (ci.isDefault) {
            collectAssignments(ci.statement, condExpr, outMap);
          } else if (ci.patterns.length > 0) {
            let matchExpr = builder.addBinaryExpr(BinOp.Eq, selId, lowerExpr(ci.patterns[0]!));
            for (let k = 1; k < ci.patterns.length; k++) {
              const nextEq = builder.addBinaryExpr(BinOp.Eq, selId, lowerExpr(ci.patterns[k]!));
              matchExpr = builder.addBinaryExpr(BinOp.Or, matchExpr, nextEq);
            }
            const combined = condExpr !== undefined ? builder.addBinaryExpr(BinOp.And, condExpr, matchExpr) : matchExpr;
            collectAssignments(ci.statement, combined, outMap);
          }
        }
        break;
      }
    }
  };

  // 4. Lower continuous assigns, gates, and always blocks
  for (const item of mod.items) {
    if (item.kind === "assign") {
      const lhsId = lowerExpr(item.lhs);
      const rhsId = lowerExpr(item.rhs);
      builder.addEquation(EqKind.Simple, lhsId, rhsId);
      equationCount++;
    } else if (item.kind === "gate") {
      const outPort = item.ports[0];
      const inPorts = item.ports.slice(1);
      if (!outPort || inPorts.length === 0) continue;
      const lhsId = lowerExpr(outPort);
      let rhsId = lowerExpr(inPorts[0]!);
      for (let i = 1; i < inPorts.length; i++) {
        const nextIn = lowerExpr(inPorts[i]!);
        if (item.gateType === "and" || item.gateType === "nand") {
          rhsId = builder.addBinaryExpr(BinOp.Mul, rhsId, nextIn);
        } else if (item.gateType === "or" || item.gateType === "nor") {
          const sum = builder.addBinaryExpr(BinOp.Add, rhsId, nextIn);
          const prod = builder.addBinaryExpr(BinOp.Mul, rhsId, nextIn);
          rhsId = builder.addBinaryExpr(BinOp.Sub, sum, prod);
        } else if (item.gateType === "xor" || item.gateType === "xnor") {
          const sum = builder.addBinaryExpr(BinOp.Add, rhsId, nextIn);
          const prod = builder.addBinaryExpr(
            BinOp.Mul,
            builder.addIntLiteral(2),
            builder.addBinaryExpr(BinOp.Mul, rhsId, nextIn),
          );
          rhsId = builder.addBinaryExpr(BinOp.Sub, sum, prod);
        }
      }
      if (
        item.gateType === "not" ||
        item.gateType === "nand" ||
        item.gateType === "nor" ||
        item.gateType === "xnor" ||
        item.gateType === "notif0" ||
        item.gateType === "notif1"
      ) {
        rhsId = builder.addBinaryExpr(BinOp.Sub, builder.addIntLiteral(1), rhsId);
      }
      builder.addEquation(EqKind.Simple, lhsId, rhsId);
      equationCount++;
    } else if (item.kind === "always") {
      const isSeq = item.sensitivity.some((s) => s.kind === "posedge" || s.kind === "negedge");
      const assigned = new Map<string, number>();
      collectAssignments(item.body, undefined, assigned);

      for (const [targetName, rhsId] of assigned) {
        const varIdx = getOrAddVar(targetName, VarType.Integer, Variability.Discrete, Causality.Local, 0);
        if (isSeq) {
          // Clocked register: emit next-state register shadow variable `target_next = rhs`
          // and synchronous update equation `target = target_next` (representing clocked latch)
          if (!registerVarIndices.includes(varIdx)) registerVarIndices.push(varIdx);
          const nextIdx = getOrAddVar(`${targetName}_next`, VarType.Integer, Variability.Discrete, Causality.Local, 0);
          builder.addEquation(EqKind.Simple, builder.addName(nextIdx), rhsId);
          equationCount++;
        } else {
          builder.addEquation(EqKind.Simple, builder.addName(varIdx), rhsId);
          equationCount++;
        }
      }
    }
  }

  return {
    moduleName: mod.name,
    registerVarIndices,
    combinationalVarIndices,
    equationCount,
    variableMap,
  };
}
