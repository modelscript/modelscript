// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Topological Graph Engine for Pipeline Networks.
 *
 * Constructs a directed multi-graph representation of nodes and links (pipes,
 * compressors, pumps, regulators, valves) for connectivity analysis, path
 * tracing, loop identification, and spatial aggregation.
 */

import type {
  CompressorStation,
  InlineValve,
  LpsModel,
  LpsNode,
  LpsPipe,
  PumpStation,
  RegulatorValve,
} from "../types.js";

export type LinkKind = "PIPE" | "COMPRESSOR" | "PUMP" | "REGULATOR" | "VALVE";

export interface NetworkLink {
  id: string;
  name: string;
  kind: LinkKind;
  fromNode: string;
  toNode: string;
  length: number; // meters (0 for inline equipment)
  diameter: number; // meters
  maop: number; // Pa
  reference: LpsPipe | CompressorStation | PumpStation | RegulatorValve | InlineValve;
}

export class PipelineGraph {
  readonly nodes = new Map<string, LpsNode>();
  readonly links: NetworkLink[] = [];
  readonly outbound = new Map<string, NetworkLink[]>();
  readonly inbound = new Map<string, NetworkLink[]>();

  constructor(public readonly model: LpsModel) {
    this.buildGraph();
  }

  private buildGraph(): void {
    // 1. Index Nodes
    for (const node of this.model.nodes) {
      this.nodes.set(node.name, node);
      this.outbound.set(node.name, []);
      this.inbound.set(node.name, []);
    }

    // 2. Index Pipes
    for (const p of this.model.pipes) {
      this.addLink({
        id: `pipe_${p.name}`,
        name: p.name,
        kind: "PIPE",
        fromNode: p.fromNode,
        toNode: p.toNode,
        length: p.length,
        diameter: p.diameter,
        maop: p.maop,
        reference: p,
      });
    }

    // 3. Index Compressors
    for (const c of this.model.compressors) {
      this.addLink({
        id: `comp_${c.name}`,
        name: c.name,
        kind: "COMPRESSOR",
        fromNode: c.fromNode,
        toNode: c.toNode,
        length: 0,
        diameter: 0.5,
        maop: 150e5,
        reference: c,
      });
    }

    // 4. Index Pumps
    for (const pu of this.model.pumps) {
      this.addLink({
        id: `pump_${pu.name}`,
        name: pu.name,
        kind: "PUMP",
        fromNode: pu.fromNode,
        toNode: pu.toNode,
        length: 0,
        diameter: 0.5,
        maop: 100e5,
        reference: pu,
      });
    }

    // 5. Index Regulators
    for (const r of this.model.regulators) {
      this.addLink({
        id: `reg_${r.name}`,
        name: r.name,
        kind: "REGULATOR",
        fromNode: r.fromNode,
        toNode: r.toNode,
        length: 0,
        diameter: 0.5,
        maop: 100e5,
        reference: r,
      });
    }

    // 6. Index Valves
    for (const v of this.model.valves) {
      this.addLink({
        id: `valve_${v.name}`,
        name: v.name,
        kind: "VALVE",
        fromNode: v.fromNode,
        toNode: v.toNode,
        length: 0,
        diameter: 0.5,
        maop: 100e5,
        reference: v,
      });
    }
  }

  private addLink(link: NetworkLink): void {
    this.links.push(link);

    // If node doesn't exist yet in the map, create default placeholder
    if (!this.nodes.has(link.fromNode) && link.fromNode) {
      this.nodes.set(link.fromNode, { name: link.fromNode, type: "JUNCTION", elevation: 0 });
      this.outbound.set(link.fromNode, []);
      this.inbound.set(link.fromNode, []);
    }
    if (!this.nodes.has(link.toNode) && link.toNode) {
      this.nodes.set(link.toNode, { name: link.toNode, type: "JUNCTION", elevation: 0 });
      this.outbound.set(link.toNode, []);
      this.inbound.set(link.toNode, []);
    }

    if (link.fromNode) {
      const outList = this.outbound.get(link.fromNode) ?? [];
      outList.push(link);
      this.outbound.set(link.fromNode, outList);
    }
    if (link.toNode) {
      const inList = this.inbound.get(link.toNode) ?? [];
      inList.push(link);
      this.inbound.set(link.toNode, inList);
    }
  }

  /** Returns all supply/source nodes. */
  getSupplies(): LpsNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.type === "SUPPLY" || n.type === "STORAGE_CAVERN");
  }

  /** Returns all delivery/city-gate nodes. */
  getDeliveries(): LpsNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.type === "DELIVERY");
  }

  /** Returns total network pipeline length in meters. */
  getTotalLength(): number {
    return this.links.filter((l) => l.kind === "PIPE").reduce((sum, l) => sum + l.length, 0);
  }

  /** Returns total internal volume of the pipeline network in cubic meters. */
  getTotalVolume(): number {
    return this.links
      .filter((l) => l.kind === "PIPE")
      .reduce((vol, l) => vol + Math.PI * (l.diameter / 2) ** 2 * l.length, 0);
  }

  /** Finds all connected paths between a source and a destination node (BFS). */
  findPaths(fromNode: string, toNode: string, maxDepth = 50): NetworkLink[][] {
    const results: NetworkLink[][] = [];
    const queue: { current: string; path: NetworkLink[]; visited: Set<string> }[] = [
      { current: fromNode, path: [], visited: new Set([fromNode]) },
    ];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { current, path, visited } = item;
      if (current === toNode && path.length > 0) {
        results.push(path);
        continue;
      }
      if (path.length >= maxDepth) continue;

      const outLinks = this.outbound.get(current) ?? [];
      for (const link of outLinks) {
        if (!visited.has(link.toNode)) {
          const nextVisited = new Set(visited);
          nextVisited.add(link.toNode);
          queue.push({
            current: link.toNode,
            path: [...path, link],
            visited: nextVisited,
          });
        }
      }
    }

    return results;
  }

  /** Checks if every delivery node is reachable from at least one supply node. */
  verifyDeliverability(): { deliverable: boolean; unreachableDeliveries: string[] } {
    const supplies = this.getSupplies();
    const reachable = new Set<string>();

    for (const s of supplies) {
      const q = [s.name];
      reachable.add(s.name);
      while (q.length > 0) {
        const curr = q.shift();
        if (curr === undefined) break;
        const outLinks = this.outbound.get(curr) ?? [];
        for (const l of outLinks) {
          if (!reachable.has(l.toNode)) {
            reachable.add(l.toNode);
            q.push(l.toNode);
          }
        }
      }
    }

    const unreachableDeliveries: string[] = [];
    for (const d of this.getDeliveries()) {
      if (!reachable.has(d.name)) {
        unreachableDeliveries.push(d.name);
      }
    }

    return {
      deliverable: unreachableDeliveries.length === 0,
      unreachableDeliveries,
    };
  }
}
