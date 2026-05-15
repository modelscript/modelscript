// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Reduced Order Model (ROM) Trainer.
 *
 * Trains lightweight surrogate models from DoE datasets. Supports:
 *   - **Polynomial**: Least-squares fit of monomials up to degree d
 *   - **RBF**: Radial Basis Function interpolation (Gaussian kernel)
 *   - **MLP**: Multi-layer perceptron via backpropagation + Adam
 *
 * Pure TypeScript — no TensorFlow/ONNX dependencies.
 */

import type { DoEResult } from "./doe.js";

// ─────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────

export interface ROMTrainConfig {
  /** Training data from DoE. */
  data: DoEResult;
  /** ROM architecture. */
  architecture: "polynomial" | "rbf" | "mlp";
  /** MLP hidden layer sizes (default: [32, 16]). */
  hiddenLayers?: number[];
  /** MLP activation (default: "tanh"). */
  activation?: "tanh" | "relu" | "sigmoid";
  /** Polynomial degree (default: 2). */
  polynomialDegree?: number;
  /** RBF kernel (default: "gaussian"). */
  rbfKernel?: "gaussian" | "multiquadric";
  /** Training epochs for MLP (default: 500). */
  epochs?: number;
  /** Learning rate for MLP (default: 0.001). */
  learningRate?: number;
  /** Validation split fraction (default: 0.2). */
  validationSplit?: number;
  /** PRNG seed (default: 42). */
  seed?: number;
  /** Progress callback. */
  onProgress?: (epoch: number, trainLoss: number, valLoss: number) => void;
}

export interface ScalingParams {
  mean: number;
  std: number;
}

export type ROMWeights =
  | { type: "polynomial"; coefficients: number[][]; degree: number; nInputs: number }
  | { type: "rbf"; centers: number[][]; weights: number[][]; epsilon: number }
  | { type: "mlp"; layers: { W: number[][]; b: number[] }[]; activation: string };

export interface TrainedROM {
  architecture: "polynomial" | "rbf" | "mlp";
  inputNames: string[];
  outputNames: string[];
  inputScaling: ScalingParams[];
  outputScaling: ScalingParams[];
  weights: ROMWeights;
  metrics: { trainMSE: number; valMSE: number; r2: number };
  lossCurve?: { epoch: number; trainLoss: number; valLoss: number }[];
}

// ─────────────────────────────────────────────────────────────────────
// Normalization Utilities
// ─────────────────────────────────────────────────────────────────────

function computeScaling(data: number[][]): ScalingParams[] {
  if (data.length === 0) return [];
  const nCols = data[0]!.length;
  const result: ScalingParams[] = [];
  for (let j = 0; j < nCols; j++) {
    let sum = 0;
    for (const row of data) sum += row[j]!;
    const mean = sum / data.length;
    let sumSq = 0;
    for (const row of data) sumSq += (row[j]! - mean) ** 2;
    const std = Math.sqrt(sumSq / data.length) || 1;
    result.push({ mean, std });
  }
  return result;
}

function normalize(data: number[][], scaling: ScalingParams[]): number[][] {
  return data.map((row) => row.map((v, j) => (v - scaling[j]!.mean) / scaling[j]!.std));
}

function splitData(
  inputs: number[][],
  outputs: number[][],
  valFrac: number,
  seed: number,
): { trainIn: number[][]; trainOut: number[][]; valIn: number[][]; valOut: number[][] } {
  const n = inputs.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  // Simple seeded shuffle
  let s = seed;
  for (let i = n - 1; i > 0; i--) {
    s = ((s * 1664525 + 1013904223) >>> 0) % (i + 1);
    const tmp = indices[i]!;
    indices[i] = indices[s]!;
    indices[s] = tmp;
  }
  const nVal = Math.max(1, Math.floor(n * valFrac));
  const valIdx = new Set(indices.slice(0, nVal));
  const trainIn: number[][] = [],
    trainOut: number[][] = [];
  const valIn: number[][] = [],
    valOut: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (valIdx.has(i)) {
      valIn.push(inputs[i]!);
      valOut.push(outputs[i]!);
    } else {
      trainIn.push(inputs[i]!);
      trainOut.push(outputs[i]!);
    }
  }
  return { trainIn, trainOut, valIn, valOut };
}

// ─────────────────────────────────────────────────────────────────────
// Polynomial Trainer
// ─────────────────────────────────────────────────────────────────────

