// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Standalone Numerical Integrator Kernels:
 * - Gillespie Direct Method SSA (mass-action reaction networks, Xoshiro256++ PRNG)
 * - Poisson Tau-Leaping SSA
 * - Radau IIA (3-stage / 5-stage) coupled linear stage system assembly & LU solve
 * - QSS1 quantized event-driven linear ODE integrator
 */

// ─────────────────────────────────────────────────────────────────────────────
// Xoshiro256++ PRNG (zero-allocation linear-memory state)
// ─────────────────────────────────────────────────────────────────────────────

let _s0: u64 = 0x9e3779b97f4a7c15;
let _s1: u64 = 0xbf58476d1ce4e5b9;
let _s2: u64 = 0x94d049bb133111eb;
let _s3: u64 = 0x2545f4914f6cdd1d;

@inline
function splitmix64(x: u64): u64 {
  x += 0x9e3779b97f4a7c15;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9;
  x = (x ^ (x >> 27)) * 0x94d049bb133111eb;
  return x ^ (x >> 31);
}

export function ssa_seed(seed: u64): void {
  let z = seed == 0 ? 42 : seed;
  _s0 = splitmix64(z);
  z += 0x9e3779b97f4a7c15;
  _s1 = splitmix64(z);
  z += 0x9e3779b97f4a7c15;
  _s2 = splitmix64(z);
  z += 0x9e3779b97f4a7c15;
  _s3 = splitmix64(z);
  nextU64();
  nextU64();
  nextU64();
  nextU64();
}

@inline
function rotl64(x: u64, k: i32): u64 {
  return (x << k) | (x >> (64 - k));
}

@inline
function nextU64(): u64 {
  const result = rotl64(_s0 + _s3, 23) + _s0;
  const t = _s1 << 17;
  _s2 ^= _s0;
  _s3 ^= _s1;
  _s1 ^= _s2;
  _s0 ^= _s3;
  _s2 ^= t;
  _s3 = rotl64(_s3, 45);
  return result;
}

@inline
function nextUniform(): f64 {
  return <f64>(nextU64() >> 11) * (1.0 / 9007199254740992.0);
}

