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
  inputNames?: string[] | undefined;
  /** Override output names. */
  outputNames?: string[] | undefined;
  /** Optional parameter bounds for extrapolation detection. */
  parameterBounds?: Record<string, { min: number; max: number }> | undefined;
}

/**
 * Decodes a binary ONNX `ModelProto` wire buffer into `OnnxGraphExport` without external dependencies.
 */
function decodeBinaryOnnxModelProto(bytes: Uint8Array): OnnxGraphExport {
  const textDecoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const readVarint = (state: { pos: number }): number => {
    let result = 0;
    let shift = 0;
    while (state.pos < bytes.length) {
      const b = bytes[state.pos++]!;
      result += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  };

  const skipField = (state: { pos: number }, wireType: number): void => {
    if (wireType === 0) {
      readVarint(state);
    } else if (wireType === 1) {
      state.pos += 8;
    } else if (wireType === 2) {
      const len = readVarint(state);
      state.pos += len;
    } else if (wireType === 5) {
      state.pos += 4;
    } else {
      throw new Error(`Unsupported protobuf wireType ${wireType} in ONNX binary stream.`);
    }
  };

  const parseValueInfo = (end: number, state: { pos: number }): { name: string; dims: (number | string)[] } => {
    let name = "";
    const dims: (number | string)[] = [];
    while (state.pos < end) {
      const tag = readVarint(state);
      const fieldNo = tag >>> 3;
      const wireType = tag & 7;
      if (fieldNo === 1 && wireType === 2) {
        const len = readVarint(state);
        name = textDecoder.decode(bytes.subarray(state.pos, state.pos + len));
        state.pos += len;
      } else {
        skipField(state, wireType);
      }
    }
    return { name, dims };
  };

  type OnnxNodeOpType = OnnxGraphExport["graph"]["nodes"][number]["opType"];
  const parseNodeProto = (end: number, state: { pos: number }) => {
    const inputs: string[] = [];
    const outputs: string[] = [];
    let name: string | undefined;
    let opType: OnnxNodeOpType = "Gemm";
    while (state.pos < end) {
      const tag = readVarint(state);
      const fieldNo = tag >>> 3;
      const wireType = tag & 7;
      if (fieldNo === 1 && wireType === 2) {
        const len = readVarint(state);
        inputs.push(textDecoder.decode(bytes.subarray(state.pos, state.pos + len)));
        state.pos += len;
      } else if (fieldNo === 2 && wireType === 2) {
        const len = readVarint(state);
        outputs.push(textDecoder.decode(bytes.subarray(state.pos, state.pos + len)));
        state.pos += len;
      } else if (fieldNo === 3 && wireType === 2) {
        const len = readVarint(state);
        name = textDecoder.decode(bytes.subarray(state.pos, state.pos + len));
        state.pos += len;
      } else if (fieldNo === 4 && wireType === 2) {
        const len = readVarint(state);
        opType = textDecoder.decode(bytes.subarray(state.pos, state.pos + len)) as OnnxNodeOpType;
        state.pos += len;
      } else {
        skipField(state, wireType);
      }
    }
    return { opType, inputs, outputs, ...(name ? { name } : {}) };
  };

  const parseTensorProto = (end: number, state: { pos: number }): OnnxTensorProto => {
    let name = "";
    const dims: number[] = [];
    let dataTypeNum = 1; // 1 = FLOAT, 11 = DOUBLE
    const data: number[] = [];
    let rawDataRange: [number, number] | null = null;

    while (state.pos < end) {
      const tag = readVarint(state);
      const fieldNo = tag >>> 3;
      const wireType = tag & 7;
      if (fieldNo === 1) {
        if (wireType === 0) {
          dims.push(readVarint(state));
        } else if (wireType === 2) {
          const len = readVarint(state);
          const subEnd = state.pos + len;
          while (state.pos < subEnd) dims.push(readVarint(state));
        } else {
          skipField(state, wireType);
        }
      } else if (fieldNo === 2 && wireType === 0) {
        dataTypeNum = readVarint(state);
      } else if (fieldNo === 4) {
        if (wireType === 5) {
          data.push(view.getFloat32(state.pos, true));
          state.pos += 4;
        } else if (wireType === 2) {
          const len = readVarint(state);
          for (let off = 0; off + 4 <= len; off += 4) {
            data.push(view.getFloat32(state.pos + off, true));
          }
          state.pos += len;
        } else {
          skipField(state, wireType);
        }
      } else if (fieldNo === 8 && wireType === 2) {
        const len = readVarint(state);
        name = textDecoder.decode(bytes.subarray(state.pos, state.pos + len));
        state.pos += len;
      } else if (fieldNo === 9 && wireType === 2) {
        const len = readVarint(state);
        rawDataRange = [state.pos, state.pos + len];
        state.pos += len;
      } else if (fieldNo === 10) {
        if (wireType === 1) {
          data.push(view.getFloat64(state.pos, true));
          state.pos += 8;
        } else if (wireType === 2) {
          const len = readVarint(state);
          for (let off = 0; off + 8 <= len; off += 8) {
            data.push(view.getFloat64(state.pos + off, true));
          }
          state.pos += len;
        } else {
          skipField(state, wireType);
        }
      } else {
        skipField(state, wireType);
      }
    }

    if (data.length === 0 && rawDataRange) {
      const [start, stop] = rawDataRange;
      if (dataTypeNum === 11) {
        for (let p = start; p + 8 <= stop; p += 8) {
          data.push(view.getFloat64(p, true));
        }
      } else {
        for (let p = start; p + 4 <= stop; p += 4) {
          data.push(view.getFloat32(p, true));
        }
      }
    }

    return {
      name,
      dims,
      dataType: dataTypeNum === 11 ? "FLOAT64" : "FLOAT32",
      data,
    };
  };

  let producerName = "ONNX";
  const metadataProps: Record<string, string> = {};
  let graphName = "graph";
  const graphInputs: { name: string; dims: (number | string)[] }[] = [];
  const graphOutputs: { name: string; dims: (number | string)[] }[] = [];
  const nodes: OnnxGraphExport["graph"]["nodes"] = [];
  const initializers: OnnxTensorProto[] = [];
  let hasGraph = false;

  const state = { pos: 0 };
  while (state.pos < bytes.length) {
    const tag = readVarint(state);
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNo === 2 && wireType === 2) {
      const len = readVarint(state);
      producerName = textDecoder.decode(bytes.subarray(state.pos, state.pos + len));
      state.pos += len;
    } else if (fieldNo === 7 && wireType === 2) {
      hasGraph = true;
      const gLen = readVarint(state);
      const gEnd = state.pos + gLen;
      while (state.pos < gEnd) {
        const gTag = readVarint(state);
        const gField = gTag >>> 3;
        const gWire = gTag & 7;
        if (gField === 1 && gWire === 2) {
          const nLen = readVarint(state);
          nodes.push(parseNodeProto(state.pos + nLen, state));
        } else if (gField === 2 && gWire === 2) {
          const nLen = readVarint(state);
          graphName = textDecoder.decode(bytes.subarray(state.pos, state.pos + nLen));
          state.pos += nLen;
        } else if (gField === 5 && gWire === 2) {
          const tLen = readVarint(state);
          initializers.push(parseTensorProto(state.pos + tLen, state));
        } else if (gField === 11 && gWire === 2) {
          const vLen = readVarint(state);
          graphInputs.push(parseValueInfo(state.pos + vLen, state));
        } else if (gField === 12 && gWire === 2) {
          const vLen = readVarint(state);
          graphOutputs.push(parseValueInfo(state.pos + vLen, state));
        } else {
          skipField(state, gWire);
        }
      }
    } else if (fieldNo === 14 && wireType === 2) {
      const mLen = readVarint(state);
      const mEnd = state.pos + mLen;
      let k = "";
      let v = "";
      while (state.pos < mEnd) {
        const mTag = readVarint(state);
        const mField = mTag >>> 3;
        const mWire = mTag & 7;
        if (mField === 1 && mWire === 2) {
          const len = readVarint(state);
          k = textDecoder.decode(bytes.subarray(state.pos, state.pos + len));
          state.pos += len;
        } else if (mField === 2 && mWire === 2) {
          const len = readVarint(state);
          v = textDecoder.decode(bytes.subarray(state.pos, state.pos + len));
          state.pos += len;
        } else {
          skipField(state, mWire);
        }
      }
      if (k) metadataProps[k] = v;
    } else {
      skipField(state, wireType);
    }
  }

  if (!hasGraph) {
    throw new Error("Invalid binary ONNX ModelProto: missing 'graph' field.");
  }

  return {
    producerName,
    modelFormat: "ONNX-v1.14",
    ...(Object.keys(metadataProps).length > 0 ? { metadataProps } : {}),
    graph: {
      name: graphName,
      inputs: graphInputs,
      outputs: graphOutputs,
      nodes,
      initializers,
    },
  };
}

