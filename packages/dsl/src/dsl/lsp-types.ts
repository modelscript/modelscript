// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) request context and handler types.
 */

/**
 * Context passed to language-defined LSP custom protocol handlers.
 */
export interface LanguageRequestContext {
  uri: string;
  workspaceManager?: unknown;
  parserService?: unknown;
  sharedContext?: unknown;
  validationService?: unknown;
  connection?: unknown;
  plugin?: unknown;
  queryDB?: unknown;
  [key: string]: unknown;
}

/**
 * Custom protocol handler for language-specific JSON-RPC requests.
 */
export type LanguageProtocolHandler<TParams = unknown, TResult = unknown> = {
  bivarianceHack(context: LanguageRequestContext, params: TParams): Promise<TResult> | TResult;
}["bivarianceHack"];
