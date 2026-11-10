// SPDX-License-Identifier: AGPL-3.0-or-later

export interface GridCell {
  layer: number;
  row: number;
  col: number;
}

export interface DiscretizationData {
  nlay: number;
  nrow: number;
  ncol: number;
  delr: number[];
  delc: number[];
  top: number;
  botm: number[]; // elevations of bottom for each layer (length = nlay)
}

export interface NpfData {
  k: number;      // horizontal hydraulic conductivity (m/day or m/s)
  k33: number;    // vertical hydraulic conductivity
  ss: number;     // specific storage (1/m)
  sy: number;     // specific yield (dimensionless)
  icelltype?: number | undefined; // 0 = confined, 1 = convertible/unconfined
}

export interface WellData {
  cell: GridCell;
  q: number; // volumetric rate (negative for pumping/extraction, positive for injection)
  name?: string | undefined;
  line?: number | undefined;
}

export interface RiverData {
  cell: GridCell;
  stage: number; // river stage water level
  cond: number;  // riverbed hydraulic conductance (m^2/day or m^2/s)
  rbot: number;  // elevation of bottom of riverbed
  line?: number | undefined;
}

export interface ChdData {
  cell: GridCell;
  head: number; // constant head elevation
  line?: number | undefined;
}

export interface ModflowModel {
  name: string;
  dis: DiscretizationData;
  npf: NpfData;
  wells: WellData[];
  rivers: RiverData[];
  chds: ChdData[];
  initialHeads?: number[][][] | undefined; // [layer][row][col]
}

export interface CellBudget {
  cell: GridCell;
  head: number;
  storageFlux: number;
  wellFlux: number;
  riverFlux: number;
  chdFlux: number;
  netLateralFlux: number;
  residual: number;
}

export interface AquiferBalanceSummary {
  totalPumpingRate: number;
  totalInjectionRate: number;
  totalRiverLeakage: number;
  totalChdExchange: number;
  meanAquiferHead: number;
  maxDrawdown: number;
  cellBudgets: CellBudget[];
}
