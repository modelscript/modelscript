// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for Discrete-State Stochastic Jump Processes
 * (Gillespie Direct SSA, First-Reaction SSA, Adaptive Poisson Tau-Leaping, and Ensemble Moments).
 *
 * Implements zero-GC, flat linear-memory kernels using `usize` pointers (`f64` / `i32` / `u64`):
 * - Xoshiro256++ PRNG seeding (`jump_rng_seed`)
 * - Propensity prefix-sum & reaction selection (`jump_propensity_prefix_sum`,
 *   `jump_select_reaction`, `jump_direct_select_step`, `jump_first_reaction_select`)
 * - Stoichiometry state update & criticality check (`jump_apply_stoichiometry`, `jump_check_critical`)
 * - Cao-Gillespie-Petzold adaptive leap size (`jump_compute_cgp_tau`)
 * - Poisson batch sampling & step-halving tau-leap attempt loop (`jump_sample_poisson_batch`,
 *   `jump_tau_leap_attempt_loop`)
 * - Mass-action combinatorial propensity evaluation & full Gillespie SSA trajectory inner loop
 *   (`jump_eval_mass_action_propensities`, `jump_gillespie_mass_action_trajectory`)
 * - Ensemble trajectory moment aggregation (`jump_ensemble_moments`)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal Linear-Memory Xoshiro256++ PRNG & Poisson Helpers (Zero-GC)
// ─────────────────────────────────────────────────────────────────────────────

const INV_2_53: f64 = 1.1102230246251565e-16; // 2^-53
const TWO_PI: f64 = 6.283185307179586;

@inline
function splitmix64Next(z: u64): u64 {
  let t: u64 = z;
  t = (t ^ (t >> 30)) * (0xbf58476d1ce4e5b9 as u64);
  t = (t ^ (t >> 27)) * (0x94d049bb133111eb as u64);
  return t ^ (t >> 31);
}

/**
 * Seeds a 32-byte (4 x u64) Xoshiro256++ PRNG state buffer at `rngStatePtr`
 * using SplitMix64 expansion from `(seedHi << 32) | seedLo`.
 */
export function jump_rng_seed(rngStatePtr: usize, seedLo: u32, seedHi: u32): void {
  let seed: u64 = ((seedHi as u64) << 32) | (seedLo as u64);
  let z: u64 = seed == 0 ? (0x853c49e6748fea9b as u64) : seed;

  z = z + (0x9e3779b97f4a7c15 as u64);
  store<u64>(rngStatePtr, splitmix64Next(z));

  z = z + (0x9e3779b97f4a7c15 as u64);
  store<u64>(rngStatePtr + 8, splitmix64Next(z));

  z = z + (0x9e3779b97f4a7c15 as u64);
  store<u64>(rngStatePtr + 16, splitmix64Next(z));

  z = z + (0x9e3779b97f4a7c15 as u64);
  store<u64>(rngStatePtr + 24, splitmix64Next(z));
}

@inline
function rngNextU64(rngStatePtr: usize): u64 {
  const s0: u64 = load<u64>(rngStatePtr);
  const s1: u64 = load<u64>(rngStatePtr + 8);
  const s2: u64 = load<u64>(rngStatePtr + 16);
  const s3: u64 = load<u64>(rngStatePtr + 24);

  const sum: u64 = s0 + s3;
  const res: u64 = ((sum << 23) | (sum >> 41)) + s0;
  const t: u64 = s1 << 17;

  let n2: u64 = s2 ^ s0;
  let n3: u64 = s3 ^ s1;
  const n1: u64 = s1 ^ n2;
  const n0: u64 = s0 ^ n3;

  n2 = n2 ^ t;
  n3 = (n3 << 45) | (n3 >> 19);

  store<u64>(rngStatePtr, n0);
  store<u64>(rngStatePtr + 8, n1);
  store<u64>(rngStatePtr + 16, n2);
  store<u64>(rngStatePtr + 24, n3);

  return res;
}

@inline
function rngUniform(rngStatePtr: usize): f64 {
  return ((rngNextU64(rngStatePtr) >> 11) as f64) * INV_2_53;
}

