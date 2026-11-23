// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Bateman Isotope Depletion & Decay-Heat Solver.
 *
 * Solves the linear Bateman ODE system:
 *   dN/dt = A(phi) * N
 *   A_ii  = -(lambda_i + sigma_a,i * phi)
 *   A_ij  = lambda_{j->i} + sigma_{c,j->i} * phi + gamma_{j->i} * sigma_{f,j} * phi
 *
 * Supports:
 *   - "expm": Padé [6/6] scaling-and-squaring matrix exponential (unconditionally stable, near machine precision)
 *   - "rk4":  Classic 4th-order Runge-Kutta with adaptive sub-stepping for stiff chains
 */

import {
  BARN_TO_CM2,
  SCALE_NUCLIDE_DATA,
  normalizeNuclideId,
  type ScaleNuclideRecord,
} from "../catalog/scale-std-schemas.js";
import type { OrigenCase, ScaleDeck } from "../types.js";

const MEV_TO_JOULES = 1.602176634e-13;
const AVOGADRO = 6.02214076e23;

export type BatemanMethod = "expm" | "rk4";

export interface BatemanChainSpec {
  /** Initial atom inventories keyed by nuclide ID (e.g. "I-135", "Xe-135", "U-235") */
  initialAtoms: Record<string, number>;
  /** Evaluation time points in seconds (monotonically increasing, starting > 0 or >= 0) */
  timesSec: number[];
  /** Constant or piecewise-constant thermal neutron flux in n/(cm^2*s) per interval */
  flux: number | number[];
  /** Integration method: "expm" (default) or "rk4" */
  method?: BatemanMethod | undefined;
  /** Optional custom nuclide data overrides */
  nuclideOverrides?: Record<string, Partial<ScaleNuclideRecord>> | undefined;
  /** Optional number of RK4 sub-steps per interval */
  rk4SubSteps?: number | undefined;
}

export interface BatemanStepResult {
  timeSec: number;
  atoms: Record<string, number>;
  decayHeatWatts: number;
  totalActivityBq: number;
}

export interface BatemanSolution {
  nuclides: string[];
  method: BatemanMethod;
  steps: BatemanStepResult[];
  finalAtoms: Record<string, number>;
  finalDecayHeatWatts: number;
  finalActivityBq: number;
}

function getNuclideRecord(id: string, overrides?: Record<string, Partial<ScaleNuclideRecord>>): ScaleNuclideRecord {
  const norm = normalizeNuclideId(id);
  const base = SCALE_NUCLIDE_DATA[norm] ?? {
    id: norm,
    zaid: 0,
    atomicMass: 235.0,
    halfLifeSec: Number.POSITIVE_INFINITY,
    decayConstant: 0.0,
    sigmaAbsorptionBarns: 0.0,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 0.0,
    decayEnergyMeV: 0.0,
  };
  const ov = overrides?.[norm] ?? overrides?.[id];
  return ov ? { ...base, ...ov, id: norm } : base;
}

/**
 * Expands the set of nuclides to include decay daughters, capture products, and U-235 fission products
 * reachable from the initial inventory.
 */
export function expandNuclideNetwork(
  initialIds: string[],
  includeFissionProducts: boolean,
  overrides?: Record<string, Partial<ScaleNuclideRecord>>,
): string[] {
  const seen = new Set<string>();
  const queue: string[] = [];

  const enqueue = (rawId: string) => {
    const id = normalizeNuclideId(rawId);
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  };

  for (const id of initialIds) enqueue(id);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const rec = getNuclideRecord(cur, overrides);
    if (rec.decayDaughter) enqueue(rec.decayDaughter);
    if (rec.captureProduct) enqueue(rec.captureProduct);
    if (includeFissionProducts && cur === "U-235") {
      for (const fp of Object.values(SCALE_NUCLIDE_DATA)) {
        if (fp.u235FissionYield && fp.u235FissionYield > 0) {
          enqueue(fp.id);
        }
      }
    }
  }

  return Array.from(seen);
}

