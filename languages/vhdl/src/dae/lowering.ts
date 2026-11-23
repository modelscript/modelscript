// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for VHDL (IEEE 1076-1987/1993).
 *
 * Lowers VHDL entities, ports, signals, combinational concurrent assignments,
 * and clocked synchronous processes directly into `@modelscript/runtime`'s
 * `IDaeBuilder` linear memory representation with zero intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInVhdlLibraryRegistered } from "../catalog/library-package-adapter.js";
import { parseVhdl } from "../parser/vhdl-parser.js";
import { bitsToUnsigned, expandBitString } from "../solver/std-logic.js";
import type { VhdlDesignFile, VhdlExpr, VhdlPortDirection, VhdlSeqStmt, VhdlTypeRef } from "../types.js";

export interface VhdlDaeLoweringResult {
  entityName: string;
  variableMap: Map<string, number>;
  clockVarIndices: number[];
  registerVarIndices: number[];
  equationCount: number;
}

function mapPortCausality(dir: VhdlPortDirection): Causality {
  if (dir === "in") return Causality.Input;
  if (dir === "out" || dir === "buffer") return Causality.Output;
  return Causality.Local;
}

function mapVhdlVarType(type: VhdlTypeRef, isClock: boolean): VarType {
  if (isClock) return VarType.Clock;
  const lower = type.name.toLowerCase();
  if (lower === "boolean" || ((lower === "std_logic" || lower === "std_ulogic" || lower === "bit") && !type.range)) {
    return VarType.Boolean;
  }
  return VarType.Integer;
}

function isClockName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "clk" || lower === "clock" || lower.endsWith("_clk") || lower.startsWith("clk_");
}

function extractClockSignal(expr: VhdlExpr): string | undefined {
  if (expr.kind === "call") {
    const fn = expr.name.toLowerCase();
    if ((fn === "rising_edge" || fn === "falling_edge") && expr.args[0]?.kind === "ident") {
      return expr.args[0].name;
    }
  }
  if (expr.kind === "attribute" && expr.attr.toLowerCase() === "event") {
    return expr.target;
  }
  if (expr.kind === "binary" && expr.op === "and") {
    return extractClockSignal(expr.left) ?? extractClockSignal(expr.right);
  }
  return undefined;
}

/**
 * Lowers a parsed VHDL design file (or source text) into an `IDaeBuilder` linear memory arena.
 */
