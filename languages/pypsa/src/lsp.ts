// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintPypsaNetwork } from "./lints/index.js";
import { parsePypsa } from "./parser/pypsa-parser.js";

export interface LspSymbol {
  name: string;
  detail: string;
  kind: number;
}

export function getPypsaDocumentSymbols(content: string): LspSymbol[] {
  const net = parsePypsa(content);
  return [
    ...net.buses.map((b) => ({ name: b.name, detail: `Bus (${b.v_nom} kV, ${b.carrier})`, kind: 19 })),
    ...net.generators.map((g) => ({ name: g.name, detail: `Gen @ ${g.bus} (${g.p_nom} MW)`, kind: 13 })),
    ...net.lines.map((l) => ({ name: l.name, detail: `Line ${l.bus0} -> ${l.bus1}`, kind: 13 })),
  ];
}

export function getPypsaDiagnostics(content: string) {
  return lintPypsaNetwork(parsePypsa(content));
}