/**
 * Builds the dense n x n Bateman transition matrix A(phi) in row-major order.
 */
export function buildBatemanMatrix(
  nuclides: string[],
  flux: number,
  overrides?: Record<string, Partial<ScaleNuclideRecord>>,
): Float64Array {
  const n = nuclides.length;
  const idxMap = new Map<string, number>();
  for (let i = 0; i < n; i++) idxMap.set(nuclides[i]!, i);

  const A = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const rec = getNuclideRecord(nuclides[j]!, overrides);
    const lossRate = rec.decayConstant + rec.sigmaAbsorptionBarns * BARN_TO_CM2 * flux;
    A[j * n + j] = -lossRate;

    // Radioactive decay to daughter
    if (rec.decayDaughter && idxMap.has(rec.decayDaughter)) {
      const i = idxMap.get(rec.decayDaughter)!;
      A[i * n + j] = (A[i * n + j] ?? 0) + rec.decayConstant;
    }

    // Neutron capture product
    if (flux > 0 && rec.captureProduct && idxMap.has(rec.captureProduct)) {
      const i = idxMap.get(rec.captureProduct)!;
      A[i * n + j] = (A[i * n + j] ?? 0) + rec.sigmaCaptureBarns * BARN_TO_CM2 * flux;
    }

    // Direct U-235 fission product yields
    if (flux > 0 && rec.id === "U-235" && rec.sigmaFissionBarns > 0) {
      const fissionRate = rec.sigmaFissionBarns * BARN_TO_CM2 * flux;
      for (let i = 0; i < n; i++) {
        const target = getNuclideRecord(nuclides[i]!, overrides);
        if (target.u235FissionYield && target.u235FissionYield > 0) {
          A[i * n + j] = (A[i * n + j] ?? 0) + target.u235FissionYield * fissionRate;
        }
      }
    }
  }
  return A;
}

// ── Dense Matrix Operations for Padé [6/6] Matrix Exponential ────────────────

function matMul(A: Float64Array, B: Float64Array, n: number): Float64Array {
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const iOff = i * n;
    for (let k = 0; k < n; k++) {
      const aik = A[iOff + k]!;
      if (aik === 0) continue;
      const kOff = k * n;
      for (let j = 0; j < n; j++) {
        C[iOff + j] = C[iOff + j]! + aik * B[kOff + j]!;
      }
    }
  }
  return C;
}

function matVecMul(A: Float64Array, x: Float64Array, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const iOff = i * n;
    for (let j = 0; j < n; j++) {
      s += A[iOff + j]! * x[j]!;
    }
    y[i] = s;
  }
  return y;
}

function matInfNorm(A: Float64Array, n: number): number {
  let maxRow = 0;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    const iOff = i * n;
    for (let j = 0; j < n; j++) {
      rowSum += Math.abs(A[iOff + j]!);
    }
    if (rowSum > maxRow) maxRow = rowSum;
  }
  return maxRow;
}

/**
 * Solves M * X = B for n x n matrices using Gaussian elimination with partial pivoting.
 */
function solveMatrixSystem(M: Float64Array, B: Float64Array, n: number): Float64Array {
  const A = new Float64Array(M);
  const X = new Float64Array(B);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col * n + col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      for (let j = 0; j < n; j++) {
        const tmpA = A[col * n + j]!;
        A[col * n + j] = A[pivotRow * n + j]!;
        A[pivotRow * n + j] = tmpA;
        const tmpX = X[col * n + j]!;
        X[col * n + j] = X[pivotRow * n + j]!;
        X[pivotRow * n + j] = tmpX;
      }
    }
    const diag = A[col * n + col]!;
    if (Math.abs(diag) < 1e-30) continue;
    for (let r = col + 1; r < n; r++) {
      const factor = A[r * n + col]! / diag;
      if (factor === 0) continue;
      for (let j = col; j < n; j++) {
        A[r * n + j] = A[r * n + j]! - factor * A[col * n + j]!;
      }
      for (let j = 0; j < n; j++) {
        X[r * n + j] = X[r * n + j]! - factor * X[col * n + j]!;
      }
    }
  }

  for (let r = n - 1; r >= 0; r--) {
    const diag = A[r * n + r]!;
    if (Math.abs(diag) < 1e-30) continue;
    for (let j = 0; j < n; j++) {
      let s = X[r * n + j]!;
      for (let k = r + 1; k < n; k++) {
        s -= A[r * n + k]! * X[k * n + j]!;
      }
      X[r * n + j] = s / diag;
    }
  }

  return X;
}

