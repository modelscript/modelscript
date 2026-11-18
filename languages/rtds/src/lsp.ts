// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintRtdsDraft } from "./lints/index.js";
import { parseRtdsDraft } from "./parser/rtds-parser.js";

export interface LspSymbol {
  name: string;
  detail: string;
  kind: number;
}

export function getRtdsDocumentSymbols(content: string): LspSymbol[] {
  const draft = parseRtdsDraft(content);
  return draft.components.map((c) => ({
    name: c.name,
    detail: `${c.type} (Subsystem ${c.subsystem}, nodes: ${c.nodes.join(", ")})`,
    kind: 19,
  }));
}

export function getRtdsDiagnostics(content: string) {
  return lintRtdsDraft(parseRtdsDraft(content));
}
