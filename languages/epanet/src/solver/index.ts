// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  solveHydraulics,
  type EpanetHydraulicResult,
  type EpanetPddOptions,
  type EpanetSolverOptions,
} from "./todini-ggm.js";

export {
  solveExtendedPeriod,
  type EpanetEpsOptions,
  type EpanetEpsResult,
  type EpanetEpsStep,
} from "./extended-period-solver.js";

export { solvePddHydraulics, type EpanetPddResult } from "./pdd-solver.js";

export {
  solveWaterHammerMoc,
  type TransientEventType,
  type WaterHammerEvent,
  type WaterHammerOptions,
  type WaterHammerPipeParams,
  type WaterHammerResult,
  type WaterHammerTimeStep,
} from "./water-hammer-moc.js";

export {
  performAwwaM36WaterAudit,
  type AwwaM36AuditInput,
  type AwwaM36AuditResult,
  type WaterLossBand,
} from "./water-loss-audit.js";

export {
  DEFAULT_TOU_TARIFF,
  solveOptimalPumpScheduling,
  type OptimalPumpSchedulingOptions,
  type OptimalPumpSchedulingResult,
  type PumpHourlyDispatch,
  type PumpingTariffProfile,
  type TankHourlyTrajectory,
} from "./optimal-pump-scheduling.js";

export {
  solveWaterQuality,
  type NodeQualityProfile,
  type WaterQualityOptions,
  type WaterQualityParameter,
  type WaterQualityResult,
} from "./water-quality-solver.js";