function generateMonomials(nInputs: number, degree: number): number[][] {
  const monomials: number[][] = [];
  function enumerate(d: number, startIdx: number, current: number[]): void {
    monomials.push([...current]);
    if (d === 0) return;
    for (let i = startIdx; i < nInputs; i++) {
      current[i]!++;
      enumerate(d - 1, i, current);
      current[i]!--;
    }
  }
  enumerate(degree, 0, new Array(nInputs).fill(0));
  return monomials;
}

function evaluateMonomial(x: number[], powers: number[]): number {
  let result = 1;
  for (let i = 0; i < x.length; i++) {
    if (powers[i]! > 0) result *= Math.pow(x[i]!, powers[i]!);
  }
  return result;
}

function trainPolynomial(
  trainIn: number[][],
  trainOut: number[][],
  degree: number,
  nInputs: number,
): { coefficients: number[][]; monomials: number[][] } {
  const monomials = generateMonomials(nInputs, degree);
  const nBasis = monomials.length;
  const nOutputs = trainOut[0]!.length;
  const N = trainIn.length;

  // Build Vandermonde matrix Φ
  const Phi: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row: number[] = [];
    for (const mono of monomials) {
      row.push(evaluateMonomial(trainIn[i]!, mono));
    }
    Phi.push(row);
  }

  // Solve Φᵀ Φ β = Φᵀ y via normal equations
  const coefficients: number[][] = [];
  for (let o = 0; o < nOutputs; o++) {
    // Build Φᵀ y
    const PhiTy = new Array<number>(nBasis).fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < nBasis; j++) {
        PhiTy[j]! += Phi[i]![j]! * trainOut[i]![o]!;
      }
    }
    // Build Φᵀ Φ
    const PhiTPhi: number[][] = Array.from({ length: nBasis }, () => new Array(nBasis).fill(0));
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < nBasis; j++) {
        for (let k = 0; k <= j; k++) {
          const v = Phi[i]![j]! * Phi[i]![k]!;
          const rowJ = PhiTPhi[j]!;
          const rowK = PhiTPhi[k]!;
          rowJ[k] = (rowJ[k] ?? 0) + v;
          if (j !== k) rowK[j] = (rowK[j] ?? 0) + v;
        }
      }
    }
    // Regularize
    for (let j = 0; j < nBasis; j++) {
      const r = PhiTPhi[j]!;
      r[j] = (r[j] ?? 0) + 1e-10;
    }
    // Solve via Cholesky-like approach (simple Gaussian elimination)
    const beta = solveLinearSystem(PhiTPhi, PhiTy);
    coefficients.push(beta);
  }

  return { coefficients, monomials };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    // Pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[maxRow]![col]!)) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];
    const pivotRow = aug[col]!;
    const pivot = pivotRow[col]!;
    if (Math.abs(pivot) < 1e-15) continue;
    for (let j = col; j <= n; j++) pivotRow[j] = pivotRow[j]! / pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const rowArr = aug[row]!;
      const factor = rowArr[col]!;
      for (let j = col; j <= n; j++) rowArr[j] = rowArr[j]! - factor * pivotRow[j]!;
    }
  }
  return aug.map((row) => row[n]!);
}

// ─────────────────────────────────────────────────────────────────────
// RBF Trainer
// ─────────────────────────────────────────────────────────────────────

function trainRBF(
  trainIn: number[][],
  trainOut: number[][],
  kernel: "gaussian" | "multiquadric",
): { centers: number[][]; weights: number[][]; epsilon: number } {
  const N = trainIn.length;
  const nOutputs = trainOut[0]!.length;

  // Use all training points as centers
  const centers = trainIn;

  // Compute epsilon as average distance between centers
  let totalDist = 0;
  let count = 0;
  for (let i = 0; i < Math.min(N, 100); i++) {
    for (let j = i + 1; j < Math.min(N, 100); j++) {
      let d = 0;
      for (let k = 0; k < trainIn[0]!.length; k++) {
        d += (trainIn[i]![k]! - trainIn[j]![k]!) ** 2;
      }
      totalDist += Math.sqrt(d);
      count++;
    }
  }
  const epsilon = count > 0 ? totalDist / count : 1;

  // Build kernel matrix K
  const K: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row: number[] = [];
    for (let j = 0; j < N; j++) {
      let r2 = 0;
      for (let k = 0; k < trainIn[0]!.length; k++) {
        r2 += (trainIn[i]![k]! - centers[j]![k]!) ** 2;
      }
      if (kernel === "gaussian") {
        row.push(Math.exp(-r2 / (2 * epsilon * epsilon)));
      } else {
        row.push(Math.sqrt(1 + r2 / (epsilon * epsilon)));
      }
    }
    K.push(row);
  }

  // Regularize
  for (let i = 0; i < N; i++) {
    const row = K[i]!;
    row[i] = (row[i] ?? 0) + 1e-8;
  }

  // Solve K w = y for each output
  const weights: number[][] = [];
  for (let o = 0; o < nOutputs; o++) {
    const y = trainOut.map((row) => row[o]!);
    weights.push(
      solveLinearSystem(
        K.map((r) => [...r]),
        y,
      ),
    );
  }

  return { centers, weights, epsilon };
}

