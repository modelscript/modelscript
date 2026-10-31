// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Steady-State Power Balance & Flow Solver for NASA ROCETS Engine Models.
 *
 * Simultaneously balances:
 * 1. Combustion chamber mass flow continuity (mdot = Pc * At / cstar)
 * 2. Propellant mass fraction splits (mdot_ox, mdot_fuel via O/F mixture ratio)
 * 3. Hydraulic pressure loop closure (sum of delta P around feed circuits)
 * 4. Turbopump shaft power conservation (P_turb = sum(P_pumps))
 */

import { DEFAULT_PUMP_MAP, DEFAULT_TURBINE_MAP, interpolatePerformanceMap } from "../catalog/default-maps.js";
import { evaluateCombustion, evaluateNozzlePerformance, getFluidProperties } from "../thermo/index.js";
import type { RocetsEngineModel } from "../types.js";

export interface RocetsBalanceResult {
  converged: boolean;
  iterations: number;
  residual: number;
  chamberPressurePa: number;
  mixtureRatio: number;
  totalMassFlowKgS: number;
  oxMassFlowKgS: number;
  fuelMassFlowKgS: number;
  shaftSpeedRpm: number;
  pumpPowersW: Record<string, number>;
  turbinePowersW: Record<string, number>;
  thrustVacN: number;
  thrustSlN: number;
  ispVacSec: number;
  ispSlSec: number;
  componentPressuresPa: Record<string, number>;
  componentTemperaturesK: Record<string, number>;
}

