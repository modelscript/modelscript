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
   * Solves a dense linear system A * x = b in-place using Gaussian elimination with partial pivoting.
   */
  private static solveLinearSystem(A: Float64Array, b: Float64Array, n: number): Float64Array {
    const x = new Float64Array(n);
    if (n === 0) return x;

    const M = new Float64Array(A);
    const rhs = new Float64Array(b);

    for (let k = 0; k < n; k++) {
      // Partial pivoting
      let maxRow = k;
      let maxVal = Math.abs(M[k * n + k] ?? 0);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(M[i * n + k] ?? 0);
        if (v > maxVal) {
          maxVal = v;
          maxRow = i;
        }
      }

      if (maxRow !== k) {
        for (let j = k; j < n; j++) {
          const idxK = k * n + j;
          const idxMax = maxRow * n + j;
          const tmp = M[idxK] ?? 0;
          M[idxK] = M[idxMax] ?? 0;
          M[idxMax] = tmp;
        }
        const tmpB = rhs[k] ?? 0;
        rhs[k] = rhs[maxRow] ?? 0;
        rhs[maxRow] = tmpB;
      }

      let pivot = M[k * n + k] ?? 0;
      if (Math.abs(pivot) < 1e-15) {
        pivot = pivot >= 0 ? 1e-15 : -1e-15;
        M[k * n + k] = pivot;
      }

      for (let i = k + 1; i < n; i++) {
        const factor = (M[i * n + k] ?? 0) / pivot;
        if (factor === 0) continue;
        for (let j = k; j < n; j++) {
          const idxI = i * n + j;
          M[idxI] = (M[idxI] ?? 0) - factor * (M[k * n + j] ?? 0);
        }
        rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      let sum = rhs[i] ?? 0;
      for (let j = i + 1; j < n; j++) {
        sum -= (M[i * n + j] ?? 0) * (x[j] ?? 0);
      }
      const diag = M[i * n + i] ?? 0;
      x[i] = sum / (Math.abs(diag) >= 1e-15 ? diag : 1e-15);
    }

    return x;
  }

  /**
   * Solves steady-state pressures, mass flow rates, velocities, and line pack across the network
   * using a simultaneous Todini-Pilati / Nodal Newton-Raphson hydraulic solver (J * deltaP = -r).
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

    // 2. Establish Total Supply and Delivery Nodal Demands
    // Convention for nodal external injection Q_ext[node]:
    //   +flowRate for SUPPLY nodes (inflow into network)
    //   -flowRate for DELIVERY nodes (outflow from network)
    const extFlow: Record<string, number> = {};
    for (const node of model.nodes) {
      extFlow[node.name] = 0.0;
    }

    let totalSupplyFlow = supplies.reduce((s, n) => s + Math.abs(n.flowRate ?? 0), 0);
    const deliveries = graph.getDeliveries();
    let totalDeliveryFlow = deliveries.reduce((s, n) => s + Math.abs(n.flowRate ?? 0), 0);

    if (totalSupplyFlow === 0 && totalDeliveryFlow > 0 && firstSupply) {
      totalSupplyFlow = totalDeliveryFlow;
      const supplyState = nodeStates[firstSupply.name];
      if (supplyState) supplyState.netFlow = totalSupplyFlow;
    } else if (totalDeliveryFlow === 0 && totalSupplyFlow > 0 && deliveries.length > 0) {
      totalDeliveryFlow = totalSupplyFlow;
      const perDelivery = totalSupplyFlow / deliveries.length;
      for (const d of deliveries) {
        const dState = nodeStates[d.name];
        if (dState) dState.netFlow = -perDelivery;
      }
    }

    for (const s of supplies) {
      const q = Math.abs(s.flowRate ?? nodeStates[s.name]?.netFlow ?? 0);
      extFlow[s.name] = (extFlow[s.name] ?? 0) + q;
    }
    for (const d of deliveries) {
      const q = Math.abs(d.flowRate ?? nodeStates[d.name]?.netFlow ?? 0);
      extFlow[d.name] = (extFlow[d.name] ?? 0) - q;
    }
    for (const n of model.nodes) {
      if (n.type !== "SUPPLY" && n.type !== "DELIVERY" && n.flowRate != null && n.flowRate !== 0) {
        extFlow[n.name] = n.flowRate;
      }
    }

    // Identify fixed-pressure (Dirichlet) nodes
    const fixedPressureNodes = new Set<string>();
    for (const node of model.nodes) {
      if ((node.type === "SUPPLY" || node.type === "DELIVERY") && node.pressure != null) {
        fixedPressureNodes.add(node.name);
      }
    }
    if (fixedPressureNodes.size === 0 && firstSupply) {
      fixedPressureNodes.add(firstSupply.name);
    }

    // 3. Initialize Pipe States with Conductance-Weighted Estimate
    for (const pipe of model.pipes) {
      const estFlow = totalSupplyFlow > 0 ? totalSupplyFlow : totalDeliveryFlow > 0 ? totalDeliveryFlow : 50.0;
      pipeStates[pipe.name] = {
        name: pipe.name,
        massFlow: estFlow,
        inletPressure: nodeStates[pipe.fromNode]?.pressure ?? basePressure,
        outletPressure: nodeStates[pipe.toNode]?.pressure ?? basePressure * 0.95,
        velocity: 5.0,
        linePackKg: 0,
        linePackSm3: 0,
        frictionLossPa: 0,
      };
    }

    // Helper: compute total downstream delivery withdrawal reachable from a node via pipes
    const computeDownstreamDemand = (startNode: string): number => {
      const visited = new Set<string>();
      const queue: string[] = [startNode];
      let demandSum = 0.0;
      while (queue.length > 0) {
        const curr = queue.shift();
        if (!curr) break;
        if (visited.has(curr)) continue;
        visited.add(curr);
        const qExt = extFlow[curr] ?? 0.0;
        if (qExt < 0) demandSum += -qExt;
        for (const p of model.pipes) {
          if (p.fromNode === curr && !visited.has(p.toNode)) {
            queue.push(p.toNode);
          } else if (p.toNode === curr && !visited.has(p.fromNode)) {
            queue.push(p.fromNode);
          }
        }
      }
      return demandSum > 0 ? demandSum : totalSupplyFlow > 0 ? totalSupplyFlow : 40.0;
    };

    // 4. Equipment Modeling (Compressors, Pumps, Regulators) & Coupling Across Station Boundaries
    const evaluateEquipment = (): void => {
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

          const thruFlow = computeDownstreamDemand(comp.toNode);
          const map = CompressorMapEngine.createDefaultPipelineMap(comp.maxPower, comp.maxSpeed ?? 9500);
          const op = CompressorMapEngine.evaluate(map, suctionP, suctionT, targetDischargeP, thruFlow, {
            molarMass: 0.0175,
            zFactor: 0.88,
            isentropicExponent: 1.3,
          });

          const toState = nodeStates[comp.toNode];
          if (toState) {
            toState.pressure = op.dischargePressurePa;
            toState.temperature = op.dischargeTempK;
          }
          fixedPressureNodes.add(comp.toNode);
          // Mass conservation across compressor station: suction node supplies the station throughput
          if (!fixedPressureNodes.has(comp.fromNode)) {
            extFlow[comp.fromNode] = -thruFlow;
          }
        }
      }

      for (const pump of model.pumps) {
        if (pump.status === "RUNNING") {
          const suctionP = nodeStates[pump.fromNode]?.pressure ?? basePressure;
          const product = model.batches?.products[0] ?? { densityAtRef: 850, vaporPressure: 40e3 };
          const curve = PumpCurveEngine.createDefaultPipelinePump(pump.maxPower);
          const thruFlow = computeDownstreamDemand(pump.toNode);
          const estFlowM3s = thruFlow / product.densityAtRef;
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
          fixedPressureNodes.add(pump.toNode);
          if (!fixedPressureNodes.has(pump.fromNode)) {
            extFlow[pump.fromNode] = -thruFlow;
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
        fixedPressureNodes.add(reg.toNode);
        const thruFlow = computeDownstreamDemand(reg.toNode);
        if (!fixedPressureNodes.has(reg.fromNode)) {
          extFlow[reg.fromNode] = -thruFlow;
        }
      }
    };

    evaluateEquipment();

    // 5. Simultaneous Nodal-Loop Newton-Raphson Solver (Todini-Pilati / Nodal Formulation: J * dP = -r)
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

    // Build list of free (unknown-pressure) nodes
    const freeNodeNames: string[] = [];
    const freeNodeIdx = new Map<string, number>();
    for (const node of model.nodes) {
      if (!fixedPressureNodes.has(node.name)) {
        freeNodeIdx.set(node.name, freeNodeNames.length);
        freeNodeNames.push(node.name);
      }
    }
    const nFree = freeNodeNames.length;

    // Seed initial nodal pressure gradient along graph distance from fixed-pressure sources
    // so initial pressure differences across all pipes are non-zero before Newton-Raphson starts
    if (nFree > 0 && model.pipes.length > 0) {
      const dist = new Map<string, number>();
      const refP = new Map<string, number>();
      const queue: string[] = [];
      for (const fn of fixedPressureNodes) {
        dist.set(fn, 0);
        refP.set(fn, nodeStates[fn]?.pressure ?? basePressure);
        queue.push(fn);
      }
      while (queue.length > 0) {
        const u = queue.shift();
        if (!u) break;
        const dU = dist.get(u) ?? 0;
        const pU = refP.get(u) ?? basePressure;
        for (const p of model.pipes) {
          const v = p.fromNode === u ? p.toNode : p.toNode === u ? p.fromNode : undefined;
          if (v && !dist.has(v)) {
            dist.set(v, dU + 1);
            refP.set(v, Math.max(2e5, pU - (dU + 1) * 0.5e5));
            queue.push(v);
          }
        }
      }
      for (const fn of freeNodeNames) {
        const ns = nodeStates[fn];
        const rP = refP.get(fn);
        if (ns && rP !== undefined) {
          ns.pressure = rP;
        }
      }
    }

    const maxIter = 60;
    const pTol = 1.0; // 1.0 Pa nodal pressure convergence tolerance
    const flowTol = 1e-5; // 1e-5 kg/s Kirchhoff nodal mass balance residual tolerance
    let actualIterations = 0;
    let converged = false;

    const minPressurePa = 1.01325e5;
    const mu = 1.1e-5;

    for (let iter = 0; iter < maxIter; iter++) {
      actualIterations = iter + 1;

      // Update compressor/pump/regulator boundary conditions if suction pressure changed
      evaluateEquipment();

      // Residual vector r (length nFree): r_i = sum(m_in) - sum(m_out) + Q_ext_i
      const r = new Float64Array(nFree);
      for (let idx = 0; idx < nFree; idx++) {
        const name = freeNodeNames[idx];
        r[idx] = (name ? extFlow[name] : 0.0) ?? 0.0;
      }

      // Jacobian matrix J = dr/dP (nFree x nFree)
      const J = new Float64Array(nFree * nFree);

      for (const pipe of model.pipes) {
        const pFrom = nodeStates[pipe.fromNode]?.pressure ?? basePressure;
        const pTo = nodeStates[pipe.toNode]?.pressure ?? basePressure;
        const tempK = pipe.ambientTemperature ?? 288.15;

        const pRef = Math.max(minPressurePa, 0.5 * (pFrom + pTo));
        const eos = useGerg ? Gerg2008Eos.evaluate(pRef, tempK, comp) : Aga8Eos.evaluate(pRef, tempK, comp);
        const rho = Math.max(0.5, eos.massDensity);
        const area = Math.PI * (pipe.diameter / 2) ** 2;

        const prevFlow = Math.max(0.05, Math.abs(pipeStates[pipe.name]?.massFlow ?? 20.0));
        const velocityEst = prevFlow / (rho * area);
        const re = (rho * velocityEst * pipe.diameter) / mu;
        const f = this.getFrictionFactor(pipe.diameter, pipe.roughness, re);

        const zFrom = graph.nodes.get(pipe.fromNode)?.elevation ?? 0;
        const zTo = graph.nodes.get(pipe.toNode)?.elevation ?? 0;
        const deltaZ = zTo - zFrom;
        const gravityLoss = rho * G_GRAVITY * deltaZ;

        // Darcy-Weisbach hydraulic resistance coefficient R_e such that:
        //   deltaH = (P_from - P_to) - gravityLoss = R_e * m * |m|
        const resistance = Math.max(
          1e-12,
          (f * Math.max(1.0, pipe.length)) / (2.0 * rho * Math.max(1e-3, pipe.diameter) * area * area),
        );

        const deltaH = pFrom - pTo - gravityLoss;
        const absDeltaH = Math.abs(deltaH);
        const regDeltaH = Math.max(1e-2, absDeltaH);

        // Signed mass flow from pipe.fromNode -> pipe.toNode
        const sign = deltaH >= 0 ? 1.0 : -1.0;
        const massFlow =
          absDeltaH >= 1e-2 ? sign * Math.sqrt(absDeltaH / resistance) : deltaH / Math.sqrt(resistance * 1e-2);

        // Hydraulic conductance g_e = dm / d(P_from - P_to)
        const conductance = 0.5 / Math.sqrt(resistance * regDeltaH);

        const iFrom = freeNodeIdx.get(pipe.fromNode);
        const iTo = freeNodeIdx.get(pipe.toNode);

        if (iFrom !== undefined) {
          r[iFrom] = (r[iFrom] ?? 0) - massFlow;
          const idxFF = iFrom * nFree + iFrom;
          J[idxFF] = (J[idxFF] ?? 0) - conductance;
          if (iTo !== undefined) {
            const idxFT = iFrom * nFree + iTo;
            J[idxFT] = (J[idxFT] ?? 0) + conductance;
          }
        }
        if (iTo !== undefined) {
          r[iTo] = (r[iTo] ?? 0) + massFlow;
          const idxTT = iTo * nFree + iTo;
          J[idxTT] = (J[idxTT] ?? 0) - conductance;
          if (iFrom !== undefined) {
            const idxTF = iTo * nFree + iFrom;
            J[idxTF] = (J[idxTF] ?? 0) + conductance;
          }
        }

        // Update pipe state
        const absFlow = Math.abs(massFlow);
        const velocity = absFlow / (rho * area);
        const frictionLoss = resistance * absFlow * absFlow;
        const pIn = Math.max(minPressurePa, pFrom);
        const pOut = Math.max(minPressurePa, pTo);
        const pAvg = (2 / 3) * (pIn + pOut - (pIn * pOut) / Math.max(1, pIn + pOut));
        const eosAvg = useGerg ? Gerg2008Eos.evaluate(pAvg, tempK, comp) : Aga8Eos.evaluate(pAvg, tempK, comp);
        const pipeVolume = area * pipe.length;
        const linePackKg = pipeVolume * eosAvg.massDensity;
        const stdDensity = comp.standardDensity ?? 0.78;
        const linePackSm3 = linePackKg / stdDensity;

        pipeStates[pipe.name] = {
          name: pipe.name,
          massFlow,
          inletPressure: pIn,
          outletPressure: pOut,
          velocity,
          linePackKg,
          linePackSm3,
          frictionLossPa: frictionLoss,
        };
      }

      if (nFree === 0) {
        converged = true;
        break;
      }

      // Regularize any isolated free nodes with zero diagonal
      for (let i = 0; i < nFree; i++) {
        const idxII = i * nFree + i;
        if (Math.abs(J[idxII] ?? 0) < 1e-12) {
          J[idxII] = -1.0;
          r[i] = 0.0;
        }
      }

      let maxResidual = 0.0;
      for (let i = 0; i < nFree; i++) {
        maxResidual = Math.max(maxResidual, Math.abs(r[i] ?? 0));
      }

      // Solve J * deltaP = -r
      const negR = new Float64Array(nFree);
      for (let i = 0; i < nFree; i++) {
        negR[i] = -(r[i] ?? 0);
      }
      const deltaP = this.solveLinearSystem(J, negR, nFree);

      let maxDeltaP = 0.0;
      for (let i = 0; i < nFree; i++) {
        maxDeltaP = Math.max(maxDeltaP, Math.abs(deltaP[i] ?? 0));
      }

      // Damped Newton step to prevent pressure overshoot beyond physical bounds
      let stepScale = 1.0;
      if (maxDeltaP > 15e5) {
        stepScale = 15e5 / maxDeltaP;
      }

      for (let i = 0; i < nFree; i++) {
        const name = freeNodeNames[i];
        if (!name) continue;
        const ns = nodeStates[name];
        if (ns) {
          ns.pressure = Math.max(minPressurePa, ns.pressure + stepScale * (deltaP[i] ?? 0));
        }
      }

      if (iter > 0 && maxDeltaP < pTol && maxResidual < flowTol) {
        converged = true;
        break;
      }
    }

    if (model.pipes.length === 0 || actualIterations <= 1) {
      converged = true;
    }

    // Final evaluation pass to ensure pipeStates and nodeStates are in exact sync with converged pressures
    let totalLinePackKg = 0;
    let totalLinePackSm3 = 0;

    for (const node of model.nodes) {
      const ns = nodeStates[node.name];
      if (ns) ns.netFlow = 0.0;
    }

    for (const pipe of model.pipes) {
      const pIn = Math.max(minPressurePa, nodeStates[pipe.fromNode]?.pressure ?? basePressure);
      const pOut = Math.max(minPressurePa, nodeStates[pipe.toNode]?.pressure ?? basePressure);
      const tempK = pipe.ambientTemperature ?? 288.15;
      const pRef = 0.5 * (pIn + pOut);
      const eos = useGerg ? Gerg2008Eos.evaluate(pRef, tempK, comp) : Aga8Eos.evaluate(pRef, tempK, comp);
      const rho = Math.max(0.5, eos.massDensity);
      const area = Math.PI * (pipe.diameter / 2) ** 2;

      const prevFlow = Math.max(0.05, Math.abs(pipeStates[pipe.name]?.massFlow ?? 20.0));
      const velocityEst = prevFlow / (rho * area);
      const re = (rho * velocityEst * pipe.diameter) / mu;
      const f = this.getFrictionFactor(pipe.diameter, pipe.roughness, re);

      const zFrom = graph.nodes.get(pipe.fromNode)?.elevation ?? 0;
      const zTo = graph.nodes.get(pipe.toNode)?.elevation ?? 0;
      const deltaZ = zTo - zFrom;
      const gravityLoss = rho * G_GRAVITY * deltaZ;

      const resistance = Math.max(
        1e-12,
        (f * Math.max(1.0, pipe.length)) / (2.0 * rho * Math.max(1e-3, pipe.diameter) * area * area),
      );
      const deltaH = pIn - pOut - gravityLoss;
      const absDeltaH = Math.abs(deltaH);
      const sign = deltaH >= 0 ? 1.0 : -1.0;
      const massFlow =
        absDeltaH >= 1e-2 ? sign * Math.sqrt(absDeltaH / resistance) : deltaH / Math.sqrt(resistance * 1e-2);

      const absFlow = Math.abs(massFlow);
      const velocity = absFlow / (rho * area);
      const frictionLoss = resistance * absFlow * absFlow;

      const pAvg = (2 / 3) * (pIn + pOut - (pIn * pOut) / Math.max(1, pIn + pOut));
      const eosAvg = useGerg ? Gerg2008Eos.evaluate(pAvg, tempK, comp) : Aga8Eos.evaluate(pAvg, tempK, comp);
      const pipeVolume = area * pipe.length;
      const linePackKg = pipeVolume * eosAvg.massDensity;
      const stdDensity = comp.standardDensity ?? 0.78;
      const linePackSm3 = linePackKg / stdDensity;

      pipeStates[pipe.name] = {
        name: pipe.name,
        massFlow,
        inletPressure: pIn,
        outletPressure: pOut,
        velocity,
        linePackKg,
        linePackSm3,
        frictionLossPa: frictionLoss,
      };

      const fromNs = nodeStates[pipe.fromNode];
      const toNs = nodeStates[pipe.toNode];
      if (fromNs) fromNs.netFlow += massFlow;
      if (toNs) toNs.netFlow -= massFlow;

      totalLinePackKg += linePackKg;
      totalLinePackSm3 += linePackSm3;
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
