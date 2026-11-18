// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pypsa — Core Types for PyPSA Capacity Expansion & Dispatch Networks.
 */

export interface PypsaBus {
  name: string;
  v_nom: number;
  carrier: string;
  x?: number | undefined;
  y?: number | undefined;
}

export interface PypsaGenerator {
  name: string;
  bus: string;
  carrier: string;
  p_nom: number;
  p_nom_extendable: boolean;
  capital_cost: number;
  marginal_cost: number;
  p_max_pu: number;
  p_min_pu: number;
}

export interface PypsaLoad {
  name: string;
  bus: string;
  p_set: number;
  q_set: number;
}

export interface PypsaLine {
  name: string;
  bus0: string;
  bus1: string;
  r: number;
  x: number;
  b: number;
  s_nom: number;
  s_nom_extendable: boolean;
  capital_cost: number;
  length_km: number;
}

export interface PypsaLink {
  name: string;
  bus0: string;
  bus1: string;
  p_nom: number;
  efficiency: number;
  capital_cost: number;
  marginal_cost: number;
}

export interface PypsaStorageUnit {
  name: string;
  bus: string;
  p_nom: number;
  max_hours: number;
  efficiency_store: number;
  efficiency_dispatch: number;
  standing_loss: number;
}

export interface PypsaNetwork {
  name: string;
  baseMva: number;
  snapshots: string[];
  buses: PypsaBus[];
  busByName: Map<string, PypsaBus>;
  generators: PypsaGenerator[];
  loads: PypsaLoad[];
  lines: PypsaLine[];
  links: PypsaLink[];
  storageUnits: PypsaStorageUnit[];
}

export interface PypsaDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentName?: string | undefined;
}
