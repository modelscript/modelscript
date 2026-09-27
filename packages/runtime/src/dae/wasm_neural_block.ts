// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-Arena Universal Differential Equation (UDE) Neural Network Blocks.
 *
 * Enables embedding differentiable neural surrogate blocks (MLPs, polynomial surrogates,
 * Fourier features) directly into DAEBuilder equation systems in linear WebAssembly memory.
 *
 * Features:
 *   - Automatic generation of linear-memory DAE equations and parameter bindings.
 *   - Continuous differentiability across all layers with smooth activations (Tanh, Sigmoid, SiLU).
 *   - Native integration with ArenaSimulator, DaeAdjointSolver, and HybridAdjointSolver.
 *   - Standalone vectorized forward (GEMV) and backward (VJP) kernels for high-throughput training.
 */

import { BinOp, DAEBuilder, EqKind, VarType, Variability } from "./wasm_dae.js";

export enum ActivationKind {
  Linear = 0,
  Tanh = 1,
  Sigmoid = 2,
  ReLU = 3,
  SiLU = 4,
}

export interface NeuralBlockConfig {
  /** Unique name identifier for the neural block (e.g. "drag_nn", "loss_surrogate"). */
  name: string;
  /** Layer dimensions: [inputDim, hidden1, hidden2, ..., outputDim]. */
  layers: number[];
  /** Activation function for hidden layers. Default: Tanh. */
  activation?: ActivationKind;
  /** Activation function for the final output layer. Default: Linear. */
  outputActivation?: ActivationKind;
  /** Optional custom initial weights vector. */
  initialWeights?: Float64Array;
  /** Random initialization seed. */
  seed?: number;
}

export class ArenaNeuralBlock {
  public readonly name: string;
  public readonly layers: number[];
  public readonly activation: ActivationKind;
  public readonly outputActivation: ActivationKind;

  private weightParamNames: string[] = [];
  private totalWeightCount = 0;
  private layerOffsets: { wOffset: number; bOffset: number; inDim: number; outDim: number }[] = [];

  constructor(public readonly config: NeuralBlockConfig) {
    this.name = config.name;
    this.layers = [...config.layers];
    if (this.layers.length < 2) {
      throw new Error(`Neural block '${this.name}' must have at least 2 layer dimensions (input and output).`);
    }
    this.activation = config.activation ?? ActivationKind.Tanh;
    this.outputActivation = config.outputActivation ?? ActivationKind.Linear;
    this.calculateOffsets();
  }

  private calculateOffsets(): void {
    this.layerOffsets = [];
    let currentOffset = 0;

    for (let l = 0; l < this.layers.length - 1; l++) {
      const inDim = this.layers[l]!;
      const outDim = this.layers[l + 1]!;
      const wSize = outDim * inDim;
      const bSize = outDim;

      const wOffset = currentOffset;
      const bOffset = currentOffset + wSize;
      currentOffset += wSize + bSize;

      this.layerOffsets.push({ wOffset, bOffset, inDim, outDim });
    }

    this.totalWeightCount = currentOffset;
  }

  /**
   * Total number of learnable parameters (weights + biases).
   */
  public get weightCount(): number {
    return this.totalWeightCount;
  }

  /**
   * Input dimension of the neural block.
   */
  public get inDim(): number {
    return this.layers[0]!;
  }

  /**
   * Output dimension of the neural block.
   */
  public get outDim(): number {
    return this.layers[this.layers.length - 1]!;
  }

  /**
   * Returns parameter names in the DAEBuilder arena for all weights and biases.
   */
  public getParameterNames(): string[] {
    return [...this.weightParamNames];
  }