function resolveOnnxGraphInput(onnxInput: OnnxGraphExport | string | Uint8Array | ArrayBuffer): OnnxGraphExport {
  if (onnxInput instanceof Uint8Array) {
    return decodeBinaryOnnxModelProto(onnxInput);
  }
  if (onnxInput instanceof ArrayBuffer) {
    return decodeBinaryOnnxModelProto(new Uint8Array(onnxInput));
  }
  if (typeof onnxInput === "string") {
    const trimmed = onnxInput.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as OnnxGraphExport;
    }
    const bytes = new Uint8Array(onnxInput.length);
    for (let i = 0; i < onnxInput.length; i++) {
      bytes[i] = onnxInput.charCodeAt(i) & 0xff;
    }
    return decodeBinaryOnnxModelProto(bytes);
  }
  return onnxInput;
}

/**
 * Imports an ONNX graph structure (JSON or binary protobuf wire format) into a TrainedROM (MLP architecture).
 */
export function importONNXToROM(
  onnxInput: OnnxGraphExport | string | Uint8Array | ArrayBuffer,
  options?: OnnxImportOptions,
): TrainedROM {
  const onnx: OnnxGraphExport = resolveOnnxGraphInput(onnxInput);

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

  // 3. Parse linear layers (Gemm / MatMul + optional Add) and per-layer activations
  const layers: { W: number[][]; b: number[] }[] = [];
  const layerActivations: ("tanh" | "relu" | "sigmoid" | "linear")[] = [];
  let detectedActivation: "tanh" | "relu" | "sigmoid" = "tanh";
  let hasExplicitActivation = false;

  const nodes = onnx.graph.nodes ?? [];
  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx]!;
    const opType = node.opType as string;

    if (opType === "Gemm") {
      // Gemm inputs: [A, B, C?] where B is weights [fanOut, fanIn] and C is optional bias [fanOut]
      const wName = node.inputs[1];
      const bName = node.inputs[2];
      const wInit = wName ? initializers.get(wName) : undefined;
      const bInit = bName ? initializers.get(bName) : undefined;

      if (!wInit) {
        throw new Error(`Gemm node '${node.name ?? idx}' missing initializer for weights.`);
      }

      const fanOut = wInit.dims[0] ?? (bInit ? bInit.data.length : 1);
      const fanIn = wInit.dims[1] ?? wInit.data.length / fanOut;

      const W: number[][] = [];
      for (let i = 0; i < fanOut; i++) {
        const row: number[] = [];
        for (let j = 0; j < fanIn; j++) {
          row.push(wInit.data[i * fanIn + j] ?? 0.0);
        }
        W.push(row);
      }

      const b = bInit ? Array.from(bInit.data) : new Array<number>(fanOut).fill(0.0);
      layers.push({ W, b });
      layerActivations.push("linear");
    } else if (opType === "MatMul") {
      // MatMul inputs: [X, W] where W has shape [fanIn, fanOut]
      const in0 = node.inputs[0];
      const in1 = node.inputs[1];
      const wInit = (in1 ? initializers.get(in1) : undefined) ?? (in0 ? initializers.get(in0) : undefined);

      if (!wInit) {
        throw new Error(`MatMul node '${node.name ?? idx}' missing weight initializer.`);
      }

      const fanIn = wInit.dims[0] ?? 1;
      const fanOut = wInit.dims[1] ?? wInit.data.length / fanIn;

      // Transpose W from [fanIn, fanOut] to ROM row-major [fanOut, fanIn]
      const W: number[][] = [];
      for (let i = 0; i < fanOut; i++) {
        const row: number[] = [];
        for (let j = 0; j < fanIn; j++) {
          row.push(wInit.data[j * fanOut + i] ?? 0.0);
        }
        W.push(row);
      }

      const b = new Array<number>(fanOut).fill(0.0);
      layers.push({ W, b });
      layerActivations.push("linear");
    } else if (opType === "Add" && layers.length > 0) {
      // Attach bias if one of the Add inputs is a layer bias initializer (and not "output_mean")
      const in0 = node.inputs[0];
      const in1 = node.inputs[1];
      const bName = in1 && initializers.has(in1) ? in1 : in0 && initializers.has(in0) ? in0 : undefined;
      if (bName && bName !== "output_mean" && bName !== "input_mean") {
        const bInit = initializers.get(bName)!;
        const lastLayer = layers[layers.length - 1]!;
        if (bInit.data.length === lastLayer.W.length) {
          for (let i = 0; i < lastLayer.b.length; i++) {
            lastLayer.b[i] = (lastLayer.b[i] ?? 0) + (bInit.data[i] ?? 0);
          }
        }
      }
    } else if (opType === "Tanh" && layers.length > 0) {
      layerActivations[layers.length - 1] = "tanh";
      if (!hasExplicitActivation) {
        detectedActivation = "tanh";
        hasExplicitActivation = true;
      }
    } else if (opType === "Relu" && layers.length > 0) {
      layerActivations[layers.length - 1] = "relu";
      if (!hasExplicitActivation) {
        detectedActivation = "relu";
        hasExplicitActivation = true;
      }
    } else if (opType === "Sigmoid" && layers.length > 0) {
      layerActivations[layers.length - 1] = "sigmoid";
      if (!hasExplicitActivation) {
        detectedActivation = "sigmoid";
        hasExplicitActivation = true;
      }
    }
  }

  if (layers.length === 0) {
    throw new Error("No trainable linear layers (Gemm or MatMul) found in ONNX graph.");
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
  const rawMetaInputs = onnx.metadataProps?.["inputNames"];
  const metaInputNames = rawMetaInputs ? rawMetaInputs.split(",").map((s) => s.trim()) : undefined;
  const rawMetaOutputs = onnx.metadataProps?.["outputNames"];
  const metaOutputNames = rawMetaOutputs ? rawMetaOutputs.split(",").map((s) => s.trim()) : undefined;

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
      layerActivations,
    },
    metrics: { trainMSE: 0.0, valMSE: 0.0, r2: 1.0 },
  };
}

/**
 * Imports an ONNX graph (JSON or binary protobuf wire format) directly into an in-arena DAE `ArenaNeuralBlock`.
 */
export function importONNXToArenaNeuralBlock(
  onnxInput: OnnxGraphExport | string | Uint8Array | ArrayBuffer,
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

  const mapAct = (a: string | undefined): ActivationKind => {
    if (a === "relu") return ActivationKind.ReLU;
    if (a === "sigmoid") return ActivationKind.Sigmoid;
    if (a === "linear") return ActivationKind.Linear;
    return ActivationKind.Tanh;
  };

  const hiddenAct = mapAct(mlp.layerActivations?.[0] ?? mlp.activation);
  const outAct = mapAct(mlp.layerActivations?.[mlp.layers.length - 1] ?? "linear");

  return new ArenaNeuralBlock({
    name: blockName,
    layers: layerDims,
    activation: hiddenAct,
    outputActivation: outAct,
    initialWeights: packedWeights,
  });
}
