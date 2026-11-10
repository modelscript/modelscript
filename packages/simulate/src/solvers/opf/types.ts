// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/opf — Optimal Power Flow (OPF) Type Definitions.
 */

export interface GenericPowerCase {
  header: { sbase: number; basfrq?: number; rev?: number; xfrrat?: number; nxfrat?: number };
  title1?: string;
  title2?: string;
  buses: Map<
    number,
    {
      i: number;
      name: string;
      baseKv: number;
      ide: number;
      vm: number;
      va: number;
      vMin?: number | undefined;
      vMax?: number | undefined;
      vmin?: number | undefined;
      vmax?: number | undefined;
    }
  >;
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
    rampAgc?: number | undefined;
    ramp10?: number | undefined;
    ramp30?: number | undefined;
  }>;
  branches: Array<{
    i: number;
    j: number;
    ckt: string;
    r: number;
    x: number;
    b?: number;
    rateA?: number;
    rateB?: number | undefined;
    rateC?: number | undefined;
    ratea?: number;
    ratio?: number | undefined;
    angle?: number | undefined;
    angmin?: number | undefined;
    angmax?: number | undefined;
    st?: number;
  }>;
  transformers?: Array<{
    i: number;
    j: number;
    ckt: string;
    r12: number;
    x12: number;
    rata1?: number;
    rateB?: number | undefined;
    rateC?: number | undefined;
    ratio?: number | undefined;
    angle?: number | undefined;
    stat?: number;
  }>;
  /** DC transmission lines (mpc.dcline in MATPOWER). */
  dclines?:
    | Array<{
        fBus: number;
        tBus: number;
        status: number;
        pf: number;
        pt: number;
        qf: number;
        qt: number;
        vf: number;
        vt: number;
        pmin: number;
        pmax: number;
        qminF: number;
        qmaxF: number;
        qminT: number;
        qmaxT: number;
        loss0?: number | undefined;
        loss1?: number | undefined;
      }>
    | undefined;
  fixedShunts?: Array<unknown> | undefined;
  switchedShunts?: Array<unknown> | undefined;
  twoTerminalDc?: Array<unknown> | undefined;
  vscDc?: Array<unknown> | undefined;
  /** Inter-area power interchange and price reference buses. */
  areas?: Array<{ i: number; priceRefBus?: number | undefined }> | undefined;
  /** Generator economic cost curves keyed by `${busNumber}_${genId}` or `${busNumber}`. */
  generatorCosts?: Map<string, GeneratorCostCurve> | undefined;
}

export interface GeneratorCostCurve {
  /** Constant no-load cost ($/hr). */
  c0?: number | undefined;
  /** Linear fuel/offer price ($/MWh). */
  c1: number;
  /** Quadratic cost coefficient ($/MW^2-hr). */
  c2?: number | undefined;
  /** Multi-breakpoint piecewise linear cost curve points [MW, $/hr]. */
  pwlPoints?: Array<{ p: number; f: number }> | undefined;
}

