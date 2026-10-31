// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formal Abstract Interpretation Verifier for Embedded & Simulation C Routines.
 *
 * Performs path-sensitive interval abstract interpretation over procedural `CStmt[]`
 * ASTs to statically prove the absence of—or pinpoint with exact line/column spans—
 * runtime safety violations:
 *   - Division or modulo by zero (`C_VERIFY_DIV_BY_ZERO`)
 *   - Transcendental/algebraic math domain violations (`C_VERIFY_MATH_DOMAIN`: `sqrt`, `log`, `log10`, `asin`, `acos`)
 *   - Out-of-bounds array indexing (`C_VERIFY_ARRAY_OUT_OF_BOUNDS`)
 *   - Null or uninitialized pointer dereferences (`C_VERIFY_NULL_DEREF`, `C_VERIFY_UNINIT_PTR_DEREF`)
 */

import { parseCScript, type CExpr, type CStmt } from "../ast.js";
import { preprocessCSegment } from "../preprocessor.js";

export interface NumericInterval {
  min: number;
  max: number;
}

export type PointerStatus = "valid" | "null" | "uninitialized" | "maybe_null";

export interface PointerAbstractState {
  status: PointerStatus;
  target?: string | undefined;
  size?: number | undefined;
}

export type CVerificationDiagnosticCode =
  | "C_VERIFY_DIV_BY_ZERO"
  | "C_VERIFY_MATH_DOMAIN"
  | "C_VERIFY_ARRAY_OUT_OF_BOUNDS"
  | "C_VERIFY_NULL_DEREF"
  | "C_VERIFY_UNINIT_PTR_DEREF";

export interface CVerificationDiagnostic {
  code: CVerificationDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  line: number;
  col: number;
  column: number;
  interval?: NumericInterval | undefined;
}

export interface CVerificationOptions {
  /** Initial abstract intervals for input ports or variables (e.g. `{ InA: { min: 0, max: 10 } }`). */
  inputIntervals?: Record<string, NumericInterval> | undefined;
  /** Known array sizes by name (e.g. `{ buf: 8 }`). */
  arraySizes?: Record<string, number> | undefined;
  /** Number of continuous real states (`statesReal`) if not declared via `#pragma state`. */
  numRealStates?: number | undefined;
  /** Number of discrete integer states (`statesInt`) if not declared via `#pragma state`. */
  numIntStates?: number | undefined;
}

export interface CVerificationResult {
  /** `true` iff zero safety violation diagnostics were emitted. */
  verified: boolean;
  /** Diagnostics emitted during abstract interpretation. */
  diagnostics: CVerificationDiagnostic[];
  /** Final abstract intervals for all analyzed variables. */
  intervals: Map<string, NumericInterval>;
  /** Final abstract pointer states for all analyzed pointer variables. */
  pointers: Map<string, PointerAbstractState>;
  /** Known array bounds tracked during analysis. */
  arrays: Map<string, number>;
}

interface AbstractEnv {
  intervals: Map<string, NumericInterval>;
  pointers: Map<string, PointerAbstractState>;
  arrays: Map<string, number>;
}

const TOP_INTERVAL: NumericInterval = { min: -Infinity, max: Infinity };

function cloneEnv(env: AbstractEnv): AbstractEnv {
  return {
    intervals: new Map(Array.from(env.intervals.entries(), ([k, v]) => [k, { min: v.min, max: v.max }])),
    pointers: new Map(Array.from(env.pointers.entries(), ([k, v]) => [k, { ...v }])),
    arrays: new Map(env.arrays),
  };
}

function joinIntervals(a: NumericInterval, b: NumericInterval): NumericInterval {
  return {
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
  };
}

function joinPointerStates(a: PointerAbstractState, b: PointerAbstractState): PointerAbstractState {
  if (a.status === b.status) {
    return {
      status: a.status,
      target: a.target === b.target ? a.target : undefined,
      size: a.size !== undefined && b.size !== undefined ? Math.min(a.size, b.size) : (a.size ?? b.size),
    };
  }
  if (a.status === "uninitialized" || b.status === "uninitialized") {
    return { status: "uninitialized" };
  }
  return { status: "maybe_null" };
}

