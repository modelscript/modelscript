// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/scad` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes OpenSCAD CSG module bounding boxes (`HasGeometry`) and parametric dimensions
 * (`HasParameters`) directly from `SymbolIndex` without DTO allocations.
 */

import {
  InteropTrait,
  LanguageDomainId,
  type ParamSink,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
} from "@modelscript/runtime";

export function createScadInteropLibrary(): SymbolInteropLibrary {
  return {
    domainId: LanguageDomainId.SCAD,
    languageId: "scad",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;
      const meta = entry.metadata ?? {};
      let traits = InteropTrait.None;
      if (Array.isArray(meta["bounds"]) && meta["bounds"].length >= 6) {
        traits |= InteropTrait.HasGeometry;
      }
      if ((index.childrenOf.get(symbolId)?.length ?? 0) > 0 || Array.isArray(meta["parameters"])) {
        traits |= InteropTrait.HasParameters;
      }
      return traits;
    },

    readGeometryBounds(symbolId: SymbolId, outF64: Float64Array, index?: SymbolIndex): boolean {
      if (!index || outF64.length < 6) return false;
      const bounds = index.symbols.get(symbolId)?.metadata?.["bounds"];
      if (!Array.isArray(bounds) || bounds.length < 6) return false;
      for (let i = 0; i < 6; i++) outF64[i] = Number(bounds[i]);
      return true;
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const val = ch.metadata?.["value"];
        sink(ch.name, "Real", val !== undefined ? String(val) : undefined, "mm", false);
      }
    },
  };
}
