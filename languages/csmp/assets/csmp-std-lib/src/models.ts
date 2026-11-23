// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/csmp-std-lib`.
 *
 * Implements the 12 classic IBM System/360 CSMP / CSSL-67 functional blocks
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — block parameters & lookup table pairs
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector / delay buffer
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — signal I/O bus:
 *       IO[0] = x (primary input)
 *       IO[1] = x2 (secondary input / trigger)
 *       IO[2] = y (primary output)
 *       IO[3] = dy (derivative output)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const ARCH_INTGRL: i32 = 1;
const ARCH_DERIV: i32 = 2;
const ARCH_DELAY: i32 = 3;
const ARCH_ZHOLD: i32 = 4;

const ARCH_REALPL: i32 = 10;
const ARCH_CMPXPL: i32 = 11;
const ARCH_LEDLAG: i32 = 12;

const ARCH_HYSTRS: i32 = 20;
const ARCH_LIMIT: i32 = 21;
const ARCH_DEADSP: i32 = 22;

const ARCH_AFGEN: i32 = 30;
const ARCH_NLFGEN: i32 = 31;

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
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

function stateCountForArchetype(archetypeId: i32): i32 {
  if (archetypeId == ARCH_INTGRL || archetypeId == ARCH_REALPL || archetypeId == ARCH_LEDLAG) {
    return 1;
  }
  if (archetypeId == ARCH_CMPXPL) {
    return 2;
  }
  return 0;
}

/**
 * Initializes state vector for a CSMP block slot.
 */
export function csmpModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  for (let i = 0; i < 32; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  const ic = getCon(slotPtr, conCount, 0, 0.0);
  if (archetypeId == ARCH_INTGRL || archetypeId == ARCH_REALPL || archetypeId == ARCH_ZHOLD || archetypeId == ARCH_HYSTRS) {
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 2, ic);
  } else if (archetypeId == ARCH_DERIV) {
    setState(slotPtr, 0, ic);
    setIo(slotPtr, 2, 0.0);
  } else if (archetypeId == ARCH_CMPXPL) {
    const ic2 = getCon(slotPtr, conCount, 1, 0.0);
    setState(slotPtr, 0, ic);
    setState(slotPtr, 1, ic2);
    setIo(slotPtr, 2, ic);
    setIo(slotPtr, 3, ic2);
  } else if (archetypeId == ARCH_LEDLAG) {
    setState(slotPtr, 0, 0.0);
    setIo(slotPtr, 2, 0.0);
  } else {
    setIo(slotPtr, 2, 0.0);
  }
}

/**
 * Evaluates derivatives and algebraic outputs for a CSMP block slot.
 */
