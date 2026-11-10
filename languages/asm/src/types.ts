// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IWA Activated Sludge Models (ASM1, ASM2d, ASM3, ADM1) Type Definitions.
 */

export type AsmModelType = "ASM1" | "ASM2d" | "ASM3" | "ADM1";

export type AsmReactorType = "CSTR" | "PlugFlow" | "Anoxic" | "Aerobic" | "Anaerobic";

export interface AsmComponent {
  name: string;
  symbol: string;
  unit: string;
  description: string;
  isParticulate: boolean;
  isSoluble: boolean;
}

export interface AsmProcess {
  name: string;
  rateEquation: string;
  stoichiometry: Record<string, number>;
}

export interface AsmPetersenMatrix {
  modelType: AsmModelType;
  components: AsmComponent[];
  processes: AsmProcess[];
  parameters: Record<string, number>;
}

export interface AsmBioreactor {
  name: string;
  volumeM3: number;
  type: AsmReactorType;
  klaHr?: number | undefined; // Aeration mass transfer coefficient (1/hr)
  doTargetMgL?: number | undefined; // Dissolved oxygen setpoint (mg/L)
  temperatureC?: number | undefined; // Operating temperature (default 20°C)
}

export interface TakacsClarifierConfig {
  name: string;
  surfaceAreaM2: number;
  heightM: number;
  layers: number; // typically 10 layers
  feedLayer: number; // typically layer 5
  v0: number; // maximum settling velocity (m/day), e.g. 474
  v0Prime: number; // maximum Vesilind settling velocity (m/day), e.g. 250
  rh: number; // hindered settling parameter (m3/g SS), e.g. 0.000576
  rp: number; // flocculant settling parameter (m3/g SS), e.g. 0.00286
  fns: number; // non-settleable fraction of TSS, e.g. 0.00228
}

export interface AsmPlantModel {
  name: string;
  modelType: AsmModelType;
  reactors: AsmBioreactor[];
  clarifiers: TakacsClarifierConfig[];
  influentFlowM3Day: number;
  influentConcentrations: Record<string, number>;
  internalRecycleRatio: number; // Q_intr / Q_in, e.g. 3.0
  sludgeRecycleRatio: number; // Q_ras / Q_in, e.g. 1.0
  wasteFlowM3Day: number; // Q_was (m3/day), e.g. 385
}

export interface AsmSimulationState {
  timeDays: number;
  reactorConcentrations: Map<string, Record<string, number>>; // reactorName -> componentName -> concentration (g/m3 or mg/L)
  effluentConcentrations: Record<string, number>;
  sludgeProductionKgDay: number;
  oxygenDemandKgDay: number;
}
