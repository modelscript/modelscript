// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck } from "../types.js";

export interface BusPowerFlowResult {
  busName: string;
  voltageKv: number;
  voltagePu: number;
  angleDeg: number;
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

/**
 * Multi-bus forward-backward sweep distribution power flow solver for OpenDSS.
 */
export function solveDistributionPowerFlow(deck: DssDeck, maxIters = 20, tol = 1e-4): PowerFlowSummary {
  const buses = new Map<string, BusPowerFlowResult>();

  // 1. Identify all buses
  const baseBus = deck.circuit?.bus1 ?? "SourceBus";
  const baseKv = deck.circuit?.baseKv ?? 115.0;
  const basePu = deck.circuit?.pu ?? 1.0;

  buses.set(baseBus, {
    busName: baseBus,
    voltageKv: baseKv,
    voltagePu: basePu,
    angleDeg: deck.circuit?.angle ?? 0.0,
    kwLoad: 0,
    kvarLoad: 0,
    kwGen: 0,
  });

  // Collect loads and generation per bus
  let totalLoadKw = 0;
  let totalLoadKvar = 0;
  let totalGenKw = 0;

  for (const [, l] of deck.loads) {
    totalLoadKw += l.kw;
    totalLoadKvar += l.kvar;
    const b = buses.get(l.bus1) ?? {
      busName: l.bus1,
      voltageKv: l.kv,
      voltagePu: 1.0,
      angleDeg: 0,
      kwLoad: 0,
      kvarLoad: 0,
      kwGen: 0,
    };
    b.kwLoad += l.kw;
    b.kvarLoad += l.kvar;
    buses.set(l.bus1, b);
  }

  for (const [, pv] of deck.pvSystems) {
    totalGenKw += pv.pmpp;
    const b = buses.get(pv.bus1) ?? {
      busName: pv.bus1,
      voltageKv: pv.kv,
      voltagePu: 1.0,
      angleDeg: 0,
      kwLoad: 0,
      kvarLoad: 0,
      kwGen: 0,
    };
    b.kwGen += pv.pmpp;
    buses.set(pv.bus1, b);
  }

  for (const [, line] of deck.lines) {
    if (!buses.has(line.bus1)) {
      buses.set(line.bus1, {
        busName: line.bus1,
        voltageKv: 12.47,
        voltagePu: 1.0,
        angleDeg: 0,
        kwLoad: 0,
        kvarLoad: 0,
        kwGen: 0,
      });
    }
    if (!buses.has(line.bus2)) {
      buses.set(line.bus2, {
        busName: line.bus2,
        voltageKv: 12.47,
        voltagePu: 1.0,
        angleDeg: 0,
        kwLoad: 0,
        kvarLoad: 0,
        kwGen: 0,
      });
    }
  }

  for (const [, xfmr] of deck.transformers) {
    for (let w = 0; w < xfmr.buses.length; w++) {
      const bName = xfmr.buses[w]!;
      const kv = xfmr.kvs[w] ?? 12.47;
      if (!buses.has(bName)) {
        buses.set(bName, {
          busName: bName,
          voltageKv: kv,
          voltagePu: 1.0,
          angleDeg: 0,
          kwLoad: 0,
          kvarLoad: 0,
          kwGen: 0,
        });
      }
    }
  }

  // Build topological graph from baseBus
  interface DirectedBranch {
    fromBus: string;
    toBus: string;
    kind: "transformer" | "line";
    xfmr?: any;
    line?: any;
    rTotal: number;
    xTotal: number;
  }

  const adj = new Map<string, { to: string; kind: "transformer" | "line"; ref: any }[]>();
  for (const bName of buses.keys()) {
    adj.set(bName, []);
  }

  for (const [, xfmr] of deck.transformers) {
    if (xfmr.buses.length >= 2) {
      const b1 = xfmr.buses[0]!;
      const b2 = xfmr.buses[1]!;
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
    const parent = queue.shift()!;
    for (const edge of adj.get(parent) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);

        let rTotal = 0.1;
        let xTotal = 0.4;
        if (edge.kind === "line") {
          const l = edge.ref;
          const lc = l.lineCode ? deck.lineCodes.get(l.lineCode) : undefined;
          const r1 = l.r1 ?? lc?.r1 ?? 0.1;
          const x1 = l.x1 ?? lc?.x1 ?? 0.4;
          rTotal = r1 * l.length;
          xTotal = x1 * l.length;
        }

        treeBranches.push({
          fromBus: parent,
          toBus: edge.to,
          kind: edge.kind,
          xfmr: edge.kind === "transformer" ? edge.ref : undefined,
          line: edge.kind === "line" ? edge.ref : undefined,
          rTotal,
          xTotal,
        });
      }
    }
  }

