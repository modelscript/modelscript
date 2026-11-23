// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  computeMuskingumCoefficients,
  integrateHydrographVolume,
  routeMuskingum,
  type MuskingumCoefficients,
  type MuskingumRoutingOptions,
} from "./muskingum.js";
export { computeExcessHyetograph, computePotentialRetention, computeScsExcessRunoff } from "./scs-cn.js";
export {
  clarkTimeAreaFraction,
  convolveUnitHydrograph,
  generateClarkUnitHydrograph,
  generateScsUnitHydrograph,
  generateSnyderUnitHydrograph,
  generateUnitHydrograph,
  unitRunoffVolumeFactor,
} from "./unit-hydrograph.js";
export { simulateHec1Deck } from "./watershed.js";
