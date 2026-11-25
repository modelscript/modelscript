// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  ExprKind,
  UnaryOp,
  evalTable1DValue,
  evalTimeTableTmax,
  evalTimeTableTmin,
  evalTimeTableValue,
  getOrCreateCachedTable,
  type ArenaExecutionBlock,
} from "@modelscript/runtime";
import { evaluateArenaDualFlat, evaluateArenaRuntime } from "@modelscript/runtime/wasm_evaluator.js";
import type {
  FmuInstanceMetadata,
  FmuSubsystem,
  FmuSubsystemRegistry,
} from "@modelscript/runtime/wasm_fmu_subsystem.js";
import {
  SQRT_EPS,
  createDynamicFunction,
  type FlatBytecodeCache,
  type SafetyViolationRecord,
  type SystemExecutionBlock,
  type TornExecutionPlan,
  type WasmArenaExports,
} from "./arena-sim-types.js";
import { resolveArenaOutputIds } from "./arena-structural-reduction.js";

export interface ArenaBlockCompilerHost {
  arena: DAEBuilder;
  stateVars: Set<number>;
  executionBlocks: ArenaExecutionBlock[];
  preValuesByStringId: Float64Array;
  _cachedFlatBytecode: FlatBytecodeCache | null;
  fmuRegistry?: FmuSubsystemRegistry | undefined;
  fmuLoader?: ((fmuPath: string, instance: FmuInstanceMetadata) => FmuSubsystem) | undefined;
  getNewtonScratchDualStack(): Float64Array;
  solveNewtonBlock(block: Extract<ArenaExecutionBlock, { type: "system" }>, valuesByStringId: Float64Array): void;
}

/**
 * Recursively lowers an arena expression (`exprId`) into a JavaScript expression string reading `env[nameId]`.
 */
export function arenaExprToJs(arena: DAEBuilder, exprId: number): string {
  if (exprId < 0) return "0";
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(exprId).toString();
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.EnumLiteral:
      return arena.getExprData1(exprId).toString();
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      return `env[${nameId}]`;
    }
    case ExprKind.Der: {
      const innerExprId = arena.getExprData1(exprId);
      if (arena.getExprKind(innerExprId) === ExprKind.Name) {
        const innerNameId = arena.getExprData1(innerExprId);
        const innerName = arena.interner.resolve(innerNameId);
        if (innerName) {
          const derId = arena.interner.intern(`der(${innerName})`);
          return `env[${derId}]`;
        }
      }
      return `helpers.evalExpr(${exprId}, env)`;
    }
    case ExprKind.Negate: {
      return `(-(${arenaExprToJs(arena, arena.getExprLeft(exprId))}))`;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const operand = arenaExprToJs(arena, arena.getExprLeft(exprId));
      if (op === UnaryOp.Negate) return `(-(${operand}))`;
      if (op === UnaryOp.Not) return `((${operand}) === 0 ? 1 : 0)`;
      return `helpers.evalExpr(${exprId}, env)`;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = arenaExprToJs(arena, arena.getExprLeft(exprId));
      const right = arenaExprToJs(arena, arena.getExprRight(exprId));
      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
          return `((${left}) + (${right}))`;
        case BinOp.Sub:
        case BinOp.ElemSub:
          return `((${left}) - (${right}))`;
        case BinOp.Mul:
        case BinOp.ElemMul:
          return `((${left}) * (${right}))`;
        case BinOp.Div:
        case BinOp.ElemDiv:
          return `((${left}) / (${right}))`;
        case BinOp.Pow:
        case BinOp.ElemPow:
          return `Math.pow(${left}, ${right})`;
        case BinOp.And:
          return `(((${left}) !== 0 && (${right}) !== 0) ? 1 : 0)`;
        case BinOp.Or:
          return `(((${left}) !== 0 || (${right}) !== 0) ? 1 : 0)`;
        case BinOp.Lt:
          return `((${left}) < (${right}) ? 1 : 0)`;
        case BinOp.Lte:
          return `((${left}) <= (${right}) ? 1 : 0)`;
        case BinOp.Gt:
          return `((${left}) > (${right}) ? 1 : 0)`;
        case BinOp.Gte:
          return `((${left}) >= (${right}) ? 1 : 0)`;
        case BinOp.Eq:
          return `((${left}) === (${right}) ? 1 : 0)`;
        case BinOp.Neq:
          return `((${left}) !== (${right}) ? 1 : 0)`;
        default:
          return `helpers.evalExpr(${exprId}, env)`;
      }
    }
    case ExprKind.IfElse: {
      const cond = arenaExprToJs(arena, arena.getExprData1(exprId));
      const thenVal = arenaExprToJs(arena, arena.getExprLeft(exprId));
      const elseVal = arenaExprToJs(arena, arena.getExprRight(exprId));
      return `((${cond}) !== 0 ? (${thenVal}) : (${elseVal}))`;
    }
    case ExprKind.Call: {
      const fnName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
      const cleanFn = fnName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
      const argCount = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);

      // Event-generating or stateful operators delegate to runtime evaluator
      if (
        cleanFn === "edge" ||
        cleanFn === "change" ||
        cleanFn === "sample" ||
        cleanFn === "initial" ||
        cleanFn === "terminal" ||
        cleanFn === "pre" ||
        cleanFn === "delay"
      ) {
        return `helpers.evalExpr(${exprId}, env)`;
      }

      if (
        (cleanFn === "activeState" ||
          cleanFn === "ticksInState" ||
          cleanFn === "timeInState" ||
          cleanFn === "previousState") &&
        argCount >= 1 &&
        arena.getExprKind(firstArg) === ExprKind.Name
      ) {
        const argName = arena.interner.resolve(arena.getExprData1(firstArg));
        if (argName) {
          const intrinsicId = arena.interner.intern(`$${cleanFn}(${argName})`);
          return `env[${intrinsicId}]`;
        }
      }

      if (cleanFn === "der" && argCount === 1 && arena.getExprKind(firstArg) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(firstArg));
        if (innerName) {
          const derId = arena.interner.intern(`der(${innerName})`);
          return `env[${derId}]`;
        }
      }

      if (cleanFn === "smooth") {
        if (argCount > 1) {
          return `(${arenaExprToJs(arena, arena.getExprLeft(exprId + 1))})`;
        }
        return argCount > 0 ? `(${arenaExprToJs(arena, firstArg)})` : "0";
      }

      const arg = arenaExprToJs(arena, firstArg);

      if (cleanFn === "sin") return `Math.sin(${arg})`;
      if (cleanFn === "cos") return `Math.cos(${arg})`;
      if (cleanFn === "tan") return `Math.tan(${arg})`;
      if (cleanFn === "asin") return `Math.asin(${arg})`;
      if (cleanFn === "acos") return `Math.acos(${arg})`;
      if (cleanFn === "atan") return `Math.atan(${arg})`;
      if (cleanFn === "sinh") return `Math.sinh(${arg})`;
      if (cleanFn === "cosh") return `Math.cosh(${arg})`;
      if (cleanFn === "tanh") return `Math.tanh(${arg})`;
      if (cleanFn === "exp") return `Math.exp(${arg})`;
      if (cleanFn === "log") return `Math.log(${arg})`;
      if (cleanFn === "log10") return `Math.log10(${arg})`;
      if (cleanFn === "sqrt") return `Math.sqrt(${arg})`;
      if (cleanFn === "abs") return `Math.abs(${arg})`;
      if (cleanFn === "sign") return `Math.sign(${arg})`;
      if (cleanFn === "ceil") return `Math.ceil(${arg})`;
      if (cleanFn === "floor" || cleanFn === "integer") return `Math.floor(${arg})`;
      if (
        cleanFn === "noEvent" ||
        cleanFn === "homotopy" ||
        cleanFn === "/*Real*/" ||
        cleanFn === "/*Integer*/" ||
        cleanFn === "/*Boolean*/"
      )
        return `(${arg})`;

      if (argCount === 2) {
        const arg1 = arenaExprToJs(arena, arena.getExprLeft(exprId + 1));
        if (cleanFn === "atan2") return `Math.atan2(${arg}, ${arg1})`;
        if (cleanFn === "max") return `Math.max(${arg}, ${arg1})`;
        if (cleanFn === "min") return `Math.min(${arg}, ${arg1})`;
      }

      if (fnName.includes("getTable1DValue") || fnName.includes("CombiTable1D_getValue")) {
        const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
        const icolJs = arenaExprToJs(arena, arena.getExprLeft(exprId + 1));
        const uJs = arenaExprToJs(arena, arena.getExprLeft(exprId + 2));
        return `helpers.getTable1DValue(${tableVarNameId}, ${icolJs}, ${uJs})`;
      }

      if (fnName.includes("getTimeTableValue") || fnName.includes("CombiTimeTable_getValue")) {
        const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
        const icolJs = arenaExprToJs(arena, arena.getExprLeft(exprId + 1));
        const timeJs = arenaExprToJs(arena, arena.getExprLeft(exprId + 2));
        return `helpers.getTimeTableValue(${tableVarNameId}, ${icolJs}, ${timeJs})`;
      }

      if (fnName.includes("getTimeTableTmin")) {
        const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
        return `helpers.getTimeTableTmin(${tableVarNameId})`;
      }

      if (fnName.includes("getTimeTableTmax")) {
        const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
        return `helpers.getTimeTableTmax(${tableVarNameId})`;
      }

      if (fnName.includes("getNextTimeEvent")) {
        const tableVarNameId = arena.getExprKind(firstArg) === ExprKind.Name ? arena.getExprData1(firstArg) : 0;
        const timeJs = arenaExprToJs(arena, arena.getExprLeft(exprId + 1));
        return `helpers.getNextTimeEvent(${tableVarNameId}, ${timeJs})`;
      }

      return `helpers.evalExpr(${exprId}, env)`;
    }
    default:
      return `helpers.evalExpr(${exprId}, env)`;
  }
}

