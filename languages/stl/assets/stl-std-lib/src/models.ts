// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript analytical mass-property runtime for `@modelscript/stl-std-lib`.
 *
 * Slot ABI (2048-byte aligned):
 *   - `0x080..0x57F`: `CON[160]` (`f64`) — primitive geometry & density parameters
 *   - `0x780..0x7FF`: `IO[16]`   (`f64`) — computed mass-property outputs:
 *       IO[0] = volume
 *       IO[1] = surfaceArea
 *       IO[2] = mass
 *       IO[3] = Ixx
 *       IO[4] = Iyy
 *       IO[5] = Izz
 *       IO[6] = eulerCharacteristic
 */

const OFF_CON: usize = 0x080;
const OFF_IO: usize = 0x780;

const PI: f64 = 3.141592653589793;

const ARCH_UNIT_CUBE: i32 = 1;
const ARCH_TETRAHEDRON: i32 = 2;
const ARCH_OCTAHEDRON: i32 = 3;
const ARCH_CYLINDER: i32 = 4;
const ARCH_SPHERE: i32 = 5;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function setIO(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

/**
 * Evaluates exact analytical mass properties for canonical STL primitive archetypes.
 */
export function stlModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  let vol: f64 = 0.0;
  let area: f64 = 0.0;
  let density: f64 = 1.0;
  let ixx: f64 = 0.0;
  let iyy: f64 = 0.0;
  let izz: f64 = 0.0;

  if (archetypeId == ARCH_UNIT_CUBE) {
    const a = getCon(slotPtr, conCount, 0, 1.0);
    density = getCon(slotPtr, conCount, 1, 1.0);
    vol = a * a * a;
    area = 6.0 * a * a;
    const m = density * vol;
    ixx = (m * a * a) / 6.0;
    iyy = ixx;
    izz = ixx;
  } else if (archetypeId == ARCH_TETRAHEDRON) {
    const s = getCon(slotPtr, conCount, 0, 1.0);
    density = getCon(slotPtr, conCount, 1, 1.0);
    vol = (s * s * s) / 6.0;
    area = (1.5 + 0.5 * Math.sqrt(3.0)) * s * s;
    const m = density * vol;
    ixx = (3.0 / 40.0) * m * s * s;
    iyy = ixx;
    izz = ixx;
  } else if (archetypeId == ARCH_OCTAHEDRON) {
    const r = getCon(slotPtr, conCount, 0, 1.0);
    density = getCon(slotPtr, conCount, 1, 1.0);
    vol = (4.0 / 3.0) * r * r * r;
    area = 4.0 * Math.sqrt(3.0) * r * r;
    const m = density * vol;
    ixx = 0.2 * m * r * r;
    iyy = ixx;
    izz = ixx;
  } else if (archetypeId == ARCH_CYLINDER) {
    const r = getCon(slotPtr, conCount, 0, 1.0);
    const h = getCon(slotPtr, conCount, 1, 2.0);
    density = getCon(slotPtr, conCount, 3, 1.0);
    vol = PI * r * r * h;
    area = 2.0 * PI * r * (r + h);
    const m = density * vol;
    ixx = (m * (3.0 * r * r + h * h)) / 12.0;
    iyy = ixx;
    izz = 0.5 * m * r * r;
  } else if (archetypeId == ARCH_SPHERE) {
    const r = getCon(slotPtr, conCount, 0, 1.0);
    density = getCon(slotPtr, conCount, 2, 1.0);
    vol = (4.0 / 3.0) * PI * r * r * r;
    area = 4.0 * PI * r * r;
    const m = density * vol;
    ixx = 0.4 * m * r * r;
    iyy = ixx;
    izz = ixx;
  }

  setIO(slotPtr, 0, vol);
  setIO(slotPtr, 1, area);
  setIO(slotPtr, 2, density * vol);
  setIO(slotPtr, 3, ixx);
  setIO(slotPtr, 4, iyy);
  setIO(slotPtr, 5, izz);
  setIO(slotPtr, 6, 2.0);
}
