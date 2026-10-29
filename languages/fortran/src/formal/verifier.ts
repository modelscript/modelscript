// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formal Verification Engine for Fortran Subroutines & Numerical Kernels.
 *
 * Combines:
 *   1. Abstract Interpretation over Control Flow Graphs (`GenericCFG` + `FixpointSolver` +
 *      `ReducedProductState` coupling `NumericalInterval` and `OctagonDBM`) for division-by-zero,
 *      math domain (`sqrt`, `log`, `asin`, `acos`), and `STORF`/`STORI` array bounds verification.
 *   2. DAE Arena Lowering + Block Lower Triangular (`performBltTransformationArena`) +
 *      `DaeBltReachabilityEngine` for continuous state derivative (`SD(i)`) and algebraic
 *      equation reachability.
 */

import {
  ArraySegmentState,
  CFGEdgeKind,
  DaeBltReachabilityEngine,
  DAEBuilder,
  FixpointSolver,
  GenericCFG,
  NumericalInterval,
  performBltTransformationArena,
  ReducedProductDomain,
  ReducedProductState,
  type CFGEdge,
  type CFGInstruction,
  type RTECheckResult,
} from "@modelscript/runtime";
import {
  extractFortranSignature,
  parseFortranModule,
  parseFortranScript,
  type FortranExpr,
  type FortranModuleAst,
  type FortranRoutineSignature,
  type FortranStmt,
  type FortranSubscript,
  type FortranUnitAst,
} from "../ast.js";
import { lowerFortranToDae } from "../dae/lowering.js";
import { preprocessFortranSegment } from "../preprocessor.js";

const productDomain = new ReducedProductDomain(32);

export interface FortranVerificationOptions {
  /** Custom interval bounds for input variables/ports */
  inputBounds?: Record<string, [number, number]> | undefined;
  /** Allocated STORF size (defaults to preprocessed #STORAGE REAL or 16) */
  numRealStates?: number | undefined;
  /** Allocated STORI size (defaults to preprocessed #STORAGE INTEGER or 16) */
  numIntStates?: number | undefined;
}

export interface FortranVerificationReport {
  routineName: string;
  isCertifiedSafe: boolean;
  provenSafeCount: number;
  definiteBugCount: number;
  potentialBugCount: number;
  deadCodeBlockCount: number;
  checks: RTECheckResult[];
  variableIntervals: Record<string, { low: number; high: number }>;
  arraySummaries?:
    | Record<string, { dimensions: { low: number; high: number }[]; elementInterval: { low: number; high: number } }>
    | undefined;
  daeReachability?:
    | {
        equationCount: number;
        stateCount: number;
        isFullyCertified: boolean;
        algebraicLoopsCount: number;
        singularLoopsCount: number;
      }
    | undefined;
  formattedSummary: string;
}

function defaultInputInterval(name: string): NumericalInterval {
  const lower = name.toLowerCase();
  if (lower === "p_c" || lower.includes("press")) {
    return new NumericalInterval(1.0e5, 1.0e7);
  }
  if (lower === "a_t" || lower.includes("area")) {
    return new NumericalInterval(0.01, 1.0);
  }
  if (lower === "c_f" || lower.includes("coeff") || lower.includes("gain")) {
    return new NumericalInterval(1.0, 2.5);
  }
  return new NumericalInterval(1.0, 100.0);
}

function getStateInterval(state: ReducedProductState, name: string): NumericalInterval | undefined {
  const exact = state.intervals.get(name);
  if (!exact.isTop()) return exact;
  const lower = state.intervals.get(name.toLowerCase());
  if (!lower.isTop()) return lower;
  const upper = state.intervals.get(name.toUpperCase());
  if (!upper.isTop()) return upper;
  return undefined;
}

function setStateInterval(state: ReducedProductState, name: string, iv: NumericalInterval): ReducedProductState {
  const safeIv = iv.isBottom() ? NumericalInterval.TOP : iv;
  const nextIntervals = state.intervals.set(name, safeIv);
  return new ReducedProductState(
    nextIntervals,
    state.octagon.clone(),
    new Map(state.varIndices),
    new Map(state.arraySegments),
    state.isBottomState,
    state.tvpi.clone(),
  );
}

function setArraySegment(state: ReducedProductState, name: string, seg: ArraySegmentState): ReducedProductState {
  const nextSegments = new Map(state.arraySegments);
  nextSegments.set(name.toUpperCase(), seg);
  return new ReducedProductState(
    state.intervals,
    state.octagon.clone(),
    new Map(state.varIndices),
    nextSegments,
    state.isBottomState,
    state.tvpi.clone(),
  );
}

function seedArraysFromSignature(state: ReducedProductState, sig: FortranRoutineSignature): ReducedProductState {
  let next = state;
  if (!sig.arrays) return next;
  for (const [key, spec] of Object.entries(sig.arrays)) {
    const arrUpper = key.toUpperCase();
    if (spec.allocatable) {
      // Unallocated until ALLOCATE(...)
      const unallocDim = NumericalInterval.const(0);
      next = setArraySegment(
        next,
        arrUpper,
        new ArraySegmentState(
          unallocDim,
          NumericalInterval.BOTTOM,
          NumericalInterval.BOTTOM,
          NumericalInterval.BOTTOM,
          NumericalInterval.BOTTOM,
          spec.dims.map(() => unallocDim),
        ),
      );
    } else {
      const dimIvs = spec.dims.map((d) => {
        const len = Math.max(0, d.upper - d.lower + 1);
        return NumericalInterval.const(len);
      });
      const totalLen = dimIvs.reduce((acc, d) => acc * Math.max(1, d.high), 1);
      next = setArraySegment(
        next,
        arrUpper,
        new ArraySegmentState(
          NumericalInterval.const(totalLen),
          NumericalInterval.ZERO,
          NumericalInterval.ZERO,
          NumericalInterval.ZERO,
          NumericalInterval.ZERO,
          dimIvs,
        ),
      );
    }
  }
  return next;
}

