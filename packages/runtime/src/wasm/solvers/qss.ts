// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for Quantized State System (QSS1, QSS2, QSS3, LIQSS2) Integrators.
 *
 * Implements zero-GC, flat linear-memory kernels for:
 * - Next-event minimum time selection (`qss_find_min_event`)
 * - Vectorized quantized/continuous polynomial evaluation (`qss_eval_q_all`, `qss_eval_x_all`)
 * - QSS1/QSS2/QSS3/LIQSS2 quantized state advance (`qss_advance_quantized_state`)
 * - Quadratic/cubic positive root finding (`qss_smallest_positive_poly_root`)
 * - Single & batch next quantum-crossing scheduling (`qss_schedule_next_crossing`,
 *   `qss_schedule_affected_crossings`, `qss_schedule_all_self_crossings`)
 */

/**
 * Finds the smallest positive root tau > 1e-14 of c0 + c1*tau + c2*tau^2 + c3*tau^3 = 0.
 * Returns Infinity if no positive real root exists.
 */
export function qss_smallest_positive_poly_root(
  c0: f64,
  c1: f64,
  c2: f64,
  c3: f64,
): f64 {
  let minRoot: f64 = Infinity;

  if (Math.abs(c3) < 1e-18) {
    if (Math.abs(c2) < 1e-18) {
      if (Math.abs(c1) > 1e-18) {
        const r: f64 = -c0 / c1;
        if (isFinite(r) && r > 1e-14 && r < minRoot) {
          minRoot = r;
        }
      }
      return minRoot;
    }
    const disc: f64 = c1 * c1 - 4.0 * c2 * c0;
    if (disc >= 0.0) {
      const s: f64 = Math.sqrt(disc);
      const inv2c2: f64 = 1.0 / (2.0 * c2);
      const r1: f64 = (-c1 - s) * inv2c2;
      if (isFinite(r1) && r1 > 1e-14 && r1 < minRoot) {
        minRoot = r1;
      }
      const r2: f64 = (-c1 + s) * inv2c2;
      if (isFinite(r2) && r2 > 1e-14 && r2 < minRoot) {
        minRoot = r2;
      }
    }
    return minRoot;
  }

  // Cubic root finding via derivative-extrema brackets + bisection on the positive real axis
  // Derivative: 3*c3*t^2 + 2*c2*t + c1 = 0 has at most 2 positive roots.
  const p0: f64 = 0.0;
  let p1: f64 = 0.0;
  let p2: f64 = 0.0;
  let p3: f64 = 0.0;
  let numPts: i32 = 1;

  const dDisc: f64 = 4.0 * c2 * c2 - 12.0 * c3 * c1;
  if (dDisc >= 0.0) {
    const sd: f64 = Math.sqrt(dDisc);
    const inv6c3: f64 = 1.0 / (6.0 * c3);
    const t1: f64 = (-2.0 * c2 - sd) * inv6c3;
    const t2: f64 = (-2.0 * c2 + sd) * inv6c3;
    if (t1 > 0.0 && t2 > 0.0) {
      if (t1 <= t2) {
        p1 = t1;
        p2 = t2;
      } else {
        p1 = t2;
        p2 = t1;
      }
      numPts = 3;
    } else if (t1 > 0.0) {
      p1 = t1;
      numPts = 2;
    } else if (t2 > 0.0) {
      p1 = t2;
      numPts = 2;
    }
  }

  let maxCoeff: f64 = Math.abs(c0);
  const absC1: f64 = Math.abs(c1);
  if (absC1 > maxCoeff) maxCoeff = absC1;
  const absC2: f64 = Math.abs(c2);
  if (absC2 > maxCoeff) maxCoeff = absC2;
  const scaleBound: f64 = 1.0 + maxCoeff / Math.abs(c3);

  if (numPts == 1) {
    p1 = scaleBound;
  } else if (numPts == 2) {
    p2 = scaleBound;
  } else {
    p3 = scaleBound;
  }
  numPts += 1;

  for (let i: i32 = 0; i < numPts - 1; i++) {
    let a: f64 = i == 0 ? p0 : i == 1 ? p1 : p2;
    let b: f64 = i == 0 ? p1 : i == 1 ? p2 : p3;
    let fa: f64 = ((c3 * a + c2) * a + c1) * a + c0;
    const fb: f64 = ((c3 * b + c2) * b + c1) * b + c0;
    if (Math.abs(fa) < 1e-15 && a > 1e-14) {
      if (isFinite(a) && a < minRoot) minRoot = a;
      return minRoot;
    }
    if (fa * fb <= 0.0) {
      let mid: f64 = 0.5 * (a + b);
      for (let iter: i32 = 0; iter < 32; iter++) {
        mid = 0.5 * (a + b);
        const fm: f64 = ((c3 * mid + c2) * mid + c1) * mid + c0;
        if (Math.abs(fm) < 1e-14 || b - a < 1e-13) break;
        if (fa * fm <= 0.0) {
          b = mid;
        } else {
          a = mid;
          fa = fm;
        }
      }
      if (isFinite(mid) && mid > 1e-14 && mid < minRoot) {
        minRoot = mid;
      }
      if (minRoot < Infinity) return minRoot;
    }
  }
  return minRoot;
}

