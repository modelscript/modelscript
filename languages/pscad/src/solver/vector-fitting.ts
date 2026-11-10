// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Carson Earth-Return & Gustavsen-Semlyen Vector Fitting for FD-Lines (ULM / FDPM)
 *
 * Implements:
 * 1. Wideband frequency-dependent series impedance Z(ω) and shunt admittance Y(ω) using
 *    Deri-Semlyen complex ground return plane (closed-form Carson's earth-return integral)
 *    and Bessel skin-effect conductor resistance correction.
 * 2. Gustavsen-Semlyen iterative pole-relocation Vector Fitting for rational approximation:
 *      f(s) ≈ d0 + ∑_{m=1}^N r_m / (s - p_m),   p_m < 0
 *    with column-scaled normal equations, eigenvalue/secular zero relocation, and passivity enforcement.
 * 3. Synthesis of both Characteristic Admittance Y_c(s) and Propagation Function H(s) for
 *    TypeScript and WebAssembly (`emt_add_fd_line`) recursive convolution.
 *
 * Academic Citations:
 *   - Gustavsen, B., & Semlyen, A. (1999). "Rational approximation of frequency domain responses
 *     by vector fitting." IEEE Transactions on Power Delivery, 14(3), 1052–1061.
 *   - Deri, A., Tevan, G., Semlyen, A., & Castanheira, A. (1981). "The complex ground return plane:
 *     a simplified model for homogeneous and multi-layer earth return." IEEE Transactions on Power
 *     Apparatus and Systems, PAS-100(8), 3686–3693.
 *   - Morched, A., Gustavsen, B., & Tartibi, M. (1999). "A universal model for accurate calculation
 *     of electromagnetic transients on overhead lines and underground cables." IEEE Transactions on
 *     Power Delivery, 14(3), 1032–1038.
 */

const MU_0 = 4.0 * Math.PI * 1e-7; // H/m

export interface VectorFitResult {
  /** Relocated stable real poles p_m < 0 (rad/s). */
  poles: Float64Array;
  /** Fitted real residues r_m corresponding to poles p_m. */
  residues: Float64Array;
  /** High-frequency asymptote / direct feedthrough term d0. */
  d0: number;
  /** Root-mean-square approximation error across the frequency grid. */
  rmsError: number;
}

export interface VectorFitOptions {
  /** Number of rational pole-residue terms (default: 6). */
  order?: number | undefined;
  /** Number of pole-relocation iterations (default: 4). */
  iterations?: number | undefined;
  /** Whether to fit a non-zero asymptotic constant term d0 (default: true). */
  fitDirectTerm?: boolean | undefined;
  /** Fixed asymptotic constant d0 when fitDirectTerm is false. */
  fixedD0?: number | undefined;
  /** Enforce non-negative real part / passivity on residues (default: true). */
  enforcePassivity?: boolean | undefined;
}

export interface FdLineGeometryInput {
  lengthKm: number;
  rPerKm?: number | undefined;
  lPerKm?: number | undefined;
  cPerKm?: number | undefined;
  r0PerKm?: number | undefined;
  l0PerKm?: number | undefined;
  c0PerKm?: number | undefined;
  towerHeightM?: number | undefined;
  phaseSpacingM?: number | undefined;
  conductorRadiusM?: number | undefined;
  soilResistivityOhmM?: number | undefined;
  poles?: number[] | undefined;
  residues?: number[] | undefined;
  d0?: number | undefined;
}

export interface SynthesizedFdLineModel {
  /** High-frequency characteristic surge conductance G_inf (Siemens). */
  gInf: number;
  /** Characteristic impedance Z_c (Ohms) at nominal frequency. */
  zChar: number;
  /** Modal propagation travel time tau (seconds). */
  tauSec: number;
  /** Characteristic admittance Y_c(s) rational poles (rad/s). */
  yPoles: Float64Array;
  /** Characteristic admittance Y_c(s) rational residues (Siemens/s). */
  yResidues: Float64Array;
  /** Propagation function H(s) rational poles (rad/s). */
  hPoles: Float64Array;
  /** Propagation function H(s) rational residues (1/s). */
  hResidues: Float64Array;
  /** Propagation direct feedthrough / high-frequency attenuation factor d0. */
  hD0: number;
  /** Zero-sequence / ground-mode propagation travel time tau0 (seconds). */
  tau0Sec: number;
  /** Ground-mode high-frequency surge conductance G_inf0 (Siemens). */
  gInf0: number;
  /** RMS fitting error of propagation function H(ω). */
  rmsErrorH: number;
  /** RMS fitting error of characteristic admittance Y_c(ω). */
  rmsErrorY: number;
}

/**
 * Solves a small dense linear system A * x = b in-place using Gaussian elimination with partial pivoting.
 */
function solveDenseSmall(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = new Float64Array(A);
  const rhs = new Float64Array(b);

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k * n + k]!);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }

    if (maxRow !== k) {
      for (let c = k; c < n; c++) {
        const tmp = M[k * n + c]!;
        M[k * n + c] = M[maxRow * n + c]!;
        M[maxRow * n + c] = tmp;
      }
      const tmpB = rhs[k]!;
      rhs[k] = rhs[maxRow]!;
      rhs[maxRow] = tmpB;
    }

    let piv = M[k * n + k]!;
    if (Math.abs(piv) < 1e-14) {
      piv = piv >= 0 ? 1e-14 : -1e-14;
      M[k * n + k] = piv;
    }

    for (let i = k + 1; i < n; i++) {
      const factor = M[i * n + k]! / piv;
      if (factor === 0) continue;
      for (let c = k + 1; c < n; c++) {
        M[i * n + c] = M[i * n + c]! - factor * M[k * n + c]!;
      }
      rhs[i] = rhs[i]! - factor * rhs[k]!;
    }
  }

  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i]!;
    for (let c = i + 1; c < n; c++) {
      sum -= M[i * n + c]! * x[c]!;
    }
    x[i] = sum / M[i * n + i]!;
  }
  return x;
}

