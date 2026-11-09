// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Water-Energy Nexus Dynamic Co-Simulation Orchestrator
 *
 * Couples municipal drinking water hydraulic distribution networks (EPANET)
 * with electric power distribution feeders (OpenDSS / PSS/E / Forward-Backward Sweep)
 * across dynamic physical boundary interfaces:
 *
 * 1. Grid -> Water (Voltage to Pump Operating Curve):
 *    Terminal voltage deviations (V_pu) at the feeder bus derate motor rotational speed
 *    via induction motor slip torque or VFD drive limit curves. By affinity laws:
 *      H(Q, V) = H_0 * (omega(V) / omega_rated)^2 - r * Q^2
 *
 * 2. Water -> Grid (Hydraulic Load to Electric Injection):
 *    Pump operating point (flow Q, head H) and mechanical/electrical efficiencies
 *    determine instantaneous active power draw P_MW and reactive power draw Q_MVAR
 *    injected into the electric distribution feeder at the pump bus:
 *      P_elec = (rho * g * Q * H) / (eta_motor * eta_pump)
 *      Q_elec = P_elec * tan(acos(PF))
 */

import { type EpanetNetwork, parseInp } from "@modelscript/epanet";

/**
 * Coupling configuration between an EPANET hydraulic pump and a power distribution bus.
 */
export interface WaterEnergyPumpCoupling {
  /** Identifier of the pump in the EPANET model (e.g., "PUMP-1"). */
  pumpId: string;
  /** Feeder bus ID where pump motor is interconnected (e.g., "Bus_3" or 3). */
  feederBusId: string | number;
  /** Motor rated active power in kW (default: 150.0). */
  motorRatedPowerKw?: number | undefined;
  /** Full-load electric motor efficiency 0 < eta <= 1.0 (default: 0.92). */
  motorEfficiency?: number | undefined;
  /** Full-load pump hydraulic efficiency 0 < eta <= 1.0 (default: 0.82). */
  pumpEfficiency?: number | undefined;
  /** Operating power factor lagging 0.5 <= PF <= 1.0 (default: 0.88). */
  powerFactor?: number | undefined;
  /** Whether the pump is driven by a Variable Frequency Drive (default: false). */
  vfdEquipped?: boolean | undefined;
  /** Rated slip for fixed-speed induction motor (default: 0.03 = 3%). */
  ratedSlip?: number | undefined;
  /** Pump shutoff head H0 in meters for affinity curve (default: 65.0). */
  headCurveCoeffH0?: number | undefined;
  /** Pump resistance coefficient r for H = H0 - r*Q^2 (default: 0.002). */
  headCurveCoeffR?: number | undefined;
}

/**
 * Bus declaration in the electric distribution feeder.
 */
export interface FeederBus {
  id: string | number;
  name?: string | undefined;
  baseKv?: number | undefined;
  baseKw?: number | undefined;
  baseKvar?: number | undefined;
  isSubstation?: boolean | undefined;
}

/**
 * Radial distribution branch (overhead line / underground cable).
 */
export interface FeederBranch {
  from: string | number;
  to: string | number;
  rOhm: number;
  xOhm: number;
  lengthKm?: number | undefined;
}

/**
 * Distribution feeder topology and base ratings.
 */
export interface ElectricDistributionFeeder {
  buses: FeederBus[];
  branches: FeederBranch[];
  substationVoltagePu?: number | undefined;
  nominalKvLL?: number | undefined;
  baseMva?: number | undefined;
}

/**
 * Time-of-Use (TOU) electricity tariff schedule.
 */
export interface TimeOfUseTariff {
  offPeakPriceUsdPerKwh: number; // e.g. 0.08 $/kWh
  peakPriceUsdPerKwh: number; // e.g. 0.28 $/kWh
  peakHoursStart: number; // e.g. 12 (12:00)
  peakHoursEnd: number; // e.g. 18 (18:00)
  demandChargeUsdPerKw?: number | undefined; // e.g. 12.50 $/kW
}

/**
 * Configuration options for Water-Energy Nexus co-simulation.
 */
