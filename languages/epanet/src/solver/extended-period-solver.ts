// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Extended Period Simulation (EPS) Dynamic Engine.
 *
 * Simulates extended-duration hydraulic behavior (24h to 168h) in municipal water distribution networks:
 * - Time-marching integration of storage tank level and volume dynamics (dV/dt = Qin - Qout).
 * - Multi-pattern diurnal demand curves for residential, commercial, and industrial loads.
 * - Dynamic operational control rule evaluation (tank level triggers, timer switching).
 * - Pumping energy consumption tracking (kW and cumulative kWh).
 */

import type { EpanetNetwork } from "../types.js";
import {
  solveHydraulics,
  type EpanetHydraulicResult,
  type EpanetPddOptions,
  type EpanetSolverOptions,
} from "./todini-ggm.js";

export interface EpanetEpsStep {
  timeSeconds: number;
  timeHours: number;
  converged: boolean;
  iterations: number;
  nodeHeads: Map<string, number>;
  nodePressures: Map<string, number>;
  nodeDemands: Map<string, number>;
  linkFlows: Map<string, number>;
  linkVelocities: Map<string, number>;
  tankLevels: Map<string, number>;
  tankVolumes: Map<string, number>;
  pumpPowersKw: Map<string, number>;
}

export interface EpanetEpsOptions {
  durationHours?: number | undefined; // default 24h
  stepHours?: number | undefined; // default 1h
  patternStepHours?: number | undefined; // default 1h
  pdd?: EpanetPddOptions | undefined;
  maxIterations?: number | undefined;
  tolerance?: number | undefined;
  useWasm?: boolean | undefined;
}

export interface EpanetEpsResult {
  steps: EpanetEpsStep[];
  totalEnergyKwh: number;
  minSystemPressure: number;
  maxSystemPressure: number;
  criticalJunctions: string[];
}

/**
 * Executes a full Extended Period Simulation (EPS) over the configured time horizon.
 */