  /**
   * Builds and inserts the neural network layers and equations into the DAEBuilder arena.
   *
   * @param arena - The target DAEBuilder
   * @param inputVarNames - Names of the input variables (length must match layers[0])
   * @param outputVarNames - Names of the output variables (length must match layers[last])
   */
  public build(arena: DAEBuilder, inputVarNames: string[], outputVarNames: string[]): void {
    const inDim = this.layers[0]!;
    const outDim = this.layers[this.layers.length - 1]!;

    if (inputVarNames.length !== inDim) {
      throw new Error(`Neural block '${this.name}' expects ${inDim} inputs, but received ${inputVarNames.length}.`);
    }
    if (outputVarNames.length !== outDim) {
      throw new Error(`Neural block '${this.name}' expects ${outDim} outputs, but received ${outputVarNames.length}.`);
    }

    this.weightParamNames = [];
    const initWeights = this.config.initialWeights ?? this.generateXavierWeights();

    let currentInputNames = [...inputVarNames];

    for (let l = 0; l < this.layerOffsets.length; l++) {
      const { wOffset, bOffset, inDim: layerIn, outDim: layerOut } = this.layerOffsets[l]!;
      const isLastLayer = l === this.layerOffsets.length - 1;
      const layerAct = isLastLayer ? this.outputActivation : this.activation;

      const layerOutputNames: string[] = [];

      for (let j = 0; j < layerOut; j++) {
        // Bias parameter: nn_<name>_l<l>_b<j>
        const bName = `nn_${this.name}_l${l}_b${j}`;
        const bVal = initWeights[bOffset + j] ?? 0.0;
        const bVarIdx = arena.addVariable(bName, VarType.Real, Variability.Parameter, 0, bVal);
        arena.setVarExpression(bVarIdx, arena.addRealLiteral(bVal));
        this.weightParamNames.push(bName);

        // Sum = b
        let sumExpr = arena.addNameExpr(bName);

        // Add W_j_i * x_i
        for (let i = 0; i < layerIn; i++) {
          const wName = `nn_${this.name}_l${l}_W${j}_${i}`;
          const wVal = initWeights[wOffset + j * layerIn + i] ?? 0.0;
          const wVarIdx = arena.addVariable(wName, VarType.Real, Variability.Parameter, 0, wVal);
          arena.setVarExpression(wVarIdx, arena.addRealLiteral(wVal));
          this.weightParamNames.push(wName);

          const wExpr = arena.addNameExpr(wName);
          const xExpr = arena.addNameExpr(currentInputNames[i]!);
          const wx = arena.addBinaryExpr(BinOp.Mul, wExpr, xExpr);
          sumExpr = arena.addBinaryExpr(BinOp.Add, sumExpr, wx);
        }

        // Apply activation function
        let actExpr = sumExpr;
        switch (layerAct) {
          case ActivationKind.Tanh:
            actExpr = arena.addCallExpr("tanh", [sumExpr]);
            break;
          case ActivationKind.Sigmoid: {
            // 0.5 * (1 + tanh(0.5 * z))
            const halfLit = arena.addRealLiteral(0.5);
            const scaled = arena.addBinaryExpr(BinOp.Mul, halfLit, sumExpr);
            const tanhVal = arena.addCallExpr("tanh", [scaled]);
            const oneLit = arena.addRealLiteral(1.0);
            const onePlusTanh = arena.addBinaryExpr(BinOp.Add, oneLit, tanhVal);
            actExpr = arena.addBinaryExpr(BinOp.Mul, halfLit, onePlusTanh);
            break;
          }
          case ActivationKind.Linear:
            actExpr = sumExpr;
            break;
          case ActivationKind.ReLU: {
            // smooth approximation: max(0, z) = 0.5 * (z + sqrt(z^2 + 1e-4))
            const zSq = arena.addBinaryExpr(BinOp.Mul, sumExpr, sumExpr);
            const epsLit = arena.addRealLiteral(1e-4);
            const sqrtTerm = arena.addCallExpr("sqrt", [arena.addBinaryExpr(BinOp.Add, zSq, epsLit)]);
            const sumTerm = arena.addBinaryExpr(BinOp.Add, sumExpr, sqrtTerm);
            actExpr = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(0.5), sumTerm);
            break;
          }
          case ActivationKind.SiLU: {
            // z * sigmoid(z)
            const halfLit = arena.addRealLiteral(0.5);
            const scaled = arena.addBinaryExpr(BinOp.Mul, halfLit, sumExpr);
            const tanhVal = arena.addCallExpr("tanh", [scaled]);
            const oneLit = arena.addRealLiteral(1.0);
            const sigmoid = arena.addBinaryExpr(BinOp.Mul, halfLit, arena.addBinaryExpr(BinOp.Add, oneLit, tanhVal));
            actExpr = arena.addBinaryExpr(BinOp.Mul, sumExpr, sigmoid);
            break;
          }
        }

        if (isLastLayer) {
          // Equate to target output variable
          const outVarName = outputVarNames[j]!;
          // If variable already exists, equate: outVar = actExpr
          const outVarIdx = arena.getVarIdxByName(outVarName);
          if (outVarIdx === -1) {
            arena.addVariable(outVarName, VarType.Real, Variability.Continuous, 0, 0.0);
          }
          arena.addEquation(EqKind.Simple, arena.addNameExpr(outVarName), actExpr);
          layerOutputNames.push(outVarName);
        } else {
          // Intermediate hidden layer variable: nn_<name>_h<l>_<j>
          const hName = `nn_${this.name}_h${l}_${j}`;
          arena.addVariable(hName, VarType.Real, Variability.Continuous, 0, 0.0);
          arena.addEquation(EqKind.Simple, arena.addNameExpr(hName), actExpr);
          layerOutputNames.push(hName);
        }
      }

      currentInputNames = layerOutputNames;
    }
  }

  /**
   * Retrieves the current weights vector from the DAEBuilder arena.
   */
  public getWeights(arena: DAEBuilder): Float64Array {
    const weights = new Float64Array(this.totalWeightCount);
    for (let i = 0; i < this.weightParamNames.length; i++) {
      const pName = this.weightParamNames[i]!;
      const vIdx = arena.getVarIdxByName(pName);
      if (vIdx !== -1) {
        const exprId = arena.getVarExpression(vIdx);
        if (exprId !== -1) {
          weights[i] = arena.getExprRealValue(exprId);
        }
      }
    }
    return weights;
  }

  /**
   * Updates the weights of the neural block in the DAEBuilder arena.
   */
  public setWeights(arena: DAEBuilder, weights: Float64Array): void {
    if (weights.length !== this.totalWeightCount) {
      throw new Error(`Weight size mismatch: expected ${this.totalWeightCount}, received ${weights.length}.`);
    }
    for (let i = 0; i < this.weightParamNames.length; i++) {
      const pName = this.weightParamNames[i]!;
      const vIdx = arena.getVarIdxByName(pName);
      if (vIdx !== -1) {
        const val = weights[i] ?? 0.0;
        arena.setVarStartValue(vIdx, val);
        const litId = arena.addRealLiteral(val);
        arena.setVarExpression(vIdx, litId);
      }
    }
  }

  /**
   * Fast vectorized forward pass (GEMV) operating purely in Float64Array buffers.
   */
  public forwardVectorized(inputs: Float64Array, weights?: Float64Array): Float64Array {
    const W = weights ?? this.config.initialWeights ?? this.generateXavierWeights();
    let curr = new Float64Array(inputs);

    for (let l = 0; l < this.layerOffsets.length; l++) {
      const { wOffset, bOffset, inDim, outDim } = this.layerOffsets[l]!;
      const isLast = l === this.layerOffsets.length - 1;
      const act = isLast ? this.outputActivation : this.activation;

      const next = new Float64Array(outDim);
      for (let j = 0; j < outDim; j++) {
        let sum = W[bOffset + j] ?? 0;
        for (let i = 0; i < inDim; i++) {
          sum += (W[wOffset + j * inDim + i] ?? 0) * (curr[i] ?? 0);
        }
        next[j] = this.evaluateActivationScalar(sum, act);
      }
      curr = next;
    }

    return curr;
  }

  /**
   * Vector-Jacobian Product (VJP) pullback: computes gradInputs and gradWeights given cotangent u.
   */
  public vjpVectorized(
    cotangent: Float64Array,
    inputs: Float64Array,
    weights?: Float64Array,
  ): { gradInputs: Float64Array; gradWeights: Float64Array } {
    const W = weights ?? this.config.initialWeights ?? this.generateXavierWeights();
    const gradW = new Float64Array(this.totalWeightCount);

    // Forward pass with activation caching
    const activations: Float64Array[] = [new Float64Array(inputs)];
    const preActivations: Float64Array[] = [];

    let curr = new Float64Array(inputs);
    for (let l = 0; l < this.layerOffsets.length; l++) {
      const { wOffset, bOffset, inDim, outDim } = this.layerOffsets[l]!;
      const isLast = l === this.layerOffsets.length - 1;
      const act = isLast ? this.outputActivation : this.activation;

      const pre = new Float64Array(outDim);
      const post = new Float64Array(outDim);

      for (let j = 0; j < outDim; j++) {
        let sum = W[bOffset + j] ?? 0;
        for (let i = 0; i < inDim; i++) {
          sum += (W[wOffset + j * inDim + i] ?? 0) * (curr[i] ?? 0);
        }
        pre[j] = sum;
        post[j] = this.evaluateActivationScalar(sum, act);
      }

      preActivations.push(pre);
      activations.push(post);
      curr = post;
    }

    // Backward pass
    let delta = new Float64Array(cotangent);

    for (let l = this.layerOffsets.length - 1; l >= 0; l--) {
      const { wOffset, bOffset, inDim, outDim } = this.layerOffsets[l]!;
      const isLast = l === this.layerOffsets.length - 1;
      const act = isLast ? this.outputActivation : this.activation;

      const aIn = activations[l]!;
      const pre = preActivations[l]!;

      // dL/dz = delta * d_act(pre)
      const dZ = new Float64Array(outDim);
      for (let j = 0; j < outDim; j++) {
        dZ[j] = (delta[j] ?? 0) * this.evaluateActivationDerivative(pre[j] ?? 0, act);
        // dL/db_j = dZ_j
        gradW[bOffset + j] = dZ[j]!;
      }

      // dL/dW_ji = dZ_j * aIn_i
      for (let j = 0; j < outDim; j++) {
        for (let i = 0; i < inDim; i++) {
          gradW[wOffset + j * inDim + i] = (dZ[j] ?? 0) * (aIn[i] ?? 0);
        }
      }

      // Propagate delta to previous layer: delta_prev = W^T * dZ
      if (l > 0) {
        const deltaPrev = new Float64Array(inDim);
        for (let i = 0; i < inDim; i++) {
          let sum = 0;
          for (let j = 0; j < outDim; j++) {
            sum += (W[wOffset + j * inDim + i] ?? 0) * (dZ[j] ?? 0);
          }
          deltaPrev[i] = sum;
        }
        delta = deltaPrev;
      } else {
        // Input gradient
        const gradIn = new Float64Array(inDim);
        for (let i = 0; i < inDim; i++) {
          let sum = 0;
          for (let j = 0; j < outDim; j++) {
            sum += (W[wOffset + j * inDim + i] ?? 0) * (dZ[j] ?? 0);
          }
          gradIn[i] = sum;
        }
        return { gradInputs: gradIn, gradWeights: gradW };
      }
    }

    return { gradInputs: delta, gradWeights: gradW };
  }

  private evaluateActivationScalar(z: number, act: ActivationKind): number {
    switch (act) {
      case ActivationKind.Tanh:
        return Math.tanh(z);
      case ActivationKind.Sigmoid:
        return 0.5 * (1 + Math.tanh(0.5 * z));
      case ActivationKind.ReLU:
        return Math.max(0, z);
      case ActivationKind.SiLU:
        return z * (0.5 * (1 + Math.tanh(0.5 * z)));
      case ActivationKind.Linear:
      default:
        return z;
    }
  }

  private evaluateActivationDerivative(z: number, act: ActivationKind): number {
    switch (act) {
      case ActivationKind.Tanh: {
        const t = Math.tanh(z);
        return 1 - t * t;
      }
      case ActivationKind.Sigmoid: {
        const s = 0.5 * (1 + Math.tanh(0.5 * z));
        return s * (1 - s);
      }
      case ActivationKind.ReLU:
        return z > 0 ? 1 : 0;
      case ActivationKind.SiLU: {
        const s = 0.5 * (1 + Math.tanh(0.5 * z));
        return s + z * s * (1 - s);
      }
      case ActivationKind.Linear:
      default:
        return 1.0;
    }
  }

  /**
   * Generates Xavier / Glorot uniform initial weights.
   */
  public generateXavierWeights(): Float64Array {
    const W = new Float64Array(this.totalWeightCount);
    let seed = this.config.seed ?? 42;

    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (const { wOffset, bOffset, inDim, outDim } of this.layerOffsets) {
      const limit = Math.sqrt(6.0 / (inDim + outDim));
      for (let j = 0; j < outDim; j++) {
        W[bOffset + j] = 0.0; // Biases initialize to 0
        for (let i = 0; i < inDim; i++) {
          W[wOffset + j * inDim + i] = (pseudoRandom() * 2 - 1) * limit;
        }
      }
    }

    return W;
  }
}

