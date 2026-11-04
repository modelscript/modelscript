// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "assert";
import { readFileSync } from "fs";
import test from "node:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { ParserService } from "../src/services/parser-service.js";
import { deduplicateAllDiagnostics, ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import { computeTreeEdit } from "../src/utils/ast-utils.js";

import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

test("changing variable from x to x1 triggers lint diagnostic", async () => {
  const wasmPath = resolve(repoRoot, "languages/modelica/dist/parser.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const { parser, facade } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
  });

  const sentDiagnostics: any[] = [];
  const mockConnection: any = {
    sendDiagnostics: (params: any) => {
      sentDiagnostics.push(params);
    },
    sendNotification: () => {},
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const docsMap = new Map<string, TextDocument>();
  const mockDocs: any = {
    get: (u: string) => docsMap.get(u),
    set: (u: string, d: TextDocument) => docsMap.set(u, d),
    all: () => Array.from(docsMap.values()),
  };
  const docManager = new DocumentManager(mockDocs, () => null);
  const wm = new WorkspaceManager(docManager);
  const parserService = new ParserService(mockConnection, wm);
  parserService.registerParser("modelica", parser, facade);
  parserService.parser = parser;
  parserService.facade = facade;
  parserService.parserReady = true;

  const validationService = new ValidationService(mockConnection, docManager, wm, parserService);

  const plugin = {
    id: "modelica",
    name: "Modelica",
    extensions: [".mo", ".mos"],
    parser,
    facade,
    workspaceIndex: wm.globalWorkspaceIndex,
    disposables: [],
  };
  globalLanguageRegistry.register(plugin);

  const code1 = `model HelloWorld "Empty Workspace Starter Model"
  parameter Real a = -1.0 "Decay rate [1/s]";
  Real x(start = 1.0, fixed = true) "State variable";
equation
  der(x) = a * x;
end HelloWorld;`;

  const code2 = `model HelloWorld "Empty Workspace Starter Model"
  parameter Real a = -1.0 "Decay rate [1/s]";
  Real x(start = 1.0, fixed = true) "State variable";
equation
  der(x) = a * x1;
end HelloWorld;`;

  const uri = "file:///test/HelloWorld.mo";
  let doc = TextDocument.create(uri, "modelica", 1, code1);
  docManager.documents.set(uri, doc);

  // 1. Initial open
  await validationService.validateTextDocument(doc);
  const initialPromise = validationService.activeValidationPromises.get(uri);
  if (initialPromise) await initialPromise;

  console.log("After initial open, sentDiagnostics count:", sentDiagnostics.length);
  const lastAfterOpen = sentDiagnostics[sentDiagnostics.length - 1];
  console.log("Initial diagnostics:", lastAfterOpen.diagnostics);
  assert.strictEqual(lastAfterOpen.diagnostics.length, 0);

  // 2. Simulate onDidChangeContent as done in browserServerMain / nodeServerMain: x -> x1
  const currentRevision = (validationService.documentRevisions.get(uri) ?? 0) + 1;
  validationService.documentRevisions.set(uri, currentRevision);

  // Update doc text
  doc = TextDocument.create(uri, "modelica", 2, code2);
  docManager.documents.set(uri, doc);

  const oldCached = docManager.documentTrees.get(uri);
  const edit = computeTreeEdit(oldCached!.text, code2);
  validationService.adjustDiagnostics(uri, edit);
  const tree = parser.parse(code2, oldCached!.tree, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, uri);
  docManager.documentTrees.set(uri, { text: code2, tree, classCache: new Map() });

  // Tier 1 in serverMain
  const { syntaxDiags, wasmLintDiags } = validationService.collectSyntaxErrors(tree.rootNode, doc, plugin as any);
  assert.strictEqual(syntaxDiags.length, 0, "Syntax diags should be empty since syntax is valid");
  assert(wasmLintDiags.length > 0, "wasmLintDiags should contain Undeclared Variable lint");

  const wasmLspDiags = validationService.convertWasmLintDiagnostics(wasmLintDiags, doc, plugin as any, code2);
  const fastDiags = deduplicateAllDiagnostics([...syntaxDiags, ...wasmLspDiags]);
  assert.strictEqual(fastDiags.length, 1, "Expected 1 fast diagnostic for x1");
  assert.strictEqual(fastDiags[0].code, 2002);
  assert.strictEqual(fastDiags[0].message, "Variable 'x1' not found in scope.");
  assert.strictEqual(fastDiags[0].range.start.line, 4);

  // Now Tier 3 fires after debounce
  await validationService.validateTextDocument(doc);
  const tier3Promise = validationService.activeValidationPromises.get(uri);
  if (tier3Promise) await tier3Promise;

  const finalDiags = sentDiagnostics[sentDiagnostics.length - 1];
  assert(finalDiags, "Expected diagnostics to be sent");
  const varDiag = finalDiags.diagnostics.find(
    (d: any) => d.code === 2002 || (typeof d.message === "string" && d.message.includes("'x1'")),
  );
  assert(
    varDiag,
    `Expected diagnostic for undeclared variable x1, got: ${JSON.stringify(finalDiags.diagnostics, null, 2)}`,
  );

  // 3. Revert back from x1 -> x
  const rev3 = (validationService.documentRevisions.get(uri) ?? 0) + 1;
  validationService.documentRevisions.set(uri, rev3);

  doc = TextDocument.create(uri, "modelica", 3, code1);
  docManager.documents.set(uri, doc);

  const cachedBeforeRevert = docManager.documentTrees.get(uri);
  const editRevert = computeTreeEdit(cachedBeforeRevert!.text, code1);
  validationService.adjustDiagnostics(uri, editRevert);
  const treeRevert = parser.parse(
    code1,
    cachedBeforeRevert!.tree,
    editRevert.startIndex,
    editRevert.oldEndIndex,
    editRevert.newEndIndex,
    uri,
  );
  docManager.documentTrees.set(uri, { text: code1, tree: treeRevert, classCache: new Map() });

  // Tier 1 on revert
  const { syntaxDiags: synRev, wasmLintDiags: lintRev } = validationService.collectSyntaxErrors(
    treeRevert.rootNode,
    doc,
    plugin as any,
  );
  const wasmLspRev = validationService.convertWasmLintDiagnostics(lintRev, doc, plugin as any, code1);
  const fastDiagsRev = deduplicateAllDiagnostics([...synRev, ...wasmLspRev]);
  assert.strictEqual(fastDiagsRev.length, 0, "Fast diagnostics should immediately be empty on revert");

  // Tier 3 on revert
  await validationService.validateTextDocument(doc);
  const revertPromise = validationService.activeValidationPromises.get(uri);
  if (revertPromise) await revertPromise;

  const afterRevertDiags = sentDiagnostics[sentDiagnostics.length - 1];
  assert.strictEqual(
    afterRevertDiags.diagnostics.length,
    0,
    `Expected 0 diagnostics after reverting to valid variable x, got: ${JSON.stringify(afterRevertDiags.diagnostics, null, 2)}`,
  );
});
