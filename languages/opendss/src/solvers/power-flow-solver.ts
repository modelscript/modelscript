// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck, DssLine, DssTransformer } from "../types.js";

export interface BusPowerFlowResult {
  busName: string;
  voltageKv: number;
  voltagePu: number;
  angleDeg: number;
  vMagPu: number;
  vAngleDeg: number;
  vMagPuA: number;
  vMagPuB: number;
  vMagPuC: number;
  voltageUnbalanceFactor: number;
  kwLoad: number;
  kvarLoad: number;
  kwGen: number;
}

export interface PowerFlowSummary {
  converged: boolean;
  iterations: number;
  totalLoadKw: number;
  totalLoadKvar: number;
  totalGenKw: number;
  lossesKw: number;
  buses: Map<string, BusPowerFlowResult>;
}

export interface QstsStepResult {
  stepIndex: number;
  timeHours: number;
  multiplier: number;
  summary: PowerFlowSummary;
}

export interface QstsSimulationResult {
  loadShapeName: string;
  steps: QstsStepResult[];
  timeHours: number[];
  multipliers: number[];
  totalLoadKwSeries: number[];
  lossesKwSeries: number[];
  minVoltagePuSeries: number[];
  maxVoltagePuSeries: number[];
  peakLossesKw: number;
  minVoltagePu: number;
  maxVoltagePu: number;
  maxUnbalanceFactor: number;
}

interface BusPhaseLoad {
  pLoadKw: [number, number, number];
  qLoadKvar: [number, number, number];
  pGenKw: [number, number, number];
  qCapKvar: [number, number, number];
}

function createEmptyBusPhaseLoad(): BusPhaseLoad {
  return {
    pLoadKw: [0, 0, 0],
    qLoadKvar: [0, 0, 0],
    pGenKw: [0, 0, 0],
    qCapKvar: [0, 0, 0],
  };
}

function createBusResult(busName: string, voltageKv: number, voltagePu = 1.0, angleDeg = 0.0): BusPowerFlowResult {
  return {
    busName,
    voltageKv,
    voltagePu,
    angleDeg,
    vMagPu: voltagePu,
    vAngleDeg: angleDeg,
    vMagPuA: voltagePu,
    vMagPuB: voltagePu,
    vMagPuC: voltagePu,
    voltageUnbalanceFactor: 0,
    kwLoad: 0,
    kvarLoad: 0,
    kwGen: 0,
  };
}

function computeVuf(vA: number, vB: number, vC: number): number {
  const avg = (vA + vB + vC) / 3;
  if (avg <= 1e-9) return 0;
  const maxDev = Math.max(Math.abs(vA - avg), Math.abs(vB - avg), Math.abs(vC - avg));
  return maxDev / avg;
}

/**
 * Multi-bus 3-phase unbalanced forward-backward sweep distribution power flow solver for OpenDSS.
 */