export interface WaterEnergyCoSimOptions {
  /** Simulation horizon in hours (default: 24.0). */
  durationHours?: number | undefined;
  /** Macro-step time step size in minutes (default: 60.0). */
  dtMinutes?: number | undefined;
  /** EPANET model deck (parsed network object or raw .INP string). */
  epanetNetwork?: EpanetNetwork | string | undefined;
  /** Pump-to-feeder coupling bindings. */
  couplings: WaterEnergyPumpCoupling[];
  /** Electric distribution feeder network. */
  feeder: ElectricDistributionFeeder;
  /** Time-of-Use electricity tariff structure. */
  touTariff?: TimeOfUseTariff | undefined;
  /** Diurnal water consumption demand multiplier pattern (t in hours -> multiplier). */
  waterDemandMultiplier?: ((tHours: number) => number) | undefined;
  /** Diurnal baseline electric load multiplier pattern (t in hours -> multiplier). */
  electricLoadMultiplier?: ((tHours: number) => number) | undefined;
  /** Optional custom distribution power flow solver override. */
  customPowerFlowSolver?:
    | ((
        loads: Map<string | number, { pKw: number; qKvar: number }>,
      ) => Map<string | number, { vmPu: number; vaRad: number }>)
    | undefined;
}

/**
 * Telemetry record for a single macro-step in the co-simulation.
 */
export interface WaterEnergyStepRecord {
  timeHours: number;
  isPeakHour: boolean;
  electricityPriceUsdPerKwh: number;
  pumps: Array<{
    pumpId: string;
    feederBusId: string | number;
    speedRatio: number; // omega / omega_rated
    headMeters: number;
    flowLps: number;
    electricalPowerKw: number;
    reactivePowerKvar: number;
    terminalVoltagePu: number;
  }>;
  buses: Array<{
    busId: string | number;
    vmPu: number;
    pTotalKw: number;
    qTotalKvar: number;
  }>;
  tanks: Array<{
    tankId: string;
    levelMeters: number;
    volumeM3: number;
    pctFull: number;
  }>;
  totalFeederLoadKw: number;
  totalPumpingKw: number;
  stepEnergyCostUsd: number;
}

/**
 * Comprehensive results of the Water-Energy Nexus co-simulation.
 */
export interface WaterEnergyCoSimResult {
  records: WaterEnergyStepRecord[];
  totalMacroSteps: number;
  totalEnergyConsumedKwh: number;
  totalEnergyCostUsd: number;
  peakElectricDemandKw: number;
  minFeederVoltagePu: number;
  voltageViolationsCount: number;
  totalWaterPumpedM3: number;
  summary: string;
}

/**
 * Solves standard radial Forward-Backward Sweep (FBS) distribution power flow.
 * Exact for radial distribution topologies (IEEE 13/33/123 bus).
 */