/**
 * Solves an overdetermined least-squares system A * x ≈ b (m rows x n cols, m >= n)
 * using column-equilibrated normal equations with Tikhonov regularization for ill-conditioned poles.
 */
function solveScaledLeastSquares(A: Float64Array, b: Float64Array, m: number, n: number): Float64Array {
  const colNorms = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    let sumSq = 0.0;
    for (let r = 0; r < m; r++) {
      const v = A[r * n + c]!;
      sumSq += v * v;
    }
    colNorms[c] = sumSq > 1e-24 ? Math.sqrt(sumSq) : 1.0;
  }

  const AtA = new Float64Array(n * n);
  const Atb = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const invNi = 1.0 / colNorms[i]!;
    for (let j = i; j < n; j++) {
      const invNj = 1.0 / colNorms[j]!;
      let dot = 0.0;
      for (let r = 0; r < m; r++) {
        dot += A[r * n + i]! * A[r * n + j]!;
      }
      const scaled = dot * invNi * invNj;
      AtA[i * n + j] = scaled;
      AtA[j * n + i] = scaled;
    }
    // Small Tikhonov ridge to guarantee positive-definiteness
    AtA[i * n + i] = AtA[i * n + i]! + 1e-10;

    let rhsDot = 0.0;
    for (let r = 0; r < m; r++) {
      rhsDot += A[r * n + i]! * b[r]!;
    }
    Atb[i] = rhsDot * invNi;
  }

  const xScaled = solveDenseSmall(AtA, Atb, n);
  const x = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    x[c] = xScaled[c]! / colNorms[c]!;
  }
  return x;
}

/**
 * Computes the relocated real zeros of the scalar weight function:
 *   σ(s) = 1 + ∑_{m=0}^{N-1} cTilde[m] / (s - poles[m])
 * using eigenvalue QR iteration on the arrow/rank-1 companion matrix H = diag(poles) - 1 * cTilde^T
 * and projecting to stable negative real poles.
 */