/**
 * JIT-compiles a torn execution plan into a specialized closure evaluating
 * the topological causal chain and residual equations at native JS machine speed.
 */
export function compileArenaTornPlan(
  host: { arena: DAEBuilder; preValuesByStringId: Float64Array },
  plan: TornExecutionPlan,
): void {
  const k = plan.k;
  const lines: string[] = [];
  // 1. Assign trial variables from xTrial to env
  for (let i = 0; i < k; i++) {
    lines.push(`env[${plan.tearingVarNameIds[i]}] = xTrial[${i}];`);
  }
  // 2. Evaluate forward causal chain assignments in topological order
  for (let c = 0; c < plan.causalChain.length; c++) {
    const step = plan.causalChain[c]!;
    const exprJs = arenaExprToJs(host.arena, step.isolatedExprId);
    lines.push(`{ const v = ${exprJs}; env[${step.solvedVarNameId}] = Number.isFinite(v) ? v : 0; }`);
  }
  // 3. Evaluate residual equations
  lines.push("let maxR = 0;");
  for (let j = 0; j < k; j++) {
    const rJs = arenaExprToJs(host.arena, plan.residualExprIds[j]!);
    lines.push(
      `{ const r = ${rJs}; const ar = Math.abs(r); R_out[${j}] = Number.isFinite(r) ? r : 1e10; if (ar > maxR) maxR = ar; }`,
    );
  }
  lines.push("return maxR;");

  try {
    const helpers = {
      getTimeTableValue: (tableIdStrId: number, icol: number, timeIn: number) => {
        const cached = getOrCreateCachedTable(host.arena, tableIdStrId);
        return evalTimeTableValue(cached, icol, timeIn);
      },
      getTable1DValue: (tableIdStrId: number, icol: number, uIn: number) => {
        const cached = getOrCreateCachedTable(host.arena, tableIdStrId);
        return evalTable1DValue(cached, icol, uIn);
      },
      getTimeTableTmin: (tableIdStrId: number) => {
        const cached = getOrCreateCachedTable(host.arena, tableIdStrId);
        return evalTimeTableTmin(cached);
      },
      getTimeTableTmax: (tableIdStrId: number) => {
        const cached = getOrCreateCachedTable(host.arena, tableIdStrId);
        return evalTimeTableTmax(cached);
      },
      getNextTimeEvent: (_tableIdStrId: number, _timeIn: number) => {
        return 1e100;
      },
      evalExpr: (exprId: number, env: Float64Array) => {
        return evaluateArenaRuntime(host.arena, exprId, env, host.preValuesByStringId);
      },
    };
    const rawResFn = createDynamicFunction("env", "xTrial", "R_out", "helpers", lines.join("\n")) as (
      env: Float64Array,
      xTrial: Float64Array,
      R_out: Float64Array,
      helpers: Record<string, unknown>,
    ) => number;
    plan.compiledResiduals = (env: Float64Array, xTrial: Float64Array, R_out: Float64Array) =>
      rawResFn(env, xTrial, R_out, helpers);
  } catch {
    // Fall back to interpretive evaluation if dynamic compilation fails
  }
}

/**
 * JIT-compiles topological BLT execution blocks (`single` scalar assignments and `system` algebraic loops)
 * into specialized JavaScript closures (`new Function("env", "helpers", ...)`).
 *
 * - Lowers arena expression trees (`arenaExprToJs`) and forward-mode symbolic partial derivatives (`dualToJs`)
 *   directly into inline JavaScript arithmetic over `env: Float64Array`.
 * - Precompiles residual and analytical Jacobian evaluators for simultaneous algebraic systems (`m <= 256`).
 * - Splits large models into chunks of at most 4,000 statements per closure to stay within V8 TurboFan optimization limits.
 */
