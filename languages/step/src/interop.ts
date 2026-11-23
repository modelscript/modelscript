// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/step` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes STEP AP214/AP242 CAD B-Rep bounding boxes (`HasGeometry`) and physical/GD&T
 * attributes (`HasParameters`, e.g. `mass`, `volume`, `surfaceArea`) without DTO allocation.
 */

import {
  InteropTrait,
  LanguageDomainId,
  type ParamSink,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
} from "@modelscript/runtime";

export function createStepInteropLibrary(): SymbolInteropLibrary {
  return {
    domainId: LanguageDomainId.STEP_CAD,
    languageId: "step",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;
      const meta = entry.metadata ?? {};
      let traits = InteropTrait.None;
      if (Array.isArray(meta["bounds"]) && meta["bounds"].length >= 6) {
        traits |= InteropTrait.HasGeometry;
      }
      if (meta["mass"] !== undefined || meta["volume"] !== undefined || meta["material"] !== undefined) {
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
      const meta = index?.symbols.get(symbolId)?.metadata;
      if (!meta) return;
      if (meta["mass"] !== undefined) sink("mass", "Real", String(meta["mass"]), "kg", false);
      if (meta["volume"] !== undefined) sink("volume", "Real", String(meta["volume"]), "m3", false);
      if (meta["surfaceArea"] !== undefined) sink("surfaceArea", "Real", String(meta["surfaceArea"]), "m2", false);
      if (typeof meta["material"] === "string") sink("material", "String", meta["material"], undefined, false);
    },
  };
}
