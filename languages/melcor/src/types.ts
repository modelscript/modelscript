// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Core AST & Domain Data Types for Sandia MELCOR 2.x Severe Accident Decks.
 */

export interface MelcorRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export type MelcorPackageSection = "ROOT" | "EXEC" | "CVH" | "FL" | "HS" | "COR" | "RN1" | "CF" | "TF" | "MP" | "NCG";

export interface MelcorRecord {
  keyword: string;
  tokens: string[];
  rawLine: string;
  packageSection: MelcorPackageSection;
  range: MelcorRange;
}

export interface MelcorExecConfig {
  present: boolean;
  tStart: number;
  tEnd: number;
  dtMin: number;
  dtMax: number;
  dtInit: number;
  cpuLimit?: number | undefined;
  range?: MelcorRange | undefined;
}

export interface MelcorControlVolume {
  id: number;
  name: string;
  cvType: "NORMAL" | "TIME_INDEPENDENT" | "EQUILIBRIUM" | "NONEQUILIBRIUM";
  volume: number; // m^3
  elevation: number; // m
  height: number; // m
  pressure: number; // Pa
  temperature: number; // K
  poolFraction: number; // 0..1
  steamFraction: number; // 0..1
  ncgFractions: Record<string, number>;
  range?: MelcorRange | undefined;
}

export interface MelcorFlowPath {
  id: number;
  name: string;
  fromCv: number;
  toCv: number;
  fromElevation: number; // m
  toElevation: number; // m
  area: number; // m^2
  length: number; // m
  openFraction: number; // 0..1
  forwardLoss: number; // dimensionless K_fwd
  reverseLoss: number; // dimensionless K_rev
  initialFlow: number; // kg/s
  range?: MelcorRange | undefined;
}

export interface MelcorHeatStructure {
  id: number;
  name: string;
  geometry: "RECTANGULAR" | "CYLINDRICAL" | "SPHERICAL";
  thickness: number; // m
  surfaceArea: number; // m^2
  mass: number; // kg
  thermalConductivity: number; // W/(m*K)
  specificHeat: number; // J/(kg*K)
  density: number; // kg/m^3
  initialTemperature: number; // K
  leftBoundaryCv?: number | undefined;
  rightBoundaryCv?: number | undefined;
  leftHtc: number; // W/(m^2*K)
  rightHtc: number; // W/(m^2*K)
  heatSourceW: number; // W
  range?: MelcorRange | undefined;
}

export interface MelcorCoreCell {
  ring: number;
  level: number;
  fuelMassKg: number;
  cladMassKg: number;
  cladAreaM2: number;
  specificHeatJkgK: number;
  initialTemperatureK: number;
  decayPowerW: number;
  cvId?: number | undefined;
  range?: MelcorRange | undefined;
}

export type OxidationKineticsModel = "URBANIC_HEIDRICK" | "CATHCART_PAWEL";

export interface MelcorCorePackage {
  present: boolean;
  radialRings: number;
  axialLevels: number;
  totalPowerW: number;
  decayHeatW: number;
  coreMassKg: number;
  coreSpecificHeatJkgK: number;
  initialTemperatureK: number;
  cladAreaM2: number;
  cladZrMassKg: number;
  oxidationEnabled: boolean;
  oxidationModel: OxidationKineticsModel;
  cvId?: number | undefined;
  cells: MelcorCoreCell[];
  range?: MelcorRange | undefined;
}

export interface MelcorRn1Class {
  classNumber: number;
  name: string;
  initialMassKg: number;
  releaseFraction: number;
  range?: MelcorRange | undefined;
}

export interface MelcorCfArgument {
  kind: "CF" | "CVH" | "FL" | "HS" | "COR" | "TF" | "CONST";
  targetId: number | string;
  variable?: string | undefined;
  scale?: number | undefined;
}

export interface MelcorControlFunction {
  id: number;
  name: string;
  cfType: string; // e.g. ADD, SUBTRACT, MULTIPLY, DIVIDE, EQUALS, INTEGRAL, L_AND, L_OR
  scale: number;
  additive: number;
  initialValue: number;
  arguments: MelcorCfArgument[];
  range?: MelcorRange | undefined;
}

export interface MelcorTabularFunction {
  id: number;
  name: string;
  scale: number;
  additive: number;
  points: Array<{ x: number; y: number }>;
  range?: MelcorRange | undefined;
}

export interface MelcorMaterialProperty {
  id: number;
  name: string;
  material: string; // UO2, ZR, ZRO2, SS, H2, N2, H2O
  property: string; // CP, THC, RHO, ENH, TMP
  constantValue?: number | undefined;
  tableId?: number | undefined;
  range?: MelcorRange | undefined;
}

export interface MelcorNcgSpecies {
  id: number;
  name: string;
  molecularWeight: number; // g/mol
  cp: number; // J/(kg*K)
  range?: MelcorRange | undefined;
}

export interface MelcorDuplicateEntry {
  kind: "CV" | "FL" | "HS" | "CF" | "TF";
  id: number;
  name: string;
  range?: MelcorRange | undefined;
}

export interface MelcorDeck {
  filename?: string | undefined;
  title: string;
  inputPhase: "MELGEN" | "MELCOR" | "COMBINED";
  exec: MelcorExecConfig;
  controlVolumes: Map<number, MelcorControlVolume>;
  flowPaths: Map<number, MelcorFlowPath>;
  heatStructures: Map<number, MelcorHeatStructure>;
  core?: MelcorCorePackage | undefined;
  rn1Classes: Map<number, MelcorRn1Class>;
  controlFunctions: Map<number, MelcorControlFunction>;
  tabularFunctions: Map<number, MelcorTabularFunction>;
  materialProperties: Map<number, MelcorMaterialProperty>;
  ncgSpecies: Map<number, MelcorNcgSpecies>;
  duplicateIds: MelcorDuplicateEntry[];
  records: MelcorRecord[];
}
