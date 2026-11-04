// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — SE(3) Coordinate Transform Chain Solver, Least-Squares Stylus
 * Pivot Calibration, Fitzpatrick Target Registration Error (TRE), and DAE Lowering.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import { IDENTITY_4X4 } from "../parser/index.js";
import type { IgtlDocument, Matrix4x4 } from "../types.js";

export interface PivotCalibrationResult {
  poseCount: number;
  stylusTipOffsetMm: [number, number, number];
  pivotPointMm: [number, number, number];
  stylusLengthMm: number;
  rmsErrorMm: number;
}

export interface FitzpatrickTreResult {
  fiducialCount: number;
  fleMm: number;
  expectedFreMm: number;
  treMm: number;
  centroidMm: [number, number, number];
  principalAxisRmsDistancesMm: [number, number, number];
  targetAxisDistancesMm: [number, number, number];
}

export interface TransformChainOptions {
  fromFrame?: string | undefined;
  toFrame?: string | undefined;
  pivotPoses?: Matrix4x4[] | undefined;
  fleMm?: number | undefined;
  fiducials?: Array<[number, number, number]> | undefined;
  targetPoint?: [number, number, number] | undefined;
}

export interface TransformChainAndPivotResult {
  fromFrame: string;
  toFrame: string;
  framePath: string[];
  isConnected: boolean;
  composedMatrix: Matrix4x4;
  translationMm: [number, number, number];
  translationNormMm: number;
  rotationDeterminant: number;
  orthogonalityErrorFrobenius: number;
  pivotCalibration?: PivotCalibrationResult | undefined;
  fitzpatrickTre?: FitzpatrickTreResult | undefined;
}

export function multiply4x4(A: Matrix4x4, B: Matrix4x4): Matrix4x4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += A[r * 4 + k]! * B[k * 4 + c]!;
      }
      out[r * 4 + c] = Math.round(sum * 1e9) / 1e9;
    }
  }
  return out as Matrix4x4;
}

export function invertRigid4x4(T: Matrix4x4): Matrix4x4 {
  const r00 = T[0]!,
    r01 = T[1]!,
    r02 = T[2]!,
    tx = T[3]!;
  const r10 = T[4]!,
    r11 = T[5]!,
    r12 = T[6]!,
    ty = T[7]!;
  const r20 = T[8]!,
    r21 = T[9]!,
    r22 = T[10]!,
    tz = T[11]!;

  // Transpose of R: R^T
  const itx = -(r00 * tx + r10 * ty + r20 * tz);
  const ity = -(r01 * tx + r11 * ty + r21 * tz);
  const itz = -(r02 * tx + r12 * ty + r22 * tz);

  return [r00, r10, r20, itx, r01, r11, r21, ity, r02, r12, r22, itz, 0, 0, 0, 1];
}

export function computeRotationDeterminant(T: Matrix4x4): number {
  const r00 = T[0]!,
    r01 = T[1]!,
    r02 = T[2]!;
  const r10 = T[4]!,
    r11 = T[5]!,
    r12 = T[6]!;
  const r20 = T[8]!,
    r21 = T[9]!,
    r22 = T[10]!;
  return r00 * (r11 * r22 - r12 * r21) - r01 * (r10 * r22 - r12 * r20) + r02 * (r10 * r21 - r11 * r20);
}

/**
 * Computes Frobenius norm || R^T R - I_3 ||_F for the upper-left 3x3 rotation block.
 */
export function computeOrthogonalityError(T: Matrix4x4): number {
  const R = [
    [T[0]!, T[1]!, T[2]!],
    [T[4]!, T[5]!, T[6]!],
    [T[8]!, T[9]!, T[10]!],
  ];
  let sumSq = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) {
        dot += R[k]![i]! * R[k]![j]!;
      }
      const diff = dot - (i === j ? 1.0 : 0.0);
      sumSq += diff * diff;
    }
  }
  return Math.sqrt(sumSq);
}

/**
 * Solves a 6x6 linear system H * x = g via Gaussian elimination with partial pivoting.
 */
