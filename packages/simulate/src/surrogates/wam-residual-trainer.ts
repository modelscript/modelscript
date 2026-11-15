// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Pure-TypeScript in-browser World Action Model (WAM) residual trainer.
 *
 * Trains a compact multi-layer perceptron (MLP) with tanh hidden activations
 * and linear output layer to learn unmodeled robot dynamics / residual torques:
 *
 *   tau_res = f_WAM(q, dq, u; phi)
 *
 * Designed to run inside a Web Worker or main thread in the browser with zero
 * external ML dependencies (no PyTorch/TensorFlow) and emit self-contained
 * Modelica equations via ModelicaSurrogateEmitter.emitWamResidualModelica().
 */

export interface WamTrainingDataset {
  /** Sample timestamps [s]. */
  times: number[];
  /** Ordered joint names corresponding to columns of q, dq, u, tauResidual. */
  jointNames: string[];
  /** Joint positions [N x nJoints]. */
  q: number[][];
  /** Joint velocities [N x nJoints]. */
  dq: number[][];
  /** Control inputs / commands [N x nInputs]. */
  u: number[][];
  /** Target residual torques/accelerations (tau_actual - tau_modelica) [N x nOutputs]. */
  tauResidual: number[][];
}

export interface WamTrainerConfig {
  /** Hidden layer widths (default: [24, 24]). */
  hiddenLayers?: number[] | undefined;
  /** Number of Adam epochs (default: 250). */
  epochs?: number | undefined;
  /** Adam learning rate (default: 0.015). */
  learningRate?: number | undefined;
  /** L2 weight decay (default: 1e-5). */
  l2Regularization?: number | undefined;
  /** Deterministic PRNG seed (default: 42). */
  seed?: number | undefined;
  /** Optional progress callback invoked every `progressInterval` epochs. */
  onProgress?: ((progress: WamTrainingProgress) => void) | undefined;
  /** Epoch interval for progress callbacks (default: 10). */
  progressInterval?: number | undefined;
}

export interface WamTrainingProgress {
  epoch: number;
  totalEpochs: number;
  mseLoss: number;
}

export interface WamDenseLayer {
  inDim: number;
  outDim: number;
  /** Row-major weights [outDim * inDim]. */
  weights: number[];
  /** Biases [outDim]. */
  biases: number[];
  activation: "tanh" | "linear";
}

