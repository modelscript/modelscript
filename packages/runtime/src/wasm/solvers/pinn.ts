// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript WASM kernels for 2nd-order Taylor jet forward and analytical
 * backward-of-forward differentiation of Physics-Informed Neural Networks (PINNs).
 */

@inline
function evalActJet(
  z: f64,
  actKind: i32,
  outPtr: usize,
): void {
  if (actKind == 1) {
    // sin
    let a = Math.sin(z);
    let d1 = Math.cos(z);
    let d2 = -a;
    let d3 = -d1;
    store<f64>(outPtr, a);
    store<f64>(outPtr + 8, d1);
    store<f64>(outPtr + 16, d2);
    store<f64>(outPtr + 24, d3);
  } else if (actKind == 2) {
    // gelu
    let k: f64 = 0.7978845608;
    let c: f64 = 0.044715;
    let z2 = z * z;
    let u = k * (z + c * z * z2);
    let t = Math.tanh(u);
    let s = 1.0 - t * t;
    let du = k * (1.0 + 3.0 * c * z2);
    let d2u = 6.0 * k * c * z;
    let d3u = 6.0 * k * c;
    let dT = s * du;
    let d2T = s * (-2.0 * t * du * du + d2u);
    let d3T = s * ((4.0 * t * t - 2.0 * s) * du * du * du - 6.0 * t * du * d2u + d3u);
    let a = 0.5 * z * (1.0 + t);
    let d1 = 0.5 * (1.0 + t) + 0.5 * z * dT;
    let d2 = dT + 0.5 * z * d2T;
    let d3 = 1.5 * d2T + 0.5 * z * d3T;
    store<f64>(outPtr, a);
    store<f64>(outPtr + 8, d1);
    store<f64>(outPtr + 16, d2);
    store<f64>(outPtr + 24, d3);
  } else {
    // tanh (default)
    let a = Math.tanh(z);
    let d1 = 1.0 - a * a;
    let d2 = -2.0 * a * d1;
    let d3 = d1 * (6.0 * a * a - 2.0);
    store<f64>(outPtr, a);
    store<f64>(outPtr + 8, d1);
    store<f64>(outPtr + 16, d2);
    store<f64>(outPtr + 24, d3);
  }
}

/**
 * Forward 2nd-order Taylor jet pass for a packed PINN.
 * Assumes input `coords` (length `layerDims[0]`) is already written into `cachePtr` at offset 0.
 * Writes `a`, `da`, `d2a`, `dz`, `d2z`, `s1`, `s2`, `s3` across all layers in `cachePtr`.
 */