/**
 * Computes matrix exponential exp(M) using Padé [6/6] approximant with scaling and squaring.
 */
export function matrixExpPade6(M: Float64Array, n: number): Float64Array {
  const norm = matInfNorm(M, n);
  const s = norm > 0.5 ? Math.max(0, Math.ceil(Math.log2(norm / 0.5))) : 0;
  const scale = Math.pow(2, -s);

  const B = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) B[i] = M[i]! * scale;

  const B2 = matMul(B, B, n);
  const B4 = matMul(B2, B2, n);
  const B6 = matMul(B4, B2, n);

  // Padé [6/6] coefficients: c0..c6
  const c0 = 1.0;
  const c1 = 0.5;
  const c2 = 5.0 / 44.0;
  const c3 = 1.0 / 66.0;
  const c4 = 1.0 / 792.0;
  const c5 = 1.0 / 15840.0;
  const c6 = 1.0 / 665280.0;

  const Uinner = new Float64Array(n * n);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    Uinner[i] = c3 * B2[i]! + c5 * B4[i]!;
    V[i] = c2 * B2[i]! + c4 * B4[i]! + c6 * B6[i]!;
  }
  for (let i = 0; i < n; i++) {
    Uinner[i * n + i] = Uinner[i * n + i]! + c1;
    V[i * n + i] = V[i * n + i]! + c0;
  }
  const U = matMul(B, Uinner, n);

  const Nmat = new Float64Array(n * n);
  const Dmat = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    Nmat[i] = V[i]! + U[i]!;
    Dmat[i] = V[i]! - U[i]!;
  }

  let R = solveMatrixSystem(Dmat, Nmat, n);
  for (let i = 0; i < s; i++) {
    R = matMul(R, R, n);
  }
  return R;
}

function stepRk4(A: Float64Array, y0: Float64Array, dt: number, n: number, subSteps?: number): Float64Array {
  const norm = matInfNorm(A, n);
  const autoSteps = Math.max(1, Math.ceil((norm * dt) / 0.05));
  const steps = Math.min(20000, Math.max(subSteps ?? 32, autoSteps));
  const h = dt / steps;
  let y = new Float64Array(y0);

  for (let s = 0; s < steps; s++) {
    const k1 = matVecMul(A, y, n);
    const y1 = new Float64Array(n);
    for (let i = 0; i < n; i++) y1[i] = y[i]! + 0.5 * h * k1[i]!;
    const k2 = matVecMul(A, y1, n);
    const y2 = new Float64Array(n);
    for (let i = 0; i < n; i++) y2[i] = y[i]! + 0.5 * h * k2[i]!;
    const k3 = matVecMul(A, y2, n);
    const y3 = new Float64Array(n);
    for (let i = 0; i < n; i++) y3[i] = y[i]! + h * k3[i]!;
    const k4 = matVecMul(A, y3, n);
    const yNext = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      yNext[i] = Math.max(0, y[i]! + (h / 6.0) * (k1[i]! + 2.0 * k2[i]! + 2.0 * k3[i]! + k4[i]!));
    }
    y = yNext;
  }
  return y;
}

