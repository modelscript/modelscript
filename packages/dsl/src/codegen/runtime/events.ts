import { ChunkedInt32Array, ChunkedUint8Array, createChunkedInt32Array, createChunkedUint8Array } from "./array";
import { DaeBuilder } from "./dae";
import { evalExpr } from "./eval";
import { atomicChunkAlloc } from "./arena";

/**
 * Hybrid DAE Event Detector & Zero-Crossing Manager.
 * Manages zero-crossing functions (ZCF), direction-aware event localization,
 * and Zeno chattering limit protection.
 */
@unmanaged
export class EventDetector {
  daePtr: usize;
  zcfExprIdsPtr: usize;
  zcfSignsPtr: usize;
  zcfDirectionsPtr: usize;
  zcfCount: u32;

  consecutiveEvents: u32;
  lastEventTime: f64;
  zenoLimitReached: u8;

  @inline getDae(): DaeBuilder { return changetype<DaeBuilder>(load<usize>(changetype<usize>(this) + offsetof<EventDetector>("daePtr"))); }
  @inline getZcfExprIds(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<EventDetector>("zcfExprIdsPtr"))); }
  @inline getZcfSigns(): ChunkedUint8Array { return changetype<ChunkedUint8Array>(load<usize>(changetype<usize>(this) + offsetof<EventDetector>("zcfSignsPtr"))); }
  @inline getZcfDirections(): ChunkedInt32Array { return changetype<ChunkedInt32Array>(load<usize>(changetype<usize>(this) + offsetof<EventDetector>("zcfDirectionsPtr"))); }

  init(dae: DaeBuilder): void {
    this.daePtr = changetype<usize>(dae);
    this.zcfExprIdsPtr = changetype<usize>(createChunkedInt32Array(128));
    this.zcfSignsPtr = changetype<usize>(createChunkedUint8Array(128));
    this.zcfDirectionsPtr = changetype<usize>(createChunkedInt32Array(128));
    this.zcfCount = 0;
    this.consecutiveEvents = 0;
    this.lastEventTime = -1e18;
    this.zenoLimitReached = 0;
  }

  /**
   * Registers a zero-crossing function expression into the event detector.
   * targetDirection: 0 = any direction, 1 = rising (neg->pos), -1 = falling (pos->neg)
   */
  @inline
  addZeroCrossingFunction(zcfExprId: u32, initialValue: f64 = 0.0, targetDirection: i32 = 0): u32 {
    let idx = this.zcfCount++;
    this.getZcfExprIds().push(zcfExprId as i32);
    this.getZcfSigns().push(initialValue >= 0.0 ? 1 : 0);
    this.getZcfDirections().push(targetDirection);
    return idx;
  }

  /**
   * Checks if any registered zero-crossing functions experienced a sign change matching their specified direction.
   * Returns index of the first triggered zero-crossing function, or -1 if no event occurred.
   */
  @inline
  checkZeroCrossings(varValuesPtr: u32): i32 {
    let dae = this.getDae();
    let zcfExprIds = this.getZcfExprIds();
    let zcfSigns = this.getZcfSigns();
    let zcfDirections = this.getZcfDirections();

    for (let i: u32 = 0; i < this.zcfCount; i++) {
      let exprId = zcfExprIds.get(i) as u32;
      let val = evalExpr(exprId, dae, varValuesPtr);
      let currSign: u8 = val >= 0.0 ? 1 : 0;
      let prevSign: u8 = zcfSigns.get(i);

      if (currSign != prevSign) {
        let reqDir = zcfDirections.get(i);
        let isRising = (prevSign == 0 && currSign == 1);
        let isFalling = (prevSign == 1 && currSign == 0);

        if (reqDir == 0 || (reqDir == 1 && isRising) || (reqDir == -1 && isFalling)) {
          return i as i32;
        }
      }
    }
    return -1;
  }

  /**
   * Updates previous sign state of all zero-crossing functions.
   */
  @inline
  updateZcfSigns(varValuesPtr: u32): void {
    let dae = this.getDae();
    let zcfExprIds = this.getZcfExprIds();
    let zcfSigns = this.getZcfSigns();

    for (let i: u32 = 0; i < this.zcfCount; i++) {
      let exprId = zcfExprIds.get(i) as u32;
      let val = evalExpr(exprId, dae, varValuesPtr);
      zcfSigns.set(i, val >= 0.0 ? 1 : 0);
    }
  }

  /**
   * Checks whether rapid consecutive events violate the Zeno frequency limit.
   */
  @inline
  checkZenoLimit(tEvent: f64, maxConsecutive: u32 = 10, windowTol: f64 = 1e-6): bool {
    let dt = Math.abs(tEvent - this.lastEventTime);
    if (dt < windowTol) {
      this.consecutiveEvents++;
    } else {
      this.consecutiveEvents = 1;
    }
    this.lastEventTime = tEvent;

    if (this.consecutiveEvents >= maxConsecutive) {
      this.zenoLimitReached = 1;
      return true;
    }
    return false;
  }

  /**
   * Superlinear Zero-Crossing Event Localization using Brent-Dekker Hybrid Root Finding.
   * Combines bisection, secant method, and inverse quadratic interpolation for rapid convergence.
   */
  @inline
  localizeEventBrent(
    zcfIndex: u32,
    varValuesStartPtr: u32,
    varValuesEndPtr: u32,
    interpolatedValuesPtr: u32,
    t0: f64,
    t1: f64,
    tol: f64 = 1e-10
  ): f64 {
    let exprId = this.getZcfExprIds().get(zcfIndex) as u32;
    let dae = this.getDae();
    let numVars = dae.varCount;

    let a = t0;
    let b = t1;
    let fa = evalExpr(exprId, dae, varValuesStartPtr);
    let fb = evalExpr(exprId, dae, varValuesEndPtr);

    if (fa * fb > 0.0) {
      // Not strictly bracketed; fallback to bisection
      return this.bisectEventTime(zcfIndex, varValuesStartPtr, varValuesEndPtr, interpolatedValuesPtr, t0, t1, tol);
    }

    if (Math.abs(fa) < Math.abs(fb)) {
      let tmpT = a; a = b; b = tmpT;
      let tmpF = fa; fa = fb; fb = tmpF;
    }

    let c = a;
    let fc = fa;
    let mflag = true;
    let d = 0.0;
    let maxIter: u32 = 50;
    let iter: u32 = 0;

    while (iter < maxIter && Math.abs(fb) > 1e-12 && Math.abs(b - a) > tol) {
      iter++;
      let s: f64;

      if (fa != fc && fb != fc) {
        // Inverse Quadratic Interpolation
        s = (a * fb * fc) / ((fa - fb) * (fa - fc)) +
            (b * fa * fc) / ((fb - fa) * (fb - fc)) +
            (c * fa * fb) / ((fc - fa) * (fc - fb));
      } else {
        // Secant Method
        s = b - fb * (b - a) / (fb - fa);
      }

      let bound1 = (3.0 * a + b) * 0.25;
      let bound2 = b;
      let minB = bound1 < bound2 ? bound1 : bound2;
      let maxB = bound1 > bound2 ? bound1 : bound2;

      let cond1 = (s < minB || s > maxB);
      let cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) * 0.5;
      let cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) * 0.5;
      let cond4 = mflag && Math.abs(b - c) < tol;
      let cond5 = !mflag && Math.abs(c - d) < tol;

      if (cond1 || cond2 || cond3 || cond4 || cond5) {
        s = (a + b) * 0.5;
        mflag = true;
      } else {
        mflag = false;
      }

      // Interpolate state at s
      let alpha = (t1 - t0) > 1e-14 ? (s - t0) / (t1 - t0) : 0.5;
      for (let v: u32 = 0; v < numVars; v++) {
        let vStart = load<f64>(varValuesStartPtr + v * 8);
        let vEnd = load<f64>(varValuesEndPtr + v * 8);
        store<f64>(interpolatedValuesPtr + v * 8, vStart + alpha * (vEnd - vStart));
      }

      let fs = evalExpr(exprId, dae, interpolatedValuesPtr);
      d = c;
      c = b;
      fc = fb;

      if (fb * fs < 0.0) {
        a = b;
        fa = fb;
        b = s;
        fb = fs;
      } else {
        b = s;
        fb = fs;
      }

      if (Math.abs(fa) < Math.abs(fb)) {
        let tmpT = a; a = b; b = tmpT;
        let tmpF = fa; fa = fb; fb = tmpF;
      }
    }

    return b;
  }

  /**
   * Pinpoints exact event timestamp t* in interval [t0, t1] using Bisection Root-Finding.
   */
  @inline
  bisectEventTime(
    zcfIndex: u32,
    varValuesStartPtr: u32,
    varValuesEndPtr: u32,
    interpolatedValuesPtr: u32,
    t0: f64,
    t1: f64,
    tol: f64 = 1e-8
  ): f64 {
    let exprId = this.getZcfExprIds().get(zcfIndex) as u32;
    let dae = this.getDae();
    let tLeft = t0;
    let tRight = t1;
    let numVars = dae.varCount;

    let fLeft = evalExpr(exprId, dae, varValuesStartPtr);
    let maxIter: u32 = 40;
    let iter: u32 = 0;

    while (iter < maxIter && (tRight - tLeft) > tol) {
      iter++;
      let tMid = (tLeft + tRight) * 0.5;
      let alpha = (t1 - t0) > 1e-14 ? (tMid - t0) / (t1 - t0) : 0.5;

      // Linear interpolation of state vector at tMid
      for (let v: u32 = 0; v < numVars; v++) {
        let vStart = load<f64>(varValuesStartPtr + v * 8);
        let vEnd = load<f64>(varValuesEndPtr + v * 8);
        let vInterp = vStart + alpha * (vEnd - vStart);
        store<f64>(interpolatedValuesPtr + v * 8, vInterp);
      }

      let fMid = evalExpr(exprId, dae, interpolatedValuesPtr);

      if ((fLeft >= 0.0 && fMid < 0.0) || (fLeft < 0.0 && fMid >= 0.0)) {
        tRight = tMid;
      } else {
        tLeft = tMid;
        fLeft = fMid;
      }
    }

    return (tLeft + tRight) * 0.5;
  }
}

