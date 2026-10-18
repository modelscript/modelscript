// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "@modelscript/runtime";

/**
 * Message payload sent from the main LSP thread to a background indexer worker
 * to parse and extract symbols from a batch of source files.
 */
export interface IndexerBatchRequest {
  /** Discriminant message type for batch indexing requests. */
  type: "INDEX_BATCH";
  /** Unique numeric identifier for correlating the batch response. */
  batchId: number;
  /** Base URL or filesystem path to the server distribution directory for loading WASM binaries. */
  serverDistBase: string; // Needed to load tree-sitter WASM
  /** Optional map of language IDs to custom `parser.wasm` URLs. */
  wasmUrls?: Record<string, string> | undefined;
  /** Optional serialized indexer hooks for custom DSL symbol extraction. */
  hooks?: any[] | undefined;
  /** Array of source files to parse and index in this batch. */
  files: {
    /** Document URI of the file being indexed. */
    uri: string;
    /** Full UTF-8 source text of the file. */
    text: string;
    /** Optional enclosing package FQN derived from `package.mo` hierarchy. */
    parentFQN?: string | undefined;
  }[];
}

/**
 * Successful batch indexing response sent from an indexer worker back to the main thread.
 */
export interface IndexerBatchResponse {
  /** Discriminant message type for successful batch indexing results. */
  type: "INDEX_RESULT";
  /** Batch identifier matching the originating {@link IndexerBatchRequest.batchId}. */
  batchId: number;
  /** Per-file extracted symbol tables serialized as entry arrays for structured cloning. */
  results: {
    /** Document URI of the indexed file. */
    uri: string;
    // Maps converted to arrays for structured cloning
    /** Flattened entries of `[SymbolId, SymbolEntry]` pairs. */
    symbols: [number, SymbolEntry][];
    /** Flattened entries of `[symbolName, SymbolId[]]` lookup pairs. */
    byName: [string, number[]][];
    /** Flattened entries of `[parentSymbolId | null, childSymbolId[]]` hierarchy pairs. */
    childrenOf: [number | null, number[]][];
  }[];
}

/**
 * Error response sent from an indexer worker if batch processing fails.
 */
export interface IndexerBatchError {
  /** Discriminant message type for batch indexing errors. */
  type: "INDEX_ERROR";
  /** Batch identifier matching the originating {@link IndexerBatchRequest.batchId}. */
  batchId: number;
  /** Human-readable error message describing the failure. */
  error: string;
}

/** Union of all message types sent from the main thread to an indexer worker. */
export type IndexerWorkerMessage = IndexerBatchRequest;
/** Union of all message types sent from an indexer worker back to the main thread. */
export type IndexerMainMessage = IndexerBatchResponse | IndexerBatchError;
