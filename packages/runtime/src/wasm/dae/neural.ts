// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Multi-Layer Perceptron (MLP) Forward & Vector-Jacobian Product (VJP) Kernels.
 * Supports Linear (0), Tanh (1), Sigmoid (2), ReLU (3), SiLU (4), ELU (5) activations
 * directly in WebAssembly linear memory with zero garbage collection.
 */

@inline
function evalAct(z: f64, act: i32): f64 {
  if (act == 1) return Math.tanh(z);
  if (act == 2) return 0.5 * (1.0 + Math.tanh(0.5 * z));
  if (act == 3) return z > 0.0 ? z : 0.0;
  if (act == 4) return z * (0.5 * (1.0 + Math.tanh(0.5 * z)));
  if (act == 5) return z >= 0.0 ? z : Math.exp(z) - 1.0;
  return z;
}

@inline
function evalActDeriv(z: f64, act: i32): f64 {
  if (act == 1) {
    const t = Math.tanh(z);
    return 1.0 - t * t;
  }
  if (act == 2) {
    const s = 0.5 * (1.0 + Math.tanh(0.5 * z));
    return s * (1.0 - s);
  }
  if (act == 3) return z > 0.0 ? 1.0 : 0.0;
  if (act == 4) {
    const s = 0.5 * (1.0 + Math.tanh(0.5 * z));
    return s + z * s * (1.0 - s);
  }
  if (act == 5) return z >= 0.0 ? 1.0 : Math.exp(z);
  return 1.0;
}

/**
 * Vectorized MLP forward pass in linear memory.
 * - layerInfoPtr: i32[numLayers * 4] packed as [wOffset, bOffset, inDim, outDim] per layer
 * - numLayers: number of linear layers
 * - weightsPtr: f64[totalWeights]
 * - inputsPtr: f64[inDim0]
 * - outPtr: f64[outDimLast]
 * - hiddenAct / outAct: ActivationKind enum (0..5)
 * - scratchAPtr, scratchBPtr: f64[maxLayerDim] ping-pong activation buffers
 */
export function nn_mlpForward(
  layerInfoPtr: usize,
  numLayers: i32,
  weightsPtr: usize,
  inputsPtr: usize,
  outPtr: usize,
  hiddenAct: i32,
  outAct: i32,
  scratchAPtr: usize,
  scratchBPtr: usize,
): void {
  if (numLayers <= 0) return;

  const firstInDim = load<i32>(layerInfoPtr + 8);
  memory.copy(scratchAPtr, inputsPtr, (<usize>firstInDim) << 3);

  let currPtr = scratchAPtr;
  let nextPtr = scratchBPtr;

  for (let l: i32 = 0; l < numLayers; l++) {
    const infoOff = (<usize>(l * 4)) << 2;
    const wOffset = load<i32>(layerInfoPtr + infoOff);
    const bOffset = load<i32>(layerInfoPtr + infoOff + 4);
    const inDim = load<i32>(layerInfoPtr + infoOff + 8);
    const outDim = load<i32>(layerInfoPtr + infoOff + 12);
    const act = l == numLayers - 1 ? outAct : hiddenAct;
    const dstPtr = l == numLayers - 1 ? outPtr : nextPtr;

    for (let j: i32 = 0; j < outDim; j++) {
      let sum = load<f64>(weightsPtr + ((<usize>(bOffset + j)) << 3));
      const wRowOff = wOffset + j * inDim;
      for (let i: i32 = 0; i < inDim; i++) {
        sum +=
          load<f64>(weightsPtr + ((<usize>(wRowOff + i)) << 3)) *
          load<f64>(currPtr + ((<usize>i) << 3));
      }
      store<f64>(dstPtr + ((<usize>j) << 3), evalAct(sum, act));
    }

    const tmp = currPtr;
    currPtr = nextPtr;
    nextPtr = tmp;
  }
}

/**
 * Vectorized MLP Vector-Jacobian Product (VJP) pullback in linear memory.
 * Computes gradInputs and gradWeights given cotangent u = dL/dy.
 *
 * - layerInfoPtr: i32[numLayers * 4] packed as [wOffset, bOffset, inDim, outDim]
 * - actOffsetsPtr: i32[numLayers + 1] start offset of layer l's activations in actBufPtr
 * - preOffsetsPtr: i32[numLayers] start offset of layer l's pre-activations in preBufPtr
 * - actBufPtr: f64[sum(dims)] cached post-activations (act[0] = inputs)
 * - preBufPtr: f64[sum(outDims)] cached pre-activations
 * - deltaAPtr, deltaBPtr, dZPtr: f64[maxLayerDim] scratch buffers
 */