export function lowerVhdlToDae(
  builder: IDaeBuilder,
  input: VhdlDesignFile | string,
  entityName?: string,
): VhdlDaeLoweringResult {
  ensureBuiltInVhdlLibraryRegistered();
  const design = typeof input === "string" ? parseVhdl(input) : input;

  const entity = entityName
    ? design.entities.find((e) => e.name.toLowerCase() === entityName.toLowerCase())
    : design.entities[design.entities.length - 1];
  if (!entity) {
    throw new Error(`Cannot lower VHDL to DAE: entity${entityName ? ` '${entityName}'` : ""} not found.`);
  }

  const arch = design.architectures.find((a) => a.entityName.toLowerCase() === entity.name.toLowerCase());
  const variableMap = new Map<string, number>();
  const clockVarIndices: number[] = [];
  const registerVarIndices: number[] = [];
  const enumToInt = new Map<string, number>();
  let equationCount = 0;

  // Map enum literals to integer codes
  if (arch) {
    for (const t of arch.types) {
      if (t.kind === "enum" && t.enumLiterals) {
        t.enumLiterals.forEach((lit, idx) => enumToInt.set(lit.toLowerCase(), idx));
      }
    }
  }

  const getOrAddVar = (
    name: string,
    varType: VarType = VarType.Integer,
    variability: Variability = Variability.Discrete,
    causality: Causality = Causality.Local,
    startVal = 0,
  ): number => {
    const key = name.toLowerCase();
    const existing = variableMap.get(key);
    if (existing !== undefined) return existing;
    const lookedUp = builder.lookupVariable(name);
    if (lookedUp !== -1) {
      variableMap.set(key, lookedUp);
      return lookedUp;
    }
    const idx = builder.addVariable(name, varType, variability, causality, startVal);
    variableMap.set(key, idx);
    return idx;
  };

  // Detect clock signals from synchronous processes
  const detectedClocks = new Set<string>();
  if (arch) {
    for (const stmt of arch.statements) {
      if (stmt.kind === "process") {
        const findClocks = (list: VhdlSeqStmt[]): void => {
          for (const s of list) {
            if (s.kind === "if") {
              const c = extractClockSignal(s.condition);
              if (c) detectedClocks.add(c.toLowerCase());
              for (const ei of s.elsifs) {
                const ec = extractClockSignal(ei.condition);
                if (ec) detectedClocks.add(ec.toLowerCase());
              }
              findClocks(s.thenBranch);
              if (s.elseBranch) findClocks(s.elseBranch);
            }
          }
        };
        findClocks(stmt.body);
      }
    }
  }

  // 1. Lower generics as Parameters
  for (const g of entity.generics) {
    const startVal = g.defaultValue?.kind === "intLiteral" ? g.defaultValue.value : 0;
    getOrAddVar(g.name, VarType.Integer, Variability.Parameter, Causality.Local, startVal);
  }

  // 2. Lower ports
  for (const p of entity.ports) {
    const isClk = detectedClocks.has(p.name.toLowerCase()) || isClockName(p.name);
    const vType = mapVhdlVarType(p.type, isClk);
    const idx = getOrAddVar(p.name, vType, Variability.Discrete, mapPortCausality(p.direction), 0);
    if (isClk) clockVarIndices.push(idx);
  }

  // 3. Lower architecture signals & constants
  if (arch) {
    for (const c of arch.constants) {
      const val = c.value.kind === "intLiteral" ? c.value.value : 0;
      getOrAddVar(c.name, VarType.Integer, Variability.Constant, Causality.Local, val);
    }
    for (const s of arch.signals) {
      const startVal =
        s.defaultValue?.kind === "intLiteral"
          ? s.defaultValue.value
          : s.defaultValue?.kind === "bitString"
            ? bitsToUnsigned(expandBitString(s.defaultValue.value, s.defaultValue.base ?? "B"))
            : 0;
      getOrAddVar(s.name, mapVhdlVarType(s.type, false), Variability.Discrete, Causality.Local, startVal);
    }
  }

  const lowerExpr = (expr: VhdlExpr): number => {
    switch (expr.kind) {
      case "intLiteral":
        return builder.addRealLiteral(expr.value);
      case "realLiteral":
        return builder.addRealLiteral(expr.value);
      case "boolLiteral":
        return builder.addRealLiteral(expr.value ? 1 : 0);
      case "charLiteral":
        return builder.addRealLiteral(expr.value === "1" || expr.value === "H" ? 1 : 0);
      case "bitString": {
        const bits = expandBitString(expr.value, expr.base ?? "B");
        return builder.addRealLiteral(bitsToUnsigned(bits));
      }
      case "others":
        return lowerExpr(expr.value);
      case "ident": {
        const k = expr.name.toLowerCase();
        const enumCode = enumToInt.get(k);
        if (enumCode !== undefined) return builder.addRealLiteral(enumCode);
        const vId = getOrAddVar(expr.name);
        return builder.addName(vId);
      }
      case "index": {
        const vId = getOrAddVar(expr.target);
        return builder.addName(vId);
      }
      case "slice": {
        const vId = getOrAddVar(expr.target);
        return builder.addName(vId);
      }
      case "attribute": {
        const vId = getOrAddVar(expr.target);
        return builder.addName(vId);
      }
      case "call": {
        if (expr.args.length > 0) return lowerExpr(expr.args[0]!);
        return builder.addRealLiteral(0);
      }
      case "unary": {
        const op = expr.op === "not" ? UnaryOp.Not : UnaryOp.Negate;
        return builder.addUnaryExpr(op, lowerExpr(expr.operand));
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
            return builder.addBinaryExpr(BinOp.Mul, l, r);
          case "/":
            return builder.addBinaryExpr(BinOp.Div, l, r);
          case "and":
            return builder.addBinaryExpr(BinOp.And, l, r);
          case "or":
            return builder.addBinaryExpr(BinOp.Or, l, r);
          case "nand":
            return builder.addUnaryExpr(UnaryOp.Not, builder.addBinaryExpr(BinOp.And, l, r));
          case "nor":
            return builder.addUnaryExpr(UnaryOp.Not, builder.addBinaryExpr(BinOp.Or, l, r));
          case "xor":
            return builder.addBinaryExpr(BinOp.Neq, l, r);
          case "xnor":
            return builder.addBinaryExpr(BinOp.Eq, l, r);
          case "=":
            return builder.addBinaryExpr(BinOp.Eq, l, r);
          case "/=":
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
      default:
        return builder.addRealLiteral(0);
    }
  };

  // Helper to lower sequential statements inside a process into conditional target expressions
  const lowerSeqTargets = (stmts: VhdlSeqStmt[], isClocked: boolean): void => {
    const collectAssignments = (list: VhdlSeqStmt[], condStack: number[]): void => {
      for (const s of list) {
        if (s.kind === "signalAssign") {
          const targetId = getOrAddVar(s.target.name);
          if (isClocked && !registerVarIndices.includes(targetId)) {
            registerVarIndices.push(targetId);
          }
          const rhs = lowerExpr(s.value);
          let finalRhs = rhs;
          for (let i = condStack.length - 1; i >= 0; i--) {
            finalRhs = builder.addIfElse(condStack[i]!, finalRhs, builder.addName(targetId));
          }
          builder.addEquation(isClocked ? EqKind.When : EqKind.Simple, builder.addName(targetId), finalRhs);
          equationCount++;
        } else if (s.kind === "if") {
          const clk = extractClockSignal(s.condition);
          if (clk) {
            collectAssignments(s.thenBranch, condStack);
          } else {
            const condExpr = lowerExpr(s.condition);
            collectAssignments(s.thenBranch, [...condStack, condExpr]);
            const negCond = builder.addUnaryExpr(UnaryOp.Not, condExpr);
            for (const ei of s.elsifs) {
              const eiClk = extractClockSignal(ei.condition);
              if (eiClk) {
                collectAssignments(ei.body, [...condStack, negCond]);
              } else {
                const eiCond = lowerExpr(ei.condition);
                collectAssignments(ei.body, [...condStack, negCond, eiCond]);
              }
            }
            if (s.elseBranch) {
              collectAssignments(s.elseBranch, [...condStack, negCond]);
            }
          }
        } else if (s.kind === "case") {
          const selExpr = lowerExpr(s.expr);
          for (const alt of s.alternatives) {
            const isOthers = alt.choices.some((c) => c.toLowerCase() === "others");
            if (isOthers) {
              collectAssignments(alt.body, condStack);
            } else {
              const ch = alt.choices[0]!.replace(/^['"]|['"]$/g, "");
              const enumCode = enumToInt.get(ch.toLowerCase());
              const litVal = enumCode !== undefined ? enumCode : /^[01]+$/.test(ch) ? bitsToUnsigned(ch) : 0;
              const matchCond = builder.addBinaryExpr(BinOp.Eq, selExpr, builder.addRealLiteral(litVal));
              collectAssignments(alt.body, [...condStack, matchCond]);
            }
          }
        }
      }
    };

    collectAssignments(stmts, []);
  };

  // 4. Lower concurrent statements
  if (arch) {
    for (const stmt of arch.statements) {
      if (stmt.kind === "condSignalAssign") {
        const targetId = getOrAddVar(stmt.target.name);
        let rhsExpr = lowerExpr(stmt.branches[stmt.branches.length - 1]!.value);
        for (let i = stmt.branches.length - 2; i >= 0; i--) {
          const br = stmt.branches[i]!;
          const cond = br.condition ? lowerExpr(br.condition) : builder.addRealLiteral(1);
          rhsExpr = builder.addIfElse(cond, lowerExpr(br.value), rhsExpr);
        }
        builder.addEquation(EqKind.Simple, builder.addName(targetId), rhsExpr);
        equationCount++;
      } else if (stmt.kind === "selectedSignalAssign") {
        const targetId = getOrAddVar(stmt.target.name);
        const selExpr = lowerExpr(stmt.selector);
        let rhsExpr = lowerExpr(stmt.alternatives[stmt.alternatives.length - 1]!.value);
        for (let i = stmt.alternatives.length - 2; i >= 0; i--) {
          const alt = stmt.alternatives[i]!;
          const ch = alt.choice.replace(/^['"]|['"]$/g, "");
          const litVal = /^[01]+$/.test(ch) ? bitsToUnsigned(ch) : 0;
          const cond = builder.addBinaryExpr(BinOp.Eq, selExpr, builder.addRealLiteral(litVal));
          rhsExpr = builder.addIfElse(cond, lowerExpr(alt.value), rhsExpr);
        }
        builder.addEquation(EqKind.Simple, builder.addName(targetId), rhsExpr);
        equationCount++;
      } else if (stmt.kind === "process") {
        const isClocked = stmt.body.some(
          (s) =>
            s.kind === "if" &&
            (extractClockSignal(s.condition) !== undefined ||
              s.elsifs.some((ei) => extractClockSignal(ei.condition) !== undefined)),
        );
        lowerSeqTargets(stmt.body, isClocked);
      }
    }
  }

  return {
    entityName: entity.name,
    variableMap,
    clockVarIndices,
    registerVarIndices,
    equationCount,
  };
}