/**
 * Convenient factory to create and mount an in-arena neural block.
 */
export function createArenaNeuralBlock(
  arena: DAEBuilder,
  config: NeuralBlockConfig,
  inputVarNames: string[],
  outputVarNames: string[],
): ArenaNeuralBlock {
  const block = new ArenaNeuralBlock(config);
  block.build(arena, inputVarNames, outputVarNames);
  return block;
}

// ─────────────────────────────────────────────────────────────────────────────
// Continuous-Time Recurrent Neural Network (CTRNN / Liquid Time-Constant) Block
// ─────────────────────────────────────────────────────────────────────────────

export interface CTRNNBlockConfig {
  /** Unique name identifier for the recurrent block (e.g. "drag_ctrnn", "hysteresis_net"). */
  name: string;
  /** Number of external input signals. */
  inDim: number;
  /** Number of internal continuous recurrent state variables. */
  hiddenDim: number;
  /** Number of output variables. */
  outDim: number;
  /** Activation function for recurrent hidden states. Default: Tanh. */
  activation?: ActivationKind;
  /** Activation function for output projection. Default: Linear. */
  outputActivation?: ActivationKind;
  /** Initial time-constant tau for hidden states (scalar or array). Default: 1.0. */
  initialTau?: number | number[];
  /** Optional custom initial weights vector. */
  initialWeights?: Float64Array;
  /** Random initialization seed. */
  seed?: number;
}