export function csmpModelEval(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const x = getIo(slotPtr, 0);
  const x2 = getIo(slotPtr, 1);

  if (archetypeId == ARCH_INTGRL) {
    const y = getState(slotPtr, 0);
    setDState(slotPtr, 0, x);
    setIo(slotPtr, 2, y);
    setIo(slotPtr, 3, x);
    return;
  }

  if (archetypeId == ARCH_DERIV) {
    const prevX = getState(slotPtr, 0);
    const deriv = dt > 1e-12 ? (x - prevX) / dt : 0.0;
    setIo(slotPtr, 2, deriv);
    setIo(slotPtr, 3, deriv);
    return;
  }

  if (archetypeId == ARCH_DELAY) {
    const nRaw = <i32>Math.round(getCon(slotPtr, conCount, 0, 16.0));
    const n = nRaw < 1 ? 1 : nRaw > 28 ? 28 : nRaw;
    const head = <i32>getState(slotPtr, 30);
    const delayed = getState(slotPtr, head % n);
    setIo(slotPtr, 2, delayed);
    return;
  }

  if (archetypeId == ARCH_ZHOLD) {
    const held = x2 > 0.0 ? x : getState(slotPtr, 0);
    setIo(slotPtr, 2, held);
    return;
  }

  if (archetypeId == ARCH_REALPL) {
    const p = getCon(slotPtr, conCount, 1, 1.0);
    const tau = p > 1e-12 ? p : 1e-12;
    const y = getState(slotPtr, 0);
    const dy = (x - y) / tau;
    setDState(slotPtr, 0, dy);
    setIo(slotPtr, 2, y);
    setIo(slotPtr, 3, dy);
    return;
  }

  if (archetypeId == ARCH_CMPXPL) {
    const p1 = getCon(slotPtr, conCount, 2, 0.5);
    const p2 = getCon(slotPtr, conCount, 3, 1.0);
    const y = getState(slotPtr, 0);
    const yd = getState(slotPtr, 1);
    const ydd = x - 2.0 * p1 * p2 * yd - p2 * p2 * y;
    setDState(slotPtr, 0, yd);
    setDState(slotPtr, 1, ydd);
    setIo(slotPtr, 2, y);
    setIo(slotPtr, 3, yd);
    return;
  }

  if (archetypeId == ARCH_LEDLAG) {
    const p1 = getCon(slotPtr, conCount, 0, 1.0);
    const p2 = getCon(slotPtr, conCount, 1, 0.5);
    const tau2 = p2 > 1e-12 ? p2 : 1e-12;
    const z = getState(slotPtr, 0);
    const y = z + (p1 / tau2) * x;
    const dz = ((1.0 - p1 / tau2) * x - z) / tau2;
    setDState(slotPtr, 0, dz);
    setIo(slotPtr, 2, y);
    return;
  }

  if (archetypeId == ARCH_HYSTRS) {
    const p1 = getCon(slotPtr, conCount, 1, -1.0);
    const p2 = getCon(slotPtr, conCount, 2, 1.0);
    let y = getState(slotPtr, 0);
    if (x > y + p2) {
      y = x - p2;
    } else if (x < y + p1) {
      y = x - p1;
    }
    setIo(slotPtr, 2, y);
    return;
  }

  if (archetypeId == ARCH_LIMIT) {
    const p1 = getCon(slotPtr, conCount, 0, -1.0);
    const p2 = getCon(slotPtr, conCount, 1, 1.0);
    let y = x;
    if (y < p1) y = p1;
    if (y > p2) y = p2;
    setIo(slotPtr, 2, y);
    return;
  }

  if (archetypeId == ARCH_DEADSP) {
    const p1 = getCon(slotPtr, conCount, 0, -1.0);
    const p2 = getCon(slotPtr, conCount, 1, 1.0);
    let y: f64 = 0.0;
    if (x > p2) {
      y = x - p2;
    } else if (x < p1) {
      y = x - p1;
    }
    setIo(slotPtr, 2, y);
    return;
  }

  if (archetypeId == ARCH_AFGEN || archetypeId == ARCH_NLFGEN) {
    // CON[0] = nPoints, CON[1..] = x0, y0, x1, y1, ...
    const nPts = <i32>Math.round(getCon(slotPtr, conCount, 0, 0.0));
    if (nPts <= 0) {
      setIo(slotPtr, 2, 0.0);
      return;
    }
    const x0 = getCon(slotPtr, conCount, 1, 0.0);
    const y0 = getCon(slotPtr, conCount, 2, 0.0);
    if (nPts == 1 || x <= x0) {
      setIo(slotPtr, 2, y0);
      return;
    }
    const xLast = getCon(slotPtr, conCount, 1 + 2 * (nPts - 1), x0);
    const yLast = getCon(slotPtr, conCount, 2 + 2 * (nPts - 1), y0);
    if (x >= xLast) {
      setIo(slotPtr, 2, yLast);
      return;
    }
    // Find segment i such that x_i <= x <= x_{i+1}
    let seg = 0;
    for (let i = 0; i < nPts - 1; i++) {
      const xi = getCon(slotPtr, conCount, 1 + 2 * i, 0.0);
      const xNext = getCon(slotPtr, conCount, 1 + 2 * (i + 1), 0.0);
      if (x >= xi && x <= xNext) {
        seg = i;
        break;
      }
    }
    if (archetypeId == ARCH_NLFGEN && nPts >= 3) {
      const i0 = seg + 2 < nPts ? seg : nPts - 3;
      const xa = getCon(slotPtr, conCount, 1 + 2 * i0, 0.0);
      const ya = getCon(slotPtr, conCount, 2 + 2 * i0, 0.0);
      const xb = getCon(slotPtr, conCount, 1 + 2 * (i0 + 1), 0.0);
      const yb = getCon(slotPtr, conCount, 2 + 2 * (i0 + 1), 0.0);
      const xc = getCon(slotPtr, conCount, 1 + 2 * (i0 + 2), 0.0);
      const yc = getCon(slotPtr, conCount, 2 + 2 * (i0 + 2), 0.0);
      const la = ((x - xb) * (x - xc)) / ((xa - xb) * (xa - xc));
      const lb = ((x - xa) * (x - xc)) / ((xb - xa) * (xb - xc));
      const lc = ((x - xa) * (x - xb)) / ((xc - xa) * (xc - xb));
      setIo(slotPtr, 2, ya * la + yb * lb + yc * lc);
      return;
    }
    const xa = getCon(slotPtr, conCount, 1 + 2 * seg, 0.0);
    const ya = getCon(slotPtr, conCount, 2 + 2 * seg, 0.0);
    const xb = getCon(slotPtr, conCount, 1 + 2 * (seg + 1), 0.0);
    const yb = getCon(slotPtr, conCount, 2 + 2 * (seg + 1), 0.0);
    const frac = Math.abs(xb - xa) > 1e-12 ? (x - xa) / (xb - xa) : 0.0;
    setIo(slotPtr, 2, ya + frac * (yb - ya));
  }
}

