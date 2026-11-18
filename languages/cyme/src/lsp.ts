// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintCymeNetwork } from "./lints/index.js";
import { parseCyme } from "./parser/cyme-parser.js";

export interface LspSymbol {
  name: string;
  detail: string;
  kind: number;
}

export function getCymeDocumentSymbols(content: string): LspSymbol[] {
  const net = parseCyme(content);
  return [
    ...net.nodes.map((n) => ({ name: n.nodeId, detail: n.nominalKv ? `Node (${n.nominalKv} kV)` : "Node", kind: 19 })),
    ...net.sections.map((s) => ({
      name: s.sectionId,
      detail: `${s.deviceType} (${s.fromNodeId} -> ${s.toNodeId})`,
      kind: 13,
    })),
    ...net.loads.map((l) => ({ name: l.loadId, detail: `Load (${l.kw} kW)`, kind: 13 })),
  ];
}

export function getCymeDiagnostics(content: string) {
  return lintCymeNetwork(parseCyme(content));
}
