// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge module connecting polyglot-generated SysML2 artifacts to
// the LSP pipeline. Mirrors packages/core/src/compiler/modelica/metascript-bridge.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { LSPBridge, PositionIndex } from "@modelscript/polyglot/lsp-bridge";
import { QueryEngine } from "@modelscript/polyglot/query-engine";
import { ScopeResolver } from "@modelscript/polyglot/resolver";
import { WorkspaceIndex } from "@modelscript/polyglot/workspace-index";

import { INDEXER_HOOKS } from "@modelscript/sysml2-polyglot/indexer_config";
import { QUERY_HOOKS } from "@modelscript/sysml2-polyglot/query_hooks";
import { REF_HOOKS } from "@modelscript/sysml2-polyglot/ref_config";

const indexerHooks = INDEXER_HOOKS ?? (globalThis as any).__sysml2IndexerHooksFallback;
const queryHooks = QUERY_HOOKS ?? (globalThis as any).__sysml2QueryHooksFallback;
const refHooks = REF_HOOKS ?? (globalThis as any).__sysml2RefHooksFallback;

/**
 * Creates a configured WorkspaceIndex for SysML2.
 */
export function createSysML2WorkspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex(indexerHooks);
}

/**
 * Creates a configured QueryEngine for a given SysML2 SymbolIndex.
 */
export function createSysML2QueryEngine(index: any): QueryEngine {
  return new QueryEngine(index, queryHooks);
}

/**
 * Creates a configured ScopeResolver for a given SysML2 SymbolIndex.
 */
export function createSysML2ScopeResolver(index: any): ScopeResolver {
  return new ScopeResolver(index, refHooks, indexerHooks);
}

/**
 * Creates an LSPBridge for a specific SysML2 document.
 */
export function createSysML2LSPBridge(
  index: any,
  engine: any,
  resolver: any,
  sourceText: string,
  documentUri: string,
): LSPBridge {
  return new LSPBridge(index, engine, resolver, new PositionIndex(sourceText), documentUri);
}
