// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/dynamo-std-lib`.
 *
 * Implements the 12 core MIT DYNAMO System Dynamics functions:
 *   SMOOTH, DLINF1, DLINF3, DELAY1, DELAY3,
 *   TABLE, TABHL, CLIP, SWITCH, STEP, PULSE, RAMP.
 */

export function dynamo_eval_clip(p: f64, q: f64, r: f64, s: f64): f64 {
  return r >= s ? p : q;
}

export function dynamo_eval_switch(p: f64, q: f64, r: f64): f64 {
  return r == 0.0 ? p : q;
}

export function dynamo_eval_step(height: f64, stime: f64, time: f64): f64 {
  return time >= stime ? height : 0.0;
}

export function dynamo_eval_ramp(slope: f64, rtime: f64, time: f64): f64 {
  return time >= rtime ? slope * (time - rtime) : 0.0;
}

export function dynamo_eval_pulse(
  height: f64,
  first: f64,
  interval: f64,
  time: f64,
  dt: f64,
): f64 {
  const halfDt = dt > 0.0 ? dt * 0.5 : 1e-9;
  if (time + halfDt < first) return 0.0;
  if (interval <= 0.0) {
    return time >= first - 1e-9 && time < first + dt - 1e-9 ? height : 0.0;
  }
  const elapsed = time - first;
  const k = Math.floor((elapsed + 1e-9) / interval);
  const pulseStart = first + k * interval;
  return time >= pulseStart - 1e-9 && time < pulseStart + dt - 1e-9 ? height : 0.0;
}

/**
 * First-order exponential smooth / information delay derivative:
 *   dS/dt = (input - state) / max(delay, 1e-12)
 */
export function dynamo_eval_smooth_deriv(input: f64, state: f64, delay: f64): f64 {
  const d = delay > 1e-12 ? delay : 1e-12;
  return (input - state) / d;
}

export function dynamo_eval_dlinf1_deriv(input: f64, state: f64, delay: f64): f64 {
  return dynamo_eval_smooth_deriv(input, state, delay);
}

/**
 * First-order material delay stage:
 *   out = level / delay, dL/dt = input - out
 */
export function dynamo_eval_delay1_out(level: f64, delay: f64): f64 {
  const d = delay > 1e-12 ? delay : 1e-12;
  return level / d;
}

export function dynamo_eval_delay1_deriv(input: f64, level: f64, delay: f64): f64 {
  return input - dynamo_eval_delay1_out(level, delay);
}

/**
 * Third-order stage time constant helper (DEL / 3).
 */
export function dynamo_eval_delay3_stage_out(level: f64, totalDelay: f64): f64 {
  const stageDelay = totalDelay / 3.0;
  const d = stageDelay > 1e-12 ? stageDelay : 1e-12;
  return level / d;
}

export function dynamo_eval_dlinf3_stage_deriv(input: f64, state: f64, totalDelay: f64): f64 {
  const stageDelay = totalDelay / 3.0;
  const d = stageDelay > 1e-12 ? stageDelay : 1e-12;
  return (input - state) / d;
}

/**
 * Linear interpolation helper for TABLE (clamped = 0) and TABHL (clamped = 1)
 * on a 2-point bracket [y0, y1] at fractional position frac.
 */
export function dynamo_eval_table_interp(y0: f64, y1: f64, frac: f64, clamped: i32): f64 {
  let t = frac;
  if (clamped != 0) {
    if (t < 0.0) t = 0.0;
    if (t > 1.0) t = 1.0;
  }
  return y0 + (y1 - y0) * t;
}
