// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU WGSL Compute Shader for High-Throughput Water Hydraulic Contingency & Fire Flow Screening.
 *
 * Parallelizes thousands of N-1 pipe break isolations and hydrant fire flow draws
 * simultaneously on the GPU using linear hydraulic sensitivity (PODF) and PDD evaluations.
 */

export const WATER_CONTINGENCY_WGSL = /* wgsl */ `
struct WaterUniforms {
  nodeCount: u32,
  pipeCount: u32,
  scenarioCount: u32,
  scenarioType: u32, // 0 = N-1 Outage, 1 = Fire Flow
  minResidualPressure: f32, // e.g. 14.06 m = 20 psi
  maxVelocity: f32,        // e.g. 2.5 m/s
  pddMinPressure: f32,     // e.g. 0.0 m
  pddReqPressure: f32,     // e.g. 20.0 m
  fireFlowDraw: f32,       // e.g. 63.09 L/s = 1000 gpm
  totalBaseDemand: f32,    // total network demand in L/s
};

@group(0) @binding(0) var<uniform> u: WaterUniforms;
@group(0) @binding(1) var<storage, read> nodeElevations: array<f32>;        // [N]
@group(0) @binding(2) var<storage, read> nodeBaseHeads: array<f32>;         // [N]
@group(0) @binding(3) var<storage, read> nodeBaseDemands: array<f32>;       // [N]
@group(0) @binding(4) var<storage, read> pipeFromNodes: array<u32>;         // [P]
@group(0) @binding(5) var<storage, read> pipeToNodes: array<u32>;           // [P]
@group(0) @binding(6) var<storage, read> pipeConductances: array<f32>;      // [P]: y_l = dQ/dH
@group(0) @binding(7) var<storage, read> pipeBaseFlows: array<f32>;         // [P]: Q_l^0
@group(0) @binding(8) var<storage, read> pipeDiameters: array<f32>;         // [P]: D_l in meters
@group(0) @binding(9) var<storage, read> scenarioTargets: array<u32>;       // [S]: tripped pipe idx or fire node idx
@group(0) @binding(10) var<storage, read> headSensitivityMatrix: array<f32>;// [N * N]: S_H = J_H^-1
@group(0) @binding(11) var<storage, read> pipeOutageFactors: array<f32>;    // [P]: dipole divisor 1 - y_p*(S_uu+S_vv-2*S_uv)

@group(0) @binding(12) var<storage, read_write> scenarioMinPressures: array<f32>;      // [S]
@group(0) @binding(13) var<storage, read_write> scenarioMinPressureNodes: array<u32>;  // [S]
@group(0) @binding(14) var<storage, read_write> scenarioUnsuppliedDemand: array<f32>;  // [S]
@group(0) @binding(15) var<storage, read_write> scenarioMaxVelocities: array<f32>;     // [S]
@group(0) @binding(16) var<storage, read_write> scenarioMaxVelocityPipes: array<u32>;  // [S]
@group(0) @binding(17) var<storage, read_write> scenarioViolationFlags: array<u32>;    // [S]: bit 0=pressure, bit 1=neg pressure, bit 2=velocity
@group(0) @binding(18) var<storage, read_write> scenarioAvailableFireFlow: array<f32>; // [S]
@group(0) @binding(19) var<storage, read_write> scenarioCriticalityScores: array<f32>; // [S]

@compute @workgroup_size(64, 1, 1)
fn screen_water_scenario(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sIdx = global_id.x;
  if (sIdx >= u.scenarioCount) {
    return;
  }

  let target = scenarioTargets[sIdx];
  let N = u.nodeCount;
  let P = u.pipeCount;

  var minP: f32 = 1e6;
  var minPNode: u32 = 0u;
  var unsuppliedDem: f32 = 0.0;
  var violatedNodes: u32 = 0u;
  var hasNegativeP: u32 = 0u;

  if (u.scenarioType == 0u) {
    // -------------------------------------------------------------
    // Scenario Type 0: N-1 Pipe Outage Screening
    // -------------------------------------------------------------
    let pTripped = target;
    let uNode = pipeFromNodes[pTripped];
    let vNode = pipeToNodes[pTripped];
    let q0 = pipeBaseFlows[pTripped];
    let denom = pipeOutageFactors[pTripped];
    let factor = select(q0 / denom, 0.0, abs(denom) < 1e-6);

    // Compute perturbed nodal heads and pressures
    for (var i: u32 = 0u; i < N; i = i + 1u) {
      let s_iu = headSensitivityMatrix[i * N + uNode];
      let s_iv = headSensitivityMatrix[i * N + vNode];
      let deltaH = (s_iu - s_iv) * factor;

      let postH = nodeBaseHeads[i] + deltaH;
      let postP = postH - nodeElevations[i];

      if (postP < minP) {
        minP = postP;
        minPNode = i;
      }
      if (postP < u.minResidualPressure) {
        violatedNodes = violatedNodes + 1u;
      }
      if (postP <= 0.0) {
        hasNegativeP = 1u;
      }

      // Pressure-Dependent Demand (PDD) deficit evaluation
      let baseDem = nodeBaseDemands[i];
      if (baseDem > 0.0) {
        if (postP <= u.pddMinPressure) {
          unsuppliedDem = unsuppliedDem + baseDem;
        } else if (postP < u.pddReqPressure) {
          let ratio = sqrt((postP - u.pddMinPressure) / (u.pddReqPressure - u.pddMinPressure));
          unsuppliedDem = unsuppliedDem + baseDem * (1.0 - ratio);
        }
      }
    }

    // Evaluate surviving pipe flows and velocities
    var maxVel: f32 = 0.0;
    var maxVelPipe: u32 = 0u;

    for (var l: u32 = 0u; l < P; l = l + 1u) {
      if (l == pTripped) {
        continue;
      }
      let fromN = pipeFromNodes[l];
      let toN = pipeToNodes[l];
      let s_from_u = headSensitivityMatrix[fromN * N + uNode];
      let s_from_v = headSensitivityMatrix[fromN * N + vNode];
      let s_to_u = headSensitivityMatrix[toN * N + uNode];
      let s_to_v = headSensitivityMatrix[toN * N + vNode];

      let deltaH_from = (s_from_u - s_from_v) * factor;
      let deltaH_to = (s_to_u - s_to_v) * factor;

      let postFlow = pipeBaseFlows[l] + pipeConductances[l] * (deltaH_from - deltaH_to);
      let diam = pipeDiameters[l];
      let area = 0.78539816 * diam * diam; // PI / 4 * D^2
      let vel = select(abs(postFlow) * 0.001 / area, 0.0, area <= 1e-6); // L/s to m^3/s

      if (vel > maxVel) {
        maxVel = vel;
        maxVelPipe = l;
      }
    }

    scenarioMinPressures[sIdx] = minP;
    scenarioMinPressureNodes[sIdx] = minPNode;
    scenarioUnsuppliedDemand[sIdx] = unsuppliedDem;
    scenarioMaxVelocities[sIdx] = maxVel;
    scenarioMaxVelocityPipes[sIdx] = maxVelPipe;

    var flags: u32 = 0u;
    if (minP < u.minResidualPressure) { flags = flags | 1u; }
    if (hasNegativeP == 1u) { flags = flags | 2u; }
    if (maxVel > u.maxVelocity) { flags = flags | 4u; }
    scenarioViolationFlags[sIdx] = flags;
    scenarioAvailableFireFlow[sIdx] = 0.0;

    // Criticality Score: combines unsupplied demand fraction and pressure violation severity
    let demScore = select(unsuppliedDem / u.totalBaseDemand, 0.0, u.totalBaseDemand <= 1e-4);
    let nodeScore = f32(violatedNodes) / f32(N);
    let velScore = select(max(0.0, (maxVel - u.maxVelocity) / u.maxVelocity), 0.0, u.maxVelocity <= 1e-4);
    scenarioCriticalityScores[sIdx] = demScore * 50.0 + nodeScore * 30.0 + velScore * 20.0;

  } else {
    // -------------------------------------------------------------
    // Scenario Type 1: Hydrant Fire Flow Screening
    // -------------------------------------------------------------
    let hydrant = target;
    let s_hydrant = headSensitivityMatrix[hydrant * N + hydrant];
    let baseHydrantP = nodeBaseHeads[hydrant] - nodeElevations[hydrant];

    // Local available fire flow to reach min residual pressure
    var affLocal: f32 = 1e6;
    if (s_hydrant > 1e-6 && baseHydrantP > u.minResidualPressure) {
      affLocal = (baseHydrantP - u.minResidualPressure) / s_hydrant;
    } else if (baseHydrantP <= u.minResidualPressure) {
      affLocal = 0.0;
    }

    // Network-wide constrained available fire flow
    var affNetwork: f32 = affLocal;
    for (var i: u32 = 0u; i < N; i = i + 1u) {
      let s_ih = headSensitivityMatrix[i * N + hydrant];
      let baseP = nodeBaseHeads[i] - nodeElevations[i];
      if (s_ih > 1e-6) {
        if (baseP <= u.minResidualPressure) {
          affNetwork = 0.0;
          break;
        }
        let affNode = (baseP - u.minResidualPressure) / s_ih;
        if (affNode < affNetwork) {
          affNetwork = affNode;
        }
      }
    }

    // Residual pressure at hydrant under standard test fire flow
    let qDraw = u.fireFlowDraw;
    let drawDown = s_hydrant * qDraw;
    let resP = baseHydrantP - drawDown;

    scenarioMinPressures[sIdx] = resP;
    scenarioMinPressureNodes[sIdx] = hydrant;
    scenarioUnsuppliedDemand[sIdx] = select(qDraw - affNetwork, 0.0, affNetwork >= qDraw);
    scenarioMaxVelocities[sIdx] = 0.0;
    scenarioMaxVelocityPipes[sIdx] = 0u;

    var flags: u32 = 0u;
    if (resP < u.minResidualPressure) { flags = flags | 1u; }
    if (resP <= 0.0) { flags = flags | 2u; }
    scenarioViolationFlags[sIdx] = flags;
    scenarioAvailableFireFlow[sIdx] = max(0.0, affNetwork);
    scenarioCriticalityScores[sIdx] = select(100.0 - min(100.0, affNetwork), 0.0, affNetwork < 0.0);
  }
}
`;
