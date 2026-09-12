// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Digital Thread JSON-LD & File Serializer for @modelscript/runtime.
 *
 * Provides W3C JSON-LD / OSLC-KM compatible serialization and deserialization
 * for federated multi-domain digital thread alignments (.ms-thread).
 */

import { DigitalThreadHypergraph, ThreadDomain } from "./thread_hypergraph.js";

export const THREAD_CONTEXT = {
  "@vocab": "https://modelscript.io/thread#",
  ms: "https://modelscript.io/schema/thread#",
  prov: "http://www.w3.org/ns/prov#",
  threadId: "ms:threadId",
  revision: "ms:revision",
  status: "ms:status",
  alignments: "ms:alignments",
  domains: "ms:domains",
};

export const DOMAIN_NAME_TO_INDEX: Record<string, ThreadDomain> = {
  sysml: ThreadDomain.SysML2,
  sysml2: ThreadDomain.SysML2,
  modelica: ThreadDomain.Modelica,
  cad: ThreadDomain.CAD,
  step: ThreadDomain.CAD,
  requirements: ThreadDomain.Requirements,
  req: ThreadDomain.Requirements,
  reqif: ThreadDomain.Requirements,
  fea: ThreadDomain.FEA,
  cfd: ThreadDomain.CFD,
  bom: ThreadDomain.BOM,
  fmu: ThreadDomain.FMU,
};

export const DOMAIN_INDEX_TO_NAME: Record<number, string> = {
  [ThreadDomain.SysML2]: "sysml2",
  [ThreadDomain.Modelica]: "modelica",
  [ThreadDomain.CAD]: "cad",
  [ThreadDomain.Requirements]: "requirements",
  [ThreadDomain.FEA]: "fea",
  [ThreadDomain.CFD]: "cfd",
  [ThreadDomain.BOM]: "bom",
  [ThreadDomain.FMU]: "fmu",
};

export interface SerializedThreadFile {
  "@context": typeof THREAD_CONTEXT;
  "@type": "ms:DigitalThreadCollection";
  version: string;
  generatedAt: string;
  metadata?: Record<string, any>;
  threads: {
    threadId: number | string;
    revision: number;
    status: "synced" | "stale" | "conflict" | "removed";
    domains: Record<string, number | string>;
  }[];
}

export class ThreadSerializer {
  static serialize(hypergraph: DigitalThreadHypergraph, metadata: Record<string, any> = {}): string {
    const records = hypergraph.getAllRecords();
    const threads = records.map((rec) => {
      let statusStr: "synced" | "stale" | "conflict" | "removed" = "synced";
      if (rec.isRemoved) statusStr = "removed";
      else if (rec.isConflicted) statusStr = "conflict";
      else if (rec.isStale) statusStr = "stale";

      const domains: Record<string, number> = {};
      for (const [domIdxStr, nodeId] of Object.entries(rec.domainNodes)) {
        const domIdx = Number(domIdxStr);
        const name = DOMAIN_INDEX_TO_NAME[domIdx] || `domain_${domIdx}`;
        domains[name] = nodeId;
      }

      return {
        threadId: rec.threadId,
        revision: rec.revision,
        status: statusStr,
        domains,
      };
    });

    const file: SerializedThreadFile = {
      "@context": THREAD_CONTEXT,
      "@type": "ms:DigitalThreadCollection",
      version: "1.0",
      generatedAt: new Date().toISOString(),
      metadata,
      threads,
    };

    return JSON.stringify(file, null, 2);
  }

  static deserialize(jsonStr: string, existingHypergraph?: DigitalThreadHypergraph): DigitalThreadHypergraph {
    const hg = existingHypergraph || new DigitalThreadHypergraph();
    const parsed = JSON.parse(jsonStr) as SerializedThreadFile;

    if (!parsed.threads || !Array.isArray(parsed.threads)) {
      throw new Error("Invalid .ms-thread file: missing 'threads' array");
    }

    for (const t of parsed.threads) {
      const threadIdNum =
        typeof t.threadId === "number" ? t.threadId : parseInt(String(t.threadId).replace(/\D/g, "") || "1", 10);
      const slot = hg.createThread(threadIdNum, t.revision || 0);

      for (const [domName, rawNodeId] of Object.entries(t.domains || {})) {
        const domIdx = DOMAIN_NAME_TO_INDEX[domName.toLowerCase()];
        if (domIdx !== undefined) {
          const nodeId =
            typeof rawNodeId === "number" ? rawNodeId : parseInt(String(rawNodeId).replace(/\D/g, "") || "1", 10);
          hg.bindDomainNode(slot, domIdx, nodeId);
        }
      }

      if (t.status === "stale") hg.markStale(slot);
      else if (t.status === "conflict") hg.markConflict(slot);
      else if (t.status === "removed") hg.markRemoved(slot);
    }

    return hg;
  }
}
