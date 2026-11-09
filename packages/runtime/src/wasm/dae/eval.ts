// SPDX-License-Identifier: AGPL-3.0-or-later

import { DaeBuilder, ExprKind, BinOp, UnaryOp, BuiltinMathFunc } from "./builder";
import { ExprAccessor, EqAccessor } from "./accessors";
import { UnmanagedFloat64Array, UnmanagedInt32Array } from "../core/array";
import {
  EXEC_BLOCK_STRIDE,
  EXEC_KIND,
  EXEC_TARGET,
  EXEC_EXPR,
  EXEC_OP_SINGLE,
  EXEC_OP_DIRECT_COPY,
  EXEC_OP_NEG_COPY,
  BC_OP_NAME,
  BC_OP_NEG_NAME,
  BC_OP_LIT,
  BC_OP_ADD_NAMES,
  BC_OP_SUB_NAMES,
  BC_OP_MUL_NAMES,
  BC_OP_DIV_NAMES,
  BC_OP_EXPR,
  BC_OP_SYSTEM,
} from "./types";

/**
 * Generic expression tree evaluation supporting either varIdx-indexed or StringId-indexed env buffers.
 */
export function evalExprGeneric(exprId: u32, dae: DaeBuilder, varValuesPtr: usize, isStringIdEnv: bool): f64 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0.0;

  let e = ExprAccessor.at(dae.getExprData(), exprId);
  let kind = e.kind;

  if (kind == ExprKind.RealLiteral) {
    return e.realValue;
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.EnumLiteral) {
    return e.intValue as f64;
  }

  if (kind == ExprKind.Name) {
    if (isStringIdEnv) {
      return changetype<UnmanagedFloat64Array>(varValuesPtr)[e.data1u as i32];
    } else {
      let resolved = dae.resolveExprVarId(e.varId);
      if (resolved < 0) return 0.0;
      return changetype<UnmanagedFloat64Array>(varValuesPtr)[resolved as i32];
    }
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let isNot = kind == ExprKind.Unary && e.unaryOp == UnaryOp.Not;
    let left = e.left;
    let val = evalExprGeneric(left, dae, varValuesPtr, isStringIdEnv);
    if (isNot) {
      return val == 0.0 ? 1.0 : 0.0;
    }
    return -val;
  }

  if (kind == ExprKind.Binary) {
    let op = e.binOp;
    let left = e.left;
    let right = e.right;
    let lVal = evalExprGeneric(left, dae, varValuesPtr, isStringIdEnv);
    let rVal = evalExprGeneric(right, dae, varValuesPtr, isStringIdEnv);

    if (op == BinOp.Add || op == BinOp.ElemAdd) return lVal + rVal;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return lVal - rVal;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return lVal * rVal;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return rVal != 0.0 ? lVal / rVal : 0.0;
    if (op == BinOp.Pow || op == BinOp.ElemPow) return Math.pow(lVal, rVal);
    if (op == BinOp.Eq)  return lVal == rVal ? 1.0 : 0.0;
    if (op == BinOp.Neq) return lVal != rVal ? 1.0 : 0.0;
    if (op == BinOp.Lt)  return lVal <  rVal ? 1.0 : 0.0;
    if (op == BinOp.Lte) return lVal <= rVal ? 1.0 : 0.0;
    if (op == BinOp.Gt)  return lVal >  rVal ? 1.0 : 0.0;
    if (op == BinOp.Gte) return lVal >= rVal ? 1.0 : 0.0;
    if (op == BinOp.And) return lVal != 0.0 && rVal != 0.0 ? 1.0 : 0.0;
    if (op == BinOp.Or)  return lVal != 0.0 || rVal != 0.0 ? 1.0 : 0.0;
  }

  if (kind == ExprKind.IfElse) {
    let cond = e.data1u;
    let left = e.left;
    let right = e.right;
    let condVal = evalExprGeneric(cond, dae, varValuesPtr, isStringIdEnv);
    return condVal != 0.0
      ? evalExprGeneric(left,  dae, varValuesPtr, isStringIdEnv)
      : evalExprGeneric(right, dae, varValuesPtr, isStringIdEnv);
  }

  if (kind == ExprKind.Call) {
    let left = e.left;
    let funcId = dae.resolveBuiltinMathFunc(e.funcId as i32);
    let v1 = evalExprGeneric(left, dae, varValuesPtr, isStringIdEnv);

    if (funcId == BuiltinMathFunc.Sin)     return Math.sin(v1);
    if (funcId == BuiltinMathFunc.Cos)     return Math.cos(v1);
    if (funcId == BuiltinMathFunc.Tan)     return Math.tan(v1);
    if (funcId == BuiltinMathFunc.Asin)    return Math.asin(v1);
    if (funcId == BuiltinMathFunc.Acos)    return Math.acos(v1);
    if (funcId == BuiltinMathFunc.Atan)    return Math.atan(v1);
    if (funcId == BuiltinMathFunc.Sinh)    return Math.sinh(v1);
    if (funcId == BuiltinMathFunc.Cosh)    return Math.cosh(v1);
    if (funcId == BuiltinMathFunc.Tanh)    return Math.tanh(v1);
    if (funcId == BuiltinMathFunc.Exp)     return Math.exp(v1);
    if (funcId == BuiltinMathFunc.Log)     return Math.log(v1);
    if (funcId == BuiltinMathFunc.Log10)   return Math.log10(v1);
    if (funcId == BuiltinMathFunc.Sqrt)    return Math.sqrt(v1);
    if (funcId == BuiltinMathFunc.Abs)     return Math.abs(v1);
    if (funcId == BuiltinMathFunc.Sign)    return v1 > 0.0 ? 1.0 : v1 < 0.0 ? -1.0 : 0.0;
    if (funcId == BuiltinMathFunc.Floor)   return Math.floor(v1);
    if (funcId == BuiltinMathFunc.Ceil)    return Math.ceil(v1);
    if (funcId == BuiltinMathFunc.NoEvent || funcId == BuiltinMathFunc.Homotopy) return v1;

    if (
      funcId == BuiltinMathFunc.Atan2 ||
      funcId == BuiltinMathFunc.Min ||
      funcId == BuiltinMathFunc.Max ||
      funcId == BuiltinMathFunc.Fmod ||
      funcId == BuiltinMathFunc.Pow ||
      funcId == BuiltinMathFunc.Smooth ||
      funcId == BuiltinMathFunc.SemiLinear
    ) {
      let secondArgId = dae.getCallArgExprId(exprId, 1);
      let v2 = evalExprGeneric(secondArgId, dae, varValuesPtr, isStringIdEnv);
      if (funcId == BuiltinMathFunc.Atan2)  return Math.atan2(v1, v2);
      if (funcId == BuiltinMathFunc.Min)    return Math.min(v1, v2);
      if (funcId == BuiltinMathFunc.Max)    return Math.max(v1, v2);
      if (funcId == BuiltinMathFunc.Fmod)   return v2 != 0.0 ? v1 % v2 : 0.0;
      if (funcId == BuiltinMathFunc.Pow)    return Math.pow(v1, v2);
      if (funcId == BuiltinMathFunc.Smooth) return v2;
      if (funcId == BuiltinMathFunc.SemiLinear) {
        let thirdArgId = dae.getCallArgExprId(exprId, 2);
        let v3 = thirdArgId < dae.exprCount ? evalExprGeneric(thirdArgId, dae, varValuesPtr, isStringIdEnv) : 0.0;
        return v1 >= 0.0 ? v2 * v1 : v3 * v1;
      }
    }
  }

  return 0.0;
}

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values (varIdx-indexed).
 * Returns f64 result.
 */