// ─────────────────────────────────────────────────────────────────────
// MLP Trainer (Backpropagation + Adam)
// ─────────────────────────────────────────────────────────────────────

type ActivationFn = (x: number) => number;
type ActivationDeriv = (x: number) => number;

function getActivation(name: string): { fn: ActivationFn; deriv: ActivationDeriv } {
  switch (name) {
    case "relu":
      return { fn: (x) => Math.max(0, x), deriv: (x) => (x > 0 ? 1 : 0) };
    case "sigmoid":
      return {
        fn: (x) => 1 / (1 + Math.exp(-x)),
        deriv: (x) => {
          const s = 1 / (1 + Math.exp(-x));
          return s * (1 - s);
        },
      };
    default: // tanh
      return { fn: Math.tanh, deriv: (x) => 1 - Math.tanh(x) ** 2 };
  }
}

function trainMLP(
  trainIn: number[][],
  trainOut: number[][],
  valIn: number[][],
  valOut: number[][],
  hiddenLayers: number[],
  activation: string,
  epochs: number,
  lr: number,
  seed: number,
  onProgress?: (epoch: number, trainLoss: number, valLoss: number) => void,
): { layers: { W: number[][]; b: number[] }[]; lossCurve: { epoch: number; trainLoss: number; valLoss: number }[] } {
  const nIn = trainIn[0]!.length;
  const nOut = trainOut[0]!.length;
  const sizes = [nIn, ...hiddenLayers, nOut];
  const nLayers = sizes.length - 1;
  const act = getActivation(activation);

  // Xavier initialization
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };

  const layers: { W: number[][]; b: number[] }[] = [];
  for (let l = 0; l < nLayers; l++) {
    const fanIn = sizes[l]!;
    const fanOut = sizes[l + 1]!;
    const scale = Math.sqrt(2 / (fanIn + fanOut));
    const W: number[][] = [];
    for (let i = 0; i < fanOut; i++) {
      const row: number[] = [];
      for (let j = 0; j < fanIn; j++) row.push(rand() * scale);
      W.push(row);
    }
    layers.push({ W, b: new Array(fanOut).fill(0) });
  }

  // Adam state
  const mW = layers.map((l) => l.W.map((r) => new Array(r.length).fill(0)));
  const vW = layers.map((l) => l.W.map((r) => new Array(r.length).fill(0)));
  const mb = layers.map((l) => new Array(l.b.length).fill(0));
  const vb = layers.map((l) => new Array(l.b.length).fill(0));
  const beta1 = 0.9,
    beta2 = 0.999,
    eps = 1e-8;
  let t = 0;

  const lossCurve: { epoch: number; trainLoss: number; valLoss: number }[] = [];

  for (let epoch = 0; epoch < epochs; epoch++) {
    let trainLoss = 0;

    for (let s = 0; s < trainIn.length; s++) {
      t++;
      // Forward pass
      const activations: number[][] = [trainIn[s]!];
      const preActivations: number[][] = [];

      for (let l = 0; l < nLayers; l++) {
        const input = activations[l]!;
        const { W, b } = layers[l]!;
        const pre: number[] = [];
        const post: number[] = [];
        for (let i = 0; i < W.length; i++) {
          let z = b[i]!;
          for (let j = 0; j < input.length; j++) z += W[i]![j]! * input[j]!;
          pre.push(z);
          post.push(l < nLayers - 1 ? act.fn(z) : z); // Linear output layer
        }
        preActivations.push(pre);
        activations.push(post);
      }

      // Loss
      const output = activations[nLayers]!;
      const target = trainOut[s]!;
      const delta: number[] = [];
      for (let i = 0; i < nOut; i++) {
        const err = output[i]! - target[i]!;
        trainLoss += err * err;
        delta.push((2 * err) / nOut);
      }

      // Backward pass
      let currentDelta = delta;
      for (let l = nLayers - 1; l >= 0; l--) {
        const input = activations[l]!;
        const { W, b } = layers[l]!;
        const pre = preActivations[l]!;

        // Apply activation derivative (skip for output layer)
        const localDelta = l < nLayers - 1 ? currentDelta.map((d, i) => d * act.deriv(pre[i]!)) : currentDelta;

        // Compute gradients and propagate
        const nextDelta = new Array(input.length).fill(0);
        for (let i = 0; i < W.length; i++) {
          for (let j = 0; j < input.length; j++) {
            const gW = localDelta[i]! * input[j]!;
            // Adam update for W
            const mWRow = mW[l]![i]!;
            const vWRow = vW[l]![i]!;
            mWRow[j] = beta1 * (mWRow[j] ?? 0) + (1 - beta1) * gW;
            vWRow[j] = beta2 * (vWRow[j] ?? 0) + (1 - beta2) * gW * gW;
            const mHat = (mWRow[j] ?? 0) / (1 - Math.pow(beta1, t));
            const vHat = (vWRow[j] ?? 0) / (1 - Math.pow(beta2, t));
            const Wrow = W[i]!;
            Wrow[j] = (Wrow[j] ?? 0) - (lr * mHat) / (Math.sqrt(vHat) + eps);
            nextDelta[j] += localDelta[i]! * Wrow[j]!;
          }
          // Adam update for b
          const gB = localDelta[i]!;
          const mbArr = mb[l]!;
          const vbArr = vb[l]!;
          mbArr[i] = beta1 * (mbArr[i] ?? 0) + (1 - beta1) * gB;
          vbArr[i] = beta2 * (vbArr[i] ?? 0) + (1 - beta2) * gB * gB;
          const mBHat = (mbArr[i] ?? 0) / (1 - Math.pow(beta1, t));
          const vBHat = (vbArr[i] ?? 0) / (1 - Math.pow(beta2, t));
          b[i] = (b[i] ?? 0) - (lr * mBHat) / (Math.sqrt(vBHat) + eps);
        }
        currentDelta = nextDelta;
      }
    }

    trainLoss /= trainIn.length;

    // Validation loss
    let valLoss = 0;
    for (let s = 0; s < valIn.length; s++) {
      let a = valIn[s]!;
      for (let l = 0; l < nLayers; l++) {
        const { W, b } = layers[l]!;
        const next: number[] = [];
        for (let i = 0; i < W.length; i++) {
          let z = b[i]!;
          for (let j = 0; j < a.length; j++) z += W[i]![j]! * a[j]!;
          next.push(l < nLayers - 1 ? act.fn(z) : z);
        }
        a = next;
      }
      for (let i = 0; i < nOut; i++) valLoss += (a[i]! - valOut[s]![i]!) ** 2;
    }
    valLoss /= Math.max(valIn.length, 1);

    onProgress?.(epoch, trainLoss, valLoss);
    lossCurve.push({ epoch, trainLoss, valLoss });
  }

  return { layers, lossCurve };
}

