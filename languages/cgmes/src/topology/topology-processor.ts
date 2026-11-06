// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — CIM / CGMES Topology Processor.
 *
 * Implements Union-Find disjoint-set algorithms to resolve node-breaker topologies
 * and map ConnectivityNodes to canonical TopologicalNodes.
 */

import type { CgmesModel } from "../types.js";

/** Disjoint-set forest with path compression and union by rank. */
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

export interface NodeEquipmentMap {
  lines: string[];
  transformers: string[];
  generators: string[];
  loads: string[];
  shunts: string[];
}

export interface TopologyResult {
  model: CgmesModel;
  terminalToNode: Map<string, string>;
  nodeEquipments: Map<string, NodeEquipmentMap>;
  islandCount: number;
}

/**
 * Processes and synthesizes topological nodes for a CGMES model.
 */
export function processTopology(model: CgmesModel): TopologyResult {
  const uf = new DisjointSet();
  const terminalToNode = new Map<string, string>();

  // Ensure all existing TopologicalNodes and ConnectivityNodes are in UF
  for (const nodeId of model.nodes.keys()) {
    uf.makeSet(nodeId);
  }
  for (const cnId of model.connectivityNodes.keys()) {
    uf.makeSet(cnId);
  }

  // If a Terminal already has both connectivityNodeId and topologicalNodeId, link them
  for (const term of model.terminals.values()) {
    if (term.connectivityNodeId && term.topologicalNodeId) {
      uf.union(term.connectivityNodeId, term.topologicalNodeId);
    }
  }

  // Collect terminals for each conducting equipment
  const equipmentTerminals = new Map<string, string[]>();
  for (const term of model.terminals.values()) {
    const list = equipmentTerminals.get(term.conductingEquipmentId) ?? [];
    list.push(term.mRID);
    equipmentTerminals.set(term.conductingEquipmentId, list);
  }

  // Resolve topological node for each terminal
  for (const term of model.terminals.values()) {
    if (term.topologicalNodeId && model.nodes.has(term.topologicalNodeId)) {
      terminalToNode.set(term.mRID, term.topologicalNodeId);
    } else if (term.connectivityNodeId) {
      const root = uf.find(term.connectivityNodeId);
      // If root is an existing TopologicalNode, use it
      if (model.nodes.has(root)) {
        terminalToNode.set(term.mRID, root);
        term.topologicalNodeId = root;
      } else {
        // Create a synthetic TopologicalNode for this connectivity node group
        let synthNode = model.nodes.get(root);
        if (!synthNode) {
          const cn = model.connectivityNodes.get(term.connectivityNodeId);
          let baseKv = 400.0;
          if (cn?.containerId && model.voltageLevels.has(cn.containerId)) {
            baseKv = model.voltageLevels.get(cn.containerId)!.baseVoltageKv;
          }
          synthNode = {
            mRID: root,
            name: `NODE_${root.replace(/[^a-zA-Z0-9_]/g, "_")}`,
            baseVoltageKv: baseKv,
            voltageLevelId: cn?.containerId,
          };
          model.nodes.set(root, synthNode);
        }
        terminalToNode.set(term.mRID, root);
        term.topologicalNodeId = root;
      }
    }
  }

  // Map equipment to nodes
  const nodeEquipments = new Map<string, NodeEquipmentMap>();
  for (const nodeId of model.nodes.keys()) {
    nodeEquipments.set(nodeId, {
      lines: [],
      transformers: [],
      generators: [],
      loads: [],
      shunts: [],
    });
  }

  function getEquipmentNode(eqId: string): string | undefined {
    const terms = equipmentTerminals.get(eqId);
    if (!terms || terms.length === 0) return undefined;
    return terminalToNode.get(terms[0]!);
  }

  for (const lineId of model.lines.keys()) {
    const terms = equipmentTerminals.get(lineId);
    if (terms) {
      for (const tId of terms) {
        const nId = terminalToNode.get(tId);
        if (nId && nodeEquipments.has(nId)) {
          nodeEquipments.get(nId)!.lines.push(lineId);
        }
      }
    }
  }

  for (const xfId of model.transformers.keys()) {
    const terms = equipmentTerminals.get(xfId);
    if (terms) {
      for (const tId of terms) {
        const nId = terminalToNode.get(tId);
        if (nId && nodeEquipments.has(nId)) {
          nodeEquipments.get(nId)!.transformers.push(xfId);
        }
      }
    }
  }

  for (const genId of model.generators.keys()) {
    const nId = getEquipmentNode(genId);
    if (nId && nodeEquipments.has(nId)) {
      nodeEquipments.get(nId)!.generators.push(genId);
    }
  }

  for (const loadId of model.loads.keys()) {
    const nId = getEquipmentNode(loadId);
    if (nId && nodeEquipments.has(nId)) {
      nodeEquipments.get(nId)!.loads.push(loadId);
    }
  }

  for (const shuntId of model.shunts.keys()) {
    const nId = getEquipmentNode(shuntId);
    if (nId && nodeEquipments.has(nId)) {
      nodeEquipments.get(nId)!.shunts.push(shuntId);
    }
  }

  // Count connected islands across AC lines and transformers
  const islandUf = new DisjointSet();
  for (const nodeId of model.nodes.keys()) {
    islandUf.makeSet(nodeId);
  }

  for (const lineId of model.lines.keys()) {
    const terms = equipmentTerminals.get(lineId);
    if (terms && terms.length >= 2) {
      const n1 = terminalToNode.get(terms[0]!);
      const n2 = terminalToNode.get(terms[1]!);
      if (n1 && n2) {
        islandUf.union(n1, n2);
      }
    }
  }

  for (const xfId of model.transformers.keys()) {
    // Find ends
    const ends: string[] = [];
    for (const end of model.transformerEnds.values()) {
      if (end.powerTransformerId === xfId && end.terminalId) {
        const n = terminalToNode.get(end.terminalId);
        if (n) ends.push(n);
      }
    }
    if (ends.length >= 2) {
      islandUf.union(ends[0]!, ends[1]!);
    }
  }

  const roots = new Set<string>();
  for (const nodeId of model.nodes.keys()) {
    roots.add(islandUf.find(nodeId));
  }

  return {
    model,
    terminalToNode,
    nodeEquipments,
    islandCount: roots.size,
  };
}
