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
  dae: DaeBuilder;
  zcfExprIds: ChunkedInt32Array;
  zcfSigns: ChunkedUint8Array;
  zcfDirections: ChunkedInt32Array;
  zcfCount: u32;

  consecutiveEvents: u32;
  lastEventTime: f64;
  zenoLimitReached: u8;

  init(dae: DaeBuilder): void {
    this.dae = dae;
    this.zcfExprIds = createChunkedInt32Array(128);
    this.zcfSigns = createChunkedUint8Array(128);
    this.zcfDirections = createChunkedInt32Array(128);
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
    this.zcfExprIds.push(zcfExprId as i32);
    this.zcfSigns.push(initialValue >= 0.0 ? 1 : 0);
    this.zcfDirections.push(targetDirection);
    return idx;
  }

  /**
   * Checks if any registered zero-crossing functions experienced a sign change matching their specified direction.
   * Returns index of the first triggered zero-crossing function, or -1 if no event occurred.
   */
  @inline
  checkZeroCrossings(varValuesPtr: u32): i32 {
    for (let i: u32 = 0; i < this.zcfCount; i++) {
      let exprId = this.zcfExprIds.get(i) as u32;
      let val = evalExpr(exprId, this.dae, varValuesPtr);
      let currSign: u8 = val >= 0.0 ? 1 : 0;
      let prevSign: u8 = this.zcfSigns.get(i);

      if (currSign != prevSign) {
        let reqDir = this.zcfDirections.get(i);
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
   * Updates all ZCF sign records to match current state variable values.
   */
  @inline
  updateZcfSigns(varValuesPtr: u32): void {
    for (let i: u32 = 0; i < this.zcfCount; i++) {
      let exprId = this.zcfExprIds.get(i) as u32;
      let val = evalExpr(exprId, this.dae, varValuesPtr);
      this.zcfSigns.set(i, val >= 0.0 ? 1 : 0);
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
    let exprId = this.zcfExprIds.get(zcfIndex) as u32;
    let tLeft = t0;
    let tRight = t1;
    let numVars = this.dae.varCount;

    let fLeft = evalExpr(exprId, this.dae, varValuesStartPtr);
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

      let fMid = evalExpr(exprId, this.dae, interpolatedValuesPtr);

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