// ─────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────

/**
 * Train a Reduced Order Model from a DoE dataset.
 */
export function trainROM(config: ROMTrainConfig): TrainedROM {
  const { data, architecture } = config;

  // Extract steady-state data (no transient support yet)
  const rawInputs = data.inputs;
  const rawOutputs = data.isTransient
    ? (data.outputs as number[][][]).map((traj) => traj[traj.length - 1]!)
    : (data.outputs as number[][]);

  // Compute normalization
  const inputScaling = computeScaling(rawInputs);
  const outputScaling = computeScaling(rawOutputs);
  const normInputs = normalize(rawInputs, inputScaling);
  const normOutputs = normalize(rawOutputs, outputScaling);

  // Split
  const valFrac = config.validationSplit ?? 0.2;
  const seed = config.seed ?? 42;
  const { trainIn, trainOut, valIn, valOut } = splitData(normInputs, normOutputs, valFrac, seed);

  let weights: ROMWeights;
  let lossCurve: { epoch: number; trainLoss: number; valLoss: number }[] | undefined;

  switch (architecture) {
    case "polynomial": {
      const degree = config.polynomialDegree ?? 2;
      const nInputs = data.inputNames.length;
      const { coefficients } = trainPolynomial(trainIn, trainOut, degree, nInputs);
      weights = { type: "polynomial", coefficients, degree, nInputs };
      break;
    }
    case "rbf": {
      const kernel = config.rbfKernel ?? "gaussian";
      const result = trainRBF(trainIn, trainOut, kernel);
      weights = { type: "rbf", ...result };
      break;
    }
    case "mlp": {
      const hiddenLayers = config.hiddenLayers ?? [32, 16];
      const activation = config.activation ?? "tanh";
      const epochs = config.epochs ?? 500;
      const lr = config.learningRate ?? 0.001;
      const result = trainMLP(
        trainIn,
        trainOut,
        valIn,
        valOut,
        hiddenLayers,
        activation,
        epochs,
        lr,
        seed,
        config.onProgress,
      );
      weights = { type: "mlp", layers: result.layers, activation };
      lossCurve = result.lossCurve;
      break;
    }
  }

  // Compute final metrics
  const { trainMSE, valMSE, r2 } = computeMetrics(weights, trainIn, trainOut, valIn, valOut, architecture, config);

  const result: TrainedROM = {
    architecture,
    inputNames: data.inputNames,
    outputNames: data.outputNames,
    inputScaling,
    outputScaling,
    weights,
    metrics: { trainMSE, valMSE, r2 },
  };
  if (lossCurve) {
    result.lossCurve = lossCurve;
  }
  return result;
}

