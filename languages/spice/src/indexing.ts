// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseSpice } from "./parser/spice-parser.js";
import type { SpiceCircuit } from "./types.js";

function deriveSpiceNameFromUri(uri: string): string {
  const filename = uri.split("/").pop() || "circuit.cir";
  return filename.replace(/\.(cir|sp|net|lib|mod)$/i, "");
}

/**
 * Content predicate for disambiguating SPICE netlists across shared extensions (`.cir`, `.sp`, `.net`).
 */
export function canIndexSpiceFile(uri: string, text = ""): boolean {
  if (/\.lib$/i.test(uri)) return true;
  return /^\s*(?:\*|\.(?:SUBCKT|MODEL|END|INCLUDE|LIB|TRAN|AC|OP|DC|PARAM)\b|[RVLCIDQMXEFGHKBSWTU]\S*\s+)/im.test(text);
}

/**
 * Declarative `UnifiedWorkspace` file indexer for SPICE analog netlists (`.cir`, `.sp`, `.net`, `.lib`).
 */
export function indexSpiceFile(ctx: DslIndexFileContext): void {
  let circuit: SpiceCircuit;
  try {
    circuit = parseSpice(ctx.text);
    ctx.setParsedModel(circuit);
  } catch {
    return;
  }

  const circuitTitle = circuit.title || deriveSpiceNameFromUri(ctx.uri);

  const rootId = ctx.addSymbol(
    circuitTitle,
    "Package",
    null,
    0,
    ctx.text.length,
    {
      language: "spice",
      componentCount: circuit.components.length,
      subcircuitCount: circuit.subcircuits.size,
      modelCount: circuit.models.size,
    },
    {
      ruleName: "spice_circuit",
      namePath: circuitTitle,
    },
  );

  const addChildSymbol = (
    name: string,
    kind: string,
    ruleName: string,
    span: { startOffset?: number; endOffset?: number } | undefined,
    meta: Record<string, unknown>,
  ) => {
    const upper = name.toUpperCase();
    ctx.addSymbol(
      name,
      kind,
      rootId,
      span?.startOffset ?? 0,
      span?.endOffset ?? 0,
      {
        language: "spice",
        ...meta,
      },
      {
        ruleName,
        namePath: `${circuitTitle}.${name}`,
        aliases: upper !== name ? [upper] : undefined,
      },
    );
  };

  for (const sub of circuit.subcircuits.values()) {
    addChildSymbol(sub.name, "Class", "spice_subcircuit", sub.span, {
      ports: sub.ports,
      componentCount: sub.components.length,
    });
  }

  for (const model of circuit.models.values()) {
    addChildSymbol(model.name, "Class", "spice_model", model.span, {
      modelType: model.type,
      params: Array.from(model.params.entries()),
    });
  }

  for (const comp of circuit.components) {
    addChildSymbol(comp.name, "Variable", "spice_component", comp.span, {
      kind: comp.kind,
      nodes: comp.nodes,
      value: comp.value,
      subcktName: comp.subcktName,
    });
  }
}

/**
 * Case-insensitive substring symbol search across SPICE netlists indexed in `workspace`.
 */
export function findSpiceSymbols(workspace: UnifiedWorkspace, query: string): SymbolEntry[] {
  const results: SymbolEntry[] = [];
  const lowerQuery = query.toLowerCase();
  const idx = workspace.getIndex();

  for (const [name, ids] of idx.byName) {
    if (name.toLowerCase().includes(lowerQuery)) {
      for (const id of ids) {
        const sym = idx.symbols.get(id);
        if (sym && sym.language === "spice" && !results.includes(sym)) {
          results.push(sym);
        }
      }
    }
  }
  return results;
}

/**
 * Resolves a SPICE subcircuit, model, or component symbol by name, preferring `fromUri` before global lookup.
 */
export function resolveSpiceQualified(
  workspace: UnifiedWorkspace,
  name: string,
  fromUri?: string,
): SymbolEntry | undefined {
  const upperName = name.toUpperCase();

  if (fromUri) {
    const localIdx = workspace.getFileIndex(fromUri);
    if (localIdx) {
      const ids = localIdx.byName.get(name) ?? localIdx.byName.get(upperName);
      const firstId = ids?.[0];
      if (firstId !== undefined) return localIdx.symbols.get(firstId);
    }
  }

  const idx = workspace.getIndex();
  const ids = idx.byName.get(name) ?? idx.byName.get(upperName);
  if (ids) {
    for (const id of ids) {
      const sym = idx.symbols.get(id);
      if (sym && sym.language === "spice") return sym;
    }
  }
  return undefined;
}

/**
 * Finds cross-file component references to a SPICE `.SUBCKT` or `.MODEL` symbol across `workspace`.
 */
export function findSpiceReferencesTo(
  workspace: UnifiedWorkspace,
  symbolId: SymbolId,
): { uri: string; startOffset: number; endOffset: number }[] {
  const refs: { uri: string; startOffset: number; endOffset: number }[] = [];
  const sym = workspace.getIndex().symbols.get(symbolId);
  if (!sym) return refs;

  const targetName = sym.name.toUpperCase();
  for (const [uri, circuit] of workspace.getAllParsedModels<SpiceCircuit>()) {
    for (const comp of circuit.components) {
      if (comp.subcktName?.toUpperCase() === targetName || comp.model?.toUpperCase() === targetName) {
        if (comp.span) {
          refs.push({
            uri,
            startOffset: comp.span.startOffset,
            endOffset: comp.span.endOffset,
          });
        }
      }
    }
  }

  return refs;
}