interface VerificationContext {
  numRealStates: number;
  numIntStates: number;
  moduleAst?: FortranModuleAst | undefined;
  callStack: Set<string>;
}

function verifyArraySubscripts(
  arrName: string,
  subscripts: FortranSubscript[],
  state: ReducedProductState,
  inst: CFGInstruction,
  collector: (check: RTECheckResult) => void,
  ctx: VerificationContext,
  accessMode: "read" | "write",
): ArraySegmentState | undefined {
  const arrUpper = arrName.toUpperCase();
  const seg = state.arraySegments.get(arrUpper);

  // Evaluate all subscript expressions first (so any inner math/div errors are checked)
  const subIntervals: {
    lowIv?: NumericalInterval | undefined;
    highIv?: NumericalInterval | undefined;
    isFullRange?: boolean | undefined;
  }[] = [];
  for (const sub of subscripts) {
    if (sub.kind === "index") {
      const iv = evalAbstractExpr(sub.expr, state, inst, collector, ctx);
      subIntervals.push({ lowIv: iv, highIv: iv });
    } else {
      const lowIv = sub.start ? evalAbstractExpr(sub.start, state, inst, collector, ctx) : undefined;
      const highIv = sub.end ? evalAbstractExpr(sub.end, state, inst, collector, ctx) : undefined;
      if (sub.stride) evalAbstractExpr(sub.stride, state, inst, collector, ctx);
      subIntervals.push({ lowIv, highIv, isFullRange: !sub.start && !sub.end });
    }
  }

  if (!seg) return undefined;

  if (seg.length.high === 0) {
    collector({
      instId: inst.id,
      category: "array_out_of_bounds",
      verdict: "definite_bug",
      description: `Definite bounds error: ${accessMode} access to unallocated ALLOCATABLE array '${arrName}'.`,
      astNodeId: inst.astNodeId,
    });
    return seg;
  }

  for (let d = 0; d < subIntervals.length; d++) {
    const sub = subIntervals[d]!;
    if (sub.isFullRange) {
      collector({
        instId: inst.id,
        category: "array_out_of_bounds",
        verdict: "proven_safe",
        description: `Array '${arrName}' dimension ${d + 1} full slice (:) proven within [1, ${seg.dimensions?.[d]?.high ?? seg.length.high}].`,
        astNodeId: inst.astNodeId,
      });
      continue;
    }
    const combinedIv =
      sub.lowIv && sub.highIv
        ? new NumericalInterval(sub.lowIv.low, sub.highIv.high)
        : (sub.lowIv ?? sub.highIv ?? NumericalInterval.const(1));
    const check = seg.checkInBounds(combinedIv, d);
    if (check.inBounds === "out_of_bounds") {
      collector({
        instId: inst.id,
        category: "array_out_of_bounds",
        verdict: "definite_bug",
        description: `Array '${arrName}' dimension ${d + 1} ${accessMode} index [${combinedIv.low}, ${combinedIv.high}] is out of bounds [1, ${check.validRange.high}].`,
        astNodeId: inst.astNodeId,
      });
    } else if (check.inBounds === "potential_out_of_bounds") {
      collector({
        instId: inst.id,
        category: "array_out_of_bounds",
        verdict: "potential_bug",
        description: `Array '${arrName}' dimension ${d + 1} ${accessMode} index [${combinedIv.low}, ${combinedIv.high}] may exceed bounds [1, ${check.validRange.high}].`,
        astNodeId: inst.astNodeId,
      });
    } else {
      collector({
        instId: inst.id,
        category: "array_out_of_bounds",
        verdict: "proven_safe",
        description: `Array '${arrName}' dimension ${d + 1} ${accessMode} index [${combinedIv.low}, ${combinedIv.high}] proven within [1, ${check.validRange.high}].`,
        astNodeId: inst.astNodeId,
      });
    }
  }

  return seg;
}

/**
 * Inter-procedurally analyzes a user-defined Fortran SUBROUTINE or FUNCTION unit.
 */
