// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT PowerFactory Node-Breaker to Bus-Branch Topology Processor.
 *
 * Implements Union-Find disjoint-set algorithms to resolve breaker and switch states,
 * merge contracted substation connectivity nodes, and map ElmTerm terminals to
 * canonical positive-sequence bus numbers.
 */

import type { ElmLne, ElmTr2, PowerFactoryModel } from "../types.js";

/** Disjoint-Set Forest with path compression and rank heuristics. */
export class DisjointSet {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  public makeSet(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  public find(id: string): string {
    if (!this.parent.has(id)) {
      this.makeSet(id);
      return id;
    }
    const p = this.parent.get(id)!;
    if (p !== id) {
      const root = this.find(p);
      this.parent.set(id, root);
      return root;
    }
    return id;
  }

  public union(id1: string, id2: string): void {
    const root1 = this.find(id1);
    const root2 = this.find(id2);
    if (root1 === root2) return;

    const rank1 = this.rank.get(root1) ?? 0;
    const rank2 = this.rank.get(root2) ?? 0;

    if (rank1 < rank2) {
      this.parent.set(root1, root2);
    } else if (rank1 > rank2) {
      this.parent.set(root2, root1);
    } else {
      this.parent.set(root2, root1);
      this.rank.set(root1, rank1 + 1);
    }
  }
}

export interface TopologicalBus {
  busNumber: number;
  name: string;
  baseKv: number;
  substation?: string | undefined;
  terminalIds: string[];
}

export interface MappedLine {
  line: ElmLne;
  fromBus: number;
  toBus: number;
  r1Ohm: number;
  x1Ohm: number;
  b1USiemens: number;
  r0Ohm?: number | undefined;
  x0Ohm?: number | undefined;
  b0USiemens?: number | undefined;
  rateMva?: number | undefined;
}

export interface MappedTransformer {
  trafo: ElmTr2;
  hvBus: number;
  lvBus: number;
  ratedMva: number;
  rPu: number;
  xPu: number;
  ratioPu: number;
  angleDeg: number;
}

export interface PowerFactoryTopologyResult {
  buses: Map<number, TopologicalBus>;
  termToBus: Map<string, number>;
  mappedLines: MappedLine[];
  mappedTransformers: MappedTransformer[];
  sbaseMva: number;
  fnomHz: number;
}

/**
 * Resolves the node-breaker switching state of a PowerFactoryModel into a
 * canonical bus-branch topological network.
 */
export function processPowerFactoryTopology(model: PowerFactoryModel, sbaseMva = 100.0): PowerFactoryTopologyResult {
  const ds = new DisjointSet();

  // 1. Initialize sets for all terminals
  for (const [termId] of model.terminals) {
    ds.makeSet(termId);
  }

  // 2. Union terminals connected by closed switches/breakers
  for (const [, sw] of model.switches) {
    if (sw.on_off !== 0) {
      // Switch is closed
      if (sw.bus1Id && sw.bus2Id) {
        ds.makeSet(sw.bus1Id);
        ds.makeSet(sw.bus2Id);
        ds.union(sw.bus1Id, sw.bus2Id);
      }
    }
  }

  // 3. Group terminals by root representative
  const rootToTerms = new Map<string, string[]>();
  for (const [termId] of model.terminals) {
    const root = ds.find(termId);
    let list = rootToTerms.get(root);
    if (!list) {
      list = [];
      rootToTerms.set(root, list);
    }
    list.push(termId);
  }

  // 4. Assign sequential bus numbers
  const buses = new Map<number, TopologicalBus>();
  const termToBus = new Map<string, number>();
  let busCounter = 1;
  let fnomHz = 50.0;

  for (const [, termIds] of rootToTerms) {
    const busNum = busCounter++;
    const firstTermId = termIds[0]!;
    const firstTerm = model.terminals.get(firstTermId);

    const baseKv = firstTerm?.uknom ?? 110.0;
    if (firstTerm?.fnom) fnomHz = firstTerm.fnom;

    for (const tid of termIds) {
      termToBus.set(tid, busNum);
    }

    buses.set(busNum, {
      busNumber: busNum,
      name: firstTerm?.loc_name ?? `BUS_${busNum}`,
      baseKv,
      substation: firstTerm?.substatId,
      terminalIds: [...termIds],
    });
  }

  // 5. Map transmission lines
  const mappedLines: MappedLine[] = [];
  for (const [, line] of model.lines) {
    if (line.outserv) continue;
    const b1 = termToBus.get(line.bus1Id);
    const b2 = termToBus.get(line.bus2Id);
    if (b1 === undefined || b2 === undefined || b1 === b2) {
      // Terminal unmapped or self-loop/closed bypass
      continue;
    }

    const type = line.typId ? model.lineTypes.get(line.typId) : undefined;
    const d = line.dline > 0 ? line.dline : 1.0;

    const r1 = line.r1 ?? (type ? type.r1 * d : 0.1);
    const x1 = line.x1 ?? (type ? type.x1 * d : 0.4);
    const b1Val = line.b1 ?? (type ? type.b1 * d : 3.0);
    const r0 = line.r0 ?? (type?.r0 ? type.r0 * d : undefined);
    const x0 = line.x0 ?? (type?.x0 ? type.x0 * d : undefined);
    const b0 = line.b0 ?? (type?.b0 ? type.b0 * d : undefined);

    let rateMva: number | undefined;
    if (type?.snom) {
      rateMva = type.snom;
    } else if (line.inom || type?.inom) {
      const inomKa = line.inom ?? type?.inom ?? 1.0;
      const vKv = buses.get(b1)?.baseKv ?? 110.0;
      rateMva = Math.sqrt(3) * vKv * inomKa;
    }

    mappedLines.push({
      line,
      fromBus: b1,
      toBus: b2,
      r1Ohm: r1,
      x1Ohm: x1,
      b1USiemens: b1Val,
      r0Ohm: r0,
      x0Ohm: x0,
      b0USiemens: b0,
      rateMva,
    });
  }

  // 6. Map two-winding transformers
  const mappedTransformers: MappedTransformer[] = [];
  for (const [, tr] of model.transformers2w) {
    if (tr.outserv) continue;
    const bhv = termToBus.get(tr.bushvId);
    const blv = termToBus.get(tr.buslvId);
    if (bhv === undefined || blv === undefined || bhv === blv) continue;

    const type = tr.typId ? model.trafo2Types.get(tr.typId) : undefined;
    const snom = tr.strn ?? type?.strn ?? 40.0;
    const ukrr = type?.ukrr ?? 10.0; // short-circuit impedance %
    const pkr = type?.pkr ?? 150.0; // copper losses in kW

    // Convert ukrr and pkr to per-unit on system sbase
    // z_pu_trafo = ukrr / 100 on trafo base snom
    const zBaseTrafo = (ukrr / 100.0) * (sbaseMva / snom);
    // r_pu_trafo = (pkr kW / (snom MVA * 1000)) * (sbaseMva / snom)
    const rBaseTrafo = (pkr / (snom * 1000.0)) * (sbaseMva / snom);
    const xBaseTrafo = Math.sqrt(Math.max(1e-6, zBaseTrafo * zBaseTrafo - rBaseTrafo * rBaseTrafo));

    // Tap ratio calculation
    let tapRatio = 1.0;
    if (tr.nntap && tr.dutap) {
      tapRatio += (tr.nntap * tr.dutap) / 100.0;
    }

    mappedTransformers.push({
      trafo: tr,
      hvBus: bhv,
      lvBus: blv,
      ratedMva: snom,
      rPu: rBaseTrafo,
      xPu: xBaseTrafo,
      ratioPu: tapRatio,
      angleDeg: getVectorGroupPhaseShift(type?.vecgrp),
    });
  }

  return {
    buses,
    termToBus,
    mappedLines,
    mappedTransformers,
    sbaseMva,
    fnomHz,
  };
}

/** Determines phase shift angle in degrees from vector group (e.g. Dyn11 = 30 deg). */
function getVectorGroupPhaseShift(vecgrp: string | undefined): number {
  if (!vecgrp) return 0;
  const numMatch = /[0-9]+/.exec(vecgrp);
  if (numMatch) {
    const clockHour = parseInt(numMatch[0], 10);
    // Each clock hour is -30 degrees (e.g. 11 = +30 deg or -330 deg)
    return (clockHour * -30) % 360;
  }
  return 0;
}
