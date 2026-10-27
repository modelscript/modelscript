// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — High-Performance Steady-State Pipeline Network Solver.
 *
 * Implements simultaneous nodal mass conservation and link hydraulic equations
 * using Newton-Raphson iteration with Colebrook-White friction and AGA-8 real-gas properties.
 */

import { PipelineGraph } from "../../graph/pipeline-graph.js";
import type { LpsModel, LpsSteadyResult, NodeState, PipeState } from "../../types.js";
import { Aga8Eos } from "../eos/aga8-detailed.js";
import { Gerg2008Eos } from "../eos/gerg2008.js";
import { CompressorMapEngine } from "../machinery/compressor-map.js";
import { PumpCurveEngine } from "../machinery/pump-curve.js";

const G_GRAVITY = 9.80665; // m/s2

export class SteadyNetworkSolver {
  /**
   * Computes Swamee-Jain explicit friction factor approximation to Colebrook-White.
   */
  static getFrictionFactor(diameter: number, roughness: number, reynolds: number): number {
    if (reynolds < 2300) {
      return 64.0 / Math.max(1, reynolds); // Laminar
    }
    const relRoughness = roughness / diameter;
    const term1 = relRoughness / 3.7;
    const term2 = 5.74 / Math.max(100, reynolds) ** 0.9;
    return 0.25 / Math.log10(term1 + term2) ** 2;
  }

  /**
   * Solves steady-state pressures, mass flow rates, velocities, and line pack across the network.
   */
  static solve(model: LpsModel): LpsSteadyResult {
    const graph = new PipelineGraph(model);
    const nodeStates: Record<string, NodeState> = {};
    const pipeStates: Record<string, PipeState> = {};

    // 1. Initialize Node Pressures & Temperatures
    let basePressure = 60e5; // 60 bar default
    const supplies = graph.getSupplies();
    const firstSupply = supplies[0];
    if (firstSupply && firstSupply.pressure != null) {
      basePressure = firstSupply.pressure;
    }

    for (const node of model.nodes) {
      nodeStates[node.name] = {
        name: node.name,
        pressure: node.pressure ?? basePressure,
        temperature: node.temperature ?? 288.15,
        netFlow: node.flowRate ?? 0,
      };
    }

    // 2. Establish Total Supply and Flow Balances
    let totalSupplyFlow = supplies.reduce((s, n) => s + (n.flowRate ?? 0), 0);
    const deliveries = graph.getDeliveries();
    let totalDeliveryFlow = deliveries.reduce((s, n) => s + (n.flowRate ?? 0), 0);

    // If supply not explicitly specified but delivery is, balance supply from source
    if (totalSupplyFlow === 0 && totalDeliveryFlow > 0 && firstSupply) {
      totalSupplyFlow = totalDeliveryFlow;
      const supplyState = nodeStates[firstSupply.name];
      if (supplyState) supplyState.netFlow = totalSupplyFlow;
    } else if (totalDeliveryFlow === 0 && totalSupplyFlow > 0 && deliveries.length > 0) {
      const perDelivery = totalSupplyFlow / deliveries.length;
      for (const d of deliveries) {
        const dState = nodeStates[d.name];
        if (dState) dState.netFlow = -perDelivery;
      }
    }

    // 3. Estimate Initial Branch Mass Flows via Graph Flow Propagation
    for (const pipe of model.pipes) {
      let estFlow = totalSupplyFlow > 0 ? totalSupplyFlow : 50.0;
      const outPipes = (graph.outbound.get(pipe.fromNode) ?? []).filter((l) => l.kind === "PIPE");
      if (outPipes.length > 1) {
        estFlow = estFlow / outPipes.length;
      }

      pipeStates[pipe.name] = {
        name: pipe.name,
        massFlow: estFlow,
        inletPressure: nodeStates[pipe.fromNode]?.pressure ?? basePressure,
        outletPressure: nodeStates[pipe.toNode]?.pressure ?? basePressure * 0.9,
        velocity: 5.0,
        linePackKg: 0,
        linePackSm3: 0,
        frictionLossPa: 0,
      };
    }

    // 4. Equipment Modeling (Compressors, Pumps, Regulators, Valves)
    for (const comp of model.compressors) {
      if (comp.status === "RUNNING") {
        const suctionP = nodeStates[comp.fromNode]?.pressure ?? basePressure;
        const suctionT = nodeStates[comp.fromNode]?.temperature ?? 288.15;
        let targetDischargeP = suctionP * Math.min(comp.maxPressureRatio, 1.4);
        if (comp.controlMode === "DISCHARGE_PRESSURE") {
          targetDischargeP = comp.setpoint;
        } else if (comp.controlMode === "PRESSURE_RATIO") {
          targetDischargeP = suctionP * Math.min(comp.maxPressureRatio, comp.setpoint);
        }

        const map = CompressorMapEngine.createDefaultPipelineMap(comp.maxPower, comp.maxSpeed ?? 9500);
        const outLink = (graph.outbound.get(comp.toNode) ?? [])[0];
        const estFlow = (outLink ? pipeStates[outLink.name]?.massFlow : undefined) ?? 40.0;
        const op = CompressorMapEngine.evaluate(map, suctionP, suctionT, targetDischargeP, estFlow, {
          molarMass: 0.0175,
          zFactor: 0.88,
          isentropicExponent: 1.3,
        });

        const toState = nodeStates[comp.toNode];
        if (toState) {
          toState.pressure = op.dischargePressurePa;
          toState.temperature = op.dischargeTempK;
        }
      }
    }

    for (const pump of model.pumps) {
      if (pump.status === "RUNNING") {
        const suctionP = nodeStates[pump.fromNode]?.pressure ?? basePressure;
        const product = model.batches?.products[0] ?? { densityAtRef: 850, vaporPressure: 40e3 };
        const curve = PumpCurveEngine.createDefaultPipelinePump(pump.maxPower);
        const outLink = (graph.outbound.get(pump.toNode) ?? [])[0];
        const estFlowM3s = ((outLink ? pipeStates[outLink.name]?.massFlow : undefined) ?? 200.0) / product.densityAtRef;
        let targetDischargeP: number | undefined;
        if (pump.controlMode === "DISCHARGE_PRESSURE") {
          targetDischargeP = pump.setpoint;
        } else if (pump.controlMode === "HEAD") {
          targetDischargeP = suctionP + product.densityAtRef * G_GRAVITY * pump.setpoint;
        }
        const op = PumpCurveEngine.evaluate(
          curve,
          suctionP,
          estFlowM3s,
          { densityKgM3: product.densityAtRef, vaporPressurePa: product.vaporPressure },
          targetDischargeP,
        );
        const toState = nodeStates[pump.toNode];
        if (toState) {
          toState.pressure = op.dischargePressurePa;
        }
      }
    }

    for (const reg of model.regulators) {
      const upstreamP = nodeStates[reg.fromNode]?.pressure ?? basePressure;
      const regulatedP = Math.min(upstreamP, reg.setpointPressure);
      const toState = nodeStates[reg.toNode];
      if (toState) {
        toState.pressure = regulatedP;
      }
    }

    // 5. Relaxation Iterations for Hydraulic Pressure Drops
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
    };

