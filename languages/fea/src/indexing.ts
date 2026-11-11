// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { parseFeaDeck } from "./dialects/index.js";
import type { FeaModelData } from "./types.js";

export interface FeaSourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Content predicate for Finite Element Analysis decks (Abaqus/CalculiX .inp/.inpt/.fea, Nastran .bdf/.dat).
 */
export function canIndexFea(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".fea") || lower.endsWith(".inpt") || lower.endsWith(".bdf")) return true;
  if (
    lower.endsWith(".swmm.inp") ||
    lower.endsWith(".epanet.inp") ||
    lower.endsWith(".sima.inp") ||
    lower.endsWith(".relap5.inp") ||
    lower.endsWith(".aspen.inp")
  ) {
    return false;
  }
  if (text) {
    if (/^\s*\*(HEADING|NODE|ELEMENT|MATERIAL|NSET|ELSET|STEP)\b/im.test(text)) return true;
    if (/^\s*(BEGIN\s+BULK|CEND|GRID\b|MAT1\b|CHEXA\b|CTETRA\b|CQUAD4\b)/im.test(text)) return true;
  }
  return false;
}

/**
 * Declarative workspace indexer for Finite Element Analysis decks (Abaqus/CalculiX .inp, Nastran .bdf).
 */
export function indexFeaDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const addSym = (parentId: number | null, name: string, kind: string): number => {
    return ctx.addSymbol(
      name,
      kind,
      parentId,
      0,
      0,
      {},
      {
        ruleName: "fea_entity",
        namePath: name,
      },
    );
  };

  try {
    const ext = uri.split(".").pop() ?? "inp";
    const deck = parseFeaDeck(text, ext);
    ctx.setParsedModel(deck);

    const rootName = deck.heading || (deck.elements.size > 0 ? `FEA (${deck.elements.size} elements)` : "FEA Deck");
    const rootId = addSym(null, rootName, "model");

    for (const [matName, mat] of deck.materials.entries()) {
      addSym(rootId, matName, "material");
      if (mat.E !== undefined) {
        addSym(rootId, `${matName}_E`, "parameter");
      }
    }

    for (const setName of deck.nodeSets.keys()) {
      addSym(rootId, setName, "nset");
    }
    for (const setName of deck.elementSets.keys()) {
      addSym(rootId, setName, "elset");
    }

    if (deck.nodes.size > 0) {
      addSym(rootId, `Nodes_${deck.nodes.size}`, "nodes");
    }
    if (deck.elements.size > 0) {
      addSym(rootId, `Elements_${deck.elements.size}`, "elements");
    }
  } catch {
    // Ignore parse failures during incremental editing
  }
}

export function getFeaDeck(workspace: UnifiedWorkspace, uri: string): FeaModelData | undefined {
  return workspace.getParsedModel<FeaModelData>(uri);
}

export function findFeaDefinitions(
  workspace: UnifiedWorkspace,
  name: string,
  currentUri?: string,
): { uri: string; symbol: SymbolEntry }[] {
  const results: { uri: string; symbol: SymbolEntry }[] = [];
  const uris = workspace.listDocumentUris();
  const searchOrder: string[] = [];
  if (currentUri && uris.includes(currentUri)) {
    searchOrder.push(currentUri);
  }
  for (const u of uris) {
    if (u !== currentUri) searchOrder.push(u);
  }
  for (const uri of searchOrder) {
    for (const symbol of workspace.findSymbolsByName(name, uri)) {
      results.push({ uri, symbol });
    }
  }
  return results;
}

export function findFeaReferences(workspace: UnifiedWorkspace, name: string): { uri: string; range: FeaSourceSpan }[] {
  const results: { uri: string; range: FeaSourceSpan }[] = [];
  for (const [uri, deck] of workspace.getAllParsedModels<FeaModelData>().entries()) {
    if (deck.materials.has(name) || deck.nodeSets.has(name) || deck.elementSets.has(name)) {
      results.push({
        uri,
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      });
    }
  }
  return results;
}

export function getFeaCompletions(workspace: UnifiedWorkspace, prefix: string, uri?: string): string[] {
  const norm = prefix.toLowerCase();
  const suggestions = new Set<string>();
  const symbols = workspace.getSymbolsForUri(uri);
  for (const sym of symbols) {
    if (sym.name.toLowerCase().startsWith(norm)) {
      suggestions.add(sym.name);
    }
  }
  return Array.from(suggestions);
}