@inline
function rngRandn(rngStatePtr: usize): f64 {
  let u1: f64 = rngUniform(rngStatePtr);
  while (u1 <= 0.0) {
    u1 = rngUniform(rngStatePtr);
  }
  const u2: f64 = rngUniform(rngStatePtr);
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

@inline
function samplePoissonScalar(rngStatePtr: usize, lambda: f64): i32 {
  if (lambda <= 0.0) return 0;
  if (lambda < 30.0) {
    const L: f64 = Math.exp(-lambda);
    let k: i32 = 0;
    let p: f64 = 1.0;
    do {
      k += 1;
      const u: f64 = rngUniform(rngStatePtr);
      p *= u > 1e-16 ? u : 1e-16;
    } while (p > L);
    return k - 1;
  }
  const z: f64 = rngRandn(rngStatePtr);
  const val: f64 = Math.floor(lambda + Math.sqrt(lambda) * z + 0.5);
  return val > 0.0 ? (val as i32) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Propensity Prefix-Sum & Reaction Selection Kernels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes clamped cumulative prefix sums of `propensities[0..m-1]` into `prefixOut[0..m-1]`
 * and returns total propensity `a0`.
 */
export function jump_propensity_prefix_sum(
  m: i32,
  propensitiesPtr: usize,
  prefixOutPtr: usize,
): f64 {
  let cum: f64 = 0.0;
  for (let j: i32 = 0; j < m; j++) {
    const off: usize = (j as usize) << 3;
    const raw: f64 = load<f64>(propensitiesPtr + off);
    const aj: f64 = raw > 0.0 ? raw : 0.0;
    cum += aj;
    store<f64>(prefixOutPtr + off, cum);
  }
  return cum;
}

/**
 * Selects the smallest reaction index `j` in `[0, m - 1]` with `prefix[j] >= threshold`.
 * Uses linear scan for small `m < 16` and binary search for larger networks.
 * Returns `m - 1` if no prefix reaches `threshold`, or `-1` if `m <= 0`.
 */
export function jump_select_reaction(
  m: i32,
  prefixPtr: usize,
  threshold: f64,
): i32 {
  if (m <= 0) return -1;
  if (m < 16) {
    for (let j: i32 = 0; j < m; j++) {
      if (load<f64>(prefixPtr + ((j as usize) << 3)) >= threshold) {
        return j;
      }
    }
    return m - 1;
  }
  let lo: i32 = 0;
  let hi: i32 = m - 1;
  while (lo < hi) {
    const mid: i32 = (lo + hi) >>> 1;
    if (load<f64>(prefixPtr + ((mid as usize) << 3)) >= threshold) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * Gillespie Direct Method reaction step selection:
 * Computes total propensity `a0`, samples waiting time `dt = -ln(u1) / a0` into `outDtPtr`,
 * and selects the firing channel `chosen` with probability `a_j / a0`.
 * Returns `-1` (and writes `Infinity` to `outDtPtr`) if `a0 <= 1e-15`.
 */
export function jump_direct_select_step(
  m: i32,
  propensitiesPtr: usize,
  rngStatePtr: usize,
  outDtPtr: usize,
): i32 {
  if (m <= 0) {
    store<f64>(outDtPtr, Infinity);
    return -1;
  }

  let a0: f64 = 0.0;
  for (let j: i32 = 0; j < m; j++) {
    const off: usize = (j as usize) << 3;
    const raw: f64 = load<f64>(propensitiesPtr + off);
    const aj: f64 = raw > 0.0 ? raw : 0.0;
    store<f64>(propensitiesPtr + off, aj);
    a0 += aj;
  }

  if (a0 <= 1e-15) {
    store<f64>(outDtPtr, Infinity);
    return -1;
  }

  const u1Raw: f64 = rngUniform(rngStatePtr);
  const u1: f64 = u1Raw > 1e-16 ? u1Raw : 1e-16;
  const dt: f64 = -Math.log(u1) / a0;
  store<f64>(outDtPtr, dt);

  const threshold: f64 = rngUniform(rngStatePtr) * a0;
  let cum: f64 = 0.0;
  let chosen: i32 = m - 1;
  for (let j: i32 = 0; j < m; j++) {
    cum += load<f64>(propensitiesPtr + ((j as usize) << 3));
    if (cum >= threshold) {
      chosen = j;
      break;
    }
  }
  return chosen;
}

/**
 * Gillespie First-Reaction Method selection:
 * Draws an exponential putative firing time `tau_j = -ln(u_j) / a_j` for each active channel
 * (`a_j > 1e-15`), writes `minTau` to `outMinTauPtr`, and returns the winning channel index
 * (or `-1` if no reaction is active).
 */
export function jump_first_reaction_select(
  m: i32,
  propensitiesPtr: usize,
  rngStatePtr: usize,
  outMinTauPtr: usize,
): i32 {
  let minTau: f64 = Infinity;
  let chosen: i32 = -1;

  for (let j: i32 = 0; j < m; j++) {
    const aj: f64 = load<f64>(propensitiesPtr + ((j as usize) << 3));
    if (aj > 1e-15) {
      const uRaw: f64 = rngUniform(rngStatePtr);
      const u: f64 = uRaw > 1e-16 ? uRaw : 1e-16;
      const tauJ: f64 = -Math.log(u) / aj;
      if (tauJ < minTau) {
        minTau = tauJ;
        chosen = j;
      }
    }
  }

  store<f64>(outMinTauPtr, minTau);
  return chosen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stoichiometry Update & Adaptive Tau-Leaping Kernels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a stoichiometric state update in place: `state[i] += count * stoichRow[i]` for `i = 0..n-1`.
 */
export function jump_apply_stoichiometry(
  n: i32,
  statePtr: usize,
  stoichRowPtr: usize,
  count: f64,
): void {
  for (let i: i32 = 0; i < n; i++) {
    const off: usize = (i as usize) << 3;
    store<f64>(
      statePtr + off,
      load<f64>(statePtr + off) + count * load<f64>(stoichRowPtr + off),
    );
  }
}

/**
 * Checks whether any active reaction (`propensities[j] > 0`) is critical with respect to
 * threshold `nc` (i.e., `nu[j, i] < 0` and `state[i] < nc * |nu[j, i]|`).
 * `stoichPtr` is a dense row-major `m x n` `f64` matrix.
 * Returns `1` if any critical reaction exists, `0` otherwise.
 */
export function jump_check_critical(
  n: i32,
  m: i32,
  statePtr: usize,
  propensitiesPtr: usize,
  stoichPtr: usize,
  nc: f64,
): i32 {
  for (let j: i32 = 0; j < m; j++) {
    const aj: f64 = load<f64>(propensitiesPtr + ((j as usize) << 3));
    if (aj > 0.0) {
      const rowBase: usize = stoichPtr + (((j * n) as usize) << 3);
      for (let i: i32 = 0; i < n; i++) {
        const off: usize = (i as usize) << 3;
        const nuIJ: f64 = load<f64>(rowBase + off);
        if (nuIJ < 0.0 && load<f64>(statePtr + off) < nc * (-nuIJ)) {
          return 1;
        }
      }
    }
  }
  return 0;
}

/**
 * Computes the Cao-Gillespie-Petzold adaptive leap size `tau <= maxTau` from dense
 * stoichiometry `stoichPtr` (`m x n`), `statePtr` (`n`), and `propensitiesPtr` (`m`),
 * using scratch buffers `muHatPtr` (`n`) and `sigmaSqHatPtr` (`n`).
 */
export function jump_compute_cgp_tau(
  n: i32,
  m: i32,
  statePtr: usize,
  propensitiesPtr: usize,
  stoichPtr: usize,
  eps: f64,
  maxTau: f64,
  muHatPtr: usize,
  sigmaSqHatPtr: usize,
): f64 {
  for (let i: i32 = 0; i < n; i++) {
    const off: usize = (i as usize) << 3;
    store<f64>(muHatPtr + off, 0.0);
    store<f64>(sigmaSqHatPtr + off, 0.0);
  }

  for (let j: i32 = 0; j < m; j++) {
    const aj: f64 = load<f64>(propensitiesPtr + ((j as usize) << 3));
    if (aj <= 0.0) continue;
    const rowBase: usize = stoichPtr + (((j * n) as usize) << 3);
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const v: f64 = load<f64>(rowBase + off);
      if (v != 0.0) {
        store<f64>(muHatPtr + off, load<f64>(muHatPtr + off) + v * aj);
        store<f64>(sigmaSqHatPtr + off, load<f64>(sigmaSqHatPtr + off) + v * v * aj);
      }
    }
  }

  let tau: f64 = maxTau;
  for (let i: i32 = 0; i < n; i++) {
    const off: usize = (i as usize) << 3;
    const xi: f64 = load<f64>(statePtr + off);
    const epsHalfX: f64 = eps * xi * 0.5;
    const bound: f64 = epsHalfX > 1.0 ? epsHalfX : 1.0;
    const absMu: f64 = Math.abs(load<f64>(muHatPtr + off));
    const sigSq: f64 = load<f64>(sigmaSqHatPtr + off);
    if (absMu > 1e-15) {
      const cand: f64 = bound / absMu;
      if (cand < tau) tau = cand;
    }
    if (sigSq > 1e-15) {
      const cand: f64 = (bound * bound) / sigSq;
      if (cand < tau) tau = cand;
    }
  }

  return tau;
}

/**
 * Draws `m` independent Poisson random variates `k_j ~ Poisson(propensities[j] * tau)`
 * into `firingsOutPtr` (`i32[m]`) and returns their sum.
 */
export function jump_sample_poisson_batch(
  m: i32,
  propensitiesPtr: usize,
  tau: f64,
  rngStatePtr: usize,
  firingsOutPtr: usize,
): i32 {
  let total: i32 = 0;
  for (let j: i32 = 0; j < m; j++) {
    const lam: f64 = load<f64>(propensitiesPtr + ((j as usize) << 3)) * tau;
    const kj: i32 = samplePoissonScalar(rngStatePtr, lam);
    store<i32>(firingsOutPtr + ((j as usize) << 2), kj);
    total += kj;
  }
  return total;
}

/**
 * Executes the Poisson tau-leaping step-halving attempt loop (up to `maxHalvings` attempts)
 * to preserve population non-negativity.
 *
 * Writes the resulting species state to `trialStatePtr` (`f64[n]`), sampled channel firings
 * to `firingsOutPtr` (`i32[m]`), and the final leap size to `outTauPtr` (`f64[1]`).
 * Clamps negative species to `0.0` if all `maxHalvings` attempts produce negative populations.
 * Returns `1` if accepted without clamping, `0` if clamped.
 */
export function jump_tau_leap_attempt_loop(
  n: i32,
  m: i32,
  statePtr: usize,
  propensitiesPtr: usize,
  stoichPtr: usize,
  initialTau: f64,
  maxHalvings: i32,
  rngStatePtr: usize,
  trialStatePtr: usize,
  firingsOutPtr: usize,
  outTauPtr: usize,
): i32 {
  let tau: f64 = initialTau;
  let accepted: i32 = 0;

  for (let attempt: i32 = 0; attempt < maxHalvings; attempt++) {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      store<f64>(trialStatePtr + off, load<f64>(statePtr + off));
    }

    for (let j: i32 = 0; j < m; j++) {
      const aj: f64 = load<f64>(propensitiesPtr + ((j as usize) << 3));
      const kj: i32 = samplePoissonScalar(rngStatePtr, aj * tau);
      store<i32>(firingsOutPtr + ((j as usize) << 2), kj);
      if (kj > 0) {
        const kf: f64 = kj as f64;
        const rowBase: usize = stoichPtr + (((j * n) as usize) << 3);
        for (let i: i32 = 0; i < n; i++) {
          const off: usize = (i as usize) << 3;
          store<f64>(
            trialStatePtr + off,
            load<f64>(trialStatePtr + off) + kf * load<f64>(rowBase + off),
          );
        }
      }
    }

    let allNonNeg: bool = true;
    for (let i: i32 = 0; i < n; i++) {
      if (load<f64>(trialStatePtr + ((i as usize) << 3)) < 0.0) {
        allNonNeg = false;
        break;
      }
    }

    if (allNonNeg) {
      accepted = 1;
      break;
    }
    tau *= 0.5;
  }

  if (accepted == 0) {
    for (let i: i32 = 0; i < n; i++) {
      const off: usize = (i as usize) << 3;
      const v: f64 = load<f64>(trialStatePtr + off);
      if (v < 0.0) store<f64>(trialStatePtr + off, 0.0);
    }
  }

  store<f64>(outTauPtr, tau);
  return accepted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mass-Action Propensity Evaluation & Full Gillespie SSA Inner Loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates exact combinatorial mass-action propensities for `m` channels using CSR reactant
 * arrays (`reactRowPtr[m+1]`, `reactSpPtr`, `reactOrdPtr`) and returns total propensity `a0`.
 */
export function jump_eval_mass_action_propensities(
  m: i32,
  statePtr: usize,
  ratesPtr: usize,
  reactRowPtr: usize,
  reactSpPtr: usize,
  reactOrdPtr: usize,
  propensitiesOutPtr: usize,
): f64 {
  let a0: f64 = 0.0;
  for (let j: i32 = 0; j < m; j++) {
    let rate: f64 = load<f64>(ratesPtr + ((j as usize) << 3));
    const rStart: i32 = load<i32>(reactRowPtr + ((j as usize) << 2));
    const rEnd: i32 = load<i32>(reactRowPtr + (((j + 1) as usize) << 2));

    for (let r: i32 = rStart; r < rEnd; r++) {
      const rOff: usize = (r as usize) << 2;
      const sp: i32 = load<i32>(reactSpPtr + rOff);
      const ord: i32 = load<i32>(reactOrdPtr + rOff);
      const x: f64 = load<f64>(statePtr + ((sp as usize) << 3));
      if (x < (ord as f64)) {
        rate = 0.0;
        break;
      }
      if (ord == 1) {
        rate *= x;
      } else if (ord == 2) {
        rate *= 0.5 * x * (x - 1.0);
      } else {
        let comb: f64 = 1.0;
        for (let k: i32 = 0; k < ord; k++) {
          comb *= (x - (k as f64)) / ((k + 1) as f64);
        }
        rate *= comb;
      }
    }

    const aj: f64 = rate > 0.0 ? rate : 0.0;
    store<f64>(propensitiesOutPtr + ((j as usize) << 3), aj);
    a0 += aj;
  }
  return a0;
}

/**
 * Full zero-GC Gillespie Direct Method SSA inner loop in linear memory for mass-action
 * reaction networks with uniform `dtSave` grid recording.
 *
 * Writes recorded times into `outTimesPtr` (`f64[maxOutputs]`), species states into
 * `outStatesPtr` (`f64[maxOutputs * n]`), per-channel firing counts into `outChannelCountsPtr`
 * (`i32[m]`), and the actual number of recorded grid points into `outNumWrittenPtr` (`i32[1]`).
 * Returns `totalReactions`.
 */
export function jump_gillespie_mass_action_trajectory(
  n: i32,
  m: i32,
  initStatePtr: usize,
  ratesPtr: usize,
  reactRowPtr: usize,
  reactSpPtr: usize,
  reactOrdPtr: usize,
  stoichRowPtr: usize,
  stoichSpPtr: usize,
  stoichDelPtr: usize,
  t0: f64,
  tEnd: f64,
  dtSave: f64,
  maxOutputs: i32,
  maxSteps: i32,
  seedLo: u32,
  seedHi: u32,
  outTimesPtr: usize,
  outStatesPtr: usize,
  outChannelCountsPtr: usize,
  outNumWrittenPtr: usize,
  stateWorkPtr: usize,
  propWorkPtr: usize,
  rngStatePtr: usize,
): i32 {
  if (n <= 0 || m <= 0 || maxOutputs <= 0) {
    store<i32>(outNumWrittenPtr, 0);
    return 0;
  }

  jump_rng_seed(rngStatePtr, seedLo, seedHi);

  for (let i: i32 = 0; i < n; i++) {
    const off: usize = (i as usize) << 3;
    const x0: f64 = load<f64>(initStatePtr + off);
    store<f64>(stateWorkPtr + off, x0);
    store<f64>(outStatesPtr + off, x0);
  }
  for (let j: i32 = 0; j < m; j++) {
    store<i32>(outChannelCountsPtr + ((j as usize) << 2), 0);
  }

  store<f64>(outTimesPtr, t0);
  let outIdx: i32 = 1;
  let nextSaveTime: f64 = t0 + dtSave;
  let t: f64 = t0;
  let totalReactions: i32 = 0;

  for (let step: i32 = 0; step < maxSteps && t < tEnd; step++) {
    const a0: f64 = jump_eval_mass_action_propensities(
      m,
      stateWorkPtr,
      ratesPtr,
      reactRowPtr,
      reactSpPtr,
      reactOrdPtr,
      propWorkPtr,
    );

    if (a0 <= 1e-15) {
      while (nextSaveTime <= tEnd + 1e-12 && outIdx < maxOutputs) {
        store<f64>(outTimesPtr + ((outIdx as usize) << 3), nextSaveTime);
        const dstBase: usize = outStatesPtr + (((outIdx * n) as usize) << 3);
        for (let i: i32 = 0; i < n; i++) {
          const off: usize = (i as usize) << 3;
          store<f64>(dstBase + off, load<f64>(stateWorkPtr + off));
        }
        outIdx += 1;
        nextSaveTime += dtSave;
      }
      if (outIdx < maxOutputs && load<f64>(outTimesPtr + (((outIdx - 1) as usize) << 3)) < tEnd - 1e-12) {
        store<f64>(outTimesPtr + ((outIdx as usize) << 3), tEnd);
        const dstBase: usize = outStatesPtr + (((outIdx * n) as usize) << 3);
        for (let i: i32 = 0; i < n; i++) {
          const off: usize = (i as usize) << 3;
          store<f64>(dstBase + off, load<f64>(stateWorkPtr + off));
        }
        outIdx += 1;
      }
      break;
    }

    const u1Raw: f64 = rngUniform(rngStatePtr);
    const u1: f64 = u1Raw > 1e-16 ? u1Raw : 1e-16;
    const dt: f64 = -Math.log(u1) / a0;
    const tNext: f64 = t + dt;

    const lim: f64 = (tNext < tEnd ? tNext : tEnd) + 1e-12;
    while (nextSaveTime <= lim && outIdx < maxOutputs) {
      store<f64>(outTimesPtr + ((outIdx as usize) << 3), nextSaveTime);
      const dstBase: usize = outStatesPtr + (((outIdx * n) as usize) << 3);
      for (let i: i32 = 0; i < n; i++) {
        const off: usize = (i as usize) << 3;
        store<f64>(dstBase + off, load<f64>(stateWorkPtr + off));
      }
      outIdx += 1;
      nextSaveTime += dtSave;
    }

    if (tNext > tEnd) {
      t = tEnd;
      break;
    }

    // Select reaction channel j
    const threshold: f64 = rngUniform(rngStatePtr) * a0;
    let cum: f64 = 0.0;
    let chosen: i32 = m - 1;
    for (let j: i32 = 0; j < m; j++) {
      cum += load<f64>(propWorkPtr + ((j as usize) << 3));
      if (cum >= threshold) {
        chosen = j;
        break;
      }
    }

    // Apply sparse stoichiometric jump
    const sStart: i32 = load<i32>(stoichRowPtr + ((chosen as usize) << 2));
    const sEnd: i32 = load<i32>(stoichRowPtr + (((chosen + 1) as usize) << 2));
    for (let s: i32 = sStart; s < sEnd; s++) {
      const sp: i32 = load<i32>(stoichSpPtr + ((s as usize) << 2));
      const delta: f64 = load<f64>(stoichDelPtr + ((s as usize) << 3));
      const spOff: usize = (sp as usize) << 3;
      store<f64>(stateWorkPtr + spOff, load<f64>(stateWorkPtr + spOff) + delta);
    }

    t = tNext;
    totalReactions += 1;
    const cOff: usize = (chosen as usize) << 2;
    store<i32>(outChannelCountsPtr + cOff, load<i32>(outChannelCountsPtr + cOff) + 1);
  }

  store<i32>(outNumWrittenPtr, outIdx);
  return totalReactions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble Moment Aggregation Kernel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes time-gridded sample mean and unbiased sample variance across `numTrajectories`
 * trajectories stored in flat row-major layout `[r * nTimes * nSpecies + ti * nSpecies + i]`.
 */
export function jump_ensemble_moments(
  numTrajectories: i32,
  nTimes: i32,
  nSpecies: i32,
  trajStatesPtr: usize,
  meanOutPtr: usize,
  varOutPtr: usize,
): void {
  if (numTrajectories <= 0 || nTimes <= 0 || nSpecies <= 0) return;

  const gridSize: i32 = nTimes * nSpecies;
  const invR: f64 = 1.0 / (numTrajectories as f64);
  const invRm1: f64 = numTrajectories > 1 ? 1.0 / ((numTrajectories - 1) as f64) : 0.0;

  for (let idx: i32 = 0; idx < gridSize; idx++) {
    const outOff: usize = (idx as usize) << 3;
    let sum: f64 = 0.0;
    for (let r: i32 = 0; r < numTrajectories; r++) {
      const srcIdx: i32 = r * gridSize + idx;
      sum += load<f64>(trajStatesPtr + ((srcIdx as usize) << 3));
    }
    const mean: f64 = sum * invR;
    store<f64>(meanOutPtr + outOff, mean);

    if (numTrajectories > 1) {
      let sqSum: f64 = 0.0;
      for (let r: i32 = 0; r < numTrajectories; r++) {
        const srcIdx: i32 = r * gridSize + idx;
        const diff: f64 = load<f64>(trajStatesPtr + ((srcIdx as usize) << 3)) - mean;
        sqSum += diff * diff;
      }
      store<f64>(varOutPtr + outOff, sqSum * invRm1);
    } else {
      store<f64>(varOutPtr + outOff, 0.0);
    }
  }
}