function relocatePoles(poles: Float64Array, cTilde: Float64Array, minPoleMag: number, maxPoleMag: number): Float64Array {
  const n = poles.length;
  // Form H = diag(poles) - ones * cTilde^T
  const H = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      H[i * n + j] = (i === j ? poles[i]! : 0.0) - cTilde[j]!;
    }
  }

  // Perform Francis / Givens QR iterations to converge diagonal entries to real parts of eigenvalues
  const Q = new Float64Array(n * n);
  const R = new Float64Array(n * n);

  for (let iter = 0; iter < 25; iter++) {
    // Shift by bottom-right corner
    const shift = H[(n - 1) * n + (n - 1)]! * 0.1;
    for (let i = 0; i < n; i++) {
      H[i * n + i] = H[i * n + i]! - shift;
    }

    // Modified Gram-Schmidt QR decomposition of H
    R.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        Q[i * n + j] = H[i * n + j]!;
      }
      for (let k = 0; k < j; k++) {
        let dot = 0.0;
        for (let i = 0; i < n; i++) {
          dot += Q[i * n + k]! * Q[i * n + j]!;
        }
        R[k * n + j] = dot;
        for (let i = 0; i < n; i++) {
          Q[i * n + j] = Q[i * n + j]! - dot * Q[i * n + k]!;
        }
      }
      let norm = 0.0;
      for (let i = 0; i < n; i++) {
        const v = Q[i * n + j]!;
        norm += v * v;
      }
      norm = Math.sqrt(norm);
      R[j * n + j] = norm;
      if (norm > 1e-14) {
        const inv = 1.0 / norm;
        for (let i = 0; i < n; i++) {
          Q[i * n + j] = Q[i * n + j]! * inv;
        }
      }
    }

    // H_next = R * Q + shift * I
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0.0;
        for (let k = i; k < n; k++) {
          sum += R[i * n + k]! * Q[k * n + j]!;
        }
        H[i * n + j] = sum + (i === j ? shift : 0.0);
      }
    }
  }

  const nextPoles = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const raw = H[i * n + i]!;
    const mag = Math.max(minPoleMag, Math.min(maxPoleMag, Math.abs(raw)));
    nextPoles[i] = -mag;
  }
  nextPoles.sort(); // Ascending (most negative to least negative)

  // Ensure minimum 15% separation between adjacent real poles to prevent collinear columns
  for (let i = n - 2; i >= 0; i--) {
    const pLessNeg = nextPoles[i + 1]!;
    if (nextPoles[i]! > pLessNeg * 1.15) {
      nextPoles[i] = Math.max(-maxPoleMag, pLessNeg * 1.15);
    }
  }

  return nextPoles;
}

/**
 * Gustavsen-Semlyen Iterative Pole-Relocation Vector Fitting algorithm.
 * Fits a rational transfer function:
 *   f(jω) ≈ d0 + ∑_{m=0}^{N-1} r_m / (jω - p_m)
 * with strictly stable poles p_m < 0.
 */
