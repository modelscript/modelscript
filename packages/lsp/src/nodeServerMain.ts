// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { clearIconCache } from "@modelscript/modelica/diagram";
import modelicaLangFallback from "@modelscript/modelica/language";
import owl2LangFallback from "@modelscript/owl2/language";
import { StepWorkspaceIndex } from "@modelscript/step";
import sysml2LangFallback from "@modelscript/sysml2/language";
import { createRequire } from "node:module";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createConnection,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  ServerCapabilities,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { registerPolyglotEndpoints } from "./handlers/polyglotEndpoints.js";
import { registerCompletionProvider } from "./providers/completionProvider.js";
import { registerDefinitionProvider } from "./providers/definitionProvider.js";
import { registerDocumentFeaturesProvider } from "./providers/documentFeaturesProvider.js";
import { registerHoverProvider } from "./providers/hoverProvider.js";
import { globalLanguageRegistry } from "./registry/LanguageRegistry.js";
import { DiagramService } from "./services/DiagramService.js";
import { DocumentManager } from "./services/DocumentManager.js";
import { HierarchyService } from "./services/HierarchyService.js";
import { ParserService } from "./services/ParserService.js";
import { ValidationService } from "./services/ValidationService.js";
import { WorkspaceManager } from "./services/WorkspaceManager.js";

/**
 * Starts a headless Language Server Protocol server over Node.js standard I/O or IPC.
 */
export function startNodeServer() {
  globalThis.clearIconCache = clearIconCache;

  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
  const workspaceManager = new WorkspaceManager(documentManager);
  const parserService = new ParserService(connection, documentManager, workspaceManager, documents);
  const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
  const hierarchyService = new HierarchyService(connection, documentManager, workspaceManager);
  const diagramService = new DiagramService(connection, documentManager, workspaceManager);

  // Register built-in workspaces
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "modelica",
    workspaceManager.globalWorkspaceIndex,
    modelicaLangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace(
    "sysml2",
    workspaceManager.sysml2WorkspaceIndex,
    sysml2LangFallback,
  );
  workspaceManager.unifiedWorkspace.registerWorkspace("owl2", workspaceManager.owl2WorkspaceIndex, owl2LangFallback);
  workspaceManager.stepWorkspaceIndex = new StepWorkspaceIndex();
  workspaceManager.unifiedWorkspace.registerWorkspace("step", workspaceManager.stepWorkspaceIndex, { priority: 2 });

  // Initialize built-in WASM parsers
  const require = createRequire(import.meta.url);
  try {
    const modelicaWasm = require.resolve("@modelscript/modelica/parser.wasm");
    createWasmParser(modelicaWasm)
      .then(({ parser, facade }) => {
        parserService.parser = parser;
        parserService.parserReady = true;
        globalLanguageRegistry.register({
          id: "modelica",
          name: "Modelica",
          extensions: [".mo"],
          parser,
          facade,
          disposables: [],
        });
      })
      .catch((err) => {
        connection.console.warn(`[NodeServer] Could not load Modelica WASM parser: ${err.message}`);
      });
  } catch {
    // Modelica WASM resolution optional in decoupled environments
  }

  try {
    const sysmlWasm = require.resolve("@modelscript/sysml2/parser.wasm");
    createWasmParser(sysmlWasm)
      .then(({ parser, facade }) => {
        parserService.sysml2Parser = parser;
        parserService.sysml2ParserReady = true;
        globalLanguageRegistry.register({
          id: "sysml2",
          name: "SysML v2",
          extensions: [".sysml"],
          parser,
          facade,
          disposables: [],
        });
      })
      .catch((err) => {
        connection.console.warn(`[NodeServer] Could not load SysML2 WASM parser: ${err.message}`);
      });
  } catch {
    // SysML2 WASM resolution optional in decoupled environments
  }

  // 1. Connection lifecycle handlers
  connection.onInitialize((_params: InitializeParams): InitializeResult => {
    const capabilities: ServerCapabilities = {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [".", ":", "$", "@"],
      },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
    };

    return { capabilities };
  });

  connection.onInitialized(() => {
    connection.console.info("ModelScript Node.js Language Server initialized.");
  });

  // 2. Document events & validation
  documents.onDidOpen(async (e) => {
    await validationService.validateTextDocument(e.document);
  });

  documents.onDidChangeContent(async (change) => {
    await validationService.validateTextDocument(change.document);
  });

  documents.onDidClose((e) => {
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  // 3. Register Language Feature Providers
  registerCompletionProvider(connection, documents, validationService.documentLSPBridges);

  registerHoverProvider(connection, documents, validationService);

  registerDefinitionProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    documentManager.documentTrees,
  );

  registerDocumentFeaturesProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    parserService.getLineIndexForDoc.bind(parserService),
    () => parserService.parserReady,
    () => parserService.sysml2ParserReady,
    () => parserService.sysml2Parser,
  );

  // 4. Register Dynamic Polyglot Endpoints
  registerPolyglotEndpoints(connection, documents, validationService, documentManager, workspaceManager);

  // Listen on the document manager and connection
  documents.listen(connection);
  connection.listen();

  return { connection, documents, workspaceManager, parserService };
}

// Auto-start if executed directly via node
if (process.argv[1] && process.argv[1].endsWith("nodeServerMain.js")) {
  startNodeServer();
}
