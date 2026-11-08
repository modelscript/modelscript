// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU WGSL Compute Shader for High-Throughput Batched Contingency Screening.
 *
 * Implements:
 *   1. Parallel evaluation of Line Outage Distribution Factors (LODF) across K contingencies x L lines.
 *   2. Post-contingency active power flow computation: P_l^(k) = P_l^0 + LODF_{l, k} * P_k^0.
 *   3. Real-time thermal limit violation detection (loading > threshold) and peak loading reduction.
 */

export const CONTINGENCY_LODF_WGSL = /* wgsl */ `
struct LodfUniforms {
  lineCount: u32,
  contingencyCount: u32,
  overloadThreshold: f32, // e.g. 1.0 for 100% of rating
  padding: f32,
};

@group(0) @binding(0) var<uniform> u: LodfUniforms;
@group(0) @binding(1) var<storage, read> baseFlows: array<f32>;          // [L]: pre-contingency flow P_l^0
@group(0) @binding(2) var<storage, read> ratings: array<f32>;            // [L]: thermal rating S_max
@group(0) @binding(3) var<storage, read> trippedIndices: array<u32>;     // [K]: line index k tripped in contingency c
@group(0) @binding(4) var<storage, read> lodfMatrix: array<f32>;         // [K * L]: lodfMatrix[c * L + l] is LODF of line l for contingency c
@group(0) @binding(5) var<storage, read_write> postFlows: array<f32>;    // [K * L]: post-contingency flow
@group(0) @binding(6) var<storage, read_write> overloadFlags: array<u32>;// [K * L]: 1 if overloaded, 0 otherwise
@group(0) @binding(7) var<storage, read_write> maxLoadings: array<f32>;  // [K]: max line loading fraction (e.g. 1.25 = 125%)
@group(0) @binding(8) var<storage, read_write> violationCounts: array<u32>; // [K]: number of overloaded lines

@compute @workgroup_size(16, 16, 1)
fn screen_contingency(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let cIdx = global_id.x; // contingency index (0..K-1)
  let lIdx = global_id.y; // monitored line index (0..L-1)

  if (cIdx >= u.contingencyCount || lIdx >= u.lineCount) {
    return;
  }

  let trippedLine = trippedIndices[cIdx];
  let pTripped0 = baseFlows[trippedLine];
  let pLine0 = baseFlows[lIdx];
  let rate = ratings[lIdx];

  var postFlow: f32 = 0.0;
  if (lIdx == trippedLine) {
    postFlow = 0.0;
  } else {
    let lodfVal = lodfMatrix[cIdx * u.lineCount + lIdx];
    postFlow = pLine0 + lodfVal * pTripped0;
  }

  let outIdx = cIdx * u.lineCount + lIdx;
  postFlows[outIdx] = postFlow;

  let absFlow = abs(postFlow);
  let loading = select(absFlow / rate, 0.0, rate <= 1e-4);
  let isOverloaded = select(0u, 1u, loading > u.overloadThreshold);
  overloadFlags[outIdx] = isOverloaded;
}

@compute @workgroup_size(64, 1, 1)
fn summarize_contingency(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let cIdx = global_id.x;
  if (cIdx >= u.contingencyCount) {
    return;
  }

  var maxLoad: f32 = 0.0;
  var violations: u32 = 0u;
  let baseOffset = cIdx * u.lineCount;

  for (var l: u32 = 0u; l < u.lineCount; l = l + 1u) {
    let outIdx = baseOffset + l;
    let postFlow = abs(postFlows[outIdx]);
    let rate = ratings[l];
    let load = select(postFlow / rate, 0.0, rate <= 1e-4);
    if (load > maxLoad) {
      maxLoad = load;
    }
    if (load > u.overloadThreshold) {
      violations = violations + 1u;
    }
  }

  maxLoadings[cIdx] = maxLoad;
  violationCounts[cIdx] = violations;
}
`;