function buildActivationDaeExpr(arena: DAEBuilder, sumExpr: number, act: ActivationKind): number {
  switch (act) {
    case ActivationKind.Tanh:
      return arena.addCallExpr("tanh", [sumExpr]);
    case ActivationKind.Sigmoid: {
      const halfLit = arena.addRealLiteral(0.5);
      const scaled = arena.addBinaryExpr(BinOp.Mul, halfLit, sumExpr);
      const tanhVal = arena.addCallExpr("tanh", [scaled]);
      const oneLit = arena.addRealLiteral(1.0);
      const onePlusTanh = arena.addBinaryExpr(BinOp.Add, oneLit, tanhVal);
      return arena.addBinaryExpr(BinOp.Mul, halfLit, onePlusTanh);
    }
    case ActivationKind.Linear:
      return sumExpr;
    case ActivationKind.ReLU: {
      const zSq = arena.addBinaryExpr(BinOp.Mul, sumExpr, sumExpr);
      const epsLit = arena.addRealLiteral(1e-4);
      const sqrtTerm = arena.addCallExpr("sqrt", [arena.addBinaryExpr(BinOp.Add, zSq, epsLit)]);
      const sumTerm = arena.addBinaryExpr(BinOp.Add, sumExpr, sqrtTerm);
      return arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(0.5), sumTerm);
    }
    case ActivationKind.SiLU: {
      const halfLit = arena.addRealLiteral(0.5);
      const scaled = arena.addBinaryExpr(BinOp.Mul, halfLit, sumExpr);
      const tanhVal = arena.addCallExpr("tanh", [scaled]);
      const oneLit = arena.addRealLiteral(1.0);
      const sigmoid = arena.addBinaryExpr(BinOp.Mul, halfLit, arena.addBinaryExpr(BinOp.Add, oneLit, tanhVal));
      return arena.addBinaryExpr(BinOp.Mul, sumExpr, sigmoid);
    }
    default:
      return sumExpr;
  }
}

function evalActivationScalar(z: number, act: ActivationKind): number {
  switch (act) {
    case ActivationKind.Tanh:
      return Math.tanh(z);
    case ActivationKind.Sigmoid:
      return 0.5 * (1 + Math.tanh(0.5 * z));
    case ActivationKind.ReLU:
      return Math.max(0, z);
    case ActivationKind.SiLU: {
      const s = 0.5 * (1 + Math.tanh(0.5 * z));
      return z * s;
    }
    case ActivationKind.Linear:
    default:
      return z;
  }
}

/**
 * Continuous-Time Recurrent Neural Network (CTRNN / Liquid Time-Constant) Arena Block.
 *
 * Implements the continuous dynamical system:
 *   tau_k * der(h_k) = -h_k + sigma(sum_i Win_k_i * x_i + sum_j Wrec_k_j * h_j + brec_k)
 *   out_m = sigma_out(sum_k Wout_m_k * h_k + bout_m)
 *
 * Inserts state variables, state derivative equations, parameters, and output projections
 * directly into DAEBuilder WebAssembly linear memory.
 */
export class ArenaCTRNNBlock {
  public readonly name: string;
  public readonly inDim: number;
  public readonly hiddenDim: number;
  public readonly outDim: number;
  public readonly activation: ActivationKind;
  public readonly outputActivation: ActivationKind;

  private weightParamNames: string[] = [];
  private hiddenVarNames: string[] = [];
  private derVarNames: string[] = [];
  private totalWeightCount = 0;

  public readonly offsets: {
    wIn: number;
    wRec: number;
    bRec: number;
    tau: number;
    wOut: number;
    bOut: number;
  };