export function compileArenaBlocks(host: ArenaBlockCompilerHost): ((env: Float64Array) => void) | null {
  try {
    const arena = host.arena;
    if (host.executionBlocks.length === 0) return () => {};

    const systemBlocks: Extract<ArenaExecutionBlock, { type: "system" }>[] = [];

    // 1. Runtime helper table passed into compiled closures for external tables, fallback expressions, and Newton blocks
    const helpers = {
      getTimeTableValue: (tableIdStrId: number, icol: number, timeIn: number) => {
        const cached = getOrCreateCachedTable(arena, tableIdStrId);
        return evalTimeTableValue(cached, icol, timeIn);
      },
      getTable1DValue: (tableIdStrId: number, icol: number, uIn: number) => {
        const cached = getOrCreateCachedTable(arena, tableIdStrId);
        return evalTable1DValue(cached, icol, uIn);
      },
      getTimeTableTmin: (tableIdStrId: number) => {
        const cached = getOrCreateCachedTable(arena, tableIdStrId);
        return evalTimeTableTmin(cached);
      },
      getTimeTableTmax: (tableIdStrId: number) => {
        const cached = getOrCreateCachedTable(arena, tableIdStrId);
        return evalTimeTableTmax(cached);
      },
      getNextTimeEvent: (_tableIdStrId: number, _timeIn: number) => {
        return 1e100;
      },
      evalExpr: (exprId: number, env: Float64Array) => {
        return evaluateArenaRuntime(arena, exprId, env, host.preValuesByStringId);
      },
      // Evaluates partial derivative d(resId)/d(nid) via flat dual-number AD, falling back to finite differences
      evalDual: (
        resId: number,
        nid: number,
        env: Float64Array,
        x: Float64Array,
        R: Float64Array,
        i: number,
        j: number,
      ) => {
        const dualStack = host.getNewtonScratchDualStack();
        const ok = evaluateArenaDualFlat(arena, resId, env, nid, dualStack, 0);
        if (ok && Number.isFinite(dualStack[1] as number)) {
          return dualStack[1] as number;
        }
        const xj = x[j] as number;
        const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
        env[nid] = xj + eps;
        const perturbedVal = evaluateArenaRuntime(arena, resId, env, host.preValuesByStringId);
        const R_perturbed = Number.isFinite(perturbedVal) ? perturbedVal : (R[i] as number);
        env[nid] = xj;
        return (R_perturbed - (R[i] as number)) / eps;
      },
      solveSystem: (sysIdx: number, env: Float64Array) => {
        const blk = systemBlocks[sysIdx];
        if (blk) host.solveNewtonBlock(blk, env);
      },
    };

    // 2. Delegate expression lowering to arenaExprToJs
    const exprToJs = (exprId: number): string => arenaExprToJs(arena, exprId);

    // 3. Symbolically differentiate `exprId` with respect to `seedNameId` into a JS expression string
    //    (returns "0" for constants/unrelated variables, or `null` if non-differentiable)
    function dualToJs(exprId: number, seedNameId: number): string | null {
      if (exprId < 0) return "0";
      const kind = arena.getExprKind(exprId);
      switch (kind) {
        case ExprKind.RealLiteral:
        case ExprKind.IntLiteral:
        case ExprKind.BoolLiteral:
        case ExprKind.EnumLiteral:
          return "0";
        case ExprKind.Name:
          return arena.getExprData1(exprId) === seedNameId ? "1" : "0";
        case ExprKind.Der: {
          const innerExprId = arena.getExprData1(exprId);
          if (arena.getExprKind(innerExprId) === ExprKind.Name) {
            const innerName = arena.interner.resolve(arena.getExprData1(innerExprId));
            if (innerName) {
              const derId = arena.interner.intern(`der(${innerName})`);
              return derId === seedNameId ? "1" : "0";
            }
          }
          return null;
        }
        case ExprKind.Negate: {
          const dL = dualToJs(arena.getExprLeft(exprId), seedNameId);
          if (dL === null) return null;
          if (dL === "0") return "0";
          return `(-(${dL}))`;
        }
        case ExprKind.Unary: {
          const op = arena.getExprData1(exprId);
          if (op === UnaryOp.Negate) {
            const dL = dualToJs(arena.getExprLeft(exprId), seedNameId);
            if (dL === null) return null;
            if (dL === "0") return "0";
            return `(-(${dL}))`;
          }
          if (op === UnaryOp.Not) return "0";
          return null;
        }
        case ExprKind.Binary: {
          const op = arena.getExprData1(exprId);
          if (
            op === BinOp.Lt ||
            op === BinOp.Lte ||
            op === BinOp.Gt ||
            op === BinOp.Gte ||
            op === BinOp.Eq ||
            op === BinOp.Neq ||
            op === BinOp.And ||
            op === BinOp.Or
          ) {
            return "0";
          }
          const lId = arena.getExprLeft(exprId);
          const rId = arena.getExprRight(exprId);
          const dL = dualToJs(lId, seedNameId);
          const dR = dualToJs(rId, seedNameId);
          if (dL === null || dR === null) return null;
          if (dL === "0" && dR === "0") return "0";
          switch (op) {
            case BinOp.Add:
            case BinOp.ElemAdd:
              if (dL === "0") return dR;
              if (dR === "0") return dL;
              return `((${dL}) + (${dR}))`;
            case BinOp.Sub:
            case BinOp.ElemSub:
              if (dL === "0") return `(-(${dR}))`;
              if (dR === "0") return dL;
              return `((${dL}) - (${dR}))`;
            case BinOp.Mul:
            case BinOp.ElemMul: {
              // Product rule: d(u * v) = du * v + u * dv
              const vL = exprToJs(lId);
              const vR = exprToJs(rId);
              if (dL === "0") return `((${vL}) * (${dR}))`;
              if (dR === "0") return `((${dL}) * (${vR}))`;
              return `((${dL}) * (${vR}) + (${vL}) * (${dR}))`;
            }
            case BinOp.Div:
            case BinOp.ElemDiv: {
              // Quotient rule: d(u / v) = (du * v - u * dv) / (v * v)
              const vL = exprToJs(lId);
              const vR = exprToJs(rId);
              if (dR === "0") return `((${dL}) / (${vR}))`;
              if (dL === "0") return `(-((${vL}) * (${dR})) / ((${vR}) * (${vR})))`;
              if (dR !== "0") return `(((${dL}) * (${vR}) - (${vL}) * (${dR})) / ((${vR}) * (${vR})))`;
              return null;
            }
            case BinOp.Pow:
            case BinOp.ElemPow: {
              // Power rule: d(u^v) = v * u^(v-1) * du + u^v * ln(u) * dv
              const vL = exprToJs(lId);
              const vR = exprToJs(rId);
              if (dR === "0") {
                return `((${vR}) * Math.pow(${vL}, (${vR}) - 1) * (${dL}))`;
              }
              if (dL === "0") {
                return `(Math.pow(${vL}, ${vR}) * Math.log(${vL}) * (${dR}))`;
              }
              return `(Math.pow(${vL}, (${vR}) - 1) * ((${vR}) * (${dL}) + (${vL}) * Math.log(${vL}) * (${dR})))`;
            }
            default:
              return null;
          }
        }
        case ExprKind.IfElse: {
          const condId = arena.getExprData1(exprId);
          const tId = arena.getExprLeft(exprId);
          const eId = arena.getExprRight(exprId);
          const dT = dualToJs(tId, seedNameId);
          const dE = dualToJs(eId, seedNameId);
          if (dT === null || dE === null) return null;
          if (dT === "0" && dE === "0") return "0";
          const condJs = exprToJs(condId);
          return `((${condJs}) !== 0 ? (${dT}) : (${dE}))`;
        }
        case ExprKind.Call: {
          const fnName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
          const cleanFn = fnName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
          const argCount = arena.getExprRight(exprId);
          const firstArg = arena.getExprLeft(exprId);
          if (cleanFn === "der" && argCount === 1 && arena.getExprKind(firstArg) === ExprKind.Name) {
            const innerName = arena.interner.resolve(arena.getExprData1(firstArg));
            if (innerName) {
              const derId = arena.interner.intern(`der(${innerName})`);
              return derId === seedNameId ? "1" : "0";
            }
          }
          if (
            cleanFn === "noEvent" ||
            cleanFn === "homotopy" ||
            cleanFn === "/*Real*/" ||
            cleanFn === "/*Integer*/" ||
            cleanFn === "/*Boolean*/"
          ) {
            return argCount > 0 ? dualToJs(firstArg, seedNameId) : "0";
          }
          if (cleanFn === "smooth") {
            if (argCount > 1) return dualToJs(arena.getExprLeft(exprId + 1), seedNameId);
            return argCount > 0 ? dualToJs(firstArg, seedNameId) : "0";
          }
          if (argCount === 1) {
            const dArg = dualToJs(firstArg, seedNameId);
            if (dArg === null) return null;
            if (dArg === "0") return "0";
            const vArg = exprToJs(firstArg);
            if (cleanFn === "sin") return `(Math.cos(${vArg}) * (${dArg}))`;
            if (cleanFn === "cos") return `(-Math.sin(${vArg}) * (${dArg}))`;
            if (cleanFn === "tan") return `((${dArg}) / (Math.cos(${vArg}) * Math.cos(${vArg})))`;
            if (cleanFn === "asin") return `((${dArg}) / Math.sqrt(1 - (${vArg}) * (${vArg})))`;
            if (cleanFn === "acos") return `(-(${dArg}) / Math.sqrt(1 - (${vArg}) * (${vArg})))`;
            if (cleanFn === "atan") return `((${dArg}) / (1 + (${vArg}) * (${vArg})))`;
            if (cleanFn === "sinh") return `(Math.cosh(${vArg}) * (${dArg}))`;
            if (cleanFn === "cosh") return `(Math.sinh(${vArg}) * (${dArg}))`;
            if (cleanFn === "tanh") return `((1 - Math.tanh(${vArg}) * Math.tanh(${vArg})) * (${dArg}))`;
            if (cleanFn === "exp") return `(Math.exp(${vArg}) * (${dArg}))`;
            if (cleanFn === "log") return `((${dArg}) / (${vArg}))`;
            if (cleanFn === "log10") return `((${dArg}) / ((${vArg}) * Math.LN10))`;
            if (cleanFn === "sqrt") return `((${dArg}) / (2 * Math.sqrt(${vArg})))`;
            if (cleanFn === "abs") return `(((${vArg}) >= 0 ? 1 : -1) * (${dArg}))`;
            if (cleanFn === "sign" || cleanFn === "ceil" || cleanFn === "floor" || cleanFn === "integer") {
              return "0";
            }
          }
          if (argCount === 2) {
            const secondArg = arena.getExprLeft(exprId + 1);
            const d0 = dualToJs(firstArg, seedNameId);
            const d1 = dualToJs(secondArg, seedNameId);
            if (d0 === null || d1 === null) return null;
            if (d0 === "0" && d1 === "0") return "0";
            const v0 = exprToJs(firstArg);
            const v1 = exprToJs(secondArg);
            if (cleanFn === "atan2") {
              return `(((${v1}) * (${d0}) - (${v0}) * (${d1})) / ((${v0}) * (${v0}) + (${v1}) * (${v1})))`;
            }
            if (cleanFn === "max") {
              return `((${v0}) >= (${v1}) ? (${d0}) : (${d1}))`;
            }
            if (cleanFn === "min") {
              return `((${v0}) <= (${v1}) ? (${d0}) : (${d1}))`;
            }
          }
          return null;
        }
        default:
          return null;
      }
    }

    // 4. For large models (> 4,000 blocks) or pure causal models when WASM linear bytecode runtime is available,
    // use the linear bytecode executor. When system blocks are present, prefer JS JIT compilation up to 4,000 blocks
    // so analytical residual/Jacobian closures are compiled.
    const hasAnySystemBlock = host.executionBlocks.some((b) => b.type === "system" && b.vars.length > 0);
    if (
      host.executionBlocks.length > 4000 ||
      (!hasAnySystemBlock &&
        (host.executionBlocks.length > 500 ||
          (host.executionBlocks.length > 50 &&
            typeof (arena as unknown as { exports?: WasmArenaExports }).exports?.sim_evalFlatBytecode === "function")))
    ) {
      const flatBc = compileArenaFlatBytecode(host, helpers);
      if (flatBc) return flatBc;
    }

    const exprDependsOnVars = (exprId: number, blockVarIdSet: Set<number>): boolean => {
      if (exprId < 0) return false;
      const kind = arena.getExprKind(exprId);
      if (kind === ExprKind.Name) {
        return blockVarIdSet.has(arena.getExprData1(exprId));
      }
      if (kind === ExprKind.Der) {
        const inner = arena.getExprData1(exprId);
        if (arena.getExprKind(inner) === ExprKind.Name) {
          const innerName = arena.interner.resolve(arena.getExprData1(inner));
          if (innerName) {
            return blockVarIdSet.has(arena.interner.intern(`der(${innerName})`));
          }
        }
        return exprDependsOnVars(inner, blockVarIdSet);
      }
      if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
        return exprDependsOnVars(arena.getExprLeft(exprId), blockVarIdSet);
      }
      if (kind === ExprKind.Binary) {
        return (
          exprDependsOnVars(arena.getExprLeft(exprId), blockVarIdSet) ||
          exprDependsOnVars(arena.getExprRight(exprId), blockVarIdSet)
        );
      }
      if (kind === ExprKind.IfElse) {
        return (
          exprDependsOnVars(arena.getExprData1(exprId), blockVarIdSet) ||
          exprDependsOnVars(arena.getExprLeft(exprId), blockVarIdSet) ||
          exprDependsOnVars(arena.getExprRight(exprId), blockVarIdSet)
        );
      }
      if (kind === ExprKind.Call) {
        const argc = arena.getExprRight(exprId);
        const firstArg = arena.getExprLeft(exprId);
        for (let a = 0; a < argc; a++) {
          if (exprDependsOnVars(a === 0 ? firstArg : arena.getExprLeft(exprId + a), blockVarIdSet)) {
            return true;
          }
        }
        return false;
      }
      return false;
    };

    const isExprLinearInVars = (exprId: number, blockVarIdSet: Set<number>): boolean => {
      if (exprId < 0 || !exprDependsOnVars(exprId, blockVarIdSet)) return true;
      const kind = arena.getExprKind(exprId);
      if (kind === ExprKind.Name || kind === ExprKind.Der) return true;
      if (kind === ExprKind.Negate) {
        return isExprLinearInVars(arena.getExprLeft(exprId), blockVarIdSet);
      }
      if (kind === ExprKind.Unary) {
        return (
          arena.getExprData1(exprId) === UnaryOp.Negate && isExprLinearInVars(arena.getExprLeft(exprId), blockVarIdSet)
        );
      }
      if (kind === ExprKind.Binary) {
        const op = arena.getExprData1(exprId);
        const lId = arena.getExprLeft(exprId);
        const rId = arena.getExprRight(exprId);
        if (op === BinOp.Add || op === BinOp.ElemAdd || op === BinOp.Sub || op === BinOp.ElemSub) {
          return isExprLinearInVars(lId, blockVarIdSet) && isExprLinearInVars(rId, blockVarIdSet);
        }
        if (op === BinOp.Mul || op === BinOp.ElemMul) {
          const lDep = exprDependsOnVars(lId, blockVarIdSet);
          const rDep = exprDependsOnVars(rId, blockVarIdSet);
          if (lDep && rDep) return false;
          return lDep ? isExprLinearInVars(lId, blockVarIdSet) : isExprLinearInVars(rId, blockVarIdSet);
        }
        if (op === BinOp.Div || op === BinOp.ElemDiv) {
          if (exprDependsOnVars(rId, blockVarIdSet)) return false;
          return isExprLinearInVars(lId, blockVarIdSet);
        }
        return false;
      }
      if (kind === ExprKind.IfElse) {
        const condId = arena.getExprData1(exprId);
        if (exprDependsOnVars(condId, blockVarIdSet)) return false;
        return (
          isExprLinearInVars(arena.getExprLeft(exprId), blockVarIdSet) &&
          isExprLinearInVars(arena.getExprRight(exprId), blockVarIdSet)
        );
      }
      if (kind === ExprKind.Call) {
        const fnName = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
        const cleanFn = fnName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
        const argc = arena.getExprRight(exprId);
        const firstArg = arena.getExprLeft(exprId);
        if (
          cleanFn === "noEvent" ||
          cleanFn === "homotopy" ||
          cleanFn === "/*Real*/" ||
          cleanFn === "/*Integer*/" ||
          cleanFn === "/*Boolean*/"
        ) {
          return argc > 0 ? isExprLinearInVars(firstArg, blockVarIdSet) : true;
        }
        if (cleanFn === "smooth") {
          return argc > 1
            ? isExprLinearInVars(arena.getExprLeft(exprId + 1), blockVarIdSet)
            : argc > 0
              ? isExprLinearInVars(firstArg, blockVarIdSet)
              : true;
        }
        return false;
      }
      return false;
    };

    // Track interned StringIds whose values can vary continuously between discrete events:
    // `time`, continuous ODE states (`host.stateVars`), and any causal/algebraic variables
    // that transitively depend on them.
    const continuousChangingIds = new Set<number>();
    continuousChangingIds.add(arena.interner.intern("time"));
    for (const sVarIdx of host.stateVars) {
      continuousChangingIds.add(arena.getVarNameId(sVarIdx));
    }
    const hasContinuousSideEffects =
      host.arena.algorithmSections.length > 0 ||
      Boolean(
        host.fmuRegistry ||
        host.fmuLoader ||
        (host.arena.extensionMetadata as { fmuInstances?: unknown[] } | undefined)?.fmuInstances?.length,
      );
    const envTokenRe = /\benv\[(\d+)\]/g;

    // Chunk into functions of at most 4,000 statements to stay within V8 JIT limits
    const CHUNK_SIZE = 4000;
    type CompiledBlockChunk = (env: Float64Array, h: typeof helpers) => void;
    const chunks: CompiledBlockChunk[] = [];
    let currentLines: string[] = [];

    for (const block of host.executionBlocks) {
      if (block.type === "single") {
        const varNameId = arena.getVarNameId(block.varIdx);
        const exprJs = exprToJs(block.exprId);
        if (
          hasContinuousSideEffects ||
          exprJs.includes("helpers.") ||
          exprDependsOnVars(block.exprId, continuousChangingIds)
        ) {
          continuousChangingIds.add(varNameId);
        }
        currentLines.push(`env[${varNameId}] = ${exprJs};`);
        if (currentLines.length >= CHUNK_SIZE) {
          chunks.push(createDynamicFunction("env", "helpers", currentLines.join("\n")) as CompiledBlockChunk);
          currentLines = [];
        }
      } else if (block.type === "system" && block.vars.length > 0) {
        // 5. For simultaneous algebraic systems (`m` variables), construct residual expressions `lhs - rhs`
        //    and compile dedicated residual (`_compiledResiduals`) and sparse Jacobian (`_compiledJacobian`) closures
        const m = block.vars.length;
        const sysBlock = block as SystemExecutionBlock;
        const varIds = new Int32Array(m);
        const resIds = new Int32Array(m);
        for (let i = 0; i < m; i++) {
          varIds[i] = arena.getVarNameId(block.vars[i] as number);
          const eqIdx = block.eqIdxs[i] as number;
          const lhsId = arena.getEqLhs(eqIdx);
          const rhsId = arena.getEqRhs(eqIdx);
          resIds[i] = arena.addBinaryExpr(BinOp.Sub, lhsId, rhsId);
        }
        sysBlock._varNameIds = varIds;
        sysBlock._resExprIds = resIds;

        let anyResDependsOnCont = hasContinuousSideEffects;
        if (!anyResDependsOnCont) {
          for (let i = 0; i < m; i++) {
            if (exprDependsOnVars(resIds[i] as number, continuousChangingIds)) {
              anyResDependsOnCont = true;
              break;
            }
          }
        }

        if (m <= 256) {
          // Detect whether the system is purely linear (affine) wrt block unknowns
          // and whether its Jacobian depends only on parameters/discrete variables between events.
          const blockVarIdSet = new Set<number>();
          for (let k = 0; k < m; k++) {
            blockVarIdSet.add(varIds[k] as number);
          }
          let isLinearSystem = true;
          let isJacInvariant = !hasContinuousSideEffects;

          const resEnvIds: Array<Set<number> | null> = new Array(m);
          const resLines: string[] = ["let maxR = 0, v = 0, ar = 0;"];
          for (let i = 0; i < m; i++) {
            const resId = resIds[i] as number;
            const resJs = exprToJs(resId);
            if (resJs.includes("helpers.")) {
              anyResDependsOnCont = true;
              isLinearSystem = false;
              resEnvIds[i] = null;
            } else {
              if (!isExprLinearInVars(resId, blockVarIdSet)) {
                isLinearSystem = false;
              }
              const refSet = new Set<number>();
              envTokenRe.lastIndex = 0;
              let rMatch: RegExpExecArray | null;
              while ((rMatch = envTokenRe.exec(resJs)) !== null) {
                refSet.add(Number(rMatch[1]));
              }
              resEnvIds[i] = refSet;
            }
            resLines.push(
              `v = ${resJs}; if (Number.isFinite(v)) { R[${i}] = v; ar = Math.abs(v); if (ar > maxR) maxR = ar; } else { R[${i}] = 1e10; maxR = Infinity; }`,
            );
          }
          resLines.push("return maxR;");
          const rawResFn = createDynamicFunction("env", "x", "R", "helpers", resLines.join("\n")) as (
            env: Float64Array,
            x: Float64Array,
            R: Float64Array,
            h: typeof helpers,
          ) => number;
          sysBlock._compiledResiduals = (env: Float64Array, x: Float64Array, R: Float64Array) =>
            rawResFn(env, x, R, helpers);

          const numericLiteralRe = /^\(?-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\)?$/;
          const jacLines: string[] = [`J.fill(0.0, 0, ${m * m}); let d = 0;`];
          for (let j = 0; j < m; j++) {
            const nid = varIds[j] as number;
            for (let i = 0; i < m; i++) {
              const refSet = resEnvIds[i];
              if (refSet !== null && refSet !== undefined && !refSet.has(nid)) {
                continue;
              }
              const resId = resIds[i] as number;
              const dJs = dualToJs(resId, nid);
              if (dJs === "0") {
                continue;
              }
              const idx = i * m + j;
              if (dJs !== null) {
                if (numericLiteralRe.test(dJs)) {
                  jacLines.push(`J[${idx}] = ${dJs};`);
                  continue;
                }
                if (dJs.includes("helpers.")) {
                  isJacInvariant = false;
                }
                if (isLinearSystem || isJacInvariant) {
                  envTokenRe.lastIndex = 0;
                  let match: RegExpExecArray | null;
                  while ((match = envTokenRe.exec(dJs)) !== null) {
                    const refId = Number(match[1]);
                    if (blockVarIdSet.has(refId)) {
                      isLinearSystem = false;
                      isJacInvariant = false;
                      break;
                    }
                    if (continuousChangingIds.has(refId)) {
                      isJacInvariant = false;
                    }
                  }
                }
                jacLines.push(
                  `d = ${dJs}; J[${idx}] = Number.isFinite(d) ? d : helpers.evalDual(${resId}, ${nid}, env, x, R, ${i}, ${j});`,
                );
              } else {
                isLinearSystem = false;
                isJacInvariant = false;
                jacLines.push(`J[${idx}] = helpers.evalDual(${resId}, ${nid}, env, x, R, ${i}, ${j});`);
              }
            }
          }
          if (jacLines.length <= 3000) {
            const rawJacFn = createDynamicFunction("env", "x", "R", "J", "helpers", jacLines.join("\n")) as (
              env: Float64Array,
              x: Float64Array,
              R: Float64Array,
              J: Float64Array,
              h: typeof helpers,
            ) => void;
            sysBlock._compiledJacobian = (env: Float64Array, x: Float64Array, R: Float64Array, J: Float64Array) =>
              rawJacFn(env, x, R, J, helpers);
          }
          sysBlock._isLinearSystem = isLinearSystem;
          sysBlock._isJacInvariantBetweenEvents = isLinearSystem && isJacInvariant;
        }

        if (anyResDependsOnCont) {
          for (let k = 0; k < m; k++) {
            continuousChangingIds.add(varIds[k] as number);
          }
        }

        const sysIdx = systemBlocks.length;
        systemBlocks.push(block);
        currentLines.push(`helpers.solveSystem(${sysIdx}, env);`);
        if (currentLines.length >= CHUNK_SIZE) {
          chunks.push(createDynamicFunction("env", "helpers", currentLines.join("\n")) as CompiledBlockChunk);
          currentLines = [];
        }
      }
    }

    if (currentLines.length > 0) {
      chunks.push(createDynamicFunction("env", "helpers", currentLines.join("\n")) as CompiledBlockChunk);
    }

    if (chunks.length === 1) {
      const c0 = chunks[0]!;
      return (env: Float64Array) => c0(env, helpers);
    }
    return (env: Float64Array) => {
      for (const chunk of chunks) chunk(env, helpers);
    };
  } catch {
    return null;
  }
}

