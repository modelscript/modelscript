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

const ASSOCIATIVE_OPS = new Set([BinOp.Add, BinOp.Mul, BinOp.ElemAdd, BinOp.ElemMul, BinOp.And, BinOp.Or]);

export class ArenaDAEPrinter {
  private out: Writer;
  private depth = 0;
  private arena: ArenaDAEBuilder;
  private omcCompatibility: boolean;

  constructor(out: Writer, arena: ArenaDAEBuilder, omcCompatibility = false) {
    this.out = out;
    this.arena = arena;
    this.omcCompatibility = omcCompatibility;
  }

  private getExprRank(id: number): number {
    if (id < 0) return 99;
    switch (this.arena.getExprKind(id)) {
      case ExprKind.Call:
      case ExprKind.Der:
      case ExprKind.Pre:
        return 5;
      case ExprKind.IntLiteral:
      case ExprKind.RealLiteral:
      case ExprKind.BoolLiteral:
      case ExprKind.StringLiteral:
      case ExprKind.EnumLiteral:
        return 10;
      case ExprKind.Name:
      case ExprKind.Subscript:
        return 20;
      case ExprKind.Binary:
      case ExprKind.Unary:
      case ExprKind.Negate:
        return 30;
      default:
        return 40;
    }
  }

  private getExprStringFallback(id: number): string {
    if (id < 0) return "";
    const a = this.arena;
    switch (a.getExprKind(id)) {
      case ExprKind.Name:
        return a.interner.resolve(a.getExprData1(id)) ?? "";
      case ExprKind.EnumLiteral:
        return a.interner.resolve(a.getExprLeft(id)) ?? "";
      case ExprKind.IntLiteral:
        return String(a.getExprData1(id));
      case ExprKind.RealLiteral:
        return String(a.getExprRealValue(id));
      case ExprKind.BoolLiteral:
        return a.getExprData1(id) !== 0 ? "true" : "false";
      case ExprKind.StringLiteral:
        return a.interner.resolve(a.getExprData1(id)) ?? "";
      case ExprKind.Der:
        return `der(${this.getExprStringFallback(a.getExprData1(id))})`;
      default:
        return "";
    }
  }

  /**
   * Check if an expression is a numeric literal (Int or Real).
   */
  private isNumericLiteral(id: number): boolean {
    if (id < 0) return false;
    const k = this.arena.getExprKind(id);
    return k === ExprKind.IntLiteral || k === ExprKind.RealLiteral;
  }

  /**
   * Check if an expression is a negated numeric literal (Negate(lit) or Unary(Negate, lit)).
   */
  private isNegatedLiteral(id: number): boolean {
    if (id < 0) return false;
    const a = this.arena;
    const k = a.getExprKind(id);
    if (k === ExprKind.Negate) return this.isNumericLiteral(a.getExprLeft(id));
    if (k === ExprKind.Unary && (a.getExprData1(id) as UnaryOp) === UnaryOp.Negate)
      return this.isNumericLiteral(a.getExprLeft(id));
    return false;
  }

  /**
   * Get the numeric value of a literal expression (Int or Real).
   */
  private getNumericValue(id: number): number {
    const a = this.arena;
    if (a.getExprKind(id) === ExprKind.IntLiteral) return a.getExprData1(id);
    return a.getExprRealValue(id);
  }

  /**
   * Print a real value in OMC canonical format.
   */
  private printRealValue(v: number): void {
    if (v === 0) {
      this.out.write("0.0");
      return;
    }
    if (Number.isInteger(v) && Math.abs(v) < 1e7) {
      this.out.write(v.toFixed(1));
      return;
    }
    let s: string;
    if (Number.isInteger(v) && Math.abs(v) >= 1e7) s = v.toExponential();
    else if (Math.abs(v) < 0.0001 && Math.abs(v) > 0) s = v.toExponential();
    else s = v.toString();
    this.out.write(s.replace(/e\+/g, "e"));
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
      case ExprKind.Name: {
        const rawName = a.interner.resolve(a.getExprData1(id));
        if (rawName?.startsWith("\0loop\0")) {
          this.out.write(rawName.substring(6));
        } else {
          this.out.write(rawName ?? "");
        }
        break;
      }

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
        this.out.write(strVal ?? "");
        break;
      }