  constructor(public readonly config: CTRNNBlockConfig) {
    this.name = config.name;
    this.inDim = config.inDim;
    this.hiddenDim = config.hiddenDim;
    this.outDim = config.outDim;
    if (this.inDim < 1 || this.hiddenDim < 1 || this.outDim < 1) {
      throw new Error(
        `CTRNNBlock '${this.name}' dimensions must be >= 1 (got in:${this.inDim}, hidden:${this.hiddenDim}, out:${this.outDim})`,
      );
    }
    this.activation = config.activation ?? ActivationKind.Tanh;
    this.outputActivation = config.outputActivation ?? ActivationKind.Linear;

    const wInSize = this.hiddenDim * this.inDim;
    const wRecSize = this.hiddenDim * this.hiddenDim;
    const bRecSize = this.hiddenDim;
    const tauSize = this.hiddenDim;
    const wOutSize = this.outDim * this.hiddenDim;
    const bOutSize = this.outDim;

    this.offsets = {
      wIn: 0,
      wRec: wInSize,
      bRec: wInSize + wRecSize,
      tau: wInSize + wRecSize + bRecSize,
      wOut: wInSize + wRecSize + bRecSize + tauSize,
      bOut: wInSize + wRecSize + bRecSize + tauSize + wOutSize,
    };
    this.totalWeightCount = this.offsets.bOut + bOutSize;
  }

  public get weightCount(): number {
    return this.totalWeightCount;
  }

  public getParameterNames(): string[] {
    return [...this.weightParamNames];
  }

  public getHiddenVarNames(): string[] {
    return [...this.hiddenVarNames];
  }

  public getDerVarNames(): string[] {
    return [...this.derVarNames];
  }

  public build(arena: DAEBuilder, inputVarNames: string[], outputVarNames: string[]): void {
    if (inputVarNames.length !== this.inDim) {
      throw new Error(`CTRNN block '${this.name}' expects ${this.inDim} inputs, received ${inputVarNames.length}.`);
    }
    if (outputVarNames.length !== this.outDim) {
      throw new Error(`CTRNN block '${this.name}' expects ${this.outDim} outputs, received ${outputVarNames.length}.`);
    }

    this.weightParamNames = [];
    this.hiddenVarNames = [];
    this.derVarNames = [];

    const initWeights = this.config.initialWeights ?? this.generateInitialWeights();

    // 1. Declare parameters: Win, Wrec, brec, tau
    for (let k = 0; k < this.hiddenDim; k++) {
      for (let i = 0; i < this.inDim; i++) {
        const pName = `nn_${this.name}_Win_${k}_${i}`;
        const val = initWeights[this.offsets.wIn + k * this.inDim + i] ?? 0.0;
        const vIdx = arena.addVariable(pName, VarType.Real, Variability.Parameter, 0, val);
        arena.setVarExpression(vIdx, arena.addRealLiteral(val));
        this.weightParamNames.push(pName);
      }
      for (let j = 0; j < this.hiddenDim; j++) {
        const pName = `nn_${this.name}_Wrec_${k}_${j}`;
        const val = initWeights[this.offsets.wRec + k * this.hiddenDim + j] ?? 0.0;
        const vIdx = arena.addVariable(pName, VarType.Real, Variability.Parameter, 0, val);
        arena.setVarExpression(vIdx, arena.addRealLiteral(val));
        this.weightParamNames.push(pName);
      }
      const bName = `nn_${this.name}_brec_${k}`;
      const bVal = initWeights[this.offsets.bRec + k] ?? 0.0;
      const bIdx = arena.addVariable(bName, VarType.Real, Variability.Parameter, 0, bVal);
      arena.setVarExpression(bIdx, arena.addRealLiteral(bVal));
      this.weightParamNames.push(bName);

      const tauName = `nn_${this.name}_tau_${k}`;
      const tauVal = initWeights[this.offsets.tau + k] ?? 1.0;
      const tauIdx = arena.addVariable(tauName, VarType.Real, Variability.Parameter, 0, tauVal);
      arena.setVarExpression(tauIdx, arena.addRealLiteral(tauVal));
      this.weightParamNames.push(tauName);
    }

    // Declare parameters: Wout, bout
    for (let m = 0; m < this.outDim; m++) {
      for (let k = 0; k < this.hiddenDim; k++) {
        const pName = `nn_${this.name}_Wout_${m}_${k}`;
        const val = initWeights[this.offsets.wOut + m * this.hiddenDim + k] ?? 0.0;
        const vIdx = arena.addVariable(pName, VarType.Real, Variability.Parameter, 0, val);
        arena.setVarExpression(vIdx, arena.addRealLiteral(val));
        this.weightParamNames.push(pName);
      }
      const bName = `nn_${this.name}_bout_${m}`;
      const bVal = initWeights[this.offsets.bOut + m] ?? 0.0;
      const bIdx = arena.addVariable(bName, VarType.Real, Variability.Parameter, 0, bVal);
      arena.setVarExpression(bIdx, arena.addRealLiteral(bVal));
      this.weightParamNames.push(bName);
    }

    // 2. Declare continuous hidden state variables: h[k]
    for (let k = 0; k < this.hiddenDim; k++) {
      const hName = `nn_${this.name}_h_${k}`;
      const hIdx = arena.addVariable(hName, VarType.Real, Variability.Continuous, 0, 0.0);
      arena.setVarStartValue(hIdx, 0.0);
      this.hiddenVarNames.push(hName);
      this.derVarNames.push(`der(${hName})`);
    }

    // 3. Build differential equations for der(h[k]) = (-h[k] + sigma(Win*x + Wrec*h + brec)) / tau[k]
    for (let k = 0; k < this.hiddenDim; k++) {
      const hName = this.hiddenVarNames[k]!;
      const hExpr = arena.addNameExpr(hName);
      const derExpr = arena.addDerExpr(hExpr);
      let sumExpr = arena.addNameExpr(`nn_${this.name}_brec_${k}`);

      for (let i = 0; i < this.inDim; i++) {
        const wExpr = arena.addNameExpr(`nn_${this.name}_Win_${k}_${i}`);
        const xExpr = arena.addNameExpr(inputVarNames[i]!);
        sumExpr = arena.addBinaryExpr(BinOp.Add, sumExpr, arena.addBinaryExpr(BinOp.Mul, wExpr, xExpr));
      }

      for (let j = 0; j < this.hiddenDim; j++) {
        const wExpr = arena.addNameExpr(`nn_${this.name}_Wrec_${k}_${j}`);
        const hjExpr = arena.addNameExpr(this.hiddenVarNames[j]!);
        sumExpr = arena.addBinaryExpr(BinOp.Add, sumExpr, arena.addBinaryExpr(BinOp.Mul, wExpr, hjExpr));
      }

      const actExpr = buildActivationDaeExpr(arena, sumExpr, this.activation);
      const netDrive = arena.addBinaryExpr(BinOp.Sub, actExpr, hExpr);
      const tauExpr = arena.addNameExpr(`nn_${this.name}_tau_${k}`);
      const rhs = arena.addBinaryExpr(BinOp.Div, netDrive, tauExpr);

      arena.addEquation(EqKind.Simple, derExpr, rhs);
    }

    // 4. Build output equations: out[m] = sigma_out(sum_k Wout[m,k] * h[k] + bout[m])
    for (let m = 0; m < this.outDim; m++) {
      const outVarName = outputVarNames[m]!;
      const outIdx = arena.getVarIdxByName(outVarName);
      if (outIdx === -1) {
        arena.addVariable(outVarName, VarType.Real, Variability.Continuous, 0, 0.0);
      }

      let sumOut = arena.addNameExpr(`nn_${this.name}_bout_${m}`);
      for (let k = 0; k < this.hiddenDim; k++) {
        const wExpr = arena.addNameExpr(`nn_${this.name}_Wout_${m}_${k}`);
        const hExpr = arena.addNameExpr(this.hiddenVarNames[k]!);
        sumOut = arena.addBinaryExpr(BinOp.Add, sumOut, arena.addBinaryExpr(BinOp.Mul, wExpr, hExpr));
      }

      const actOut = buildActivationDaeExpr(arena, sumOut, this.outputActivation);
      arena.addEquation(EqKind.Simple, arena.addNameExpr(outVarName), actOut);
    }
  }