function verifyUserUnitCall(
  unit: FortranUnitAst,
  argExprs: FortranExpr[],
  callerState: ReducedProductState,
  inst: CFGInstruction,
  collector: (check: RTECheckResult) => void,
  ctx: VerificationContext,
): { exitState: ReducedProductState; returnInterval: NumericalInterval } {
  const unitUpper = unit.name.toUpperCase();
  if (ctx.callStack.has(unitUpper)) {
    return { exitState: callerState, returnInterval: new NumericalInterval(-1e6, 1e6) };
  }

  const nextStack = new Set(ctx.callStack);
  nextStack.add(unitUpper);
  const subCtx: VerificationContext = {
    ...ctx,
    callStack: nextStack,
  };

  let calleeInit = ReducedProductState.top(32);
  calleeInit = seedArraysFromSignature(calleeInit, unit.signature);

  for (const [k, v] of Object.entries(unit.signature.constants)) {
    calleeInit = setStateInterval(calleeInit, k, NumericalInterval.const(v));
  }

  // Bind caller argument intervals (and array segments) to callee formal parameters
  unit.signature.args.forEach((paramName, idx) => {
    const argExpr = argExprs[idx];
    if (!argExpr) return;
    if (argExpr.kind === "var") {
      const callerSeg = callerState.arraySegments.get(argExpr.name.toUpperCase());
      if (callerSeg) {
        calleeInit = setArraySegment(calleeInit, paramName, callerSeg.clone());
      }
    }
    const argIv = evalAbstractExpr(argExpr, callerState, inst, collector, ctx);
    calleeInit = setStateInterval(calleeInit, paramName, argIv);
  });

  const subCfg = buildFortranCFG(unit.stmts);
  const { transferFn, edgeTransferFn } = createFortranTransferFunctions(subCtx);
  const subSolver = new FixpointSolver(subCfg, transferFn, [-100, -1, 0, 1, 10, 100, 1000, 1e7], 16, edgeTransferFn);
  const subSummary = subSolver.solve(calleeInit);

  for (const chk of subSummary.checks) {
    collector(chk);
  }

  let joinedExit: ReducedProductState | undefined;
  for (const exitId of subCfg.exitBlockIds) {
    const ex = subSummary.blockExitStates.get(exitId);
    if (ex) {
      joinedExit = joinedExit ? productDomain.join(joinedExit, ex) : ex.clone();
    }
  }
  const finalCalleeState = joinedExit ?? calleeInit;
  const retVar = unit.returnVar ?? unit.name;
  const returnInterval = getStateInterval(finalCalleeState, retVar) ?? NumericalInterval.ZERO;

  return { exitState: finalCalleeState, returnInterval };
}

/**
 * Evaluates a FortranExpr over the abstract `ReducedProductState`, emitting RTE checks
 * for division by zero, math domain violations, and state/user array bounds.
 */