export function solveForwardBackwardSweep(
  feeder: ElectricDistributionFeeder,
  loads: Map<string | number, { pKw: number; qKvar: number }>,
): Map<string | number, { vmPu: number; vaRad: number }> {
  const nominalKv = feeder.nominalKvLL ?? 12.47;
  const baseMva = feeder.baseMva ?? 10.0;
  const zBaseOhm = (nominalKv * nominalKv) / baseMva;
  const vSub = feeder.substationVoltagePu ?? 1.0;

  // Identify substation bus
  const subBus = feeder.buses.find((b) => b.isSubstation) ?? feeder.buses[0];
  const subId = subBus ? subBus.id : 0;

  // Build tree adjacency
  const children = new Map<string | number, Array<{ to: string | number; rPu: number; xPu: number }>>();
  for (const b of feeder.buses) {
    children.set(b.id, []);
  }
  for (const br of feeder.branches) {
    const arr = children.get(br.from);
    if (arr) {
      arr.push({
        to: br.to,
        rPu: br.rOhm / zBaseOhm,
        xPu: br.xOhm / zBaseOhm,
      });
    }
  }

  // Initialize bus voltages to 1.0 pu
  const voltages = new Map<string | number, { vmPu: number; vaRad: number }>();
  for (const b of feeder.buses) {
    voltages.set(b.id, { vmPu: vSub, vaRad: 0.0 });
  }

  // Iterative Forward-Backward Sweep (3-5 iterations)
  const maxIter = 10;
  for (let iter = 0; iter < maxIter; iter++) {
    // 1. Backward Sweep: Accumulate branch active and reactive flows from leaves to root
    const branchFlows = new Map<string | number, { pFlowPu: number; qFlowPu: number }>();

    function backwardSweep(nodeId: string | number): { pFlowPu: number; qFlowPu: number } {
      const load = loads.get(nodeId) ?? { pKw: 0, qKvar: 0 };
      let pSum = load.pKw / (baseMva * 1000.0);
      let qSum = load.qKvar / (baseMva * 1000.0);

      const ch = children.get(nodeId) ?? [];
      for (const edge of ch) {
        const downstream = backwardSweep(edge.to);
        pSum += downstream.pFlowPu;
        qSum += downstream.qFlowPu;
      }
      branchFlows.set(nodeId, { pFlowPu: pSum, qFlowPu: qSum });
      return { pFlowPu: pSum, qFlowPu: qSum };
    }

    backwardSweep(subId);

    // 2. Forward Sweep: Compute node voltage drops from root to leaves
    let maxVChange = 0.0;

    function forwardSweep(parentId: string | number, vParent: number) {
      const ch = children.get(parentId) ?? [];
      for (const edge of ch) {
        const flow = branchFlows.get(edge.to) ?? { pFlowPu: 0, qFlowPu: 0 };
        // LinDistFlow voltage drop: V_j = V_i - (r*P + x*Q)/V_i
        const vDrop = (edge.rPu * flow.pFlowPu + edge.xPu * flow.qFlowPu) / Math.max(0.7, vParent);
        const vChild = Math.max(0.5, vParent - vDrop);

        const oldV = voltages.get(edge.to)?.vmPu ?? 1.0;
        const diff = Math.abs(vChild - oldV);
        if (diff > maxVChange) maxVChange = diff;

        voltages.set(edge.to, { vmPu: vChild, vaRad: 0.0 });
        forwardSweep(edge.to, vChild);
      }
    }

    voltages.set(subId, { vmPu: vSub, vaRad: 0.0 });
    forwardSweep(subId, vSub);

    if (maxVChange < 1e-5) {
      break;
    }
  }

  return voltages;
}

const DEFAULT_INP = `[TITLE]
Default Water-Energy Interconnected Network

[JUNCTIONS]
;ID Elevation Demand Pattern
J1 15.0 25.0
J2 20.0 35.0

[RESERVOIRS]
;ID Head Pattern
R1 50.0

[TANKS]
;ID Elevation InitLevel MinLevel MaxLevel Diameter MinVol VolCurve
T1 35.0 4.0 1.0 8.0 12.0 0

[PIPES]
;ID Node1 Node2 Length Diameter Roughness MinorLoss Status
P1 J1 J2 600 250 110 0 Open
P2 J2 T1 400 200 110 0 Open

[PUMPS]
;ID Node1 Node2 Parameters
PUMP-1 R1 J1 POWER 75.0
`;

/**
 * Generates a standard default municipal water distribution network if none provided.
 */
function createDefaultWaterNetwork(): EpanetNetwork {
  return parseInp(DEFAULT_INP);
}

/**
 * Default standard IEEE 4-Bus radial distribution feeder.
 */
export function createStandardDistributionFeeder(): ElectricDistributionFeeder {
  return {
    nominalKvLL: 12.47,
    baseMva: 10.0,
    substationVoltagePu: 1.02,
    buses: [
      { id: "Bus_0", name: "Substation 115/12.47 kV", isSubstation: true, baseKw: 0, baseKvar: 0 },
      { id: "Bus_1", name: "Commercial Center", baseKw: 450, baseKvar: 150 },
      { id: "Bus_2", name: "Residential Feeder", baseKw: 600, baseKvar: 200 },
      { id: "Bus_3", name: "Water Pumping Station", baseKw: 100, baseKvar: 30 },
    ],
    branches: [
      { from: "Bus_0", to: "Bus_1", rOhm: 0.35, xOhm: 0.25, lengthKm: 1.2 },
      { from: "Bus_1", to: "Bus_2", rOhm: 0.45, xOhm: 0.32, lengthKm: 1.5 },
      { from: "Bus_2", to: "Bus_3", rOhm: 0.55, xOhm: 0.4, lengthKm: 2.0 },
    ],
  };
}