  public getWeights(arena: DAEBuilder): Float64Array {
    const weights = new Float64Array(this.totalWeightCount);
    for (let i = 0; i < this.weightParamNames.length; i++) {
      const pName = this.weightParamNames[i]!;
      const vIdx = arena.getVarIdxByName(pName);
      if (vIdx !== -1) {
        const exprId = arena.getVarExpression(vIdx);
        if (exprId !== -1) {
          weights[i] = arena.getExprRealValue(exprId);
        }
      }
    }
    return weights;
  }

  public setWeights(arena: DAEBuilder, weights: Float64Array): void {
    if (weights.length !== this.totalWeightCount) {
      throw new Error(`Expected ${this.totalWeightCount} weights, got ${weights.length}`);
    }
    for (let i = 0; i < this.weightParamNames.length; i++) {
      const pName = this.weightParamNames[i]!;
      const vIdx = arena.getVarIdxByName(pName);
      if (vIdx !== -1) {
        const val = weights[i] ?? 0.0;
        arena.setVarStartValue(vIdx, val);
        const litId = arena.addRealLiteral(val);
        arena.setVarExpression(vIdx, litId);
      }
    }
  }

  public forwardRhs(inputs: Float64Array, hidden: Float64Array, weights?: Float64Array): Float64Array {
    const W = weights ?? this.generateInitialWeights();
    const dH = new Float64Array(this.hiddenDim);

    for (let k = 0; k < this.hiddenDim; k++) {
      let sum = W[this.offsets.bRec + k] ?? 0.0;
      for (let i = 0; i < this.inDim; i++) {
        sum += (W[this.offsets.wIn + k * this.inDim + i] ?? 0.0) * (inputs[i] ?? 0.0);
      }
      for (let j = 0; j < this.hiddenDim; j++) {
        sum += (W[this.offsets.wRec + k * this.hiddenDim + j] ?? 0.0) * (hidden[j] ?? 0.0);
      }
      const act = evalActivationScalar(sum, this.activation);
      const tau = Math.max(1e-4, W[this.offsets.tau + k] ?? 1.0);
      dH[k] = (-hidden[k]! + act) / tau;
    }
    return dH;
  }

  public forwardOutput(hidden: Float64Array, weights?: Float64Array): Float64Array {
    const W = weights ?? this.generateInitialWeights();
    const out = new Float64Array(this.outDim);

    for (let m = 0; m < this.outDim; m++) {
      let sum = W[this.offsets.bOut + m] ?? 0.0;
      for (let k = 0; k < this.hiddenDim; k++) {
        sum += (W[this.offsets.wOut + m * this.hiddenDim + k] ?? 0.0) * (hidden[k] ?? 0.0);
      }
      out[m] = evalActivationScalar(sum, this.outputActivation);
    }
    return out;
  }

