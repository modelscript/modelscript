/**
 * Language Server Protocol (LSP) request context and handler types.
 */

/**
 * Context passed to language-defined LSP custom protocol handlers.
 */
export interface LanguageRequestContext {
  uri: string;
  workspaceManager?: any;
  parserService?: any;
  sharedContext?: any;
  validationService?: any;
  connection?: any;
  plugin?: any;
  queryDB?: any;
  [key: string]: any;
}

/**
 * Custom protocol handler for language-specific JSON-RPC requests.
 */
export type LanguageProtocolHandler<TParams = any, TResult = any> = (
  context: LanguageRequestContext,
  params: TParams,
) => Promise<TResult> | TResult;
