// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Transient 1D Compressible Gas Euler Solver.
 *
 * Implements staggered-grid spatial discretization of transient continuity and momentum
 * equations with AGA-8 real-gas acoustic wave speeds. Lowers directly to DAE arrays.
 */

import type { LpsModel, LpsTransientTrajectory } from "../../types.js";
import { Aga8Eos } from "../eos/aga8-detailed.js";
import { Gerg2008Eos } from "../eos/gerg2008.js";
import { SteadyNetworkSolver } from "../steady/steady-network-solver.js";

export class GasEulerDaeSolver {
  /**
   * Simulates transient compressible gas dynamics across the pipeline network over time.
   */
  static simulate(
    model: LpsModel,
    options?:
      | {
          durationSeconds?: number | undefined;
          timeStep?: number | undefined;
          initialP?: Map<string, number> | undefined;
          initialW?: Map<string, number> | undefined;
          startTime?: number | undefined;
        }
      | undefined,
  ): LpsTransientTrajectory {
    // 1. Initial condition from steady-state or checkpoint override
    const steady = SteadyNetworkSolver.solve(model);

    const duration = options?.durationSeconds ?? model.simulationControls.endTime ?? 3600;
    const dt = options?.timeStep ?? model.simulationControls.timeStep ?? 10;
    const t0 = options?.startTime ?? 0;
    const numSteps = Math.max(1, Math.floor(duration / dt));

    const times: number[] = [];
    const nodePressures: Record<string, number[]> = {};
    const pipeFlows: Record<string, number[]> = {};
    const linePackHistory: number[] = [];

    // Initialize trajectory arrays
    for (const node of model.nodes) {
      nodePressures[node.name] = [];
    }
    for (const pipe of model.pipes) {
      pipeFlows[pipe.name] = [];
    }

    // State maps
    const currentP = new Map<string, number>();
    const currentW = new Map<string, number>();

    for (const node of model.nodes) {
      currentP.set(node.name, options?.initialP?.get(node.name) ?? steady.nodeStates[node.name]?.pressure ?? 50e5);
    }
    for (const pipe of model.pipes) {
      currentW.set(pipe.name, options?.initialW?.get(pipe.name) ?? steady.pipeStates[pipe.name]?.massFlow ?? 30.0);
    }

    const comp = model.gasComposition ?? {
      methane: 0.92,
      ethane: 0.04,
      propane: 0.015,
      nButane: 0.005,
      iButane: 0.005,
      pentanes: 0.002,
      hexanePlus: 0.001,
      nitrogen: 0.008,
      carbonDioxide: 0.004,
      hydrogen: 0.0,
      standardDensity: 0.77,
    };

    const useGerg = model.simulationControls?.equationOfState === "GERG2008";

    // Staggered grid integration loop
    for (let step = 0; step <= numSteps; step++) {
      const t = t0 + step * dt;
      times.push(t);

      let stepTotalLinePackKg = 0;

      // 1. Update Pipe Flows (Momentum: dw/dt = -A*dP/dx - friction)
      for (const pipe of model.pipes) {
        const pIn = currentP.get(pipe.fromNode) ?? 50e5;
        const pOut = currentP.get(pipe.toNode) ?? 45e5;
        const tempK = pipe.ambientTemperature ?? 288.15;

        const eos = useGerg
          ? Gerg2008Eos.evaluate((pIn + pOut) / 2, tempK, comp)
          : Aga8Eos.evaluate((pIn + pOut) / 2, tempK, comp);
        const rho = eos.massDensity;
        const area = Math.PI * (pipe.diameter / 2) ** 2;

        const w = currentW.get(pipe.name) ?? 30.0;
        const u = w / (rho * area);
        const mu = 1.1e-5;
        const re = (rho * Math.abs(u) * pipe.diameter) / mu;
        const f = SteadyNetworkSolver.getFrictionFactor(pipe.diameter, pipe.roughness, re);

        const pressureForce = (-area * (pOut - pIn)) / pipe.length;
        const frictionForce = -(f * w * Math.abs(w)) / (2 * rho * pipe.diameter * area);
        const dwdt = pressureForce + frictionForce;

        const updatedW = w + dwdt * dt;
        currentW.set(pipe.name, updatedW);
        const pFlowArr = pipeFlows[pipe.name];
        if (pFlowArr) pFlowArr.push(updatedW);

        // Accumulate line pack
        stepTotalLinePackKg += area * pipe.length * rho;
      }

      linePackHistory.push(stepTotalLinePackKg);

      // 2. Update Node Pressures (Continuity: dP/dt = (a^2 / V) * sum(w_in - w_out))
      for (const node of model.nodes) {
        const currPNode = currentP.get(node.name) ?? 50e5;
        const nodeArr = nodePressures[node.name];

        if (node.type === "SUPPLY" && node.pressure != null) {
          if (nodeArr) nodeArr.push(currPNode);
          continue;
        }

        let netMassRate = 0;
        let attachedVolume = 0;

        for (const pipe of model.pipes) {
          const area = Math.PI * (pipe.diameter / 2) ** 2;
          const halfVol = (area * pipe.length) / 2;
          const wPipe = currentW.get(pipe.name) ?? 0;
          if (pipe.toNode === node.name) {
            netMassRate += wPipe;
            attachedVolume += halfVol;
          }
          if (pipe.fromNode === node.name) {
            netMassRate -= wPipe;
            attachedVolume += halfVol;
          }
        }

        if (node.type === "DELIVERY" && node.flowRate != null) {
          netMassRate -= node.flowRate;
        }

        let nextP = currPNode;
        if (attachedVolume > 0) {
          const eos = useGerg
            ? Gerg2008Eos.evaluate(currPNode, node.temperature ?? 288.15, comp)
            : Aga8Eos.evaluate(currPNode, node.temperature ?? 288.15, comp);
          const a = eos.speedOfSound;
          const dpdt = (a ** 2 / attachedVolume) * netMassRate;
          nextP = currPNode + dpdt * dt;
          currentP.set(node.name, nextP);
        }

        if (nodeArr) nodeArr.push(nextP);
      }
    }

    return {
      times,
      nodePressures,
      pipeFlows,
      linePackHistory,
    };
  }
}
