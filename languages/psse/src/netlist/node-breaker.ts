// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BusRecord, PsseCase, SubstationRecord } from "../types.js";

export interface NodeBreakerReductionResult {
  reducedCase: PsseCase;
  /** Maps `"subId:nodeId"` to the resolved electrical bus number `i`. */
  nodeToBus: Map<string, number>;
  /** Maps secondary merged/absorbed bus numbers to their canonical super-bus number. */
  absorbedBuses: Map<number, number>;
  /** Synthesized split bus numbers created when open breakers split a substation busbar. */
  splitBuses: number[];
}

class DisjointSet {
  private readonly parent = new Map<number, number>();

  add(x: number): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: number): number {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
  }
}

/**
 * Reduces PSS/E v34/v35 Node-Breaker substation topologies into an equivalent bus-branch `PsseCase`
 * suitable for AC/DC power flow and fault analysis:
 *
 * - Closed switching devices (`status === 1`) contract connected substation nodes into shared electrical super-buses.
 * - Open switching devices (`status === 0`) separate nodes into distinct connected components; if a substation's
 *   nominal bus is partitioned by an open bus-tie breaker, split buses are allocated and equipment terminals
 *   are rebound onto each islanded super-bus.
 */
export function reduceNodeBreakerToBuses(c: PsseCase): NodeBreakerReductionResult {
  const subs = c.substations;
  if (!subs || subs.length === 0) {
    return {
      reducedCase: c,
      nodeToBus: new Map(),
      absorbedBuses: new Map(),
      splitBuses: [],
    };
  }

  const buses = new Map<number, BusRecord>();
  for (const [k, v] of c.buses) buses.set(k, { ...v });

  let maxBusId = 0;
  for (const id of buses.keys()) {
    if (id > maxBusId) maxBusId = id;
  }

  const nodeToBus = new Map<string, number>();
  const absorbedBuses = new Map<number, number>();
  const splitBuses: number[] = [];

  // Map (substationId, componentRoot) -> canonical bus ID and record node -> bus
  const subComponentToBus = new Map<string, number>();

  for (const sub of subs) {
    resolveSubstationComponents(sub, buses, () => ++maxBusId, nodeToBus, absorbedBuses, splitBuses, subComponentToBus);
  }

  const mapBus = (b: number): number => absorbedBuses.get(b) ?? b;

  // Clone equipment lists and remap terminal/bus references
  const loads = c.loads.map((l) => ({ ...l, i: mapBus(l.i) }));
  const fixedShunts = c.fixedShunts.map((s) => ({ ...s, i: mapBus(s.i) }));
  const generators = c.generators.map((g) => ({ ...g, i: mapBus(g.i), ireg: g.ireg > 0 ? mapBus(g.ireg) : 0 }));
  const branches = c.branches.map((br) => ({ ...br, i: mapBus(br.i), j: mapBus(br.j) }));
  const transformers = c.transformers.map((t) => ({
    ...t,
    i: mapBus(t.i),
    j: mapBus(t.j),
    k: t.k > 0 ? mapBus(t.k) : 0,
  }));
  const switchedShunts = c.switchedShunts.map((sw) => ({
    ...sw,
    i: mapBus(sw.i),
    swrem: sw.swrem > 0 ? mapBus(sw.swrem) : 0,
  }));

  // Apply explicit substation terminal attachments (moves equipment bound to split nodes onto their split bus)
  for (const sub of subs) {
    for (const term of sub.terminals) {
      const targetBus = nodeToBus.get(`${sub.is}:${term.ni}`);
      if (targetBus === undefined) continue;
      const cid = term.id.trim();
      switch (term.eqType) {
        case "GEN": {
          const g = generators.find((x) => (x.i === term.i || x.i === mapBus(term.i)) && (!cid || x.id.trim() === cid));
          if (g) g.i = targetBus;
          break;
        }
        case "LOAD": {
          const l = loads.find((x) => (x.i === term.i || x.i === mapBus(term.i)) && (!cid || x.id.trim() === cid));
          if (l) l.i = targetBus;
          break;
        }
        case "SHUNT": {
          const s = fixedShunts.find(
            (x) => (x.i === term.i || x.i === mapBus(term.i)) && (!cid || x.id.trim() === cid),
          );
          if (s) s.i = targetBus;
          break;
        }
        case "SWSHUNT": {
          const sw = switchedShunts.find((x) => x.i === term.i || x.i === mapBus(term.i));
          if (sw) sw.i = targetBus;
          break;
        }
        case "BRANCH": {
          const br = branches.find(
            (x) =>
              ((x.i === term.i || x.i === mapBus(term.i)) &&
                (term.j === undefined || x.j === term.j || x.j === mapBus(term.j))) ||
              ((x.j === term.i || x.j === mapBus(term.i)) &&
                (term.j === undefined || x.i === term.j || x.i === mapBus(term.j))),
          );
          if (br) {
            if (br.i === term.i || br.i === mapBus(term.i)) br.i = targetBus;
            else br.j = targetBus;
          }
          break;
        }
        case "XFMR": {
          const tf = transformers.find(
            (x) =>
              (!cid || x.ckt.trim() === cid) &&
              (x.i === term.i || x.i === mapBus(term.i) || x.j === term.i || x.j === mapBus(term.i)),
          );
          if (tf) {
            if (tf.i === term.i || tf.i === mapBus(term.i)) tf.i = targetBus;
            else if (tf.j === term.i || tf.j === mapBus(term.i)) tf.j = targetBus;
            else if (tf.k === term.i || tf.k === mapBus(term.i)) tf.k = targetBus;
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // Promote secondary buses that still hold split equipment/branches vs absorbed buses
  for (const secondary of absorbedBuses.keys()) {
    buses.delete(secondary);
  }

  // Disconnect isolated split buses that have no active branches or transformers (de-energized behind open breakers)
  const energizedBuses = new Set<number>();
  for (const br of branches) {
    if (br.st === 1 && br.i !== br.j) {
      energizedBuses.add(br.i);
      energizedBuses.add(br.j);
    }
  }
  for (const tf of transformers) {
    if (tf.stat !== 0) {
      energizedBuses.add(tf.i);
      energizedBuses.add(tf.j);
      if (tf.k > 0) energizedBuses.add(tf.k);
    }
  }
  for (const gen of generators) {
    if (gen.stat === 1) energizedBuses.add(gen.i);
  }
  for (const sb of splitBuses) {
    const bus = buses.get(sb);
    if (bus && !energizedBuses.has(sb)) {
      bus.ide = 4;
    }
  }

  const reducedCase: PsseCase = {
    ...c,
    buses,
    loads,
    fixedShunts,
    generators,
    branches,
    transformers,
    switchedShunts,
  };

  return {
    reducedCase,
    nodeToBus,
    absorbedBuses,
    splitBuses,
  };
}

function resolveSubstationComponents(
  sub: SubstationRecord,
  buses: Map<number, BusRecord>,
  allocBusId: () => number,
  nodeToBus: Map<string, number>,
  absorbedBuses: Map<number, number>,
  splitBuses: number[],
  subComponentToBus: Map<string, number>,
): void {
  const dsu = new DisjointSet();
  const activeNodes = new Set<number>();
  for (const n of sub.nodes) {
    if (n.status !== 0) {
      dsu.add(n.ni);
      activeNodes.add(n.ni);
    }
  }
  for (const sw of sub.switches) {
    dsu.add(sw.ni);
    dsu.add(sw.nj);
    if (sw.status === 1 && (activeNodes.size === 0 || (activeNodes.has(sw.ni) && activeNodes.has(sw.nj)))) {
      dsu.union(sw.ni, sw.nj);
    }
  }

  // Group nodes by connected component root
  const components = new Map<number, number[]>();
  for (const n of sub.nodes) {
    const r = dsu.find(n.ni);
    let arr = components.get(r);
    if (!arr) {
      arr = [];
      components.set(r, arr);
    }
    arr.push(n.ni);
  }
  for (const sw of sub.switches) {
    for (const end of [sw.ni, sw.nj]) {
      const r = dsu.find(end);
      if (!components.has(r)) components.set(r, [end]);
    }
  }

  const claimedPrimaryBuses = new Set<number>();
  const nodeMap = new Map(sub.nodes.map((n) => [n.ni, n]));

  // Sort roots deterministically
  const roots = Array.from(components.keys()).sort((a, b) => a - b);
  for (const root of roots) {
    const members = components.get(root)!;
    const candidateBuses: number[] = [];
    for (const ni of members) {
      const n = nodeMap.get(ni);
      if (n && n.ibus > 0 && !candidateBuses.includes(n.ibus)) {
        candidateBuses.push(n.ibus);
      }
    }
    candidateBuses.sort((a, b) => a - b);

    // Choose super-bus: prefer an unclaimed positive ibus in the component
    let superBus: number | undefined = candidateBuses.find((b) => !claimedPrimaryBuses.has(b));
    if (superBus !== undefined) {
      claimedPrimaryBuses.add(superBus);
      // Absorb any additional buses merged by closed coupler breakers in this component
      for (const otherBus of candidateBuses) {
        if (otherBus !== superBus && !claimedPrimaryBuses.has(otherBus)) {
          absorbedBuses.set(otherBus, superBus);
          const primaryRec = buses.get(superBus);
          const otherRec = buses.get(otherBus);
          if (primaryRec && otherRec && otherRec.ide > primaryRec.ide && otherRec.ide <= 3) {
            // Preserve highest-priority bus type (3 Swing > 2 PV > 1 PQ)
            primaryRec.ide = otherRec.ide;
          }
        }
      }
      if (!buses.has(superBus)) {
        buses.set(superBus, {
          i: superBus,
          name: `${sub.name}_N${root}`.slice(0, 12),
          baseKv: 138,
          ide: 1,
          area: 1,
          zone: 1,
          owner: 1,
          vm: 1.0,
          va: 0.0,
        });
      }
    } else {
      // Split busbar component (all candidate ibus already claimed by another component due to open breaker)
      const templateId = candidateBuses[0];
      const templateBus = templateId !== undefined ? buses.get(templateId) : undefined;
      superBus = allocBusId();
      splitBuses.push(superBus);
      buses.set(superBus, {
        i: superBus,
        name: `${templateBus?.name ?? sub.name}_S${root}`.slice(0, 12),
        baseKv: templateBus?.baseKv ?? 138,
        ide: 1,
        area: templateBus?.area ?? 1,
        zone: templateBus?.zone ?? 1,
        owner: templateBus?.owner ?? 1,
        vm: templateBus?.vm ?? 1.0,
        va: templateBus?.va ?? 0.0,
      });
    }

    subComponentToBus.set(`${sub.is}:${root}`, superBus);
    for (const ni of members) {
      nodeToBus.set(`${sub.is}:${ni}`, superBus);
    }
  }
}
