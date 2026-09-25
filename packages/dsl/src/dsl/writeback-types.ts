// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Context provided to a language-specific writeback handler.
 */
export interface WritebackContext {
  /** The symbol entry being updated (from the workspace symbol index) */
  entry: any;
  /** Full source code text of the document */
  fullText: string;
  /** The new value string to write */
  newValue: string;
  /** Optional parsed CST/AST root node if available */
  rootCst?: any;
  /** Optional Salsa query engine or workspace index */
  queryEngine?: any;
  /** Document URI */
  uri?: string;
}

/**
 * Byte-range patch replacement representing the source code edit.
 * Returning byte ranges allows zero-overhead integration with WebAssembly linear memory
 * and avoids coupling to IDE/LSP line-column structures.
 */
export interface WritebackEdit {
  /** Start byte offset in the document */
  startByte: number;
  /** End byte offset in the document */
  endByte: number;
  /** Replacement text to insert across [startByte, endByte] */
  newText: string;
}

/**
 * Custom writeback handler function signature.
 * Returns either a single WritebackEdit, an array of WritebackEdits, or null/undefined if unable to handle.
 */
export type WritebackHandler = (context: WritebackContext) => WritebackEdit | WritebackEdit[] | null | undefined;

/**
 * First-class Bi-Directional Writeback configuration for a language.
 */
export interface WritebackConfig {
  /**
   * Declarative name of the CST field holding the value/initializer expression
   * (e.g. 'value', 'expression', 'initializer', 'defaultValue').
   */
  valueField?: string;
  /**
   * Declarative assignment operators recognized in this language (e.g. ['=', ':=']).
   */
  operators?: string[];
  /**
   * Custom writeback handler function implemented by the language package.
   */
  handler?: WritebackHandler;
}
