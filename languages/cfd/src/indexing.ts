// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseCfdConfig } from "./dialects/index.js";
import type { CfdModelData } from "./types.js";

export interface CfdSourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Predicate to disambiguate CFD configuration files (.cfd, .cfg, .cfgt, .su2, .foam) from generic .cfg files.
 */
export function canIndexCfd(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".cfd") || lower.endsWith(".cfgt") || lower.endsWith(".su2") || lower.endsWith(".foam")) {
    return true;
  }
  if (lower.endsWith(".cfg")) {
    if (!text) return true;
    return /\b(?:PHYSICAL_PROBLEM|MATH_PROBLEM|SOLVER|MACH_NUMBER|REYNOLDS_NUMBER|MARKER_|MESH_FILENAME|FoamFile)\b/.test(
      text,
    );
  }
  return Boolean(text && /\bFoamFile\b/.test(text));
}

/**
 * Declarative file indexer for Computational Fluid Dynamics (SU2, OpenFOAM) decks.
 */
export function indexCfdDocument(ctx: DslIndexFileContext): void {
  const addSym = (parentId: SymbolId | null, name: string, kind: string): SymbolId =>
    ctx.addSymbol(name, kind, parentId, 0, 0, {}, { ruleName: "cfd_entity" });

  try {
    const ext = ctx.uri.split(".").pop() ?? "su2";
    const config = parseCfdConfig(ctx.text, ext);
    ctx.setParsedModel<CfdModelData>(config);

    const rootName = config.mathProblem || (config.meshFilename ? `CFD:${config.meshFilename}` : "CFD Case");
    const rootId = addSym(null, rootName, "model");

    // Index markers
    for (const [markerName, marker] of config.markers.entries()) {
      addSym(rootId, markerName, `marker:${marker.type.toLowerCase()}`);
    }

    // Index key aerodynamic/flow parameters
    if (config.machNumber !== undefined) {
      addSym(rootId, `Mach_${config.machNumber}`, "parameter");
    }
    if (config.reynoldsNumber !== undefined) {
      addSym(rootId, `Re_${config.reynoldsNumber}`, "parameter");
    }
    if (config.aoa !== undefined) {
      addSym(rootId, `AoA_${config.aoa}`, "parameter");
    }
    if (config.meshFilename) {
      addSym(rootId, config.meshFilename, "file");
    }
  } catch {
    // Retain partial symbol index on malformed CFD deck
  }
}

/**
 * Retrieves the parsed `CfdModelData` stored in `UnifiedWorkspace` for `uri`.
 */
export function getCfdConfig(workspace: UnifiedWorkspace, uri: string): CfdModelData | undefined {
  return workspace.getParsedModel<CfdModelData>(uri);
}

/**
 * Finds CFD symbol definitions matching `name`, prioritizing `currentUri` when supplied.
 */
export function findCfdDefinition(
  workspace: UnifiedWorkspace,
  name: string,
  currentUri?: string,
): { uri: string; symbol: SymbolEntry }[] {
  const results: { uri: string; symbol: SymbolEntry }[] = [];
  const searchOrder: string[] = [];
  const uris = workspace.listDocumentUris();

  if (currentUri && uris.includes(currentUri)) {
    searchOrder.push(currentUri);
  }
  for (const uri of uris) {
    if (uri !== currentUri) {
      searchOrder.push(uri);
    }
  }

  for (const uri of searchOrder) {
    for (const sym of workspace.findSymbolsByName(name, uri)) {
      results.push({ uri, symbol: sym });
    }
  }

  return results;
}

/**
 * Finds CFD marker/directive references matching `name` across indexed CFD configurations.
 */
export function findCfdReferences(workspace: UnifiedWorkspace, name: string): { uri: string; range: CfdSourceSpan }[] {
  const results: { uri: string; range: CfdSourceSpan }[] = [];
  for (const [uri, config] of workspace.getAllParsedModels<CfdModelData>().entries()) {
    if (config.markers.has(name) || config.directives.has(name)) {
      results.push({
        uri,
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      });
    }
  }
  return results;
}

/**
 * Provides prefix-matched symbol completions from `workspace` (optionally scoped to `uri`).
 */
export function getCfdCompletions(workspace: UnifiedWorkspace, prefix: string, uri?: string): string[] {
  const norm = prefix.toLowerCase();
  const suggestions = new Set<string>();

  for (const sym of workspace.getSymbolsForUri(uri)) {
    if (sym.name.toLowerCase().startsWith(norm)) {
      suggestions.add(sym.name);
    }
  }

  return Array.from(suggestions);
}
