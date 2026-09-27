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
    const W = weights ?? this.generateXavierWeights();
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
    const W = weights ?? this.generateXavierWeights();
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
