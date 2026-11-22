// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript execution runtime for `@modelscript/magicdraw-std-lib`.
 *
 * Implements standardized OMG SysML 1.6 / QUDV / SI / Cameo Simulation Toolkit kernels
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — schema parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — persistent evaluation state
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — auxiliary / residual / margin buffer
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — input/output bus:
 *       Inputs:
 *         IO[0] = x / lhs / actualValue / child0
 *         IO[1] = rhs / requiredLimit / child1
 *         IO[2..7] = child2..child7
 *       Outputs:
 *         IO[8]  = primary numeric result (convertedValue / rollupTotal / residual / margin / mean)
 *         IO[9]  = passFlag (1.0 = pass/valid, 0.0 = fail/violated)
 *         IO[10] = secondary metric (siCanonicalValue / budgetMargin / absResidual / marginPct / sum)
 *         IO[11] = tertiary metric (rollupTotalWithMargin / normalizedResidual / actual / sampleCount)
 *         IO[12] = evalCount
 *         IO[13] = minObserved
 *         IO[14] = maxObserved
 *         IO[15] = statusCode (1.0 = pass, -1.0 = fail, 0.0 = neutral)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `MagicDrawArchetypeId` in magicdraw-std-schemas.ts)
const ARCH_SI_UNIT_CONVERSION: i32 = 1;
const ARCH_ROLLUP_AGGREGATION: i32 = 2;
const ARCH_CONSTRAINT_EVALUATOR: i32 = 3;
const ARCH_REQUIREMENT_VERIFICATION: i32 = 4;
const ARCH_PORT_INTERFACE_PASS: i32 = 5;
const ARCH_SIMULATION_CONFIG: i32 = 6;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  const v = load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
  return isNaN(v) ? 0.0 : v;
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

@inline
function updateStats(slotPtr: usize, primaryVal: f64): void {
  const count = getState(slotPtr, 4) + 1.0;
  setState(slotPtr, 4, count);
  let minVal = getState(slotPtr, 5);
  let maxVal = getState(slotPtr, 6);
  if (count <= 1.0 || primaryVal < minVal) minVal = primaryVal;
  if (count <= 1.0 || primaryVal > maxVal) maxVal = primaryVal;
  setState(slotPtr, 5, minVal);
  setState(slotPtr, 6, maxVal);
  setIo(slotPtr, 12, count);
  setIo(slotPtr, 13, minVal);
  setIo(slotPtr, 14, maxVal);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function mdGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes a MagicDraw / Cameo model slot state vector.
 * Returns the number of active state slots for the archetype.
 */
export function mdModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 12; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, 1.0);
  setIo(slotPtr, 10, 0.0);
  setIo(slotPtr, 11, 0.0);
  setIo(slotPtr, 12, 0.0);
  setIo(slotPtr, 13, 0.0);
  setIo(slotPtr, 14, 0.0);
  setIo(slotPtr, 15, 0.0);

  if (archetypeId == ARCH_SI_UNIT_CONVERSION) return 2;
  if (archetypeId == ARCH_ROLLUP_AGGREGATION) return 3;
  if (archetypeId == ARCH_CONSTRAINT_EVALUATOR) return 2;
  if (archetypeId == ARCH_REQUIREMENT_VERIFICATION) return 2;
  if (archetypeId == ARCH_PORT_INTERFACE_PASS) return 1;
  if (archetypeId == ARCH_SIMULATION_CONFIG) {
    // STATE[0]=welfordMean, STATE[1]=sampleCount, STATE[2]=lastTime, STATE[3]=welfordM2,
    // STATE[7]=activeStateId, STATE[8]=transitionCount, STATE[9]=activityStepCount, STATE[10]=sum
    const initialState = getCon(slotPtr, conCount, 5, 0.0);
    setState(slotPtr, 7, initialState);
    return 7;
  }
  return 0;
}

