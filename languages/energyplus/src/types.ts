// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Domain Types for US DOE EnergyPlus Building Models.
 *
 * Implements the schema for EnergyPlus v9.x–v24.x (.idf and .epJSON) decks,
 * including thermal zones, construction materials, building envelopes,
 * internal loads, and HVAC equipment.
 */

export interface IdfRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type IdfDiagnosticSeverity = "error" | "warning" | "info";

export interface IdfDiagnostic {
  code: string;
  severity: IdfDiagnosticSeverity;
  message: string;
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building & Global Metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface IdfBuilding {
  name: string;
  northAxis?: number | undefined; // Degrees from true north
  terrain?: string | undefined; // "Country", "Suburbs", "City", "Ocean", "Urban"
  loadsConvergenceTolerance?: number | undefined;
  temperatureConvergenceTolerance?: number | undefined;
  solarDistribution?: string | undefined;
  maximumNumberOfWarmupDays?: number | undefined;
  minimumNumberOfWarmupDays?: number | undefined;
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thermal Zones
// ─────────────────────────────────────────────────────────────────────────────

export interface IdfZone {
  name: string;
  direction?: number | undefined; // Relative north (deg)
  xOrigin?: number | undefined;
  yOrigin?: number | undefined;
  zOrigin?: number | undefined;
  type?: number | undefined;
  multiplier?: number | undefined;
  ceilingHeight?: number | undefined; // Ceiling height (m)
  volume?: number | undefined; // Air volume (m^3)
  floorArea?: number | undefined; // Floor area (m^2)
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope Materials & Constructions
// ─────────────────────────────────────────────────────────────────────────────

export interface IdfMaterial {
  name: string;
  roughness: string; // "VeryRough", "Rough", "MediumRough", "MediumSmooth", "Smooth", "VerySmooth"
  thickness: number; // Layer thickness (m)
  conductivity: number; // Thermal conductivity k (W/(m-K))
  density: number; // Density rho (kg/m^3)
  specificHeat: number; // Specific heat cp (J/(kg-K))
  thermalAbsorptance?: number | undefined; // Long-wave thermal emissivity (0..1)
  solarAbsorptance?: number | undefined; // Solar absorptance coefficient (0..1)
  visibleAbsorptance?: number | undefined; // Visible spectrum absorptance (0..1)
  range: IdfRange;
}

export interface IdfMaterialNoMass {
  name: string;
  roughness: string;
  thermalResistance: number; // Thermal resistance R (m^2-K/W)
  thermalAbsorptance?: number | undefined;
  solarAbsorptance?: number | undefined;
  visibleAbsorptance?: number | undefined;
  range: IdfRange;
}

export interface IdfConstruction {
  name: string;
  layers: string[]; // Material names ordered outside -> inside
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building Envelope Surfaces & Geometry
// ─────────────────────────────────────────────────────────────────────────────

export interface IdfVertex3D {
  x: number;
  y: number;
  z: number;
}

export type IdfSurfaceType = "Floor" | "Wall" | "Ceiling" | "Roof";

export type IdfBoundaryCondition = "Outdoors" | "Ground" | "Surface" | "Adiabatic" | "Zone";

export interface IdfSurface {
  name: string;
  surfaceType: IdfSurfaceType;
  constructionName: string;
  zoneName: string;
  boundaryCondition: IdfBoundaryCondition;
  outsideBoundaryConditionObject?: string | undefined; // Target surface for interzone
  sunExposure?: "SunExposed" | "NoSun" | undefined;
  windExposure?: "WindExposed" | "NoWind" | undefined;
  viewFactorToGround?: number | undefined;
  vertices: IdfVertex3D[];
  grossArea?: number | undefined;
  range: IdfRange;
}

export interface IdfFenestration {
  name: string;
  surfaceType: "Window" | "Door" | "GlassDoor";
  constructionName: string;
  buildingSurfaceName: string;
  outsideBoundaryConditionObject?: string | undefined;
  vertices: IdfVertex3D[];
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Heat Gains & Infiltration
// ─────────────────────────────────────────────────────────────────────────────

export interface IdfPeople {
  name: string;
  zoneName: string;
  numberOfPeopleScheduleName?: string | undefined;
  numberCalculationMethod: "People" | "People/Area" | "Area/Person";
  numberOfPeople: number;
  peoplePerFloorArea?: number | undefined;
  fractionRadiant?: number | undefined;
  sensibleHeatFraction?: number | undefined;
  activityLevelScheduleName?: string | undefined;
  range: IdfRange;
}

export interface IdfLights {
  name: string;
  zoneName: string;
  scheduleName?: string | undefined;
  designLevelCalculationMethod: "LightingLevel" | "Watts/Area" | "Watts/Person";
  lightingLevel: number; // Watts
  wattsPerZoneFloorArea?: number | undefined;
  fractionRadiant?: number | undefined;
  fractionVisible?: number | undefined;
  range: IdfRange;
}

export interface IdfElectricEquipment {
  name: string;
  zoneName: string;
  scheduleName?: string | undefined;
  designLevelCalculationMethod: "EquipmentLevel" | "Watts/Area" | "Watts/Person";
  designLevel: number; // Watts
  fractionLatent?: number | undefined;
  fractionRadiant?: number | undefined;
  fractionLost?: number | undefined;
  range: IdfRange;
}

export interface IdfInfiltration {
  name: string;
  zoneName: string;
  scheduleName?: string | undefined;
  flowRateCalculationMethod: "Flow/Zone" | "Flow/Area" | "AirChanges/Hour";
  designVolumeFlowRate?: number | undefined; // m^3/s
  airChangesPerHour?: number | undefined; // ACH
  flowPerZoneFloorArea?: number | undefined;
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// HVAC & Controls
// ─────────────────────────────────────────────────────────────────────────────

export interface IdfZoneHVAC {
  name: string;
  zoneName: string;
  type: "IdealLoadsAirSystem" | "Thermostat" | "HVACTemplate:Zone:IdealLoadsAirSystem";
  coolingLimit?: number | undefined; // Watts
  heatingLimit?: number | undefined; // Watts
  maxHeatingSupplyAirTemp?: number | undefined; // deg C
  minCoolingSupplyAirTemp?: number | undefined; // deg C
  coolingSetpointTemp?: number | undefined; // deg C
  heatingSetpointTemp?: number | undefined; // deg C
  range: IdfRange;
}

export interface IdfSchedule {
  name: string;
  scheduleTypeLimitsName?: string | undefined;
  values?: number[] | undefined;
  range: IdfRange;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Document Model
// ─────────────────────────────────────────────────────────────────────────────

export interface EnergyPlusDocument {
  building?: IdfBuilding | undefined;
  zones: IdfZone[];
  materials: IdfMaterial[];
  materialsNoMass: IdfMaterialNoMass[];
  constructions: IdfConstruction[];
  surfaces: IdfSurface[];
  fenestrations: IdfFenestration[];
  people: IdfPeople[];
  lights: IdfLights[];
  electricEquipment: IdfElectricEquipment[];
  infiltrations: IdfInfiltration[];
  zoneHvacs: IdfZoneHVAC[];
  schedules: IdfSchedule[];
  filename?: string | undefined;
}
