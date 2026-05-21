// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-based DAE printer — reads directly from ArenaDAEBuilder
 * without materializing any legacy ModelicaExpression objects.
 *
 * Moved from `@modelscript/symbolics/systems/arena-printer.ts` to
 * `@modelscript/compiler` to eliminate the dependency on the symbolics
 * package. Operator string constants are inlined to avoid importing
 * from `@modelscript/modelica/ast`.
 */

import type { Writer } from "@modelscript/utils";
import { BinOp, EqKind, ExprKind, StmtKind, UnaryOp, Variability, VarType, type ArenaDAEBuilder } from "./dae-arena.js";

// ── Inlined Modelica operator strings ──
// (Avoids circular dependency on @modelscript/modelica/ast)

const binOpStr: Record<number, string> = {
  [BinOp.Add]: "+",
  [BinOp.Sub]: "-",
  [BinOp.Mul]: "*",
  [BinOp.Div]: "/",
  [BinOp.Pow]: "^",
  [BinOp.ElemAdd]: ".+",
  [BinOp.ElemSub]: ".-",
  [BinOp.ElemMul]: ".*",
  [BinOp.ElemDiv]: "./",
  [BinOp.ElemPow]: ".^",
  [BinOp.And]: "and",
  [BinOp.Or]: "or",
  [BinOp.Eq]: "==",
  [BinOp.Neq]: "<>",
  [BinOp.Lt]: "<",
  [BinOp.Gt]: ">",
  [BinOp.Lte]: "<=",
  [BinOp.Gte]: ">=",
};

const unaryOpStr: Record<number, string> = {
  [UnaryOp.Negate]: "-",
  [UnaryOp.Not]: "not",
};

const HIGH_PREC_OPS = new Set([BinOp.Mul, BinOp.Div, BinOp.Pow, BinOp.ElemMul, BinOp.ElemDiv, BinOp.ElemPow]);
const LOW_PREC_OPS = new Set([
  BinOp.Add,
  BinOp.Sub,
  BinOp.ElemAdd,
  BinOp.ElemSub,
  BinOp.Lt,
  BinOp.Lte,
  BinOp.Gt,
  BinOp.Gte,
  BinOp.Eq,
  BinOp.Neq,
]);

export class ArenaDAEPrinter {
  private out: Writer;
  private depth = 0;
  private arena: ArenaDAEBuilder;

  constructor(out: Writer, arena: ArenaDAEBuilder) {
    this.out = out;
    this.arena = arena;
  }

  private indent(): string {
    return "  ".repeat(this.depth + 1);
  }

  // ── Expression printing ──