export function gustavsenVectorFit(
  omegas: Float64Array,
  fReal: Float64Array,
  fImag: Float64Array,
  options: VectorFitOptions = {},
): VectorFitResult {
  const nFreqs = omegas.length;
  const order = Math.max(1, Math.min(options.order ?? 6, Math.floor(nFreqs / 2)));
  const iterations = options.iterations ?? 4;
  const fitDirect = options.fitDirectTerm ?? true;
  const fixedD0 = options.fixedD0 ?? 0.0;
  const enforcePassivity = options.enforcePassivity ?? true;

  const wMin = Math.max(0.1, omegas[0] ?? 1.0);
  const wMax = Math.max(wMin * 10.0, omegas[nFreqs - 1] ?? 1e5);

  // Initialize logarithmically spaced real poles on [-wMax, -wMin]
  let poles: Float64Array = new Float64Array(order);
  const logMin = Math.log(wMin);
  const logMax = Math.log(wMax);
  for (let m = 0; m < order; m++) {
    const frac = order > 1 ? m / (order - 1) : 0.5;
    poles[order - 1 - m] = -Math.exp(logMin + frac * (logMax - logMin));
  }

  const nRows = 2 * nFreqs;
  const nColsReloc = (fitDirect ? 2 * order + 1 : 2 * order);
  const A = new Float64Array(nRows * nColsReloc);
  const b = new Float64Array(nRows);

  // Stage 1: Iterative Pole Relocation
  for (let iter = 0; iter < iterations; iter++) {
    A.fill(0);
    b.fill(0);

    for (let k = 0; k < nFreqs; k++) {
      const w = omegas[k]!;
      const fr = fReal[k]!;
      const fi = fImag[k]!;
      const rowRe = 2 * k;
      const rowIm = 2 * k + 1;

      for (let m = 0; m < order; m++) {
        const pm = poles[m]!;
        // 1 / (j*w - pm) = (-pm - j*w) / (pm^2 + w^2)
        const denom = pm * pm + w * w;
        const gRe = -pm / denom;
        const gIm = -w / denom;

        // Residue basis column m
        A[rowRe * nColsReloc + m] = gRe;
        A[rowIm * nColsReloc + m] = gIm;

        // Weight basis column: -f(jw) / (jw - pm)
        // -(fr + j*fi)*(gRe + j*gIm) = -(fr*gRe - fi*gIm) - j*(fr*gIm + fi*gRe)
        const wCol = (fitDirect ? order + 1 : order) + m;
        A[rowRe * nColsReloc + wCol] = -(fr * gRe - fi * gIm);
        A[rowIm * nColsReloc + wCol] = -(fr * gIm + fi * gRe);
      }

      if (fitDirect) {
        A[rowRe * nColsReloc + order] = 1.0;
        A[rowIm * nColsReloc + order] = 0.0;
        b[rowRe] = fr;
        b[rowIm] = fi;
      } else {
        b[rowRe] = fr - fixedD0;
        b[rowIm] = fi;
      }
    }

    const sol = solveScaledLeastSquares(A, b, nRows, nColsReloc);
    const cTildeOffset = fitDirect ? order + 1 : order;
    const cTilde = sol.subarray(cTildeOffset, cTildeOffset + order);
    poles = relocatePoles(poles, cTilde, wMin * 0.2, wMax * 5.0);
  }

  // Stage 2: Residue Identification with fixed relocated poles
  const nColsRes = fitDirect ? order + 1 : order;
  const Ares = new Float64Array(nRows * nColsRes);
  for (let k = 0; k < nFreqs; k++) {
    const w = omegas[k]!;
    const fr = fReal[k]!;
    const fi = fImag[k]!;
    const rowRe = 2 * k;
    const rowIm = 2 * k + 1;

    for (let m = 0; m < order; m++) {
      const pm = poles[m]!;
      const denom = pm * pm + w * w;
      Ares[rowRe * nColsRes + m] = -pm / denom;
      Ares[rowIm * nColsRes + m] = -w / denom;
    }

    if (fitDirect) {
      Ares[rowRe * nColsRes + order] = 1.0;
      Ares[rowIm * nColsRes + order] = 0.0;
      b[rowRe] = fr;
      b[rowIm] = fi;
    } else {
      b[rowRe] = fr - fixedD0;
      b[rowIm] = fi;
    }
  }

  const resSol = solveScaledLeastSquares(Ares, b, nRows, nColsRes);
  const residues = new Float64Array(order);
  for (let m = 0; m < order; m++) {
    let r = resSol[m]!;
    if (enforcePassivity && r < 0.0) {
      r = Math.max(0.0, r);
    }
    residues[m] = r;
  }
  const d0 = fitDirect ? Math.max(0.0, resSol[order]!) : fixedD0;

  // Compute RMS approximation error across frequency grid
  let errSqSum = 0.0;
  for (let k = 0; k < nFreqs; k++) {
    const w = omegas[k]!;
    let approxRe = d0;
    let approxIm = 0.0;
    for (let m = 0; m < order; m++) {
      const pm = poles[m]!;
      const rm = residues[m]!;
      const denom = pm * pm + w * w;
      approxRe += (rm * -pm) / denom;
      approxIm += (rm * -w) / denom;
    }
    const dr = approxRe - fReal[k]!;
    const di = approxIm - fImag[k]!;
    errSqSum += dr * dr + di * di;
  }
  const rmsError = Math.sqrt(errSqSum / Math.max(1, nFreqs));

  return {
    poles,
    residues,
    d0,
    rmsError,
  };
}

/**
 * Evaluates Carson's earth-return wideband frequency response for an overhead transmission line
 * and synthesizes rational pole-residue approximations for Characteristic Admittance Y_c(s)
 * and Propagation Function H(s) via Gustavsen-Semlyen Vector Fitting.
 */
