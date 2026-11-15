// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript WASM 3D RAN RF Coverage Raytracing Kernel.
 * Computes LOS ray-AABB occlusion, ITU-R P.526 knife-edge diffraction,
 * 3GPP TR 38.901 3D antenna directivity, and FSPL over a 2D receiver grid.
 */

const INV_LN10: f64 = 0.4342944819032518;
const RAD_TO_DEG: f64 = 57.29577951308232;
const SPEED_OF_LIGHT: f64 = 299792458.0;

@inline
function log10f64(x: f64): f64 {
  return Math.log(x) * INV_LN10;
}

@inline
function compute3GppAntennaLossWasm(azimDeltaDeg: f64, elevDeltaDeg: f64): f64 {
  const phi3db: f64 = 65.0;
  const theta3db: f64 = 6.5;
  const aMax: f64 = 30.0;
  const ahNorm = azimDeltaDeg / phi3db;
  const avNorm = elevDeltaDeg / theta3db;
  const ah = -Math.min(12.0 * ahNorm * ahNorm, aMax);
  const av = -Math.min(12.0 * avNorm * avNorm, aMax);
  const combined = -Math.min(-(ah + av), aMax);
  return -combined;
}

@inline
function computeFsplDbWasm(distMeters: f64, freqGhz: f64): f64 {
  const dKm = Math.max(0.001, distMeters / 1000.0);
  return 20.0 * log10f64(dKm) + 20.0 * log10f64(freqGhz) + 92.45;
}

@inline
function computeKnifeEdgeLossDbWasm(nu: f64): f64 {
  if (nu <= -0.7) return 0.0;
  const diff = nu - 0.1;
  const term = Math.sqrt(diff * diff + 1.0) + diff;
  return 6.9 + 20.0 * log10f64(Math.max(0.1, term));
}