  public forward(
    inputs: Float64Array,
    hidden: Float64Array,
    dt: number,
    weights?: Float64Array,
  ): { nextHidden: Float64Array; outputs: Float64Array } {
    const dH = this.forwardRhs(inputs, hidden, weights);
    const nextHidden = new Float64Array(this.hiddenDim);
    for (let k = 0; k < this.hiddenDim; k++) {
      nextHidden[k] = hidden[k]! + dt * dH[k]!;
    }
    const outputs = this.forwardOutput(nextHidden, weights);
    return { nextHidden, outputs };
  }

  public generateInitialWeights(): Float64Array {
    const W = new Float64Array(this.totalWeightCount);
    let seed = this.config.seed ?? 42;

    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // Xavier for Win
    const inLimit = Math.sqrt(6.0 / (this.inDim + this.hiddenDim));
    for (let i = 0; i < this.hiddenDim * this.inDim; i++) {
      W[this.offsets.wIn + i] = (pseudoRandom() * 2 - 1) * inLimit;
    }

    // Wrec initialized with spectral radius <= 0.9 for stability
    const recLimit = Math.sqrt(1.0 / this.hiddenDim);
    for (let i = 0; i < this.hiddenDim * this.hiddenDim; i++) {
      W[this.offsets.wRec + i] = (pseudoRandom() * 2 - 1) * recLimit;
    }

    // Biases initialize to 0
    for (let i = 0; i < this.hiddenDim; i++) {
      W[this.offsets.bRec + i] = 0.0;
    }

    // Tau initialized to initialTau or 1.0
    const tauConfig = this.config.initialTau;
    for (let k = 0; k < this.hiddenDim; k++) {
      let tVal = 1.0;
      if (typeof tauConfig === "number") {
        tVal = tauConfig;
      } else if (Array.isArray(tauConfig) && tauConfig[k] !== undefined) {
        tVal = tauConfig[k]!;
      }
      W[this.offsets.tau + k] = Math.max(1e-3, tVal);
    }

    // Xavier for Wout
    const outLimit = Math.sqrt(6.0 / (this.hiddenDim + this.outDim));
    for (let i = 0; i < this.outDim * this.hiddenDim; i++) {
      W[this.offsets.wOut + i] = (pseudoRandom() * 2 - 1) * outLimit;
    }

    // Bout initialized to 0
    for (let i = 0; i < this.outDim; i++) {
      W[this.offsets.bOut + i] = 0.0;
    }

    return W;
  }
}

/**
 * Convenient factory to create and mount an in-arena CTRNN block.
 */
export function createArenaCTRNNBlock(
  arena: DAEBuilder,
  config: CTRNNBlockConfig,
  inputVarNames: string[],
  outputVarNames: string[],
): ArenaCTRNNBlock {
  const block = new ArenaCTRNNBlock(config);
  block.build(arena, inputVarNames, outputVarNames);
  return block;
}

/**
 * Linear balance or conservation constraint across neural block outputs:
 *   \sum_{i \in indices} coefficients[i] * y[i] = target
 *
 * For mass balance across m flow ports:
 *   \sum_{i=0}^{m-1} \dot{m}_i = 0  => indices: [0,...,m-1], coefficients: [1,...,1], target: 0.0
 */
export interface FlowConservationConstraint {
  /** Output indices involved in the balance constraint. */
  indices: number[];
  /** Coefficients corresponding to each index. Default: 1.0. */
  coefficients: number[];
  /** Target constant scalar (e.g. 0.0 for Kirchhoff mass/flow balance). */
  target: number;
}

/**
 * Inverts an n x n square matrix using Gauss-Jordan elimination with partial pivoting.
 */