export interface OpfOptions {
  /** Mathematical formulation: 'dc' (linearized) or 'ac' (nonlinear). Default: 'dc'. */
  formulation?: "dc" | "ac" | undefined;
  /** Execution tier: 'direct' (linear-memory zero-GC solver) or 'ampl' (algebraic compiler IR). Default: 'direct'. */
  tier?: "direct" | "ampl" | undefined;
  /** Solver engine to target ('auto', 'ipopt', 'clp', 'cbc', 'highs', 'gurobi', 'knitro'). */
  solver?: "auto" | "ipopt" | "clp" | "cbc" | "highs" | "gurobi" | "knitro" | undefined;
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
  /** Maximum iterations for interior point / L-BFGS solver (default: 200). */
  maxIterations?: number | undefined;
  /** Custom generator cost curves keyed by `${busNum}_${genId}` or `${busNum}`. */
  generatorCosts?: Map<string, GeneratorCostCurve> | undefined;
  /** Default linear generator marginal cost ($/MWh) when not specified in case or generatorCosts (default: deterministic heuristic). */
  defaultLinearCost?: number | undefined;
  /** Custom user-defined AMPL constraints to inject when running tier='ampl'. */
  customAmplConstraints?: string[] | undefined;
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

export interface GeneratorCommitmentProfile {
  busNumber: number;
  genId: string;
  pMinMw: number;
  pMaxMw: number;
  marginalCost: number; // $/MWh
  noLoadCost: number; // $/hr (c0)
  startupCost: number; // $
  shutdownCost: number; // $
  minUpTimeHours: number;
  minDownTimeHours: number;
  rampUpLimitMwPerHour: number;
  rampDownLimitMwPerHour: number;
}

export interface UnitCommitmentOptions extends MultiPeriodOpfOptions {
  /** Unit commitment generator parameters keyed by `${busNum}_${genId}` or `${busNum}`. */
  unitParameters?: Map<string, Partial<GeneratorCommitmentProfile>> | undefined;
  /** System spinning reserve requirement as a fraction of hourly load (e.g. 0.10 for 10%). Default: 0.10. */
  spinningReservePercent?: number | undefined;
  /** Default startup cost if unspecified ($). Default: 100. */
  defaultStartupCost?: number | undefined;
  /** Default shutdown cost if unspecified ($). Default: 50. */
  defaultShutdownCost?: number | undefined;
  /** Default minimum up-time in hours (default: 2). */
  defaultMinUpTimeHours?: number | undefined;
  /** Default minimum down-time in hours (default: 2). */
  defaultMinDownTimeHours?: number | undefined;
  /** Initial commitment state at t=0: boolean array or map. Default: all units on. */
  initialCommitment?: Map<string, boolean> | boolean[] | undefined;
}

export interface GeneratorPeriodSchedule {
  busNumber: number;
  genId: string;
  isCommitted: boolean; // u(t)
  isStartingUp: boolean; // v(t)
  isShuttingDown: boolean; // w(t)
  pgMw: number;
  fuelCost: number;
  startupCost: number;
  shutdownCost: number;
  totalCost: number;
}

export interface UnitCommitmentPeriodResult {
  timeStep: number;
  hour: number;
  demandMw: number;
  generationMw: number;
  spinningReserveMw: number;
  hourlyCost: number;
  generators: GeneratorPeriodSchedule[];
  bess?: BessPeriodResult[] | undefined;
}

export interface UnitCommitmentSolution {
  status: "OPTIMAL" | "INFEASIBLE" | "SUBOPTIMAL";
  totalCost: number;
  totalEnergyCost: number;
  totalStartupCost: number;
  totalShutdownCost: number;
  totalGenMwh: number;
  totalDemandMwh: number;
  timeHorizon: number;
  periods: UnitCommitmentPeriodResult[];
  generatorSchedules: Map<string, GeneratorPeriodSchedule[]>;
  reportText: string;
}

export interface ScopfContingency {
  id: string;
  fromBus: number;
  toBus: number;
  ckt?: string | undefined;
}

export interface BindingContingencyConstraint {
  contingencyId: string;
  outagedBranch: string;
  monitoredBranch: string;
  postContingencyFlowMw: number;
  emergencyRatingMw: number;
  loadingPercent: number;
  shadowPrice: number;
}

export interface ScopfOptions extends OpfOptions {
  /** Explicit contingency definitions. If omitted or empty, all non-islanding branches are screened (N-1). */
  contingencies?: ScopfContingency[] | undefined;
  /** Multiplier for emergency post-contingency rating over continuous rateA (e.g. 1.15 for 115%). Default: 1.10. */
  emergencyRatingFactor?: number | undefined;
  /** Maximum number of cutting-plane constraint generation iterations (default: 8). */
  maxScopfIterations?: number | undefined;
  /** Violation tolerance threshold in MW to add cutting plane (default: 0.1). */
  violationToleranceMw?: number | undefined;
}

export interface ScopfSolution {
  status: "OPTIMAL" | "INFEASIBLE" | "SUBOPTIMAL";
  baseSolution: OpfSolution;
  contingenciesEvaluated: number;
  iterations: number;
  bindingContingencies: BindingContingencyConstraint[];
  reportText: string;
}