/**
 * Finds the state index `minIdx` with the earliest scheduled quantum crossing time
 * in `nextEventTimePtr` (`n` x `f64`). Returns `-1` if `n <= 0` or all times are `Infinity`.
 */
export function qss_find_min_event(n: i32, nextEventTimePtr: usize): i32 {
  let minTime: f64 = Infinity;
  let minIdx: i32 = -1;
  for (let i: i32 = 0; i < n; i++) {
    const t: f64 = load<f64>(nextEventTimePtr + ((i as usize) << 3));
    if (t < minTime) {
      minTime = t;
      minIdx = i;
    }
  }
  return minIdx;
}

/**
 * Evaluates all `n` quantized state polynomials q_i(t) into `outPtr` (`n` x `f64`).
 */
export function qss_eval_q_all(
  n: i32,
  order: i32,
  t: f64,
  q0Ptr: usize,
  q1Ptr: usize,
  q2Ptr: usize,
  tqPtr: usize,
  outPtr: usize,
): void {
  if (order == 1) {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      store<f64>(outPtr + off, load<f64>(q0Ptr + off));
    }
  } else if (order == 2) {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const dt: f64 = t - load<f64>(tqPtr + off);
      store<f64>(outPtr + off, load<f64>(q0Ptr + off) + load<f64>(q1Ptr + off) * dt);
    }
  } else {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const dt: f64 = t - load<f64>(tqPtr + off);
      const v: f64 =
        load<f64>(q0Ptr + off) +
        load<f64>(q1Ptr + off) * dt +
        load<f64>(q2Ptr + off) * dt * dt;
      store<f64>(outPtr + off, v);
    }
  }
}

/**
 * Evaluates all `n` continuous state polynomials x_i(t) into `outPtr` (`n` x `f64`).
 */
export function qss_eval_x_all(
  n: i32,
  order: i32,
  t: f64,
  x0Ptr: usize,
  x1Ptr: usize,
  x2Ptr: usize,
  x3Ptr: usize,
  txPtr: usize,
  outPtr: usize,
): void {
  if (order == 1) {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const dt: f64 = t - load<f64>(txPtr + off);
      store<f64>(outPtr + off, load<f64>(x0Ptr + off) + load<f64>(x1Ptr + off) * dt);
    }
  } else if (order == 2) {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const dt: f64 = t - load<f64>(txPtr + off);
      const v: f64 =
        load<f64>(x0Ptr + off) +
        load<f64>(x1Ptr + off) * dt +
        load<f64>(x2Ptr + off) * dt * dt;
      store<f64>(outPtr + off, v);
    }
  } else {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const dt: f64 = t - load<f64>(txPtr + off);
      const dt2: f64 = dt * dt;
      const v: f64 =
        load<f64>(x0Ptr + off) +
        load<f64>(x1Ptr + off) * dt +
        load<f64>(x2Ptr + off) * dt2 +
        load<f64>(x3Ptr + off) * dt2 * dt;
      store<f64>(outPtr + off, v);
    }
  }
}

/**
 * Advances continuous state `minIdx` to `currentTime`, updates its quantum `dq[minIdx]`,
 * and advances its quantized state polynomial `q` (QSS1/QSS2/QSS3 or stiff LIQSS2).
 *
 * Returns `1` if LIQSS2 locked onto the slow-manifold equilibrium, `0` otherwise.
 */
