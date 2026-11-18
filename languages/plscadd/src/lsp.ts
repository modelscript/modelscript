// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintPlsCadd } from "./lints/index.js";
import { parsePlsCadd } from "./parser/plscadd-parser.js";

export interface LspSymbol {
  name: string;
  detail: string;
  kind: number;
}

export function getPlsCaddDocumentSymbols(content: string): LspSymbol[] {
  const model = parsePlsCadd(content);
  return [
    ...model.structures.map((s) => ({ name: s.id, detail: `Structure (${s.heightM} m)`, kind: 19 })),
    ...model.spans.map((sp) => ({ name: sp.id, detail: `Span ${sp.fromStructure} -> ${sp.toStructure}`, kind: 13 })),
  ];
}

export function getPlsCaddDiagnostics(content: string) {
  return lintPlsCadd(parsePlsCadd(content));
}