export function evalExpr(exprId: u32, dae: DaeBuilder, varValuesPtr: usize): f64 {
  return evalExprGeneric(exprId, dae, varValuesPtr, false);
}

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values indexed by StringId.
 * Returns f64 result.
 */
export function evalExprByStringId(exprId: u32, dae: DaeBuilder, envPtr: usize): f64 {
  return evalExprGeneric(exprId, dae, envPtr, true);
}

/**
 * Computes equation residual: F(x) = RHS - LHS
 */
@inline
export function evalEquationResidual(eqId: u32, dae: DaeBuilder, varValuesPtr: usize): f64 {
  if (eqId >= dae.eqCount) return 0.0;
  let eq = EqAccessor.at(dae.getEqData(), eqId);
  let lhs = eq.lhs;
  let rhs = eq.rhs;
  let lhsVal = evalExpr(lhs, dae, varValuesPtr);
  let rhsVal = evalExpr(rhs, dae, varValuesPtr);
  return rhsVal - lhsVal;
}

export function dae_evalExpr(daePtr: u32, exprId: u32, varValuesPtr: usize): f64 {
  return evalExpr(exprId, changetype<DaeBuilder>(daePtr as usize), varValuesPtr);
}

export function dae_evalExprByStringId(daePtr: u32, exprId: u32, envPtr: usize): f64 {
  return evalExprByStringId(exprId, changetype<DaeBuilder>(daePtr as usize), envPtr);
}