@inline
function evalGuardOp(guardOp: i32, val: f64, threshold: f64): bool {
  if (guardOp == 0) return true;
  if (guardOp == 1) return val > threshold;
  if (guardOp == 2) return val >= threshold;
  if (guardOp == 3) return val < threshold;
  if (guardOp == 4) return val <= threshold;
  if (guardOp == 5) return Math.abs(val - threshold) <= 1e-9;
  if (guardOp == 6) return Math.abs(val - threshold) > 1e-9;
  return false;
}

/**
 * Evaluates a MagicDraw / Cameo standard library archetype kernel on the given 2048-byte slot.
 * Returns the primary numeric evaluation result (also written to `IO[8]`).
 */
export function mdModelEval(
  archetypeId: i32,
  t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): f64 {
  if (archetypeId == ARCH_SI_UNIT_CONVERSION) {
    // SI / QUDV dimensional unit conversion & scaling: y = a * x + b
    const factor = getCon(slotPtr, conCount, 0, 1.0);
    const offset = getCon(slotPtr, conCount, 1, 0.0);
    const x = getIo(slotPtr, 0);
    const y = factor * x + offset;

    setState(slotPtr, 0, y);
    setState(slotPtr, 1, x);
    setDState(slotPtr, 0, factor);
    setIo(slotPtr, 8, y);
    setIo(slotPtr, 9, 1.0);
    setIo(slotPtr, 10, y);
    setIo(slotPtr, 11, y);
    setIo(slotPtr, 15, 1.0);
    updateStats(slotPtr, y);
    return y;
  }

  if (archetypeId == ARCH_ROLLUP_AGGREGATION) {
    // Mass / Power / Cost hierarchical rollup aggregation with contingency margin
    const ownValue = getCon(slotPtr, conCount, 0, 0.0);
    const marginPct = getCon(slotPtr, conCount, 1, 0.0);
    const multiplier = getCon(slotPtr, conCount, 2, 1.0);
    const budgetLimit = getCon(slotPtr, conCount, 3, 0.0);

    let childSum: f64 = 0.0;
    for (let i = 0; i < 8; i++) {
      childSum += getIo(slotPtr, i);
    }

    const rawTotal = (ownValue + childSum) * multiplier;
    const totalWithMargin = rawTotal * (1.0 + marginPct / 100.0);
    const hasBudget = budgetLimit > 0.0;
    const budgetMargin = hasBudget ? budgetLimit - totalWithMargin : 0.0;
    const pass: f64 = !hasBudget || totalWithMargin <= budgetLimit ? 1.0 : 0.0;

    setState(slotPtr, 0, rawTotal);
    setState(slotPtr, 1, totalWithMargin);
    setState(slotPtr, 2, childSum);
    setDState(slotPtr, 0, budgetMargin);
    setIo(slotPtr, 8, rawTotal);
    setIo(slotPtr, 9, pass);
    setIo(slotPtr, 10, budgetMargin);
    setIo(slotPtr, 11, totalWithMargin);
    setIo(slotPtr, 15, pass >= 0.5 ? 1.0 : -1.0);
    updateStats(slotPtr, rawTotal);
    return rawTotal;
  }

  if (archetypeId == ARCH_CONSTRAINT_EVALUATOR) {
    // Parametric constraint residual evaluation: |lhs - rhs| <= tol
    const tol = Math.max(0.0, getCon(slotPtr, conCount, 0, 1e-6));
    const mode = getCon(slotPtr, conCount, 1, 0.0);
    const scale = getCon(slotPtr, conCount, 2, 1.0);

    const lhs = getIo(slotPtr, 0);
    const rhs = getIo(slotPtr, 1);
    const residual = lhs - rhs;
    const absResidual = Math.abs(residual);

    let pass: f64 = 0.0;
    if (mode >= 0.5 && mode < 1.5) {
      // Inequality: lhs <= rhs + tol
      pass = lhs <= rhs + tol ? 1.0 : 0.0;
    } else if (mode >= 1.5) {
      // Inequality: lhs >= rhs - tol
      pass = lhs >= rhs - tol ? 1.0 : 0.0;
    } else {
      // Equality: |lhs - rhs| <= tol
      pass = absResidual <= tol ? 1.0 : 0.0;
    }

    const normRes = scale > 1e-12 ? absResidual / scale : absResidual;
    setState(slotPtr, 0, residual);
    setState(slotPtr, 1, absResidual);
    setDState(slotPtr, 0, residual);
    setIo(slotPtr, 8, residual);
    setIo(slotPtr, 9, pass);
    setIo(slotPtr, 10, absResidual);
    setIo(slotPtr, 11, normRes);
    setIo(slotPtr, 15, pass >= 0.5 ? 1.0 : -1.0);
    updateStats(slotPtr, absResidual);
    return absResidual;
  }

  if (archetypeId == ARCH_REQUIREMENT_VERIFICATION) {
    // Cameo requirement verification margin pass/fail
    const targetLimit = getCon(slotPtr, conCount, 0, 100.0);
    const comparisonOp = getCon(slotPtr, conCount, 1, 0.0);
    const tol = Math.max(0.0, getCon(slotPtr, conCount, 2, 1e-6));
    const minMarginPct = getCon(slotPtr, conCount, 3, 0.0);

    const actual = getIo(slotPtr, 0);
    const ioLimit = getIo(slotPtr, 1);
    const limit = ioLimit != 0.0 ? ioLimit : targetLimit;

    let margin: f64 = 0.0;
    let pass: f64 = 0.0;
    if (comparisonOp >= 0.5 && comparisonOp < 1.5) {
      // Lower bound: actual >= limit
      margin = actual - limit;
      pass = actual >= limit - tol ? 1.0 : 0.0;
    } else if (comparisonOp >= 1.5) {
      // Equality: |actual - limit| <= tol
      margin = tol - Math.abs(actual - limit);
      pass = Math.abs(actual - limit) <= tol ? 1.0 : 0.0;
    } else {
      // Upper bound: actual <= limit
      margin = limit - actual;
      pass = actual <= limit + tol ? 1.0 : 0.0;
    }

    const denom = Math.abs(limit);
    const marginPct = denom > 1e-12 ? (margin / denom) * 100.0 : 0.0;
    if (minMarginPct > 0.0 && marginPct < minMarginPct) {
      pass = 0.0;
    }

    setState(slotPtr, 0, margin);
    setState(slotPtr, 1, marginPct);
    setDState(slotPtr, 0, margin);
    setIo(slotPtr, 8, margin);
    setIo(slotPtr, 9, pass);
    setIo(slotPtr, 10, marginPct);
    setIo(slotPtr, 11, actual);
    setIo(slotPtr, 15, pass >= 0.5 ? 1.0 : -1.0);
    updateStats(slotPtr, margin);
    return margin;
  }

  if (archetypeId == ARCH_PORT_INTERFACE_PASS) {
    // Port / InterfaceBlock pass-through with optional conjugation
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const conjugated = getCon(slotPtr, conCount, 1, 0.0);
    const sign: f64 = conjugated >= 0.5 ? -1.0 : 1.0;
    const y = sign * gain * getIo(slotPtr, 0);

    setState(slotPtr, 0, y);
    setIo(slotPtr, 8, y);
    setIo(slotPtr, 9, 1.0);
    setIo(slotPtr, 10, Math.abs(y));
    setIo(slotPtr, 11, y);
    setIo(slotPtr, 15, 1.0);
    updateStats(slotPtr, y);
    return y;
  }

  if (archetypeId == ARCH_SIMULATION_CONFIG) {
    // SimulationConfig / TimeSeriesChart / MonteCarloConfig:
    //   - Welford online mean & sample variance/stddev accumulator (always updated on IO[0])
    //   - Optional SysML StateMachine & Activity RTC execution step when CON[4] >= 0.5:
    //       CON[5] = initialState, CON[6] = nTransitions (up to 24),
    //       CON[7 + 5*i + 0..4] = [fromState, triggerEvent (<0 wildcard), guardOp, guardThreshold, toState]
    //       IO[0] = guardValue (x), IO[1] = triggerEventId (rhs)
    const startTime = getCon(slotPtr, conCount, 0, 0.0);
    const stopTime = getCon(slotPtr, conCount, 1, 10.0);
    const execMode = getCon(slotPtr, conCount, 4, 0.0);
    const x = getIo(slotPtr, 0);
    const eventId = getIo(slotPtr, 1);

    const prevMean = getState(slotPtr, 0);
    const prevCount = getState(slotPtr, 1);
    const prevM2 = getState(slotPtr, 3);
    const prevSum = getState(slotPtr, 10);

    // Welford (1962) numerically stable online mean & variance recurrence
    const nextCount = prevCount + 1.0;
    const delta = x - prevMean;
    const nextMean = prevMean + delta / nextCount;
    const delta2 = x - nextMean;
    const nextM2 = prevM2 + delta * delta2;
    const variance = nextCount > 1.0 ? nextM2 / (nextCount - 1.0) : 0.0;
    const stdDev = Math.sqrt(Math.max(0.0, variance));
    const nextSum = prevSum + x;
    const inWindow: f64 = t >= startTime && t <= stopTime ? 1.0 : 0.0;

    setState(slotPtr, 0, nextMean);
    setState(slotPtr, 1, nextCount);
    setState(slotPtr, 2, t);
    setState(slotPtr, 3, nextM2);
    setState(slotPtr, 10, nextSum);
    setDState(slotPtr, 0, variance);
    setDState(slotPtr, 1, stdDev);

    if (execMode >= 0.5) {
      // SysML StateMachine (Run-To-Completion) & Activity execution step
      let currentState = getState(slotPtr, 7);
      let transitionCount = getState(slotPtr, 8);
      let activitySteps = getState(slotPtr, 9);
      let fired: f64 = 0.0;

      if (inWindow >= 0.5) {
        const nTransRaw = <i32>Math.floor(getCon(slotPtr, conCount, 6, 0.0));
        const maxTrans = (conCount - 7) / 5;
        const nTrans = nTransRaw < 0 ? 0 : nTransRaw > maxTrans ? maxTrans : nTransRaw > 24 ? 24 : nTransRaw;

        for (let i: i32 = 0; i < nTrans; i++) {
          const base = 7 + i * 5;
          const fromState = getCon(slotPtr, conCount, base + 0, -1.0);
          const triggerEv = getCon(slotPtr, conCount, base + 1, -1.0);
          const guardOp = <i32>Math.floor(getCon(slotPtr, conCount, base + 2, 0.0));
          const guardThresh = getCon(slotPtr, conCount, base + 3, 0.0);
          const toState = getCon(slotPtr, conCount, base + 4, currentState);

          if (Math.abs(fromState - currentState) < 0.5) {
            const eventMatch = triggerEv < 0.0 || Math.abs(triggerEv - eventId) < 0.5;
            if (eventMatch && evalGuardOp(guardOp, x, guardThresh)) {
              currentState = toState;
              transitionCount += 1.0;
              fired = 1.0;
              break;
            }
          }
        }
        // Activity token execution step (doActivity / action invocation)
        activitySteps += 1.0;
        setState(slotPtr, 7, currentState);
        setState(slotPtr, 8, transitionCount);
        setState(slotPtr, 9, activitySteps);
      }

      setDState(slotPtr, 2, fired);
      setIo(slotPtr, 8, currentState);
      setIo(slotPtr, 9, inWindow);
      setIo(slotPtr, 10, transitionCount);
      setIo(slotPtr, 11, activitySteps);
      setIo(slotPtr, 15, fired);
      updateStats(slotPtr, currentState);
      return currentState;
    }

    // Monte Carlo / TimeSeries Welford online statistics mode
    setIo(slotPtr, 8, nextMean);
    setIo(slotPtr, 9, inWindow);
    setIo(slotPtr, 10, stdDev);
    setIo(slotPtr, 11, variance);
    setIo(slotPtr, 15, inWindow >= 0.5 ? 1.0 : 0.0);
    updateStats(slotPtr, x);
    return nextMean;
  }

  return 0.0;
}

/**
 * Batched zero-copy evaluation across `count` model descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function mdBatchEval(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    mdModelEval(archetypeId, t, dt, slotPtr, conCount);
  }
}
