import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "assert";
import { readFileSync } from "fs";
import test from "node:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";
import { DocumentManager } from "../src/services/DocumentManager.js";
import { ParserService } from "../src/services/ParserService.js";
import { ValidationService } from "../src/services/ValidationService.js";
import { WorkspaceManager } from "../src/services/WorkspaceManager.js";

import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

test("surfaces undefined variable reference in equations before flattening", async () => {
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

  globalLanguageRegistry.register({
    id: "modelica",
    name: "Modelica",
    extensions: [".mo", ".mos"],
    parser,
    facade,
    workspaceIndex: wm.globalWorkspaceIndex,
    disposables: [],
  });

  const code = `model BouncingBall "A bouncing ball"
  parameter Real e1 = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity";
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;`;

  const uri = "file:///test/BouncingBall.mo";
  const doc = TextDocument.create(uri, "modelica", 1, code);
  docManager.documents.set(uri, doc);

  await validationService.validateTextDocument(doc);

  // Wait for any active validation promises
  const activePromise = validationService.activeValidationPromises.get(uri);
  if (activePromise) {
    await activePromise;
  }

  const lastDiags = sentDiagnostics[sentDiagnostics.length - 1];
  assert(lastDiags, "Expected diagnostics to be sent");
  assert.strictEqual(lastDiags.uri, uri);

  // Look for VARIABLE_NOT_FOUND (2002) on line 9 (1-indexed line 10)
  const varDiag = lastDiags.diagnostics.find(
    (d: any) => d.code === 2002 || (typeof d.message === "string" && d.message.includes("'e'")),
  );

  assert(
    varDiag,
    `Expected diagnostic with code 2002 for variable 'e', got: ${JSON.stringify(lastDiags.diagnostics, null, 2)}`,
  );
  assert.strictEqual(varDiag.range.start.line, 9, "Expected diagnostic on line 10 (0-indexed 9)");
  assert.strictEqual(varDiag.severity, DiagnosticSeverity.Error, "Expected Error severity");
  assert(varDiag.message.includes("'e'"), `Expected message to mention 'e', got: ${varDiag.message}`);
});