/** Evaluate a trained ROM on a single normalized input. */
export function evaluateROM(rom: TrainedROM, rawInput: number[]): number[] {
  // Normalize input
  const normInput = rawInput.map((v, i) => (v - rom.inputScaling[i]!.mean) / rom.inputScaling[i]!.std);

  let normOutput: number[];

  switch (rom.weights.type) {
    case "polynomial": {
      const w = rom.weights;
      const monomials = generateMonomials(w.nInputs, w.degree);
      normOutput = w.coefficients.map((coeffs) => {
        let sum = 0;
        for (let j = 0; j < monomials.length; j++) {
          sum += coeffs[j]! * evaluateMonomial(normInput, monomials[j]!);
        }
        return sum;
      });
      break;
    }
    case "rbf": {
      const w = rom.weights;
      normOutput = w.weights.map((wVec) => {
        let sum = 0;
        for (let j = 0; j < w.centers.length; j++) {
          let r2 = 0;
          for (let k = 0; k < normInput.length; k++) {
            r2 += (normInput[k]! - w.centers[j]![k]!) ** 2;
          }
          const phi = Math.exp(-r2 / (2 * w.epsilon * w.epsilon));
          sum += wVec[j]! * phi;
        }
        return sum;
      });
      break;
    }
    case "mlp": {
      const w = rom.weights;
      const act = getActivation(w.activation);
      let a = normInput;
      for (let l = 0; l < w.layers.length; l++) {
        const { W, b } = w.layers[l]!;
        const next: number[] = [];
        for (let i = 0; i < W.length; i++) {
          let z = b[i]!;
          for (let j = 0; j < a.length; j++) z += W[i]![j]! * a[j]!;
          next.push(l < w.layers.length - 1 ? act.fn(z) : z);
        }
        a = next;
      }
      normOutput = a;
      break;
    }
  }

  // Denormalize output
  return normOutput.map((v, i) => v * rom.outputScaling[i]!.std + rom.outputScaling[i]!.mean);
}

function computeMetrics(
  weights: ROMWeights,
  trainIn: number[][],
  trainOut: number[][],
  valIn: number[][],
  valOut: number[][],
  architecture: string,
  config: ROMTrainConfig,
): { trainMSE: number; valMSE: number; r2: number } {
  // Build a temporary ROM for evaluation
  const tempROM: TrainedROM = {
    architecture: architecture as TrainedROM["architecture"],
    inputNames: config.data.inputNames,
    outputNames: config.data.outputNames,
    inputScaling: config.data.inputNames.map(() => ({ mean: 0, std: 1 })),
    outputScaling: config.data.outputNames.map(() => ({ mean: 0, std: 1 })),
    weights,
    metrics: { trainMSE: 0, valMSE: 0, r2: 0 },
  };

  const mse = (inputs: number[][], targets: number[][]): number => {
    let total = 0;
    for (let i = 0; i < inputs.length; i++) {
      const pred = evaluateROM(tempROM, inputs[i]!);
      for (let j = 0; j < pred.length; j++) total += (pred[j]! - targets[i]![j]!) ** 2;
    }
    return total / Math.max(inputs.length, 1);
  };

  const trainMSE = mse(trainIn, trainOut);
  const valMSE = mse(valIn, valOut);

  // R² on validation set
  let ssRes = 0,
    ssTot = 0;
  const nOut = valOut[0]?.length ?? 1;
  const means = new Array(nOut).fill(0);
  for (const row of valOut) for (let j = 0; j < nOut; j++) means[j] += row[j]! / valOut.length;
  for (let i = 0; i < valIn.length; i++) {
    const pred = evaluateROM(tempROM, valIn[i]!);
    for (let j = 0; j < nOut; j++) {
      ssRes += (valOut[i]![j]! - pred[j]!) ** 2;
      ssTot += (valOut[i]![j]! - means[j]) ** 2;
    }
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { trainMSE, valMSE, r2 };
}
