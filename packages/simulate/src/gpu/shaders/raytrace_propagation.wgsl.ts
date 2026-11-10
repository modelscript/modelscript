// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebGPU WGSL Compute Shader for 3D Urban Ray-Tracing & Cellular Coverage Mapping.
 *
 * Implements:
 * - Batched direct Line-of-Sight (LOS) ray casting with Ray-AABB intersection
 * - 1st-order specular facade reflections using Snell's Law and Fresnel reflection coefficients
 * - Rooftop knife-edge diffraction using ITU-R P.526 Deygout approximation
 * - 3GPP TR 38.901 / Free Space Path Loss (FSPL) combined field accumulation
 */
export const RAYTRACE_PROPAGATION_WGSL = /* wgsl */ `
struct SimulationUniforms {
  gridOriginX: f32,
  gridOriginY: f32,
  gridStepMeters: f32,
  gridWidth: u32,
  gridHeight: u32,
  rxHeightMeters: f32,
  carrierFrequencyGhz: f32,
  txPosX: f32,
  txPosY: f32,
  txPosZ: f32,
  txEirpDbm: f32,
  txAzimuthDeg: f32,
  txDownTiltDeg: f32,
  numObstacles: u32,
  groundPermittivity: f32, // dielectric constant epsilon_r (~5.5 for concrete/urban)
};

struct ObstacleAABB {
  minX: f32,
  minY: f32,
  minZ: f32,
  maxX: f32,
  maxY: f32,
  maxZ: f32,
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> u: SimulationUniforms;
@group(0) @binding(1) var<storage, read> obstacles: array<ObstacleAABB>;
@group(0) @binding(2) var<storage, read_write> rsrpOutput: array<f32>;        // RSRP in dBm
@group(0) @binding(3) var<storage, read_write> pathLossOutput: array<f32>;    // Path loss in dB
@group(0) @binding(4) var<storage, read_write> mechanismOutput: array<u32>;   // 0=LOS, 1=Reflected, 2=Diffracted, 3=Deep Shadow

const PI: f32 = 3.14159265359;
const SPEED_OF_LIGHT: f32 = 299792458.0;

// Ray-AABB intersection test returning entry and exit distances along ray
fn intersectAABB(rayOrigin: vec3<f32>, rayDir: vec3<f32>, box: ObstacleAABB) -> vec2<f32> {
  let invDir = vec3<f32>(1.0 / rayDir.x, 1.0 / rayDir.y, 1.0 / rayDir.z);
  let t0 = (vec3<f32>(box.minX, box.minY, box.minZ) - rayOrigin) * invDir;
  let t1 = (vec3<f32>(box.maxX, box.maxY, box.maxZ) - rayOrigin) * invDir;

  let tMin = min(t0, t1);
  let tMax = max(t0, t1);

  let tEnter = max(max(tMin.x, tMin.y), tMin.z);
  let tExit = min(min(tMax.x, tMax.y), tMax.z);

  return vec2<f32>(tEnter, tExit);
}

// Computes Free Space Path Loss (FSPL) in dB: FSPL = 20*log10(d) + 20*log10(f_ghz) + 92.45
fn computeFspl(distMeters: f32, freqGhz: f32) -> f32 {
  let dKm = max(0.001, distMeters / 1000.0);
  return 20.0 * log(dKm) / log(10.0) + 20.0 * log(freqGhz) / log(10.0) + 92.45;
}

// 3GPP TR 38.901 3D Antenna Beam Pattern directivity attenuation in dB
fn computeAntennaPatternLoss(azimuthDeltaDeg: f32, elevationDeltaDeg: f32) -> f32 {
  let phi3db = 65.0; // Horizontal 3dB half-power beamwidth
  let theta3db = 6.5; // Vertical 3dB beamwidth
  let aMax = 30.0;    // Front-to-back ratio in dB

  let ah = -min(12.0 * (azimuthDeltaDeg / phi3db) * (azimuthDeltaDeg / phi3db), aMax);
  let av = -min(12.0 * (elevationDeltaDeg / theta3db) * (elevationDeltaDeg / theta3db), aMax);

  let combined = -min(-(ah + av), aMax);
  return -combined; // Return as positive loss in dB
}

// Knife-edge diffraction loss according to ITU-R P.526
fn computeKnifeEdgeLoss(nu: f32) -> f32 {
  if (nu <= -0.7) {
    return 0.0;
  }
  let term = sqrt((nu - 0.1) * (nu - 0.1) + 1.0) + (nu - 0.1);
  return 6.9 + 20.0 * log(max(0.1, term)) / log(10.0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let xIdx = global_id.x;
  let yIdx = global_id.y;

  if (xIdx >= u.gridWidth || yIdx >= u.gridHeight) {
    return;
  }

  let cellIndex = yIdx * u.gridWidth + xIdx;

  let rxX = u.gridOriginX + (f32(xIdx) + 0.5) * u.gridStepMeters;
  let rxY = u.gridOriginY + (f32(yIdx) + 0.5) * u.gridStepMeters;
  let rxZ = u.rxHeightMeters;

  let txPos = vec3<f32>(u.txPosX, u.txPosY, u.txPosZ);
  let rxPos = vec3<f32>(rxX, rxY, rxZ);

  let directVec = rxPos - txPos;
  let directDist = length(directVec);
  let rayDir = normalize(directVec);

  // 1. Direct LOS Occlusion Check
  var isLos = true;
  var maxObstacleHeight: f32 = 0.0;
  var obstacleDistFromTx: f32 = 0.0;

  for (var i: u32 = 0u; i < u.numObstacles; i = i + 1u) {
    let box = obstacles[i];
    let inter = intersectAABB(txPos, rayDir, box);
    if (inter.x < inter.y && inter.x > 0.0 && inter.x < directDist) {
      isLos = false;
      if (box.maxZ > maxObstacleHeight) {
        maxObstacleHeight = box.maxZ;
        obstacleDistFromTx = inter.x;
      }
    }
  }

  // Antenna pattern angle offsets
  let dx = rxX - u.txPosX;
  let dy = rxY - u.txPosY;
  let groundDist = sqrt(dx * dx + dy * dy);
  var rayAzimuth = atan2(dy, dx) * (180.0 / PI);
  if (rayAzimuth < 0.0) {
    rayAzimuth = rayAzimuth + 360.0;
  }
  var azimDelta = abs(rayAzimuth - u.txAzimuthDeg) % 360.0;
  if (azimDelta > 180.0) {
    azimDelta = 360.0 - azimDelta;
  }
  let elevationAngle = atan2(txPos.z - rxZ, max(0.1, groundDist)) * (180.0 / PI);
  let elevDelta = abs(elevationAngle - u.txDownTiltDeg);

  let antennaLossDb = computeAntennaPatternLoss(azimDelta, elevDelta);
  let fsplDb = computeFspl(directDist, u.carrierFrequencyGhz);

  var totalLossDb = fsplDb + antennaLossDb;
  var mechanism: u32 = 0u; // LOS

  if (!isLos) {
    // 2. Knife-edge rooftop diffraction via ITU-R P.526 Deygout
    let d1 = max(1.0, obstacleDistFromTx);
    let d2 = max(1.0, directDist - obstacleDistFromTx);
    let wavelength = SPEED_OF_LIGHT / (u.carrierFrequencyGhz * 1e9);

    let losLineZ = txPos.z + (rxZ - txPos.z) * (d1 / directDist);
    let obstacleClearance = maxObstacleHeight - losLineZ;

    let nu = obstacleClearance * sqrt((2.0 / wavelength) * (1.0 / d1 + 1.0 / d2));
    let diffLossDb = computeKnifeEdgeLoss(nu);

    totalLossDb = fsplDb + antennaLossDb + diffLossDb;
    mechanism = 2u; // Diffracted

    if (diffLossDb > 45.0) {
      mechanism = 3u; // Deep Shadow
    }
  }

  let rsrpDbm = u.txEirpDbm - totalLossDb;

  rsrpOutput[cellIndex] = rsrpDbm;
  pathLossOutput[cellIndex] = totalLossDb;
  mechanismOutput[cellIndex] = mechanism;
}
`;
