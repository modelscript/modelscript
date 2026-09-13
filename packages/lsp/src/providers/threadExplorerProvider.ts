// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DigitalThreadHypergraph,
  DOMAIN_INDEX_TO_NAME,
  DOMAIN_NAME_TO_INDEX,
  ThreadDomain,
  type BlastRadiusResult,
} from "@modelscript/runtime";
import {
  ThreadDiagnosticsProvider,
  type AlignedDomainElement,
  type ThreadDiagnostic,
} from "./threadDiagnosticsProvider.js";

export interface ThreadGraphNode {
  domain: string;
  domainIndex: number;
  nodeId: number;
  name: string;
  status: "synced" | "stale" | "conflict" | "unverified" | "removed";
  uri?: string;
  line?: number;
  column?: number;
  properties?: Record<string, any>;
}

export interface ThreadGraphItem {
  threadId: number | string;
  revision: number;
  status: "synced" | "stale" | "conflict" | "removed";
  nodes: ThreadGraphNode[];
  diagnostics: ThreadDiagnostic[];
}

export interface ThreadGraphResponse {
  threads: ThreadGraphItem[];
  domains: string[];
  summary: {
    totalThreads: number;
    synced: number;
    stale: number;
    conflict: number;
    unverified: number;
  };
}

export class ThreadExplorerProvider {
  /**
   * Generates a multi-domain graph representation of the Digital Thread for Web IDE visualization.
   */
  static buildThreadGraph(
    hypergraph: DigitalThreadHypergraph,
    nodeMetadataMap?: Map<
      string,
      { name?: string; uri?: string; line?: number; column?: number; properties?: Record<string, any> }
    >,
  ): ThreadGraphResponse {
    const records = hypergraph.getAllRecords();
    const domainNames = ["requirements", "sysml2", "modelica", "cad", "fea", "cfd", "bom", "fmu"];

    let syncedCount = 0;
    let staleCount = 0;
    let conflictCount = 0;
    let unverifiedCount = 0;

    const threadItems: ThreadGraphItem[] = records.map((rec) => {
      let statusStr: "synced" | "stale" | "conflict" | "removed" = "synced";
      if (rec.isRemoved) statusStr = "removed";
      else if (rec.isConflicted) statusStr = "conflict";
      else if (rec.isStale) statusStr = "stale";

      if (statusStr === "synced") syncedCount++;
      else if (statusStr === "stale") staleCount++;
      else if (statusStr === "conflict") conflictCount++;

      const nodes: ThreadGraphNode[] = [];
      const domainElementsForDiag: AlignedDomainElement[] = [];

      for (const [domStr, nId] of Object.entries(rec.domainNodes)) {
        const domIdx = Number(domStr);
        const domName = DOMAIN_INDEX_TO_NAME[domIdx] || `domain_${domIdx}`;
        const metaKey = `${domName}:${nId}`;
        const meta = nodeMetadataMap?.get(metaKey);

        const nodeName = meta?.name || `${domName.toUpperCase()}_Node_${nId}`;
        const nodeStatus = statusStr;

        nodes.push({
          domain: domName,
          domainIndex: domIdx,
          nodeId: nId,
          name: nodeName,
          status: nodeStatus,
          uri: meta?.uri,
          line: meta?.line,
          column: meta?.column,
          properties: meta?.properties,
        });

        domainElementsForDiag.push({
          domain: domName,
          name: nodeName,
          line: meta?.line,
          column: meta?.column,
          properties: meta?.properties,
          status: nodeStatus === "synced" ? "synced" : nodeStatus === "stale" ? "stale" : "conflict",
        });
      }

      const diagnostics = ThreadDiagnosticsProvider.diagnoseThread(String(rec.threadId), domainElementsForDiag, 0.05);

      return {
        threadId: rec.threadId,
        revision: rec.revision,
        status: statusStr,
        nodes,
        diagnostics,
      };
    });

    return {
      threads: threadItems,
      domains: domainNames,
      summary: {
        totalThreads: threadItems.length,
        synced: syncedCount,
        stale: staleCount,
        conflict: conflictCount,
        unverified: unverifiedCount,
      },
    };
  }

  /**
   * Computes transitive blast radius for a given domain node and returns mapped domain names.
   */
  static getBlastRadius(
    hypergraph: DigitalThreadHypergraph,
    domain: string,
    nodeId: number,
  ): BlastRadiusResult & { domainNames: Record<number, string> } {
    const domIdx = DOMAIN_NAME_TO_INDEX[domain.toLowerCase()] ?? ThreadDomain.SysML2;
    const rawResult = hypergraph.computeBlastRadius(domIdx, nodeId);

    return {
      ...rawResult,
      domainNames: DOMAIN_INDEX_TO_NAME,
    };
  }
}
