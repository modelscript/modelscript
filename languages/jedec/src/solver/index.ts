// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  computeFuseUtilization,
  encodeProductTermRow,
  evaluateOutputEquation,
  evaluateProductTerm,
  extractJedecEquations,
} from "./boolean-extractor.js";
export {
  GAL16V8_PROFILE,
  GAL22V10_PROFILE,
  PAL16L8_PROFILE,
  PAL16R8_PROFILE,
  getJedecDeviceProfile,
  type JedecColumnPair,
  type JedecDeviceProfile,
  type JedecMacrocellSpec,
} from "./device-profiles.js";
export { simulateJedecVectors } from "./simulator.js";