export function pinnJetForwardWasm(
  nLayers: i32,
  actKind: i32,
  dirIdx: i32,
  totalNodes: i32,
  layerDimsPtr: u32,
  wPtr: u32,
  bPtr: u32,
  wOffsetsPtr: u32,
  bOffsetsPtr: u32,
  actOffsetsPtr: u32,
  cachePtr: u32,
  actScratchPtr: u32,
): void {
  let d0 = load<i32>(layerDimsPtr as usize);
  let baseCache = cachePtr as usize;
  let tn = totalNodes as usize;
  let daBase = baseCache + (tn << 3);
  let d2aBase = baseCache + ((tn * 2) << 3);
  let dzBase = baseCache + ((tn * 3) << 3);
  let d2zBase = baseCache + ((tn * 4) << 3);
  let s1Base = baseCache + ((tn * 5) << 3);
  let s2Base = baseCache + ((tn * 6) << 3);
  let s3Base = baseCache + ((tn * 7) << 3);

  memory.fill(daBase, 0, (d0 as usize) << 3);
  memory.fill(d2aBase, 0, (d0 as usize) << 3);
  if (dirIdx >= 0 && dirIdx < d0) {
    store<f64>(daBase + ((dirIdx as usize) << 3), 1.0);
  }

  for (let l: i32 = 0; l < nLayers; l++) {
    let fanIn = load<i32>((layerDimsPtr as usize) + ((l as usize) << 2));
    let fanOut = load<i32>((layerDimsPtr as usize) + (((l + 1) as usize) << 2));
    let inOff = load<i32>((actOffsetsPtr as usize) + ((l as usize) << 2)) as usize;
    let outOff = load<i32>((actOffsetsPtr as usize) + (((l + 1) as usize) << 2)) as usize;
    let wOff = load<i32>((wOffsetsPtr as usize) + ((l as usize) << 2)) as usize;
    let bOff = load<i32>((bOffsetsPtr as usize) + ((l as usize) << 2)) as usize;
    let isOutput = l == nLayers - 1;

    for (let i: i32 = 0; i < fanOut; i++) {
      let z = load<f64>((bPtr as usize) + ((bOff + (i as usize)) << 3));
      let dz: f64 = 0.0;
      let d2z: f64 = 0.0;
      let wRow = (wPtr as usize) + ((wOff + (i as usize) * (fanIn as usize)) << 3);

      for (let j: i32 = 0; j < fanIn; j++) {
        let w = load<f64>(wRow + ((j as usize) << 3));
        let inIdx = (inOff + (j as usize)) << 3;
        z += w * load<f64>(baseCache + inIdx);
        dz += w * load<f64>(daBase + inIdx);
        d2z += w * load<f64>(d2aBase + inIdx);
      }

      let outIdx = (outOff + (i as usize)) << 3;
      store<f64>(dzBase + outIdx, dz);
      store<f64>(d2zBase + outIdx, d2z);

      if (isOutput) {
        store<f64>(s1Base + outIdx, 1.0);
        store<f64>(s2Base + outIdx, 0.0);
        store<f64>(s3Base + outIdx, 0.0);
        store<f64>(baseCache + outIdx, z);
        store<f64>(daBase + outIdx, dz);
        store<f64>(d2aBase + outIdx, d2z);
      } else {
        evalActJet(z, actKind, actScratchPtr as usize);
        let actVal = load<f64>(actScratchPtr as usize);
        let d1 = load<f64>((actScratchPtr as usize) + 8);
        let d2 = load<f64>((actScratchPtr as usize) + 16);
        let d3 = load<f64>((actScratchPtr as usize) + 24);
        store<f64>(s1Base + outIdx, d1);
        store<f64>(s2Base + outIdx, d2);
        store<f64>(s3Base + outIdx, d3);
        store<f64>(baseCache + outIdx, actVal);
        store<f64>(daBase + outIdx, d1 * dz);
        store<f64>(d2aBase + outIdx, d2 * dz * dz + d1 * d2z);
      }
    }
  }
}

/**
 * Backward-of-forward Taylor jet pass for a packed PINN.
 * `scratchPtr` holds `6 * maxDim` f64s:
 *   - `[0..maxDim)` = barA (initialized by caller with `barY`)
 *   - `[maxDim..2*maxDim)` = barDa (initialized by caller with `barDy`)
 *   - `[2*maxDim..3*maxDim)` = barD2a (initialized by caller with `barD2y`)
 *   - `[3*maxDim..6*maxDim)` = prevBarA, prevBarDa, prevBarD2a
 * Accumulates exact gradients into `gradWPtr` and `gradBPtr`.
 */
