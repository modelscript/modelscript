// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript mathematical & optimization runtime for `@modelscript/ampl-std-lib`.
 *
 * Implements AMPL built-in elementary, transcendental, probability, piecewise-linear,
 * and aggregation functions using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — parameter vector (breakpoints/slopes, mu/sigma, digits, etc.)
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal cached state
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — analytical derivative / sensitivity vector
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — argument & result bus:
 *       IO[0] = x0 (primary arg), IO[1] = x1 (secondary arg), IO[2] = x2, IO[3] = x3,
 *       IO[4] = count (for sum/prod/card/ord), IO[5] = hasX1Flag (1.0 if x1 explicitly provided),
 *       IO[8] = result (primary output), IO[9] = aux1 (CDF / slope / lnGamma / dy_dx0),
 *       IO[10] = aux2 (secondary derivative), IO[11] = status (0.0 = OK, 1.0 = domain error)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `AmplArchetypeId` in ampl-std-schemas.ts)
const ARCH_MATH_ABS: i32 = 1;
const ARCH_MATH_CEIL: i32 = 2;
const ARCH_MATH_FLOOR: i32 = 3;
const ARCH_MATH_ROUND: i32 = 4;
const ARCH_MATH_TRUNC: i32 = 5;
const ARCH_MATH_MOD: i32 = 6;
const ARCH_MATH_DIV: i32 = 7;
const ARCH_MATH_MIN: i32 = 8;
const ARCH_MATH_MAX: i32 = 9;
const ARCH_MATH_EXP: i32 = 10;
const ARCH_MATH_LOG: i32 = 11;
const ARCH_MATH_LOG10: i32 = 12;
const ARCH_MATH_SQRT: i32 = 13;
const ARCH_MATH_SIN: i32 = 14;
const ARCH_MATH_COS: i32 = 15;
const ARCH_MATH_TAN: i32 = 16;
const ARCH_MATH_ATAN2: i32 = 17;
const ARCH_MATH_SINH: i32 = 18;
const ARCH_MATH_COSH: i32 = 19;
const ARCH_MATH_TANH: i32 = 20;

const ARCH_DIST_NORMAL: i32 = 30;
const ARCH_DIST_UNIFORM: i32 = 31;
const ARCH_DIST_EXPONENTIAL: i32 = 32;
const ARCH_DIST_POISSON: i32 = 33;
const ARCH_DIST_BETA: i32 = 34;
const ARCH_DIST_GAMMA: i32 = 35;

const ARCH_OPT_PWL: i32 = 40;
const ARCH_OPT_PRECISION: i32 = 41;
const ARCH_OPT_LESS: i32 = 42;
const ARCH_OPT_SUM: i32 = 43;
const ARCH_OPT_PROD: i32 = 44;
const ARCH_OPT_CARD: i32 = 45;
const ARCH_OPT_ORD: i32 = 46;

const INV_SQRT_2PI: f64 = 0.3989422804014327;
const SQRT_2PI: f64 = 2.5066282746310005;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
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
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Abramowitz & Stegun 7.1.26 rational approximation to erf(x) (max error ~ 1.5e-7).
 */