function summarizeStep(
  timeSec: number,
  nuclides: string[],
  y: Float64Array,
  overrides?: Record<string, Partial<ScaleNuclideRecord>>,
): BatemanStepResult {
  const atoms: Record<string, number> = {};
  let decayHeatWatts = 0;
  let totalActivityBq = 0;

  for (let i = 0; i < nuclides.length; i++) {
    const id = nuclides[i]!;
    const nAtoms = Math.max(0, y[i]!);
    atoms[id] = nAtoms;
    const rec = getNuclideRecord(id, overrides);
    const activity = rec.decayConstant * nAtoms;
    totalActivityBq += activity;
    decayHeatWatts += activity * rec.decayEnergyMeV * MEV_TO_JOULES;
  }

  return { timeSec, atoms, decayHeatWatts, totalActivityBq };
}

/**
 * Solves a Bateman isotope depletion / decay chain problem over `timesSec`.
 */
export function solveBatemanDepletion(spec: BatemanChainSpec): BatemanSolution {
  const method: BatemanMethod = spec.method ?? "expm";
  const maxFlux = Array.isArray(spec.flux) ? Math.max(0, ...spec.flux) : Math.max(0, spec.flux);
  const initialNorm: Record<string, number> = {};
  for (const [k, v] of Object.entries(spec.initialAtoms)) {
    const nk = normalizeNuclideId(k);
    initialNorm[nk] = (initialNorm[nk] ?? 0) + v;
  }

  const nuclides = expandNuclideNetwork(Object.keys(initialNorm), maxFlux > 0, spec.nuclideOverrides);
  const n = nuclides.length;
  let y: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = initialNorm[nuclides[i]!] ?? 0;
  }

  const steps: BatemanStepResult[] = [];
  let prevTime = 0;

  for (let k = 0; k < spec.timesSec.length; k++) {
    const tTarget = spec.timesSec[k]!;
    const dt = tTarget - prevTime;
    const stepFlux = Array.isArray(spec.flux) ? (spec.flux[Math.min(k, spec.flux.length - 1)] ?? 0) : spec.flux;

    if (dt > 0) {
      const A = buildBatemanMatrix(nuclides, Math.max(0, stepFlux), spec.nuclideOverrides);
      if (method === "expm") {
        const Adt = new Float64Array(n * n);
        for (let i = 0; i < n * n; i++) Adt[i] = A[i]! * dt;
        const E = matrixExpPade6(Adt, n);
        y = matVecMul(E, y, n);
      } else {
        y = stepRk4(A, y, dt, n, spec.rk4SubSteps);
      }
      prevTime = tTarget;
    }

    steps.push(summarizeStep(tTarget, nuclides, y, spec.nuclideOverrides));
  }

  const last = steps[steps.length - 1] ?? summarizeStep(0, nuclides, y, spec.nuclideOverrides);
  return {
    nuclides,
    method,
    steps,
    finalAtoms: last.atoms,
    finalDecayHeatWatts: last.decayHeatWatts,
    finalActivityBq: last.totalActivityBq,
  };
}

/**
 * Converts an ORIGEN case's nuclide inventory (grams/moles/kg/atoms) into atom counts and solves Bateman ODEs.
 */
export function solveOrigenCase(origenCase: OrigenCase, method: BatemanMethod = "expm"): BatemanSolution {
  const initialAtoms: Record<string, number> = {};
  for (const nuc of origenCase.nuclides) {
    const rec = getNuclideRecord(nuc.nuclide);
    let atoms = nuc.amount;
    if (nuc.unit === "moles") atoms = nuc.amount * AVOGADRO;
    else if (nuc.unit === "grams") atoms = (nuc.amount / rec.atomicMass) * AVOGADRO;
    else if (nuc.unit === "kg") atoms = ((nuc.amount * 1000.0) / rec.atomicMass) * AVOGADRO;
    initialAtoms[rec.id] = (initialAtoms[rec.id] ?? 0) + atoms;
  }

  const timesSec = origenCase.time?.valuesSeconds ?? [3600];
  let flux: number | number[] = 0;
  if (origenCase.flux.length > 0) {
    flux = origenCase.flux;
  } else if (origenCase.power.length > 0) {
    // Estimate thermal flux from specific power (MW/MTU): 1 MW/MTU ~ 1e12 n/(cm^2*s) nominal PWR scaling
    flux = origenCase.power.map((p) => Math.max(0, p * 1.0e12));
  }

  return solveBatemanDepletion({
    initialAtoms,
    timesSec,
    flux,
    method,
  });
}