function evalAbstractExpr(
  expr: FortranExpr,
  state: ReducedProductState,
  inst: CFGInstruction,
  collector: (check: RTECheckResult) => void,
  ctx: VerificationContext,
): NumericalInterval {
  switch (expr.kind) {
    case "number":
      return NumericalInterval.const(expr.value);
    case "boolean":
      return NumericalInterval.const(expr.value ? 1 : 0);
    case "string":
      return NumericalInterval.ZERO;
    case "special": {
      if (expr.name === "TIME") return new NumericalInterval(0, 10);
      if (expr.name === "DELT") return new NumericalInterval(1e-4, 0.05);
      if (expr.name === "FIRSTSTEP") return new NumericalInterval(0, 1);
      return NumericalInterval.ZERO;
    }
    case "port": {
      const key = `$${expr.portName}`;
      const existing = getStateInterval(state, key) ?? getStateInterval(state, expr.portName);
      if (existing) return existing;
      return defaultInputInterval(expr.portName);
    }
    case "var": {
      return getStateInterval(state, expr.name) ?? NumericalInterval.TOP;
    }
    case "arrayConstructor": {
      let summary = NumericalInterval.BOTTOM;
      for (const item of expr.elements) {
        const iv = evalAbstractExpr(item, state, inst, collector, ctx);
        summary = summary.join(iv);
      }
      return summary.isBottom() ? NumericalInterval.ZERO : summary;
    }
    case "arrayAccess": {
      const upperName = expr.name.toUpperCase();
      // Check if this is a user-defined FUNCTION call first
      if (!state.arraySegments.has(upperName) && ctx.moduleAst?.units.has(upperName)) {
        const callee = ctx.moduleAst.units.get(upperName)!;
        const callArgs: FortranExpr[] = expr.subscripts.map((s) =>
          s.kind === "index" ? s.expr : (s.start ?? s.end ?? { kind: "number", value: 1 }),
        );
        const { returnInterval } = verifyUserUnitCall(callee, callArgs, state, inst, collector, ctx);
        return returnInterval;
      }

      const seg = verifyArraySubscripts(expr.name, expr.subscripts, state, inst, collector, ctx, "read");
      if (seg && !seg.universalSummary.isBottom() && !seg.universalSummary.isTop()) {
        return seg.universalSummary;
      }
      return new NumericalInterval(-1e6, 1e6);
    }
    case "state": {
      const idxIval = evalAbstractExpr(expr.indexExpr, state, inst, collector, ctx);
      const maxBound = expr.array === "storf" ? ctx.numRealStates : ctx.numIntStates;
      const arrLabel = expr.array.toUpperCase();
      if (!idxIval.isBottom()) {
        if (idxIval.low >= maxBound || idxIval.high < 0) {
          collector({
            instId: inst.id,
            category: "array_out_of_bounds",
            verdict: "definite_bug",
            description: `${arrLabel} index [${idxIval.low}, ${idxIval.high}] is out of bounds [0, ${maxBound - 1}].`,
            astNodeId: inst.astNodeId,
          });
        } else if (idxIval.low < 0 || idxIval.high >= maxBound) {
          collector({
            instId: inst.id,
            category: "array_out_of_bounds",
            verdict: "potential_bug",
            description: `${arrLabel} index [${idxIval.low}, ${idxIval.high}] may exceed bounds [0, ${maxBound - 1}].`,
            astNodeId: inst.astNodeId,
          });
        } else {
          collector({
            instId: inst.id,
            category: "array_out_of_bounds",
            verdict: "proven_safe",
            description: `${arrLabel} read index [${idxIval.low}, ${idxIval.high}] proven within [0, ${maxBound - 1}].`,
            astNodeId: inst.astNodeId,
          });
        }
      }
      return new NumericalInterval(-1e6, 1e6);
    }
    case "unary": {
      const inner = evalAbstractExpr(expr.expr, state, inst, collector, ctx);
      if (expr.op === "-") return inner.neg();
      return inner;
    }
    case "binary": {
      const left = evalAbstractExpr(expr.left, state, inst, collector, ctx);
      const right = evalAbstractExpr(expr.right, state, inst, collector, ctx);
      switch (expr.op) {
        case "+":
          return left.add(right);
        case "-":
          return left.sub(right);
        case "*":
          return left.mul(right);
        case "/": {
          const divRes = left.div(right);
          if (divRes.divisionByZero === "definite") {
            collector({
              instId: inst.id,
              category: "division_by_zero",
              verdict: "definite_bug",
              description: `Definite division by zero: divisor interval is [0, 0].`,
              astNodeId: inst.astNodeId,
            });
          } else if (divRes.divisionByZero === "possible") {
            collector({
              instId: inst.id,
              category: "division_by_zero",
              verdict: "potential_bug",
              description: `Potential division by zero: divisor interval [${right.low}, ${right.high}] straddles 0.`,
              astNodeId: inst.astNodeId,
            });
          } else {
            collector({
              instId: inst.id,
              category: "division_by_zero",
              verdict: "proven_safe",
              description: `Division proven safe: divisor interval [${right.low}, ${right.high}] excludes 0.`,
              astNodeId: inst.astNodeId,
            });
          }
          return divRes.result;
        }
        case "^": {
          if (right.isConstant() && right.low === 2) {
            return left.sqr();
          }
          if (
            !left.isBottom() &&
            !right.isBottom() &&
            Number.isFinite(left.low) &&
            Number.isFinite(left.high) &&
            right.isConstant()
          ) {
            const p1 = Math.pow(Math.max(0, left.low), right.low);
            const p2 = Math.pow(Math.max(0, left.high), right.low);
            return new NumericalInterval(Math.min(p1, p2), Math.max(p1, p2));
          }
          return new NumericalInterval(-1e6, 1e6);
        }
        default:
          return new NumericalInterval(0, 1);
      }
    }
    case "math": {
      // Handle array reduction intrinsics first
      if (
        expr.func === "sum" ||
        expr.func === "maxval" ||
        expr.func === "minval" ||
        expr.func === "size" ||
        expr.func === "dot_product" ||
        expr.func === "matmul"
      ) {
        const firstArg = expr.args[0];
        if (firstArg && firstArg.kind === "var") {
          const seg = state.arraySegments.get(firstArg.name.toUpperCase());
          if (seg) {
            if (seg.length.high === 0) {
              collector({
                instId: inst.id,
                category: "array_out_of_bounds",
                verdict: "definite_bug",
                description: `Intrinsic '${expr.func.toUpperCase()}' called on unallocated ALLOCATABLE array '${firstArg.name}'.`,
                astNodeId: inst.astNodeId,
              });
              return NumericalInterval.ZERO;
            }
            if (expr.func === "size") return seg.length;
            if (expr.func === "maxval" || expr.func === "minval") {
              return seg.universalSummary.isBottom() ? NumericalInterval.ZERO : seg.universalSummary;
            }
            if (expr.func === "sum") {
              const elemIv = seg.universalSummary.isBottom() ? NumericalInterval.ZERO : seg.universalSummary;
              return elemIv.mul(seg.length);
            }
          }
        }
        for (const a of expr.args) {
          evalAbstractExpr(a, state, inst, collector, ctx);
        }
        return new NumericalInterval(-1e6, 1e6);
      }

      const arg0 = expr.args[0] ? evalAbstractExpr(expr.args[0], state, inst, collector, ctx) : NumericalInterval.ZERO;
      switch (expr.func) {
        case "sqrt": {
          const res = arg0.sqrt();
          if (res.domainViolation === "definite") {
            collector({
              instId: inst.id,
              category: "math_domain",
              verdict: "definite_bug",
              description: `Definite domain error in SQRT: argument interval [${arg0.low}, ${arg0.high}] is strictly negative.`,
              astNodeId: inst.astNodeId,
            });
          } else if (res.domainViolation === "possible") {
            collector({
              instId: inst.id,
              category: "math_domain",
              verdict: "potential_bug",
              description: `Potential domain error in SQRT: argument interval [${arg0.low}, ${arg0.high}] includes negative values.`,
              astNodeId: inst.astNodeId,
            });
          } else {
            collector({
              instId: inst.id,
              category: "math_domain",
              verdict: "proven_safe",
              description: `SQRT domain proven safe: argument interval [${arg0.low}, ${arg0.high}] >= 0.`,
              astNodeId: inst.astNodeId,
            });
          }
          return res.result;
        }
        case "log":
        case "log10": {
          const res = arg0.log();
          if (res.domainViolation === "definite") {
            collector({
              instId: inst.id,
              category: "math_domain",
              verdict: "definite_bug",
              description: `Definite domain error in ${expr.func.toUpperCase()}: argument interval [${arg0.low}, ${arg0.high}] <= 0.`,
              astNodeId: inst.astNodeId,
            });
          } else if (res.domainViolation === "possible") {
            collector({
              instId: inst.id,
              category: "math_domain",
              verdict: "potential_bug",
              description: `Potential domain error in ${expr.func.toUpperCase()}: argument interval [${arg0.low}, ${arg0.high}] may be <= 0.`,
              astNodeId: inst.astNodeId,
            });
          } else {
            collector({
              instId: inst.id,
              category: "math_domain",
              verdict: "proven_safe",
              description: `${expr.func.toUpperCase()} domain proven safe: argument interval [${arg0.low}, ${arg0.high}] > 0.`,
              astNodeId: inst.astNodeId,
            });
          }
          return res.result;
        }
        case "asin":
        case "acos": {
          if (!arg0.isBottom()) {
            if (arg0.low > 1 || arg0.high < -1) {
              collector({
                instId: inst.id,
                category: "math_domain",
                verdict: "definite_bug",
                description: `Definite domain error in ${expr.func.toUpperCase()}: argument [${arg0.low}, ${arg0.high}] outside [-1, 1].`,
                astNodeId: inst.astNodeId,
              });
            } else if (arg0.low < -1 || arg0.high > 1) {
              collector({
                instId: inst.id,
                category: "math_domain",
                verdict: "potential_bug",
                description: `Potential domain error in ${expr.func.toUpperCase()}: argument [${arg0.low}, ${arg0.high}] may exceed [-1, 1].`,
                astNodeId: inst.astNodeId,
              });
            } else {
              collector({
                instId: inst.id,
                category: "math_domain",
                verdict: "proven_safe",
                description: `${expr.func.toUpperCase()} domain proven safe within [-1, 1].`,
                astNodeId: inst.astNodeId,
              });
            }
          }
          return new NumericalInterval(-Math.PI, Math.PI);
        }
        case "abs":
          return arg0.abs();
        case "exp":
          return arg0.exp();
        case "sin":
          return arg0.sin();
        case "cos":
          return arg0.cos();
        default:
          return arg0;
      }
    }
  }
}