/**
 * Prepares and caches the flat linear bytecode representation of execution blocks
 * along with WebAssembly linear memory allocations if available.
 */
export function prepareArenaFlatBytecode(host: ArenaBlockCompilerHost): FlatBytecodeCache | null {
  if (host._cachedFlatBytecode) return host._cachedFlatBytecode;

  const arena = host.arena;
  const blocks = host.executionBlocks;
  const numBlocks = blocks.length;
  if (numBlocks === 0) return null;

  const OP_NAME = 1; // [OP_NAME, targetNameId, srcNameId]
  const OP_NEG_NAME = 2; // [OP_NEG_NAME, targetNameId, srcNameId]
  const OP_LIT = 3; // [OP_LIT, targetNameId, litIndex]
  const OP_ADD_NAMES = 4; // [OP_ADD_NAMES, targetNameId, leftNameId, rightNameId]
  const OP_SUB_NAMES = 5; // [OP_SUB_NAMES, targetNameId, leftNameId, rightNameId]
  const OP_MUL_NAMES = 6; // [OP_MUL_NAMES, targetNameId, leftNameId, rightNameId]
  const OP_DIV_NAMES = 7; // [OP_DIV_NAMES, targetNameId, leftNameId, rightNameId]
  const OP_EXPR = 8; // [OP_EXPR, targetNameId, exprId]
  const OP_SYSTEM = 9; // [OP_SYSTEM, sysBlockIndex]

  const bc = new Int32Array(numBlocks * 4);
  const literals: number[] = [];
  const systemBlocks: Extract<ArenaExecutionBlock, { type: "system" }>[] = [];
  let pc = 0;

  for (const block of blocks) {
    if (block.type === "single") {
      const targetVarNameId = arena.getVarNameId(block.varIdx);
      const exprId = block.exprId;
      if (exprId < 0) {
        bc[pc++] = OP_LIT;
        bc[pc++] = targetVarNameId;
        bc[pc++] = literals.length;
        literals.push(0);
        continue;
      }

      const kind = arena.getExprKind(exprId);
      if (kind === ExprKind.Name) {
        bc[pc++] = OP_NAME;
        bc[pc++] = targetVarNameId;
        bc[pc++] = arena.getExprData1(exprId);
      } else if (kind === ExprKind.Negate) {
        const innerId = arena.getExprLeft(exprId);
        if (innerId >= 0 && arena.getExprKind(innerId) === ExprKind.Name) {
          bc[pc++] = OP_NEG_NAME;
          bc[pc++] = targetVarNameId;
          bc[pc++] = arena.getExprData1(innerId);
        } else {
          bc[pc++] = OP_EXPR;
          bc[pc++] = targetVarNameId;
          bc[pc++] = exprId;
        }
      } else if (kind === ExprKind.RealLiteral) {
        bc[pc++] = OP_LIT;
        bc[pc++] = targetVarNameId;
        bc[pc++] = literals.length;
        literals.push(arena.getExprRealValue(exprId));
      } else if (kind === ExprKind.IntLiteral || kind === ExprKind.BoolLiteral || kind === ExprKind.EnumLiteral) {
        bc[pc++] = OP_LIT;
        bc[pc++] = targetVarNameId;
        bc[pc++] = literals.length;
        literals.push(arena.getExprData1(exprId));
      } else if (kind === ExprKind.Binary) {
        const op = arena.getExprData1(exprId);
        const lId = arena.getExprLeft(exprId);
        const rId = arena.getExprRight(exprId);
        if (
          lId >= 0 &&
          rId >= 0 &&
          arena.getExprKind(lId) === ExprKind.Name &&
          arena.getExprKind(rId) === ExprKind.Name
        ) {
          const lName = arena.getExprData1(lId);
          const rName = arena.getExprData1(rId);
          if (op === BinOp.Add || op === BinOp.ElemAdd) {
            bc[pc++] = OP_ADD_NAMES;
            bc[pc++] = targetVarNameId;
            bc[pc++] = lName;
            bc[pc++] = rName;
          } else if (op === BinOp.Sub || op === BinOp.ElemSub) {
            bc[pc++] = OP_SUB_NAMES;
            bc[pc++] = targetVarNameId;
            bc[pc++] = lName;
            bc[pc++] = rName;
          } else if (op === BinOp.Mul || op === BinOp.ElemMul) {
            bc[pc++] = OP_MUL_NAMES;
            bc[pc++] = targetVarNameId;
            bc[pc++] = lName;
            bc[pc++] = rName;
          } else if (op === BinOp.Div || op === BinOp.ElemDiv) {
            bc[pc++] = OP_DIV_NAMES;
            bc[pc++] = targetVarNameId;
            bc[pc++] = lName;
            bc[pc++] = rName;
          } else {
            bc[pc++] = OP_EXPR;
            bc[pc++] = targetVarNameId;
            bc[pc++] = exprId;
          }
        } else {
          bc[pc++] = OP_EXPR;
          bc[pc++] = targetVarNameId;
          bc[pc++] = exprId;
        }
      } else {
        bc[pc++] = OP_EXPR;
        bc[pc++] = targetVarNameId;
        bc[pc++] = exprId;
      }
    } else if (block.type === "system") {
      const sysIdx = systemBlocks.length;
      systemBlocks.push(block);
      bc[pc++] = OP_SYSTEM;
      bc[pc++] = sysIdx;
    }
  }

  const bytecode = bc.subarray(0, pc);
  const litArray = new Float64Array(literals);
  const bytecodeLen = bytecode.length;
  let bcPtr = 0;
  let litPtr = 0;

  const wasmExports = (arena as unknown as { exports?: WasmArenaExports }).exports;
  if (
    systemBlocks.length === 0 &&
    wasmExports &&
    typeof wasmExports.atomicChunkAlloc === "function" &&
    wasmExports.memory instanceof WebAssembly.Memory
  ) {
    const mem = wasmExports.memory;
    const bcBytes = bytecode.byteLength;
    bcPtr = wasmExports.atomicChunkAlloc(bcBytes);
    new Int32Array(mem.buffer, bcPtr, bytecode.length).set(bytecode);

    const litBytes = litArray.byteLength;
    litPtr = litArray.length > 0 ? wasmExports.atomicChunkAlloc(litBytes) : 0;
    if (litPtr && litArray.length > 0) {
      new Float64Array(mem.buffer, litPtr, litArray.length).set(litArray);
    }
  }

  host._cachedFlatBytecode = {
    bcPtr,
    bytecodeLen,
    litPtr,
    bytecode,
    litArray,
    hasSystemBlocks: systemBlocks.length > 0,
    systemBlocks,
  };
  return host._cachedFlatBytecode;
}