      case ExprKind.Binary: {
        const op = a.getExprData1(id) as BinOp;
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
            if (isRhs && op === BinOp.Sub) return true;
            // OMC wraps negated non-literal operands in parens when used in Mul: (-p[1]) * x
            if (op === BinOp.Mul || op === BinOp.ElemMul) {
              const inner = a.getExprLeft(childId);
              if (inner >= 0) {
                const ik = a.getExprKind(inner);
                if (ik !== ExprKind.RealLiteral && ik !== ExprKind.IntLiteral) return true;
              }
            }
            return false;
          }
          // Dedicated Negate node: same logic
          if (ck === ExprKind.Negate) {
            if (op === BinOp.Add) return true;
            if (isRhs && op === BinOp.Sub) return true;
            // OMC wraps negated non-literal operands in parens when used in Mul: (-p[1]) * x
            if (op === BinOp.Mul || op === BinOp.ElemMul) {
              const inner = a.getExprLeft(childId);
              if (inner >= 0) {
                const ik = a.getExprKind(inner);
                if (ik !== ExprKind.RealLiteral && ik !== ExprKind.IntLiteral) return true;
              }
            }
            return false;
          }
          if (isHigh && ck === ExprKind.Binary && LOW_PREC_OPS.has(a.getExprData1(childId) as BinOp)) return true;
          if (ck === ExprKind.IfElse) return true;
          return false;
        };

        // ── OMC algebraic identity: a - lit → -lit + a ──
        // Rewrite subtraction of a numeric literal into addition with
        // negated literal, then fall through to the Add associative path.
        if (op === BinOp.Sub && this.isNumericLiteral(a.getExprRight(id))) {
          const lhsId = a.getExprLeft(id);
          const rhsVal = this.getNumericValue(a.getExprRight(id));
          // Collect additive operands: flatten the LHS if it's also Add/Sub
          type VirtualOperand =
            | { exprId: number; virtual?: undefined; isInt?: undefined }
            | { exprId?: undefined; virtual: number; isInt: boolean };
          const operands: VirtualOperand[] = [];
          const collectAddSub = (nodeId: number): void => {
            if (nodeId < 0) return;
            const nk = a.getExprKind(nodeId);
            if (nk === ExprKind.Binary) {
              const nop = a.getExprData1(nodeId) as BinOp;
              if (nop === BinOp.Add) {
                collectAddSub(a.getExprLeft(nodeId));
                collectAddSub(a.getExprRight(nodeId));
                return;
              }
              if (nop === BinOp.Sub && this.isNumericLiteral(a.getExprRight(nodeId))) {
                collectAddSub(a.getExprLeft(nodeId));
                operands.push({
                  virtual: -this.getNumericValue(a.getExprRight(nodeId)),
                  isInt: a.getExprKind(a.getExprRight(nodeId)) === ExprKind.IntLiteral,
                });
                return;
              }
            }
            operands.push({ exprId: nodeId });
          };
          collectAddSub(lhsId);
          operands.push({
            virtual: -rhsVal,
            isInt: a.getExprKind(a.getExprRight(id)) === ExprKind.IntLiteral,
          });

          if (this.omcCompatibility) {
            // OMC canonicalization: For commutative binary chains, literals are bubbled to the front.
            const literals: VirtualOperand[] = [];
            const nonLiterals: VirtualOperand[] = [];
            for (const o of operands) {
              if (o.virtual !== undefined) literals.push(o);
              else nonLiterals.push(o);
            }
            operands.length = 0;
            operands.push(...literals, ...nonLiterals);
          }

          for (let i = 0; i < operands.length; i++) {
            if (i > 0) this.out.write(" + ");
            const o = operands[i] as VirtualOperand;
            if (o.virtual !== undefined) {
              if (o.isInt) {
                this.out.write(o.virtual.toString());
              } else {
                this.printRealValue(o.virtual);
              }
            } else {
              const cid = o.exprId as number;
              if (needsParens(cid, i > 0)) {
                this.out.write("(");
                this.printExpr(cid);
                this.out.write(")");
              } else {
                this.printExpr(cid);
              }
            }
          }
          break;
        }

        // ── OMC algebraic identity: a / lit → (1/lit) * a ──
        // Rewrite division by a numeric literal into multiplication by
        // its reciprocal, then fall through to the Mul associative path.
        if (op === BinOp.Div && this.isNumericLiteral(a.getExprRight(id))) {
          const lhsId = a.getExprLeft(id);
          const rhsVal = this.getNumericValue(a.getExprRight(id));
          if (rhsVal !== 0) {
            const reciprocal = 1 / rhsVal;
            // Collect multiplicative operands from LHS if also Mul
            type VirtualMulOp = { exprId: number; virtual?: undefined } | { exprId?: undefined; virtual: number };
            const operands: VirtualMulOp[] = [];
            const collectMul = (nodeId: number): void => {
              if (nodeId < 0) return;
              if (a.getExprKind(nodeId) === ExprKind.Binary && a.getExprData1(nodeId) === BinOp.Mul) {
                collectMul(a.getExprLeft(nodeId));
                collectMul(a.getExprRight(nodeId));
                return;
              }
              operands.push({ exprId: nodeId });
            };
            collectMul(lhsId);
            operands.push({ virtual: reciprocal });

            if (this.omcCompatibility) {
              // OMC canonicalization: For commutative binary chains, literals are bubbled to the front.
              const literals: VirtualMulOp[] = [];
              const nonLiterals: VirtualMulOp[] = [];
              for (const o of operands) {
                if (o.virtual !== undefined) literals.push(o);
                else nonLiterals.push(o);
              }
              operands.length = 0;
              operands.push(...literals, ...nonLiterals);
            }

            for (let i = 0; i < operands.length; i++) {
              if (i > 0) this.out.write(" * ");
              const o = operands[i] as VirtualMulOp;
              if (o.virtual !== undefined) {
                this.printRealValue(o.virtual);
              } else {
                const cid = o.exprId as number;
                if (needsParens(cid, i > 0)) {
                  this.out.write("(");
                  this.printExpr(cid);
                  this.out.write(")");
                } else {
                  this.printExpr(cid);
                }
              }
            }
            break;
          }
        }

        if (ASSOCIATIVE_OPS.has(op)) {
          // Flatten associative chain
          const operands: number[] = [];
          const collect = (nodeId: number) => {
            if (nodeId < 0) return;
            if (a.getExprKind(nodeId) === ExprKind.Binary && a.getExprData1(nodeId) === op) {
              collect(a.getExprLeft(nodeId));
              collect(a.getExprRight(nodeId));
            } else {
              operands.push(nodeId);
            }
          };
          collect(id);

          // Check if it's a string concatenation to avoid sorting
          let isStringConcat = false;
          if (op === BinOp.Add) {
            for (const childId of operands) {
              if (childId < 0) continue;
              const kind = a.getExprKind(childId);
              if (kind === ExprKind.StringLiteral) {
                isStringConcat = true;
                break;
              }
              if (kind === ExprKind.Call) {
                const nameId = a.getExprData1(childId);
                if (a.interner.resolve(nameId) === "String") {
                  isStringConcat = true;
                  break;
                }
              }
            }
          }

          if (this.omcCompatibility && !isStringConcat && (op === BinOp.Add || op === BinOp.Mul)) {
            // OMC canonicalization: bubble literals to the front, UNLESS the chain
            // contains a function call, derivative, or pre. OMC preserves order
            // when functions are involved.
            let hasCall = false;
            for (const childId of operands) {
              if (childId < 0) continue;
              const kind = a.getExprKind(childId);
              if (kind === ExprKind.Call || kind === ExprKind.Der || kind === ExprKind.Pre) {
                hasCall = true;
                break;
              }
            }

            if (!hasCall) {
              const literals: number[] = [];
              const nonLiterals: number[] = [];
              for (const childId of operands) {
                if (childId < 0) {
                  nonLiterals.push(childId);
                  continue;
                }
                const kind = a.getExprKind(childId);
                if (
                  kind === ExprKind.IntLiteral ||
                  kind === ExprKind.RealLiteral ||
                  kind === ExprKind.BoolLiteral ||
                  kind === ExprKind.StringLiteral ||
                  kind === ExprKind.EnumLiteral
                ) {
                  literals.push(childId);
                } else {
                  nonLiterals.push(childId);
                }
              }
              operands.length = 0;
              operands.push(...literals, ...nonLiterals);
            }
          }

          for (let i = 0; i < operands.length; i++) {
            if (i > 0) {
              this.out.write(" " + (binOpStr[op] ?? "+") + " ");
            }
            const childId = operands[i];
            if (needsParens(childId, i > 0)) {
              this.out.write("(");
              this.printExpr(childId);
              this.out.write(")");
            } else {
              this.printExpr(childId);
            }
          }
          break;
        }

        const lhs = a.getExprLeft(id);
        const rhs = a.getExprRight(id);
        let finalLhs = lhs;
        let finalRhs = rhs;
        if (this.omcCompatibility && op === BinOp.Mul) {
          const lKind = a.getExprKind(lhs);
          const rKind = a.getExprKind(rhs);
          const lIsLit =
            lKind === ExprKind.IntLiteral ||
            lKind === ExprKind.RealLiteral ||
            lKind === ExprKind.BoolLiteral ||
            lKind === ExprKind.StringLiteral;
          const rIsLit =
            rKind === ExprKind.IntLiteral ||
            rKind === ExprKind.RealLiteral ||
            rKind === ExprKind.BoolLiteral ||
            rKind === ExprKind.StringLiteral;
          if (rIsLit && !lIsLit) {
            finalLhs = rhs;
            finalRhs = lhs;
          }
        }

        if (needsParens(finalLhs)) {
          this.out.write("(");
          this.printExpr(finalLhs);
          this.out.write(")");
        } else this.printExpr(finalLhs);

        this.out.write(" " + (binOpStr[op] ?? "+") + " ");

        if (needsParens(finalRhs, true)) {
          this.out.write("(");
          this.printExpr(finalRhs);
          this.out.write(")");
        } else this.printExpr(finalRhs);
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

      case ExprKind.Object: {
        const fieldCount = a.getExprData1(id);
        this.out.write("{");
        if (fieldCount > 0) {
          // First field: name in right, value in left of Object header
          const firstName = a.interner.resolve(a.getExprRight(id));
          this.out.write(firstName + " = ");
          this.printExpr(a.getExprLeft(id));
          // Subsequent fields: name in data1, value in left of Tuple entries
          for (let i = 1; i < fieldCount; i++) {
            this.out.write(", ");
            const fieldName = a.interner.resolve(a.getExprData1(id + i));
            this.out.write(fieldName + " = ");
            this.printExpr(a.getExprLeft(id + i));
          }
        }
        this.out.write("}");
        break;
      }

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
    if (isFinal) this.out.write("final ");

    const type = a.getVarType(idx);
    if (
      variability === Variability.Discrete &&
      type !== VarType.Integer &&
      type !== VarType.Boolean &&
      type !== VarType.String &&
      type !== VarType.Enumeration
    )
      this.out.write("discrete ");
    else if (variability === Variability.Parameter) this.out.write("parameter ");
    else if (variability === Variability.Constant) this.out.write("constant ");

    const causality = a.getVarCausality(idx);
    const isNested = a.getVarName(idx).includes(".");
    if (!isNested) {
      if (causality === 1) this.out.write("input ");
      else if (causality === 2) this.out.write("output ");
    }

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
    const shapeExprs = a.getVarShapeExprs(idx);
    if (shapeExprs && shapeExprs.length > 0) {
      this.out.write("[");
      for (let i = 0; i < shapeExprs.length; i++) {
        if (i > 0) this.out.write(", ");
        const exprId = shapeExprs[i];
        if (exprId !== undefined) {
          this.printExpr(exprId);
        }
      }
      this.out.write("]");
    } else if (shape.length > 0) {
      const shapeStr = shape.map((s) => (s <= 0 ? ":" : String(s))).join(", ");
      this.out.write("[" + shapeStr + "]");
    }

    let varName = a.getVarName(idx);
    if (varName.startsWith("\0")) {
      const parts = varName.split("\0");
      if (parts.length >= 3) {
        if (shape.length === 0) this.out.write(parts[1] ?? "");
        varName = parts[2] ?? "";
      }
    }
    this.out.write(" " + varName);

    // Attributes — emit in OMC canonical order for consistent output
    const attrs = a.getVarAttrExprIds(idx);
    if (attrs && attrs.size > 0) {
      // OMC attribute ordering: quantity, unit, displayUnit, min, max, start, fixed, nominal, stateSelect, then others
      const ORDER: string[] = [
        "quantity",
        "unit",
        "displayUnit",
        "min",
        "max",
        "start",
        "fixed",
        "nominal",
        "stateSelect",
      ];
      const sortedKeys = [...attrs.keys()]
        .filter((k) => k !== "unbounded")
        .sort((a, b) => {
          const ai = ORDER.indexOf(a);
          const bi = ORDER.indexOf(b);
          if (ai >= 0 && bi >= 0) return ai - bi;
          if (ai >= 0) return -1;
          if (bi >= 0) return 1;
          return a.localeCompare(b);
        });
      if (sortedKeys.length > 0) {
        this.out.write("(");
        let first = true;
        for (const key of sortedKeys) {
          if (!first) this.out.write(", ");
          first = false;
          this.out.write(key + " = ");
          const exprId = attrs.get(key);
          if (exprId !== undefined) {
            this.printExpr(exprId);
          }
        }
        this.out.write(")");
      }
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
    if (cad) this.out.write(" annotation" + cad);

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

      case EqKind.Connect:
        // Do not print expanded connect equations, matching OMC output
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

        let validTargetCount = 0;
        let singleTargetId = -1;
        let singleTargetIndex = -1;

        let nextTarget = idx + 1;
        for (let i = 0; i < tcount; i++) {
          const targetId = a.getStmtData1(nextTarget);
          if (targetId >= 0) {
            validTargetCount++;
            singleTargetId = targetId;
            singleTargetIndex = i + 1;
          }
          nextTarget++;
        }

        if (validTargetCount === 1) {
          this.out.write(this.indent());
          this.printExpr(singleTargetId);
          this.out.write(" := ");
          this.printExpr(a.getStmtLeft(idx));
          this.out.write(`[${singleTargetIndex}];\n`);
          return nextTarget;
        }

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

    if (this.omcCompatibility) {
      this.out.write("class " + dae.name);
    } else {
      this.out.write(dae.classKind + " " + dae.name);
    }
    if (dae.description) this.out.write(' "' + dae.description + '"');
    this.out.write("\n");

    // Variables (order matches definition order, inline protected flags)
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
        if (this.isDeclarationBinding(dae, i)) continue;
        if (!hasEq) {
          this.out.write("equation\n");
          hasEq = true;
        }
        this.printEq(i);
      }
    }

    if (dae.equationAnnotations.length > 0) {
      if (!hasEq) {
        this.out.write("equation\n");
      }
      this.out.write(this.indent() + "annotation(" + dae.equationAnnotations.join(", ") + ");\n");
    }

    // Algorithms
    for (const sec of dae.algorithmSections) {
      if (sec.count > 0) {
        this.out.write("algorithm\n");
        let idx = sec.start;
        const end = sec.start + sec.count;
        while (idx < end) idx = this.printStmt(idx);
      }
    }

    if (dae.algorithmAnnotations.length > 0) {
      if (dae.algorithmSections.length === 0) {
        this.out.write("algorithm\n");
      }
      this.out.write(this.indent() + "annotation(" + dae.algorithmAnnotations.join(", ") + ");\n");
    }

    this.out.write("end " + dae.name + ";\n");
  }

  private isDeclarationBinding(a: ArenaDAEBuilder, idx: number): boolean {
    const kind = a.getEqKind(idx);
    if (kind === EqKind.Simple || kind === EqKind.Array) {
      const lhsId = a.getEqLhs(idx);
      if (a.getExprKind(lhsId) === ExprKind.Name) {
        const varNameId = a.getExprData1(lhsId);
        const varName = a.interner.resolve(varNameId);
        if (varName) {
          const varIdx = a.getVarIdxByName(varName);
          if (varIdx >= 0) {
            const varExpr = a.getVarExpression(varIdx);
            if (varExpr === a.getEqRhs(idx)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  printFunction(fn: ArenaDAEBuilder): void {
    const oldArena = this.arena;
    this.arena = fn;

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
      if (this.isDeclarationBinding(fn, i)) continue;
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
        const end = sec.start + sec.count;
        while (idx < end) idx = this.printStmt(idx);
      }
    }

    if (fn.equationAnnotations.length > 0) {
      if (!hasEq) {
        this.out.write("equation\n");
      }
      this.out.write(this.indent() + "annotation(" + fn.equationAnnotations.join(", ") + ");\n");
    }

    if (fn.algorithmAnnotations.length > 0) {
      if (fn.algorithmSections.length === 0) {
        this.out.write("algorithm\n");
      }
      this.out.write(this.indent() + "annotation(" + fn.algorithmAnnotations.join(", ") + ");\n");
    }

    if (fn.externalDecl) this.out.write("\n  " + fn.externalDecl + "\n");
    this.out.write("end " + fn.name + ";");

    for (const nested of fn.functions.values()) {
      this.out.write("\n\n");
      this.printFunction(nested);
    }

    this.arena = oldArena;
  }
}

/**
 * Convenience function: print an ArenaDAEBuilder to a string.
 */
export function printArenaDAE(arena: ArenaDAEBuilder, omcCompatibility = false): string {
  const chunks: string[] = [];
  const writer: Writer = {
    write: (s: string) => {
      chunks.push(s);
    },
  };
  const printer = new ArenaDAEPrinter(writer, arena, omcCompatibility);
  printer.printDAE(arena);
  return chunks.join("");
}