/**
 * Lowers procedural Fortran AST statements into `@modelscript/runtime`'s `GenericCFG`.
 */
export function buildFortranCFG(stmts: FortranStmt[]): GenericCFG {
  const cfg = new GenericCFG();
  const entry = cfg.createBlock("entry");

  function lowerList(list: FortranStmt[], currentBlockId: number): number {
    let currId = currentBlockId;
    for (const stmt of list) {
      const block = cfg.getBlock(currId)!;
      if (stmt.kind === "assign") {
        const targetName =
          stmt.target.type === "var"
            ? stmt.target.name
            : stmt.target.type === "port"
              ? `$${stmt.target.portName}`
              : stmt.target.type === "array"
                ? stmt.target.name
                : `${stmt.target.array.toUpperCase()}`;
        block.addInstruction(
          cfg.createInstruction("assign", targetName, [stmt.expr, stmt.target], {
            astNodeId: stmt.line,
          }),
        );
      } else if (stmt.kind === "allocate") {
        block.addInstruction(
          cfg.createInstruction("allocate", undefined, stmt.items, {
            astNodeId: stmt.line,
          }),
        );
      } else if (stmt.kind === "deallocate") {
        block.addInstruction(
          cfg.createInstruction("deallocate", undefined, stmt.names, {
            astNodeId: stmt.line,
          }),
        );
      } else if (stmt.kind === "call") {
        block.addInstruction(
          cfg.createInstruction("call", stmt.subroutine, stmt.args, {
            astNodeId: stmt.line,
          }),
        );
      } else if (stmt.kind === "stateAdvance") {
        block.addInstruction(
          cfg.createInstruction("stateAdvance", stmt.array, [stmt.delta], {
            astNodeId: stmt.line,
          }),
        );
      } else if (stmt.kind === "if") {
        const thenBlock = cfg.createBlock("if_then");
        const elseBlock = cfg.createBlock("if_else");
        const joinBlock = cfg.createBlock("if_join");

        cfg.addEdge(currId, thenBlock.id, CFGEdgeKind.TrueBranch, stmt.condition);
        cfg.addEdge(currId, elseBlock.id, CFGEdgeKind.FalseBranch, stmt.condition);

        const thenExit = lowerList(stmt.thenBody, thenBlock.id);
        cfg.addEdge(thenExit, joinBlock.id, CFGEdgeKind.Normal);

        const elseExit = stmt.elseBody ? lowerList(stmt.elseBody, elseBlock.id) : elseBlock.id;
        cfg.addEdge(elseExit, joinBlock.id, CFGEdgeKind.Normal);

        currId = joinBlock.id;
      } else if (stmt.kind === "do") {
        // Initialize loop variable in current block
        block.addInstruction(
          cfg.createInstruction(
            "assign",
            stmt.loopVar,
            [
              { kind: "binary", op: "+", left: stmt.startExpr, right: { kind: "number", value: 0 } },
              { type: "var", name: stmt.loopVar },
            ],
            { astNodeId: stmt.line },
          ),
        );
        const headerBlock = cfg.createBlock("do_header");
        const bodyBlock = cfg.createBlock("do_body");
        const exitBlock = cfg.createBlock("do_exit");

        cfg.addEdge(currId, headerBlock.id, CFGEdgeKind.Normal);
        const condExpr: FortranExpr = {
          kind: "binary",
          op: "<=",
          left: { kind: "var", name: stmt.loopVar },
          right: stmt.endExpr,
        };
        cfg.addEdge(headerBlock.id, bodyBlock.id, CFGEdgeKind.TrueBranch, condExpr);
        cfg.addEdge(headerBlock.id, exitBlock.id, CFGEdgeKind.FalseBranch, condExpr);

        const bodyExit = lowerList(stmt.body, bodyBlock.id);
        const stepExpr: FortranExpr = stmt.stepExpr ?? { kind: "number", value: 1 };
        cfg.getBlock(bodyExit)!.addInstruction(
          cfg.createInstruction(
            "assign",
            stmt.loopVar,
            [
              {
                kind: "binary",
                op: "+",
                left: { kind: "var", name: stmt.loopVar },
                right: stepExpr,
              },
              { type: "var", name: stmt.loopVar },
            ],
            { astNodeId: stmt.line },
          ),
        );
        cfg.addEdge(bodyExit, headerBlock.id, CFGEdgeKind.Normal);
        currId = exitBlock.id;
      }
    }
    return currId;
  }

  const finalBlockId = lowerList(stmts, entry.id);
  cfg.exitBlockIds.add(finalBlockId);
  return cfg;
}

