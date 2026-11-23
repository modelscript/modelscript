// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `@modelscript/modelica` Trait-Based `SymbolInteropLibrary`.
 *
 * Exposes Modelica connectors (`HasPorts`), parameters (`HasParameters`),
 * and state-machine/mode declarations (`HasStates`) directly from `SymbolIndex`
 * without allocating `PolyglotNode` wrapper DTOs.
 */

import {
  type DAEBuilder,
  defaultSymbolInteropRegistry,
  getSymbolDomain,
  type InlinedComponentHandle,
  type InteropPortDirection,
  InteropTrait,
  LanguageDomainId,
  type ParamSink,
  PolyglotDaeInliner,
  type PortSink,
  type SymbolId,
  type SymbolIndex,
  type SymbolInteropLibrary,
  type SymbolInteropRegistry,
} from "@modelscript/runtime";

const CONNECTOR_TYPES = new Set([
  "pin",
  "positivepin",
  "negativepin",
  "flange",
  "flange_a",
  "flange_b",
  "heatport",
  "heatport_a",
  "heatport_b",
  "realinput",
  "realoutput",
  "booleaninput",
  "booleanoutput",
  "integerinput",
  "integeroutput",
  "fluidport",
]);

function isModelicaConnector(kind: string, typeSpec: string, meta: Record<string, unknown>): boolean {
  if (meta["isConnector"] === true || meta["isConnectorPort"] === true) return true;
  if (meta["classKind"] === "connector" || meta["classKind"] === "expandable connector") return true;
  const k = kind.toLowerCase();
  if (k.includes("connector") || k.includes("port")) return true;
  const simpleType = typeSpec.split(".").pop()?.toLowerCase() ?? "";
  return CONNECTOR_TYPES.has(simpleType);
}

/**
 * Creates a `SymbolInteropLibrary` for Modelica (`LanguageDomainId.Modelica`).
 */
export function createModelicaInteropLibrary(): SymbolInteropLibrary {
  return {
    domainId: LanguageDomainId.Modelica,
    languageId: "modelica",

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;

      let traits = InteropTrait.None;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const meta = ch.metadata ?? {};
        const typeSpec = String(meta["typeSpecifier"] ?? meta["type"] ?? "");
        if (isModelicaConnector(ch.kind, typeSpec, meta)) {
          traits |= InteropTrait.HasPorts;
        } else if (meta["variability"] === "parameter" || meta["variability"] === "constant") {
          traits |= InteropTrait.HasParameters;
        }
        if (meta["isState"] === true || ch.kind.toLowerCase().includes("state")) {
          traits |= InteropTrait.HasStates;
        }
      }
      if (Array.isArray(entry.metadata?.["taxonomy"]) && entry.metadata["taxonomy"].length > 0) {
        traits |= InteropTrait.HasTaxonomy;
      }
      return traits;
    },

    readPorts(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const meta = ch.metadata ?? {};
        const typeSpec = String(meta["typeSpecifier"] ?? meta["type"] ?? "Connector");
        if (!isModelicaConnector(ch.kind, typeSpec, meta)) continue;
        const causality = String(meta["causality"] ?? "").toLowerCase();
        const dir: InteropPortDirection =
          causality === "input" ? "in" : causality === "output" ? "out" : meta["isFlow"] === true ? "flow" : "inout";
        sink(ch.name, typeSpec, dir, Boolean(meta["isFlow"]), Boolean(meta["isInherited"]));
      }
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      if (!index) return;
      const kids = index.childrenOf.get(symbolId) ?? [];
      for (const cid of kids) {
        const ch = index.symbols.get(cid);
        if (!ch) continue;
        const meta = ch.metadata ?? {};
        if (meta["variability"] !== "parameter" && meta["variability"] !== "constant") continue;
        const typeSpec = String(meta["typeSpecifier"] ?? meta["type"] ?? "Real");
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

    readTaxonomyClasses(symbolId: SymbolId, index?: SymbolIndex): readonly string[] {
      const tax = index?.symbols.get(symbolId)?.metadata?.["taxonomy"];
      return Array.isArray(tax) ? tax.filter((x): x is string => typeof x === "string") : [];
    },
  };
}

/**
 * Attempts to inline a foreign-domain component (e.g. a SPICE subcircuit or Verilog-A block)
 * directly into a Modelica host `DAEBuilder` arena when its domain supports `InteropTrait.LowerableDAE`.
 * Returns `null` if the symbol is native Modelica or does not advertise `LowerableDAE`.
 */
export function tryInlineForeignComponentInModelica(
  symbolId: SymbolId,
  dae: DAEBuilder,
  prefix: string,
  parameterOverrides?: ReadonlyMap<string, number>,
  index?: SymbolIndex,
  registry: SymbolInteropRegistry = defaultSymbolInteropRegistry,
): InlinedComponentHandle | null {
  if (getSymbolDomain(symbolId) === LanguageDomainId.Modelica) return null;
  const inliner = new PolyglotDaeInliner(registry);
  if (!inliner.canInline(symbolId, index)) return null;
  return inliner.inlineComponent(symbolId, dae, prefix, parameterOverrides, index);
}
