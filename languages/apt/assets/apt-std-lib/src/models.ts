// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript geometry & machining physics runtime for `@modelscript/apt-std-lib`.
 *
 * Implements MIT APT III / ISO 4342 analytic geometry kernels (line-line intersection,
 * point-to-line signed distance, circle fillet offset, cutting power & MRR physics)
 * in a zero-GC linear-memory ABI.
 */

const OFF_IO: usize = 0x100;

@inline
function setOut(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), val);
}

/**
 * Intersects two 2D lines in canonical form:
 *   a1*x + b1*y + c1 = 0
 *   a2*x + b2*y + c2 = 0
 * Writes (x, y) to slotPtr + OFF_IO[0..1]. Returns 1 if unique intersection exists, 0 if parallel.
 */
export function aptIntersectLines2D(
  a1: f64,
  b1: f64,
  c1: f64,
  a2: f64,
  b2: f64,
  c2: f64,
  slotPtr: usize,
): i32 {
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-12) {
    return 0;
  }
  const x = (b1 * c2 - b2 * c1) / det;
  const y = (c1 * a2 - c2 * a1) / det;
  setOut(slotPtr, 0, x);
  setOut(slotPtr, 1, y);
  return 1;
}

/**
 * Computes signed perpendicular distance from point (px, py) to unit-normal line a*x + b*y + c = 0.
 */
export function aptSignedDistPointLine(a: f64, b: f64, c: f64, px: f64, py: f64): f64 {
  return a * px + b * py + c;
}

/**
 * Computes cutter-offset effective radius for a fillet circle of radius `rFillet`
 * with cutter radius `rCutter`:
 *   side >= 0 => external (convex) offset: rFillet + rCutter
 *   side < 0  => internal (concave) offset: rFillet - rCutter (returns -1 if invalid)
 */
export function aptEffectiveArcRadius(rFillet: f64, rCutter: f64, side: i32): f64 {
  if (side >= 0) {
    return rFillet + rCutter;
  }
  const rEff = rFillet - rCutter;
  return rEff > 0.0 ? rEff : -1.0;
}

/**
 * Computes cutting power (W) from specific cutting energy Kc (N/mm^2 = J/cm^3),
 * axial depth ap (mm), radial depth ae (mm), and feed rate vf (mm/min):
 *   MRR (cm^3/min) = (ap * ae * vf) / 1000
 *   P (W) = Kc * (ap * ae * vf) / 60000
 */
export function aptCuttingPowerWatts(kcNPerMm2: f64, apMm: f64, aeMm: f64, vfMmPerMin: f64): f64 {
  if (kcNPerMm2 <= 0.0 || apMm <= 0.0 || aeMm <= 0.0 || vfMmPerMin <= 0.0) {
    return 0.0;
  }
  return (kcNPerMm2 * apMm * aeMm * vfMmPerMin) / 60000.0;
}

/**
 * Computes spindle torque (N.m) from cutting power (W) and spindle speed (RPM).
 */
export function aptSpindleTorqueNm(powerWatts: f64, rpm: f64): f64 {
  if (powerWatts <= 0.0 || rpm <= 0.0) {
    return 0.0;
  }
  const omega = (2.0 * Math.PI * rpm) / 60.0;
  return powerWatts / omega;
}

/**
 * Generic cleanroom kernel dispatch matching `wasmKernel: "aptEvalKernel"`.
 * Returns cutting cycle time in seconds for cutting length Lc, feed F, rapid length Lr, rapid rate Fr.
 */
export function aptEvalKernel(
  archetypeId: i32,
  p0: f64,
  p1: f64,
  p2: f64,
  p3: f64,
): f64 {
  if (archetypeId == 10 || archetypeId == 12) {
    // CUTTER / FEDRAT: cutting power shortcut
    return aptCuttingPowerWatts(p0, p1, p2, p3);
  }
  // Cycle time in seconds: (Lc / F + Lr / Fr) * 60
  const tCut = p1 > 0.0 ? p0 / p1 : 0.0;
  const tRap = p3 > 0.0 ? p2 / p3 : 0.0;
  return (tCut + tRap) * 60.0;
}
