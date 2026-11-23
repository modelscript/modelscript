// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/reqif` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes ReqIF `SPEC-OBJECT` attributes (`HasParameters`) and `SPEC-RELATION` traceability
 * links (`HasRequirements`) directly from `SymbolIndex` without allocating `PolyglotNode` DTOs.
 */

import {
  type InteropReqRelation,
  InteropTrait,
  LanguageDomainId,
  type ParamSink,
  type ReqLinkSink,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
} from "@modelscript/runtime";

/**
 * Creates a `SymbolInteropLibrary` for ReqIF (`LanguageDomainId.ReqIF`).
 */
export function createReqifInteropLibrary(): SymbolInteropLibrary {
  return {
    domainId: LanguageDomainId.ReqIF,
    languageId: "reqif",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;

      let traits = InteropTrait.HasRequirements;
      const meta = entry.metadata ?? {};
      if (
        meta["attributes"] !== undefined ||
        meta["threshold"] !== undefined ||
        (index.childrenOf.get(symbolId)?.length ?? 0) > 0
      ) {
        traits |= InteropTrait.HasParameters;
      }
      return traits;
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      if (!index) return;
      const entry = index.symbols.get(symbolId);
      if (!entry) return;
      const meta = entry.metadata ?? {};
      const attrs = meta["attributes"];
      if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
        for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
          sink(k, typeof v === "number" ? "Real" : "String", String(v), undefined, false);
        }
      }
      if (meta["threshold"] !== undefined) {
        sink(
          "threshold",
          "Real",
          String(meta["threshold"]),
          typeof meta["unit"] === "string" ? meta["unit"] : undefined,
          false,
        );
      }
    },

    readRequirementLinks(symbolId: SymbolId, sink: ReqLinkSink, index?: SymbolIndex): void {
      if (!index) return;
      const entry = index.symbols.get(symbolId);
      if (!entry) return;
      const rels = entry.metadata?.["relations"] ?? entry.metadata?.["requirements"];
      if (Array.isArray(rels)) {
        for (const r of rels) {
          if (r && typeof r === "object" && typeof (r as { target?: unknown }).target === "string") {
            const obj = r as { target: string; relation?: InteropReqRelation };
            sink(obj.target, obj.relation ?? "derivesFrom");
          }
        }
      }
    },
  };
}
