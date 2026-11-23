// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Core AST & Domain Model Types for DOE-2.1E / DOE-2.2 BDL.
 */

export interface Doe2Range {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type Doe2SectionKind = "LOADS" | "SYSTEMS" | "PLANT" | "ECONOMICS";

export type Doe2CommandKind =
  | "INPUT"
  | "TITLE"
  | "RUN-PERIOD"
  | "BUILDING-LOCATION"
  | "MATERIAL"
  | "LAYERS"
  | "CONSTRUCTION"
  | "GLASS-TYPE"
  | "DAY-SCHEDULE"
  | "DAY-SCHEDULE-PD"
  | "WEEK-SCHEDULE"
  | "WEEK-SCHEDULE-PD"
  | "SCHEDULE"
  | "SCHEDULE-PD"
  | "SPACE"
  | "EXTERIOR-WALL"
  | "ROOF"
  | "UNDERGROUND-WALL"
  | "WINDOW"
  | "DOOR"
  | "ZONE"
  | "SYSTEM"
  | "PLANT-EQUIPMENT"
  | "COMPUTE"
  | "STOP"
  | "END"
  | "UNKNOWN";

export type Doe2ParamValue = string | number | (string | number)[];

export interface Doe2RawCommand {
  uName?: string | undefined;
  command: string;
  normalizedCommand: Doe2CommandKind;
  subCommand?: string | undefined;
  params: Record<string, Doe2ParamValue>;
  terminated: boolean;
  range: Doe2Range;
}

export interface Doe2ParseError {
  code: "DOE1001" | "DOE1002";
  message: string;
  range: Doe2Range;
}

export interface Doe2RunPeriod {
  beginMonth: number;
  beginDay: number;
  beginYear?: number | undefined;
  endMonth: number;
  endDay: number;
  endYear?: number | undefined;
  range: Doe2Range;
}

export interface Doe2BuildingLocation {
  name?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  altitude?: number | undefined;
  timeZone?: number | undefined;
  azimuth?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Material {
  name: string;
  type: "PROPERTIES" | "RESISTANCE";
  thickness?: number | undefined; // ft (IP) or m (SI)
  conductivity?: number | undefined; // Btu/(hr*ft*F) (IP) or W/(m*K) (SI)
  density?: number | undefined; // lb/ft^3 (IP) or kg/m^3 (SI)
  specificHeat?: number | undefined; // Btu/(lb*F) (IP) or J/(kg*K) (SI)
  resistance?: number | undefined; // hr*ft^2*F/Btu (IP) or m^2*K/W (SI)
  range: Doe2Range;
}

export interface Doe2Layers {
  name: string;
  materials: string[];
  insideFilmRes?: number | undefined;
  outsideFilmRes?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Construction {
  name: string;
  type: "LAYERS" | "U-VALUE";
  layersName?: string | undefined;
  materialName?: string | undefined;
  uValue?: number | undefined;
  absorptance?: number | undefined;
  roughness?: number | undefined;
  range: Doe2Range;
}

export interface Doe2GlassType {
  name: string;
  type?: string | undefined;
  shadingCoeff?: number | undefined; // SC (SHGC ~= 0.87 * SC)
  shgc?: number | undefined;
  glassConductance?: number | undefined; // U-value
  visibleTransmittance?: number | undefined;
  panes?: number | undefined;
  range: Doe2Range;
}

export interface Doe2DaySchedule {
  name: string;
  type?: string | undefined; // FRACTION | TEMPERATURE | ON/OFF | MULTIPLIER
  values: number[];
  range: Doe2Range;
}

export interface Doe2WeekSchedule {
  name: string;
  type?: string | undefined;
  daySchedules: string[];
  range: Doe2Range;
}

export interface Doe2Schedule {
  name: string;
  type?: string | undefined;
  weekSchedules: string[];
  range: Doe2Range;
}

export interface Doe2Space {
  name: string;
  area?: number | undefined;
  volume?: number | undefined;
  height?: number | undefined;
  temperature?: number | undefined;
  people?: number | undefined;
  lightingWPerArea?: number | undefined;
  equipmentWPerArea?: number | undefined;
  infiltrationAch?: number | undefined;
  infiltrationCfmPerArea?: number | undefined;
  zoneType?: string | undefined;
  floorWeight?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Surface {
  name: string;
  kind: "EXTERIOR-WALL" | "ROOF" | "UNDERGROUND-WALL";
  spaceName?: string | undefined;
  constructionName?: string | undefined;
  area?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  azimuth?: number | undefined;
  tilt?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Window {
  name: string;
  parentSurfaceName?: string | undefined;
  spaceName?: string | undefined;
  glassTypeName?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  area?: number | undefined;
  multiplier?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Door {
  name: string;
  parentSurfaceName?: string | undefined;
  spaceName?: string | undefined;
  constructionName?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  area?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Zone {
  name: string;
  type?: string | undefined; // CONDITIONED | UNCONDITIONED | PLENUM
  spaceName?: string | undefined;
  systemName?: string | undefined;
  designHeatT?: number | undefined;
  designCoolT?: number | undefined;
  heatTempSched?: string | undefined;
  coolTempSched?: string | undefined;
  exhaustFlow?: number | undefined;
  range: Doe2Range;
}

export interface Doe2System {
  name: string;
  type: string; // PSZ | VAVS | PIU | FC | PTAC | SUM | ...
  zones: string[];
  coolingCop?: number | undefined;
  coolingEir?: number | undefined;
  heatingEff?: number | undefined;
  supplyFanKwPerCfm?: number | undefined;
  minOutsideAir?: number | undefined;
  maxSupplyT?: number | undefined;
  minSupplyT?: number | undefined;
  range: Doe2Range;
}

export interface Doe2PlantEquipment {
  name: string;
  type: string;
  size?: number | undefined;
  installedNumber?: number | undefined;
  efficiency?: number | undefined;
  range: Doe2Range;
}

export interface Doe2Document {
  uri?: string | undefined;
  units: "IP" | "SI";
  title?: string | undefined;
  sections: Doe2SectionKind[];
  runPeriod?: Doe2RunPeriod | undefined;
  buildingLocation?: Doe2BuildingLocation | undefined;
  materials: Doe2Material[];
  layers: Doe2Layers[];
  constructions: Doe2Construction[];
  glassTypes: Doe2GlassType[];
  daySchedules: Doe2DaySchedule[];
  weekSchedules: Doe2WeekSchedule[];
  schedules: Doe2Schedule[];
  spaces: Doe2Space[];
  surfaces: Doe2Surface[];
  windows: Doe2Window[];
  doors: Doe2Door[];
  zones: Doe2Zone[];
  systems: Doe2System[];
  plantEquipment: Doe2PlantEquipment[];
  hasCompute: boolean;
  hasStop: boolean;
  commands: Doe2RawCommand[];
  parseErrors: Doe2ParseError[];
}

export type Doe2DiagnosticSeverity = "error" | "warning" | "info";

export interface Doe2Diagnostic {
  code: string;
  rule: string;
  severity: Doe2DiagnosticSeverity;
  message: string;
  range: Doe2Range;
}