export function solveExtendedPeriod(net: EpanetNetwork, options?: EpanetEpsOptions): EpanetEpsResult {
  const durationHours = options?.durationHours ?? net.options?.durationHours ?? 24;
  const stepHours = options?.stepHours ?? net.options?.hydraulicStepHours ?? 1;
  const patternStepHours = options?.patternStepHours ?? net.options?.patternStepHours ?? 1;
  const stepSeconds = stepHours * 3600;
  const numSteps = Math.max(1, Math.floor(durationHours / stepHours));

  // Current dynamic state
  const currentTankLevels = new Map<string, number>();
  for (const t of net.tanks) {
    currentTankLevels.set(t.id.toLowerCase(), t.initLevel);
  }

  const currentLinkStatuses = new Map<string, "OPEN" | "CLOSED">();
  for (const p of net.pipes) {
    currentLinkStatuses.set(p.id.toLowerCase(), p.status === "CLOSED" ? "CLOSED" : "OPEN");
  }
  for (const pump of net.pumps ?? []) {
    currentLinkStatuses.set(pump.id.toLowerCase(), pump.status === "CLOSED" ? "CLOSED" : "OPEN");
  }
  for (const v of net.valves ?? []) {
    currentLinkStatuses.set(v.id.toLowerCase(), "OPEN");
  }

  // Pre-index patterns (case-insensitive)
  const patternMap = new Map<string, number[]>();
  for (const pat of net.patterns ?? []) {
    patternMap.set(pat.id.toLowerCase(), pat.multipliers);
  }

  const steps: EpanetEpsStep[] = [];
  let totalEnergyKwh = 0.0;
  let minSystemPressure = Number.POSITIVE_INFINITY;
  let maxSystemPressure = Number.NEGATIVE_INFINITY;
  const criticalJuncSet = new Set<string>();

  // G_ACCEL and water density rho for power calculation: P = rho * g * Q * H / 1000 (kW)
  const G_ACCEL = 9.80665;
  const PUMP_EFFICIENCY = 0.75; // standard municipal wire-to-water efficiency

  for (let s = 0; s < numSteps; s++) {
    const tHours = s * stepHours;
    const tSeconds = tHours * 3600;

    // 1. Evaluate operational controls based on current time and previous state
    for (const ctrl of net.controls ?? []) {
      const linkKey = ctrl.linkId.toLowerCase();
      if (ctrl.conditionType === "TIME" || ctrl.conditionType === "CLOCKTIME") {
        if (tHours >= ctrl.value) {
          currentLinkStatuses.set(linkKey, ctrl.status);
        }
      } else if (ctrl.nodeId) {
        const nodeKey = ctrl.nodeId.toLowerCase();
        let measuredVal = 0.0;
        if (ctrl.conditionType === "TANK_LEVEL" && currentTankLevels.has(nodeKey)) {
          measuredVal = currentTankLevels.get(nodeKey)!;
        } else if (steps.length > 0) {
          const prev = steps[steps.length - 1]!;
          if (ctrl.conditionType === "NODE_PRESSURE") {
            measuredVal = prev.nodePressures.get(ctrl.nodeId) ?? 0.0;
          } else if (ctrl.conditionType === "NODE_HEAD") {
            measuredVal = prev.nodeHeads.get(ctrl.nodeId) ?? 0.0;
          }
        }

        if (ctrl.operator === "BELOW" && measuredVal < ctrl.value) {
          currentLinkStatuses.set(linkKey, ctrl.status);
        } else if (ctrl.operator === "ABOVE" && measuredVal > ctrl.value) {
          currentLinkStatuses.set(linkKey, ctrl.status);
        }
      }
    }

    // 2. Compute dynamic junction demands according to assigned patterns
    const currentDemands = new Map<string, number>();
    for (const junc of net.junctions) {
      let mult = 1.0;
      if (junc.patternId) {
        const patMults = patternMap.get(junc.patternId.toLowerCase());
        if (patMults && patMults.length > 0) {
          const patIdx = Math.floor(tHours / patternStepHours) % patMults.length;
          mult = patMults[patIdx] ?? 1.0;
        }
      }
      currentDemands.set(junc.id.toLowerCase(), junc.demand * mult);
    }

    // 3. Solve hydraulics for current time slice
    const solverOpts: EpanetSolverOptions = {
      maxIterations: options?.maxIterations ?? 40,
      tolerance: options?.tolerance ?? 0.001,
      useWasm: options?.useWasm ?? false,
      demandOverrides: currentDemands,
      tankLevels: currentTankLevels,
      linkStatusOverrides: currentLinkStatuses,
      pdd: options?.pdd,
    };

    const hydResult: EpanetHydraulicResult = solveHydraulics(net, solverOpts);

    // 4. Track pressures across demand junctions and identify critical junctions (e.g. pressure < 14m / 20 psi)
    for (const junc of net.junctions) {
      const press = hydResult.nodePressures.get(junc.id) ?? 0.0;
      if (press < minSystemPressure) minSystemPressure = press;
      if (press > maxSystemPressure) maxSystemPressure = press;
      if (press < 14.0) {
        criticalJuncSet.add(junc.id);
      }
    }

    // 5. Compute pumping power and energy for this step
    const pumpPowers = new Map<string, number>();
    for (const pump of net.pumps ?? []) {
      const qFlow = hydResult.linkFlows.get(pump.id) ?? 0.0;
      const status = currentLinkStatuses.get(pump.id.toLowerCase()) ?? pump.status;
      if (status !== "CLOSED" && qFlow > 0.01) {
        const h1 = hydResult.nodeHeads.get(pump.node1) ?? 0.0;
        const h2 = hydResult.nodeHeads.get(pump.node2) ?? 0.0;
        const hGain = Math.max(0.0, h2 - h1);
        const qSI = qFlow / 1000.0; // m^3/s
        const powerKw = (qSI * G_ACCEL * hGain) / PUMP_EFFICIENCY;
        pumpPowers.set(pump.id, powerKw);
        totalEnergyKwh += powerKw * stepHours;
      } else {
        pumpPowers.set(pump.id, 0.0);
      }
    }

    // 6. Record step snapshot
    const stepTankLevels = new Map<string, number>();
    const stepTankVolumes = new Map<string, number>();
    for (const t of net.tanks) {
      const lvl = currentTankLevels.get(t.id.toLowerCase()) ?? t.initLevel;
      const diam = Math.max(0.5, t.diameter);
      const area = (Math.PI * diam * diam) / 4.0;
      const vol = t.minVol + area * Math.max(0.0, lvl - t.minLevel);
      stepTankLevels.set(t.id, lvl);
      stepTankVolumes.set(t.id, vol);
    }

    steps.push({
      timeSeconds: tSeconds,
      timeHours: tHours,
      converged: hydResult.converged,
      iterations: hydResult.iterations,
      nodeHeads: new Map(hydResult.nodeHeads),
      nodePressures: new Map(hydResult.nodePressures),
      nodeDemands: new Map(hydResult.nodeActualDemands ?? currentDemands),
      linkFlows: new Map(hydResult.linkFlows),
      linkVelocities: new Map(hydResult.linkVelocities),
      tankLevels: stepTankLevels,
      tankVolumes: stepTankVolumes,
      pumpPowersKw: pumpPowers,
    });

    // 7. Update tank storage for next time step via mass balance: dV = Qin - Qout
    for (const t of net.tanks) {
      const tIdLower = t.id.toLowerCase();
      let netInflowLps = 0.0;

      for (const p of net.pipes) {
        const flow = hydResult.linkFlows.get(p.id) ?? 0.0;
        if (p.node2.toLowerCase() === tIdLower) {
          netInflowLps += flow; // entering tank
        } else if (p.node1.toLowerCase() === tIdLower) {
          netInflowLps -= flow; // leaving tank
        }
      }

      for (const pump of net.pumps ?? []) {
        const flow = hydResult.linkFlows.get(pump.id) ?? 0.0;
        if (pump.node2.toLowerCase() === tIdLower) {
          netInflowLps += flow;
        } else if (pump.node1.toLowerCase() === tIdLower) {
          netInflowLps -= flow;
        }
      }

      for (const v of net.valves ?? []) {
        const flow = hydResult.linkFlows.get(v.id) ?? 0.0;
        if (v.node2.toLowerCase() === tIdLower) {
          netInflowLps += flow;
        } else if (v.node1.toLowerCase() === tIdLower) {
          netInflowLps -= flow;
        }
      }

      const deltaVolM3 = (netInflowLps / 1000.0) * stepSeconds;
      const diam = Math.max(0.5, t.diameter);
      const area = (Math.PI * diam * diam) / 4.0;
      const deltaH = deltaVolM3 / area;

      const currLvl = currentTankLevels.get(tIdLower) ?? t.initLevel;
      const newLvl = Math.max(t.minLevel, Math.min(t.maxLevel, currLvl + deltaH));
      currentTankLevels.set(tIdLower, newLvl);
    }
  }

  return {
    steps,
    totalEnergyKwh,
    minSystemPressure: Number.isFinite(minSystemPressure) ? minSystemPressure : 0.0,
    maxSystemPressure: Number.isFinite(maxSystemPressure) ? maxSystemPressure : 0.0,
    criticalJunctions: Array.from(criticalJuncSet),
  };
}
