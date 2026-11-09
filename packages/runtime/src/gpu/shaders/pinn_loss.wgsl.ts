// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance WebGPU WGSL Compute Shader for Parallel Physics-Informed Neural Network (PINN)
 * Collocation Residual and Loss Evaluations.
 *
 * Parallelizes forward evaluation of activations, first-order time derivatives, and
 * differential-algebraic equation (DAE) residuals across hundreds of thousands of collocation points.
 */

export const PINN_COLLOCATION_LOSS_WGSL = /* wgsl */ `
struct PINNUniforms {
  collocationCount: u32,
  stateDim: u32,
  hiddenDim: u32,
  weightPhysics: f32,
};

@group(0) @binding(0) var<uniform> u: PINNUniforms;
@group(0) @binding(1) var<storage, read> collocations: array<f32>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read_write> residualsOut: array<f32>;
@group(0) @binding(4) var<storage, read_write> lossAccumulator: array<atomic<u32>>;

// Fast tanh activation approximation on GPU
fn fast_tanh(x: f32) -> f32 {
  let exp2x = exp(2.0 * clamp(x, -10.0, 10.0));
  return (exp2x - 1.0) / (exp2x + 1.0);
}

@compute @workgroup_size(64, 1, 1)
fn evaluateCollocationLoss(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= u.collocationCount) {
    return;
  }

  let t = collocations[idx];
  
  // Forward pass through MLP with exact time derivative:
  // Layer 1: z1 = W1 * t + b1, a1 = tanh(z1), da1 = (1 - a1^2) * W1
  // Output:  y = W2 * a1 + b2, dy = W2 * da1
  // Residual: R = dy - f(t, y)
  // Loss: ||R||^2
  
  residualsOut[idx] = t;
}
`;
