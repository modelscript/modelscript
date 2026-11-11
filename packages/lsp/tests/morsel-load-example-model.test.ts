// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import * as modelicaDiagramOps from "@modelscript/modelica/diagram";
import { AnnotationEvaluator, clearIconCache } from "@modelscript/modelica/diagram";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import { FIELD_NAMES as modelicaFieldNames, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as path from "node:path";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerClassQueryEndpoints } from "../src/handlers/classqueryEndpoints.js";
import { registerMiscEndpoints } from "../src/handlers/miscEndpoints.js";
import { registerTreeHandlers } from "../src/handlers/treeHandler.js";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";
import { DiagramService } from "../src/services/diagram-service.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { ParserService } from "../src/services/parser-service.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { BrowserFileSystem } from "../src/vfs/browser-file-system.js";
import { CURATED_PACKAGE_FALLBACKS } from "../src/vfs/curated-package-fallbacks.js";
import { loadMSL, loadRegistryPackage } from "../src/vfs/library-loader.js";

const require = createRequire(import.meta.url);

test("Morsel double-click example simulation model: fast standalone extraction, validation, and diagram without freezes", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const latestDiags = new Map<string, any[]>();
  const consoleErrors: string[] = [];

  const connection: any = {
    onRequest: (method: string, fn: any) => handlers.set(method, fn),
    onNotification: () => {},
    sendNotification: () => {},
    sendDiagnostics: (p: any) => latestDiags.set(p.uri, p.diagnostics ?? []),
    console: {
      info: () => {},
      log: () => {},
      warn: () => {},
      error: (m: string) => consoleErrors.push(m),
      debug: () => {},
    },
  };

  const docMap = new Map<string, TextDocument>();
  const documents: any = {
    get: (uri: string) => docMap.get(uri),
    all: () => Array.from(docMap.values()),
    keys: () => Array.from(docMap.keys()),
  };

  (globalThis as any).injectPredefinedTypes = injectPredefinedTypes;
  (globalThis as any).clearIconCache = clearIconCache;
  (globalThis as any).createModelicaQueryEngine = createModelicaQueryEngine;
  (globalThis as any).create_modelica_query_engine = createModelicaQueryEngine;
  (globalThis as any).AnnotationEvaluator = AnnotationEvaluator;
  (globalThis as any).create_modelica_workspace_index = createModelicaWorkspaceIndex;
  (globalThis as any).createModelicaWorkspaceIndex = createModelicaWorkspaceIndex;
  (globalThis as any).modelicaDiagramOps = modelicaDiagramOps;
  (globalThis as any).modelicaSyntaxNames = modelicaSyntaxNames;
  (globalThis as any).modelicaFieldNames = modelicaFieldNames;
  (globalThis as any).documents = documents;

  const sharedFs = new BrowserFileSystem();
  (globalThis as any).sharedFs = sharedFs;

  const documentManager = new DocumentManager(documents, () => parserService.getSharedCstTreeWrapper());
  const workspaceManager = new WorkspaceManager(documentManager);
  const parserService = new ParserService(connection, documentManager, workspaceManager, documents);
  const validationService = new ValidationService(connection, documentManager, workspaceManager, parserService);
  validationService.daeVerificationBudgetMs = 150;

  const diagramService = new DiagramService(
    connection,
    documentManager,
    workspaceManager,
    validationService,
    parserService,
    { modelicaDiagramOps },
  );

  registerBuiltinLanguagePlugins({ workspaceManager, parserService, connection });

  // 1. Regression check: WorkspaceManager.getWorkspaceIndex must not mutually recurse with builtin-plugins getters
  for (const plugin of globalLanguageRegistry.getAllPlugins()) {
    assert.doesNotThrow(() => {
      workspaceManager.getWorkspaceIndex(plugin.id);
      void plugin.workspaceIndex;
    }, `getWorkspaceIndex('${plugin.id}') must not throw stack overflow`);
  }

  const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
  const { parser, facade } = await createWasmParser(wasmPath, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: modelicaFieldNames,
  });
  parserService.registerParser("modelica", parser, facade);
  workspaceManager.unifiedWorkspace.registerParser(".mo", parser);
  workspaceManager.unifiedWorkspace.registerLanguageExtension(".mo", "modelica");
  (parserService as any).ensureSharedContext();
  const loaderCtx = (parserService as any).getOrCreateLoaderContext();

  const context: any = {
    connection,
    documents,
    documentManager,
    workspaceManager,
    parserService,
    validationService,
    diagramService,
    state: {
      get sharedContext() {
        return parserService.sharedContext;
      },
      get parser() {
        return parserService.parser;
      },
      get parserReady() {
        return parserService.parserReady;
      },
      get facade() {
        return parserService.facade;
      },
    },
  };

  registerTreeHandlers(context);
  registerClassQueryEndpoints(context);
  registerMiscEndpoints(context);

  const getClassSource = handlers.get("modelscript/getClassSource")!;
  const parseEndpoint = handlers.get("modelscript/parse")!;

  // 2. modelscript/parse must work even before any validateTextDocument populates documentContexts
  const earlyParsed = await parseEndpoint({ code: "model EarlyCheck\n  Real x;\nend EarlyCheck;" });
  assert.deepStrictEqual(earlyParsed.classes, [{ name: "EarlyCheck", kind: "model" }]);
  assert.deepStrictEqual(earlyParsed.syntaxErrors, []);

  // 3. Invalid synthetic tree container IDs must be rejected cleanly
  const syntheticRes = await getClassSource({ className: "__LIB__:Modelica" });
  assert.strictEqual(syntheticRes.content, null);

  const scriptsDir = path.resolve(process.cwd(), "scripts");
  await loadMSL(scriptsDir, loaderCtx, "4.1.0");
  validationService.markDependencyLoaded("Modelica", "4.1.0");

  for (const pkgName of ["IEEE-Test-Feeders", "PSSE-Standard-Dynamics"]) {
    const curated = CURATED_PACKAGE_FALLBACKS[pkgName]!;
    await loadRegistryPackage(
      {
        name: curated.packageName,
        version: curated.version,
        files: curated.files,
        modelscript: { languages: [curated.language] },
      },
      loaderCtx,
    );
  }

  const cases = [
    {
      fqn: "Modelica.Electrical.Analog.Examples.ChuaCircuit",
      shortName: "ChuaCircuit",
      maxBytes: 10_000,
      minDiagramNodes: 5,
    },
    {
      fqn: "Modelica.Blocks.Examples.PID_Controller",
      shortName: "PID_Controller",
      // Must extract standalone model (~8 KB) instead of returning 152 KB Blocks/package.mo!
      maxBytes: 15_000,
      minDiagramNodes: 5,
    },
    {
      fqn: "Modelica.Mechanics.MultiBody.Examples.Elementary.DoublePendulum",
      shortName: "DoublePendulum",
      maxBytes: 10_000,
      minDiagramNodes: 4,
    },
    {
      fqn: "IEEEFeeders.IEEE13Node",
      shortName: "IEEE13Node",
      maxBytes: 2_000,
      minDiagramNodes: 0,
    },
    {
      fqn: "PSSEDynamics.GENROU",
      shortName: "GENROU",
      maxBytes: 2_000,
      minDiagramNodes: 0,
    },
  ];

  let version = 1;
  const docUri = "file:///document.mo";

  for (const tc of cases) {
    const srcRes = await getClassSource({ className: tc.fqn });
    assert.ok(srcRes?.content, `Expected getClassSource content for ${tc.fqn}`);
    assert.ok(
      srcRes.content.length <= tc.maxBytes,
      `Expected ${tc.fqn} extracted source <= ${tc.maxBytes}B, got ${srcRes.content.length}B`,
    );

    const parsed = await parseEndpoint({ code: srcRes.content });
    assert.ok(
      parsed.classes.some((c: any) => c.name === tc.shortName),
      `Expected parsed classes of ${tc.fqn} to include ${tc.shortName}, got ${JSON.stringify(parsed.classes)}`,
    );

    docMap.set(docUri, TextDocument.create(docUri, "modelica", ++version, srcRes.content));
    const tValStart = performance.now();
    await validationService.validateTextDocument(docMap.get(docUri)!);
    const activeProm = validationService.activeValidationPromises.get(docUri);
    if (activeProm) await activeProm;
    const valElapsedMs = performance.now() - tValStart;

    assert.ok(
      valElapsedMs < 5000,
      `Validation of ${tc.fqn} must not freeze LSP worker (took ${valElapsedMs.toFixed(1)}ms)`,
    );

    const diag = await diagramService.handleGetDiagramData({
      uri: docUri,
      className: tc.shortName,
      diagramType: "diagram",
      documentText: srcRes.content,
    });
    assert.ok(
      (diag?.nodes?.length ?? 0) >= tc.minDiagramNodes,
      `Expected >= ${tc.minDiagramNodes} diagram nodes for ${tc.fqn}, got ${diag?.nodes?.length ?? 0}`,
    );
  }

  assert.ok(
    !consoleErrors.some((msg) => msg.includes("Maximum call stack size exceeded")),
    `Expected zero stack overflow errors, got: ${consoleErrors.join("; ")}`,
  );
});
