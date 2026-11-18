// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintC37118Config } from "./lints/index.js";
import { parseC37118 } from "./parser/c37118-parser.js";

export interface LspSymbol {
  name: string;
  detail: string;
  kind: number;
}

export function getC37118DocumentSymbols(content: string): LspSymbol[] {
  const cfg = parseC37118(content);
  return [
    ...cfg.phasors.map((p) => ({
      name: p.name,
      detail: `${p.type === "V" ? "Voltage" : "Current"} Phasor (${p.format})`,
      kind: 13,
    })),
    ...cfg.analogs.map((a) => ({
      name: a.name,
      detail: a.units ? `Analog (${a.units})` : "Analog",
      kind: 13,
    })),
  ];
}

export function getC37118Diagnostics(content: string) {
  return lintC37118Config(parseC37118(content));
}
