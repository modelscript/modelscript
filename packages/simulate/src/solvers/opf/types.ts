// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Optimal Power Flow (OPF) Type Definitions.
 */

export interface GenericPowerCase {
  header: { sbase: number; basfrq?: number; rev?: number };
  title1?: string;
  buses: Map<number, { i: number; name: string; baseKv: number; ide: number; vm: number; va: number }>;
  loads: Array<{ i: number; pl: number; ql: number; status?: number }>;
  generators: Array<{
    i: number;
    id: string;
    pg: number;
    qg: number;
    pb?: number;
    pt?: number;
    qb?: number;
    qt?: number;
    stat?: number;
  }>;
  branches: Array<{
    i: number;
    j: number;
    ckt: string;
    r: number;
    x: number;
    b?: number;
    rateA?: number;
    ratea?: number;
    st?: number;
  }>;
  transformers?: Array<{
    i: number;
    j: number;
    ckt: string;
    r12: number;
    x12: number;
    rata1?: number;
    stat?: number;
  }>;
}

export interface GeneratorCostCurve {
  /** Constant no-load cost ($/hr). */
  c0?: number | undefined;
  /** Linear fuel/offer price ($/MWh). */
  c1: number;
  /** Quadratic cost coefficient ($/MW^2-hr). */
  c2?: number | undefined;
}

export interface OpfOptions {
  /** Mathematical formulation: 'dc' (linearized) or 'ac' (nonlinear). Default: 'dc'. */
  formulation?: "dc" | "ac" | undefined;
  /** Optimization objective: 'cost' (economic dispatch) or 'loss' (loss minimization). Default: 'cost'. */
  objective?: "cost" | "loss" | undefined;
  /** Enforce branch thermal power flow limits (default: true). */
  enforceThermalLimits?: boolean | undefined;
  /** Enforce bus voltage magnitude limits for AC-OPF (default: true). */
  enforceVoltageLimits?: boolean | undefined;
  /** Minimum acceptable voltage in p.u. (default: 0.95). */
  voltageMin?: number | undefined;
  /** Maximum acceptable voltage in p.u. (default: 1.05). */
  voltageMax?: number | undefined;
  /** Convergence tolerance for KKT optimality (default: 1e-6). */
  tolerance?: number | undefined;
  /** Custom generator cost curves keyed by `${busNum}_${genId}` or `${busNum}`. */
  generatorCosts?: Map<string, GeneratorCostCurve> | undefined;
  /** Title of the case or report. */
  caseTitle?: string | undefined;
}

export interface OpfGeneratorResult {
  busNumber: number;
  genId: string;
  pgMw: number;
  qgMvar?: number | undefined;
  pMinMw: number;
  pMaxMw: number;
  marginalCost: number; // $/MWh
  totalCostPerHour: number; // $/hr
  atMinLimit: boolean;
  atMaxLimit: boolean;
}

export interface OpfBusResult {
  busNumber: number;
  name: string;
  baseKv: number;
  vm: number; // p.u.
  vaDeg: number; // degrees
  plMw: number;
  qlMvar: number;
  lmpDollarsPerMwh: number; // Locational Marginal Price ($/MWh)
  congestionComponent: number; // $/MWh
  energyComponent: number; // $/MWh
}

export interface OpfBranchResult {
  fromBus: number;
  toBus: number;
  ckt: string;
  pFlowMw: number;
  qFlowMvar?: number | undefined;
  rateMva: number;
  loadingPercent: number;
  congested: boolean;
  shadowPrice: number; // $/MWh congestion rent multiplier
}

export interface OpfSolution {
  status: "OPTIMAL" | "INFEASIBLE" | "UNBOUNDED" | "SUBOPTIMAL";
  formulation: "dc" | "ac";
  objectiveValue: number; // Total system cost ($/hr)
  totalGenMw: number;
  totalGenMvar?: number | undefined;
  totalLoadMw: number;
  totalLoadMvar?: number | undefined;
  totalLossMw: number;
  averageLmp: number; // System-wide average LMP ($/MWh)
  buses: OpfBusResult[];
  generators: OpfGeneratorResult[];
  branches: OpfBranchResult[];
  reportText: string;
}

export interface BessModel {
  id: string;
  busNumber: number;
  /** Storage energy capacity (MWh). */
  energyCapacityMwh: number;
  /** Minimum state-of-charge energy (MWh). */
  minEnergyMwh: number;
  /** Maximum charge power rating (MW). */
  maxChargeMw: number;
  /** Maximum discharge power rating (MW). */
  maxDischargeMw: number;
  /** Charging one-way efficiency (e.g. 0.95). */
  chargeEfficiency: number;
  /** Discharging one-way efficiency (e.g. 0.95). */
  dischargeEfficiency: number;
  /** Initial stored energy at t=0 (MWh). */
  initialEnergyMwh: number;
  /** Target minimum stored energy at end of horizon t=T (MWh). */
  finalEnergyMwh?: number | undefined;
  /** Marginal degradation / throughput cost ($/MWh). */
  cycleCostDollarsPerMwh?: number | undefined;
}

export interface MultiPeriodOpfOptions extends OpfOptions {
  /** Time horizon duration in steps (default: 24). */
  timeHorizon?: number | undefined;
  /** Time step duration in hours (default: 1.0). */
  timeStepHours?: number | undefined;
  /** Normalized hourly load profile multiplier array (length T). */
  loadProfile?: number[] | undefined;
  /** Normalized hourly renewable generation caps multiplier array (length T). */
  renewableProfile?: number[] | undefined;
  /** Battery energy storage systems connected to the grid. */
  bess?: BessModel[] | undefined;
  /** Generator ramp-up limit (MW/hr). Keyed by gen id or global. */
  rampUpLimits?: Map<string, number> | number | undefined;
  /** Generator ramp-down limit (MW/hr). Keyed by gen id or global. */
  rampDownLimits?: Map<string, number> | number | undefined;
}

export interface BessPeriodResult {
  bessId: string;
  busNumber: number;
  timeStep: number;
  chargeMw: number;
  dischargeMw: number;
  netPowerMw: number; // discharge - charge
  energyMwh: number;
  socPercent: number;
}

export interface PeriodOpfResult {
  timeStep: number;
  hour: number;
  objectiveCost: number;
  totalGenMw: number;
  totalLoadMw: number;
  totalLossMw: number;
  bessNetMw: number;
  averageLmp: number;
  solution: OpfSolution;
  bess: BessPeriodResult[];
}

export interface MultiPeriodOpfSolution {
  status: "OPTIMAL" | "INFEASIBLE" | "SUBOPTIMAL";
  formulation: "dc" | "ac";
  totalCost: number; // Sum of operating costs across all periods ($)
  totalGenMwh: number;
  totalLoadMwh: number;
  totalBessLossMwh: number;
  timeHorizon: number;
  periods: PeriodOpfResult[];
  bessTrajectories: Map<string, BessPeriodResult[]>;
  reportText: string;
}

