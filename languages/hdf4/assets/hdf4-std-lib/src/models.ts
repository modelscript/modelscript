// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/hdf4-std-lib`.
 *
 * Implements zero-GC 256-byte aligned slot ABI for HDF4 object calibration,
 * EOS-HDF swath/grid geometry footprint, and linear radiance/reflectance conversion:
 *   - `0x00..0x7F` (128 B): `CON[16]` (`f64`) — parameters
 *   - `0x80..0xFF` (128 B): `IO[16]`  (`f64`) — I/O bus:
 *       IO[0] = rawValue / pixelCount
 *       IO[1] = calibratedValue / footprintBytes
 *       IO[2] = minVal
 *       IO[3] = maxVal
 *       IO[4] = meanVal
 */

const OFF_CON: usize = 0x00;
const OFF_IO: usize = 0x80;

const ARCH_SDS: i32 = 1;
const ARCH_VGROUP: i32 = 2;
const ARCH_VDATA: i32 = 3;
const ARCH_RASTER8: i32 = 4;
const ARCH_PALETTE: i32 = 5;
const ARCH_NDG: i32 = 6;
const ARCH_EOS_SWATH: i32 = 10;
const ARCH_EOS_GRID: i32 = 11;
const ARCH_EOS_POINT: i32 = 12;
const ARCH_MODIS_L1B: i32 = 13;
const ARCH_AIRS_L2: i32 = 14;
const ARCH_LANDSAT_TM: i32 = 15;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

/**
 * Evaluates an HDF4 object or NASA EOS-HDF archetype kernel on a slot.
 */
export function hdf4ModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  const raw = getIo(slotPtr, 0);

  if (archetypeId == ARCH_SDS || archetypeId == ARCH_NDG) {
    const scale = getCon(slotPtr, conCount, 3, 1.0);
    const offset = getCon(slotPtr, conCount, 4, 0.0);
    const cal = scale * raw + offset;
    setIo(slotPtr, 1, cal);
    return cal;
  }

  if (archetypeId == ARCH_RASTER8) {
    const w = getCon(slotPtr, conCount, 2, 256.0);
    const h = getCon(slotPtr, conCount, 3, 256.0);
    const bytes = w * h;
    setIo(slotPtr, 1, bytes);
    return bytes;
  }

  if (archetypeId == ARCH_PALETTE) {
    const entries = getCon(slotPtr, conCount, 1, 768.0);
    setIo(slotPtr, 1, entries);
    return entries;
  }

  if (archetypeId == ARCH_EOS_SWATH) {
    const along = getCon(slotPtr, conCount, 0, 2030.0);
    const cross = getCon(slotPtr, conCount, 1, 1354.0);
    const pixels = along * cross;
    setIo(slotPtr, 1, pixels);
    return pixels;
  }

  if (archetypeId == ARCH_EOS_GRID) {
    const xDim = getCon(slotPtr, conCount, 0, 1200.0);
    const yDim = getCon(slotPtr, conCount, 1, 1200.0);
    const cells = xDim * yDim;
    setIo(slotPtr, 1, cells);
    return cells;
  }

  if (archetypeId == ARCH_MODIS_L1B) {
    const scale = getCon(slotPtr, conCount, 1, 0.005);
    const offset = getCon(slotPtr, conCount, 2, 0.0);
    const radiance = scale * (raw - offset);
    setIo(slotPtr, 1, radiance);
    return radiance;
  }

  if (archetypeId == ARCH_AIRS_L2) {
    const levels = getCon(slotPtr, conCount, 0, 28.0);
    const lines = getCon(slotPtr, conCount, 1, 45.0);
    const xTrack = getCon(slotPtr, conCount, 2, 30.0);
    const total = levels * lines * xTrack;
    setIo(slotPtr, 1, total);
    return total;
  }

  if (archetypeId == ARCH_LANDSAT_TM) {
    const bands = getCon(slotPtr, conCount, 0, 7.0);
    const gsd = getCon(slotPtr, conCount, 1, 30.0);
    const area = bands * gsd * gsd;
    setIo(slotPtr, 1, area);
    return area;
  }

  if (archetypeId == ARCH_VGROUP || archetypeId == ARCH_VDATA || archetypeId == ARCH_EOS_POINT) {
    const count = getCon(slotPtr, conCount, 1, 1.0);
    setIo(slotPtr, 1, count);
    return count;
  }

  setIo(slotPtr, 1, raw);
  return raw;
}
