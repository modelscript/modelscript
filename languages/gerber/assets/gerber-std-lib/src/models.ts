// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/gerber-std-lib`.
 *
 * Implements analytical Gerber RS-274X aperture geometry (C, R, O, P, Thermal, Moire)
 * and IPC-2221 trace resistance, ampacity, and annular ring DFM evaluation using
 * deterministic f64 arithmetic.
 */

const PI: f64 = 3.141592653589793;
const RHO_CU_20C: f64 = 1.7241e-8; // Ohm*m (IEC 60028 annealed copper)
const ALPHA_CU: f64 = 0.00393; // 1/K

// Archetype IDs (matching GerberArchetypeId in gerber-std-schemas.ts)
const ARCH_CIRCLE: i32 = 1;
const ARCH_RECTANGLE: i32 = 2;
const ARCH_OBROUND: i32 = 3;
const ARCH_POLYGON: i32 = 4;
const ARCH_THERMAL: i32 = 5;
const ARCH_MOIRE: i32 = 6;

/**
 * Computes the exact copper area (mm^2) of a standard Gerber RS-274X aperture primitive.
 *
 * @param archetypeId GerberArchetypeId (1=Circle, 2=Rectangle, 3=Obround, 4=Polygon, 5=Thermal, 6=Moire)
 * @param p0 Primary dimension (diameter or xSize in mm)
 * @param p1 Secondary dimension (holeDiameter for C, ySize for R/O, vertices for P, innerDia for Thermal)
 * @param p2 Tertiary dimension (holeDiameter for R/O, holeDiameter for P, gapThickness for Thermal)
 */
export function gerberApertureAreaMm2(archetypeId: i32, p0: f64, p1: f64, p2: f64): f64 {
  if (p0 <= 0.0) return 0.0;

  if (archetypeId == ARCH_CIRCLE) {
    const r = 0.5 * p0;
    const hole = p1 > 0.0 ? p1 : 0.0;
    const rh = 0.5 * hole;
    const area = PI * (r * r - rh * rh);
    return area > 0.0 ? area : 0.0;
  }

  if (archetypeId == ARCH_RECTANGLE) {
    const w = p0;
    const h = p1 > 0.0 ? p1 : p0;
    const hole = p2 > 0.0 ? p2 : 0.0;
    const rh = 0.5 * hole;
    const area = w * h - PI * rh * rh;
    return area > 0.0 ? area : 0.0;
  }

  if (archetypeId == ARCH_OBROUND) {
    const w = p0;
    const h = p1 > 0.0 ? p1 : p0;
    const major = w >= h ? w : h;
    const minor = w >= h ? h : w;
    const r = 0.5 * minor;
    const straight = major - minor;
    const hole = p2 > 0.0 ? p2 : 0.0;
    const rh = 0.5 * hole;
    const area = straight * minor + PI * r * r - PI * rh * rh;
    return area > 0.0 ? area : 0.0;
  }

  if (archetypeId == ARCH_POLYGON) {
    const r = 0.5 * p0;
    const n = p1 >= 3.0 ? p1 : 3.0;
    const hole = p2 > 0.0 ? p2 : 0.0;
    const rh = 0.5 * hole;
    const polyArea = 0.5 * n * r * r * Math.sin((2.0 * PI) / n);
    const area = polyArea - PI * rh * rh;
    return area > 0.0 ? area : 0.0;
  }

  if (archetypeId == ARCH_THERMAL) {
    const rOut = 0.5 * p0;
    const rIn = 0.5 * (p1 > 0.0 ? p1 : 0.0);
    const gap = p2 > 0.0 ? p2 : 0.0;
    if (rOut <= rIn) return 0.0;
    const ringArea = PI * (rOut * rOut - rIn * rIn);
    const gapCut = 4.0 * gap * (rOut - rIn);
    const area = ringArea - gapCut;
    return area > 0.0 ? area : 0.0;
  }

  if (archetypeId == ARCH_MOIRE) {
    const rOut = 0.5 * p0;
    const ringW = p1 > 0.0 ? p1 : 0.15;
    const area = PI * (rOut * rOut - (rOut - ringW) * (rOut - ringW));
    return area > 0.0 ? area : 0.0;
  }

  return 0.0;
}

/**
 * Computes IPC-2221 copper trace DC resistance (Ohms).
 *
 * @param lengthMm Trace centerline length (mm)
 * @param widthMm Trace width (mm)
 * @param thicknessUm Copper foil thickness (um, e.g., 34.8 um for 1 oz)
 * @param tempC Operating temperature (deg C, e.g., 20.0)
 */
export function gerberTraceResistanceOhm(lengthMm: f64, widthMm: f64, thicknessUm: f64, tempC: f64): f64 {
  if (lengthMm <= 0.0 || widthMm <= 0.0 || thicknessUm <= 0.0) return 0.0;
  const lengthM = lengthMm * 1e-3;
  const widthM = widthMm * 1e-3;
  const thickM = thicknessUm * 1e-6;
  const rho = RHO_CU_20C * (1.0 + ALPHA_CU * (tempC - 20.0));
  return (rho * lengthM) / (widthM * thickM);
}

/**
 * Computes IPC-2221 external-layer trace current carrying capacity (Amperes):
 *   I = k * dT^0.44 * A^0.725
 * where k = 0.048 (external) or 0.024 (internal), dT in deg C, A in sq mils.
 */
export function gerberIpc2221AmpacityA(widthMm: f64, thicknessUm: f64, tempRiseC: f64, isExternal: i32): f64 {
  if (widthMm <= 0.0 || thicknessUm <= 0.0 || tempRiseC <= 0.0) return 0.0;
  const widthMil = widthMm / 0.0254;
  const thickMil = thicknessUm / 25.4;
  const areaSqMil = widthMil * thickMil;
  const k: f64 = isExternal != 0 ? 0.048 : 0.024;
  return k * Math.pow(tempRiseC, 0.44) * Math.pow(areaSqMil, 0.725);
}

/**
 * Computes pad annular ring width (mm): (padDiameter - drillDiameter) / 2.
 */
export function gerberAnnularRingMm(padDiameterMm: f64, drillDiameterMm: f64): f64 {
  return 0.5 * (padDiameterMm - drillDiameterMm);
}