function createFortranTransferFunctions(ctx: VerificationContext) {
  const transferFn = (
    inst: CFGInstruction,
    inState: ReducedProductState,
    collector: (check: RTECheckResult) => void,
  ): ReducedProductState => {
    let next = inState.clone();

    if (inst.op === "allocate" && inst.operands) {
      const allocs = inst.operands as {
        name: string;
        dims: { lower?: FortranExpr | undefined; upper: FortranExpr }[];
      }[];
      for (const item of allocs) {
        const dimIvs: NumericalInterval[] = [];
        let totalLen = 1;
        for (const d of item.dims) {
          const lo = d.lower ? evalAbstractExpr(d.lower, next, inst, collector, ctx) : NumericalInterval.const(1);
          const hi = evalAbstractExpr(d.upper, next, inst, collector, ctx);
          const dimIv = hi.sub(lo).add(NumericalInterval.const(1));
          if (dimIv.high <= 0) {
            collector({
              instId: inst.id,
              category: "array_out_of_bounds",
              verdict: "definite_bug",
              description: `ALLOCATE for '${item.name}' specifies non-positive dimension [${dimIv.low}, ${dimIv.high}].`,
              astNodeId: inst.astNodeId,
            });
          }
          const safeHigh = Math.max(1, Number.isFinite(dimIv.high) ? Math.floor(dimIv.high) : 100);
          const safeLow = Math.max(1, Number.isFinite(dimIv.low) ? Math.floor(dimIv.low) : safeHigh);
          dimIvs.push(new NumericalInterval(safeLow, safeHigh));
          totalLen *= safeHigh;
        }
        next = setArraySegment(
          next,
          item.name,
          new ArraySegmentState(
            NumericalInterval.const(totalLen),
            NumericalInterval.ZERO,
            NumericalInterval.ZERO,
            NumericalInterval.ZERO,
            NumericalInterval.ZERO,
            dimIvs,
          ),
        );
      }
      return next;
    }

    if (inst.op === "deallocate" && inst.operands) {
      const names = inst.operands as string[];
      for (const name of names) {
        const unallocDim = NumericalInterval.const(0);
        next = setArraySegment(
          next,
          name,
          new ArraySegmentState(
            unallocDim,
            NumericalInterval.BOTTOM,
            NumericalInterval.BOTTOM,
            NumericalInterval.BOTTOM,
            NumericalInterval.BOTTOM,
            [unallocDim],
          ),
        );
      }
      return next;
    }

    if (inst.op === "assign" && inst.operands && inst.operands.length >= 2) {
      const expr = inst.operands[0] as FortranExpr;
      const target = inst.operands[1] as
        | { type: "var"; name: string }
        | { type: "port"; portName: string }
        | { type: "state"; array: "storf" | "stori"; indexExpr: FortranExpr }
        | { type: "array"; name: string; subscripts: FortranSubscript[] };

      if (target.type === "state") {
        const idxIval = evalAbstractExpr(target.indexExpr, next, inst, collector, ctx);
        const maxBound = target.array === "storf" ? ctx.numRealStates : ctx.numIntStates;
        const arrLabel = target.array.toUpperCase();
        if (!idxIval.isBottom()) {
          if (idxIval.low >= maxBound || idxIval.high < 0) {
            collector({
              instId: inst.id,
              category: "array_out_of_bounds",
              verdict: "definite_bug",
              description: `${arrLabel} write index [${idxIval.low}, ${idxIval.high}] is out of bounds [0, ${maxBound - 1}].`,
              astNodeId: inst.astNodeId,
            });
          } else if (idxIval.low < 0 || idxIval.high >= maxBound) {
            collector({
              instId: inst.id,
              category: "array_out_of_bounds",
              verdict: "potential_bug",
              description: `${arrLabel} write index [${idxIval.low}, ${idxIval.high}] may exceed [0, ${maxBound - 1}].`,
              astNodeId: inst.astNodeId,
            });
          } else {
            collector({
              instId: inst.id,
              category: "array_out_of_bounds",
              verdict: "proven_safe",
              description: `${arrLabel} write index [${idxIval.low}, ${idxIval.high}] proven within [0, ${maxBound - 1}].`,
              astNodeId: inst.astNodeId,
            });
          }
        }
        const valIval = evalAbstractExpr(expr, next, inst, collector, ctx);
        if (inst.targetVar) {
          next = setStateInterval(next, inst.targetVar, valIval);
        }
      } else if (target.type === "array") {
        const seg = verifyArraySubscripts(target.name, target.subscripts, next, inst, collector, ctx, "write");
        const valIval = evalAbstractExpr(expr, next, inst, collector, ctx);
        if (seg && seg.length.high > 0) {
          next = setArraySegment(next, target.name, seg.updateElement(valIval));
        }
      } else {
        const valIval = evalAbstractExpr(expr, next, inst, collector, ctx);
        // If RHS is an array constructor assigned to a whole array variable, update its ArraySegmentState
        if (expr.kind === "arrayConstructor" && target.type === "var") {
          const existingSeg = next.arraySegments.get(target.name.toUpperCase());
          const lenIv = existingSeg ? existingSeg.length : NumericalInterval.const(expr.elements.length);
          next = setArraySegment(
            next,
            target.name,
            new ArraySegmentState(lenIv, valIval, valIval, valIval, valIval, existingSeg?.dimensions ?? [lenIv]),
          );
        }
        if (inst.targetVar) {
          next = setStateInterval(next, inst.targetVar, valIval);
        }
      }
    } else if (inst.op === "call" && inst.operands) {
      const subUpper = (inst.targetVar ?? "").toUpperCase();
      const args = inst.operands as FortranExpr[];
      const callee = ctx.moduleAst?.units.get(subUpper);
      if (callee) {
        const { exitState } = verifyUserUnitCall(callee, args, next, inst, collector, ctx);
        // Copy back intent(out) / intent(inout) intervals and array segments to caller variables
        callee.signature.args.forEach((paramName, idx) => {
          const argExpr = args[idx];
          if (!argExpr || argExpr.kind !== "var") return;
          const isOutputOrUnspecified =
            callee.signature.outputs.some((o) => o.toLowerCase() === paramName.toLowerCase()) ||
            !callee.signature.inputs.some((i) => i.toLowerCase() === paramName.toLowerCase());
          if (isOutputOrUnspecified) {
            const outIv = getStateInterval(exitState, paramName);
            if (outIv) {
              next = setStateInterval(next, argExpr.name, outIv);
            }
            const outSeg = exitState.arraySegments.get(paramName.toUpperCase());
            if (outSeg) {
              next = setArraySegment(next, argExpr.name, outSeg);
            }
          }
        });
      } else {
        for (const arg of args) {
          evalAbstractExpr(arg, next, inst, collector, ctx);
        }
        // For known EMTDC library blocks (HARDLIMIT, REALPOLE, etc.), bound the output variable
        if ((subUpper === "HARDLIMIT" || subUpper === "LIMITER" || subUpper === "LIMIT") && args.length >= 4) {
          const [minExpr, maxExpr, outExpr] =
            args.length >= 5 ? [args[2]!, args[3]!, args[4]!] : [args[1]!, args[2]!, args[3]!];
          const minIval = evalAbstractExpr(minExpr, next, inst, () => {}, ctx);
          const maxIval = evalAbstractExpr(maxExpr, next, inst, () => {}, ctx);
          if (outExpr.kind === "var" && !minIval.isBottom() && !maxIval.isBottom()) {
            next = setStateInterval(next, outExpr.name, new NumericalInterval(minIval.low, maxIval.high));
          }
        }
      }
    }
    return next;
  };

  const edgeTransferFn = (edge: CFGEdge, outState: ReducedProductState): ReducedProductState => {
    let refined = outState.clone();
    const cond = edge.conditionExpr as FortranExpr | undefined;
    if (!cond || cond.kind !== "binary") return refined;

    // Simple interval branch refinement: var <= const, var < const, var > const, var >= const
    if (cond.left.kind === "var" && cond.right.kind === "number") {
      const vName = cond.left.name;
      const cVal = cond.right.value;
      const cur = getStateInterval(refined, vName) ?? NumericalInterval.TOP;
      const isTrue = edge.kind === CFGEdgeKind.TrueBranch;
      let mask = NumericalInterval.TOP;
      if ((cond.op === "<=" && isTrue) || (cond.op === ">" && !isTrue)) {
        mask = new NumericalInterval(-Infinity, cVal);
      } else if ((cond.op === "<" && isTrue) || (cond.op === ">=" && !isTrue)) {
        mask = new NumericalInterval(-Infinity, cVal);
      } else if ((cond.op === ">=" && isTrue) || (cond.op === "<" && !isTrue)) {
        mask = new NumericalInterval(cVal, Infinity);
      } else if ((cond.op === ">" && isTrue) || (cond.op === "<=" && !isTrue)) {
        mask = new NumericalInterval(cVal, Infinity);
      }
      refined = setStateInterval(refined, vName, cur.meet(mask));
    }
    return refined;
  };

  return { transferFn, edgeTransferFn };
}