/**
 * Compiles execution blocks into a flat linear bytecode plan for massive models (> 2,000 blocks),
 * bypassing V8 string code generation and `new Function` compilation overhead.
 */
export function compileArenaFlatBytecode(
  host: ArenaBlockCompilerHost,
  helpers: Record<string, unknown>,
): ((env: Float64Array) => void) | null {
  const flatBc = prepareArenaFlatBytecode(host);
  if (!flatBc) return null;

  const arena = host.arena;
  const wasmExports = (arena as unknown as { exports?: WasmArenaExports }).exports;
  const { bcPtr, bytecodeLen, litPtr, bytecode, litArray, hasSystemBlocks, systemBlocks } = flatBc;

  // Direct In-WASM Linear Bytecode Execution path
  if (
    !hasSystemBlocks &&
    bcPtr !== 0 &&
    typeof wasmExports?.sim_evalFlatBytecode === "function" &&
    wasmExports?.memory instanceof WebAssembly.Memory &&
    typeof wasmExports?.atomicChunkAlloc === "function"
  ) {
    const mem = wasmExports.memory;
    const envSize = Math.max(arena.interner.size + 256, 4096);
    const scratchBytes = envSize * 8;
    const wasmScratchPtr = wasmExports.atomicChunkAlloc(scratchBytes);

    return (env: Float64Array) => {
      const currentMem = mem.buffer;
      let targetEnvPtr = wasmScratchPtr;
      let needsCopyBack = false;

      if (env.buffer === currentMem) {
        targetEnvPtr = env.byteOffset;
      } else {
        const scratchView = new Float64Array(currentMem, targetEnvPtr, env.length);
        scratchView.set(env);
        needsCopyBack = true;
      }

      wasmExports.sim_evalFlatBytecode?.(
        arena.ptr,
        bcPtr,
        bytecodeLen,
        litPtr,
        targetEnvPtr,
        1, // isStringIdEnv = true
      );

      if (needsCopyBack) {
        env.set(new Float64Array(currentMem, targetEnvPtr, env.length));
      }
    };
  }

  // Host JavaScript bytecode interpreter fallback (handles OP_SYSTEM Newton blocks)
  return (env: Float64Array) => {
    let ptr = 0;
    while (ptr < bytecodeLen) {
      const op = bytecode[ptr++];
      switch (op) {
        case 1: {
          // OP_NAME
          const target = bytecode[ptr++] as number;
          const src = bytecode[ptr++] as number;
          env[target] = env[src] ?? 0;
          break;
        }
        case 2: {
          // OP_NEG_NAME
          const target = bytecode[ptr++] as number;
          const src = bytecode[ptr++] as number;
          env[target] = -(env[src] ?? 0);
          break;
        }
        case 3: {
          // OP_LIT
          const target = bytecode[ptr++] as number;
          const litIdx = bytecode[ptr++] as number;
          env[target] = litArray[litIdx] ?? 0;
          break;
        }
        case 4: {
          // OP_ADD_NAMES
          const target = bytecode[ptr++] as number;
          const left = bytecode[ptr++] as number;
          const right = bytecode[ptr++] as number;
          env[target] = (env[left] ?? 0) + (env[right] ?? 0);
          break;
        }
        case 5: {
          // OP_SUB_NAMES
          const target = bytecode[ptr++] as number;
          const left = bytecode[ptr++] as number;
          const right = bytecode[ptr++] as number;
          env[target] = (env[left] ?? 0) - (env[right] ?? 0);
          break;
        }
        case 6: {
          // OP_MUL_NAMES
          const target = bytecode[ptr++] as number;
          const left = bytecode[ptr++] as number;
          const right = bytecode[ptr++] as number;
          env[target] = (env[left] ?? 0) * (env[right] ?? 0);
          break;
        }
        case 7: {
          // OP_DIV_NAMES
          const target = bytecode[ptr++] as number;
          const left = bytecode[ptr++] as number;
          const right = bytecode[ptr++] as number;
          const rVal = env[right] ?? 0;
          env[target] = rVal !== 0 ? (env[left] ?? 0) / rVal : 0;
          break;
        }
        case 8: {
          // OP_EXPR
          const target = bytecode[ptr++] as number;
          const exprId = bytecode[ptr++] as number;
          env[target] = (helpers["evalExpr"] as (exprId: number, env: Float64Array) => number)(exprId, env);
          break;
        }
        case 9: {
          // OP_SYSTEM
          const sysIdx = bytecode[ptr++] as number;
          const blk = systemBlocks[sysIdx];
          if (blk) {
            host.solveNewtonBlock(blk as Extract<ArenaExecutionBlock, { type: "system" }>, env);
          }
          break;
        }
        default:
          break;
      }
    }
  };
}

