// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  COPPER_1OZ_THICKNESS_M,
  COPPER_RESISTIVITY_20C_OHM_M,
  COPPER_TEMP_COEFF_PER_K,
  EPSILON_0_F_PER_M,
  computeCopperCapacitanceF,
  computeTraceResistanceOhm,
  lowerGerberToDae,
  type GerberDaeLoweringResult,
  type GerberDaeOptions,
  type GerberTraceElectricalMetrics,
} from "./lowering.js";
