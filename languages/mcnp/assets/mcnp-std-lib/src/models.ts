// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript neutron cross-section & attenuation runtime for `@modelscript/mcnp-std-lib`.
 */

const AVOGADRO_BARN: f64 = 0.602214076;

/**
 * Returns the fast 1-group total microscopic cross-section (barns) for a given ZAID.
 */
export function mcnpFastSigmaTotal(zaid: i32): f64 {
  if (zaid == 1001) return 3.85004;
  if (zaid == 5010) return 2.75;
  if (zaid == 6012) return 2.4002;
  if (zaid == 8016) return 2.9001;
  if (zaid == 26056) return 2.856;
  if (zaid == 92235) return 5.899;
  if (zaid == 92238) return 5.02;
  if (zaid == 94239) return 6.43;
  return 3.0;
}

/**
 * Returns the fast 1-group fission microscopic cross-section (barns) for a given ZAID.
 */
export function mcnpFastSigmaFission(zaid: i32): f64 {
  if (zaid == 92235) return 1.235;
  if (zaid == 92238) return 0.05;
  if (zaid == 94239) return 1.8;
  return 0.0;
}

/**
 * Returns the fast 1-group nu (average neutrons per fission) for a given ZAID.
 */
export function mcnpFastNu(zaid: i32): f64 {
  if (zaid == 92235) return 2.58;
  if (zaid == 92238) return 2.75;
  if (zaid == 94239) return 3.16;
  return 0.0;
}

/**
 * Returns the atomic mass (amu) for a given ZAID.
 */
export function mcnpAtomicMass(zaid: i32): f64 {
  if (zaid == 1001) return 1.00784;
  if (zaid == 5010) return 10.0129;
  if (zaid == 6012) return 12.011;
  if (zaid == 8016) return 15.999;
  if (zaid == 26056) return 55.9349;
  if (zaid == 92235) return 235.0439;
  if (zaid == 92238) return 238.0508;
  if (zaid == 94239) return 239.0522;
  return 12.0;
}

/**
 * Computes macroscopic total cross-section Sigma_t (cm^-1) for a single-isotope material
 * from mass density rho (g/cm^3, positive magnitude) and ZAID.
 */
export function mcnpEvalMacroscopicXs(zaid: i32, massDensityGcm3: f64): f64 {
  const mass = mcnpAtomicMass(zaid);
  const atomDensity = (Math.abs(massDensityGcm3) * AVOGADRO_BARN) / mass;
  return atomDensity * mcnpFastSigmaTotal(zaid);
}

/**
 * Evaluates Beer-Lambert exponential attenuation I/I0 = exp(-Sigma_t * thickness).
 */
export function mcnpBeerLambertAttenuation(sigmaT: f64, thicknessCm: f64): f64 {
  return Math.exp(-sigmaT * thicknessCm);
}
