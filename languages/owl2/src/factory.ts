// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { extractIndexerHooks, extractQueryHooksMap, extractRefHooks } from "@modelscript/dsl";
import { QueryEngine, WorkspaceIndex } from "@modelscript/runtime";
import { owl2Language } from "./language.js";

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

/**
 * Creates a configured WorkspaceIndex for OWL2.
 */
export function createOWL2WorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(allIndexerHooks);
}

/**
 * Creates a configured QueryEngine for a given OWL2 SymbolIndex.
 */
export function createOWL2QueryEngine(index: any, tree?: any, cacheStore?: any, maxMemos?: number): QueryEngine {
  return new QueryEngine(index, queryHooks, { tree, cacheStore, ...(maxMemos !== undefined && { maxMemos }) });
}
