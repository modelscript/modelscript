// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/pscad` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes PSCAD/EMTDC electrical & control ports (`HasPorts`) and component parameters
 * (`HasParameters`) directly from `SymbolIndex` without DTO allocations.
 */

import {
  type InteropPortDirection,
  InteropTrait,
  LanguageDomainId,
  type ParamSink,
  type PortSink,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
} from "@modelscript/runtime";

export function createPscadInteropLibrary(): SymbolInteropLibrary {
  return {
    domainId: LanguageDomainId.PSCAD,
    languageId: "pscad",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;
      let traits = InteropTrait.None;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        if (ch.ruleName === "pscad_port" || ch.kind.toLowerCase().includes("port")) {
          traits |= InteropTrait.HasPorts;
        } else {
          traits |= InteropTrait.HasParameters;
        }
      }
      return traits;
    },

    readPorts(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        if (ch.ruleName !== "pscad_port" && !ch.kind.toLowerCase().includes("port")) continue;
        const meta = ch.metadata ?? {};
        const portType = String(meta["type"] ?? "ElectricalNode");
        const dirRaw = String(meta["direction"] ?? "inout").toLowerCase();
        const dir: InteropPortDirection = dirRaw === "in" || dirRaw === "out" || dirRaw === "inout" ? dirRaw : "inout";
        sink(ch.name, portType, dir, Boolean(meta["isElectrical"] ?? true), false);
      }
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        if (ch.ruleName === "pscad_port" || ch.kind.toLowerCase().includes("port")) continue;
        const meta = ch.metadata ?? {};
        const val = meta["value"] !== undefined ? String(meta["value"]) : undefined;
        const unit = typeof meta["unit"] === "string" ? meta["unit"] : undefined;
        sink(ch.name, String(meta["type"] ?? "Real"), val, unit, false);
      }
    },
  };
}