  printExpr(id: number): void {
    if (id < 0) {
      this.out.write("?");
      return;
    }
    const a = this.arena;
    switch (a.getExprKind(id)) {
      case ExprKind.Name:
        this.out.write(a.interner.resolve(a.getExprData1(id)));
        break;

      case ExprKind.IntLiteral:
        this.out.write(String(a.getExprData1(id)));
        break;

      case ExprKind.RealLiteral: {
        const v = a.getExprRealValue(id);
        if (v === 0) {
          this.out.write("0.0");
          break;
        }
        if (Number.isInteger(v) && Math.abs(v) < 1e7) {
          this.out.write(v.toFixed(1));
          break;
        }
        let s: string;
        if (Number.isInteger(v) && Math.abs(v) >= 1e7) s = v.toExponential();
        else if (Math.abs(v) < 0.0001 && Math.abs(v) > 0) s = v.toExponential();
        else s = v.toString();
        this.out.write(s.replace(/e\+/g, "e"));
        break;
      }

      case ExprKind.BoolLiteral:
        this.out.write(a.getExprData1(id) !== 0 ? "true" : "false");
        break;

      case ExprKind.StringLiteral: {
        const raw = a.interner.resolve(a.getExprData1(id));
        const indent = "  ".repeat(this.depth + 1);
        const result = (raw ?? "")
          .replace(/\\n/g, "\n" + indent)
          .replace(/\\t/g, "\t")
          .replace(/\\r/g, "\r")
          .replace(/\\\\/g, "\\")
          .replace(/"/g, '\\"');
        this.out.write('"' + result + '"');
        break;
      }

      case ExprKind.EnumLiteral: {
        const strVal = a.interner.resolve(a.getExprLeft(id));
        this.out.write('"' + strVal + '"');
        break;
      }

      case ExprKind.Binary: {
        const op = a.getExprData1(id) as BinOp;
        const lhs = a.getExprLeft(id);
        const rhs = a.getExprRight(id);
        const isHigh = HIGH_PREC_OPS.has(op);

        const needsParens = (childId: number, isRhs = false): boolean => {
          if (childId < 0) return false;
          const ck = a.getExprKind(childId);
          // For `Unary` inside high-precedence ops: only parenthesize word-based
          // unary ops (e.g. `not`), not numeric negation.  `-a * x` is unambiguous
          // since unary minus binds tighter than multiplication.
          if (isHigh && ck === ExprKind.Unary) {
            const uop = a.getExprData1(childId) as UnaryOp;
            if (uop !== UnaryOp.Negate) return true; // `not` etc. need parens
            // Negate only needs parens on RHS of subtraction to avoid `a - -b`
            return isRhs && op === BinOp.Sub;
          }
          // Dedicated Negate node: same logic
          if (ck === ExprKind.Negate) {
            return isRhs && op === BinOp.Sub;
          }
          if (isHigh && ck === ExprKind.Binary && LOW_PREC_OPS.has(a.getExprData1(childId) as BinOp)) return true;
          if (ck === ExprKind.IfElse) return true;
          return false;
        };

        if (needsParens(lhs)) {
          this.out.write("(");
          this.printExpr(lhs);
          this.out.write(")");
        } else this.printExpr(lhs);

        this.out.write(" " + (binOpStr[op] ?? "+") + " ");

        if (needsParens(rhs, true)) {
          this.out.write("(");
          this.printExpr(rhs);
          this.out.write(")");
        } else this.printExpr(rhs);
        break;
      }

      case ExprKind.Unary: {
        const uop = unaryOpStr[a.getExprData1(id) as UnaryOp] ?? "-";
        const sep = /[a-z]/i.test(uop) ? " " : "";
        this.out.write(uop + sep);
        const operand = a.getExprLeft(id);
        const needsP = operand >= 0 && a.getExprKind(operand) === ExprKind.Binary;
        if (needsP) this.out.write("(");
        this.printExpr(operand);
        if (needsP) this.out.write(")");
        break;
      }

      case ExprKind.Negate: {
        this.out.write("-");
        const operand = a.getExprLeft(id);
        const needsP = operand >= 0 && a.getExprKind(operand) === ExprKind.Binary;
        if (needsP) this.out.write("(");
        this.printExpr(operand);
        if (needsP) this.out.write(")");
        break;
      }

      case ExprKind.Call: {
        const fname = a.interner.resolve(a.getExprData1(id));
        const argCount = a.getExprRight(id);
        this.out.write(fname + "(");
        if (argCount > 0) this.printExpr(a.getExprLeft(id));
        for (let i = 1; i < argCount; i++) {
          this.out.write(", ");
          this.printExpr(a.getExprLeft(id + i));
        }
        this.out.write(")");
        break;
      }

      case ExprKind.Der:
        this.out.write("der(");
        this.printExpr(a.getExprData1(id));
        this.out.write(")");
        break;

      case ExprKind.Pre:
        this.out.write("pre(");
        this.printExpr(a.getExprData1(id));
        this.out.write(")");
        break;

      case ExprKind.IfElse:
        this.out.write("if ");
        this.printExpr(a.getExprData1(id));
        this.out.write(" then ");
        this.printExpr(a.getExprLeft(id));
        this.out.write(" else ");
        this.printExpr(a.getExprRight(id));
        break;

      case ExprKind.Range:
        this.printExpr(a.getExprData1(id));
        this.out.write(":");
        if (a.getExprLeft(id) >= 0) {
          this.printExpr(a.getExprLeft(id));
          this.out.write(":");
        }
        this.printExpr(a.getExprRight(id));
        break;

      case ExprKind.ArrayCtor: {
        const count = a.getExprData1(id);
        this.out.write("{");
        if (count > 0) this.printExpr(a.getExprLeft(id));
        for (let i = 1; i < count; i++) {
          this.out.write(", ");
          this.printExpr(a.getExprLeft(id + i));
        }
        this.out.write("}");
        break;
      }

      case ExprKind.Subscript: {
        this.printExpr(a.getExprData1(id));
        const scount = a.getExprRight(id);
        this.out.write("[");
        if (scount > 0) this.printExpr(a.getExprLeft(id));
        for (let i = 1; i < scount; i++) {
          this.out.write(",");
          this.printExpr(a.getExprLeft(id + i));
        }
        this.out.write("]");
        break;
      }

      case ExprKind.Tuple: {
        const tcount = a.getExprData1(id);
        this.out.write("(");
        if (tcount > 0) this.printExpr(a.getExprLeft(id));
        for (let i = 1; i < tcount; i++) {
          this.out.write(", ");
          this.printExpr(a.getExprLeft(id + i));
        }
        this.out.write(")");
        break;
      }

      case ExprKind.Colon:
        this.out.write(":");
        break;

      case ExprKind.Comprehension: {
        const cfn = a.interner.resolve(a.getExprData1(id));
        this.out.write(cfn + "(");
        this.printExpr(a.getExprLeft(id));
        this.out.write(")");
        break;
      }

      case ExprKind.PartialFunc: {
        const pfn = a.interner.resolve(a.getExprData1(id));
        const pcount = a.getExprRight(id);
        this.out.write("function " + pfn + "(");
        for (let i = 0; i < pcount; i++) {
          if (i > 0) this.out.write(", ");
          this.out.write("#(");
          this.printExpr(a.getExprLeft(id + i));
          this.out.write(")");
        }
        this.out.write(")");
        break;
      }

      case ExprKind.Object:
        this.out.write("{}");
        break;

      default:
        this.out.write("?");
    }
  }

  // ── Variable printing ──

  printVar(idx: number): void {
    const a = this.arena;
    this.out.write(this.indent());

    if (a.isVarProtected(idx)) this.out.write("protected ");

    const variability = a.getVarVariability(idx);
    const isFinal = a.isVarFinal(idx);
    if (isFinal && (variability === Variability.Parameter || variability === Variability.Constant))
      this.out.write("final ");

    if (variability === Variability.Discrete) this.out.write("discrete ");
    else if (variability === Variability.Parameter) this.out.write("parameter ");
    else if (variability === Variability.Constant) this.out.write("constant ");

    const causality = a.getVarCausality(idx);
    if (causality === 1) this.out.write("input ");
    else if (causality === 2) this.out.write("output ");

    const type = a.getVarType(idx);
    const customType = a.getVarCustomType(idx);
    if (type === VarType.Real) this.out.write(customType ?? "Real");
    else if (type === VarType.Integer) this.out.write("Integer");
    else if (type === VarType.Boolean) this.out.write("Boolean");
    else if (type === VarType.String) this.out.write("String");
    else if (type === VarType.Clock) this.out.write("Clock");
    else if (type === VarType.Enumeration) {
      const lits = a.getVarEnumerationLiterals(idx);
      if (lits)
        this.out.write("enumeration(" + lits.map((l: { stringValue: string }) => l.stringValue).join(", ") + ")");
      else this.out.write("enumeration()");
    }

    const shape = a.getVarShape(idx);
    if (shape.length > 0) this.out.write("[" + shape.join(", ") + "]");

    let varName = a.getVarName(idx);
    if (varName.startsWith("\0")) {
      const parts = varName.split("\0");
      if (parts.length >= 3) {
        if (shape.length === 0) this.out.write(parts[1] ?? "");
        varName = parts[2] ?? "";
      }
    }
    this.out.write(" " + varName);

    // Attributes
    const attrs = a.getVarAttrExprIds(idx);
    if (attrs && attrs.size > 0) {
      this.out.write("(");
      let i = 0;
      for (const [key, exprId] of attrs) {
        if (key === "unbounded") continue;
        if (i > 0) this.out.write(", ");
        this.out.write(key + " = ");
        this.printExpr(exprId);
        i++;
      }
      if (i > 0) this.out.write(")");
    }

    // Expression (binding)
    const expr = a.getVarExpression(idx);
    if (expr != null && typeof expr === "number" && expr >= 0) {
      this.out.write(" = ");
      this.printExpr(expr as number);
    }

    const desc = a.getVarDescription(idx);
    if (desc) this.out.write(' "' + desc + '"');

    const cad = a.getVarCadAnnotation(idx);
    if (cad) this.out.write(" annotation(" + cad + ")");

    this.out.write(";\n");
  }

  // ── Equation printing ──

  printEq(idx: number): void {
    const a = this.arena;
    const kind = a.getEqKind(idx);

    switch (kind) {
      case EqKind.Simple:
      case EqKind.InitialSimple:
      case EqKind.Array:
        this.out.write(this.indent());
        this.printExpr(a.getEqLhs(idx));
        this.out.write(" = ");
        this.printExpr(a.getEqRhs(idx));
        this.out.write(";\n");
        break;

      case EqKind.When: {
        const meta = a.getWhenEquationMeta(idx);
        if (meta) {
          this.out.write(this.indent() + "when ");
          this.printExpr(meta.conditionExprId);
          this.out.write(" then\n");
          this.depth++;
          for (const body of meta.bodyEquations) {
            this.printInlineEq(body);
          }
          this.depth--;
          for (const ew of meta.elseWhenClauses) {
            this.out.write(this.indent() + "elsewhen ");
            this.printExpr(ew.conditionExprId);
            this.out.write(" then\n");
            this.depth++;
            for (const body of ew.bodyEquations) {
              this.printInlineEq(body);
            }
            this.depth--;
          }
          this.out.write(this.indent() + "end when;\n");
        } else {
          // Fallback: print as simple
          this.out.write(this.indent());
          this.printExpr(a.getEqLhs(idx));
          this.out.write(" = ");
          this.printExpr(a.getEqRhs(idx));
          this.out.write(";\n");
        }
        break;
      }

      case EqKind.For:
      case EqKind.InitialFor: {
        const meta = a.getForEquationMeta(idx);
        if (meta) {
          const indexName = a.interner.resolve(meta.indexNameId);
          this.out.write(this.indent() + "for " + indexName + " in ");
          this.printExpr(meta.rangeExprId);
          this.out.write(" loop\n");
          this.depth++;
          for (const body of meta.bodyEquations) {
            this.printInlineEq(body);
          }
          this.depth--;
          this.out.write(this.indent() + "end for;\n");
        } else {
          // Fallback: print as simple
          this.out.write(this.indent());
          this.printExpr(a.getEqLhs(idx));
          this.out.write(" = ");
          this.printExpr(a.getEqRhs(idx));
          this.out.write(";\n");
        }
        break;
      }

      case EqKind.If: {
        const meta = a.getIfEquationMeta(idx);
        if (meta) {
          this.out.write(this.indent() + "if ");
          this.printExpr(meta.conditionExprId);
          this.out.write(" then\n");
          this.depth++;
          for (const body of meta.thenEquations) {
            this.printInlineEq(body);
          }
          this.depth--;
          for (const clause of meta.elseIfClauses) {
            this.out.write(this.indent() + "elseif ");
            this.printExpr(clause.conditionExprId);
            this.out.write(" then\n");
            this.depth++;
            for (const body of clause.bodyEquations) {
              this.printInlineEq(body);
            }
            this.depth--;
          }
          if (meta.elseEquations.length > 0) {
            this.out.write(this.indent() + "else\n");
            this.depth++;
            for (const body of meta.elseEquations) {
              this.printInlineEq(body);
            }
            this.depth--;
          }
          this.out.write(this.indent() + "end if;\n");
        } else {
          // Fallback: print as simple
          this.out.write(this.indent());
          this.printExpr(a.getEqLhs(idx));
          this.out.write(" = ");
          this.printExpr(a.getEqRhs(idx));
          this.out.write(";\n");
        }
        break;
      }

      case EqKind.FunctionCall:
        this.out.write(this.indent());
        this.printExpr(a.getEqLhs(idx));
        this.out.write(";\n");
        break;

      default:
        // Unknown equation kind: fall back to simple printing
        this.out.write(this.indent());
        this.printExpr(a.getEqLhs(idx));
        this.out.write(" = ");
        this.printExpr(a.getEqRhs(idx));
        this.out.write(";\n");
    }
  }

  /** Print an inline body equation (from when/for/if side-tables). */
  private printInlineEq(body: { kind: EqKind; lhsExprId: number; rhsExprId: number }): void {
    this.out.write(this.indent());
    if (body.kind === EqKind.FunctionCall) {
      this.printExpr(body.lhsExprId);
      this.out.write(";\n");
    } else {
      this.printExpr(body.lhsExprId);
      this.out.write(" = ");
      this.printExpr(body.rhsExprId);
      this.out.write(";\n");
    }
  }

  // ── Statement printing ──

  printStmt(idx: number): number {
    const a = this.arena;

    switch (a.getStmtKind(idx)) {
      case StmtKind.Assignment:
        this.out.write(this.indent());
        this.printExpr(a.getStmtData1(idx));
        this.out.write(" := ");
        this.printExpr(a.getStmtLeft(idx));
        this.out.write(";\n");
        return idx + 1;

      case StmtKind.Return:
        this.out.write(this.indent() + "return;\n");
        return idx + 1;

      case StmtKind.Break:
        this.out.write(this.indent() + "break;\n");
        return idx + 1;

      case StmtKind.ProcedureCall:
        this.out.write(this.indent());
        this.printExpr(a.getStmtData1(idx));
        this.out.write(";\n");
        return idx + 1;

      case StmtKind.For: {
        const indexName = a.interner.resolve(a.getStmtData1(idx));
        const bodyCount = a.getStmtRight(idx);
        this.out.write(this.indent() + "for " + indexName + " in ");
        this.printExpr(a.getStmtLeft(idx));
        this.out.write(" loop\n");
        this.depth++;
        let next = idx + 1;
        for (let i = 0; i < bodyCount; i++) next = this.printStmt(next);
        this.depth--;
        this.out.write(this.indent() + "end for;\n");
        return next;
      }

      case StmtKind.While: {
        const bodyCount = a.getStmtLeft(idx);
        this.out.write(this.indent() + "while ");
        this.printExpr(a.getStmtData1(idx));
        this.out.write(" loop\n");
        this.depth++;
        let next = idx + 1;
        for (let i = 0; i < bodyCount; i++) next = this.printStmt(next);
        this.depth--;
        this.out.write(this.indent() + "end while;\n");
        return next;
      }

      case StmtKind.If: {
        const thenCount = a.getStmtLeft(idx);
        const branchCount = a.getStmtRight(idx);
        this.out.write(this.indent() + "if ");
        this.printExpr(a.getStmtData1(idx));
        this.out.write(" then\n");
        this.depth++;
        let next = idx + 1;
        for (let i = 0; i < thenCount; i++) next = this.printStmt(next);
        this.depth--;
        for (let b = 0; b < branchCount; b++) {
          const blockCond = a.getStmtData1(next);
          const blockCount = a.getStmtLeft(next);
          next++;
          if (blockCond >= 0) {
            this.out.write(this.indent() + "elseif ");
            this.printExpr(blockCond);
            this.out.write(" then\n");
          } else {
            this.out.write(this.indent() + "else\n");
          }
          this.depth++;
          for (let i = 0; i < blockCount; i++) next = this.printStmt(next);
          this.depth--;
        }
        this.out.write(this.indent() + "end if;\n");
        return next;
      }

      case StmtKind.When: {
        const bodyCount = a.getStmtLeft(idx);
        const ewCount = a.getStmtRight(idx);
        this.out.write(this.indent() + "when ");
        this.printExpr(a.getStmtData1(idx));
        this.out.write(" then\n");
        this.depth++;
        let next = idx + 1;
        for (let i = 0; i < bodyCount; i++) next = this.printStmt(next);
        this.depth--;
        for (let b = 0; b < ewCount; b++) {
          const blockCond = a.getStmtData1(next);
          const blockCount = a.getStmtLeft(next);
          next++;
          this.out.write(this.indent() + "elsewhen ");
          this.printExpr(blockCond);
          this.out.write(" then\n");
          this.depth++;
          for (let i = 0; i < blockCount; i++) next = this.printStmt(next);
          this.depth--;
        }
        this.out.write(this.indent() + "end when;\n");
        return next;
      }

      case StmtKind.ComplexAssignment: {
        const tcount = a.getStmtData1(idx);
        this.out.write(this.indent() + "(");
        let next = idx + 1;
        for (let i = 0; i < tcount; i++) {
          if (i > 0) this.out.write(", ");
          const targetId = a.getStmtData1(next);
          if (targetId >= 0) this.printExpr(targetId);
          else this.out.write("_");
          next++;
        }
        this.out.write(") := ");
        this.printExpr(a.getStmtLeft(idx));
        this.out.write(";\n");
        return next;
      }

      default:
        return idx + 1;
    }
  }

  // ── Top-level DAE printing ──

  printDAE(dae: ArenaDAEBuilder): void {
    // Emit function definitions
    const sortedFns = Array.from(dae.functions.values()).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const fn of sortedFns) {
      this.printFunction(fn);
      this.out.write("\n\n");
    }

    this.out.write(dae.classKind + " " + dae.name);
    if (dae.description) this.out.write(' "' + dae.description + '"');
    this.out.write("\n");

    // Variables
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      this.printVar(i);
    }