export function solveDistributionPowerFlow(deck: DssDeck, maxIters = 20, tol = 1e-4): PowerFlowSummary {
  const buses = new Map<string, BusPowerFlowResult>();
  const busPhaseInjections = new Map<string, BusPhaseLoad>();

  // 1. Identify all buses
  const baseBus = deck.circuit?.bus1 ?? "SourceBus";
  const baseKv = deck.circuit?.baseKv ?? 115.0;
  const basePu = deck.circuit?.pu ?? 1.0;
  const baseAngle = deck.circuit?.angle ?? 0.0;

  buses.set(baseBus, createBusResult(baseBus, baseKv, basePu, baseAngle));
  busPhaseInjections.set(baseBus, createEmptyBusPhaseLoad());

  const ensureBus = (name: string, kv: number): BusPowerFlowResult => {
    let b = buses.get(name);
    if (!b) {
      b = createBusResult(name, kv, 1.0, 0.0);
      buses.set(name, b);
    }
    if (!busPhaseInjections.has(name)) {
      busPhaseInjections.set(name, createEmptyBusPhaseLoad());
    }
    return b;
  };

  // Collect loads, PV generation, and capacitors per bus and per phase
  let totalLoadKw = 0;
  let totalLoadKvar = 0;
  let totalGenKw = 0;

  for (const [, l] of deck.loads) {
    totalLoadKw += l.kw;
    totalLoadKvar += l.kvar;
    const b = ensureBus(l.bus1, l.kv);
    b.kwLoad += l.kw;
    b.kvarLoad += l.kvar;

    const inj = busPhaseInjections.get(l.bus1);
    if (inj) {
      const nodes = l.phaseNodes && l.phaseNodes.length > 0 ? l.phaseNodes : l.phases === 1 ? [1] : [1, 2, 3];
      const nPh = nodes.length;
      for (const ph of nodes) {
        const idx = Math.max(0, Math.min(2, ph - 1)) as 0 | 1 | 2;
        inj.pLoadKw[idx] += l.kw / nPh;
        inj.qLoadKvar[idx] += l.kvar / nPh;
      }
    }
  }

  for (const [, pv] of deck.pvSystems) {
    totalGenKw += pv.pmpp;
    const b = ensureBus(pv.bus1, pv.kv);
    b.kwGen += pv.pmpp;

    const inj = busPhaseInjections.get(pv.bus1);
    if (inj) {
      const nodes = pv.phaseNodes && pv.phaseNodes.length > 0 ? pv.phaseNodes : pv.phases === 1 ? [1] : [1, 2, 3];
      const nPh = nodes.length;
      for (const ph of nodes) {
        const idx = Math.max(0, Math.min(2, ph - 1)) as 0 | 1 | 2;
        inj.pGenKw[idx] += pv.pmpp / nPh;
      }
    }
  }

  for (const [, cap] of deck.capacitors) {
    ensureBus(cap.bus1, cap.kv);
    const inj = busPhaseInjections.get(cap.bus1);
    if (inj) {
      const nodes = cap.phaseNodes && cap.phaseNodes.length > 0 ? cap.phaseNodes : cap.phases === 1 ? [1] : [1, 2, 3];
      const nPh = nodes.length;
      for (const ph of nodes) {
        const idx = Math.max(0, Math.min(2, ph - 1)) as 0 | 1 | 2;
        inj.qCapKvar[idx] += cap.kvar / nPh;
      }
    }
  }

  for (const [, line] of deck.lines) {
    ensureBus(line.bus1, 12.47);
    ensureBus(line.bus2, 12.47);
  }

  for (const [, xfmr] of deck.transformers) {
    for (let w = 0; w < xfmr.buses.length; w++) {
      const bName = xfmr.buses[w];
      if (!bName) continue;
      const kv = xfmr.kvs[w] ?? 12.47;
      const existing = buses.get(bName);
      if (!existing) {
        ensureBus(bName, kv);
      } else if (w > 0) {
        existing.voltageKv = kv;
      }
    }
  }

  // Build topological graph from baseBus
  interface DirectedBranch {
    fromBus: string;
    toBus: string;
    kind: "transformer" | "line";
    xfmr?: DssTransformer | undefined;
    line?: DssLine | undefined;
    rTotal: number;
    xTotal: number;
    r0Total: number;
    x0Total: number;
  }

  type AdjEdge = { to: string; kind: "transformer"; ref: DssTransformer } | { to: string; kind: "line"; ref: DssLine };

  const adj = new Map<string, AdjEdge[]>();
  for (const bName of buses.keys()) {
    adj.set(bName, []);
  }

  for (const [, xfmr] of deck.transformers) {
    const b1 = xfmr.buses[0];
    const b2 = xfmr.buses[1];
    if (b1 && b2) {
      adj.get(b1)?.push({ to: b2, kind: "transformer", ref: xfmr });
      adj.get(b2)?.push({ to: b1, kind: "transformer", ref: xfmr });
    }
  }

  for (const [, line] of deck.lines) {
    adj.get(line.bus1)?.push({ to: line.bus2, kind: "line", ref: line });
    adj.get(line.bus2)?.push({ to: line.bus1, kind: "line", ref: line });
  }

  // BFS to determine parent-to-child directed tree
  const visited = new Set<string>();
  const treeBranches: DirectedBranch[] = [];
  const queue: string[] = [baseBus];
  visited.add(baseBus);

  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) break;
    for (const edge of adj.get(parent) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);

        let rTotal = 0.1;
        let xTotal = 0.4;
        let r0Total = 0.3;
        let x0Total = 1.2;
        if (edge.kind === "line") {
          const l = edge.ref;
          const lc = l.lineCode ? deck.lineCodes.get(l.lineCode) : undefined;
          const r1 = l.r1 ?? lc?.r1 ?? 0.1;
          const x1 = l.x1 ?? lc?.x1 ?? 0.4;
          const r0 = l.r0 ?? lc?.r0 ?? r1 * 2.5;
          const x0 = l.x0 ?? lc?.x0 ?? x1 * 2.5;
          rTotal = r1 * l.length;
          xTotal = x1 * l.length;
          r0Total = r0 * l.length;
          x0Total = x0 * l.length;
        }

        treeBranches.push({
          fromBus: parent,
          toBus: edge.to,
          kind: edge.kind,
          xfmr: edge.kind === "transformer" ? edge.ref : undefined,
          line: edge.kind === "line" ? edge.ref : undefined,
          rTotal,
          xTotal,
          r0Total,
          x0Total,
        });
      }
    }
  }

  // Iterative 3-phase Forward-Backward sweep voltage calculation
  let converged = false;
  let iterations = 0;
  let lossesKw = 0;

  interface PhaseBranchFlow {
    pKw: [number, number, number];
    qKvar: [number, number, number];
    pTotalKw: number;
    qTotalKvar: number;
  }

  for (let iter = 1; iter <= maxIters; iter++) {
    iterations = iter;
    let maxDeltaV = 0.0;
    lossesKw = 0.0;

    // 1. Backward Sweep: Aggregate downstream active and reactive branch flows per phase
    const branchFlows = new Map<DirectedBranch, PhaseBranchFlow>();
    for (let i = treeBranches.length - 1; i >= 0; i--) {
      const branch = treeBranches[i];
      if (!branch) continue;
      const inj = busPhaseInjections.get(branch.toBus) ?? createEmptyBusPhaseLoad();
      const childBus = buses.get(branch.toBus);
      const vChildAvg = childBus ? childBus.voltagePu : 1.0;

      const pKw: [number, number, number] = [
        inj.pLoadKw[0] - inj.pGenKw[0],
        inj.pLoadKw[1] - inj.pGenKw[1],
        inj.pLoadKw[2] - inj.pGenKw[2],
      ];
      const qKvar: [number, number, number] = [
        inj.qLoadKvar[0] - inj.qCapKvar[0] * vChildAvg * vChildAvg,
        inj.qLoadKvar[1] - inj.qCapKvar[1] * vChildAvg * vChildAvg,
        inj.qLoadKvar[2] - inj.qCapKvar[2] * vChildAvg * vChildAvg,
      ];

      // Add downstream children of childBus
      for (const otherBranch of treeBranches) {
        if (otherBranch.fromBus === branch.toBus) {
          const downstreamFlow = branchFlows.get(otherBranch);
          if (downstreamFlow) {
            pKw[0] += downstreamFlow.pKw[0];
            pKw[1] += downstreamFlow.pKw[1];
            pKw[2] += downstreamFlow.pKw[2];
            qKvar[0] += downstreamFlow.qKvar[0];
            qKvar[1] += downstreamFlow.qKvar[1];
            qKvar[2] += downstreamFlow.qKvar[2];
          }
        }
      }
      branchFlows.set(branch, {
        pKw,
        qKvar,
        pTotalKw: pKw[0] + pKw[1] + pKw[2],
        qTotalKvar: qKvar[0] + qKvar[1] + qKvar[2],
      });
    }

    // 2. Forward Sweep: Propagate 3-phase voltages from root to leaves along topological branches
    for (const branch of treeBranches) {
      const bFrom = buses.get(branch.fromBus);
      const bTo = buses.get(branch.toBus);
      if (!bFrom || !bTo) continue;

      const flow = branchFlows.get(branch) ?? {
        pKw: [0, 0, 0] as [number, number, number],
        qKvar: [0, 0, 0] as [number, number, number],
        pTotalKw: 0,
        qTotalKvar: 0,
      };

      if (branch.kind === "transformer" && branch.xfmr) {
        const xfmr = branch.xfmr;
        const kvaRating = xfmr.kvas[1] ?? 10000;
        const kvaPerPhase = kvaRating / 3;
        const xhl = (xfmr.xhl ?? 5.0) / 100;
        const rhl = (xfmr.pctLoadLoss ?? 0.5) / 100;

        const vFromPhases: [number, number, number] = [bFrom.vMagPuA, bFrom.vMagPuB, bFrom.vMagPuC];
        const vToPhases: [number, number, number] = [1.0, 1.0, 1.0];

        for (let p = 0; p < 3; p++) {
          const idx = p as 0 | 1 | 2;
          const pPh = flow.pKw[idx];
          const qPh = flow.qKvar[idx];
          const sPh = Math.sqrt(pPh * pPh + qPh * qPh);
          const zDrop = (sPh / Math.max(1e-3, kvaPerPhase)) * Math.sqrt(rhl * rhl + xhl * xhl);
          vToPhases[idx] = Math.max(0.8, vFromPhases[idx] - zDrop);
        }

        const targetPu = (vToPhases[0] + vToPhases[1] + vToPhases[2]) / 3;
        const delta = Math.max(
          Math.abs(bTo.vMagPuA - vToPhases[0]),
          Math.abs(bTo.vMagPuB - vToPhases[1]),
          Math.abs(bTo.vMagPuC - vToPhases[2]),
        );
        if (delta > maxDeltaV) maxDeltaV = delta;

        bTo.vMagPuA = vToPhases[0];
        bTo.vMagPuB = vToPhases[1];
        bTo.vMagPuC = vToPhases[2];
        bTo.voltagePu = targetPu;
        bTo.vMagPu = targetPu;
        bTo.voltageKv = targetPu * (xfmr.kvs[1] ?? 12.47);
        bTo.vAngleDeg = bFrom.vAngleDeg - ((flow.pTotalKw / Math.max(1, kvaRating)) * xhl * 180) / Math.PI;
        bTo.angleDeg = bTo.vAngleDeg;
        bTo.voltageUnbalanceFactor = computeVuf(vToPhases[0], vToPhases[1], vToPhases[2]);

        const sLoadTotal = Math.sqrt(flow.pTotalKw * flow.pTotalKw + flow.qTotalKvar * flow.qTotalKvar);
        lossesKw += (sLoadTotal / kvaRating) * rhl * kvaRating;
      } else if (branch.kind === "line" && branch.line) {
        const vNom = (bFrom.voltageKv * 1e3) / Math.sqrt(3);
        const vFromPhases: [number, number, number] = [bFrom.vMagPuA, bFrom.vMagPuB, bFrom.vMagPuC];
        const vToPhases: [number, number, number] = [1.0, 1.0, 1.0];

        // Carson / symmetrical sequence self and mutual impedances
        const rSelf = (branch.r0Total + 2 * branch.rTotal) / 3;
        const xSelf = (branch.x0Total + 2 * branch.xTotal) / 3;
        const rMut = (branch.r0Total - branch.rTotal) / 3;
        const xMut = (branch.x0Total - branch.xTotal) / 3;

        // Check if load is balanced across all 3 phases
        const isBalanced =
          Math.abs(flow.pKw[0] - flow.pKw[1]) < 1e-6 &&
          Math.abs(flow.pKw[1] - flow.pKw[2]) < 1e-6 &&
          Math.abs(flow.qKvar[0] - flow.qKvar[1]) < 1e-6 &&
          Math.abs(flow.qKvar[1] - flow.qKvar[2]) < 1e-6 &&
          Math.abs(vFromPhases[0] - vFromPhases[1]) < 1e-6 &&
          Math.abs(vFromPhases[1] - vFromPhases[2]) < 1e-6;

        let lineLossW = 0;
        for (let p = 0; p < 3; p++) {
          const idx = p as 0 | 1 | 2;
          const pPhaseW = flow.pKw[idx] * 1e3;
          const qPhaseVar = flow.qKvar[idx] * 1e3;
          const vPh = Math.max(100, vNom * vFromPhases[idx]);

          // Equivalent phase impedance drop (for balanced 3-phase, Z_self - Z_mut = Z_1 so 3*P_ph*R_1/V_ph = P_total*R_1/V_nom)
          const rEff = isBalanced ? branch.rTotal : rSelf;
          const xEff = isBalanced ? branch.xTotal : xSelf;
          let deltaV = (3 * (pPhaseW * rEff + qPhaseVar * xEff)) / vPh;

          if (!isBalanced) {
            // Include mutual coupling from the other two phases (120 deg displaced -> -0.5 real factor)
            const other1 = ((p + 1) % 3) as 0 | 1 | 2;
            const other2 = ((p + 2) % 3) as 0 | 1 | 2;
            const pOtherW = (flow.pKw[other1] + flow.pKw[other2]) * 1e3;
            const qOtherVar = (flow.qKvar[other1] + flow.qKvar[other2]) * 1e3;
            deltaV -= (1.5 * (pOtherW * rMut + qOtherVar * xMut)) / vPh;
          }

          const deltaPu = deltaV / vNom;
          vToPhases[idx] = Math.max(0.7, vFromPhases[idx] - deltaPu);

          const iPh = Math.sqrt(pPhaseW * pPhaseW + qPhaseVar * qPhaseVar) / vPh;
          lineLossW += iPh * iPh * branch.rTotal;
        }

        const targetPu = (vToPhases[0] + vToPhases[1] + vToPhases[2]) / 3;
        const diff = Math.max(
          Math.abs(bTo.vMagPuA - vToPhases[0]),
          Math.abs(bTo.vMagPuB - vToPhases[1]),
          Math.abs(bTo.vMagPuC - vToPhases[2]),
        );
        if (diff > maxDeltaV) maxDeltaV = diff;

        bTo.vMagPuA = vToPhases[0];
        bTo.vMagPuB = vToPhases[1];
        bTo.vMagPuC = vToPhases[2];
        bTo.voltagePu = targetPu;
        bTo.vMagPu = targetPu;
        bTo.voltageKv = targetPu * bFrom.voltageKv;
        bTo.vAngleDeg =
          bFrom.vAngleDeg - (((flow.pTotalKw * 1e3 * branch.xTotal) / Math.max(100, 3 * vNom * vNom)) * 180) / Math.PI;
        bTo.angleDeg = bTo.vAngleDeg;
        bTo.voltageUnbalanceFactor = computeVuf(vToPhases[0], vToPhases[1], vToPhases[2]);

        lossesKw += lineLossW / 1e3;
      }
    }

    if (maxDeltaV < tol) {
      converged = true;
      break;
    }
  }

  return {
    converged,
    iterations,
    totalLoadKw,
    totalLoadKvar,
    totalGenKw,
    lossesKw,
    buses,
  };
}