export function dae_evalEquationResidual(daePtr: u32, eqId: u32, varValuesPtr: usize): f64 {
  return evalEquationResidual(eqId, changetype<DaeBuilder>(daePtr as usize), varValuesPtr);
}

/**
 * Evaluates linear execution blocks directly in WebAssembly linear memory.
 * Each block has EXEC_BLOCK_STRIDE = 3 words: [kind, targetId, exprId]
 */
export function sim_evalExecutionBlocks(
  daePtr: u32,
  blocksPtr: usize,
  blockCount: i32,
  envPtr: usize,
  isStringIdEnv: bool
): void {
  if (daePtr == 0 || blocksPtr == 0 || envPtr == 0 || blockCount <= 0) return;
  let dae = changetype<DaeBuilder>(daePtr as usize);
  let blocks = changetype<UnmanagedInt32Array>(blocksPtr);
  let env = changetype<UnmanagedFloat64Array>(envPtr);

  for (let i: i32 = 0; i < blockCount; ++i) {
    let offset = i * (EXEC_BLOCK_STRIDE as i32);
    let kind = blocks[offset + (EXEC_KIND as i32)];
    let target = blocks[offset + (EXEC_TARGET as i32)];
    let exprId = blocks[offset + (EXEC_EXPR as i32)] as u32;

    if (kind == EXEC_OP_SINGLE) {
      env[target] = evalExprGeneric(exprId, dae, envPtr, isStringIdEnv);
    } else if (kind == EXEC_OP_DIRECT_COPY) {
      env[target] = env[exprId as i32];
    } else if (kind == EXEC_OP_NEG_COPY) {
      env[target] = -env[exprId as i32];
    }
  }
}

/**
 * Evaluates flat linear bytecode instructions directly in WebAssembly linear memory.
 */