/**
 * Creates and initializes an EventDetector in WASM linear memory.
 */
export function event_createDetector(daePtr: u32): u32 {
  let ptr = atomicChunkAlloc(sizeof<EventDetector>());
  let detector = changetype<EventDetector>(ptr);
  detector.init(changetype<DaeBuilder>(daePtr));
  return ptr as u32;
}

/**
 * Registers a zero-crossing function on an EventDetector pointer.
 */
export function event_addZcf(detectorPtr: u32, zcfExprId: u32, initialValue: f64, targetDirection: i32): u32 {
  let detector = changetype<EventDetector>(detectorPtr);
  return detector.addZeroCrossingFunction(zcfExprId, initialValue, targetDirection);
}

/**
 * Checks zero-crossing functions for direction-aware events.
 */
export function event_checkZeroCrossings(detectorPtr: u32, varValuesPtr: u32): i32 {
  let detector = changetype<EventDetector>(detectorPtr);
  return detector.checkZeroCrossings(varValuesPtr);
}

/**
 * Superlinear Brent-Dekker event time localization.
 */
export function event_localizeBrent(
  detectorPtr: u32,
  zcfIndex: u32,
  varValuesStartPtr: u32,
  varValuesEndPtr: u32,
  interpolatedValuesPtr: u32,
  t0: f64,
  t1: f64,
  tol: f64
): f64 {
  let detector = changetype<EventDetector>(detectorPtr);
  return detector.localizeEventBrent(zcfIndex, varValuesStartPtr, varValuesEndPtr, interpolatedValuesPtr, t0, t1, tol);
}

/**
 * Checks Zeno limit protection on an EventDetector pointer.
 */
export function event_checkZenoLimit(detectorPtr: u32, tEvent: f64, maxConsecutive: u32, windowTol: f64): bool {
  let detector = changetype<EventDetector>(detectorPtr);
  return detector.checkZenoLimit(tEvent, maxConsecutive, windowTol);
}

/**
 * Updates ZCF signs on an EventDetector pointer.
 */
export function event_updateZcfSigns(detectorPtr: u32, varValuesPtr: u32): void {
  let detector = changetype<EventDetector>(detectorPtr);
  detector.updateZcfSigns(varValuesPtr);
}