/**
 * Alias for `solveDistributionPowerFlow`.
 */
export const solveOpenDssPowerFlow = solveDistributionPowerFlow;

/**
 * Quasi-Static Time-Series (QSTS) solver for OpenDSS decks containing `LoadShape` profiles.
 * Evaluates multi-step distribution power flow across the load shape time series.
 */
export function solveOpenDssQsts(deck: DssDeck, loadShapeName?: string): QstsSimulationResult {
  const shapes = deck.loadShapes ?? new Map();
  let selectedShape = loadShapeName ? shapes.get(loadShapeName) : undefined;
  if (!selectedShape) {
    const first = shapes.values().next().value;
    selectedShape = first ?? {
      name: loadShapeName ?? "Default",
      npts: 1,
      interval: 1.0,
      mult: [1.0],
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    };
  }

  const mults = selectedShape.mult.length > 0 ? selectedShape.mult : [1.0];
  const qmults = selectedShape.qmult;
  const interval = selectedShape.interval > 0 ? selectedShape.interval : 1.0;

  const steps: QstsStepResult[] = [];
  const timeHours: number[] = [];
  const multipliers: number[] = [];
  const totalLoadKwSeries: number[] = [];
  const lossesKwSeries: number[] = [];
  const minVoltagePuSeries: number[] = [];
  const maxVoltagePuSeries: number[] = [];

  let peakLossesKw = 0;
  let minVoltagePu = Infinity;
  let maxVoltagePu = -Infinity;
  let maxUnbalanceFactor = 0;

  for (let idx = 0; idx < mults.length; idx++) {
    const m = mults[idx] ?? 1.0;
    const qm = qmults?.[idx] ?? m;
    const tHr = idx * interval;

    // Clone loads and PV systems scaled by active LoadShape multiplier
    const scaledLoads = new Map(deck.loads);
    for (const [name, load] of deck.loads) {
      const shapeKey = load.daily ?? load.duty ?? load.yearly;
      const loadShape = shapeKey ? shapes.get(shapeKey) : selectedShape;
      const pScale = loadShape ? (loadShape.mult[idx % loadShape.mult.length] ?? m) : m;
      const qScale = loadShape && loadShape.qmult ? (loadShape.qmult[idx % loadShape.qmult.length] ?? pScale) : qm;
      scaledLoads.set(name, {
        ...load,
        kw: load.kw * pScale,
        kvar: load.kvar * qScale,
      });
    }

    const scaledPvs = new Map(deck.pvSystems);
    for (const [name, pv] of deck.pvSystems) {
      const shapeKey = pv.daily ?? pv.duty ?? pv.yearly;
      const pvShape = shapeKey ? shapes.get(shapeKey) : undefined;
      if (pvShape) {
        const pvScale = pvShape.mult[idx % pvShape.mult.length] ?? 1.0;
        scaledPvs.set(name, {
          ...pv,
          pmpp: pv.pmpp * pvScale,
        });
      }
    }

    const stepDeck: DssDeck = {
      ...deck,
      loads: scaledLoads,
      pvSystems: scaledPvs,
    };

    const summary = solveDistributionPowerFlow(stepDeck);
    let stepMinV = Infinity;
    let stepMaxV = -Infinity;
    for (const [, bus] of summary.buses) {
      const vMinBus = Math.min(bus.vMagPuA, bus.vMagPuB, bus.vMagPuC);
      const vMaxBus = Math.max(bus.vMagPuA, bus.vMagPuB, bus.vMagPuC);
      if (vMinBus < stepMinV) stepMinV = vMinBus;
      if (vMaxBus > stepMaxV) stepMaxV = vMaxBus;
      if (bus.voltageUnbalanceFactor > maxUnbalanceFactor) {
        maxUnbalanceFactor = bus.voltageUnbalanceFactor;
      }
    }
    if (!isFinite(stepMinV)) stepMinV = 1.0;
    if (!isFinite(stepMaxV)) stepMaxV = 1.0;

    if (summary.lossesKw > peakLossesKw) peakLossesKw = summary.lossesKw;
    if (stepMinV < minVoltagePu) minVoltagePu = stepMinV;
    if (stepMaxV > maxVoltagePu) maxVoltagePu = stepMaxV;

    steps.push({
      stepIndex: idx,
      timeHours: tHr,
      multiplier: m,
      summary,
    });
    timeHours.push(tHr);
    multipliers.push(m);
    totalLoadKwSeries.push(summary.totalLoadKw);
    lossesKwSeries.push(summary.lossesKw);
    minVoltagePuSeries.push(stepMinV);
    maxVoltagePuSeries.push(stepMaxV);
  }

  return {
    loadShapeName: selectedShape.name,
    steps,
    timeHours,
    multipliers,
    totalLoadKwSeries,
    lossesKwSeries,
    minVoltagePuSeries,
    maxVoltagePuSeries,
    peakLossesKw,
    minVoltagePu: isFinite(minVoltagePu) ? minVoltagePu : 1.0,
    maxVoltagePu: isFinite(maxVoltagePu) ? maxVoltagePu : 1.0,
    maxUnbalanceFactor,
  };
}
