// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — USGS PHREEQC Aqueous Geochemistry, Speciation & Reactive Transport AST & Data Types.
 *
 * Supports PHREEQC input decks (.pqi) and thermodynamic database files (.dat).
 */

export interface PhreeqcRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface PhreeqcSoluteSpec {
  element: string;
  value: number;
  units?: string | undefined;
  asSpecies?: string | undefined;
  gfw?: number | undefined;
  chargeBalance?: boolean | undefined;
  equilibriumPhase?: string | undefined;
  equilibriumSI?: number | undefined;
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcSolution {
  number: number;
  name?: string | undefined;
  temp: number; // Temperature in °C (default 25.0)
  pH: number; // Negative log H+ activity (default 7.0)
  pHChargeBalance?: boolean | undefined;
  pe: number; // Negative log electron activity (default 4.0)
  units: string; // Concentration units (default "mmol/kgw")
  waterMass: number; // Mass of solvent water in kg (default 1.0)
  density?: number | undefined; // Density in g/cm^3 (default 1.0)
  solutes: Map<string, number>; // Master species / element -> input concentration
  soluteSpecs?: Map<string, PhreeqcSoluteSpec> | undefined;
  chargeBalanceElement?: string | undefined;
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcEquilibriumPhase {
  name: string;
  targetSI: number; // Target Saturation Index (default 0.0)
  initialMoles: number; // Initial moles available in solid phase (default 10.0)
  blockNumber: number; // EQUILIBRIUM_PHASES block number (default 1)
  dissolveOnly?: boolean | undefined;
  precipitateOnly?: boolean | undefined;
  alternativeFormula?: string | undefined;
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcReaction {
  number: number;
  name?: string | undefined;
  reactants: Map<string, number>; // Reactant formula/species -> relative stoichiometry
  totalMoles: number; // Total reaction addition in moles
  steps: number[]; // Reaction step amounts in moles
  stepCount: number; // Number of steps
  units?: string | undefined;
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcKinetics {
  name: string; // Kinetic phase/reaction identifier (e.g., "Calcite")
  blockNumber: number; // KINETICS block number (default 1)
  m0: number; // Initial moles of solid reactant (default 1.0)
  m: number; // Current moles of solid reactant (default m0)
  parms: number[]; // Parameter vector (e.g., [k_rate, A_surface])
  rateConstant: number; // Intrinsic dissolution/precipitation rate constant k [mol/m^2/s]
  surfaceArea: number; // Reactive surface area [m^2/kgw]
  formula?: string | undefined; // Optional stoichiometry override
  steps: number[]; // Time step durations in seconds
  stepCount: number;
  tol?: number | undefined;
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcMix {
  number: number;
  name?: string | undefined;
  fractions: Map<number, number>; // Solution number -> mixing fraction
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcMasterSpecies {
  element: string;
  masterSpecies: string;
  alkalinity: number;
  gfwFormula: string;
  elementGfw?: number | undefined;
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcPhaseDefinition {
  name: string;
  reaction: string;
  logK: number;
  deltaH?: number | undefined; // kJ/mol
  range?: PhreeqcRange | undefined;
}

export interface PhreeqcDocument {
  title?: string | undefined;
  solutions: Map<number, PhreeqcSolution>;
  equilibriumPhases: PhreeqcEquilibriumPhase[];
  reactions: Map<number, PhreeqcReaction>;
  kinetics: PhreeqcKinetics[];
  mixes: Map<number, PhreeqcMix>;
  masterSpecies?: Map<string, PhreeqcMasterSpecies> | undefined;
  phases?: Map<string, PhreeqcPhaseDefinition> | undefined;
  sourceFile?: string | undefined;
  range?: PhreeqcRange | undefined;
}

export interface MineralSaturationResult {
  mineral: string;
  formula: string;
  logKsp: number;
  logIAP: number;
  iap: number;
  ksp: number;
  si: number;
  state: "supersaturated" | "undersaturated" | "equilibrium";
  molesTransferred?: number | undefined;
}

export interface SpeciationResult {
  solutionNumber: number;
  temperatureC: number;
  pH: number;
  pe: number;
  ionicStrength: number;
  debyeHuckelA: number;
  chargeBalanceError: number;
  percentChargeError: number;
  totalMolalities: Record<string, number>;
  speciesMolalities: Record<string, number>;
  activityCoefficients: Record<string, number>;
  logActivityCoefficients: Record<string, number>;
  activities: Record<string, number>;
  carbonateSpeciation: {
    totalCarbon: number;
    h2co3: number;
    hco3: number;
    co3: number;
    alkalinity: number;
  };
  saturationIndices: Record<string, MineralSaturationResult>;
  mineralResults: MineralSaturationResult[];
}
