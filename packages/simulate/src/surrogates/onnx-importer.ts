// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure TypeScript Zero-Dependency ONNX Graph Importer.
 *
 * Ingests pre-trained neural networks (from PyTorch, TensorFlow, JAX, or ModelScript)
 * represented as ONNX graph structures and compiles them into:
 *   1. `TrainedROM`: For high-throughput CPU/WASM evaluation and C99/FMU codegen.
 *   2. `ArenaNeuralBlock`: For direct in-arena DAE equation system embedding and adjoint sensitivity.
 */

import { ActivationKind, ArenaNeuralBlock } from "@modelscript/runtime";
import type { OnnxGraphExport, OnnxTensorProto, ScalingParams, TrainedROM } from "./rom-trainer.js";

export interface OnnxImportOptions {
  /** Override input names. */
  inputNames?: string[];
  /** Override output names. */
  outputNames?: string[];
  /** Optional parameter bounds for extrapolation detection. */
  parameterBounds?: Record<string, { min: number; max: number }>;
}

/**
 * Imports an ONNX graph structure into a TrainedROM (MLP architecture).
 */
export function importONNXToROM(onnxInput: OnnxGraphExport | string, options?: OnnxImportOptions): TrainedROM {
  const onnx: OnnxGraphExport = typeof onnxInput === "string" ? JSON.parse(onnxInput) : onnxInput;

  if (!onnx.graph) {
    throw new Error("Invalid ONNX graph: missing 'graph' object.");
  }

  // 1. Build initializers map
  const initializers = new Map<string, OnnxTensorProto>();
  for (const init of onnx.graph.initializers ?? []) {
    initializers.set(init.name, init);
  }

  // 2. Extract input / output normalization if present
  let inputScaling: ScalingParams[] = [];
  const meanInit = initializers.get("input_mean");
  const stdInit = initializers.get("input_std");

  if (meanInit && stdInit) {
    const n = Math.min(meanInit.data.length, stdInit.data.length);
    for (let i = 0; i < n; i++) {
      inputScaling.push({
        mean: meanInit.data[i] ?? 0.0,
        std: stdInit.data[i] ?? 1.0,
      });
    }
  }

  let outputScaling: ScalingParams[] = [];
  const outMeanInit = initializers.get("output_mean");
  const outStdInit = initializers.get("output_std");

  if (outMeanInit && outStdInit) {
    const n = Math.min(outMeanInit.data.length, outStdInit.data.length);
    for (let i = 0; i < n; i++) {
      outputScaling.push({
        mean: outMeanInit.data[i] ?? 0.0,
        std: outStdInit.data[i] ?? 1.0,
      });
    }
  }

  // 3. Parse linear layers (Gemm / MatMul) and activations
  const layers: { W: number[][]; b: number[] }[] = [];
  let detectedActivation: "tanh" | "relu" | "sigmoid" = "tanh";

  const nodes = onnx.graph.nodes ?? [];
  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx]!;

    if (node.opType === "Gemm") {
      // Gemm inputs: [A, B, C] where B is weights and C is bias
      const wName = node.inputs[1];
      const bName = node.inputs[2];
      const wInit = wName ? initializers.get(wName) : undefined;
      const bInit = bName ? initializers.get(bName) : undefined;

      if (!wInit || !bInit) {
        throw new Error(`Gemm node '${node.name ?? idx}' missing initializers for weights or bias.`);
      }

      const fanOut = wInit.dims[0] ?? 1;
      const fanIn = wInit.dims[1] ?? wInit.data.length / fanOut;

      const W: number[][] = [];
      for (let i = 0; i < fanOut; i++) {
        const row: number[] = [];
        for (let j = 0; j < fanIn; j++) {
          row.push(wInit.data[i * fanIn + j] ?? 0.0);
        }
        W.push(row);
      }

      const b = Array.from(bInit.data);
      layers.push({ W, b });
    } else if (node.opType === "Tanh") {
      detectedActivation = "tanh";
    } else if (node.opType === "Relu") {
      detectedActivation = "relu";
    } else if (node.opType === "Sigmoid") {
      detectedActivation = "sigmoid";
    }
  }

  if (layers.length === 0) {
    throw new Error("No trainable linear layers (Gemm) found in ONNX graph.");
  }

  const nIn = layers[0]!.W[0]!.length;
  const nOut = layers[layers.length - 1]!.W.length;

  // Fallback default scaling if none was specified in graph
  if (inputScaling.length !== nIn) {
    inputScaling = Array.from({ length: nIn }, () => ({ mean: 0.0, std: 1.0 }));
  }
  if (outputScaling.length !== nOut) {
    outputScaling = Array.from({ length: nOut }, () => ({ mean: 0.0, std: 1.0 }));
  }

  // Input & output names
  const metaInputNames = onnx.metadataProps?.inputNames
    ? onnx.metadataProps.inputNames.split(",").map((s) => s.trim())
    : undefined;
  const metaOutputNames = onnx.metadataProps?.outputNames
    ? onnx.metadataProps.outputNames.split(",").map((s) => s.trim())
    : undefined;

  const inputNames =
    options?.inputNames ??
    (metaInputNames && metaInputNames.length === nIn ? metaInputNames : undefined) ??
    (nIn === 1 ? ["u"] : Array.from({ length: nIn }, (_, i) => `in_${i + 1}`));

  const outputNames =
    options?.outputNames ??
    (metaOutputNames && metaOutputNames.length === nOut ? metaOutputNames : undefined) ??
    (nOut === 1 ? ["y"] : Array.from({ length: nOut }, (_, i) => `out_${i + 1}`));

  return {
    architecture: "mlp",
    inputNames,
    outputNames,
    inputScaling,
    outputScaling,
    parameterBounds: options?.parameterBounds,
    weights: {
      type: "mlp",
      layers,
      activation: detectedActivation,
    },
    metrics: { trainMSE: 0.0, valMSE: 0.0, r2: 1.0 },
  };
}

