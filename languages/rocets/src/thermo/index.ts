// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  evaluateCombustion,
  evaluateCombustion as evaluateCombustionCEA,
  type CombustionProperties as CEACombustionResult,
  type CombustionProperties,
} from "./combustion.js";

export {
  getPropellantState as getFluidProperties,
  getPropellantState,
  type FluidState as FluidProperties,
  type FluidState,
} from "./fluids.js";

export {
  computeBartzHeatTransfer as calculateBartzHeatTransfer,
  computeBartzHeatTransfer,
  computeNozzleFlow,
  computeNozzleFlow as evaluateNozzlePerformance,
  type NozzlePerformance as NozzleGasDynamics,
  type NozzlePerformance,
} from "./gas-dynamics.js";
