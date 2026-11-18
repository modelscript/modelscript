// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintIec104Profile } from "./lints/index.js";
import { parseIec104 } from "./parser/iec104-parser.js";

export interface LspSymbol {
  name: string;
  detail: string;
  kind: number;
}

export function getIec104DocumentSymbols(content: string): LspSymbol[] {
  const profile = parseIec104(content);
  return profile.points.map((p) => ({
    name: `IOA[${p.ioa}]: ${p.name}`,
    detail: p.units ? `${p.typeId} (${p.units})` : p.typeId,
    kind: 13,
  }));
}

export function getIec104Diagnostics(content: string) {
  return lintIec104Profile(parseIec104(content));
}
