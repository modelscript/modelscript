import { atomicChunkAlloc } from "../arena";
import { UnmanagedFloat64Array } from "../core/array";

/**
 * Circular Ring Buffer for Modelica delay(expr, delayTime) and spatialDistribution operators.
 * Manages zero-GC fixed-capacity time series in WASM linear memory.
 */
@unmanaged
export class DelayRingBuffer {
  capacity: u32;
  head: u32; // Index of newest sample
  count: u32; // Current number of stored samples

  // Pointers to contiguous arrays:
  // - timePtr: f64[capacity]
  // - valuePtr: f64[capacity]
  // - derivPtr: f64[capacity]
  timePtr: usize;
  valuePtr: usize;
  derivPtr: usize;

  init(capacity: u32): void {
    this.capacity = capacity > 16 ? capacity : 16;
    this.head = 0;
    this.count = 0;

    let cap = this.capacity;
    this.timePtr = atomicChunkAlloc(cap * 8);
    this.valuePtr = atomicChunkAlloc(cap * 8);
    this.derivPtr = atomicChunkAlloc(cap * 8);
  }

  @inline get times(): UnmanagedFloat64Array {
    return changetype<UnmanagedFloat64Array>(this.timePtr);
  }

  @inline get values(): UnmanagedFloat64Array {
    return changetype<UnmanagedFloat64Array>(this.valuePtr);
  }

  @inline get derivs(): UnmanagedFloat64Array {
    return changetype<UnmanagedFloat64Array>(this.derivPtr);
  }

  /**
   * Pushes a new sample (t, value, deriv) to the circular buffer.
   */
  push(t: f64, val: f64, der: f64 = 0.0): void {
    let nextIdx = (this.head + 1) % this.capacity;
    this.times[nextIdx] = t;
    this.values[nextIdx] = val;
    this.derivs[nextIdx] = der;

    this.head = nextIdx;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Evaluates delay(expr, tau) at time t using Hermite cubic interpolation.
   * If t - tau < earliest recorded time, returns the earliest recorded value or initial guess.
   */
  evalDelay(t: f64, delayTime: f64): f64 {
    if (this.count == 0) return 0.0;

    let times = this.times;
    let values = this.values;
    let derivs = this.derivs;

    let targetT = t - delayTime;
    let newestIdx = this.head;
    let newestT = times[newestIdx];

    if (targetT >= newestT) {
      return values[newestIdx];
    }

    // Binary / linear search backward from head
    let c = this.count;
    let cap = this.capacity;

    let idx1: u32 = newestIdx;
    let t1: f64 = newestT;
    let idx0: u32 = (newestIdx + cap - 1) % cap;
    let t0: f64 = times[idx0];

    for (let i: u32 = 0; i < c - 1; i++) {
      let currIdx = (newestIdx + cap - i) % cap;
      let prevIdx = (newestIdx + cap - i - 1) % cap;

      let cT = times[currIdx];
      let pT = times[prevIdx];

      if (targetT <= cT && targetT >= pT) {
        idx0 = prevIdx;
        t0 = pT;
        idx1 = currIdx;
        t1 = cT;
        break;
      }
    }

    if (t1 <= t0) {
      return values[idx0];
    }

    // Cubic Hermite Interpolation
    let dt = t1 - t0;
    let s = (targetT - t0) / dt;
    let s2 = s * s;
    let s3 = s2 * s;

    let y0 = values[idx0];
    let y1 = values[idx1];
    let d0 = derivs[idx0] * dt;
    let d1 = derivs[idx1] * dt;

    let h00 = 2.0 * s3 - 3.0 * s2 + 1.0;
    let h10 = s3 - 2.0 * s2 + s;
    let h01 = -2.0 * s3 + 3.0 * s2;
    let h11 = s3 - s2;

    return h00 * y0 + h10 * d0 + h01 * y1 + h11 * d1;
  }

  /**
   * Evaluates Modelica spatialDistribution(in0, in1, x, isPositive) operator for 1D advection transport.
   */
  evalSpatialDistribution(in0: f64, in1: f64, x: f64, isPositive: bool): f64 {
    if (isPositive) {
      // Flow from 0 -> 1: evaluates delayed signal from in0
      return (1.0 - x) * in0 + x * this.evalDelay(1.0, x);
    } else {
      // Flow from 1 -> 0: evaluates delayed signal from in1
      return x * in1 + (1.0 - x) * this.evalDelay(1.0, 1.0 - x);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_createDelayBuffer(capacity: u32): u32 {
  let ptr = atomicChunkAlloc(256);
  let buf = changetype<DelayRingBuffer>(ptr);
  buf.init(capacity);
  return ptr as u32;
}

export function dae_pushDelaySample(bufPtr: u32, t: f64, val: f64, der: f64): void {
  if (bufPtr == 0) return;
  changetype<DelayRingBuffer>(bufPtr).push(t, val, der);
}

export function dae_evalDelay(bufPtr: u32, t: f64, delayTime: f64): f64 {
  if (bufPtr == 0) return 0.0;
  return changetype<DelayRingBuffer>(bufPtr).evalDelay(t, delayTime);
}

export function dae_evalSpatialDistribution(
  bufPtr: u32,
  in0: f64,
  in1: f64,
  x: f64,
  isPositive: bool
): f64 {
  if (bufPtr == 0) return in0;
  return changetype<DelayRingBuffer>(bufPtr).evalSpatialDistribution(in0, in1, x, isPositive);
}