/**
 * Determines whether the current model can be integrated directly inside WebAssembly linear memory
 * using sim_runBytecodeSimulationLoop without host context-switching.
 */
export function canRunArenaWasmSimulationLoop(host: ArenaBlockCompilerHost): boolean {
  const wasmExports = (
    host.arena as unknown as {
      exports?: {
        sim_runBytecodeSimulationLoop?: unknown;
        atomicChunkAlloc?: unknown;
        memory?: unknown;
      };
    }
  ).exports;
  if (
    !wasmExports ||
    typeof wasmExports.sim_runBytecodeSimulationLoop !== "function" ||
    typeof wasmExports.atomicChunkAlloc !== "function" ||
    !(wasmExports.memory instanceof WebAssembly.Memory)
  ) {
    return false;
  }
  const flatBc = prepareArenaFlatBytecode(host);
  if (!flatBc || flatBc.hasSystemBlocks || flatBc.bytecodeLen === 0) {
    return false;
  }
  return true;
}

/**
 * Runs the full time-stepping simulation loop directly in WebAssembly linear memory,
 * generating a zero-copy trajectory buffer and eliminating per-step host transitions.
 */
export function runArenaWasmSimulationLoop(
  host: ArenaBlockCompilerHost,
  steps: number,
  step: number,
  valuesByStringId: Float64Array,
  stateStringIds: number[],
  derivStringIds: number[],
  timeId: number,
  options?: {
    solver?: string | undefined;
    atol?: number | undefined;
    rtol?: number | undefined;
    safetySpec?:
      | {
          invariants?: Array<{ expr: string }>;
          guarantees?: Array<{ expr: string }>;
          [key: string]: unknown;
        }
      | undefined;
    safetyMode?: string | undefined;
    intervalMode?: boolean | undefined;
    outputStringIds?: number[] | undefined;
  },
): {
  t: number[];
  y: Float64Array[];
  terminatedEarly: boolean;
  safetyViolations: SafetyViolationRecord[];
  intervalIssues: string[];
} {
  const wasmExports = (
    host.arena as unknown as {
      exports?: {
        memory: WebAssembly.Memory;
        atomicChunkAlloc: (bytes: number) => number;
        atomicChunkFree: (ptr: number) => void;
        sim_runBytecodeSimulationLoop: (...args: number[]) => number;
      } & Record<string, unknown>;
    }
  ).exports!;
  const mem = wasmExports.memory;
  const n = stateStringIds.length;
  const startTime = valuesByStringId[timeId] ?? 0;
  const solver = options?.solver ?? "rk4";
  const solverKind = solver === "tsit5" || solver === "dopri5" ? 2 : solver === "rk4" ? 1 : 0;
  const atol = options?.atol ?? 1e-7;
  const rtol = options?.rtol ?? 1e-7;

  const flatBc = prepareArenaFlatBytecode(host);
  if (!flatBc || flatBc.hasSystemBlocks) {
    throw new Error("WASM simulation loop requires valid flat bytecode without system blocks");
  }

  // Copy source TypedArrays before atomicChunkAlloc() because memory.grow() detaches prior WASM ArrayBuffer views.
  const envValuesCopy = new Float64Array(valuesByStringId);

  // Ensure WASM linear memory buffers for bytecode are allocated
  if (flatBc.bcPtr === 0 && typeof wasmExports.atomicChunkAlloc === "function") {
    const bcCopy = new Int32Array(flatBc.bytecode);
    const bcBytes = bcCopy.byteLength;
    flatBc.bcPtr = wasmExports.atomicChunkAlloc(bcBytes);
    new Int32Array(mem.buffer, flatBc.bcPtr, bcCopy.length).set(bcCopy);

    const litCopy = new Float64Array(flatBc.litArray);
    const litBytes = litCopy.byteLength;
    flatBc.litPtr = litBytes > 0 ? wasmExports.atomicChunkAlloc(litBytes) : 0;
    if (flatBc.litPtr && litBytes > 0) {
      new Float64Array(mem.buffer, flatBc.litPtr, litCopy.length).set(litCopy);
    }
  }

  const outIds = resolveArenaOutputIds(host.arena, options?.outputStringIds ?? stateStringIds);
  const numOuts = outIds.length;
  const totalRows = steps + 1;

  // 1. Allocate environment in WASM linear memory
  const envSize = Math.max(host.arena.interner.size + 256, envValuesCopy.length, 4096);
  const envBytes = envSize * 8;
  const envPtr = wasmExports.atomicChunkAlloc(envBytes);
  new Float64Array(mem.buffer, envPtr, envValuesCopy.length).set(envValuesCopy);

  // 2. Allocate and populate stateIds, derivIds, and outIds
  const stateIdsBytes = Math.max(n * 4, 4);
  const stateIdsPtr = wasmExports.atomicChunkAlloc(stateIdsBytes);
  if (n > 0) {
    new Int32Array(mem.buffer, stateIdsPtr, n).set(stateStringIds);
  }

  const derivIdsBytes = Math.max(n * 4, 4);
  const derivIdsPtr = wasmExports.atomicChunkAlloc(derivIdsBytes);
  if (n > 0) {
    new Int32Array(mem.buffer, derivIdsPtr, n).set(derivStringIds);
  }

  const outIdsBytes = Math.max(numOuts * 4, 4);
  const outIdsPtr = wasmExports.atomicChunkAlloc(outIdsBytes);
  if (numOuts > 0) {
    new Int32Array(mem.buffer, outIdsPtr, numOuts).set(outIds);
  }

  // 3. Allocate output trajectory buffer: totalRows * numOuts doubles
  const trajBytes = Math.max(totalRows * numOuts * 8, 8);
  const trajOutPtr = wasmExports.atomicChunkAlloc(trajBytes);

  // 4. Allocate scratch buffer: RK4 needs 5*n*8, Tsit5 needs 10*n*8
  const scratchBytes = solverKind === 2 ? Math.max(10 * n * 8, 8) : solverKind === 1 ? Math.max(5 * n * 8, 8) : 8;
  const rk4ScratchPtr = wasmExports.atomicChunkAlloc(scratchBytes);

  try {
    // 5. Execute in-WASM simulation loop
    wasmExports.sim_runBytecodeSimulationLoop(
      host.arena.ptr,
      flatBc.bcPtr,
      flatBc.bytecodeLen,
      flatBc.litPtr,
      envPtr,
      stateIdsPtr,
      derivIdsPtr,
      n,
      outIdsPtr,
      numOuts,
      timeId,
      startTime,
      step,
      steps,
      solverKind,
      trajOutPtr,
      rk4ScratchPtr,
      atol,
      rtol,
    );

    // 6. Extract trajectory
    const t_out = new Array<number>(totalRows);
    const y_out = new Array<Float64Array>(totalRows);
    const trajView = new Float64Array(mem.buffer, trajOutPtr, totalRows * numOuts);

    for (let s = 0; s < totalRows; s++) {
      t_out[s] = startTime + s * step;
      y_out[s] = numOuts > 0 ? trajView.slice(s * numOuts, (s + 1) * numOuts) : new Float64Array(0);
    }

    // 7. Update valuesByStringId with final simulation state
    const finalEnv = new Float64Array(mem.buffer, envPtr, valuesByStringId.length);
    if (valuesByStringId.buffer.byteLength > 0) {
      valuesByStringId.set(finalEnv);
    }
    if (
      host.preValuesByStringId &&
      host.preValuesByStringId.buffer.byteLength > 0 &&
      host.preValuesByStringId.length === valuesByStringId.length
    ) {
      host.preValuesByStringId.set(finalEnv);
    }

    return {
      t: t_out,
      y: y_out,
      terminatedEarly: false,
      safetyViolations: [],
      intervalIssues: [],
    };
  } finally {
    if (typeof wasmExports.atomicChunkFree === "function") {
      wasmExports.atomicChunkFree(envPtr);
      wasmExports.atomicChunkFree(stateIdsPtr);
      wasmExports.atomicChunkFree(derivIdsPtr);
      wasmExports.atomicChunkFree(outIdsPtr);
      wasmExports.atomicChunkFree(trajOutPtr);
      wasmExports.atomicChunkFree(rk4ScratchPtr);
    }
  }
}
