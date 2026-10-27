// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript AST and data models for GT-SUITE / GT-POWER (.gtm, .gtd, .dat).
 */

export type GtComponentKind =
  | "cylinder"
  | "pipe"
  | "flow_split"
  | "plenum"
  | "intake_runner"
  | "exhaust_runner"
  | "orifice"
  | "valve"
  | "injector"
  | "turbo_compressor"
  | "turbo_turbine"
  | "intercooler"
  | "environment_inlet"
  | "environment_outlet"
  | "shaft"
  | "pid_controller";

export interface GtComponentBase {
  id: string;
  kind: GtComponentKind;
  title?: string;
  x?: number;
  y?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface GtCombustionModelConfig {
  type: "wiebe" | "double_wiebe" | "imposed_mfb";
  anchorAngleDeg: number; // Start of combustion or 50% MFB
  durationDeg: number; // 10% to 90% burn duration in crank-angle degrees
  wiebeExponentM?: number; // Shape factor (typically 1.5 - 3.0)
  wiebeEfficiencyA?: number; // Completeness factor (typically 5.0)
  pilotFraction?: number; // For double Wiebe (pilot injection)
  pilotAnchorDeg?: number;
  pilotDurationDeg?: number;
  imposedMfbMapId?: string; // Reference to GtTableMap
}

export interface GtHeatTransferConfig {
  type: "woschni" | "annand" | "constant";
  wallTemperatureK: number;
  headTemperatureK?: number;
  pistonTemperatureK?: number;
  multiplier?: number;
}

export interface GtCylinderComponent extends GtComponentBase {
  kind: "cylinder";
  boreM: number;
  strokeM: number;
  connectingRodLengthM: number;
  compressionRatio: number;
  clearanceVolumeM3?: number;
  displacementM3?: number;
  combustionModel: GtCombustionModelConfig;
  heatTransferModel: GtHeatTransferConfig;
  intakeValveIds: string[];
  exhaustValveIds: string[];
  injectorId?: string;
}

export interface GtPipeComponent extends GtComponentBase {
  kind: "pipe" | "intake_runner" | "exhaust_runner";
  diameterM: number;
  lengthM: number;
  discretizationLengthM?: number;
  wallTemperatureK?: number;
  frictionFactor?: number;
  wallRoughnessM?: number;
  numCells?: number;
  bendAngleDeg?: number;
}

export interface GtPlenumComponent extends GtComponentBase {
  kind: "flow_split" | "plenum";
  volumeM3: number;
  initialPressurePa: number;
  initialTemperatureK: number;
  numPorts?: number;
}

export interface GtValveComponent extends GtComponentBase {
  kind: "valve" | "orifice";
  diameterM: number;
  maxLiftM: number;
  dischargeCoefficient: number;
  lashClearanceM: number;
  openAngleDeg: number;
  closeAngleDeg: number;
  liftMapId?: string;
}

export interface GtInjectorComponent extends GtComponentBase {
  kind: "injector";
  fuelType: string;
  massPerStrokeKg: number;
  startOfInjectionDeg: number;
  durationOfInjectionDeg: number;
  lowerHeatingValueJPerKg?: number;
}

export interface GtTurboCompressorComponent extends GtComponentBase {
  kind: "turbo_compressor";
  mapId?: string;
  pressureRatio: number;
  massFlowKgS: number;
  speedRpm: number;
  efficiency: number;
  shaftId?: string;
}

export interface GtTurboTurbineComponent extends GtComponentBase {
  kind: "turbo_turbine";
  mapId?: string;
  expansionRatio: number;
  efficiency: number;
  powerW?: number;
  wastegateFraction?: number;
  shaftId?: string;
}

export interface GtIntercoolerComponent extends GtComponentBase {
  kind: "intercooler";
  volumeM3: number;
  pressureDropCoefficient: number;
  effectiveness: number;
  coolantTemperatureK: number;
}

export interface GtEnvironmentComponent extends GtComponentBase {
  kind: "environment_inlet" | "environment_outlet";
  pressurePa: number;
  temperatureK: number;
  relativeHumidity?: number;
}

export interface GtShaftComponent extends GtComponentBase {
  kind: "shaft";
  momentOfInertiaKgM2: number;
  speedRpm: number;
  frictionTorqueNm?: number;
}

export interface GtPidControllerComponent extends GtComponentBase {
  kind: "pid_controller";
  setpoint: number;
  kp: number;
  ki: number;
  kd: number;
  targetVariable: string;
  controlVariable: string;
}

export type GtComponent =
  | GtCylinderComponent
  | GtPipeComponent
  | GtPlenumComponent
  | GtValveComponent
  | GtInjectorComponent
  | GtTurboCompressorComponent
  | GtTurboTurbineComponent
  | GtIntercoolerComponent
  | GtEnvironmentComponent
  | GtShaftComponent
  | GtPidControllerComponent;

export interface GtConnection {
  fromComponent: string;
  fromPort: string;
  toComponent: string;
  toPort: string;
}

export interface GtTableMap {
  id: string;
  title?: string;
  type: "compressor" | "turbine" | "valve_lift" | "mfb_burn" | "generic";
  columnHeaders: string[];
  data: number[][];
}

export interface GtSimulationSettings {
  durationSeconds: number;
  timeStepSeconds: number;
  engineSpeedRpm: number;
  ambientPressurePa: number;
  ambientTemperatureK: number;
  airFuelRatioLambda: number;
  maxIterations?: number;
}

export interface GtModel {
  name: string;
  title?: string;
  version?: string;
  sourceFile?: string;
  attributes: Record<string, string | number | boolean>;
  components: GtComponent[];
  connections: GtConnection[];
  maps: Record<string, GtTableMap>;
  simulationSettings: GtSimulationSettings;
}

export interface GtDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentId?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface GtSimulationResultPoint {
  timeS: number;
  crankAngleDeg: number;
  cylinderPressurePa: number[];
  cylinderTemperatureK: number[];
  cylinderVolumeM3: number[];
  engineBrakeTorqueNm: number;
  enginePowerKw: number;
  intakeManifoldPressurePa: number;
  exhaustManifoldPressurePa: number;
  airMassFlowKgS: number;
  fuelMassFlowKgS: number;
  turboSpeedRpm: number;
  bsfcGPerKwh: number;
  noxPpm: number;
}

export interface GtSimulationResult {
  modelName: string;
  trajectories: GtSimulationResultPoint[];
  summary: {
    meanTorqueNm: number;
    meanPowerKw: number;
    meanBsfcGPerKwh: number;
    maxCylinderPressureBar: number;
    volumetricEfficiency: number;
    indicatedMeanEffectivePressureBar: number;
    brakeMeanEffectivePressureBar: number;
    thermalEfficiency: number;
    knockMargin: number;
  };
}