/**
 * Solves the first ORIGEN case in a parsed `ScaleDeck`, or builds a default depletion case from compositions.
 */
export function solveScaleDeck(deck: ScaleDeck, method: BatemanMethod = "expm"): BatemanSolution {
  if (deck.origenCases.length > 0) {
    return solveOrigenCase(deck.origenCases[0]!, method);
  }
  const initialAtoms: Record<string, number> = {};
  for (const comp of deck.compositions) {
    for (const [iso, pct] of Object.entries(comp.isotopes)) {
      const norm = normalizeNuclideId(iso);
      initialAtoms[norm] = (initialAtoms[norm] ?? 0) + pct * 1e20;
    }
  }
  if (Object.keys(initialAtoms).length === 0) {
    initialAtoms["U-235"] = 1.0e21;
  }
  return solveBatemanDepletion({
    initialAtoms,
    timesSec: [86400, 86400 * 10, 86400 * 30],
    flux: 3.0e13,
    method,
  });
}

// ── Closed-form Analytical Bateman Benchmarks ────────────────────────────────

/**
 * Exact analytical solution for a 2-step decay chain N1 -> N2 with N2(0) = 0:
 *   N1(t) = N10 * exp(-k1 * t)
 *   N2(t) = N10 * (k1 / (k2 - k1)) * (exp(-k1 * t) - exp(-k2 * t))
 */
export function analyticalBateman2Step(n10: number, k1: number, k2: number, t: number): { n1: number; n2: number } {
  const e1 = Math.exp(-k1 * t);
  const e2 = Math.exp(-k2 * t);
  const n1 = n10 * e1;
  const n2 = Math.abs(k2 - k1) < 1e-15 ? n10 * k1 * t * e1 : (n10 * k1 * (e1 - e2)) / (k2 - k1);
  return { n1, n2 };
}

/**
 * Exact analytical solution for a 3-step decay chain N1 -> N2 -> N3 with N2(0) = N3(0) = 0:
 *   N1(t) = N10 * exp(-k1 * t)
 *   N2(t) = N10 * k1 * (exp(-k1*t) - exp(-k2*t)) / (k2 - k1)
 *   N3(t) = N10 * k1 * k2 * [ exp(-k1*t)/((k2-k1)(k3-k1)) + exp(-k2*t)/((k1-k2)(k3-k2)) + exp(-k3*t)/((k1-k3)(k2-k3)) ]
 */
export function analyticalBateman3Step(
  n10: number,
  k1: number,
  k2: number,
  k3: number,
  t: number,
): { n1: number; n2: number; n3: number } {
  const { n1, n2 } = analyticalBateman2Step(n10, k1, k2, t);
  const e1 = Math.exp(-k1 * t);
  const e2 = Math.exp(-k2 * t);
  const e3 = Math.exp(-k3 * t);
  const n3 =
    n10 * k1 * k2 * (e1 / ((k2 - k1) * (k3 - k1)) + e2 / ((k1 - k2) * (k3 - k2)) + e3 / ((k1 - k3) * (k2 - k3)));
  return { n1, n2, n3 };
}

/**
 * Exact analytical single-nuclide depletion under constant flux:
 *   N(t) = N0 * exp(-(lambda + sigma_a * phi) * t)
 */
export function analyticalSingleDepletion(
  n0: number,
  decayConstant: number,
  sigmaAbsorptionBarns: number,
  flux: number,
  t: number,
): number {
  const rate = decayConstant + sigmaAbsorptionBarns * BARN_TO_CM2 * flux;
  return n0 * Math.exp(-rate * t);
}
