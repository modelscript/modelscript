// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractIndexerHooks, extractQueryHooksMap, extractRefHooks } from "@modelscript/dsl";
import {
  QueryEngine,
  WorkspaceIndex,
  type CSTTree,
  type EditRange,
  type QueryCacheStore,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "@modelscript/runtime";
import type { GenericSyntaxNode } from "./cst-lowering.js";
import { owl2Language } from "./language.js";
import { lintOwl2Document } from "./lints.js";

const indexerHooks = extractIndexerHooks(owl2Language) ?? [];
export const queryHooks = extractQueryHooksMap(owl2Language) ?? new Map();
const refHooks = extractRefHooks(owl2Language) ?? [];

const defRuleNames = new Set(indexerHooks.map((h) => h.ruleName));
const refAsIndexerHooks = (refHooks ?? [])
  .filter((rh) => !defRuleNames.has(rh.ruleName))
  .map((rh) => ({
    ruleName: rh.ruleName,
    kind: "Reference",
    namePath: rh.namePath,
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  }));
const allIndexerHooks = [...indexerHooks, ...refAsIndexerHooks];

const cstByUri = new Map<
  string,
  { getRootNode: () => GenericSyntaxNode | null | undefined; sourceText?: string | undefined }
>();

const docHooks = queryHooks.get("OntologyDocument") ?? {};
docHooks["lint__owl2Document"] = (db: QueryDB, entryOrId: SymbolEntry | SymbolId) => {
  const sym = typeof entryOrId === "object" && entryOrId !== null ? entryOrId : db.symbol(entryOrId);
  if (!sym) return [];
  const symId = sym.id;
  const uri = sym.resourceId ?? sym.documentUri ?? "";
  const cached = cstByUri.get(uri);
  const rootNode = (cached?.getRootNode?.() ?? db.cstNode(symId)) as GenericSyntaxNode | null | undefined;
  if (!rootNode) return [];
  const sourceText =
    cached?.sourceText ?? (typeof sym.metadata?.["sourceText"] === "string" ? sym.metadata["sourceText"] : undefined);
  const diags = lintOwl2Document(rootNode, sourceText);
  return diags.map((d) => ({
    severity: d.severity,
    lintName: d.rule,
    rule: d.rule,
    code: `O${d.code}`,
    message: d.message,
    symbolId: symId,
    resourceId: uri,
    startOffset: d.startOffset,
    endOffset: d.endOffset,
    uri,
  }));
};
queryHooks.set("OntologyDocument", docHooks);

/**
 * Creates a configured WorkspaceIndex for OWL2.
 */
export function createOWL2WorkspaceIndex(): WorkspaceIndex {
  const ws = new WorkspaceIndex(allIndexerHooks);
  const origRegister = ws.register.bind(ws);
  ws.register = (
    uri: string,
    treeFn?: (() => GenericSyntaxNode | null | undefined) | GenericSyntaxNode | null,
    parentFQN?: string,
    editRanges?: EditRange[],
  ) => {
    const getRootNode = typeof treeFn === "function" ? treeFn : () => treeFn;
    cstByUri.set(uri, { getRootNode });
    const fileId = origRegister(uri, getRootNode, parentFQN, editRanges);
    ws.getFileIndex?.(uri);
    return fileId;
  };
  return ws;
}

/**
 * Creates a configured QueryEngine for a given OWL2 SymbolIndex.
 */
export function createOWL2QueryEngine(
  index: SymbolIndex,
  tree?: CSTTree,
  cacheStore?: QueryCacheStore,
  maxMemos?: number,
): QueryEngine {
  return new QueryEngine(index, queryHooks, {
    tree,
    cacheStore,
    ...(maxMemos !== undefined && { maxMemos }),
  });
}
