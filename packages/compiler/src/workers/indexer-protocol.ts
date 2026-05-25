import type { SymbolEntry } from "../runtime.js";

export interface IndexerBatchRequest {
  type: "INDEX_BATCH";
  batchId: number;
  serverDistBase: string; // Needed to load tree-sitter WASM
  files: {
    uri: string;
    text: string;
    parentFQN?: string;
  }[];
}

export interface IndexerBatchResponse {
  type: "INDEX_RESULT";
  batchId: number;
  results: {
    uri: string;
    // Maps converted to arrays for structured cloning
    symbols: [number, SymbolEntry][];
    byName: [string, number[]][];
    childrenOf: [number | null, number[]][];
  }[];
}

export interface IndexerBatchError {
  type: "INDEX_ERROR";
  batchId: number;
  error: string;
}

export type IndexerWorkerMessage = IndexerBatchRequest;
export type IndexerMainMessage = IndexerBatchResponse | IndexerBatchError;
