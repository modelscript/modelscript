// SPDX-License-Identifier: AGPL-3.0-or-later

export { evaluateTab1, findRegionInterp, interpolateEndfPair } from "./interpolation.js";
export {
  DEFAULT_FOUR_GROUP_BOUNDS,
  DEFAULT_TWO_GROUP_BOUNDS,
  collapseMaterialMultigroup,
  collapseMultigroup,
  evaluateWeightSpectrum,
  type MaterialMultigroupConstants,
  type MultigroupCollapseOptions,
  type MultigroupValue,
  type WeightSpectrumKind,
} from "./multigroup.js";
export {
  ENDF_K0_CONSTANT,
  evaluateSlbwRange,
  evaluateSlbwResonance,
  slbwSpinFactor,
  slbwWaveNumber,
  type SlbwCrossSections,
} from "./resonance.js";
