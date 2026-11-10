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
  rk4ScratchPtr: usize,
  atol: f64,
  rtol: f64
): void {
  if (atol <= 0.0) atol = 1e-7;
  if (rtol <= 0.0) rtol = 1e-7;
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

  if (solverKind == 2) {
    // ── Tsitouras 5(4) Adaptive Runge-Kutta (Tsit5) ──
    sim_runTsit5AdaptiveLoop(
      daePtr,
      bytecodePtr,
      bytecodeLen,
      litPtr,
      envPtr,
      stateIdsPtr,
      derivIdsPtr,
      numStates,
      outIdsPtr,
      numOuts,
      timeId,
      startTime,
      dt,
      steps,
      trajOutPtr,
      rk4ScratchPtr,
      atol,
      rtol
    );
    return;
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

/**
 * Adaptive Tsitouras 5(4) stepping kernel executing entirely inside linear memory.
 */
function sim_runTsit5AdaptiveLoop(
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
  trajOutPtr: usize,
  scratchPtr: usize,
  atolIn: f64,
  rtolIn: f64
): void {
  let atol: f64 = atolIn > 0.0 ? atolIn : 1e-7;
  let rtol: f64 = rtolIn > 0.0 ? rtolIn : 1e-7;

  let env = changetype<UnmanagedFloat64Array>(envPtr);
  let traj = changetype<UnmanagedFloat64Array>(trajOutPtr);
  let stateIds = changetype<UnmanagedInt32Array>(stateIdsPtr);
  let derivIds = changetype<UnmanagedInt32Array>(derivIdsPtr);
  let outIds = changetype<UnmanagedInt32Array>(outIdsPtr);

  if (numStates <= 0) {
    // Pure algebraic or discrete system: advance along output grid
    for (let s: i32 = 0; s < steps; ++s) {
      let nextTime = startTime + ((s + 1) as f64) * dt;
      if (timeId >= 0) env[timeId] = nextTime;
      sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
      if (trajOutPtr != 0 && numOuts > 0) {
        let rowOffset = (s + 1) * numOuts;
        for (let i: i32 = 0; i < numOuts; ++i) {
          let oId = outIds[i];
          traj[rowOffset + i] = oId >= 0 ? env[oId] : 0.0;
        }
      }
    }
    return;
  }

  let nU = numStates as usize;
  let y0 = changetype<UnmanagedFloat64Array>(scratchPtr);
  let yNew = changetype<UnmanagedFloat64Array>(scratchPtr + 2 * nU * 8);
  let k0 = changetype<UnmanagedFloat64Array>(scratchPtr + 3 * nU * 8);
  let k1 = changetype<UnmanagedFloat64Array>(scratchPtr + 4 * nU * 8);
  let k2 = changetype<UnmanagedFloat64Array>(scratchPtr + 5 * nU * 8);
  let k3 = changetype<UnmanagedFloat64Array>(scratchPtr + 6 * nU * 8);
  let k4 = changetype<UnmanagedFloat64Array>(scratchPtr + 7 * nU * 8);
  let k5 = changetype<UnmanagedFloat64Array>(scratchPtr + 8 * nU * 8);
  let k6 = changetype<UnmanagedFloat64Array>(scratchPtr + 9 * nU * 8);

  for (let i: i32 = 0; i < numStates; ++i) {
    let sId = stateIds[i];
    let dId = derivIds[i];
    y0[i] = sId >= 0 ? env[sId] : 0.0;
    k0[i] = dId >= 0 ? env[dId] : 0.0;
  }

  let t_sim: f64 = startTime;
  let h: f64 = dt > 0.0 ? dt : 1e-3;
  let minStep: f64 = 1e-14 * (1.0 + Math.abs(startTime));
  let totalStop: f64 = startTime + (steps as f64) * dt;
  let maxStep: f64 = Math.abs(totalStop - startTime);
  if (maxStep <= 0.0) maxStep = 1e6;
  let prevErrNorm: f64 = 1.0;
  let s: i32 = 0;
  let maxIters: i32 = steps * 1000 + 50000;
  let iterCount: i32 = 0;

  while (s < steps && iterCount < maxIters) {
    iterCount++;

    if (t_sim >= totalStop - 1e-14) {
      while (s < steps) {
        if (trajOutPtr != 0 && numOuts > 0) {
          let rowOffset = (s + 1) * numOuts;
          for (let i: i32 = 0; i < numOuts; ++i) {
            let oId = outIds[i];
            traj[rowOffset + i] = oId >= 0 ? env[oId] : 0.0;
          }
        }
        s++;
      }
      break;
    }

    if (t_sim + h > totalStop) {
      h = totalStop - t_sim;
    }
    if (h < minStep) {
      h = minStep;
    }

    // Stage 1 (c1 = 0.161)
    for (let i: i32 = 0; i < numStates; ++i) {
      let sId = stateIds[i];
      if (sId >= 0) env[sId] = y0[i] + h * (0.161 * k0[i]);
    }
    if (timeId >= 0) env[timeId] = t_sim + 0.161 * h;
    sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    for (let i: i32 = 0; i < numStates; ++i) {
      let dId = derivIds[i];
      k1[i] = dId >= 0 ? env[dId] : 0.0;
    }

    // Stage 2 (c2 = 0.327)
    for (let i: i32 = 0; i < numStates; ++i) {
      let sId = stateIds[i];
      if (sId >= 0) env[sId] = y0[i] + h * (-0.008480655492356989 * k0[i] + 0.335480655492357 * k1[i]);
    }
    if (timeId >= 0) env[timeId] = t_sim + 0.327 * h;
    sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    for (let i: i32 = 0; i < numStates; ++i) {
      let dId = derivIds[i];
      k2[i] = dId >= 0 ? env[dId] : 0.0;
    }

    // Stage 3 (c3 = 0.9)
    for (let i: i32 = 0; i < numStates; ++i) {
      let sId = stateIds[i];
      if (sId >= 0) env[sId] = y0[i] + h * (2.8971530571054935 * k0[i] - 6.359448489975075 * k1[i] + 4.3622954328695815 * k2[i]);
    }
    if (timeId >= 0) env[timeId] = t_sim + 0.9 * h;
    sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    for (let i: i32 = 0; i < numStates; ++i) {
      let dId = derivIds[i];
      k3[i] = dId >= 0 ? env[dId] : 0.0;
    }

    // Stage 4 (c4 = 0.9800255409045097)
    for (let i: i32 = 0; i < numStates; ++i) {
      let sId = stateIds[i];
      if (sId >= 0) env[sId] = y0[i] + h * (5.325864828439257 * k0[i] - 11.748883564062828 * k1[i] + 7.495539342889836 * k2[i] - 0.09249506636175525 * k3[i]);
    }
    if (timeId >= 0) env[timeId] = t_sim + 0.9800255409045097 * h;
    sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    for (let i: i32 = 0; i < numStates; ++i) {
      let dId = derivIds[i];
      k4[i] = dId >= 0 ? env[dId] : 0.0;
    }

    // Stage 5 (c5 = 1.0)
    for (let i: i32 = 0; i < numStates; ++i) {
      let sId = stateIds[i];
      if (sId >= 0) env[sId] = y0[i] + h * (5.86145544294642 * k0[i] - 12.92096931784711 * k1[i] + 8.159367898576159 * k2[i] - 0.071584973281401 * k3[i] - 0.028269050394068383 * k4[i]);
    }
    if (timeId >= 0) env[timeId] = t_sim + 1.0 * h;
    sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    for (let i: i32 = 0; i < numStates; ++i) {
      let dId = derivIds[i];
      k5[i] = dId >= 0 ? env[dId] : 0.0;
    }

    // Candidate new state yNew (5th-order solution)
    for (let i: i32 = 0; i < numStates; ++i) {
      yNew[i] = y0[i] + h * (
        0.09646076681806523 * k0[i] +
        0.01 * k1[i] +
        0.4798896504144996 * k2[i] +
        1.379008574103742 * k3[i] -
        3.290069515436081 * k4[i] +
        2.324710524099774 * k5[i]
      );
      let sId = stateIds[i];
      if (sId >= 0) env[sId] = yNew[i];
    }
    if (timeId >= 0) env[timeId] = t_sim + h;
    sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
    for (let i: i32 = 0; i < numStates; ++i) {
      let dId = derivIds[i];
      k6[i] = dId >= 0 ? env[dId] : 0.0;
    }

    // Compute normalized embedded error norm
    let errSqSum: f64 = 0.0;
    for (let i: i32 = 0; i < numStates; ++i) {
      let err_i = h * (
        (0.09646076681806523 - 0.09468075576583947) * k0[i] +
        (0.01 - 0.009183565540343252) * k1[i] +
        (0.4798896504144996 - 0.4877705284247616) * k2[i] +
        (1.379008574103742 - 1.234297566930479) * k3[i] +
        (-3.290069515436081 - -2.7077123499835256) * k4[i] +
        (2.324710524099774 - 1.866628418170587) * k5[i] +
        (-1.0 / 66.0) * k6[i]
      );
      let sc_i = atol + rtol * Math.max(Math.abs(y0[i]), Math.abs(yNew[i]));
      let ratio = Math.abs(err_i) / sc_i;
      errSqSum += ratio * ratio;
    }
    let errNorm = Math.sqrt(errSqSum / (numStates as f64));

    if (errNorm <= 1.0) {
      let t_next = t_sim + h;

      // Continuous Hermite dense output for all communication points falling in (t_sim, t_next]
      while (s < steps) {
        let t_out = startTime + ((s + 1) as f64) * dt;
        if (t_out > t_next + 1e-14) {
          break;
        }
        let theta: f64 = h > 1e-15 ? (t_out - t_sim) / h : 1.0;
        if (theta < 0.0) theta = 0.0;
        if (theta > 1.0) theta = 1.0;

        let theta2 = theta * theta;
        let theta3 = theta2 * theta;
        let h00 = 2.0 * theta3 - 3.0 * theta2 + 1.0;
        let h10 = theta3 - 2.0 * theta2 + theta;
        let h01 = -2.0 * theta3 + 3.0 * theta2;
        let h11 = theta3 - theta2;

        for (let i: i32 = 0; i < numStates; ++i) {
          let sId = stateIds[i];
          if (sId >= 0) {
            env[sId] = h00 * y0[i] + h10 * h * k0[i] + h01 * yNew[i] + h11 * h * k6[i];
          }
        }
        if (timeId >= 0) {
          env[timeId] = t_out;
        }
        sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);

        if (trajOutPtr != 0 && numOuts > 0) {
          let rowOffset = (s + 1) * numOuts;
          for (let i: i32 = 0; i < numOuts; ++i) {
            let oId = outIds[i];
            traj[rowOffset + i] = oId >= 0 ? env[oId] : 0.0;
          }
        }
        s++;
      }

      // Advance state
      t_sim = t_next;
      for (let i: i32 = 0; i < numStates; ++i) {
        y0[i] = yNew[i];
        k0[i] = k6[i]; // FSAL reuse
        let sId = stateIds[i];
        if (sId >= 0) env[sId] = yNew[i];
      }
      if (timeId >= 0) {
        env[timeId] = t_sim;
      }

      // Gustafsson Predictive PI Step Size Controller:
      let safeErr = Math.max(errNorm, 1e-4);
      let factor: f64 = 0.9 * Math.pow(safeErr, -0.14) * Math.pow(prevErrNorm, 0.08);
      if (factor > 4.0) factor = 4.0;
      if (factor < 0.2) factor = 0.2;
      h = Math.min(maxStep, Math.max(minStep, h * factor));
      prevErrNorm = safeErr;
    } else {
      // Step rejected
      let safeErr = Math.max(errNorm, 1e-4);
      let factor: f64 = 0.9 * Math.pow(safeErr, -0.25);
      if (factor > 0.5) factor = 0.5;
      if (factor < 0.1) factor = 0.1;
      h = Math.max(minStep, h * factor);

      // Restore env to y0
      for (let i: i32 = 0; i < numStates; ++i) {
        let sId = stateIds[i];
        if (sId >= 0) env[sId] = y0[i];
      }
      if (timeId >= 0) {
        env[timeId] = t_sim;
      }
    }
  }

  // Final evaluation to ensure all algebraic and auxiliary variables match t_sim
  sim_evalFlatBytecode(daePtr, bytecodePtr, bytecodeLen, litPtr, envPtr, true);
}