/**
 * Imports an ONNX graph directly into an in-arena DAE `ArenaNeuralBlock`.
 */
export function importONNXToArenaNeuralBlock(
  onnxInput: OnnxGraphExport | string,
  blockName: string,
  options?: OnnxImportOptions,
): ArenaNeuralBlock {
  const rom = importONNXToROM(onnxInput, options);

  if (rom.weights.type !== "mlp") {
    throw new Error("Only MLP ONNX graphs can be lowered to ArenaNeuralBlock.");
  }

  const mlp = rom.weights;
  const layerDims: number[] = [mlp.layers[0]!.W[0]!.length];
  for (const l of mlp.layers) {
    layerDims.push(l.W.length);
  }

  // Pack weights in Xavier layout expected by ArenaNeuralBlock
  // For each layer l:
  //   [W_offset, b_offset]
  let totalWeights = 0;
  for (let l = 0; l < mlp.layers.length; l++) {
    const inDim = layerDims[l]!;
    const outDim = layerDims[l + 1]!;
    totalWeights += outDim * inDim + outDim;
  }

  const packedWeights = new Float64Array(totalWeights);
  let offset = 0;

  for (let l = 0; l < mlp.layers.length; l++) {
    const layer = mlp.layers[l]!;
    const inDim = layerDims[l]!;
    const outDim = layerDims[l + 1]!;
    const wSize = outDim * inDim;
    const bOffset = offset + wSize;

    // Biases: at bOffset + j
    for (let j = 0; j < outDim; j++) {
      packedWeights[bOffset + j] = layer.b[j] ?? 0.0;
    }

    // Weights: at offset + j * inDim + i
    for (let j = 0; j < outDim; j++) {
      for (let i = 0; i < inDim; i++) {
        packedWeights[offset + j * inDim + i] = layer.W[j]![i] ?? 0.0;
      }
    }

    offset += wSize + outDim;
  }

  let actKind = ActivationKind.Tanh;
  if (mlp.activation === "relu") actKind = ActivationKind.ReLU;
  else if (mlp.activation === "sigmoid") actKind = ActivationKind.Sigmoid;

  return new ArenaNeuralBlock({
    name: blockName,
    layers: layerDims,
    activation: actKind,
    outputActivation: ActivationKind.Linear,
    initialWeights: packedWeights,
  });
}