export function qss_advance_quantized_state(
  minIdx: i32,
  order: i32,
  isLiqss: i32,
  currentTime: f64,
  rtol: f64,
  atol: f64,
  x0Ptr: usize,
  x1Ptr: usize,
  x2Ptr: usize,
  x3Ptr: usize,
  txPtr: usize,
  q0Ptr: usize,
  q1Ptr: usize,
  q2Ptr: usize,
  tqPtr: usize,
  dqPtr: usize,
  diagJacPtr: usize,
): i32 {
  const off: usize = (minIdx as usize) << 3;
  const dtPrevX: f64 = currentTime - load<f64>(txPtr + off);
  const x0Val: f64 = load<f64>(x0Ptr + off);
  const x1Val: f64 = load<f64>(x1Ptr + off);
  const x2Val: f64 = order >= 2 ? load<f64>(x2Ptr + off) : 0.0;
  const x3Val: f64 = order >= 3 ? load<f64>(x3Ptr + off) : 0.0;

  const dt2: f64 = dtPrevX * dtPrevX;
  const xNow: f64 =
    x0Val +
    x1Val * dtPrevX +
    (order >= 2 ? x2Val * dt2 : 0.0) +
    (order >= 3 ? x3Val * dt2 * dtPrevX : 0.0);

  store<f64>(x0Ptr + off, xNow);
  store<f64>(txPtr + off, currentTime);

  const relQ: f64 = rtol * Math.abs(xNow);
  const quant: f64 = relQ > atol ? relQ : atol;
  store<f64>(dqPtr + off, quant);

  if (isLiqss != 0) {
    const aii: f64 = load<f64>(diagJacPtr + off);
    if (aii < -1e-6) {
      const dtPrev: f64 = currentTime - load<f64>(tqPtr + off);
      const q1Prev: f64 = load<f64>(q1Ptr + off);
      const qPrev: f64 = load<f64>(q0Ptr + off) + q1Prev * dtPrev;
      const dxPrev: f64 = x1Val + 2.0 * x2Val * dtPrevX;
      const ddxPrev: f64 = 2.0 * x2Val;
      const u0: f64 = dxPrev - aii * qPrev;
      const u1: f64 = ddxPrev - aii * q1Prev;
      const q1Eq: f64 = -u1 / aii;
      const eqState: f64 = (q1Eq - u0) / aii;
      const diff: f64 = eqState - xNow;

      store<f64>(tqPtr + off, currentTime);
      if (Math.abs(diff) <= quant) {
        store<f64>(q0Ptr + off, eqState);
        store<f64>(q1Ptr + off, q1Eq);
        return 1;
      } else {
        const sgn: f64 = diff > 0.0 ? 1.0 : diff < 0.0 ? -1.0 : 0.0;
        store<f64>(q0Ptr + off, xNow + sgn * quant);
        store<f64>(q1Ptr + off, dxPrev);
        return 0;
      }
    }
  }

  store<f64>(q0Ptr + off, xNow);
  store<f64>(tqPtr + off, currentTime);
  if (order >= 2) {
    store<f64>(q1Ptr + off, x1Val + 2.0 * x2Val * dtPrevX + 3.0 * x3Val * dt2);
  }
  if (order >= 3) {
    store<f64>(q2Ptr + off, x2Val + 3.0 * x3Val * dtPrevX);
  }
  return 0;
}

/**
 * Computes and stores `nextEventTime[i]` where |x_i(tau) - q_i(tau)| = dq[i].
 * Returns the scheduled next crossing time.
 */