export interface TrainedWamResidual {
  jointNames: string[];
  inputDim: number;
  outputDim: number;
  controlDim: number;
  /** Input feature names in order: q_*, dq_*, u_*. */
  inputNames: string[];
  /** Output feature names: tau_res_*. */
  outputNames: string[];
  inputMean: number[];
  inputStd: number[];
  outputMean: number[];
  outputStd: number[];
  layers: WamDenseLayer[];
  lossHistory: number[];
  finalMse: number;
  rSquared: number;
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sanitizeModelicaIdent(str: string, used?: Set<string>): string {
  const safe = (str || "ident").replace(/[^A-Za-z0-9_]/g, "_");
  let base = /^[0-9]/.test(safe) ? `_${safe}` : safe;
  if (!base) base = "ident";
  if (!used) return base;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

function computeFeatureStats(matrix: number[][], dim: number): { mean: number[]; std: number[] } {
  const n = matrix.length;
  const mean = new Array<number>(dim).fill(0);
  const sumSq = new Array<number>(dim).fill(0);
  const std = new Array<number>(dim).fill(1);
  if (n === 0) return { mean, std };

  for (let i = 0; i < n; i++) {
    const row = matrix[i]!;
    for (let j = 0; j < dim; j++) {
      mean[j]! += row[j] ?? 0;
    }
  }
  for (let j = 0; j < dim; j++) {
    mean[j]! /= n;
  }

  for (let i = 0; i < n; i++) {
    const row = matrix[i]!;
    for (let j = 0; j < dim; j++) {
      const diff = (row[j] ?? 0) - mean[j]!;
      sumSq[j]! += diff * diff;
    }
  }
  for (let j = 0; j < dim; j++) {
    const s = Math.sqrt(sumSq[j]! / n);
    std[j] = s > 1e-8 ? s : 1.0;
  }

  return { mean, std };
}

export interface WamEvalScratch {
  input: Float64Array;
  layerActs: Float64Array[];
  output: number[];
}

export function createWamEvalScratch(model: TrainedWamResidual): WamEvalScratch {
  return {
    input: new Float64Array(model.inputDim),
    layerActs: model.layers.map((l) => new Float64Array(l.outDim)),
    output: new Array<number>(model.outputDim).fill(0),
  };
}

/**
 * Evaluates a trained WAM residual model on a single state-action point (q, dq, u).
 * Pass a reusable `scratch` buffer from `createWamEvalScratch` to avoid per-step allocations.
 */
export function evaluateWamResidual(
  model: TrainedWamResidual,
  q: number[],
  dq: number[],
  u: number[],
  scratch?: WamEvalScratch,
): number[] {
  const { inputDim, outputDim, inputMean, inputStd, outputMean, outputStd, layers } = model;
  const x = scratch ? scratch.input : new Float64Array(inputDim);
  const nJ = model.jointNames.length;
  const nU = model.controlDim;

  for (let i = 0; i < nJ; i++) {
    x[i] = ((q[i] ?? 0) - (inputMean[i] ?? 0)) / (inputStd[i] ?? 1);
    x[nJ + i] = ((dq[i] ?? 0) - (inputMean[nJ + i] ?? 0)) / (inputStd[nJ + i] ?? 1);
  }
  for (let i = 0; i < nU; i++) {
    x[2 * nJ + i] = ((u[i] ?? 0) - (inputMean[2 * nJ + i] ?? 0)) / (inputStd[2 * nJ + i] ?? 1);
  }

  let cur: Float64Array = x;
  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l]!;
    const next = scratch ? scratch.layerActs[l]! : new Float64Array(layer.outDim);
    for (let o = 0; o < layer.outDim; o++) {
      let sum = layer.biases[o] ?? 0;
      const rowOffset = o * layer.inDim;
      for (let i = 0; i < layer.inDim; i++) {
        sum += (layer.weights[rowOffset + i] ?? 0) * cur[i]!;
      }
      next[o] = layer.activation === "tanh" ? Math.tanh(sum) : sum;
    }
    cur = next;
  }

  const out = scratch ? scratch.output : new Array<number>(outputDim);
  for (let o = 0; o < outputDim; o++) {
    out[o] = cur[o]! * (outputStd[o] ?? 1) + (outputMean[o] ?? 0);
  }
  return out;
}

/**
 * Trains a residual World Action Model (WAM) MLP in pure TypeScript using Adam.
 */