function joinEnvs(a: AbstractEnv, b: AbstractEnv): AbstractEnv {
  const intervals = new Map<string, NumericInterval>();
  const allVars = new Set([...a.intervals.keys(), ...b.intervals.keys()]);
  for (const k of allVars) {
    const ia = a.intervals.get(k);
    const ib = b.intervals.get(k);
    if (ia && ib) intervals.set(k, joinIntervals(ia, ib));
    else intervals.set(k, ia ? { ...ia } : ib ? { ...ib } : { ...TOP_INTERVAL });
  }

  const pointers = new Map<string, PointerAbstractState>();
  const allPtrs = new Set([...a.pointers.keys(), ...b.pointers.keys()]);
  for (const k of allPtrs) {
    const pa = a.pointers.get(k);
    const pb = b.pointers.get(k);
    if (pa && pb) pointers.set(k, joinPointerStates(pa, pb));
    else pointers.set(k, pa ? { ...pa } : pb ? { ...pb } : { status: "uninitialized" });
  }

  const arrays = new Map<string, number>([...a.arrays.entries(), ...b.arrays.entries()]);
  return { intervals, pointers, arrays };
}

function isNullExpr(expr: CExpr): boolean {
  if (expr.kind === "boolean" && expr.isNull) return true;
  if (expr.kind === "number" && expr.value === 0) return true;
  if (expr.kind === "var" && expr.name === "NULL") return true;
  if (expr.kind === "cast" && isNullExpr(expr.expr)) return true;
  return false;
}

function formatInterval(iv: NumericInterval): string {
  const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(6)).toString() : n < 0 ? "-Inf" : "+Inf");
  return `[${fmt(iv.min)}, ${fmt(iv.max)}]`;
}

/**
 * Perform formal interval abstract interpretation on a C source string or `CStmt[]` AST.
 */