export function ranCoverageGridWasm(
  gridWidth: u32,
  gridHeight: u32,
  originX: f64,
  originY: f64,
  stepMeters: f64,
  rxHeight: f64,
  txX: f64,
  txY: f64,
  txZ: f64,
  carrierFreqGhz: f64,
  azimuthDeg: f64,
  downTiltDeg: f64,
  eirpDbm: f64,
  obsPtr: u32,
  numObstacles: u32,
  rsrpOutPtr: u32,
  plOutPtr: u32,
  mechOutPtr: u32,
  statsOutPtr: u32,
): void {
  const wavelength = SPEED_OF_LIGHT / (carrierFreqGhz * 1e9);

  let sumRsrp: f64 = 0.0;
  let minRsrp: f64 = Infinity;
  let maxRsrp: f64 = -Infinity;
  let countAbove95: f64 = 0.0;
  let countAbove110: f64 = 0.0;
  let countLos: f64 = 0.0;
  let countDiffracted: f64 = 0.0;
  let countShadow: f64 = 0.0;

  for (let y: u32 = 0; y < gridHeight; y++) {
    const rxY = originY + (<f64>y + 0.5) * stepMeters;
    const dy = rxY - txY;
    const dz = rxHeight - txZ;
    const dy2 = dy * dy;
    const dz2 = dz * dz;

    for (let x: u32 = 0; x < gridWidth; x++) {
      const idx = y * gridWidth + x;
      const rxX = originX + (<f64>x + 0.5) * stepMeters;
      const dx = rxX - txX;

      const groundDist = Math.sqrt(dx * dx + dy2);
      const directDist = Math.sqrt(dx * dx + dy2 + dz2);
      const invDist = 1.0 / directDist;
      const dirX = dx * invDist;
      const dirY = dy * invDist;
      const dirZ = dz * invDist;

      const invX = 1.0 / (Math.abs(dirX) > 1e-6 ? dirX : 1e-6);
      const invY = 1.0 / (Math.abs(dirY) > 1e-6 ? dirY : 1e-6);
      const invZ = 1.0 / (Math.abs(dirZ) > 1e-6 ? dirZ : 1e-6);

      let isLos = true;
      let maxObstacleHeight: f64 = 0.0;
      let obstacleDist: f64 = 0.0;

      for (let o: u32 = 0; o < numObstacles; o++) {
        const oBase = obsPtr + o * 48;
        const minX = load<f64>(oBase);
        const maxX = load<f64>(oBase + 8);
        const minY = load<f64>(oBase + 16);
        const maxY = load<f64>(oBase + 24);
        const minZ = load<f64>(oBase + 32);
        const maxZ = load<f64>(oBase + 40);

        const t0x = (minX - txX) * invX;
        const t1x = (maxX - txX) * invX;
        const t0y = (minY - txY) * invY;
        const t1y = (maxY - txY) * invY;
        const t0z = (minZ - txZ) * invZ;
        const t1z = (maxZ - txZ) * invZ;

        const tEnter = Math.max(Math.max(Math.min(t0x, t1x), Math.min(t0y, t1y)), Math.min(t0z, t1z));
        const tExit = Math.min(Math.min(Math.max(t0x, t1x), Math.max(t0y, t1y)), Math.max(t0z, t1z));

        if (tEnter < tExit && tEnter > 0.0 && tEnter < directDist) {
          isLos = false;
          if (maxZ > maxObstacleHeight) {
            maxObstacleHeight = maxZ;
            obstacleDist = tEnter;
          }
        }
      }

      let rayAzimuth = Math.atan2(dy, dx) * RAD_TO_DEG;
      if (rayAzimuth < 0.0) rayAzimuth += 360.0;
      let azimDelta = Math.abs(rayAzimuth - azimuthDeg) % 360.0;
      if (azimDelta > 180.0) azimDelta = 360.0 - azimDelta;

      const elevationAngle = Math.atan2(txZ - rxHeight, Math.max(0.1, groundDist)) * RAD_TO_DEG;
      const elevDelta = Math.abs(elevationAngle - downTiltDeg);

      const antennaLoss = compute3GppAntennaLossWasm(azimDelta, elevDelta);
      const fspl = computeFsplDbWasm(directDist, carrierFreqGhz);

      let totalLoss = fspl + antennaLoss;
      let mechanism: u8 = 0;

      if (!isLos) {
        const d1 = Math.max(1.0, obstacleDist);
        const d2 = Math.max(1.0, directDist - obstacleDist);
        const losLineZ = txZ + (rxHeight - txZ) * (d1 / directDist);
        const clearance = maxObstacleHeight - losLineZ;

        const nu = clearance * Math.sqrt((2.0 / wavelength) * (1.0 / d1 + 1.0 / d2));
        const diffLoss = computeKnifeEdgeLossDbWasm(nu);

        totalLoss = fspl + antennaLoss + diffLoss;
        mechanism = diffLoss > 45.0 ? 3 : 2;
      }

      const rsrp = eirpDbm - totalLoss;
      store<f32>(rsrpOutPtr + (idx << 2), <f32>(Math.round(rsrp * 10.0) / 10.0));
      store<f32>(plOutPtr + (idx << 2), <f32>(Math.round(totalLoss * 10.0) / 10.0));
      store<u8>(mechOutPtr + idx, mechanism);

      sumRsrp += rsrp;
      if (rsrp < minRsrp) minRsrp = rsrp;
      if (rsrp > maxRsrp) maxRsrp = rsrp;
      if (rsrp >= -95.0) countAbove95 += 1.0;
      if (rsrp >= -110.0) countAbove110 += 1.0;

      if (mechanism == 0) countLos += 1.0;
      else if (mechanism == 2) countDiffracted += 1.0;
      else countShadow += 1.0;
    }
  }

  store<f64>(statsOutPtr, sumRsrp);
  store<f64>(statsOutPtr + 8, minRsrp);
  store<f64>(statsOutPtr + 16, maxRsrp);
  store<f64>(statsOutPtr + 24, countAbove95);
  store<f64>(statsOutPtr + 32, countAbove110);
  store<f64>(statsOutPtr + 40, countLos);
  store<f64>(statsOutPtr + 48, countDiffracted);
  store<f64>(statsOutPtr + 56, countShadow);
}
