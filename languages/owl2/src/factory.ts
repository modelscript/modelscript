// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { extractIndexerHooks, extractQueryHooksMap, extractRefHooks } from "@modelscript/dsl";
import { QueryEngine, WorkspaceIndex } from "@modelscript/runtime";
import { owl2Language } from "./language.js";
import { lintOwl2Document } from "./lints.js";

const indexerHooks = extractIndexerHooks(owl2Language) ?? [];
export const queryHooks = extractQueryHooksMap(owl2Language) ?? new Map();
const refHooks = extractRefHooks(owl2Language) ?? [];

const defRuleNames = new Set(indexerHooks.map((h: any) => h.ruleName));
const refAsIndexerHooks = (refHooks ?? [])
  .filter((rh: any) => !defRuleNames.has(rh.ruleName))
  .map((rh: any) => ({
    ruleName: rh.ruleName,
    kind: "Reference",
    namePath: rh.namePath,
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  }));
const allIndexerHooks = [...indexerHooks, ...refAsIndexerHooks];

const cstByUri = new Map<string, { getRootNode: () => any; sourceText?: string | undefined }>();

const docHooks = queryHooks.get("OntologyDocument") ?? {};
docHooks["lint__owl2Document"] = (db: any, entryOrId: any) => {
  const sym = typeof entryOrId === "object" && entryOrId !== null ? entryOrId : db.symbol(entryOrId);
  if (!sym) return [];
  const symId = sym.id;
  const uri = sym.resourceId ?? sym.uri ?? "";
  const cached = cstByUri.get(uri);
  const rootNode = cached?.getRootNode?.() ?? db.cstNode(symId);
  if (!rootNode) return [];
  const sourceText =
    cached?.sourceText ?? (typeof sym.metadata?.sourceText === "string" ? sym.metadata.sourceText : undefined);
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
    startByte: d.startByte,
    endByte: d.endByte,
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
  ws.register = (uri: string, treeFn?: any, parentFQN?: string, editRanges?: any) => {
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
export function createOWL2QueryEngine(index: any, tree?: any, cacheStore?: any, maxMemos?: number): QueryEngine {
  return new QueryEngine(index, queryHooks, {
    tree,
    cacheStore,
    ...(maxMemos !== undefined && { maxMemos }),
  });
}