function solveLinear6x6(H: number[][], g: number[]): number[] {
  const n = 6;
  const A = H.map((row, idx) => [...row, g[idx]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r]![col]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = A[col]!;
      A[col] = A[pivotRow]!;
      A[pivotRow] = tmp;
    }

    const diag = A[col]![col]!;
    if (Math.abs(diag) < 1e-14) continue;

    for (let r = col + 1; r < n; r++) {
      const factor = A[r]![col]! / diag;
      for (let c = col; c <= n; c++) {
        A[r]![c] = A[r]![c]! - factor * A[col]![c]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = A[i]![n]!;
    for (let j = i + 1; j < n; j++) {
      sum -= A[i]![j]! * x[j]!;
    }
    const diag = A[i]![i]!;
    x[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0;
  }
  return x;
}

/**
 * Performs least-squares stylus pivot calibration from M >= 2 tracked poses:
 * R_i * p_tip - p_pivot = -t_i
 */
export function solvePivotCalibration(poses: Matrix4x4[]): PivotCalibrationResult {
  const M = poses.length;
  if (M === 0) {
    return {
      poseCount: 0,
      stylusTipOffsetMm: [0, 0, 0],
      pivotPointMm: [0, 0, 0],
      stylusLengthMm: 0,
      rmsErrorMm: 0,
    };
  }

  const H: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const g: number[] = new Array<number>(6).fill(0);

  for (let i = 0; i < 6; i++) {
    H[i]![i] = 1e-12; // tiny Tikhonov regularization for numerical stability
  }

  for (const T of poses) {
    const rows: Array<[number[], number]> = [
      [[T[0]!, T[1]!, T[2]!, -1, 0, 0], -T[3]!],
      [[T[4]!, T[5]!, T[6]!, 0, -1, 0], -T[7]!],
      [[T[8]!, T[9]!, T[10]!, 0, 0, -1], -T[11]!],
    ];
    for (const [aRow, bVal] of rows) {
      for (let r = 0; r < 6; r++) {
        g[r] = g[r]! + aRow[r]! * bVal;
        for (let c = 0; c < 6; c++) {
          H[r]![c] = H[r]![c]! + aRow[r]! * aRow[c]!;
        }
      }
    }
  }

  const sol = solveLinear6x6(H, g);
  const pTip: [number, number, number] = [
    Math.round(sol[0]! * 1e6) / 1e6,
    Math.round(sol[1]! * 1e6) / 1e6,
    Math.round(sol[2]! * 1e6) / 1e6,
  ];
  const pPivot: [number, number, number] = [
    Math.round(sol[3]! * 1e6) / 1e6,
    Math.round(sol[4]! * 1e6) / 1e6,
    Math.round(sol[5]! * 1e6) / 1e6,
  ];

  let sqErrSum = 0;
  for (const T of poses) {
    const rx = T[0]! * pTip[0] + T[1]! * pTip[1] + T[2]! * pTip[2] + T[3]! - pPivot[0];
    const ry = T[4]! * pTip[0] + T[5]! * pTip[1] + T[6]! * pTip[2] + T[7]! - pPivot[1];
    const rz = T[8]! * pTip[0] + T[9]! * pTip[1] + T[10]! * pTip[2] + T[11]! - pPivot[2];
    sqErrSum += rx * rx + ry * ry + rz * rz;
  }

  const rmsErrorMm = Math.round(Math.sqrt(sqErrSum / M) * 1e6) / 1e6;
  const stylusLengthMm = Math.round(Math.sqrt(pTip[0] * pTip[0] + pTip[1] * pTip[1] + pTip[2] * pTip[2]) * 1e6) / 1e6;

  return {
    poseCount: M,
    stylusTipOffsetMm: pTip,
    pivotPointMm: pPivot,
    stylusLengthMm,
    rmsErrorMm,
  };
}

/**
 * Computes Fitzpatrick (1998) Target Registration Error (TRE):
 * TRE^2 = (FLE^2 / N) * (1 + (1/3) * sum_{k=1}^3 (d_k^2 / f_k^2))
 */
export function computeFitzpatrickTre(
  fiducials: Array<[number, number, number]>,
  targetPoint: [number, number, number],
  fleMm: number,
): FitzpatrickTreResult {
  const N = fiducials.length;
  if (N === 0) {
    return {
      fiducialCount: 0,
      fleMm,
      expectedFreMm: 0,
      treMm: 0,
      centroidMm: [0, 0, 0],
      principalAxisRmsDistancesMm: [1, 1, 1],
      targetAxisDistancesMm: [0, 0, 0],
    };
  }

  let cx = 0,
    cy = 0,
    cz = 0;
  for (const [x, y, z] of fiducials) {
    cx += x;
    cy += y;
    cz += z;
  }
  cx /= N;
  cy /= N;
  cz /= N;

  const centered = fiducials.map(([x, y, z]) => [x - cx, y - cy, z - cz] as [number, number, number]);

  // Compute 3x3 covariance matrix and perform Jacobi eigendecomposition for principal axes
  const cov: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of centered) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        cov[r]![c] = cov[r]![c]! + p[r]! * p[c]!;
      }
    }
  }

  const axes = jacobiEigenVectors3x3(cov);
  const tRel: [number, number, number] = [targetPoint[0] - cx, targetPoint[1] - cy, targetPoint[2] - cz];
  const tNormSq = tRel[0] * tRel[0] + tRel[1] * tRel[1] + tRel[2] * tRel[2];

  const fSq: [number, number, number] = [0, 0, 0];
  const dSq: [number, number, number] = [0, 0, 0];

  for (let k = 0; k < 3; k++) {
    const uk = axes[k]!;
    let sumF = 0;
    for (const p of centered) {
      const pNormSq = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      const proj = p[0] * uk[0] + p[1] * uk[1] + p[2] * uk[2];
      sumF += Math.max(0, pNormSq - proj * proj);
    }
    fSq[k] = Math.max(1e-6, sumF / N);

    const tProj = tRel[0] * uk[0] + tRel[1] * uk[1] + tRel[2] * uk[2];
    dSq[k] = Math.max(0, tNormSq - tProj * tProj);
  }

  const ratioSum = dSq[0] / fSq[0] + dSq[1] / fSq[1] + dSq[2] / fSq[2];
  const treSq = ((fleMm * fleMm) / N) * (1.0 + ratioSum / 3.0);
  const treMm = Math.round(Math.sqrt(treSq) * 1e6) / 1e6;
  const expectedFreMm = N > 2 ? Math.round(Math.sqrt((1.0 - 2.0 / N) * fleMm * fleMm) * 1e6) / 1e6 : 0;

  return {
    fiducialCount: N,
    fleMm,
    expectedFreMm,
    treMm,
    centroidMm: [Math.round(cx * 1e6) / 1e6, Math.round(cy * 1e6) / 1e6, Math.round(cz * 1e6) / 1e6],
    principalAxisRmsDistancesMm: [
      Math.round(Math.sqrt(fSq[0]) * 1e6) / 1e6,
      Math.round(Math.sqrt(fSq[1]) * 1e6) / 1e6,
      Math.round(Math.sqrt(fSq[2]) * 1e6) / 1e6,
    ],
    targetAxisDistancesMm: [
      Math.round(Math.sqrt(dSq[0]) * 1e6) / 1e6,
      Math.round(Math.sqrt(dSq[1]) * 1e6) / 1e6,
      Math.round(Math.sqrt(dSq[2]) * 1e6) / 1e6,
    ],
  };
}