@inline
function samplePoisson(lambda: f64): i32 {
  if (lambda <= 0.0) return 0;
  if (lambda < 30.0) {
    const L = Math.exp(-lambda);
    let k: i32 = 0;
    let p: f64 = 1.0;
    do {
      k++;
      p *= nextUniform();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation with continuity correction for large lambda
  let u1 = nextUniform();
  if (u1 < 1e-15) u1 = 1e-15;
  const u2 = nextUniform();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(6.283185307179586 * u2);
  const val = Math.floor(lambda + Math.sqrt(lambda) * z + 0.5);
  return val > 0.0 ? <i32>val : 0;
}

@inline
function massActionPropensity(
  rate: f64,
  reactStart: i32,
  reactEnd: i32,
  reactSpeciesPtr: usize,
  reactOrderPtr: usize,
  statePtr: usize,
): f64 {
  let a = rate;
  for (let k = reactStart; k < reactEnd; k++) {
    const sp = load<i32>(reactSpeciesPtr + (<usize>k << 2));
    const ord = load<i32>(reactOrderPtr + (<usize>k << 2));
    const count = load<f64>(statePtr + (<usize>sp << 3));
    if (ord == 1) {
      if (count < 1.0) return 0.0;
      a *= count;
    } else if (ord == 2) {
      if (count < 2.0) return 0.0;
      a *= 0.5 * count * (count - 1.0);
    } else if (ord > 2) {
      if (count < <f64>ord) return 0.0;
      let comb: f64 = 1.0;
      for (let m: i32 = 0; m < ord; m++) {
        comb = (comb * (count - <f64>m)) / <f64>(m + 1);
      }
      a *= comb;
    }
  }
  return a;
}

/**
 * Gillespie Direct Method SSA for mass-action reaction networks.
 * Records snapshots onto uniform time grid [t0, tEnd] of length `numOutputs`.
 * Returns total reactions fired.
 */
export function ssa_gillespieTrajectory(
  nSpecies: i32,
  nReactions: i32,
  initStatePtr: usize,
  ratesPtr: usize,
  reactRowPtr: usize,
  reactSpeciesPtr: usize,
  reactOrderPtr: usize,
  stoichRowPtr: usize,
  stoichSpeciesPtr: usize,
  stoichDeltaPtr: usize,
  t0: f64,
  tEnd: f64,
  numOutputs: i32,
  maxSteps: i32,
  seed: u64,
  outTimesPtr: usize,
  outStatesPtr: usize,
): i32 {
  if (nSpecies <= 0 || numOutputs <= 0) return 0;
  ssa_seed(seed);

  const statePtr = heap.alloc(<usize>nSpecies << 3);
  const propPtr = heap.alloc(<usize>(nReactions > 0 ? nReactions : 1) << 3);
  memory.copy(statePtr, initStatePtr, <usize>nSpecies << 3);

  const dtOut = numOutputs > 1 ? (tEnd - t0) / <f64>(numOutputs - 1) : 0.0;
  for (let i: i32 = 0; i < numOutputs; i++) {
    store<f64>(outTimesPtr + (<usize>i << 3), t0 + <f64>i * dtOut);
  }
  // Snapshot 0
  memory.copy(outStatesPtr, statePtr, <usize>nSpecies << 3);

  let nextOutIdx: i32 = 1;
  let t = t0;
  let steps: i32 = 0;

  while (t < tEnd && steps < maxSteps) {
    let a0: f64 = 0.0;
    for (let r: i32 = 0; r < nReactions; r++) {
      const rate = load<f64>(ratesPtr + (<usize>r << 3));
      const rStart = load<i32>(reactRowPtr + (<usize>r << 2));
      const rEnd = load<i32>(reactRowPtr + (<usize>(r + 1) << 2));
      const a = massActionPropensity(rate, rStart, rEnd, reactSpeciesPtr, reactOrderPtr, statePtr);
      store<f64>(propPtr + (<usize>r << 3), a);
      a0 += a;
    }

    if (a0 <= 1e-30) break;

    let u1 = nextUniform();
    if (u1 < 1e-15) u1 = 1e-15;
    const tau = -Math.log(u1) / a0;
    const tNext = t + tau;

    while (nextOutIdx < numOutputs && load<f64>(outTimesPtr + (<usize>nextOutIdx << 3)) < tNext) {
      memory.copy(
        outStatesPtr + (<usize>(nextOutIdx * nSpecies) << 3),
        statePtr,
        <usize>nSpecies << 3,
      );
      nextOutIdx++;
    }

    if (tNext > tEnd) break;
    t = tNext;

    // Select reaction channel
    const target = nextUniform() * a0;
    let accum: f64 = 0.0;
    let chosen: i32 = nReactions - 1;
    for (let r: i32 = 0; r < nReactions; r++) {
      accum += load<f64>(propPtr + (<usize>r << 3));
      if (accum >= target) {
        chosen = r;
        break;
      }
    }

    // Apply stoichiometry update
    const sStart = load<i32>(stoichRowPtr + (<usize>chosen << 2));
    const sEnd = load<i32>(stoichRowPtr + (<usize>(chosen + 1) << 2));
    for (let k = sStart; k < sEnd; k++) {
      const sp = load<i32>(stoichSpeciesPtr + (<usize>k << 2));
      const delta = load<f64>(stoichDeltaPtr + (<usize>k << 3));
      const off = statePtr + (<usize>sp << 3);
      let nv = load<f64>(off) + delta;
      if (nv < 0.0) nv = 0.0;
      store<f64>(off, nv);
    }

    steps++;
  }

  // Fill remaining output snapshots
  while (nextOutIdx < numOutputs) {
    memory.copy(
      outStatesPtr + (<usize>(nextOutIdx * nSpecies) << 3),
      statePtr,
      <usize>nSpecies << 3,
    );
    nextOutIdx++;
  }

  heap.free(statePtr);
  heap.free(propPtr);
  return steps;
}

/**
 * Fixed-step Poisson Tau-Leaping trajectory in WASM linear memory.
 * Returns total leaps executed.
 */
export function ssa_tauLeapTrajectory(
  nSpecies: i32,
  nReactions: i32,
  initStatePtr: usize,
  ratesPtr: usize,
  reactRowPtr: usize,
  reactSpeciesPtr: usize,
  reactOrderPtr: usize,
  stoichRowPtr: usize,
  stoichSpeciesPtr: usize,
  stoichDeltaPtr: usize,
  t0: f64,
  tEnd: f64,
  tau: f64,
  numOutputs: i32,
  seed: u64,
  outTimesPtr: usize,
  outStatesPtr: usize,
): i32 {
  if (nSpecies <= 0 || numOutputs <= 0 || tau <= 0.0) return 0;
  ssa_seed(seed);

  const statePtr = heap.alloc(<usize>nSpecies << 3);
  memory.copy(statePtr, initStatePtr, <usize>nSpecies << 3);

  const dtOut = numOutputs > 1 ? (tEnd - t0) / <f64>(numOutputs - 1) : 0.0;
  for (let i: i32 = 0; i < numOutputs; i++) {
    store<f64>(outTimesPtr + (<usize>i << 3), t0 + <f64>i * dtOut);
  }
  memory.copy(outStatesPtr, statePtr, <usize>nSpecies << 3);

  let nextOutIdx: i32 = 1;
  let t = t0;
  let leaps: i32 = 0;

  while (t < tEnd - 1e-15) {
    const dt = t + tau > tEnd ? tEnd - t : tau;
    for (let r: i32 = 0; r < nReactions; r++) {
      const rate = load<f64>(ratesPtr + (<usize>r << 3));
      const rStart = load<i32>(reactRowPtr + (<usize>r << 2));
      const rEnd = load<i32>(reactRowPtr + (<usize>(r + 1) << 2));
      const a = massActionPropensity(rate, rStart, rEnd, reactSpeciesPtr, reactOrderPtr, statePtr);
      const firings = samplePoisson(a * dt);
      if (firings > 0) {
        const sStart = load<i32>(stoichRowPtr + (<usize>r << 2));
        const sEnd = load<i32>(stoichRowPtr + (<usize>(r + 1) << 2));
        for (let k = sStart; k < sEnd; k++) {
          const sp = load<i32>(stoichSpeciesPtr + (<usize>k << 2));
          const delta = load<f64>(stoichDeltaPtr + (<usize>k << 3));
          const off = statePtr + (<usize>sp << 3);
          let nv = load<f64>(off) + delta * <f64>firings;
          if (nv < 0.0) nv = 0.0;
          store<f64>(off, nv);
        }
      }
    }
    t += dt;
    leaps++;

    while (nextOutIdx < numOutputs && load<f64>(outTimesPtr + (<usize>nextOutIdx << 3)) <= t + 1e-12) {
      memory.copy(
        outStatesPtr + (<usize>(nextOutIdx * nSpecies) << 3),
        statePtr,
        <usize>nSpecies << 3,
      );
      nextOutIdx++;
    }
  }

  while (nextOutIdx < numOutputs) {
    memory.copy(
      outStatesPtr + (<usize>(nextOutIdx * nSpecies) << 3),
      statePtr,
      <usize>nSpecies << 3,
    );
    nextOutIdx++;
  }

  heap.free(statePtr);
  return leaps;
}

/**
 * Radau IIA coupled stage system assembly & LU solve:
 * Assembles W = (I_s ⊗ M) - h * (A_butcher ⊗ J) of dimension (s*n) x (s*n),
 * then solves W * deltaZ = rhs using partial-pivoting LU.
 * If massPtr == 0, uses M = I_n.
 * Returns 1 on success, 0 if singular.
 */
export function radau_assembleAndSolveStage(
  s: i32,
  n: i32,
  h: f64,
  butcherAPtr: usize,
  jacPtr: usize,
  massPtr: usize,
  rhsPtr: usize,
  outDeltaZPtr: usize,
): i32 {
  const sn = s * n;
  if (sn <= 0) return 0;

  const wPtr = heap.alloc(<usize>(sn * sn) << 3);
  const bPtr = heap.alloc(<usize>sn << 3);
  memory.copy(bPtr, rhsPtr, <usize>sn << 3);

  for (let si: i32 = 0; si < s; si++) {
    for (let sj: i32 = 0; sj < s; sj++) {
      const aij = load<f64>(butcherAPtr + (<usize>(si * s + sj) << 3));
      const hAij = h * aij;
      for (let i: i32 = 0; i < n; i++) {
        const row = si * n + i;
        for (let j: i32 = 0; j < n; j++) {
          const col = sj * n + j;
          let val: f64 = -hAij * load<f64>(jacPtr + (<usize>(i * n + j) << 3));
          if (si == sj) {
            if (massPtr != 0) {
              val += load<f64>(massPtr + (<usize>(i * n + j) << 3));
            } else if (i == j) {
              val += 1.0;
            }
          }
          store<f64>(wPtr + (<usize>(row * sn + col) << 3), val);
        }
      }
    }
  }

  // Partial-pivoting Gaussian elimination
  for (let k: i32 = 0; k < sn; k++) {
    let pivotRow = k;
    let pivotVal = Math.abs(load<f64>(wPtr + (<usize>(k * sn + k) << 3)));
    for (let i: i32 = k + 1; i < sn; i++) {
      const v = Math.abs(load<f64>(wPtr + (<usize>(i * sn + k) << 3)));
      if (v > pivotVal) {
        pivotVal = v;
        pivotRow = i;
      }
    }
    if (pivotVal < 1e-15) {
      heap.free(wPtr);
      heap.free(bPtr);
      return 0;
    }
    if (pivotRow != k) {
      for (let j: i32 = k; j < sn; j++) {
        const o1 = wPtr + (<usize>(k * sn + j) << 3);
        const o2 = wPtr + (<usize>(pivotRow * sn + j) << 3);
        const tmp = load<f64>(o1);
        store<f64>(o1, load<f64>(o2));
        store<f64>(o2, tmp);
      }
      const b1 = bPtr + (<usize>k << 3);
      const b2 = bPtr + (<usize>pivotRow << 3);
      const tb = load<f64>(b1);
      store<f64>(b1, load<f64>(b2));
      store<f64>(b2, tb);
    }

    const diag = load<f64>(wPtr + (<usize>(k * sn + k) << 3));
    for (let i: i32 = k + 1; i < sn; i++) {
      const factor = load<f64>(wPtr + (<usize>(i * sn + k) << 3)) / diag;
      store<f64>(wPtr + (<usize>(i * sn + k) << 3), 0.0);
      for (let j: i32 = k + 1; j < sn; j++) {
        const oij = wPtr + (<usize>(i * sn + j) << 3);
        store<f64>(oij, load<f64>(oij) - factor * load<f64>(wPtr + (<usize>(k * sn + j) << 3)));
      }
      const bi = bPtr + (<usize>i << 3);
      store<f64>(bi, load<f64>(bi) - factor * load<f64>(bPtr + (<usize>k << 3)));
    }
  }

  for (let i: i32 = sn - 1; i >= 0; i--) {
    let sum = load<f64>(bPtr + (<usize>i << 3));
    for (let j: i32 = i + 1; j < sn; j++) {
      sum -= load<f64>(wPtr + (<usize>(i * sn + j) << 3)) * load<f64>(outDeltaZPtr + (<usize>j << 3));
    }
    store<f64>(outDeltaZPtr + (<usize>i << 3), sum / load<f64>(wPtr + (<usize>(i * sn + i) << 3)));
  }

  heap.free(wPtr);
  heap.free(bPtr);
  return 1;
}