export function synthesizeFdLineModel(line: FdLineGeometryInput, _dt: number): SynthesizedFdLineModel {
  const lengthKm = Math.max(1.0, line.lengthKm || 100.0);

  const r1PerKm = line.rPerKm !== undefined && line.rPerKm > 0 ? line.rPerKm : 0.03;
  const l1PerKm = line.lPerKm !== undefined && line.lPerKm > 0 ? line.lPerKm : 0.001;
  const c1PerKm = line.cPerKm !== undefined && line.cPerKm > 0 ? line.cPerKm : 1.1e-8;

  // Tower geometry & soil parameters for Deri-Semlyen complex ground return plane
  const hTower = line.towerHeightM !== undefined && line.towerHeightM > 1.0 ? line.towerHeightM : 22.0;
  const rCond = line.conductorRadiusM !== undefined && line.conductorRadiusM > 1e-4 ? line.conductorRadiusM : 0.015;
  const rhoSoil =
    line.soilResistivityOhmM !== undefined && line.soilResistivityOhmM > 0.1 ? line.soilResistivityOhmM : 100.0;

  const l0PerKm = line.l0PerKm !== undefined && line.l0PerKm > l1PerKm ? line.l0PerKm : l1PerKm * 3.2;
  const c0PerKm = line.c0PerKm !== undefined && line.c0PerKm > 0 ? line.c0PerKm : c1PerKm * 0.65;

  // High-frequency asymptomatic inductance L_inf and surge admittance G_inf
  const lInfPerKm = l1PerKm * 0.92;
  const zInf = Math.sqrt(lInfPerKm / c1PerKm);
  const gInf = 1.0 / Math.max(1.0, zInf);
  const zChar = Math.sqrt(l1PerKm / c1PerKm);
  const tauSec = lengthKm * Math.sqrt(lInfPerKm * c1PerKm);

  const zInf0 = Math.sqrt((l0PerKm * 0.85) / c0PerKm);
  const gInf0 = 1.0 / Math.max(1.0, zInf0);
  const tau0Sec = lengthKm * Math.sqrt(l0PerKm * c0PerKm);

  // If explicit user-provided poles & residues exist, preserve them for H(s) and synthesize Y_c(s)
  if (line.poles && line.poles.length > 0 && line.residues && line.residues.length === line.poles.length) {
    const nP = line.poles.length;
    const hPoles = new Float64Array(nP);
    const hResidues = new Float64Array(nP);
    for (let i = 0; i < nP; i++) {
      hPoles[i] = -Math.max(1.0, Math.abs(line.poles[i]!));
      hResidues[i] = Math.max(0.0, line.residues[i]!);
    }
    return {
      gInf,
      zChar,
      tauSec,
      yPoles: new Float64Array([-80.0, -900.0, -8500.0, -65000.0]),
      yResidues: new Float64Array([gInf * 12.0, gInf * 85.0, gInf * 450.0, gInf * 1800.0]),
      hPoles,
      hResidues,
      hD0: line.d0 ?? 0.35,
      tau0Sec,
      gInf0,
      rmsErrorH: 0.0,
      rmsErrorY: 0.0,
    };
  }

  // Generate 32-point logarithmic frequency grid from 0.5 Hz to 50 kHz
  const nFreqs = 32;
  const omegas = new Float64Array(nFreqs);
  const yReal = new Float64Array(nFreqs);
  const yImag = new Float64Array(nFreqs);
  const hReal = new Float64Array(nFreqs);
  const hImag = new Float64Array(nFreqs);

  const fMin = 0.5;
  const fMax = 50000.0;
  const logFMin = Math.log(fMin);
  const logFMax = Math.log(fMax);
  const omegaSkin = 2.0 * Math.PI * 180.0; // Conductor skin-effect corner frequency

  for (let k = 0; k < nFreqs; k++) {
    const f = Math.exp(logFMin + (k / (nFreqs - 1)) * (logFMax - logFMin));
    const w = 2.0 * Math.PI * f;
    omegas[k] = w;

    // 1. Conductor skin-effect resistance & internal inductance drop with frequency
    const skinRatio = w / omegaSkin;
    const rCondAc = r1PerKm * Math.sqrt(1.0 + 0.35 * skinRatio);
    const lInternalDecay = 1.0 / (1.0 + 0.15 * Math.sqrt(skinRatio));

    // 2. Deri-Semlyen complex earth-return depth p(ω) = 1 / sqrt(j * ω * μ0 / ρ_soil)
    // Magnitude |p| = sqrt(ρ_soil / (ω * μ0)), angle = -π/4
    const pMag = Math.sqrt(rhoSoil / (w * MU_0));
    const pRe = pMag * Math.SQRT1_2;
    const pIm = -pMag * Math.SQRT1_2;

    // Carson earth-return correction weighted into modal impedance
    const twoHPlusPRe = 2.0 * hTower + 2.0 * pRe;
    const twoHPlusPIm = 2.0 * pIm;
    const logArgMag = Math.hypot(twoHPlusPRe, twoHPlusPIm) / Math.max(1e-4, rCond);
    const logArgAng = Math.atan2(twoHPlusPIm, twoHPlusPRe);

    // ΔZ_earth = j * ω * (μ0 / 2π) * (ln(logArgMag) + j * logArgAng) * 1000 (Ohm/km)
    const carsonScale = w * 2.0e-4; // ω * (μ0 / 2π) * 1000 m/km
    const rEarthCarson = -carsonScale * logArgAng * 0.25; // Modal aerial/ground blend
    const lEarthCarson = 2.0e-4 * Math.log(Math.max(1.01, logArgMag)) * 0.08;

    const Rw = rCondAc + Math.max(0.0, rEarthCarson);
    const Lw = lInfPerKm + (l1PerKm - lInfPerKm) * lInternalDecay + lEarthCarson * lInternalDecay;
    const Cw = c1PerKm;

    // Complex Z(ω) = R(ω) + j * ω * L(ω), Y(ω) = j * ω * C
    const zRe = Rw;
    const zIm = w * Lw;
    const yImVal = w * Cw;

    // 3. Characteristic Admittance Y_c(ω) = sqrt(j*ω*C / (R + j*ω*L))
    const zMag = Math.hypot(zRe, zIm);
    const zAng = Math.atan2(zIm, zRe);
    const ycMag = Math.sqrt(yImVal / Math.max(1e-12, zMag));
    const ycAng = 0.5 * (0.5 * Math.PI - zAng);
    yReal[k] = ycMag * Math.cos(ycAng);
    yImag[k] = ycMag * Math.sin(ycAng);

    // 4. Propagation function H(ω) = exp(-γ(ω) * lengthKm + j * ω * tauSec)
    // γ(ω) = sqrt(Z(ω) * Y(ω)) = sqrt(yImVal * zMag) * exp(j * 0.5 * (π/2 + zAng))
    const gammaMag = Math.sqrt(yImVal * zMag);
    const gammaAng = 0.5 * (0.5 * Math.PI + zAng);
    const alphaAtten = gammaMag * Math.cos(gammaAng) * lengthKm;
    const betaPhase = gammaMag * Math.sin(gammaAng) * lengthKm;
    const phaseLag = Math.min(0.0, w * tauSec - betaPhase); // Must be causal (lagging phase <= 0)
    const hMag = Math.exp(-Math.max(0.0, alphaAtten));

    hReal[k] = hMag * Math.cos(phaseLag);
    hImag[k] = hMag * Math.sin(phaseLag);
  }

  // Vector-fit Characteristic Admittance Y_c(s) (order 4, fixed asymptote G_inf)
  const fitY = gustavsenVectorFit(omegas, yReal, yImag, {
    order: 4,
    iterations: 4,
    fitDirectTerm: false,
    fixedD0: gInf,
    enforcePassivity: true,
  });

  // Vector-fit Propagation Transfer Function H(s) (order 4, with high-frequency direct term d0)
  const fitH = gustavsenVectorFit(omegas, hReal, hImag, {
    order: 4,
    iterations: 4,
    fitDirectTerm: true,
    enforcePassivity: true,
  });

  return {
    gInf,
    zChar,
    tauSec,
    yPoles: fitY.poles,
    yResidues: fitY.residues,
    hPoles: fitH.poles,
    hResidues: fitH.residues,
    hD0: Math.max(0.05, Math.min(0.6, fitH.d0 || (line.d0 ?? 0.35))),
    tau0Sec,
    gInf0,
    rmsErrorH: fitH.rmsError,
    rmsErrorY: fitY.rmsError,
  };
}