function jacobiEigenVectors3x3(
  M: [[number, number, number], [number, number, number], [number, number, number]],
): [[number, number, number], [number, number, number], [number, number, number]] {
  const A = M.map((r) => [...r]);
  const V: [[number, number, number], [number, number, number], [number, number, number]] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < 25; iter++) {
    let p = 0,
      q = 1;
    let maxOff = Math.abs(A[0]![1]!);
    if (Math.abs(A[0]![2]!) > maxOff) {
      p = 0;
      q = 2;
      maxOff = Math.abs(A[0]![2]!);
    }
    if (Math.abs(A[1]![2]!) > maxOff) {
      p = 1;
      q = 2;
      maxOff = Math.abs(A[1]![2]!);
    }
    if (maxOff < 1e-12) break;

    const app = A[p]![p]!;
    const aqq = A[q]![q]!;
    const apq = A[p]![q]!;
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let i = 0; i < 3; i++) {
      const aip = A[i]![p]!;
      const aiq = A[i]![q]!;
      A[i]![p] = c * aip - s * aiq;
      A[i]![q] = s * aip + c * aiq;
    }
    for (let i = 0; i < 3; i++) {
      const api = A[p]![i]!;
      const aqi = A[q]![i]!;
      A[p]![i] = c * api - s * aqi;
      A[q]![i] = s * api + c * aqi;
    }
    A[p]![q] = 0;
    A[q]![p] = 0;

    for (let i = 0; i < 3; i++) {
      const vip = V[i]![p]!;
      const viq = V[i]![q]!;
      V[i]![p] = c * vip - s * viq;
      V[i]![q] = s * vip + c * viq;
    }
  }

  return [
    [V[0]![0]!, V[1]![0]!, V[2]![0]!],
    [V[0]![1]!, V[1]![1]!, V[2]![1]!],
    [V[0]![2]!, V[1]![2]!, V[2]![2]!],
  ];
}