export function verifyCRoutine(sourceOrAst: string | CStmt[], options: CVerificationOptions = {}): CVerificationResult {
  let stmts: CStmt[];
  let pragmaRealStates = options.numRealStates;
  let pragmaIntStates = options.numIntStates;

  if (typeof sourceOrAst === "string") {
    const prep = preprocessCSegment(sourceOrAst);
    if (pragmaRealStates === undefined && prep.numRealStates > 0) {
      pragmaRealStates = prep.numRealStates;
    }
    if (pragmaIntStates === undefined && prep.numIntStates > 0) {
      pragmaIntStates = prep.numIntStates;
    }
    // Parse original source lines (replacing non-blank preprocessor directive lines with empty lines
    // so 1-indexed line numbers match the original source text)
    const preservedLines = sourceOrAst
      .split(/\r?\n/)
      .map((line) => (line.trim().startsWith("#") ? "" : line))
      .join("\n");
    stmts = parseCScript(preservedLines);
  } else {
    stmts = sourceOrAst;
  }

  const diagnostics: CVerificationDiagnostic[] = [];
  const emittedKeys = new Set<string>();

  function emit(
    code: CVerificationDiagnosticCode,
    severity: "error" | "warning",
    message: string,
    line = 1,
    col = 1,
    interval?: NumericInterval,
  ): void {
    const key = `${code}:${line}:${col}:${message}`;
    if (emittedKeys.has(key)) return;
    emittedKeys.add(key);
    diagnostics.push({
      code,
      severity,
      message,
      line,
      col,
      column: col,
      ...(interval ? { interval } : {}),
    });
  }

  const env: AbstractEnv = {
    intervals: new Map<string, NumericInterval>(),
    pointers: new Map<string, PointerAbstractState>(),
    arrays: new Map<string, number>(),
  };

  // Seed simulation special constants and state arrays
  env.intervals.set("TIME", { min: 0, max: 1e6 });
  env.intervals.set("DT", { min: 1e-6, max: 0.1 });
  env.intervals.set("FIRST_STEP", { min: 0, max: 1 });

  if (pragmaRealStates !== undefined) {
    env.arrays.set("statesReal", pragmaRealStates);
    env.arrays.set("storf", pragmaRealStates);
    env.arrays.set("s", pragmaRealStates);
    env.arrays.set("x", pragmaRealStates);
  }
  if (pragmaIntStates !== undefined) {
    env.arrays.set("statesInt", pragmaIntStates);
    env.arrays.set("stori", pragmaIntStates);
  }
  if (options.arraySizes) {
    for (const [arrName, size] of Object.entries(options.arraySizes)) {
      env.arrays.set(arrName, size);
    }
  }
  if (options.inputIntervals) {
    for (const [k, iv] of Object.entries(options.inputIntervals)) {
      env.intervals.set(k, { min: iv.min, max: iv.max });
    }
  }

  function checkPointerDeref(
    ptrName: string,
    curEnv: AbstractEnv,
    line = 1,
    col = 1,
  ): PointerAbstractState | undefined {
    const pState = curEnv.pointers.get(ptrName);
    if (!pState) return undefined;
    if (pState.status === "null" || pState.status === "maybe_null") {
      emit(
        "C_VERIFY_NULL_DEREF",
        "error",
        `Potential null pointer dereference of '${ptrName}' (status: ${pState.status}).`,
        line,
        col,
      );
    } else if (pState.status === "uninitialized") {
      emit("C_VERIFY_UNINIT_PTR_DEREF", "error", `Dereference of uninitialized pointer '${ptrName}'.`, line, col);
    }
    return pState;
  }

  function checkSubscriptAccess(
    arrayName: string,
    indexExpr: CExpr,
    curEnv: AbstractEnv,
    line = 1,
    col = 1,
  ): NumericInterval {
    const idxIv = evalAbstractExpr(indexExpr, curEnv);
    const pState = curEnv.pointers.get(arrayName);
    if (pState) {
      checkPointerDeref(arrayName, curEnv, line, col);
      if (pState.size !== undefined) {
        if (idxIv.min < 0 || idxIv.max >= pState.size) {
          emit(
            "C_VERIFY_ARRAY_OUT_OF_BOUNDS",
            "error",
            `Index interval ${formatInterval(idxIv)} on pointer '${arrayName}' exceeds valid bounds [0, ${pState.size - 1}].`,
            indexExpr.line ?? line,
            indexExpr.col ?? col,
            idxIv,
          );
        }
      }
      return idxIv;
    }

    const size = curEnv.arrays.get(arrayName);
    if (size !== undefined) {
      if (idxIv.min < 0 || idxIv.max >= size) {
        emit(
          "C_VERIFY_ARRAY_OUT_OF_BOUNDS",
          "error",
          `Array index interval ${formatInterval(idxIv)} is out of bounds for '${arrayName}[${size}]' (valid range: [0, ${Math.max(0, size - 1)}]).`,
          indexExpr.line ?? line,
          indexExpr.col ?? col,
          idxIv,
        );
      }
    } else if (idxIv.max < 0) {
      emit(
        "C_VERIFY_ARRAY_OUT_OF_BOUNDS",
        "error",
        `Negative array index interval ${formatInterval(idxIv)} on '${arrayName}'.`,
        indexExpr.line ?? line,
        indexExpr.col ?? col,
        idxIv,
      );
    }
    return idxIv;
  }

  function evalAbstractExpr(expr: CExpr, curEnv: AbstractEnv): NumericInterval {
    switch (expr.kind) {
      case "number":
        return { min: expr.value, max: expr.value };
      case "boolean":
        return { min: expr.value ? 1 : 0, max: expr.value ? 1 : 0 };
      case "string":
        return { min: 0, max: 0 };
      case "var":
        return curEnv.intervals.get(expr.name) ?? { ...TOP_INTERVAL };
      case "port":
        return curEnv.intervals.get(expr.portName) ?? curEnv.intervals.get(`$${expr.portName}`) ?? { ...TOP_INTERVAL };
      case "special":
        return curEnv.intervals.get(expr.name) ?? { ...TOP_INTERVAL };
      case "subscript": {
        checkSubscriptAccess(expr.arrayName, expr.indexExpr, curEnv, expr.line ?? 1, expr.col ?? 1);
        return curEnv.intervals.get(`${expr.arrayName}[]`) ?? { ...TOP_INTERVAL };
      }
      case "deref": {
        if (expr.expr.kind === "var") {
          const pState = checkPointerDeref(expr.expr.name, curEnv, expr.line ?? 1, expr.col ?? 1);
          if (pState?.target) {
            return curEnv.intervals.get(pState.target) ?? { ...TOP_INTERVAL };
          }
        } else {
          evalAbstractExpr(expr.expr, curEnv);
        }
        return { ...TOP_INTERVAL };
      }
      case "addressof":
        return { min: 1, max: 1 };
      case "cast": {
        const inner = evalAbstractExpr(expr.expr, curEnv);
        const t = expr.targetType.trim().toLowerCase();
        if (t === "bool") {
          if (inner.min > 0 || inner.max < 0) return { min: 1, max: 1 };
          if (inner.min === 0 && inner.max === 0) return { min: 0, max: 0 };
          return { min: 0, max: 1 };
        }
        if (
          t === "int" ||
          t === "int32_t" ||
          t === "short" ||
          t === "long" ||
          t === "char" ||
          t === "size_t" ||
          t === "uint32_t"
        ) {
          return {
            min: Number.isFinite(inner.min) ? Math.trunc(inner.min) : inner.min,
            max: Number.isFinite(inner.max) ? Math.trunc(inner.max) : inner.max,
          };
        }
        return inner;
      }
      case "ternary": {
        const condIv = evalAbstractExpr(expr.cond, curEnv);
        if (condIv.min > 0 || condIv.max < 0) {
          const refinedThen = refineEnvByCondition(expr.cond, true, cloneEnv(curEnv));
          return evalAbstractExpr(expr.thenExpr, refinedThen);
        }
        if (condIv.min === 0 && condIv.max === 0) {
          const refinedElse = refineEnvByCondition(expr.cond, false, cloneEnv(curEnv));
          return evalAbstractExpr(expr.elseExpr, refinedElse);
        }
        const refinedThen = refineEnvByCondition(expr.cond, true, cloneEnv(curEnv));
        const refinedElse = refineEnvByCondition(expr.cond, false, cloneEnv(curEnv));
        const thenIv = evalAbstractExpr(expr.thenExpr, refinedThen);
        const elseIv = evalAbstractExpr(expr.elseExpr, refinedElse);
        return joinIntervals(thenIv, elseIv);
      }
      case "unary": {
        const inner = evalAbstractExpr(expr.expr, curEnv);
        if (expr.op === "-") {
          return { min: -inner.max, max: -inner.min };
        }
        if (expr.op === "+") {
          return inner;
        }
        if (expr.op === "!") {
          if (inner.min === 0 && inner.max === 0) return { min: 1, max: 1 };
          if (inner.min > 0 || inner.max < 0) return { min: 0, max: 0 };
          return { min: 0, max: 1 };
        }
        return { ...TOP_INTERVAL };
      }
      case "binary": {
        const l = evalAbstractExpr(expr.left, curEnv);
        const r = evalAbstractExpr(expr.right, curEnv);
        switch (expr.op) {
          case "+":
            return { min: l.min + r.min, max: l.max + r.max };
          case "-":
            return { min: l.min - r.max, max: l.max - r.min };
          case "*": {
            const products = [l.min * r.min, l.min * r.max, l.max * r.min, l.max * r.max].filter(
              (v) => !Number.isNaN(v),
            );
            if (products.length === 0) return { ...TOP_INTERVAL };
            return { min: Math.min(...products), max: Math.max(...products) };
          }
          case "/":
          case "%": {
            if (r.min <= 0 && r.max >= 0) {
              emit(
                "C_VERIFY_DIV_BY_ZERO",
                "error",
                r.min === 0 && r.max === 0
                  ? `Division by zero: divisor evaluates to constant 0.`
                  : `Potential division by zero: divisor interval ${formatInterval(r)} contains 0.`,
                expr.right.line ?? expr.line ?? 1,
                expr.right.col ?? expr.col ?? 1,
                r,
              );
              return { ...TOP_INTERVAL };
            }
            if (expr.op === "%") {
              const bound = Math.max(Math.abs(r.min), Math.abs(r.max)) - 1;
              return { min: l.min >= 0 ? 0 : -bound, max: bound };
            }
            const quotients = [l.min / r.min, l.min / r.max, l.max / r.min, l.max / r.max].filter(
              (v) => !Number.isNaN(v),
            );
            return { min: Math.min(...quotients), max: Math.max(...quotients) };
          }
          case "<":
            if (l.max < r.min) return { min: 1, max: 1 };
            if (l.min >= r.max) return { min: 0, max: 0 };
            return { min: 0, max: 1 };
          case "<=":
            if (l.max <= r.min) return { min: 1, max: 1 };
            if (l.min > r.max) return { min: 0, max: 0 };
            return { min: 0, max: 1 };
          case ">":
            if (l.min > r.max) return { min: 1, max: 1 };
            if (l.max <= r.min) return { min: 0, max: 0 };
            return { min: 0, max: 1 };
          case ">=":
            if (l.min >= r.max) return { min: 1, max: 1 };
            if (l.max < r.min) return { min: 0, max: 0 };
            return { min: 0, max: 1 };
          case "==":
            if (l.min === l.max && r.min === r.max && l.min === r.min) return { min: 1, max: 1 };
            if (l.max < r.min || r.max < l.min) return { min: 0, max: 0 };
            return { min: 0, max: 1 };
          case "!=":
            if (l.max < r.min || r.max < l.min) return { min: 1, max: 1 };
            if (l.min === l.max && r.min === r.max && l.min === r.min) return { min: 0, max: 0 };
            return { min: 0, max: 1 };
          default:
            return { min: 0, max: 1 };
        }
      }
      case "math":
      case "call": {
        const fnName = (expr.kind === "math" ? expr.func : expr.callee).toLowerCase();
        const argIntervals = expr.args.map((a) => evalAbstractExpr(a, curEnv));
        const a0 = argIntervals[0] ?? TOP_INTERVAL;
        const a1 = argIntervals[1] ?? TOP_INTERVAL;
        const locLine = expr.args[0]?.line ?? expr.line ?? 1;
        const locCol = expr.args[0]?.col ?? expr.col ?? 1;

        if (fnName === "sqrt") {
          if (a0.min < 0) {
            emit(
              "C_VERIFY_MATH_DOMAIN",
              "error",
              `Math domain violation in 'sqrt': argument interval ${formatInterval(a0)} includes negative values.`,
              locLine,
              locCol,
              a0,
            );
          }
          return {
            min: Math.sqrt(Math.max(0, a0.min)),
            max: Math.sqrt(Math.max(0, a0.max)),
          };
        }
        if (fnName === "log" || fnName === "log10") {
          if (a0.min <= 0) {
            emit(
              "C_VERIFY_MATH_DOMAIN",
              "error",
              `Math domain violation in '${fnName}': argument interval ${formatInterval(a0)} includes non-positive values (<= 0).`,
              locLine,
              locCol,
              a0,
            );
          }
          const fn = fnName === "log10" ? Math.log10 : Math.log;
          return {
            min: a0.min > 0 ? fn(a0.min) : -Infinity,
            max: a0.max > 0 ? fn(a0.max) : Infinity,
          };
        }
        if (fnName === "asin" || fnName === "acos") {
          if (a0.min < -1 || a0.max > 1) {
            emit(
              "C_VERIFY_MATH_DOMAIN",
              "error",
              `Math domain violation in '${fnName}': argument interval ${formatInterval(a0)} exceeds valid domain [-1, 1].`,
              locLine,
              locCol,
              a0,
            );
          }
          return fnName === "asin" ? { min: -Math.PI / 2, max: Math.PI / 2 } : { min: 0, max: Math.PI };
        }
        if (fnName === "sin" || fnName === "cos") {
          return { min: -1, max: 1 };
        }
        if (fnName === "fabs" || fnName === "abs") {
          if (a0.min >= 0) return a0;
          if (a0.max <= 0) return { min: -a0.max, max: -a0.min };
          return { min: 0, max: Math.max(-a0.min, a0.max) };
        }
        if (fnName === "exp") {
          return { min: Math.exp(a0.min), max: Math.exp(a0.max) };
        }
        if (fnName === "fmin") {
          return { min: Math.min(a0.min, a1.min), max: Math.min(a0.max, a1.max) };
        }
        if (fnName === "fmax") {
          return { min: Math.max(a0.min, a1.min), max: Math.max(a0.max, a1.max) };
        }
        return { ...TOP_INTERVAL };
      }
    }
  }

  /**
   * Refine an abstract environment assuming `cond` holds (`branch = true`) or does not hold (`branch = false`).
   */
  function refineEnvByCondition(cond: CExpr, branch: boolean, targetEnv: AbstractEnv): AbstractEnv {
    if (cond.kind === "unary" && cond.op === "!") {
      return refineEnvByCondition(cond.expr, !branch, targetEnv);
    }
    if (cond.kind === "binary" && cond.op === "&&" && branch) {
      refineEnvByCondition(cond.left, true, targetEnv);
      refineEnvByCondition(cond.right, true, targetEnv);
      return targetEnv;
    }
    if (cond.kind === "binary" && cond.op === "||" && !branch) {
      refineEnvByCondition(cond.left, false, targetEnv);
      refineEnvByCondition(cond.right, false, targetEnv);
      return targetEnv;
    }

    // Pointer truthiness: `if (p)` or `if (p != NULL)`
    if (cond.kind === "var" && targetEnv.pointers.has(cond.name)) {
      const curPtr = targetEnv.pointers.get(cond.name)!;
      targetEnv.pointers.set(cond.name, {
        ...curPtr,
        status: branch ? "valid" : "null",
      });
      return targetEnv;
    }

    if (cond.kind === "binary" && cond.left.kind === "var") {
      const varName = cond.left.name;
      if (targetEnv.pointers.has(varName) && isNullExpr(cond.right)) {
        const curPtr = targetEnv.pointers.get(varName)!;
        if ((cond.op === "!=" && branch) || (cond.op === "==" && !branch)) {
          targetEnv.pointers.set(varName, { ...curPtr, status: "valid" });
        } else if ((cond.op === "==" && branch) || (cond.op === "!=" && !branch)) {
          targetEnv.pointers.set(varName, { ...curPtr, status: "null" });
        }
        return targetEnv;
      }

      const rhsIv = evalAbstractExpr(cond.right, targetEnv);
      const curIv = targetEnv.intervals.get(varName) ?? { ...TOP_INTERVAL };
      const EPS = 1e-9;

      let effectiveOp = cond.op;
      if (!branch) {
        effectiveOp =
          cond.op === "<"
            ? ">="
            : cond.op === "<="
              ? ">"
              : cond.op === ">"
                ? "<="
                : cond.op === ">="
                  ? "<"
                  : cond.op === "=="
                    ? "!="
                    : cond.op === "!="
                      ? "=="
                      : cond.op;
      }

      if (effectiveOp === ">") {
        targetEnv.intervals.set(varName, {
          min: Math.max(curIv.min, rhsIv.min === 0 ? EPS : rhsIv.min + EPS),
          max: curIv.max,
        });
      } else if (effectiveOp === ">=") {
        targetEnv.intervals.set(varName, {
          min: Math.max(curIv.min, rhsIv.min),
          max: curIv.max,
        });
      } else if (effectiveOp === "<") {
        targetEnv.intervals.set(varName, {
          min: curIv.min,
          max: Math.min(curIv.max, rhsIv.max === 0 ? -EPS : rhsIv.max - EPS),
        });
      } else if (effectiveOp === "<=") {
        targetEnv.intervals.set(varName, {
          min: curIv.min,
          max: Math.min(curIv.max, rhsIv.max),
        });
      } else if (effectiveOp === "==") {
        targetEnv.intervals.set(varName, {
          min: Math.max(curIv.min, rhsIv.min),
          max: Math.min(curIv.max, rhsIv.max),
        });
      } else if (effectiveOp === "!=" && rhsIv.min === 0 && rhsIv.max === 0) {
        if (curIv.min >= 0) {
          targetEnv.intervals.set(varName, { min: Math.max(curIv.min, EPS), max: curIv.max });
        } else if (curIv.max <= 0) {
          targetEnv.intervals.set(varName, { min: curIv.min, max: Math.min(curIv.max, -EPS) });
        } else {
          // Non-zero guaranteed
          targetEnv.intervals.set(varName, { min: EPS, max: Math.max(Math.abs(curIv.min), Math.abs(curIv.max)) });
        }
      }
    }

    return targetEnv;
  }

  function interpBlock(block: CStmt[], curEnv: AbstractEnv): void {
    for (const s of block) {
      interpStmt(s, curEnv);
    }
  }

  function interpStmt(s: CStmt, curEnv: AbstractEnv): void {
    switch (s.kind) {
      case "block": {
        interpBlock(s.body, curEnv);
        break;
      }
      case "func": {
        const fnEnv = cloneEnv(curEnv);
        for (const p of s.params) {
          if (p.isPointer) {
            fnEnv.pointers.set(p.name, { status: "valid" });
          } else if (!fnEnv.intervals.has(p.name)) {
            fnEnv.intervals.set(p.name, { ...TOP_INTERVAL });
          }
        }
        interpBlock(s.body, fnEnv);
        break;
      }
      case "decl": {
        if (s.arraySize !== undefined) {
          curEnv.arrays.set(s.name, s.arraySize);
          if (s.initElements && s.initElements.length > 0) {
            let joined = evalAbstractExpr(s.initElements[0]!, curEnv);
            for (let i = 1; i < s.initElements.length; i++) {
              joined = joinIntervals(joined, evalAbstractExpr(s.initElements[i]!, curEnv));
            }
            curEnv.intervals.set(`${s.name}[]`, joined);
          } else {
            curEnv.intervals.set(`${s.name}[]`, { min: 0, max: 0 });
          }
          break;
        }
        if (s.isPointer) {
          if (!s.init) {
            curEnv.pointers.set(s.name, { status: "uninitialized" });
          } else if (isNullExpr(s.init)) {
            curEnv.pointers.set(s.name, { status: "null" });
          } else if (s.init.kind === "addressof") {
            const arrCap = curEnv.arrays.get(s.init.varName);
            curEnv.pointers.set(s.name, {
              status: "valid",
              target: s.init.varName,
              size: arrCap ?? 1,
            });
          } else if (s.init.kind === "var" && curEnv.arrays.has(s.init.name)) {
            curEnv.pointers.set(s.name, {
              status: "valid",
              target: s.init.name,
              size: curEnv.arrays.get(s.init.name),
            });
          } else if (s.init.kind === "var" && curEnv.pointers.has(s.init.name)) {
            curEnv.pointers.set(s.name, { ...curEnv.pointers.get(s.init.name)! });
          } else {
            const iv = evalAbstractExpr(s.init, curEnv);
            curEnv.pointers.set(s.name, {
              status: iv.min === 0 && iv.max === 0 ? "null" : "valid",
            });
          }
          break;
        }
        if (s.init !== undefined) {
          curEnv.intervals.set(s.name, evalAbstractExpr(s.init, curEnv));
        } else {
          curEnv.intervals.set(s.name, { min: 0, max: 0 });
        }
        break;
      }
      case "assign": {
        if (s.target.type === "var" && curEnv.pointers.has(s.target.name)) {
          if (isNullExpr(s.expr)) {
            curEnv.pointers.set(s.target.name, { status: "null" });
          } else if (s.expr.kind === "addressof") {
            curEnv.pointers.set(s.target.name, {
              status: "valid",
              target: s.expr.varName,
              size: curEnv.arrays.get(s.expr.varName) ?? 1,
            });
          } else if (s.expr.kind === "var" && curEnv.arrays.has(s.expr.name)) {
            curEnv.pointers.set(s.target.name, {
              status: "valid",
              target: s.expr.name,
              size: curEnv.arrays.get(s.expr.name),
            });
          } else {
            const rhsIv = evalAbstractExpr(s.expr, curEnv);
            curEnv.pointers.set(s.target.name, {
              status: rhsIv.min === 0 && rhsIv.max === 0 ? "null" : "valid",
            });
          }
          break;
        }

        const rhsIv = evalAbstractExpr(s.expr, curEnv);
        if (s.target.type === "deref") {
          const pState = checkPointerDeref(s.target.pointerName, curEnv, s.line ?? 1, s.col ?? 1);
          if (pState?.target) {
            curEnv.intervals.set(pState.target, rhsIv);
          }
          break;
        }
        if (s.target.type === "subscript") {
          checkSubscriptAccess(s.target.arrayName, s.target.indexExpr, curEnv, s.line ?? 1, s.col ?? 1);
          if (s.op === "/=" && rhsIv.min <= 0 && rhsIv.max >= 0) {
            emit(
              "C_VERIFY_DIV_BY_ZERO",
              "error",
              `Potential division by zero in '/=' assignment: divisor interval ${formatInterval(rhsIv)} contains 0.`,
              s.expr.line ?? s.line ?? 1,
              s.expr.col ?? s.col ?? 1,
              rhsIv,
            );
          }
          const prevElem = curEnv.intervals.get(`${s.target.arrayName}[]`);
          curEnv.intervals.set(`${s.target.arrayName}[]`, prevElem ? joinIntervals(prevElem, rhsIv) : rhsIv);
          break;
        }

        const targetName = s.target.type === "var" ? s.target.name : `$${s.target.portName}`;
        const prevIv = curEnv.intervals.get(targetName) ?? { min: 0, max: 0 };
        if (s.op === "=") {
          curEnv.intervals.set(targetName, rhsIv);
        } else if (s.op === "+=") {
          curEnv.intervals.set(targetName, { min: prevIv.min + rhsIv.min, max: prevIv.max + rhsIv.max });
        } else if (s.op === "-=") {
          curEnv.intervals.set(targetName, { min: prevIv.min - rhsIv.max, max: prevIv.max - rhsIv.min });
        } else if (s.op === "*=") {
          const products = [
            prevIv.min * rhsIv.min,
            prevIv.min * rhsIv.max,
            prevIv.max * rhsIv.min,
            prevIv.max * rhsIv.max,
          ];
          curEnv.intervals.set(targetName, { min: Math.min(...products), max: Math.max(...products) });
        } else if (s.op === "/=") {
          if (rhsIv.min <= 0 && rhsIv.max >= 0) {
            emit(
              "C_VERIFY_DIV_BY_ZERO",
              "error",
              `Potential division by zero in '/=' assignment: divisor interval ${formatInterval(rhsIv)} contains 0.`,
              s.expr.line ?? s.line ?? 1,
              s.expr.col ?? s.col ?? 1,
              rhsIv,
            );
            curEnv.intervals.set(targetName, { ...TOP_INTERVAL });
          } else {
            const quotients = [
              prevIv.min / rhsIv.min,
              prevIv.min / rhsIv.max,
              prevIv.max / rhsIv.min,
              prevIv.max / rhsIv.max,
            ];
            curEnv.intervals.set(targetName, { min: Math.min(...quotients), max: Math.max(...quotients) });
          }
        }
        break;
      }
      case "if": {
        const condIv = evalAbstractExpr(s.condition, curEnv);
        if (condIv.min > 0 || condIv.max < 0) {
          refineEnvByCondition(s.condition, true, curEnv);
          interpBlock(s.thenBody, curEnv);
          break;
        }
        if (condIv.min === 0 && condIv.max === 0) {
          refineEnvByCondition(s.condition, false, curEnv);
          if (s.elseBody) interpBlock(s.elseBody, curEnv);
          break;
        }

        const thenEnv = refineEnvByCondition(s.condition, true, cloneEnv(curEnv));
        const elseEnv = refineEnvByCondition(s.condition, false, cloneEnv(curEnv));
        interpBlock(s.thenBody, thenEnv);
        if (s.elseBody) {
          interpBlock(s.elseBody, elseEnv);
        }
        const joined = joinEnvs(thenEnv, elseEnv);
        curEnv.intervals = joined.intervals;
        curEnv.pointers = joined.pointers;
        curEnv.arrays = joined.arrays;
        break;
      }
      case "switch": {
        const discIv = evalAbstractExpr(s.expr, curEnv);
        if (s.cases.length === 0) break;

        // If discriminant is a singleton constant, execute matching case path directly
        if (discIv.min === discIv.max) {
          let matchIdx = -1;
          let defaultIdx = -1;
          for (let i = 0; i < s.cases.length; i++) {
            const c = s.cases[i]!;
            if (c.isDefault && defaultIdx === -1) defaultIdx = i;
            if (
              c.values.some((v) => {
                const vIv = evalAbstractExpr(v, curEnv);
                return vIv.min === discIv.min && vIv.max === discIv.max;
              })
            ) {
              matchIdx = i;
              break;
            }
          }
          const startIdx = matchIdx !== -1 ? matchIdx : defaultIdx;
          if (startIdx !== -1) {
            for (let i = startIdx; i < s.cases.length; i++) {
              interpBlock(s.cases[i]!.body, curEnv);
              if (s.cases[i]!.hasBreak) break;
            }
          }
          break;
        }

        // Otherwise join abstract states across all case branches
        let accEnv: AbstractEnv | null = null;
        let hasDefault = false;
        for (let i = 0; i < s.cases.length; i++) {
          const branchEnv = cloneEnv(curEnv);
          if (s.cases[i]!.isDefault) hasDefault = true;
          for (let j = i; j < s.cases.length; j++) {
            interpBlock(s.cases[j]!.body, branchEnv);
            if (s.cases[j]!.hasBreak) break;
          }
          accEnv = accEnv ? joinEnvs(accEnv, branchEnv) : branchEnv;
        }
        if (!hasDefault && accEnv) {
          accEnv = joinEnvs(accEnv, curEnv);
        }
        if (accEnv) {
          curEnv.intervals = accEnv.intervals;
          curEnv.pointers = accEnv.pointers;
          curEnv.arrays = accEnv.arrays;
        }
        break;
      }
      case "for": {
        if (s.init) interpStmt(s.init, curEnv);
        const loopEnv = cloneEnv(curEnv);

        // Extract loop variable bounds from `i < N`, `i <= N`, `i > N`, `i >= N`
        if (s.condition?.kind === "binary" && s.condition.left.kind === "var") {
          const loopVar = s.condition.left.name;
          const initIv = loopEnv.intervals.get(loopVar) ?? { min: 0, max: 0 };
          const boundIv = evalAbstractExpr(s.condition.right, loopEnv);
          if (s.condition.op === "<") {
            loopEnv.intervals.set(loopVar, { min: initIv.min, max: boundIv.max - 1 });
          } else if (s.condition.op === "<=") {
            loopEnv.intervals.set(loopVar, { min: initIv.min, max: boundIv.max });
          } else if (s.condition.op === ">") {
            loopEnv.intervals.set(loopVar, { min: boundIv.min + 1, max: initIv.max });
          } else if (s.condition.op === ">=") {
            loopEnv.intervals.set(loopVar, { min: boundIv.min, max: initIv.max });
          }
        } else if (s.condition) {
          refineEnvByCondition(s.condition, true, loopEnv);
        }

        interpBlock(s.body, loopEnv);
        if (s.step) interpStmt(s.step, loopEnv);
        const joined = joinEnvs(curEnv, loopEnv);
        curEnv.intervals = joined.intervals;
        curEnv.pointers = joined.pointers;
        curEnv.arrays = joined.arrays;
        break;
      }
      case "while": {
        const loopEnv = refineEnvByCondition(s.condition, true, cloneEnv(curEnv));
        interpBlock(s.body, loopEnv);
        const joined = joinEnvs(curEnv, loopEnv);
        curEnv.intervals = joined.intervals;
        curEnv.pointers = joined.pointers;
        curEnv.arrays = joined.arrays;
        break;
      }
      case "call": {
        evalAbstractExpr({ kind: "call", callee: s.callee, args: s.args, line: s.line, col: s.col }, curEnv);
        break;
      }
      case "return": {
        if (s.expr) {
          const retIv = evalAbstractExpr(s.expr, curEnv);
          curEnv.intervals.set("__return__", retIv);
        }
        break;
      }
      case "break":
      case "continue":
        break;
    }
  }

  interpBlock(stmts, env);

  return {
    verified: diagnostics.length === 0,
    diagnostics,
    intervals: env.intervals,
    pointers: env.pointers,
    arrays: env.arrays,
  };
}