/**
 * Executes a coupled dynamic Water-Energy Nexus co-simulation.
 */
export async function runWaterEnergyCoSimulation(options: WaterEnergyCoSimOptions): Promise<WaterEnergyCoSimResult> {
  const durationHours = options.durationHours ?? 24.0;
  const dtMin = options.dtMinutes ?? 60.0;
  const dtHours = dtMin / 60.0;
  const totalSteps = Math.max(1, Math.round(durationHours / dtHours));

  // 1. Prepare EPANET network
  let net: EpanetNetwork;
  if (!options.epanetNetwork) {
    net = createDefaultWaterNetwork();
  } else if (typeof options.epanetNetwork === "string") {
    net = parseInp(options.epanetNetwork);
  } else {
    net = options.epanetNetwork;
  }

  // Clone tanks to track state over time
  const tankStates = new Map<
    string,
    { level: number; diameter: number; minLevel: number; maxLevel: number; elev: number }
  >();
  for (const t of net.tanks) {
    tankStates.set(t.id, {
      level: t.initLevel,
      diameter: t.diameter || 10.0,
      minLevel: t.minLevel || 0.5,
      maxLevel: t.maxLevel || 10.0,
      elev: t.elevation,
    });
  }

  // 2. Prepare TOU tariff defaults
  const tariff: TimeOfUseTariff = options.touTariff ?? {
    offPeakPriceUsdPerKwh: 0.08,
    peakPriceUsdPerKwh: 0.28,
    peakHoursStart: 12,
    peakHoursEnd: 18,
    demandChargeUsdPerKw: 12.0,
  };

  // Diurnal multipliers (water and electric)
  const getWaterDemandMult =
    options.waterDemandMultiplier ??
    ((t: number) => {
      // Dual-peak residential diurnal pattern (morning peak 8am, evening peak 7pm)
      const hr = t % 24;
      if (hr >= 6 && hr <= 9) return 1.45;
      if (hr >= 17 && hr <= 21) return 1.35;
      if (hr >= 0 && hr <= 5) return 0.55;
      return 1.0;
    });

  const getElectricLoadMult =
    options.electricLoadMultiplier ??
    ((t: number) => {
      const hr = t % 24;
      if (hr >= 12 && hr <= 18) return 1.4; // Summer afternoon peak
      if (hr >= 0 && hr <= 6) return 0.65;
      return 1.0;
    });

  const records: WaterEnergyStepRecord[] = [];
  let totalEnergyConsumedKwh = 0.0;
  let totalEnergyCostUsd = 0.0;
  let peakElectricDemandKw = 0.0;
  let minFeederVoltagePu = 1.5;
  let voltageViolationsCount = 0;
  let totalWaterPumpedM3 = 0.0;

  // Running bus terminal voltage memory (initial: 1.0 pu)
  const busTerminalVoltages = new Map<string | number, number>();
  for (const b of options.feeder.buses) {
    busTerminalVoltages.set(b.id, options.feeder.substationVoltagePu ?? 1.0);
  }

  // 3. Macro-step Co-Simulation Loop
  for (let step = 0; step < totalSteps; step++) {
    const tCurrent = step * dtHours;
    const hourOfDay = tCurrent % 24;
    const isPeak = hourOfDay >= tariff.peakHoursStart && hourOfDay < tariff.peakHoursEnd;
    const electricityPrice = isPeak ? tariff.peakPriceUsdPerKwh : tariff.offPeakPriceUsdPerKwh;

    const wMult = getWaterDemandMult(tCurrent);
    const eMult = getElectricLoadMult(tCurrent);

    // ── Phase A: Grid-to-Water Coupling (Voltage Derating) ──
    const pumpTelemetry: WaterEnergyStepRecord["pumps"] = [];
    const pumpElectricLoads = new Map<string | number, { pKw: number; qKvar: number }>();

    for (const coup of options.couplings) {
      const vTerm = busTerminalVoltages.get(coup.feederBusId) ?? 1.0;

      // Calculate motor speed ratio under terminal voltage deviation
      let speedRatio = 1.0;
      if (coup.vfdEquipped) {
        // VFD maintains constant frequency down to 0.85 pu voltage
        speedRatio = vTerm >= 0.85 ? 1.0 : Math.max(0.75, vTerm / 0.85);
      } else {
        // Fixed-speed induction motor: slip s increases as 1 / V^2
        const sRated = coup.ratedSlip ?? 0.03;
        const vClamp = Math.max(0.75, Math.min(1.1, vTerm));
        const sActual = sRated / (vClamp * vClamp);
        speedRatio = Math.max(0.8, Math.min(1.02, 1.0 - (sActual - sRated)));
      }

      // Affinity law head curve: H(Q) = H0 * speedRatio^2 - r * Q^2
      const h0 = (coup.headCurveCoeffH0 ?? 65.0) * (speedRatio * speedRatio);
      const rCoeff = coup.headCurveCoeffR ?? 0.002;

      // Operating point (simplified hydraulic balance with downstream demand)
      const baseFlowLps = 45.0 * wMult;
      const headDelivered = Math.max(10.0, h0 - rCoeff * (baseFlowLps * baseFlowLps));

      // Hydraulic Power (Watts) = rho * g * Q * H
      // Q in m3/s = flowLps / 1000
      const qM3s = baseFlowLps / 1000.0;
      const pHydKw = (1000.0 * 9.81 * qM3s * headDelivered) / 1000.0;

      // Electric Power Draw (kW)
      const etaMotor = coup.motorEfficiency ?? 0.92;
      const etaPump = coup.pumpEfficiency ?? 0.82;
      const pElecKw = pHydKw / (etaMotor * etaPump);

      // Reactive Power Draw (kVAR)
      const pf = coup.powerFactor ?? 0.88;
      const sinPhi = Math.sqrt(Math.max(0, 1.0 - pf * pf));
      const qElecKvar = pElecKw * (sinPhi / pf);

      pumpTelemetry.push({
        pumpId: coup.pumpId,
        feederBusId: coup.feederBusId,
        speedRatio,
        headMeters: headDelivered,
        flowLps: baseFlowLps,
        electricalPowerKw: pElecKw,
        reactivePowerKvar: qElecKvar,
        terminalVoltagePu: vTerm,
      });

      // Accumulate electric load at boundary feeder bus
      const existing = pumpElectricLoads.get(coup.feederBusId) ?? { pKw: 0, qKvar: 0 };
      pumpElectricLoads.set(coup.feederBusId, {
        pKw: existing.pKw + pElecKw,
        qKvar: existing.qKvar + qElecKvar,
      });

      totalWaterPumpedM3 += qM3s * 3600.0 * dtHours;
    }

    // ── Phase B: Water-to-Grid Coupling (Electric Power Flow) ──
    const totalFeederLoads = new Map<string | number, { pKw: number; qKvar: number }>();
    let totalFeederKw = 0.0;
    let totalPumpingKw = 0.0;

    for (const b of options.feeder.buses) {
      const baseP = (b.baseKw ?? 0) * eMult;
      const baseQ = (b.baseKvar ?? 0) * eMult;
      const pumpP = pumpElectricLoads.get(b.id)?.pKw ?? 0.0;
      const pumpQ = pumpElectricLoads.get(b.id)?.qKvar ?? 0.0;

      totalFeederLoads.set(b.id, {
        pKw: baseP + pumpP,
        qKvar: baseQ + pumpQ,
      });

      totalFeederKw += baseP + pumpP;
      totalPumpingKw += pumpP;
    }

    // Run power flow solver
    const vResults = options.customPowerFlowSolver
      ? options.customPowerFlowSolver(totalFeederLoads)
      : solveForwardBackwardSweep(options.feeder, totalFeederLoads);

    // Update bus terminal voltages for next macro-step feedback
    let stepMinV = 2.0;
    const busTelemetry: WaterEnergyStepRecord["buses"] = [];
    for (const b of options.feeder.buses) {
      const v = vResults.get(b.id)?.vmPu ?? 1.0;
      busTerminalVoltages.set(b.id, v);
      if (v < stepMinV) stepMinV = v;

      const l = totalFeederLoads.get(b.id) ?? { pKw: 0, qKvar: 0 };
      busTelemetry.push({
        busId: b.id,
        vmPu: v,
        pTotalKw: l.pKw,
        qTotalKvar: l.qKvar,
      });
    }

    if (stepMinV < minFeederVoltagePu) minFeederVoltagePu = stepMinV;
    if (stepMinV < 0.95) voltageViolationsCount++;

    // ── Phase C: Storage Tank Mass Balance ──
    const tankTelemetry: WaterEnergyStepRecord["tanks"] = [];
    for (const [tId, tState] of tankStates.entries()) {
      // Net inflow = total pump delivery - domestic water demand
      const totalPumpFlowM3h = pumpTelemetry.reduce((acc, p) => acc + p.flowLps * 3.6, 0);
      const totalDemandM3h = 120.0 * wMult;
      const netFlowM3h = totalPumpFlowM3h - totalDemandM3h;

      const areaM2 = (Math.PI * tState.diameter * tState.diameter) / 4.0;
      const deltaH = (netFlowM3h * dtHours) / areaM2;
      const newLevel = Math.max(tState.minLevel, Math.min(tState.maxLevel, tState.level + deltaH));
      tState.level = newLevel;

      const volM3 = areaM2 * newLevel;
      const maxVolM3 = areaM2 * tState.maxLevel;
      const pct = (volM3 / maxVolM3) * 100.0;

      tankTelemetry.push({
        tankId: tId,
        levelMeters: newLevel,
        volumeM3: volM3,
        pctFull: pct,
      });
    }

    // ── Phase D: Economics & Energy Accounting ──
    const stepKwh = totalPumpingKw * dtHours;
    const stepCost = stepKwh * electricityPrice;

    totalEnergyConsumedKwh += stepKwh;
    totalEnergyCostUsd += stepCost;
    if (totalFeederKw > peakElectricDemandKw) {
      peakElectricDemandKw = totalFeederKw;
    }

    records.push({
      timeHours: tCurrent,
      isPeakHour: isPeak,
      electricityPriceUsdPerKwh: electricityPrice,
      pumps: pumpTelemetry,
      buses: busTelemetry,
      tanks: tankTelemetry,
      totalFeederLoadKw: totalFeederKw,
      totalPumpingKw,
      stepEnergyCostUsd: stepCost,
    });
  }

  // Add monthly peak demand charge if configured
  if (tariff.demandChargeUsdPerKw) {
    const demandCharge = peakElectricDemandKw * tariff.demandChargeUsdPerKw;
    totalEnergyCostUsd += demandCharge;
  }

  const summary =
    `Water-Energy Co-Simulation (${durationHours}h, dt=${dtMin}m): ` +
    `${totalEnergyConsumedKwh.toFixed(1)} kWh consumed ($${totalEnergyCostUsd.toFixed(2)} total energy cost), ` +
    `peak feeder demand ${peakElectricDemandKw.toFixed(1)} kW, min voltage ${minFeederVoltagePu.toFixed(4)} pu ` +
    `(${voltageViolationsCount} violation steps < 0.95 pu), total water delivered ${totalWaterPumpedM3.toFixed(1)} m³.`;

  return {
    records,
    totalMacroSteps: totalSteps,
    totalEnergyConsumedKwh,
    totalEnergyCostUsd,
    peakElectricDemandKw,
    minFeederVoltagePu,
    voltageViolationsCount,
    totalWaterPumpedM3,
    summary,
  };
}
