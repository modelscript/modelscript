// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript IC layout DRC & parasitic RC runtime for `@modelscript/cif-std-lib`.
 *
 * Implements MOSIS SCMOS and Mead-Conway lambda minimum-width DRC checks,
 * parallel-plate + fringe parasitic capacitance extraction, and exact 2D affine transforms.
 */

// Archetype IDs matching `CifArchetypeId` in src/catalog/cif-std-schemas.ts
const ARCH_CAA: i32 = 1;
const ARCH_CPG: i32 = 2;
const ARCH_CCA: i32 = 3;
const ARCH_CMF: i32 = 4;
const ARCH_CVA: i32 = 5;
const ARCH_CMS: i32 = 6;
const ARCH_CWN: i32 = 7;

const ARCH_ND: i32 = 10;
const ARCH_NP: i32 = 11;
const ARCH_NM: i32 = 12;
const ARCH_NC: i32 = 13;
const ARCH_NI: i32 = 14;

/**
 * Returns the minimum feature width in Mead-Conway lambda (λ) units for a layer archetype.
 */
export function cifMinWidthLambda(archetypeId: i32): f64 {
  if (archetypeId == ARCH_CWN) return 10.0;
  if (archetypeId == ARCH_CAA || archetypeId == ARCH_CMF || archetypeId == ARCH_CMS || archetypeId == ARCH_NM) {
    return 3.0;
  }
  if (archetypeId == ARCH_NI) return 4.0;
  if (
    archetypeId == ARCH_CPG ||
    archetypeId == ARCH_CCA ||
    archetypeId == ARCH_CVA ||
    archetypeId == ARCH_ND ||
    archetypeId == ARCH_NP ||
    archetypeId == ARCH_NC
  ) {
    return 2.0;
  }
  return 2.0;
}

/**
 * Checks whether a feature width in CIF units satisfies the layer minimum width DRC rule.
 * Returns `1` if compliant, `0` if violating.
 */
export function cifCheckMinWidth(archetypeId: i32, widthCifUnits: f64, lambdaCifUnits: f64): i32 {
  const required = cifMinWidthLambda(archetypeId) * lambdaCifUnits;
  return widthCifUnits + 1e-9 >= required ? 1 : 0;
}

/**
 * Computes total layer parasitic capacitance in femtofarads (fF) from area (µm²) and perimeter (µm):
 *   C_fF = (areaCapAfPerUm2 * areaUm2 + fringeCapAfPerUm * perimeterUm) * 1e-3
 */
export function cifEvalLayerParasitics(
  areaUm2: f64,
  perimeterUm: f64,
  areaCapAfPerUm2: f64,
  fringeCapAfPerUm: f64,
): f64 {
  const cAf = areaCapAfPerUm2 * areaUm2 + fringeCapAfPerUm * perimeterUm;
  return cAf * 1e-3;
}

/**
 * Computes Elmore RC delay constant (ps) from sheet resistance (Ω/□), effective squares, and capacitance (fF).
 *   tau_ps = (R_ohm * C_fF) * 1e-3
 */
export function cifEvalElmoreDelayPs(sheetResOhmPerSq: f64, numSquares: f64, capFf: f64): f64 {
  const rOhm = sheetResOhmPerSq * numSquares;
  return rOhm * capFf * 1e-3;
}

/**
 * Applies a 2D affine transform [a, b, c, d, tx, ty] to point (x, y) and returns transformed X.
 */
export function cifTransformX(a: f64, b: f64, tx: f64, x: f64, y: f64): f64 {
  return a * x + b * y + tx;
}

/**
 * Applies a 2D affine transform [a, b, c, d, tx, ty] to point (x, y) and returns transformed Y.
 */
export function cifTransformY(c: f64, d: f64, ty: f64, x: f64, y: f64): f64 {
  return c * x + d * y + ty;
}