function erfApprox(x: f64): f64 {
  const sign: f64 = x < 0.0 ? -1.0 : 1.0;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const poly =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const y = 1.0 - poly * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * 9-term Lanczos approximation (g = 7) to ln(Gamma(z)) for Re(z) > 0.
 */
function logGammaPos(z: f64): f64 {
  const zm1 = z - 1.0;
  let x: f64 = 0.99999999999980993;
  x += 676.5203681218851 / (zm1 + 1.0);
  x -= 1259.1392167224028 / (zm1 + 2.0);
  x += 771.32342877765313 / (zm1 + 3.0);
  x -= 176.61502916214059 / (zm1 + 4.0);
  x += 12.507343278686905 / (zm1 + 5.0);
  x -= 0.13857109526572012 / (zm1 + 6.0);
  x += 9.9843695780195716e-6 / (zm1 + 7.0);
  x += 1.5056327351493116e-7 / (zm1 + 8.0);
  const t = zm1 + 7.5;
  return 0.5 * Math.log(2.0 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Lanczos Gamma(z) with Euler reflection formula for z < 0.5.
 */
function gammaLanczos(z: f64): f64 {
  if (z < 0.5) {
    const sinPiZ = Math.sin(Math.PI * z);
    if (Math.abs(sinPiZ) < 1e-15) return NaN;
    return Math.PI / (sinPiZ * Math.exp(logGammaPos(1.0 - z)));
  }
  return Math.exp(logGammaPos(z));
}

function logGammaAbs(z: f64): f64 {
  if (z < 0.5) {
    const sinPiZ = Math.abs(Math.sin(Math.PI * z));
    if (sinPiZ < 1e-15) return NaN;
    return Math.log(Math.PI) - Math.log(sinPiZ) - logGammaPos(1.0 - z);
  }
  return logGammaPos(z);
}

/**
 * Evaluates unanchored k-breakpoint continuous piecewise-linear curve relative to bp_0:
 * `CON[0..k-1]` = sorted breakpoints `[b_1, ..., b_k]` (1 <= k <= 16),
 * `CON[k..2k]`  = segment slopes `[s_0, ..., s_k]`.
 */
function evalPwlRawK(x: f64, slotPtr: usize, conCount: i32, k: i32): f64 {
  const b0 = getCon(slotPtr, conCount, 0, 0.0);
  const s0 = getCon(slotPtr, conCount, k, 1.0);
  if (x < b0) {
    return s0 * (x - b0);
  }
  let acc: f64 = 0.0;
  let prevB = b0;
  for (let i: i32 = 0; i < k; i++) {
    const slope = getCon(slotPtr, conCount, k + 1 + i, s0);
    if (i == k - 1) {
      return acc + slope * (x - prevB);
    }
    const nextB = getCon(slotPtr, conCount, i + 1, prevB);
    if (x <= nextB) {
      return acc + slope * (x - prevB);
    }
    acc += slope * (nextB - prevB);
    prevB = nextB;
  }
  return acc;
}

@inline
function resolveSecondaryArg(slotPtr: usize, conCount: i32, conIdx: i32, fallback: f64): f64 {
  if (getIo(slotPtr, 5) != 0.0) {
    return getIo(slotPtr, 1);
  }
  return getCon(slotPtr, conCount, conIdx, fallback);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function amplGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes an AMPL function slot's state and caches configuration metadata.
 * Returns the number of initialized state slots.
 */
export function amplModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  setState(slotPtr, 0, <f64>archetypeId);
  setState(slotPtr, 1, <f64>conCount);
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);
  setIo(slotPtr, 8, 0.0);
  setIo(slotPtr, 9, 0.0);
  setIo(slotPtr, 10, 0.0);
  setIo(slotPtr, 11, 0.0);
  return 2;
}

/**
 * Evaluates an AMPL cleanroom built-in function archetype on the slot's IO/CON buffers.
 * Writes `result -> IO[8]`, `aux1 -> IO[9]`, `aux2 -> IO[10]`, `status -> IO[11]`,
 * and analytical derivative `dy/dx0 -> DSTATE[0]`. Returns `result`.
 */
export function amplModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  const x0 = getIo(slotPtr, 0);
  let res: f64 = 0.0;
  let aux1: f64 = 0.0;
  let aux2: f64 = 0.0;
  let status: f64 = 0.0;
  let deriv: f64 = 0.0;

  if (archetypeId == ARCH_MATH_ABS) {
    res = Math.abs(x0);
    deriv = x0 > 0.0 ? 1.0 : x0 < 0.0 ? -1.0 : 0.0;
  } else if (archetypeId == ARCH_MATH_CEIL) {
    res = Math.ceil(x0);
  } else if (archetypeId == ARCH_MATH_FLOOR) {
    res = Math.floor(x0);
  } else if (archetypeId == ARCH_MATH_ROUND) {
    const n = Math.trunc(resolveSecondaryArg(slotPtr, conCount, 0, 0.0));
    const factor = Math.pow(10.0, n);
    if (factor > 0.0 && isFinite(factor)) {
      res = Math.round(x0 * factor) / factor;
    } else {
      res = Math.round(x0);
    }
  } else if (archetypeId == ARCH_MATH_TRUNC) {
    const n = Math.trunc(resolveSecondaryArg(slotPtr, conCount, 0, 0.0));
    const factor = Math.pow(10.0, n);
    if (factor > 0.0 && isFinite(factor)) {
      res = Math.trunc(x0 * factor) / factor;
    } else {
      res = Math.trunc(x0);
    }
  } else if (archetypeId == ARCH_MATH_MOD) {
    const b = resolveSecondaryArg(slotPtr, conCount, 0, 1.0);
    if (b == 0.0) {
      res = NaN;
      status = 1.0;
    } else {
      res = x0 - b * Math.floor(x0 / b);
    }
  } else if (archetypeId == ARCH_MATH_DIV) {
    const b = resolveSecondaryArg(slotPtr, conCount, 0, 1.0);
    if (b == 0.0) {
      res = NaN;
      status = 1.0;
    } else {
      res = Math.trunc(x0 / b);
    }
  } else if (archetypeId == ARCH_MATH_MIN) {
    const b = resolveSecondaryArg(slotPtr, conCount, 0, 0.0);
    res = Math.min(x0, b);
    deriv = x0 <= b ? 1.0 : 0.0;
  } else if (archetypeId == ARCH_MATH_MAX) {
    const b = resolveSecondaryArg(slotPtr, conCount, 0, 0.0);
    res = Math.max(x0, b);
    deriv = x0 >= b ? 1.0 : 0.0;
  } else if (archetypeId == ARCH_MATH_EXP) {
    res = Math.exp(x0);
    deriv = res;
  } else if (archetypeId == ARCH_MATH_LOG) {
    if (x0 <= 0.0) {
      res = NaN;
      status = 1.0;
    } else {
      res = Math.log(x0);
      deriv = 1.0 / x0;
    }
  } else if (archetypeId == ARCH_MATH_LOG10) {
    if (x0 <= 0.0) {
      res = NaN;
      status = 1.0;
    } else {
      res = Math.log10(x0);
      deriv = 1.0 / (x0 * Math.LN10);
    }
  } else if (archetypeId == ARCH_MATH_SQRT) {
    if (x0 < 0.0) {
      res = NaN;
      status = 1.0;
    } else {
      res = Math.sqrt(x0);
      deriv = res > 0.0 ? 0.5 / res : 0.0;
    }
  } else if (archetypeId == ARCH_MATH_SIN) {
    res = Math.sin(x0);
    deriv = Math.cos(x0);
  } else if (archetypeId == ARCH_MATH_COS) {
    res = Math.cos(x0);
    deriv = -Math.sin(x0);
  } else if (archetypeId == ARCH_MATH_TAN) {
    res = Math.tan(x0);
    const c = Math.cos(x0);
    deriv = c != 0.0 ? 1.0 / (c * c) : NaN;
  } else if (archetypeId == ARCH_MATH_ATAN2) {
    const x = resolveSecondaryArg(slotPtr, conCount, 0, 1.0);
    res = Math.atan2(x0, x);
    const denom = x0 * x0 + x * x;
    deriv = denom > 0.0 ? x / denom : 0.0;
  } else if (archetypeId == ARCH_MATH_SINH) {
    res = Math.sinh(x0);
    deriv = Math.cosh(x0);
  } else if (archetypeId == ARCH_MATH_COSH) {
    res = Math.cosh(x0);
    deriv = Math.sinh(x0);
  } else if (archetypeId == ARCH_MATH_TANH) {
    res = Math.tanh(x0);
    deriv = 1.0 - res * res;
  } else if (archetypeId == ARCH_DIST_NORMAL) {
    const mu = getCon(slotPtr, conCount, 0, 0.0);
    const sigma = getCon(slotPtr, conCount, 1, 1.0);
    if (sigma <= 0.0) {
      res = NaN;
      aux1 = NaN;
      status = 1.0;
    } else {
      const z = (x0 - mu) / sigma;
      res = (INV_SQRT_2PI / sigma) * Math.exp(-0.5 * z * z); // PDF
      aux1 = 0.5 * (1.0 + erfApprox(z * Math.SQRT1_2)); // CDF
      deriv = -(z / sigma) * res;
    }
  } else if (archetypeId == ARCH_DIST_UNIFORM) {
    const a = getCon(slotPtr, conCount, 0, 0.0);
    const b = getCon(slotPtr, conCount, 1, 1.0);
    if (b <= a) {
      res = NaN;
      aux1 = NaN;
      status = 1.0;
    } else {
      res = x0 >= a && x0 <= b ? 1.0 / (b - a) : 0.0;
      aux1 = x0 <= a ? 0.0 : x0 >= b ? 1.0 : (x0 - a) / (b - a);
    }
  } else if (archetypeId == ARCH_DIST_EXPONENTIAL) {
    const rate = getCon(slotPtr, conCount, 0, 1.0);
    if (rate <= 0.0) {
      res = NaN;
      aux1 = NaN;
      status = 1.0;
    } else if (x0 < 0.0) {
      res = 0.0;
      aux1 = 0.0;
    } else {
      const e = Math.exp(-rate * x0);
      res = rate * e;
      aux1 = 1.0 - e;
      deriv = -rate * res;
    }
  } else if (archetypeId == ARCH_DIST_POISSON) {
    const lam = getCon(slotPtr, conCount, 0, 1.0);
    const k = Math.floor(x0);
    if (lam <= 0.0 || k < 0.0) {
      res = 0.0;
      status = lam <= 0.0 ? 1.0 : 0.0;
    } else {
      res = Math.exp(k * Math.log(lam) - lam - logGammaPos(k + 1.0));
    }
  } else if (archetypeId == ARCH_DIST_BETA) {
    const alpha = getCon(slotPtr, conCount, 0, 2.0);
    const beta = getCon(slotPtr, conCount, 1, 2.0);
    if (alpha <= 0.0 || beta <= 0.0) {
      res = NaN;
      status = 1.0;
    } else if (x0 <= 0.0 || x0 >= 1.0) {
      res = 0.0;
    } else {
      const logB = logGammaPos(alpha) + logGammaPos(beta) - logGammaPos(alpha + beta);
      res = Math.exp((alpha - 1.0) * Math.log(x0) + (beta - 1.0) * Math.log(1.0 - x0) - logB);
    }
  } else if (archetypeId == ARCH_DIST_GAMMA) {
    res = gammaLanczos(x0);
    aux1 = logGammaAbs(x0);
    if (isNaN(res)) {
      status = 1.0;
    }
  } else if (archetypeId == ARCH_OPT_PWL) {
    // Arbitrary-breakpoint continuous piecewise-linear <<b_1, ..., b_k; s_0, ..., s_k>> x
    // Supports 1 <= k <= 16 breakpoints (CON[0..k-1] = breakpoints, CON[k..2k] = slopes),
    // backwards-compatible with 2-breakpoint CON[0..4] = [bp1, bp2, s0, s1, s2].
    const kRaw = conCount >= 3 ? (conCount - 1) >> 1 : 2;
    const k = kRaw < 1 ? 1 : kRaw > 16 ? 16 : kRaw;

    const rawX = evalPwlRawK(x0, slotPtr, conCount, k);
    const raw0 = evalPwlRawK(0.0, slotPtr, conCount, k);
    res = rawX - raw0;

    // Exact left/right slopes and subgradient derivative f'(x)
    const epsBp: f64 = 1e-12;
    let leftSlope = getCon(slotPtr, conCount, k, 1.0);
    let rightSlope = leftSlope;
    let onBreakpoint = false;
    for (let i: i32 = 0; i < k; i++) {
      const bi = getCon(slotPtr, conCount, i, 0.0);
      const sNext = getCon(slotPtr, conCount, k + 1 + i, leftSlope);
      if (Math.abs(x0 - bi) <= epsBp) {
        rightSlope = sNext;
        onBreakpoint = true;
        break;
      }
      if (x0 < bi) {
        rightSlope = leftSlope;
        break;
      }
      leftSlope = sNext;
      rightSlope = sNext;
    }
    aux1 = rightSlope;
    aux2 = leftSlope;
    deriv = onBreakpoint ? 0.5 * (leftSlope + rightSlope) : rightSlope;
  } else if (archetypeId == ARCH_OPT_PRECISION) {
    const sigfigs = Math.max(1.0, Math.floor(resolveSecondaryArg(slotPtr, conCount, 0, 6.0)));
    if (x0 == 0.0 || !isFinite(x0)) {
      res = x0;
    } else {
      const mag = Math.floor(Math.log10(Math.abs(x0)));
      const scale = Math.pow(10.0, sigfigs - 1.0 - mag);
      res = Math.round(x0 * scale) / scale;
    }
  } else if (archetypeId == ARCH_OPT_LESS) {
    const b = resolveSecondaryArg(slotPtr, conCount, 0, 0.0);
    const diff = x0 - b;
    res = diff > 0.0 ? diff : 0.0;
    deriv = diff > 0.0 ? 1.0 : 0.0;
    aux1 = deriv;
  } else if (archetypeId == ARCH_OPT_SUM) {
    const rawCount = <i32>Math.floor(getIo(slotPtr, 4));
    const n = rawCount > 0 ? (rawCount > 4 ? 4 : rawCount) : 4;
    let total: f64 = 0.0;
    for (let i = 0; i < n; i++) {
      total += getIo(slotPtr, i);
    }
    res = total;
    aux1 = <f64>n;
  } else if (archetypeId == ARCH_OPT_PROD) {
    const rawCount = <i32>Math.floor(getIo(slotPtr, 4));
    const n = rawCount > 0 ? (rawCount > 4 ? 4 : rawCount) : 2;
    let prod: f64 = 1.0;
    for (let i = 0; i < n; i++) {
      prod *= getIo(slotPtr, i);
    }
    res = prod;
    aux1 = <f64>n;
  } else if (archetypeId == ARCH_OPT_CARD) {
    const countIn = getIo(slotPtr, 4);
    const c = countIn > 0.0 ? Math.floor(countIn) : Math.max(0.0, Math.floor(x0));
    res = c;
  } else if (archetypeId == ARCH_OPT_ORD) {
    const maxSize = Math.max(1.0, Math.floor(getIo(slotPtr, 4) > 0.0 ? getIo(slotPtr, 4) : getCon(slotPtr, conCount, 0, 1.0)));
    const idx = Math.floor(x0);
    res = idx < 1.0 || idx > maxSize ? 0.0 : idx;
  } else {
    res = NaN;
    status = 1.0;
  }

  setDState(slotPtr, 0, deriv);
  setIo(slotPtr, 8, res);
  setIo(slotPtr, 9, aux1);
  setIo(slotPtr, 10, aux2);
  setIo(slotPtr, 11, status);
  return res;
}

/**
 * Batched zero-copy evaluation across `count` AMPL function descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function amplBatchEval(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    amplModelEval(archetypeId, slotPtr, conCount);
  }
}