/**
 * Solves the shortest coordinate transform chain in SE(3) between `fromFrame` and `toFrame`,
 * plus stylus pivot calibration and Fitzpatrick Target Registration Error (TRE) if present.
 */
export function solveTransformChainAndPivot(
  doc: IgtlDocument,
  options?: TransformChainOptions,
): TransformChainAndPivotResult {
  const allFrames = new Set<string>();
  const adj = new Map<string, Array<{ to: string; matrix: Matrix4x4 }>>();

  const addEdge = (u: string, v: string, mat: Matrix4x4) => {
    allFrames.add(u);
    allFrames.add(v);
    const list = adj.get(u) ?? [];
    list.push({ to: v, matrix: mat });
    adj.set(u, list);
  };

  for (const tf of doc.transforms) {
    addEdge(tf.from, tf.to, tf.matrix);
    addEdge(tf.to, tf.from, invertRigid4x4(tf.matrix));
  }

  // Determine default start/end frames
  let fromFrame = options?.fromFrame;
  let toFrame = options?.toFrame;
  if (!fromFrame || !toFrame) {
    const serverTf = doc.servers[0]?.transformNames[0];
    if (serverTf) {
      fromFrame = fromFrame ?? serverTf.from;
      toFrame = toFrame ?? serverTf.to;
    } else if (doc.transforms.length > 0) {
      fromFrame = fromFrame ?? doc.transforms[0]!.from;
      toFrame = toFrame ?? doc.transforms[doc.transforms.length - 1]!.to;
    } else {
      fromFrame = fromFrame ?? "StylusTip";
      toFrame = toFrame ?? "Reference";
    }
  }

  // BFS shortest path from `fromFrame` to `toFrame`
  let isConnected = false;
  let framePath: string[] = [];
  let composedMatrix: Matrix4x4 = [...IDENTITY_4X4] as Matrix4x4;

  if (fromFrame === toFrame && allFrames.has(fromFrame)) {
    isConnected = true;
    framePath = [fromFrame];
  } else if (allFrames.has(fromFrame) && allFrames.has(toFrame)) {
    const queue: Array<{ frame: string; path: string[]; mat: Matrix4x4 }> = [
      { frame: fromFrame, path: [fromFrame], mat: [...IDENTITY_4X4] as Matrix4x4 },
    ];
    const visited = new Set<string>([fromFrame]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr.frame === toFrame) {
        isConnected = true;
        framePath = curr.path;
        composedMatrix = curr.mat;
        break;
      }
      for (const edge of adj.get(curr.frame) ?? []) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push({
            frame: edge.to,
            path: [...curr.path, edge.to],
            mat: multiply4x4(edge.matrix, curr.mat),
          });
        }
      }
    }
  }

  const tx = composedMatrix[3]!;
  const ty = composedMatrix[7]!;
  const tz = composedMatrix[11]!;
  const translationNormMm = Math.round(Math.sqrt(tx * tx + ty * ty + tz * tz) * 1e6) / 1e6;
  const rotationDeterminant = Math.round(computeRotationDeterminant(composedMatrix) * 1e6) / 1e6;
  const orthogonalityErrorFrobenius = Math.round(computeOrthogonalityError(composedMatrix) * 1e6) / 1e6;

  const poses = options?.pivotPoses ?? doc.pivotPoses.map((p) => p.matrix);
  const pivotCalibration = poses.length >= 2 ? solvePivotCalibration(poses) : undefined;

  const fiducials = options?.fiducials ?? doc.fiducialConfig?.fiducials;
  const targetPt = options?.targetPoint ?? doc.fiducialConfig?.targetPoint ?? [tx, ty, tz];
  const fleMm = options?.fleMm ?? doc.fiducialConfig?.fleMm ?? 0.5;
  const fitzpatrickTre =
    fiducials && fiducials.length >= 3 ? computeFitzpatrickTre(fiducials, targetPt, fleMm) : undefined;

  const result: TransformChainAndPivotResult = {
    fromFrame,
    toFrame,
    framePath,
    isConnected,
    composedMatrix,
    translationMm: [tx, ty, tz],
    translationNormMm,
    rotationDeterminant,
    orthogonalityErrorFrobenius,
  };
  if (pivotCalibration !== undefined) result.pivotCalibration = pivotCalibration;
  if (fitzpatrickTre !== undefined) result.fitzpatrickTre = fitzpatrickTre;
  return result;
}

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Lowers an OpenIGTLink / PLUS document into ModelScript's linear-memory DAEBuilder arena.
 */