/**
 * Advances one integration step `dt` using RK4 for continuous states or discrete state update.
 */
export function csmpModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = stateCountForArchetype(archetypeId);
  if (nStates == 0 || dt <= 0.0) {
    csmpModelEval(archetypeId, t, dt, slotPtr, conCount);
    const x = getIo(slotPtr, 0);
    if (archetypeId == ARCH_DERIV) {
      setState(slotPtr, 0, x);
    } else if (archetypeId == ARCH_ZHOLD || archetypeId == ARCH_HYSTRS) {
      setState(slotPtr, 0, getIo(slotPtr, 2));
    } else if (archetypeId == ARCH_DELAY) {
      const nRaw = <i32>Math.round(getCon(slotPtr, conCount, 0, 16.0));
      const n = nRaw < 1 ? 1 : nRaw > 28 ? 28 : nRaw;
      const head = <i32>getState(slotPtr, 30);
      setState(slotPtr, head % n, x);
      setState(slotPtr, 30, <f64>((head + 1) % n));
    }
    return;
  }

  // Classical 4th-order Runge-Kutta for up to 2 states
  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);

  csmpModelEval(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * k1_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * k1_1);
  csmpModelEval(archetypeId, t + 0.5 * dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * k2_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * k2_1);
  csmpModelEval(archetypeId, t + 0.5 * dt, dt, slotPtr, conCount);
  const k3_0 = getDState(slotPtr, 0);
  const k3_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + dt * k3_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + dt * k3_1);
  csmpModelEval(archetypeId, t + dt, dt, slotPtr, conCount);
  const k4_0 = getDState(slotPtr, 0);
  const k4_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + (dt / 6.0) * (k1_0 + 2.0 * k2_0 + 2.0 * k3_0 + k4_0));
  if (nStates > 1) {
    setState(slotPtr, 1, y0_1 + (dt / 6.0) * (k1_1 + 2.0 * k2_1 + 2.0 * k3_1 + k4_1));
  }
  csmpModelEval(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Batched zero-copy RK4 step across `count` descriptors `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function csmpBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    csmpModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