/**
 * Runs both Abstract Interpretation (`GenericCFG` + `FixpointSolver`) and DAE BLT Reachability
 * (`lowerFortranToDae` + `DaeBltReachabilityEngine`) on a Fortran source file.
 */
export function verifyFortranSource(
  source: string,
  options: FortranVerificationOptions = {},
): FortranVerificationReport {
  const prep = preprocessFortranSegment(source);
  const hasDirectives = /^\s*#/m.test(source) || /\$#DIM/i.test(source);
  const cleanSource = hasDirectives ? prep.lines.join("\n") : source;
  const moduleAst = parseFortranModule(cleanSource);
  const mainUnit = moduleAst.entryUnit;
  const sig = mainUnit ? mainUnit.signature : extractFortranSignature(source);
  const stmts = mainUnit && mainUnit.stmts.length > 0 ? mainUnit.stmts : parseFortranScript(cleanSource);

  const numRealStates = options.numRealStates ?? Math.max(prep.numRealStates, 16);
  const numIntStates = options.numIntStates ?? Math.max(prep.numIntStates, 16);

  const cfg = buildFortranCFG(stmts);
  let initialState = ReducedProductState.top(32);

  // Seed module constants & main signature constants
  for (const [k, v] of Object.entries(moduleAst.moduleConstants)) {
    initialState = setStateInterval(initialState, k, NumericalInterval.const(v));
  }
  for (const [k, v] of Object.entries(sig.constants)) {
    initialState = setStateInterval(initialState, k, NumericalInterval.const(v));
  }

  // Seed array segments from unit declarations
  initialState = seedArraysFromSignature(initialState, sig);

  // Seed inputs
  for (const inp of sig.inputs) {
    const custom =
      options.inputBounds?.[inp] ??
      options.inputBounds?.[inp.toLowerCase()] ??
      options.inputBounds?.[inp.toUpperCase()];
    if (custom) {
      initialState = setStateInterval(initialState, inp, new NumericalInterval(custom[0], custom[1]));
    } else {
      initialState = setStateInterval(initialState, inp, defaultInputInterval(inp));
    }
  }

  // Seed referenced ports
  for (const port of prep.referencedPorts) {
    const custom = options.inputBounds?.[port] ?? options.inputBounds?.[`$${port}`];
    const iv = custom ? new NumericalInterval(custom[0], custom[1]) : defaultInputInterval(port);
    initialState = setStateInterval(initialState, `$${port}`, iv);
    initialState = setStateInterval(initialState, port, iv);
  }

  const ctx: VerificationContext = {
    numRealStates,
    numIntStates,
    moduleAst,
    callStack: new Set([sig.name.toUpperCase()]),
  };

  const { transferFn, edgeTransferFn } = createFortranTransferFunctions(ctx);
  const solver = new FixpointSolver(cfg, transferFn, [-100, -1, 0, 1, 10, 100, 1000, 1e7], 20, edgeTransferFn);
  const summary = solver.solve(initialState);

  // Extract exit variable intervals & array segment summaries
  const variableIntervals: Record<string, { low: number; high: number }> = {};
  const arraySummaries: Record<
    string,
    { dimensions: { low: number; high: number }[]; elementInterval: { low: number; high: number } }
  > = {};

  for (const exitId of cfg.exitBlockIds) {
    const exitState = summary.blockExitStates.get(exitId);
    if (exitState) {
      for (const [k, iv] of exitState.intervals.entries()) {
        if (!iv.isBottom() && !iv.isTop()) {
          variableIntervals[k] = { low: iv.low, high: iv.high };
        }
      }
      for (const [arrName, seg] of exitState.arraySegments.entries()) {
        const dims = (seg.dimensions ?? [seg.length]).map((d) => ({ low: d.low, high: d.high }));
        const elemIv = seg.universalSummary;
        arraySummaries[arrName.toLowerCase()] = {
          dimensions: dims,
          elementInterval: {
            low: elemIv.isBottom() ? 0 : elemIv.low,
            high: elemIv.isBottom() ? 0 : elemIv.high,
          },
        };
      }
    }
  }

  // Optional Stage 2: DAE Arena + BLT Reachability for equations / SD(i) derivatives
  let daeReachability: FortranVerificationReport["daeReachability"];
  try {
    const builder = new DAEBuilder();
    const lowered = lowerFortranToDae(builder, prep.lines, sig.name);
    if (lowered.equationCount > 0) {
      const blt = performBltTransformationArena(builder);
      const engine = new DaeBltReachabilityEngine(builder, {
        stateVars: new Set(lowered.stateVarIndices),
        timeHorizon: 1.0,
      });
      const reach = engine.verify(blt);
      daeReachability = {
        equationCount: lowered.equationCount,
        stateCount: lowered.stateVarIndices.length,
        isFullyCertified: reach.isFullyCertified,
        algebraicLoopsCount: reach.algebraicLoopsCount,
        singularLoopsCount: reach.singularLoopsCount,
      };
    }
  } catch {
    // Non-DAE procedural construct; skip DAE reachability summary
  }

  const isCertifiedSafe =
    summary.definiteBugCount === 0 &&
    summary.potentialBugCount === 0 &&
    (daeReachability ? daeReachability.singularLoopsCount === 0 : true);

  const intervalLines = Object.entries(variableIntervals)
    .map(([k, v]) => `${k} ∈ [${Number(v.low.toPrecision(4))}, ${Number(v.high.toPrecision(4))}]`)
    .join(", ");

  const formattedSummary = [
    `Fortran Verification [${sig.name}]: ${isCertifiedSafe ? "CERTIFIED SAFE" : "ISSUES DETECTED"}`,
    `Checks: ${summary.provenSafeCount} proven safe, ${summary.definiteBugCount} definite bugs, ${summary.potentialBugCount} potential bugs`,
    intervalLines ? `Enclosures: ${intervalLines}` : "",
    daeReachability
      ? `DAE BLT: ${daeReachability.equationCount} eqs, ${daeReachability.stateCount} states, ${daeReachability.algebraicLoopsCount} loops`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    routineName: sig.name,
    isCertifiedSafe,
    provenSafeCount: summary.provenSafeCount,
    definiteBugCount: summary.definiteBugCount,
    potentialBugCount: summary.potentialBugCount,
    deadCodeBlockCount: summary.deadCodeBlockCount,
    checks: summary.checks,
    variableIntervals,
    arraySummaries,
    daeReachability,
    formattedSummary,
  };
}