export function lowerIgtlToDae(doc: IgtlDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? "OpenIGTLink_SurgicalNavigation";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  for (const dev of doc.devices) {
    const base = sanitizeIdentifier(dev.id);
    const rateVar = `${base}_AcquisitionRate_Hz`;
    const rateId = interner.intern(rateVar);
    arena.addVariable(rateVar, VarType.Real, Variability.Parameter, Causality.Local);
    arena.addEquation(
      EqKind.InitialSimple,
      arena.addExpression(ExprKind.Name, rateId),
      arena.addRealLiteral(dev.acquisitionRate ?? 60.0),
    );
  }

  for (const tf of doc.transforms) {
    const base = sanitizeIdentifier(`${tf.from}To${tf.to}`);
    const txVar = `${base}_Tx_mm`;
    const tyVar = `${base}_Ty_mm`;
    const tzVar = `${base}_Tz_mm`;

    const txId = interner.intern(txVar);
    arena.addVariable(txVar, VarType.Real, Variability.Continuous, Causality.Output);
    arena.addEquation(EqKind.Simple, arena.addExpression(ExprKind.Name, txId), arena.addRealLiteral(tf.matrix[3]!));

    const tyId = interner.intern(tyVar);
    arena.addVariable(tyVar, VarType.Real, Variability.Continuous, Causality.Output);
    arena.addEquation(EqKind.Simple, arena.addExpression(ExprKind.Name, tyId), arena.addRealLiteral(tf.matrix[7]!));

    const tzId = interner.intern(tzVar);
    arena.addVariable(tzVar, VarType.Real, Variability.Continuous, Causality.Output);
    arena.addEquation(EqKind.Simple, arena.addExpression(ExprKind.Name, tzId), arena.addRealLiteral(tf.matrix[11]!));
  }

  const solved = solveTransformChainAndPivot(doc);
  const normVar = "Chain_TranslationNorm_mm";
  const normId = interner.intern(normVar);
  arena.addVariable(normVar, VarType.Real, Variability.Continuous, Causality.Output);
  arena.addEquation(
    EqKind.Simple,
    arena.addExpression(ExprKind.Name, normId),
    arena.addRealLiteral(solved.translationNormMm),
  );

  if (solved.pivotCalibration) {
    const pivVar = "PivotCalibration_RmsError_mm";
    const pivId = interner.intern(pivVar);
    arena.addVariable(pivVar, VarType.Real, Variability.Continuous, Causality.Output);
    arena.addEquation(
      EqKind.Simple,
      arena.addExpression(ExprKind.Name, pivId),
      arena.addRealLiteral(solved.pivotCalibration.rmsErrorMm),
    );
  }

  if (solved.fitzpatrickTre) {
    const treVar = "Fitzpatrick_TRE_mm";
    const treId = interner.intern(treVar);
    arena.addVariable(treVar, VarType.Real, Variability.Continuous, Causality.Output);
    arena.addEquation(
      EqKind.Simple,
      arena.addExpression(ExprKind.Name, treId),
      arena.addRealLiteral(solved.fitzpatrickTre.treMm),
    );
  }

  return arena;
}