export function pinnJetBackwardWasm(
  nLayers: i32,
  totalNodes: i32,
  maxDim: i32,
  layerDimsPtr: u32,
  wPtr: u32,
  wOffsetsPtr: u32,
  bOffsetsPtr: u32,
  actOffsetsPtr: u32,
  cachePtr: u32,
  scratchPtr: u32,
  gradWPtr: u32,
  gradBPtr: u32,
): void {
  let baseCache = cachePtr as usize;
  let tn = totalNodes as usize;
  let daBase = baseCache + (tn << 3);
  let d2aBase = baseCache + ((tn * 2) << 3);
  let dzBase = baseCache + ((tn * 3) << 3);
  let d2zBase = baseCache + ((tn * 4) << 3);
  let s1Base = baseCache + ((tn * 5) << 3);
  let s2Base = baseCache + ((tn * 6) << 3);
  let s3Base = baseCache + ((tn * 7) << 3);

  let md = maxDim as usize;
  let barAPtr = scratchPtr as usize;
  let barDaPtr = barAPtr + (md << 3);
  let barD2aPtr = barDaPtr + (md << 3);
  let prevBarAPtr = barD2aPtr + (md << 3);
  let prevBarDaPtr = prevBarAPtr + (md << 3);
  let prevBarD2aPtr = prevBarDaPtr + (md << 3);

  for (let l: i32 = nLayers - 1; l >= 0; l--) {
    let fanIn = load<i32>((layerDimsPtr as usize) + ((l as usize) << 2));
    let fanOut = load<i32>((layerDimsPtr as usize) + (((l + 1) as usize) << 2));
    let inOff = load<i32>((actOffsetsPtr as usize) + ((l as usize) << 2)) as usize;
    let outOff = load<i32>((actOffsetsPtr as usize) + (((l + 1) as usize) << 2)) as usize;
    let wOff = load<i32>((wOffsetsPtr as usize) + ((l as usize) << 2)) as usize;
    let bOff = load<i32>((bOffsetsPtr as usize) + ((l as usize) << 2)) as usize;
    let isOutput = l == nLayers - 1;

    memory.fill(prevBarAPtr, 0, (fanIn as usize) << 3);
    memory.fill(prevBarDaPtr, 0, (fanIn as usize) << 3);
    memory.fill(prevBarD2aPtr, 0, (fanIn as usize) << 3);

    for (let i: i32 = 0; i < fanOut; i++) {
      let iByte = (i as usize) << 3;
      let bA = load<f64>(barAPtr + iByte);
      let bDa = load<f64>(barDaPtr + iByte);
      let bD2a = load<f64>(barD2aPtr + iByte);

      let barZ: f64;
      let barDz: f64;
      let barD2z: f64;

      if (isOutput) {
        barZ = bA;
        barDz = bDa;
        barD2z = bD2a;
      } else {
        let outIdx = (outOff + (i as usize)) << 3;
        let dz = load<f64>(dzBase + outIdx);
        let d2z = load<f64>(d2zBase + outIdx);
        let s1 = load<f64>(s1Base + outIdx);
        let s2 = load<f64>(s2Base + outIdx);
        let s3 = load<f64>(s3Base + outIdx);

        barD2z = bD2a * s1;
        barDz = bDa * s1 + bD2a * (2.0 * s2 * dz);
        barZ = bA * s1 + bDa * (s2 * dz) + bD2a * (s3 * dz * dz + s2 * d2z);
      }

      let gbAddr = (gradBPtr as usize) + ((bOff + (i as usize)) << 3);
      store<f64>(gbAddr, load<f64>(gbAddr) + barZ);

      let rowOff = (wOff + (i as usize) * (fanIn as usize)) << 3;
      let wRow = (wPtr as usize) + rowOff;
      let gwRow = (gradWPtr as usize) + rowOff;

      for (let j: i32 = 0; j < fanIn; j++) {
        let jByte = (j as usize) << 3;
        let inIdx = (inOff + (j as usize)) << 3;
        let aIn = load<f64>(baseCache + inIdx);
        let daIn = load<f64>(daBase + inIdx);
        let d2aIn = load<f64>(d2aBase + inIdx);

        let gwAddr = gwRow + jByte;
        store<f64>(gwAddr, load<f64>(gwAddr) + barZ * aIn + barDz * daIn + barD2z * d2aIn);

        let wij = load<f64>(wRow + jByte);
        store<f64>(prevBarAPtr + jByte, load<f64>(prevBarAPtr + jByte) + wij * barZ);
        store<f64>(prevBarDaPtr + jByte, load<f64>(prevBarDaPtr + jByte) + wij * barDz);
        store<f64>(prevBarD2aPtr + jByte, load<f64>(prevBarD2aPtr + jByte) + wij * barD2z);
      }
    }

    let copyBytes = (fanIn as usize) << 3;
    memory.copy(barAPtr, prevBarAPtr, copyBytes);
    memory.copy(barDaPtr, prevBarDaPtr, copyBytes);
    memory.copy(barD2aPtr, prevBarD2aPtr, copyBytes);
  }
}