export function nn_mlpVjp(
  layerInfoPtr: usize,
  numLayers: i32,
  weightsPtr: usize,
  inputsPtr: usize,
  cotangentPtr: usize,
  hiddenAct: i32,
  outAct: i32,
  gradInPtr: usize,
  gradWPtr: usize,
  actOffsetsPtr: usize,
  preOffsetsPtr: usize,
  actBufPtr: usize,
  preBufPtr: usize,
  deltaAPtr: usize,
  deltaBPtr: usize,
  dZPtr: usize,
): void {
  if (numLayers <= 0) return;

  // 1. Forward pass with activation & pre-activation caching
  const firstInDim = load<i32>(layerInfoPtr + 8);
  memory.copy(actBufPtr, inputsPtr, (<usize>firstInDim) << 3);

  for (let l: i32 = 0; l < numLayers; l++) {
    const infoOff = (<usize>(l * 4)) << 2;
    const wOffset = load<i32>(layerInfoPtr + infoOff);
    const bOffset = load<i32>(layerInfoPtr + infoOff + 4);
    const inDim = load<i32>(layerInfoPtr + infoOff + 8);
    const outDim = load<i32>(layerInfoPtr + infoOff + 12);
    const act = l == numLayers - 1 ? outAct : hiddenAct;

    const aInOff = load<i32>(actOffsetsPtr + ((<usize>l) << 2));
    const aOutOff = load<i32>(actOffsetsPtr + ((<usize>(l + 1)) << 2));
    const preOff = load<i32>(preOffsetsPtr + ((<usize>l) << 2));

    for (let j: i32 = 0; j < outDim; j++) {
      let sum = load<f64>(weightsPtr + ((<usize>(bOffset + j)) << 3));
      const wRowOff = wOffset + j * inDim;
      for (let i: i32 = 0; i < inDim; i++) {
        sum +=
          load<f64>(weightsPtr + ((<usize>(wRowOff + i)) << 3)) *
          load<f64>(actBufPtr + ((<usize>(aInOff + i)) << 3));
      }
      store<f64>(preBufPtr + ((<usize>(preOff + j)) << 3), sum);
      store<f64>(actBufPtr + ((<usize>(aOutOff + j)) << 3), evalAct(sum, act));
    }
  }

  // 2. Backward pass
  const lastOutDim = load<i32>(layerInfoPtr + ((<usize>((numLayers - 1) * 4 + 3)) << 2));
  memory.copy(deltaAPtr, cotangentPtr, (<usize>lastOutDim) << 3);

  let currDelta = deltaAPtr;
  let nextDelta = deltaBPtr;

  for (let l: i32 = numLayers - 1; l >= 0; l--) {
    const infoOff = (<usize>(l * 4)) << 2;
    const wOffset = load<i32>(layerInfoPtr + infoOff);
    const bOffset = load<i32>(layerInfoPtr + infoOff + 4);
    const inDim = load<i32>(layerInfoPtr + infoOff + 8);
    const outDim = load<i32>(layerInfoPtr + infoOff + 12);
    const act = l == numLayers - 1 ? outAct : hiddenAct;

    const aInOff = load<i32>(actOffsetsPtr + ((<usize>l) << 2));
    const preOff = load<i32>(preOffsetsPtr + ((<usize>l) << 2));

    // dZ = delta * d_act(pre), gradB = dZ
    for (let j: i32 = 0; j < outDim; j++) {
      const preVal = load<f64>(preBufPtr + ((<usize>(preOff + j)) << 3));
      const dz = load<f64>(currDelta + ((<usize>j) << 3)) * evalActDeriv(preVal, act);
      store<f64>(dZPtr + ((<usize>j) << 3), dz);
      store<f64>(gradWPtr + ((<usize>(bOffset + j)) << 3), dz);
    }

    // gradW[j, i] = dZ[j] * aIn[i]
    for (let j: i32 = 0; j < outDim; j++) {
      const dz = load<f64>(dZPtr + ((<usize>j) << 3));
      const wRowOff = wOffset + j * inDim;
      for (let i: i32 = 0; i < inDim; i++) {
        store<f64>(
          gradWPtr + ((<usize>(wRowOff + i)) << 3),
          dz * load<f64>(actBufPtr + ((<usize>(aInOff + i)) << 3)),
        );
      }
    }

    // Propagate delta to previous layer (or gradIn for l == 0): delta_prev = W^T * dZ
    const dstDelta = l == 0 ? gradInPtr : nextDelta;
    for (let i: i32 = 0; i < inDim; i++) {
      let sum: f64 = 0.0;
      for (let j: i32 = 0; j < outDim; j++) {
        sum +=
          load<f64>(weightsPtr + ((<usize>(wOffset + j * inDim + i)) << 3)) *
          load<f64>(dZPtr + ((<usize>j) << 3));
      }
      store<f64>(dstDelta + ((<usize>i) << 3), sum);
    }

    const tmp = currDelta;
    currDelta = nextDelta;
    nextDelta = tmp;
  }
}