export function sim_evalFlatBytecode(
  daePtr: u32,
  bytecodePtr: usize,
  bytecodeLen: i32,
  litPtr: usize,
  envPtr: usize,
  isStringIdEnv: bool
): void {
  if (bytecodePtr == 0 || envPtr == 0 || bytecodeLen <= 0) return;
  let dae = changetype<DaeBuilder>(daePtr as usize);
  let bc = changetype<UnmanagedInt32Array>(bytecodePtr);
  let lits = changetype<UnmanagedFloat64Array>(litPtr);
  let env = changetype<UnmanagedFloat64Array>(envPtr);

  let pc: i32 = 0;
  while (pc < bytecodeLen) {
    let op = bc[pc++];
    switch (op) {
      case BC_OP_NAME: {
        let target = bc[pc++];
        let src = bc[pc++];
        env[target] = env[src];
        break;
      }
      case BC_OP_NEG_NAME: {
        let target = bc[pc++];
        let src = bc[pc++];
        env[target] = -env[src];
        break;
      }
      case BC_OP_LIT: {
        let target = bc[pc++];
        let litIdx = bc[pc++];
        env[target] = lits[litIdx];
        break;
      }
      case BC_OP_ADD_NAMES: {
        let target = bc[pc++];
        let left = bc[pc++];
        let right = bc[pc++];
        env[target] = env[left] + env[right];
        break;
      }
      case BC_OP_SUB_NAMES: {
        let target = bc[pc++];
        let left = bc[pc++];
        let right = bc[pc++];
        env[target] = env[left] - env[right];
        break;
      }
      case BC_OP_MUL_NAMES: {
        let target = bc[pc++];
        let left = bc[pc++];
        let right = bc[pc++];
        env[target] = env[left] * env[right];
        break;
      }
      case BC_OP_DIV_NAMES: {
        let target = bc[pc++];
        let left = bc[pc++];
        let right = bc[pc++];
        let rVal = env[right];
        env[target] = rVal != 0.0 ? env[left] / rVal : 0.0;
        break;
      }
      case BC_OP_EXPR: {
        let target = bc[pc++];
        let exprId = bc[pc++] as u32;
        env[target] = evalExprGeneric(exprId, dae, envPtr, isStringIdEnv);
        break;
      }
      case BC_OP_SYSTEM: {
        // Skip system index in WASM bytecode execution (handled by host solver)
        pc++;
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Executes a full fixed-step continuous ODE integration loop directly in WebAssembly linear memory
 * without host context-switching or intermediate array allocations.
 *
 * Trajectory output is written to `trajOutPtr` as:
 * [step 0 states (numOuts doubles), step 1 states, ..., step N states]
 *
 * @param daePtr Pointer to DaeBuilder (u32)
 * @param bytecodePtr Pointer to compiled flat bytecode (Int32Array)
 * @param bytecodeLen Length of bytecode array (i32)
 * @param litPtr Pointer to literal numbers table (Float64Array)
 * @param envPtr Pointer to environment vector indexed by StringId (Float64Array)
 * @param stateIdsPtr Pointer to state StringIds (Int32Array)
 * @param derivIdsPtr Pointer to derivative StringIds (Int32Array)
 * @param numStates Number of state variables (i32)
 * @param outIdsPtr Pointer to output StringIds to record (Int32Array)
 * @param numOuts Number of output variables to record per step (i32)
 * @param timeId StringId of the 'time' variable (i32)
 * @param startTime Initial simulation time (f64)
 * @param dt Time step size (f64)
 * @param steps Number of integration steps (i32)
 * @param solverKind 0 for Forward Euler, 1 for RK4 (i32)
 * @param trajOutPtr Pointer to output trajectory buffer: (steps + 1) * numOuts * 8 bytes (usize)
 * @param rk4ScratchPtr Pointer to scratch buffer for RK4: 5 * numStates * 8 bytes (usize)
 */
export function sim_runBytecodeSimulationLoop(
  daePtr: u32,
  bytecodePtr: usize,
  bytecodeLen: i32,
  litPtr: usize,
  envPtr: usize,
  stateIdsPtr: usize,
  derivIdsPtr: usize,
  numStates: i32,
  outIdsPtr: usize,
  numOuts: i32,
  timeId: i32,
  startTime: f64,
  dt: f64,
  steps: i32,
  solverKind: i32,
  trajOutPtr: usize,
  rk4ScratchPtr: usize
): void {
  if (bytecodePtr == 0 || envPtr == 0 || bytecodeLen <= 0 || steps < 0) return;

  let env = changetype<UnmanagedFloat64Array>(envPtr);
  let traj = changetype<UnmanagedFloat64Array>(trajOutPtr);
  let stateIds = changetype<UnmanagedInt32Array>(stateIdsPtr);
  let derivIds = changetype<UnmanagedInt32Array>(derivIdsPtr);
  let outIds = changetype<UnmanagedInt32Array>(outIdsPtr);

  // Initialize time and evaluate blocks at t = startTime
  if (timeId >= 0) {
    env[timeId] = startTime;
  }
  sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);

  // Record initial step 0
  if (trajOutPtr != 0 && numOuts > 0) {
    for (let i: i32 = 0; i < numOuts; ++i) {
      let oId = outIds[i];
      traj[i] = oId >= 0 ? env[oId] : 0.0;
    }
  }

  // Pre-calculate RK4 scratch pointers if RK4
  let y0 = changetype<UnmanagedFloat64Array>(rk4ScratchPtr);
  let k1 = changetype<UnmanagedFloat64Array>(rk4ScratchPtr + (numStates as usize) * 8);
  let k2 = changetype<UnmanagedFloat64Array>(rk4ScratchPtr + (2 * numStates as usize) * 8);
  let k3 = changetype<UnmanagedFloat64Array>(rk4ScratchPtr + (3 * numStates as usize) * 8);
  let k4 = changetype<UnmanagedFloat64Array>(rk4ScratchPtr + (4 * numStates as usize) * 8);
  let halfDt = 0.5 * dt;
  let dt6 = dt / 6.0;

  for (let s: i32 = 0; s < steps; ++s) {
    let t_s = startTime + (s as f64) * dt;

    if (solverKind == 0) {
      // ── Forward Euler ──
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        let dId = derivIds[i];
        if (sId >= 0 && dId >= 0) {
          env[sId] += dt * env[dId];
        }
      }

      let nextTime = startTime + ((s + 1) as f64) * dt;
      if (timeId >= 0) {
        env[timeId] = nextTime;
      }
      sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    } else {
      // ── Runge-Kutta 4 (RK4) ──
      // Stage 1: k1 = f(t_s, y0) (already evaluated at end of previous step)
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        let dId = derivIds[i];
        y0[i] = sId >= 0 ? env[sId] : 0.0;
        k1[i] = dId >= 0 ? env[dId] : 0.0;
      }

      // Stage 2: k2 = f(t_s + 0.5*dt, y0 + 0.5*dt*k1)
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        if (sId >= 0) {
          env[sId] = y0[i] + halfDt * k1[i];
        }
      }
      if (timeId >= 0) {
        env[timeId] = t_s + halfDt;
      }
      sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
      for (let i: i32 = 0; i < numStates; ++i) {
        let dId = derivIds[i];
        k2[i] = dId >= 0 ? env[dId] : 0.0;
      }

      // Stage 3: k3 = f(t_s + 0.5*dt, y0 + 0.5*dt*k2)
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        if (sId >= 0) {
          env[sId] = y0[i] + halfDt * k2[i];
        }
      }
      sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
      for (let i: i32 = 0; i < numStates; ++i) {
        let dId = derivIds[i];
        k3[i] = dId >= 0 ? env[dId] : 0.0;
      }

      // Stage 4: k4 = f(t_s + dt, y0 + dt*k3)
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        if (sId >= 0) {
          env[sId] = y0[i] + dt * k3[i];
        }
      }
      let nextTime = startTime + ((s + 1) as f64) * dt;
      if (timeId >= 0) {
        env[timeId] = nextTime;
      }
      sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
      for (let i: i32 = 0; i < numStates; ++i) {
        let dId = derivIds[i];
        k4[i] = dId >= 0 ? env[dId] : 0.0;
      }

      // Final update: y_{s+1} = y0 + (dt / 6.0) * (k1 + 2*k2 + 2*k3 + k4)
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        if (sId >= 0) {
          env[sId] = y0[i] + dt6 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
        }
      }
      sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    }

    // Record step s + 1
    if (trajOutPtr != 0 && numOuts > 0) {
      let rowOffset = (s + 1) * numOuts;
      for (let i: i32 = 0; i < numOuts; ++i) {
        let oId = outIds[i];
        traj[rowOffset + i] = oId >= 0 ? env[oId] : 0.0;
      }
    }
  }
}