export function trainWamResidual(dataset: WamTrainingDataset, config: WamTrainerConfig = {}): TrainedWamResidual {
  const nSamples = dataset.times.length;
  const nJ = dataset.jointNames.length;
  if (nSamples === 0 || nJ === 0) {
    throw new Error("WamTrainingDataset must contain at least one sample and one joint.");
  }

  const controlDim = dataset.u[0]?.length ?? nJ;
  const outputDim = dataset.tauResidual[0]?.length ?? nJ;
  const inputDim = 2 * nJ + controlDim;

  const hiddenLayers = config.hiddenLayers ?? [24, 24];
  const epochs = config.epochs ?? 250;
  const lr = config.learningRate ?? 0.015;
  const l2 = config.l2Regularization ?? 1e-5;
  const progressInterval = Math.max(1, config.progressInterval ?? 10);
  const rand = createMulberry32(config.seed ?? 42);

  // Build raw input and target matrices
  const rawX: number[][] = new Array(nSamples);
  const rawY: number[][] = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const row = new Array<number>(inputDim);
    const qi = dataset.q[i] ?? [];
    const dqi = dataset.dq[i] ?? [];
    const ui = dataset.u[i] ?? [];
    for (let j = 0; j < nJ; j++) {
      row[j] = qi[j] ?? 0;
      row[nJ + j] = dqi[j] ?? 0;
    }
    for (let j = 0; j < controlDim; j++) {
      row[2 * nJ + j] = ui[j] ?? 0;
    }
    rawX[i] = row;
    rawY[i] = dataset.tauResidual[i] ?? new Array<number>(outputDim).fill(0);
  }

  const { mean: inputMean, std: inputStd } = computeFeatureStats(rawX, inputDim);
  const { mean: outputMean, std: outputStd } = computeFeatureStats(rawY, outputDim);

  const normX: Float64Array[] = new Array(nSamples);
  const normY: Float64Array[] = new Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const nx = new Float64Array(inputDim);
    const ny = new Float64Array(outputDim);
    for (let j = 0; j < inputDim; j++) {
      nx[j] = (rawX[i]![j]! - inputMean[j]!) / inputStd[j]!;
    }
    for (let j = 0; j < outputDim; j++) {
      ny[j] = (rawY[i]![j]! - outputMean[j]!) / outputStd[j]!;
    }
    normX[i] = nx;
    normY[i] = ny;
  }

  // Initialize layers (Xavier/Glorot uniform)
  const dims = [inputDim, ...hiddenLayers, outputDim];
  const layers: {
    inDim: number;
    outDim: number;
    w: Float64Array;
    b: Float64Array;
    gw: Float64Array;
    gb: Float64Array;
    mw: Float64Array;
    vw: Float64Array;
    mb: Float64Array;
    vb: Float64Array;
    activation: "tanh" | "linear";
  }[] = [];

  for (let l = 0; l < dims.length - 1; l++) {
    const inDim = dims[l]!;
    const outDim = dims[l + 1]!;
    const limit = Math.sqrt(6 / (inDim + outDim));
    const w = new Float64Array(outDim * inDim);
    for (let k = 0; k < w.length; k++) {
      w[k] = (rand() * 2 - 1) * limit;
    }
    layers.push({
      inDim,
      outDim,
      w,
      b: new Float64Array(outDim),
      gw: new Float64Array(outDim * inDim),
      gb: new Float64Array(outDim),
      mw: new Float64Array(outDim * inDim),
      vw: new Float64Array(outDim * inDim),
      mb: new Float64Array(outDim),
      vb: new Float64Array(outDim),
      activation: l < dims.length - 2 ? "tanh" : "linear",
    });
  }

  // Pre-allocate forward/backward scratch buffers
  const acts: Float64Array[] = layers.map((l) => new Float64Array(l.outDim));
  const deltas: Float64Array[] = layers.map((l) => new Float64Array(l.outDim));

  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  const lossHistory: number[] = [];

  for (let epoch = 1; epoch <= epochs; epoch++) {
    for (const layer of layers) {
      layer.gw.fill(0);
      layer.gb.fill(0);
    }

    let totalLoss = 0;

    for (let s = 0; s < nSamples; s++) {
      const x0 = normX[s]!;
      const yTrue = normY[s]!;

      // Forward pass
      let prev = x0;
      for (let l = 0; l < layers.length; l++) {
        const layer = layers[l]!;
        const out = acts[l]!;
        for (let o = 0; o < layer.outDim; o++) {
          let sum = layer.b[o]!;
          const rowOffset = o * layer.inDim;
          for (let i = 0; i < layer.inDim; i++) {
            sum += layer.w[rowOffset + i]! * prev[i]!;
          }
          out[o] = layer.activation === "tanh" ? Math.tanh(sum) : sum;
        }
        prev = out;
      }

      // Output loss & delta
      const lastIdx = layers.length - 1;
      const yPred = acts[lastIdx]!;
      const lastDelta = deltas[lastIdx]!;
      for (let o = 0; o < outputDim; o++) {
        const err = yPred[o]! - yTrue[o]!;
        totalLoss += err * err;
        lastDelta[o] = (2 * err) / (nSamples * outputDim);
      }

      // Backward pass
      for (let l = lastIdx; l >= 0; l--) {
        const layer = layers[l]!;
        const delta = deltas[l]!;
        const inp = l === 0 ? x0 : acts[l - 1]!;

        for (let o = 0; o < layer.outDim; o++) {
          const d = delta[o]!;
          layer.gb[o]! += d;
          const rowOffset = o * layer.inDim;
          for (let i = 0; i < layer.inDim; i++) {
            layer.gw[rowOffset + i]! += d * inp[i]!;
          }
        }

        if (l > 0) {
          const prevDelta = deltas[l - 1]!;
          const prevAct = acts[l - 1]!;
          const prevLayer = layers[l - 1]!;
          for (let i = 0; i < layer.inDim; i++) {
            let sum = 0;
            for (let o = 0; o < layer.outDim; o++) {
              sum += layer.w[o * layer.inDim + i]! * delta[o]!;
            }
            if (prevLayer.activation === "tanh") {
              const a = prevAct[i]!;
              sum *= 1 - a * a;
            }
            prevDelta[i] = sum;
          }
        }
      }
    }

    const mseNorm = totalLoss / (nSamples * outputDim);
    lossHistory.push(mseNorm);

    // Adam step
    const b1Corr = 1 - Math.pow(beta1, epoch);
    const b2Corr = 1 - Math.pow(beta2, epoch);
    for (const layer of layers) {
      for (let k = 0; k < layer.w.length; k++) {
        const g = layer.gw[k]! + l2 * layer.w[k]!;
        layer.mw[k] = beta1 * layer.mw[k]! + (1 - beta1) * g;
        layer.vw[k] = beta2 * layer.vw[k]! + (1 - beta2) * g * g;
        const mHat = layer.mw[k]! / b1Corr;
        const vHat = layer.vw[k]! / b2Corr;
        layer.w[k]! -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
      for (let k = 0; k < layer.b.length; k++) {
        const g = layer.gb[k]!;
        layer.mb[k] = beta1 * layer.mb[k]! + (1 - beta1) * g;
        layer.vb[k] = beta2 * layer.vb[k]! + (1 - beta2) * g * g;
        const mHat = layer.mb[k]! / b1Corr;
        const vHat = layer.vb[k]! / b2Corr;
        layer.b[k]! -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
    }

    if (config.onProgress && (epoch % progressInterval === 0 || epoch === epochs)) {
      config.onProgress({ epoch, totalEpochs: epochs, mseLoss: mseNorm });
    }
  }

  const usedJointIdents = new Set<string>();
  const safeJointNames = dataset.jointNames.map((n) => sanitizeModelicaIdent(n, usedJointIdents));
  const inputNames = [
    ...safeJointNames.map((n) => `q_${n}`),
    ...safeJointNames.map((n) => `dq_${n}`),
    ...Array.from({ length: controlDim }, (_, i) => `u_${safeJointNames[i] ?? i}`),
  ];
  const outputNames = Array.from({ length: outputDim }, (_, i) => `tau_res_${safeJointNames[i] ?? i}`);

  const trained: TrainedWamResidual = {
    jointNames: [...dataset.jointNames],
    inputDim,
    outputDim,
    controlDim,
    inputNames,
    outputNames,
    inputMean,
    inputStd,
    outputMean,
    outputStd,
    layers: layers.map((l) => ({
      inDim: l.inDim,
      outDim: l.outDim,
      weights: Array.from(l.w),
      biases: Array.from(l.b),
      activation: l.activation,
    })),
    lossHistory,
    finalMse: 0,
    rSquared: 0,
  };

  // Compute physical-unit MSE and R^2 using reusable scratch buffer
  const evalScratch = createWamEvalScratch(trained);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < nSamples; i++) {
    const pred = evaluateWamResidual(trained, dataset.q[i]!, dataset.dq[i]!, dataset.u[i]!, evalScratch);
    const target = rawY[i]!;
    for (let o = 0; o < outputDim; o++) {
      const e = pred[o]! - target[o]!;
      const d = target[o]! - outputMean[o]!;
      ssRes += e * e;
      ssTot += d * d;
    }
  }
  trained.finalMse = ssRes / (nSamples * outputDim);
  trained.rSquared = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1.0;

  return trained;
}