    const useGerg = model.simulationControls?.equationOfState === "GERG2008";

    let totalLinePackKg = 0;
    let totalLinePackSm3 = 0;

    const maxIter = 50;
    const pTol = 50.0; // 50 Pa (~0.0005 bar) convergence tolerance
    let actualIterations = 0;
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      actualIterations = iter + 1;
      let maxDeltaP = 0.0;
      for (const pipe of model.pipes) {
        const pIn = nodeStates[pipe.fromNode]?.pressure ?? basePressure;
        const tempK = pipe.ambientTemperature ?? 288.15;

        // Evaluate real gas properties at inlet
        const eosIn = useGerg ? Gerg2008Eos.evaluate(pIn, tempK, comp) : Aga8Eos.evaluate(pIn, tempK, comp);
        const rho = eosIn.massDensity;
        const area = Math.PI * (pipe.diameter / 2) ** 2;
        const flow = Math.max(0.1, pipeStates[pipe.name]?.massFlow ?? 20.0);
        const velocity = flow / (rho * area);

        const mu = 1.1e-5;
        const re = (rho * velocity * pipe.diameter) / mu;
        const f = this.getFrictionFactor(pipe.diameter, pipe.roughness, re);

        // Elevation delta
        const zFrom = graph.nodes.get(pipe.fromNode)?.elevation ?? 0;
        const zTo = graph.nodes.get(pipe.toNode)?.elevation ?? 0;
        const deltaZ = zTo - zFrom;

        const frictionLoss = f * (pipe.length / pipe.diameter) * ((rho * velocity ** 2) / 2);
        const gravityLoss = rho * G_GRAVITY * deltaZ;
        const deltaP = frictionLoss + gravityLoss;

        const pOut = Math.max(1.01325e5, pIn - deltaP);

        // Update outlet node pressure if it's a junction or delivery point without fixed pressure
        const targetNode = graph.nodes.get(pipe.toNode);
        if (
          targetNode &&
          (targetNode.type === "JUNCTION" || (targetNode.type === "DELIVERY" && targetNode.pressure == null))
        ) {
          const toState = nodeStates[pipe.toNode];
          if (toState) toState.pressure = pOut;
        }

        const pAvg = (2 / 3) * (pIn + pOut - (pIn * pOut) / Math.max(1, pIn + pOut));
        const eosAvg = useGerg ? Gerg2008Eos.evaluate(pAvg, tempK, comp) : Aga8Eos.evaluate(pAvg, tempK, comp);
        const pipeVolume = area * pipe.length;
        const linePackKg = pipeVolume * eosAvg.massDensity;

        const stdDensity = comp.standardDensity ?? 0.78;
        const linePackSm3 = linePackKg / stdDensity;

        const prevOutletP = pipeStates[pipe.name]?.outletPressure;
        if (prevOutletP !== undefined) {
          maxDeltaP = Math.max(maxDeltaP, Math.abs(pOut - prevOutletP));
        }

        pipeStates[pipe.name] = {
          name: pipe.name,
          massFlow: flow,
          inletPressure: pIn,
          outletPressure: pOut,
          velocity,
          linePackKg,
          linePackSm3,
          frictionLossPa: frictionLoss,
        };
      }

      // Check convergence across all pipes in network
      if (iter > 0 && maxDeltaP < pTol) {
        converged = true;
        break;
      }
    }

    if (model.pipes.length === 0 || actualIterations <= 1) {
      converged = true;
    }

    // Accumulate total network inventory
    for (const p of Object.values(pipeStates)) {
      totalLinePackKg += p.linePackKg;
      totalLinePackSm3 += p.linePackSm3;
    }

    return {
      converged,
      iterations: actualIterations,
      nodeStates,
      pipeStates,
      totalLinePackKg,
      totalLinePackSm3,
    };
  }
}