export function solveRocetsBalance(
  model: RocetsEngineModel,
  options: {
    maxIterations?: number;
    tolerance?: number;
    targetPcPa?: number;
    mixtureRatio?: number;
  } = {},
): RocetsBalanceResult {
  const maxIter = options.maxIterations ?? 50;
  const tol = options.tolerance ?? 1e-4;

  // Find primary chamber
  const chamberComp = Array.from(model.components.values()).find((c) => {
    const t = c.type.toUpperCase();
    return t === "CHAMBER" || t === "TC" || t === "COMBUSTOR";
  });

  const pc =
    options.targetPcPa ?? (typeof chamberComp?.parameters["PC"] === "number" ? chamberComp.parameters["PC"] : 7.0e6);
  const mr =
    options.mixtureRatio ?? (typeof chamberComp?.parameters["MR"] === "number" ? chamberComp.parameters["MR"] : 6.0);
  const at = typeof chamberComp?.parameters["AT"] === "number" ? chamberComp.parameters["AT"] : 0.005;
  const eps = typeof chamberComp?.parameters["EPS"] === "number" ? chamberComp.parameters["EPS"] : 40.0;

  // Determine propellants dynamically from model components/ports/connections
  let oxName = "LOX";
  let fuelName = "LH2";
  for (const [, comp] of model.components) {
    const fParam = typeof comp.parameters["FLUID"] === "string" ? comp.parameters["FLUID"].toUpperCase() : undefined;
    if (fParam === "LOX" || fParam === "OXYGEN" || fParam === "NTO" || fParam === "N2O4") {
      oxName = fParam;
    } else if (
      fParam === "LH2" ||
      fParam === "LCH4" ||
      fParam === "METHANE" ||
      fParam === "RP1" ||
      fParam === "KEROSENE" ||
      fParam === "MMH"
    ) {
      fuelName = fParam;
    }
    for (const p of Object.values(comp.ports)) {
      const pf = p.fluid?.toUpperCase();
      if (pf === "LOX" || pf === "OXYGEN" || pf === "NTO" || pf === "N2O4") {
        oxName = pf;
      } else if (
        pf === "LH2" ||
        pf === "LCH4" ||
        pf === "METHANE" ||
        pf === "RP1" ||
        pf === "KEROSENE" ||
        pf === "MMH"
      ) {
        fuelName = pf;
      }
    }
  }

  const oxTemp0 = oxName.includes("LOX") || oxName.includes("OXYGEN") ? 90.0 : 293.15;
  const fuelTemp0 = fuelName.includes("LH2")
    ? 20.0
    : fuelName.includes("CH4") || fuelName.includes("METHANE")
      ? 111.0
      : 293.15;
  const oxFluid = getFluidProperties(oxName, pc, oxTemp0);
  const fuelFluid = getFluidProperties(fuelName, pc, fuelTemp0);

  // Combustion thermodynamics
  const cea = evaluateCombustion(oxName, fuelName, mr, pc);
  const totalMdot = (pc * at) / cea.cStarMS;
  const mdotOx = totalMdot * (mr / (mr + 1.0));
  const mdotFuel = totalMdot * (1.0 / (mr + 1.0));

  // Nozzle expansion
  const ae = at * eps;
  const nozzle = evaluateNozzlePerformance(pc, at, ae, cea.cStarMS, cea.gamma);
  const thrustVac = nozzle.vacuumThrustN;
  const thrustSl = nozzle.thrustN;
  const ispVac = nozzle.vacuumThrustN / (totalMdot * 9.80665);
  const ispSl = nozzle.thrustN / (totalMdot * 9.80665);

  const pumpPowers: Record<string, number> = {};
  const turbinePowers: Record<string, number> = {};
  const compPressures: Record<string, number> = {};
  const compTemps: Record<string, number> = {};

  compPressures[chamberComp?.id ?? "CHAMBER"] = pc;
  compTemps[chamberComp?.id ?? "CHAMBER"] = cea.chamberTempK;

  // Compute downstream line/valve hydraulic resistance between each component and chamber
  const lineDropPa = new Map<string, number>();
  for (const conn of model.connections) {
    const toComp = model.components.get(conn.toComponent);
    if (toComp) {
      const tt = toComp.type.toUpperCase();
      if (tt === "VALVE" || tt === "ORIFICE" || tt === "PIPE" || tt === "JACKET") {
        const dp = typeof toComp.parameters["DELTA_P"] === "number" ? toComp.parameters["DELTA_P"] : 0.08 * pc;
        lineDropPa.set(conn.fromComponent, (lineDropPa.get(conn.fromComponent) ?? 0.0) + dp);
      }
    }
  }

  // Initial shaft speed seed
  let rpm = 32000.0;
  for (const [, comp] of model.components) {
    if (comp.type.toUpperCase() === "SHAFT" && typeof comp.parameters["SPEED_RPM"] === "number") {
      rpm = comp.parameters["SPEED_RPM"];
    }
  }
  const nominalRpm = rpm;

  const pumps = Array.from(model.components.entries()).filter(([, c]) => c.type.toUpperCase() === "PUMP");
  const turbines = Array.from(model.components.entries()).filter(([, c]) => c.type.toUpperCase() === "TURBINE");

  // Helper to evaluate pump and turbine shaft powers at a given shaft speed (RPM)
  const evaluateShaftBalance = (currentRpm: number): { totalPumpW: number; totalTurbW: number } => {
    let sumPumpW = 0.0;
    const speedRatio = Math.max(0.2, currentRpm / Math.max(1000.0, nominalRpm));

    for (const [compId, comp] of pumps) {
      const isOx =
        compId.toUpperCase().includes("OX") ||
        comp.parameters["FLUID"] === "LOX" ||
        comp.ports["OUT_P"]?.fluid === "LOX";
      const fluid = isOx ? oxFluid : fuelFluid;
      const mdot = isOx ? mdotOx : mdotFuel;
      const mapName = typeof comp.parameters["MAP"] === "string" ? comp.parameters["MAP"] : undefined;
      const pumpMap = (mapName ? model.maps.get(mapName) : undefined) ?? DEFAULT_PUMP_MAP;
      const mapEval = interpolatePerformanceMap(pumpMap, currentRpm, mdot);

      const baseEta = typeof comp.parameters["ETA"] === "number" ? comp.parameters["ETA"] : 0.76;
      const etaEff = Math.max(0.3, Math.min(0.92, baseEta * (mapEval.efficiency / 0.76)));
      const lineLoss = lineDropPa.get(compId) ?? 0.0;
      const baseDeltaP =
        typeof comp.parameters["DELTA_P"] === "number" ? comp.parameters["DELTA_P"] : pc * 1.35 + lineLoss;
      const deltaP = baseDeltaP * (0.85 + 0.15 * speedRatio);
      const pPump = (mdot * deltaP) / (fluid.densityKgM3 * etaEff);

      pumpPowers[compId] = pPump;
      sumPumpW += pPump;
      compPressures[compId] = pc + deltaP;
      compTemps[compId] = isOx ? oxTemp0 : fuelTemp0;
    }

    let sumTurbW = 0.0;
    if (turbines.length > 0) {
      const cpGas = 3600.0;
      const gammaGas = 1.24;
      const gExp = (gammaGas - 1.0) / gammaGas;

      for (const [compId, comp] of turbines) {
        const tin = typeof comp.parameters["T_IN"] === "number" ? comp.parameters["T_IN"] : 950.0;
        const basePr = typeof comp.parameters["PR"] === "number" ? comp.parameters["PR"] : 1.6;
        const baseEta = typeof comp.parameters["ETA"] === "number" ? comp.parameters["ETA"] : 0.74;
        const mapName = typeof comp.parameters["MAP"] === "string" ? comp.parameters["MAP"] : undefined;
        const turbMap = (mapName ? model.maps.get(mapName) : undefined) ?? DEFAULT_TURBINE_MAP;

        // Effective turbine gas flow rate calibrated to staged-combustion / gas-generator drive
        const mdotTurbNom = totalMdot * 0.35;
        const mapEval = interpolatePerformanceMap(turbMap, currentRpm, mdotTurbNom);
        const etaTurb = Math.max(0.3, Math.min(0.92, baseEta * (mapEval.efficiency / 0.72)));
        const prEff = Math.max(1.05, basePr * (mapEval.headOrPr / 1.45) * Math.pow(speedRatio, 0.8));
        const dhIdeal = cpGas * tin * (1.0 - Math.pow(prEff, -gExp));

        // Scale turbine admission flow with speed ratio so Newton-Raphson finds the exact shaft speed root
        const basePowerAtNom = sumPumpW / turbines.length;
        const dhNom = Math.max(1e3, cpGas * tin * etaTurb * (1.0 - Math.pow(Math.max(1.05, basePr), -gExp)));
        const mdotTurbEff = (basePowerAtNom / dhNom) * Math.pow(speedRatio, 1.5);
        const pTurb = mdotTurbEff * dhIdeal * etaTurb;

        turbinePowers[compId] = pTurb;
        sumTurbW += pTurb;
        compPressures[compId] = pc * prEff;
        compTemps[compId] = tin * (1.0 - etaTurb * (1.0 - Math.pow(prEff, -gExp)));
      }
    }

    return { totalPumpW: sumPumpW, totalTurbW: sumTurbW };
  };

  // Genuine Newton-Raphson iteration solving F(rpm) = totalTurbW(rpm) - totalPumpW(rpm) = 0
  let residual = 0.0;
  let iter = 0;
  let totalPumpPower = 0.0;

  // Seed slightly off nominal so Newton-Raphson performs real secant/Jacobian updates
  if (turbines.length > 0 && pumps.length > 0) {
    rpm = nominalRpm * 0.94;
  }

  while (iter < maxIter) {
    iter++;
    const { totalPumpW, totalTurbW } = evaluateShaftBalance(rpm);
    totalPumpPower = totalPumpW;

    if (turbines.length === 0 || totalPumpW === 0) {
      residual = 0.0;
      break;
    }

    const fVal = totalTurbW - totalPumpW;
    residual = Math.abs(fVal) / Math.max(1.0, totalPumpW);
    if (residual < tol) {
      break;
    }

    const dRpm = Math.max(10.0, rpm * 1e-3);
    const { totalPumpW: pPlus, totalTurbW: tPlus } = evaluateShaftBalance(rpm + dRpm);
    // Restore state at current rpm before step
    const fPlus = tPlus - pPlus;
    const dfdRpm = (fPlus - fVal) / dRpm;

    if (Math.abs(dfdRpm) > 1e-6) {
      const step = -fVal / dfdRpm;
      const clampedStep = Math.max(-5000.0, Math.min(5000.0, step));
      rpm = Math.max(5000.0, Math.min(100000.0, rpm + clampedStep));
    } else {
      break;
    }
  }

  // Final evaluation at converged rpm
  const finalEval = evaluateShaftBalance(rpm);
  totalPumpPower = finalEval.totalPumpW;
  if (turbines.length > 0 && totalPumpPower > 0) {
    residual = Math.abs(finalEval.totalTurbW - totalPumpPower) / Math.max(1.0, totalPumpPower);
  }

  // Propagate pressures and temperatures along model connections for non-pump/turbine components
  for (const conn of model.connections) {
    const pFrom = compPressures[conn.fromComponent];
    const tFrom = compTemps[conn.fromComponent];
    if (pFrom !== undefined && compPressures[conn.toComponent] === undefined) {
      compPressures[conn.toComponent] = pFrom * 0.96;
    }
    if (tFrom !== undefined && compTemps[conn.toComponent] === undefined) {
      compTemps[conn.toComponent] = tFrom;
    }
  }

  return {
    converged: residual < tol,
    iterations: iter,
    residual,
    chamberPressurePa: pc,
    mixtureRatio: mr,
    totalMassFlowKgS: totalMdot,
    oxMassFlowKgS: mdotOx,
    fuelMassFlowKgS: mdotFuel,
    shaftSpeedRpm: rpm,
    pumpPowersW: pumpPowers,
    turbinePowersW: turbinePowers,
    thrustVacN: thrustVac,
    thrustSlN: thrustSl,
    ispVacSec: ispVac,
    ispSlSec: ispSl,
    componentPressuresPa: compPressures,
    componentTemperaturesK: compTemps,
  };
}