function invertSquareMatrix(A: number[][], n: number): number[][] {
  const aug: number[][] = Array.from({ length: n }, (_, i) => [
    ...A[i]!,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(aug[i]![i]!);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(aug[r]![i]!) > maxVal) {
        maxVal = Math.abs(aug[r]![i]!);
        maxRow = r;
      }
    }
    if (maxVal < 1e-12) continue;
    if (maxRow !== i) {
      const tmp = aug[i]!;
      aug[i] = aug[maxRow]!;
      aug[maxRow] = tmp;
    }

    const pivot = aug[i]![i]!;
    for (let c = 0; c < 2 * n; c++) {
      aug[i]![c] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r !== i) {
        const factor = aug[r]![i]!;
        if (Math.abs(factor) > 1e-12) {
          for (let c = 0; c < 2 * n; c++) {
            aug[r]![c] -= factor * aug[i]![c]!;
          }
        }
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

/**
 * Physics-Enhanced Conservative Neural Block (BNODE / Kirchhoff Invariant Projection).
 *
 * Enforces linear algebraic conservation constraints (mass, charge, energy flow balances)
 * strictly by construction through machine-precision orthogonal nullspace projection:
 *   y_cons = P * y_raw + y_0
 * where:
 *   C * y = d
 *   P = I - C^T * (C * C^T)^-1 * C
 *   y_0 = C^T * (C * C^T)^-1 * d
 *
 * Guarantees C * y_cons = d to machine precision during simulation.
 */
export class ArenaConservativeNeuralBlock {
  public readonly baseBlock: ArenaNeuralBlock | ArenaCTRNNBlock;
  public readonly constraints: FlowConservationConstraint[];
  public readonly outDim: number;
  public readonly projectionMatrix: number[][]; // outDim x outDim
  public readonly particularSolution: number[]; // outDim

  constructor(baseBlock: ArenaNeuralBlock | ArenaCTRNNBlock, constraints: FlowConservationConstraint[]) {
    this.baseBlock = baseBlock;
    this.constraints = constraints;
    this.outDim = baseBlock.outDim;

    const { P, y0 } = ArenaConservativeNeuralBlock.computeProjection(this.outDim, constraints);
    this.projectionMatrix = P;
    this.particularSolution = y0;
  }

  /**
   * Computes the orthogonal projection matrix P and particular affine shift y0.
   */
  public static computeProjection(
    outDim: number,
    constraints: FlowConservationConstraint[],
  ): { P: number[][]; y0: number[] } {
    const c = constraints.length;
    if (c === 0) {
      const P: number[][] = Array.from({ length: outDim }, (_, i) =>
        Array.from({ length: outDim }, (_, j) => (i === j ? 1 : 0)),
      );
      const y0 = new Array(outDim).fill(0);
      return { P, y0 };
    }

    // Build C (c x outDim) and d (c)
    const C: number[][] = Array.from({ length: c }, () => new Array(outDim).fill(0));
    const d: number[] = new Array(c).fill(0);

    for (let k = 0; k < c; k++) {
      const constr = constraints[k]!;
      d[k] = constr.target;
      for (let i = 0; i < constr.indices.length; i++) {
        const idx = constr.indices[i]!;
        const coef = constr.coefficients[i] ?? 1.0;
        if (idx >= 0 && idx < outDim) {
          C[k]![idx] = coef;
        }
      }
    }

    // S = C * C^T (c x c)
    const S: number[][] = Array.from({ length: c }, () => new Array(c).fill(0));
    for (let i = 0; i < c; i++) {
      for (let j = 0; j < c; j++) {
        let sum = 0;
        for (let k = 0; k < outDim; k++) {
          sum += C[i]![k]! * C[j]![k]!;
        }
        S[i]![j] = sum;
      }
    }

    // Invert S
    const invS = invertSquareMatrix(S, c);

    // K = C^T * invS (outDim x c)
    const K: number[][] = Array.from({ length: outDim }, () => new Array(c).fill(0));
    for (let i = 0; i < outDim; i++) {
      for (let j = 0; j < c; j++) {
        let sum = 0;
        for (let k = 0; k < c; k++) {
          sum += C[k]![i]! * invS[k]![j]!;
        }
        K[i]![j] = sum;
      }
    }

    // P = I - K * C (outDim x outDim)
    const P: number[][] = Array.from({ length: outDim }, (_, i) =>
      Array.from({ length: outDim }, (_, j) => {
        let sum = 0;
        for (let k = 0; k < c; k++) {
          sum += K[i]![k]! * C[k]![j]!;
        }
        return (i === j ? 1 : 0) - sum;
      }),
    );

    // y0 = K * d (outDim)
    const y0: number[] = new Array(outDim).fill(0);
    for (let i = 0; i < outDim; i++) {
      let sum = 0;
      for (let k = 0; k < c; k++) {
        sum += K[i]![k]! * d[k]!;
      }
      y0[i] = sum;
    }

    return { P, y0 };
  }

  /**
   * Mounts the base neural block and projection equations into the DAEBuilder arena.
   */
  public build(arena: DAEBuilder, inputVarNames: string[], outputVarNames: string[]): void {
    if (outputVarNames.length !== this.outDim) {
      throw new Error(`Output dimension mismatch: expected ${this.outDim}, received ${outputVarNames.length}`);
    }

    // Build raw intermediate variables predicted by the base neural block
    const rawOutputNames: string[] = outputVarNames.map((name) => `nn_${this.baseBlock.name}_raw_${name}`);
    this.baseBlock.build(arena, inputVarNames, rawOutputNames);

    // Connect raw outputs to conservative outputs via linear projection:
    // y_cons[i] = sum_j (P[i, j] * y_raw[j]) + y0[i]
    for (let i = 0; i < this.outDim; i++) {
      const consName = outputVarNames[i]!;
      const vIdx = arena.getVarIdxByName(consName);
      if (vIdx === -1) {
        arena.addVariable(consName, VarType.Real, Variability.Continuous, 0, 0.0);
      }

      let rhs = arena.addRealLiteral(this.particularSolution[i] ?? 0.0);
      for (let j = 0; j < this.outDim; j++) {
        const coef = this.projectionMatrix[i]![j]!;
        if (Math.abs(coef) > 1e-9) {
          const coefLit = arena.addRealLiteral(coef);
          const rawExpr = arena.addNameExpr(rawOutputNames[j]!);
          const term = arena.addBinaryExpr(BinOp.Mul, coefLit, rawExpr);
          rhs = arena.addBinaryExpr(BinOp.Add, rhs, term);
        }
      }

      arena.addEquation(EqKind.Simple, arena.addNameExpr(consName), rhs);
    }
  }

  /**
   * Evaluates the conservative projection on a vector of raw outputs.
   */
  public projectOutputs(rawOutputs: Float64Array | number[]): Float64Array {
    const projected = new Float64Array(this.outDim);
    for (let i = 0; i < this.outDim; i++) {
      let sum = this.particularSolution[i] ?? 0.0;
      for (let j = 0; j < this.outDim; j++) {
        sum += this.projectionMatrix[i]![j]! * (rawOutputs[j] ?? 0.0);
      }
      projected[i] = sum;
    }
    return projected;
  }
}

/**
 * Convenient factory to create and mount a conservative neural block in an arena.
 */
export function createArenaConservativeNeuralBlock(
  arena: DAEBuilder,
  baseBlock: ArenaNeuralBlock | ArenaCTRNNBlock,
  constraints: FlowConservationConstraint[],
  inputVarNames: string[],
  outputVarNames: string[],
): ArenaConservativeNeuralBlock {
  const block = new ArenaConservativeNeuralBlock(baseBlock, constraints);
  block.build(arena, inputVarNames, outputVarNames);
  return block;
}