    // Initial equations
    let hasInitEq = false;
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.InitialSimple || dae.getEqKind(i) === EqKind.InitialFor) {
        if (!hasInitEq) {
          this.out.write("initial equation\n");
          hasInitEq = true;
        }
        this.printEq(i);
      }
    }

    // Initial algorithms
    for (const sec of dae.initialAlgorithmSections) {
      if (sec.count > 0) {
        this.out.write("initial algorithm\n");
        let idx = sec.start;
        for (let i = 0; i < sec.count; i++) idx = this.printStmt(idx);
      }
    }

    // Equations
    let hasEq = false;
    for (let i = 0; i < dae.eqCount; i++) {
      const ek = dae.getEqKind(i);
      if (ek !== EqKind.InitialSimple && ek !== EqKind.InitialFor) {
        if (!hasEq) {
          this.out.write("equation\n");
          hasEq = true;
        }
        this.printEq(i);
      }
    }

    // Algorithms
    for (const sec of dae.algorithmSections) {
      if (sec.count > 0) {
        this.out.write("algorithm\n");
        let idx = sec.start;
        for (let i = 0; i < sec.count; i++) idx = this.printStmt(idx);
      }
    }

    this.out.write("end " + dae.name + ";\n");
  }

  printFunction(fn: ArenaDAEBuilder): void {
    if (fn.isImpure) this.out.write("impure ");
    this.out.write(fn.classKind + " " + fn.name);
    if (fn.description) this.out.write(' "' + fn.description + '"');
    this.out.write("\n");

    for (let i = 0; i < fn.varCount; i++) {
      if (fn.isVarRemoved(i)) continue;
      this.printVar(i);
    }

    let hasEq = false;
    for (let i = 0; i < fn.eqCount; i++) {
      if (!hasEq) {
        this.out.write("equation\n");
        hasEq = true;
      }
      this.printEq(i);
    }

    for (const sec of fn.algorithmSections) {
      if (sec.count > 0) {
        this.out.write("algorithm\n");
        let idx = sec.start;
        for (let i = 0; i < sec.count; i++) idx = this.printStmt(idx);
      }
    }

    if (fn.externalDecl) this.out.write("\n  " + fn.externalDecl + "\n");
    this.out.write("end " + fn.name + ";");

    for (const nested of fn.functions.values()) {
      this.out.write("\n\n");
      this.printFunction(nested);
    }
  }
}

/**
 * Convenience function: print an ArenaDAEBuilder to a string.
 */
export function printArenaDAE(arena: ArenaDAEBuilder): string {
  const chunks: string[] = [];
  const writer: Writer = {
    write: (s: string) => {
      chunks.push(s);
    },
  };
  const printer = new ArenaDAEPrinter(writer, arena);
  printer.printDAE(arena);
  return chunks.join("");
}
