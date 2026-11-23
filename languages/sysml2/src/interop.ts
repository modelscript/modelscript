// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/sysml2` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes SysML v2 `port` usages (`HasPorts`), `attribute` usages (`HasParameters`),
 * `satisfy`/`verify`/`allocate` links (`HasRequirements`), and `state` usages (`HasStates`)
 * directly from `SymbolIndex` without allocating `PolyglotNode` DTOs.
 */

import {
  type InteropPortDirection,
  type InteropReqRelation,
  InteropTrait,
  LanguageDomainId,
  type ParamSink,
  type PortSink,
  type ReqLinkSink,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
} from "@modelscript/runtime";

/**
 * Creates a `SymbolInteropLibrary` for SysML v2 (`LanguageDomainId.SysML2`).
 */
export function createSysml2InteropLibrary(): SymbolInteropLibrary {
  return {
    domainId: LanguageDomainId.SysML2,
    languageId: "sysml2",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;

      let traits = InteropTrait.None;
      const entryKind = entry.kind.toLowerCase();
      if (entryKind.includes("requirement")) traits |= InteropTrait.HasRequirements;

      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const k = ch.kind.toLowerCase();
        const r = (ch.ruleName ?? "").toLowerCase();
        if (k.includes("port") || r.includes("port_usage")) {
          traits |= InteropTrait.HasPorts;
        } else if (k.includes("attribute") || r.includes("attribute_usage")) {
          traits |= InteropTrait.HasParameters;
        } else if (k.includes("state") || r.includes("state_usage") || r.includes("transition")) {
          traits |= InteropTrait.HasStates;
        } else if (
          k.includes("satisfy") ||
          k.includes("verify") ||
          k.includes("allocate") ||
          k.includes("requirement")
        ) {
          traits |= InteropTrait.HasRequirements;
        }
      }

      if (Array.isArray(entry.metadata?.["requirements"]) && entry.metadata["requirements"].length > 0) {
        traits |= InteropTrait.HasRequirements;
      }
      return traits;
    },

    readPorts(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const k = ch.kind.toLowerCase();
        const r = (ch.ruleName ?? "").toLowerCase();
        if (!k.includes("port") && !r.includes("port_usage")) continue;
        const meta = ch.metadata ?? {};
        const portType = String(meta["featureType"] ?? meta["type"] ?? "Port");
        const dirRaw = String(meta["direction"] ?? "").toLowerCase();
        const dir: InteropPortDirection = dirRaw === "in" || dirRaw === "out" || dirRaw === "inout" ? dirRaw : "inout";
        sink(ch.name, portType, dir, Boolean(meta["isFlow"]), Boolean(meta["isInherited"]));
      }
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const k = ch.kind.toLowerCase();
        const r = (ch.ruleName ?? "").toLowerCase();
        if (!k.includes("attribute") && !r.includes("attribute_usage")) continue;
        const meta = ch.metadata ?? {};
        const typeSpec = String(meta["featureType"] ?? meta["type"] ?? "Real");
        const val =
          meta["defaultValue"] !== undefined
            ? String(meta["defaultValue"])
            : meta["value"] !== undefined
              ? String(meta["value"])
              : undefined;
        const unit = typeof meta["unit"] === "string" ? meta["unit"] : undefined;
        sink(ch.name, typeSpec, val, unit, Boolean(meta["isInherited"]));
      }
    },

    readRequirementLinks(symbolId: SymbolId, sink: ReqLinkSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const k = ch.kind.toLowerCase();
        const target = String(ch.metadata?.["target"] ?? ch.name);
        if (k.includes("satisfy")) sink(target, "satisfies");
        else if (k.includes("verify")) sink(target, "verifies");
        else if (k.includes("allocate")) sink(target, "allocates");
      }
      const reqs = index.symbols.get(symbolId)?.metadata?.["requirements"];
      if (Array.isArray(reqs)) {
        for (const r of reqs) {
          if (r && typeof r === "object" && typeof (r as { target?: unknown }).target === "string") {
            const obj = r as { target: string; relation?: InteropReqRelation };
            sink(obj.target, obj.relation ?? "satisfies");
          }
        }
      }
    },
  };
}
