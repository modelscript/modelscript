// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { clearIconCache } from "@modelscript/modelica/diagram";
import modelicaLangFallback from "@modelscript/modelica/language";
import owl2LangFallback from "@modelscript/owl2/language";
import { StepWorkspaceIndex } from "@modelscript/step";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
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
import { registerActionRouter } from "./handlers/actionRouter.js";
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

import { ArenaQueryFlattener, deriveSimplification } from "@modelscript/modelica";
import { ArenaScriptInterpreter } from "@modelscript/modelica/arena-script-interpreter";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import { extractSysML2Constraints, mapConstraintsToOptimizer } from "@modelscript/sysml2/constraint-extractor";
import * as sysml2DiagramOps from "@modelscript/sysml2/diagram";
import {
  buildSysML2DiagramData,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
} from "@modelscript/sysml2/factory";

/**
 * Starts a headless Language Server Protocol server over Node.js standard I/O or IPC.
 */
export function startNodeServer() {
  globalThis.clearIconCache = clearIconCache;
  (globalThis as any).create_modelica_workspace_index = createModelicaWorkspaceIndex;
  (globalThis as any).create_sysml2_workspace_index = createSysML2WorkspaceIndex;
  (globalThis as any).create_modelica_query_engine = createModelicaQueryEngine;
  (globalThis as any).create_sysml2_query_engine = createSysML2QueryEngine;
  (globalThis as any).createModelicaQueryEngine = createModelicaQueryEngine;
  (globalThis as any).createSysML2QueryEngine = createSysML2QueryEngine;
  (globalThis as any).injectPredefinedTypes = injectPredefinedTypes;
  (globalThis as any).modelicaDiagramOps = modelicaDiagramOps;
  (globalThis as any).sysml2DiagramOps = { ...sysml2DiagramOps, buildSysML2DiagramData };
  (globalThis as any).extractSysML2Constraints = extractSysML2Constraints;
  (globalThis as any).mapConstraintsToOptimizer = mapConstraintsToOptimizer;
  (globalThis as any).ArenaScriptInterpreter = ArenaScriptInterpreter;
  (globalThis as any).ArenaQueryFlattener = ArenaQueryFlattener;
  (globalThis as any).deriveSimplification = deriveSimplification;

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
  const builtInPkgs = [
    { id: "modelica", pkg: "@modelscript/modelica", name: "Modelica", ext: [".mo"] },
    { id: "sysml2", pkg: "@modelscript/sysml2", name: "SysML v2", ext: [".sysml", ".sysml2"] },
    { id: "step", pkg: "@modelscript/step", name: "STEP", ext: [".step", ".stp", ".p21"] },
    { id: "owl2", pkg: "@modelscript/owl2", name: "OWL2", ext: [".owl2", ".ofn", ".ttl"] },
    { id: "csv", pkg: "@modelscript/csv", name: "CSV", ext: [".csv"] },
    { id: "scad", pkg: "@modelscript/scad", name: "OpenSCAD", ext: [".scad"] },
  ];

  for (const item of builtInPkgs) {
    try {
      let wasmPath: string | undefined;
      try {
        wasmPath = require.resolve(`${item.pkg}/parser.wasm`);
      } catch {
        try {
          wasmPath = require.resolve(`${item.pkg}/dist/parser.wasm`);
        } catch {}
      }
      if (wasmPath) {
        createWasmParser(wasmPath)
          .then(({ parser, facade }) => {
            parserService.registerParser(item.id, parser, facade);
            if (item.id === "modelica") {
              parserService.parser = parser;
              (globalThis as any).modelicaParser = parser;
              parserService.parserReady = true;
            } else if (item.id === "sysml2") {
              parserService.sysml2Parser = parser;
              parserService.sysml2ParserReady = true;
            }
            globalLanguageRegistry.register({
              id: item.id,
              name: item.name,
              extensions: item.ext,
              parser,
              facade,
              disposables: [],
            });
          })
          .catch((err) => {
            connection.console.warn(`[NodeServer] Could not load ${item.name} WASM parser: ${err.message}`);
          });
      }
    } catch {
      // Optional in decoupled environments
    }
  }

  // Helper to load user languages from registry directory (~/.modelscript/languages/)
  function getUserLanguagesDir(): string {
    if (process.env.MODELSCRIPT_LANGUAGES_DIR) {
      return path.resolve(process.env.MODELSCRIPT_LANGUAGES_DIR);
    }
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(home, ".modelscript", "languages");
  }

  async function loadUserRegisteredLanguages(): Promise<void> {
    const regDir = getUserLanguagesDir();
    const regPath = path.join(regDir, "registry.json");
    if (!fs.existsSync(regPath)) return;

    try {
      const catalog = JSON.parse(fs.readFileSync(regPath, "utf-8"));
      const languages = catalog.languages || {};

      for (const [id, entry] of Object.entries<any>(languages)) {
        if (globalLanguageRegistry.getPluginById(id)) continue;

        let wasmPath = entry.wasmPath;
        if (!wasmPath || !fs.existsSync(wasmPath)) {
          const langDir = path.join(regDir, id);
          const candidates = [
            path.join(langDir, "parser.wasm"),
            path.join(langDir, "dist", "parser.wasm"),
            path.join(langDir, `${id}.wasm`),
          ];
          wasmPath = candidates.find(fs.existsSync);
        }

        if (wasmPath && fs.existsSync(wasmPath)) {
          try {
            const { parser, facade } = await createWasmParser(wasmPath);
            parserService.registerParser(id, parser, facade);
            globalLanguageRegistry.register({
              id,
              name: entry.name || id,
              extensions: entry.extensions || [`.${id}`],
              parser,
              facade,
              disposables: [],
            });
            connection.console.info(`[NodeServer] Loaded custom language '${id}' from ${wasmPath}`);
          } catch (err: any) {
            connection.console.warn(`[NodeServer] Failed to load custom language '${id}': ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      connection.console.warn(`[NodeServer] Failed to read user languages registry: ${err.message}`);
    }
  }

  loadUserRegisteredLanguages().catch(() => {});

  const userLanguagesDir = getUserLanguagesDir();
  if (fs.existsSync(userLanguagesDir)) {
    try {
      fs.watch(userLanguagesDir, async (_eventType, filename) => {
        if (filename === "registry.json") {
          connection.console.info(`[NodeServer] User languages registry changed, reloading...`);
          await loadUserRegisteredLanguages();
          connection.sendNotification("modelscript/status", {
            state: "ready",
            message: "ModelScript (Languages Updated)",
          });
        }
      });
    } catch {}
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
    validationService,
  );

  // 4. Register Dynamic Polyglot Endpoints and Actions
  registerPolyglotEndpoints(connection, documents, validationService, documentManager, workspaceManager);
  registerActionRouter({
    connection,
    documents,
    validationService,
    documentManager,
    workspaceManager,
    parserService,
    diagramService,
    state: {},
  } as any);

  // Listen on the document manager and connection
  documents.listen(connection);
  connection.listen();

  return { connection, documents, workspaceManager, parserService };
}

// Auto-start if executed directly via node
if (process.argv[1] && process.argv[1].endsWith("nodeServerMain.js")) {
  startNodeServer();
}
