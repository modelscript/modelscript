// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance WebGPU WGSL Compute Shaders for Graph Transitive Closure
 * and Parallel SHACL Constraint Validation.
 */

export const TRANSITIVE_CLOSURE_WGSL = /* wgsl */ `
struct Uniforms {
  nodeCount: u32,
  wordsPerRow: u32,
  stride: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> matrixIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> matrixOut: array<u32>;
@group(0) @binding(3) var<storage, read_write> changedFlag: atomic<u32>;

@compute @workgroup_size(64, 1, 1)
fn transitiveClosureStep(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let row = globalId.x;
  if (row >= u.nodeCount) {
    return;
  }

  let wpr = u.wordsPerRow;
  let rowOffset = row * wpr;

  for (var kw: u32 = 0u; kw < wpr; kw++) {
    var accumulated = matrixIn[rowOffset + kw];

    // Scan through all nodes k: if k is reachable from row, accumulate k's reachability
    for (var w: u32 = 0u; w < wpr; w++) {
      let reachWord = matrixIn[rowOffset + w];
      if (reachWord == 0u) {
        continue;
      }

      for (var bit: u32 = 0u; bit < 32u; bit++) {
        if ((reachWord & (1u << bit)) != 0u) {
          let k = w * 32u + bit;
          if (k < u.nodeCount) {
            accumulated |= matrixIn[k * wpr + kw];
          }
        }
      }
    }

    let prev = matrixIn[rowOffset + kw];
    if (accumulated != prev) {
      atomicStore(&changedFlag, 1u);
    }
    matrixOut[rowOffset + kw] = accumulated;
  }
}
`;

export const SHACL_VALIDATION_WGSL = /* wgsl */ `
struct SHACLUniforms {
  instanceCount: u32,
  attributeStride: u32,
  propertyIndex: u32,
  minInclusive: f32,
  maxInclusive: f32,
  expectedClassId: u32,
  checkClass: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> shacl: SHACLUniforms;
@group(0) @binding(1) var<storage, read> instanceAttributes: array<f32>;
@group(0) @binding(2) var<storage, read> instanceClasses: array<u32>;
@group(0) @binding(3) var<storage, read_write> violationBitset: array<atomic<u32>>;

@compute @workgroup_size(64, 1, 1)
fn validateConstraints(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= shacl.instanceCount) {
    return;
  }

  var isViolation = false;

  // 1. Numeric Range Constraint (sh:minInclusive, sh:maxInclusive)
  let attrOffset = idx * shacl.attributeStride + shacl.propertyIndex;
  let val = instanceAttributes[attrOffset];
  if (val < shacl.minInclusive || val > shacl.maxInclusive) {
    isViolation = true;
  }

  // 2. Class Membership Constraint (sh:class)
  if (shacl.checkClass != 0u) {
    let actualClass = instanceClasses[idx];
    if (actualClass != shacl.expectedClassId) {
      isViolation = true;
    }
  }

  if (isViolation) {
    let wordIdx = idx >> 5u;
    let bitIdx = idx & 31u;
    atomicOr(&violationBitset[wordIdx], 1u << bitIdx);
  }
}
`;