  // Iterative Forward-Backward sweep voltage calculation
  let converged = false;
  let iterations = 0;
  let lossesKw = 0;

  for (let iter = 1; iter <= maxIters; iter++) {
    iterations = iter;
    let maxDeltaV = 0.0;
    lossesKw = 0.0;

    // 1. Backward Sweep: Aggregate downstream active and reactive branch flows
    const branchFlows = new Map<DirectedBranch, { pKw: number; qKvar: number }>();
    for (let i = treeBranches.length - 1; i >= 0; i--) {
      const branch = treeBranches[i]!;
      const childBus = buses.get(branch.toBus);
      let pKw = childBus ? childBus.kwLoad - childBus.kwGen : 0;
      let qKvar = childBus ? childBus.kvarLoad : 0;

      // Add downstream children of childBus
      for (const otherBranch of treeBranches) {
        if (otherBranch.fromBus === branch.toBus) {
          const downstreamFlow = branchFlows.get(otherBranch);
          if (downstreamFlow) {
            pKw += downstreamFlow.pKw;
            qKvar += downstreamFlow.qKvar;
          }
        }
      }
      branchFlows.set(branch, { pKw, qKvar });
    }

    // 2. Forward Sweep: Propagate voltages from root to leaves along topological branches
    for (const branch of treeBranches) {
      const bFrom = buses.get(branch.fromBus);
      const bTo = buses.get(branch.toBus);
      if (!bFrom || !bTo) continue;

      const flow = branchFlows.get(branch) ?? { pKw: 0, qKvar: 0 };

      if (branch.kind === "transformer" && branch.xfmr) {
        const xfmr = branch.xfmr;
        const priPu = bFrom.voltagePu;
        const sLoad = Math.sqrt(flow.pKw * flow.pKw + flow.qKvar * flow.qKvar);
        const kvaRating = xfmr.kvas[1] ?? 10000;
        const xhl = (xfmr.xhl ?? 5.0) / 100;
        const zDrop = (sLoad / kvaRating) * xhl;

        const targetPu = Math.max(0.8, priPu - zDrop);
        const delta = Math.abs(bTo.voltagePu - targetPu);
        if (delta > maxDeltaV) maxDeltaV = delta;
        bTo.voltagePu = targetPu;
        bTo.voltageKv = targetPu * (xfmr.kvs[1] ?? 12.47);
        lossesKw += (sLoad / kvaRating) * ((xfmr.pctLoadLoss ?? 0.5) / 100) * kvaRating;
      } else if (branch.kind === "line" && branch.line) {
        const pFlowW = flow.pKw * 1e3;
        const qFlowVar = flow.qKvar * 1e3;
        const vNom = (bFrom.voltageKv * 1e3) / Math.sqrt(3);

        const deltaV = (pFlowW * branch.rTotal + qFlowVar * branch.xTotal) / Math.max(100, vNom * bFrom.voltagePu);
        const deltaPu = deltaV / vNom;

        const targetPu = Math.max(0.7, bFrom.voltagePu - deltaPu);
        const diff = Math.abs(bTo.voltagePu - targetPu);
        if (diff > maxDeltaV) maxDeltaV = diff;
        bTo.voltagePu = targetPu;
        bTo.voltageKv = targetPu * bFrom.voltageKv;

        const iBranch = Math.sqrt(pFlowW * pFlowW + qFlowVar * qFlowVar) / Math.max(100, Math.sqrt(3) * vNom);
        lossesKw += (3 * iBranch * iBranch * branch.rTotal) / 1e3;
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
