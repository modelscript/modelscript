// SPDX-License-Identifier: AGPL-3.0-or-later

import { PERIODIC_TABLE } from "../catalog/molfile-std-schemas.js";
import type { ElementData } from "../types.js";

export { PERIODIC_TABLE };

const ELEMENT_MAP = new Map<string, ElementData>();
for (const el of PERIODIC_TABLE) {
  ELEMENT_MAP.set(el.symbol, el);
  ELEMENT_MAP.set(el.symbol.toUpperCase(), el);
}
// Deuterium & Tritium aliases
const HYDROGEN = ELEMENT_MAP.get("H")!;
ELEMENT_MAP.set("D", {
  ...HYDROGEN,
  symbol: "D",
  name: "Deuterium",
  atomicWeight: 2.01410178,
  monoisotopicMass: 2.014101778,
});
ELEMENT_MAP.set("T", {
  ...HYDROGEN,
  symbol: "T",
  name: "Tritium",
  atomicWeight: 3.01604928,
  monoisotopicMass: 3.016049282,
});

/**
 * Looks up element properties by chemical symbol (exact or case-insensitive).
 */
export function getElementData(symbol: string): ElementData | undefined {
  const trimmed = symbol.trim();
  return ELEMENT_MAP.get(trimmed) ?? ELEMENT_MAP.get(trimmed.toUpperCase());
}

/**
 * Returns true if the given symbol is a known periodic table element (or D/T).
 */
export function isKnownElement(symbol: string): boolean {
  return getElementData(symbol) !== undefined;
}
