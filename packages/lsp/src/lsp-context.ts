// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagramService } from "./services/diagram-service.js";
import { DocumentManager } from "./services/document-manager.js";
import { ParserService } from "./services/parser-service.js";
import { ValidationService } from "./services/validation-service.js";
import { WorkspaceManager } from "./services/workspace-manager.js";

/**
 * Shared server-wide dependency injection context passed to LSP request handlers and providers.
 *
 * Aggregates core LSP connection handles, document/workspace managers, language services,
 * and mutable per-document state caches.
 */
export interface LspContext {
  /** Active JSON-RPC connection to the LSP client (Node stdio/IPC or Browser worker). */
  connection: Connection;
  /** Synchronized text document manager tracking open editor buffers. */
  documents: TextDocuments<TextDocument>;
  /** Polyglot workspace index and digital thread hypergraph coordinator. */
  workspaceManager: WorkspaceManager;
  /** CST parse tree and line index cache manager for open and lazy-loaded documents. */
  documentManager: DocumentManager;
  /** Multi-tier syntax, CST lint, Salsa query, and formal verification diagnostic service. */
  validationService: ValidationService;
  /** WebAssembly GLR parser registry and lifecycle service. */
  parserService: ParserService;
  /** Polyglot schematic, SysML v2, OWL2, and PSCAD diagram generation service. */
  diagramService: DiagramService;

  /** Mutable server state shared across loosely coupled handlers and notifications. */
  state: {
    /** In-flight asynchronous validation promises keyed by document URI. */
    activeValidationPromises: Map<string, Promise<void>>;
    /** Shared Modelica compiler context instance when initialized. */
    sharedContext: any | null;
    /** Cache of resolved class/symbol definitions keyed by fully qualified name (FQN). */
    fqnCache: Map<string, unknown>;
    /** Secondary index mapping FQN prefixes or segments to cached symbol entries. */
    fqnCacheIndex: Map<string, unknown>;
    /** Monotonically increasing edit revision counters per document URI for staleness checks. */
    documentRevisions: Map<string, number>;
    /** Per-document {@link LSPBridge} instances mapping symbol indices to LSP locations. */
    documentLSPBridges: Map<string, unknown>;
    /** Most recent semantic diagnostics per document URI, preserved across fast Tier-1 keystroke parses. */
    lastSemanticDiagnostics: Map<string, unknown[]>;
    /** Whether all declared external package/library dependencies have finished loading. */
    dependenciesReady: boolean;
  };
}
