// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Declarative UnifiedWorkspace Indexing & Cross-File Helpers.
 *
 * Indexes OMG ReqIF 1.2 requirement models (.reqif, .reqifz): specifications,
 * requirements (SPEC-OBJECT), relations, and formal contracts across UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, SymbolIndex, UnifiedWorkspace } from "@modelscript/runtime";
import { extractReqIfzBundle, parseReqIf } from "./parser/reqif-parser.js";
import type { ReqIfDocument } from "./types.js";

function deriveReqIfNameFromUri(uri: string): string {
  const filename = uri.split("/").pop() || "requirements.reqif";
  return filename.replace(/\.(reqif|reqifz|xml)$/i, "");
}

export const reqifIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".reqif") || lower.endsWith(".reqifz")) return true;
    return Boolean(text && text.includes("<REQ-IF"));
  },

  indexFile(ctx: DslIndexFileContext): void {
    let doc: ReqIfDocument;
    try {
      doc = parseReqIf(ctx.text);
      ctx.setParsedModel(doc);
    } catch {
      return;
    }

    const specTitle = doc.header.title || deriveReqIfNameFromUri(ctx.uri);

    const rootId = ctx.addSymbol(
      specTitle,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        language: "reqif",
        reqIfVersion: doc.header.reqIfVersion,
        reqCount: doc.specObjects.size,
      },
      {
        ruleName: "reqif_specification",
        namePath: specTitle,
      },
    );

    for (const obj of doc.specObjects.values()) {
      const reqName = obj.identifier;
      ctx.addSymbol(
        reqName,
        "Class",
        rootId,
        obj.span?.startOffset ?? 0,
        obj.span?.endOffset ?? 0,
        {
          language: "reqif",
          text: obj.text,
          longName: obj.longName,
          asilLevel: obj.asilLevel,
          contract: obj.contract,
          typeRef: obj.typeRef,
        },
        {
          ruleName: "reqif_requirement",
          namePath: `${specTitle}.${reqName}`,
          aliases: obj.longName && obj.longName !== reqName ? [obj.longName] : [],
        },
      );
    }
  },
};

/**
 * Indexes a `.reqifz` ZIP bundle archive from its raw binary bytes into `UnifiedWorkspace`.
 */
export function indexReqIfArchive(workspace: UnifiedWorkspace, uri: string, data: Uint8Array): SymbolIndex | undefined {
  const bundle = extractReqIfzBundle(data);
  workspace.setDocument(uri, bundle.primaryDocument.rawXml || "", { language: "reqif" });
  return workspace.getFileIndex(uri);
}

/**
 * Searches ReqIF symbols across `UnifiedWorkspace` using case-insensitive substring matching on symbol names and aliases.
 */
export function findReqIfSymbols(workspace: UnifiedWorkspace, query: string): SymbolEntry[] {
  const results: SymbolEntry[] = [];
  const seen = new Set<SymbolId>();
  const lowerQuery = query.toLowerCase();
  const idx = workspace.getIndex();

  for (const [name, ids] of idx.byName) {
    if (name.toLowerCase().includes(lowerQuery)) {
      for (const id of ids) {
        if (seen.has(id)) continue;
        const sym = idx.symbols.get(id);
        if (sym && sym.language === "reqif") {
          seen.add(id);
          results.push(sym);
        }
      }
    }
  }
  return results;
}

/**
 * Resolves a ReqIF requirement or specification by identifier or longName, preferring `fromUri` when provided.
 */
export function resolveReqIfQualified(
  workspace: UnifiedWorkspace,
  name: string,
  fromUri?: string,
): SymbolEntry | undefined {
  if (fromUri) {
    const local = workspace.findSymbolsByName(name, fromUri)[0];
    if (local) return local;
  }
  return workspace.findSymbolsByName(name).find((s) => s.language === "reqif");
}

/**
 * Finds all `SPEC-RELATION` spans across indexed ReqIF documents referencing `symbolId`.
 */
export function findReqIfReferencesTo(
  workspace: UnifiedWorkspace,
  symbolId: SymbolId,
): { uri: string; startOffset: number; endOffset: number }[] {
  const refs: { uri: string; startOffset: number; endOffset: number }[] = [];
  const sym = workspace.getIndex().symbols.get(symbolId);
  if (!sym) return refs;

  const targetName = sym.name;
  for (const [uri, doc] of workspace.getAllParsedModels<ReqIfDocument>()) {
    if (!doc?.specRelations) continue;
    for (const rel of doc.specRelations) {
      if (rel.sourceId === targetName || rel.targetId === targetName) {
        if (rel.span?.startOffset !== undefined && rel.span?.endOffset !== undefined) {
          refs.push({
            uri,
            startOffset: rel.span.startOffset,
            endOffset: rel.span.endOffset,
          });
        }
      }
    }
  }

  return refs;
}
