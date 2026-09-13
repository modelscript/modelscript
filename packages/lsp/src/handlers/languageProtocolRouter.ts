// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageRequestContext } from "@modelscript/dsl";
import type { LspContext } from "../LspContext.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

/**
 * Dispatches a custom JSON-RPC request to the language-specific handler registered for the document URI.
 */
export async function dispatchLanguageRequest<T = any>(
  context: LspContext,
  method: string,
  uri: string,
  params: any,
  fallback?: T,
): Promise<T> {
  const handler = globalLanguageRegistry.getHandlerForUri(uri, method);
  if (!handler) {
    if (fallback !== undefined) return fallback;
    throw new Error(`[lsp] Method '${method}' is not supported for URI '${uri}'`);
  }

  const reqContext: LanguageRequestContext = {
    uri,
    connection: context.connection,
    workspaceManager: context.workspaceManager,
    documentManager: context.documentManager,
    validationService: context.validationService,
    parserService: context.parserService,
    diagramService: context.diagramService,
    sharedContext: context.parserService.sharedContext ?? context.state.sharedContext,
    plugin: globalLanguageRegistry.getPluginForUri(uri),
  };

  try {
    return await handler(reqContext, params);
  } catch (e: any) {
    context.connection.console.error(`[lsp] Error executing '${method}' for '${uri}': ${e?.message ?? e}`);
    throw e;
  }
}