export function qss_schedule_next_crossing(
  i: i32,
  order: i32,
  t: f64,
  isSelfUpdate: i32,
  x0Ptr: usize,
  x1Ptr: usize,
  x2Ptr: usize,
  x3Ptr: usize,
  q0Ptr: usize,
  q1Ptr: usize,
  q2Ptr: usize,
  tqPtr: usize,
  dqPtr: usize,
  nextEventTimePtr: usize,
): f64 {
  const off: usize = (i as usize) << 3;
  const quant: f64 = load<f64>(dqPtr + off);

  if (isSelfUpdate != 0) {
    let nextT: f64 = Infinity;
    if (order == 1) {
      const slope: f64 = Math.abs(load<f64>(x1Ptr + off));
      nextT = slope > 1e-18 ? t + quant / slope : Infinity;
    } else if (order == 2) {
      const accel: f64 = Math.abs(load<f64>(x2Ptr + off));
      if (accel > 1e-18) {
        nextT = t + Math.sqrt(quant / accel);
      } else {
        const slopeDiff: f64 = Math.abs(load<f64>(x1Ptr + off) - load<f64>(q1Ptr + off));
        nextT = slopeDiff > 1e-18 ? t + quant / slopeDiff : Infinity;
      }
    } else {
      const jerk: f64 = Math.abs(load<f64>(x3Ptr + off));
      if (jerk > 1e-18) {
        nextT = t + Math.cbrt(quant / jerk);
      } else {
        const curvDiff: f64 = Math.abs(load<f64>(x2Ptr + off) - load<f64>(q2Ptr + off));
        if (curvDiff > 1e-18) {
          nextT = t + Math.sqrt(quant / curvDiff);
        } else {
          nextT = Infinity;
        }
      }
    }
    store<f64>(nextEventTimePtr + off, nextT);
    return nextT;
  }

  // Dependent update: compute difference polynomial e(tau) = x_i(t + tau) - q_i(t + tau)
  const dtQ: f64 = t - load<f64>(tqPtr + off);
  const q0Val: f64 = load<f64>(q0Ptr + off);
  const q1Val: f64 = order >= 2 ? load<f64>(q1Ptr + off) : 0.0;
  const q2Val: f64 = order >= 3 ? load<f64>(q2Ptr + off) : 0.0;

  const qVal: f64 = q0Val + q1Val * dtQ + q2Val * dtQ * dtQ;
  const qSlope: f64 = q1Val + 2.0 * q2Val * dtQ;
  const qCurv: f64 = q2Val;

  const e0: f64 = load<f64>(x0Ptr + off) - qVal;
  if (Math.abs(e0) >= quant * (1.0 - 1e-12)) {
    store<f64>(nextEventTimePtr + off, t);
    return t;
  }
  const e1: f64 = load<f64>(x1Ptr + off) - qSlope;
  const e2: f64 = (order >= 2 ? load<f64>(x2Ptr + off) : 0.0) - qCurv;
  const e3: f64 = order >= 3 ? load<f64>(x3Ptr + off) : 0.0;

  const rUpper: f64 = qss_smallest_positive_poly_root(e0 - quant, e1, e2, e3);
  const rLower: f64 = qss_smallest_positive_poly_root(e0 + quant, e1, e2, e3);
  const dt: f64 = rUpper < rLower ? rUpper : rLower;
  const nextT: f64 = t + dt;
  store<f64>(nextEventTimePtr + off, nextT);
  return nextT;
}

/**
 * Batch-schedules the self-update for `minIdx` (if >= 0) and dependent updates
 * for all `j != minIdx` listed in `affectedPtr` (`affectedCount` x `i32`).
 */
export function qss_schedule_affected_crossings(
  minIdx: i32,
  affectedCount: i32,
  affectedPtr: usize,
  order: i32,
  t: f64,
  x0Ptr: usize,
  x1Ptr: usize,
  x2Ptr: usize,
  x3Ptr: usize,
  q0Ptr: usize,
  q1Ptr: usize,
  q2Ptr: usize,
  tqPtr: usize,
  dqPtr: usize,
  nextEventTimePtr: usize,
): void {
  if (minIdx >= 0) {
    qss_schedule_next_crossing(
      minIdx,
      order,
      t,
      1,
      x0Ptr,
      x1Ptr,
      x2Ptr,
      x3Ptr,
      q0Ptr,
      q1Ptr,
      q2Ptr,
      tqPtr,
      dqPtr,
      nextEventTimePtr,
    );
  }
  for (let k: i32 = 0; k < affectedCount; k++) {
    const j: i32 = load<i32>(affectedPtr + ((k as usize) << 2));
    if (j != minIdx) {
      qss_schedule_next_crossing(
        j,
        order,
        t,
        0,
        x0Ptr,
        x1Ptr,
        x2Ptr,
        x3Ptr,
        q0Ptr,
        q1Ptr,
        q2Ptr,
        tqPtr,
        dqPtr,
        nextEventTimePtr,
      );
    }
  }
}

/**
 * Schedules self-update next quantum-crossing times for all `n` states at time `t`.
 */
export function qss_schedule_all_self_crossings(
  n: i32,
  order: i32,
  t: f64,
  x0Ptr: usize,
  x1Ptr: usize,
  x2Ptr: usize,
  x3Ptr: usize,
  q0Ptr: usize,
  q1Ptr: usize,
  q2Ptr: usize,
  tqPtr: usize,
  dqPtr: usize,
  nextEventTimePtr: usize,
): void {
  for (let i: i32 = 0; i < n; i++) {
    qss_schedule_next_crossing(
      i,
      order,
      t,
      1,
      x0Ptr,
      x1Ptr,
      x2Ptr,
      x3Ptr,
      q0Ptr,
      q1Ptr,
      q2Ptr,
      tqPtr,
      dqPtr,
      nextEventTimePtr,
    );
  }
}
