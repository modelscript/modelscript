// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry, type LanguagePlugin } from "../src/registry/LanguageRegistry.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { ParserService } from "../src/services/parser-service.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";
import {
  isLargeXmlForWasm,
  isWasmTreeActiveInFacade,
  parseTreeWithXmlGuard,
  XML_WASM_BYTE_LIMIT,
} from "../src/utils/ast-utils.js";

function makeDummyConnection() {
  return {
    console: { log() {}, warn() {}, error() {}, info() {} },
    sendDiagnostics() {},
    sendNotification() {},
    onRequest() {},
    onNotification() {},
  } as any;
}

describe("Large XML (>2 MiB) Option-B CST Fallback Guard (@modelscript/lsp)", () => {
  it("routes >2 MiB XML documents to Option-B streaming CST without calling WASM parser or facade pointers", () => {
    let wasmParseCalls = 0;
    let facadeDiagCalls = 0;

    const spyPlugin: LanguagePlugin = {
      id: "xml-guard-test",
      name: "XML Guard Test",
      extensions: [".arxml"],
      parser: {
        parse(text: string) {
          wasmParseCalls++;
          return {
            rootPtr: 123,
            rootNode: {
              id: 123,
              type: "Document",
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: text.length },
              startIndex: 0,
              endIndex: text.length,
              hasError: () => false,
              isMissing: false,
              children: [],
            },
            delete() {},
          };
        },
      },
      facade: {
        lastAstRoot: 123,
        getDiagnostics() {
          facadeDiagCalls++;
          return [];
        },
      },
    };
    globalLanguageRegistry.register(spyPlugin);

    const conn = makeDummyConnection();
    const docMgr = new DocumentManager();
    const wsMgr = new WorkspaceManager(conn, docMgr, {
      scheduleBackgroundValidation() {},
    });
    const docs = new Map<string, TextDocument>();
    const parserSvc = new ParserService(conn, docMgr, wsMgr, docs as any);
    const valSvc = new ValidationService(conn, docMgr, parserSvc, wsMgr);

    // 1. Small XML (< 2 MiB) still enters the Option-B WASM parser
    const smallXml = `<?xml version="1.0"?><AUTOSAR><SHORT-NAME>Tiny</SHORT-NAME></AUTOSAR>`;
    assert.equal(isLargeXmlForWasm("file:///small.arxml", smallXml, spyPlugin), false);
    const smallTree = parserSvc.updateDocumentTree("file:///small.arxml", smallXml);
    assert.equal(wasmParseCalls, 1);
    assert.equal(isWasmTreeActiveInFacade(smallTree, spyPlugin.facade as any), true);

    // 2. Large XML (> 2 MiB) skips WASM parser and builds Option-B streaming XmlCstTree
    const chunk = `<SHORT-NAME>${"A".repeat(1000)}</SHORT-NAME>\n`;
    const repeatCount = Math.ceil((XML_WASM_BYTE_LIMIT + 4096) / chunk.length);
    const largeXml = `<?xml version="1.0"?><AUTOSAR>\n${chunk.repeat(repeatCount)}</AUTOSAR>`;
    assert.equal(isLargeXmlForWasm("file:///huge.arxml", largeXml, spyPlugin), true);

    const textDoc = TextDocument.create("file:///huge.arxml", "autosar", 1, largeXml);
    docs.set("file:///huge.arxml", textDoc);
    const largeTree = parserSvc.updateDocumentTree("file:///huge.arxml", largeXml);
    assert.equal(wasmParseCalls, 1, "WASM parser must NOT be called for >2 MiB XML");
    assert.equal(isWasmTreeActiveInFacade(largeTree, spyPlugin.facade as any), false);
    assert.equal(largeTree.rootNode.type, "AUTOSAR");

    // Re-fetching from cache via getDocumentTree must reuse the fallback tree in O(1)
    const cachedAgain = parserSvc.getDocumentTree("file:///huge.arxml");
    assert.equal(cachedAgain, largeTree);
    assert.equal(wasmParseCalls, 1);

    // Running collectSyntaxErrors on fallback tree must NOT dereference synthetic node.id in WASM facade
    const { syntaxDiags } = valSvc.collectSyntaxErrors(largeTree.rootNode, textDoc, spyPlugin);
    assert.equal(facadeDiagCalls, 0, "WASM facade.getDiagnostics must NOT be called on fallback tree");
    assert.equal(syntaxDiags.length, 0);

    // parseTreeWithXmlGuard also bypasses WASM incremental reparse and surfaces XML syntax errors on malformed >2 MiB XML
    const malformedLarge = `${largeXml.slice(0, -10)}<!-- unclosed`;
    const malformedTree = parseTreeWithXmlGuard({
      uri: "file:///huge.arxml",
      text: malformedLarge,
      plugin: spyPlugin,
      parser: spyPlugin.parser,
      oldCached: { text: largeXml, tree: largeTree },
    });
    assert.equal(wasmParseCalls, 1);
    const malformedDoc = TextDocument.create("file:///huge.arxml", "autosar", 2, malformedLarge);
    const malformedRes = valSvc.collectSyntaxErrors(malformedTree.rootNode, malformedDoc, spyPlugin);
    assert.equal(facadeDiagCalls, 0);
    assert.ok(malformedRes.syntaxDiags.length > 0, "Malformed >2 MiB XML should surface Option-B XML syntax errors");
  });

  it("does not trigger XML fallback on large non-XML Modelica sources", () => {
    const line = "  Modelica.Electrical.Analog.Basic.Resistor R(R=100);\n";
    const bigModelica = `model Huge\n${line.repeat(Math.ceil((XML_WASM_BYTE_LIMIT + 4096) / line.length))}end Huge;\n`;
    assert.equal(isLargeXmlForWasm("file:///Huge.mo", bigModelica, null), false);
  });

  it("routes small .oadr.xml under non-XML Option-A plugins to Option-B XML CST while parsing .oadr via Option-A parser", () => {
    let wasmParseCalls = 0;
    const oadrPlugin: LanguagePlugin = {
      id: "openadr",
      name: "OpenADR",
      extensions: [".oadr", ".oadr.xml"],
      languageDef: {
        name: "openadr",
        rules: {
          Document: () => "doc",
        },
      } as any,
      parser: {
        parse(text: string) {
          wasmParseCalls++;
          return {
            rootPtr: 77,
            rootNode: {
              id: 77,
              type: "Document",
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: text.length },
              startIndex: 0,
              endIndex: text.length,
              hasError: () => false,
              isMissing: false,
              children: [],
            },
            delete() {},
          };
        },
      } as any,
    };

    const xmlText = `<oadrDistributeEvent><eiEvent><eventID>EVT-1</eventID></eiEvent></oadrDistributeEvent>`;
    const xmlTree = parseTreeWithXmlGuard({
      uri: "file:///event.oadr.xml",
      text: xmlText,
      plugin: oadrPlugin,
      parser: oadrPlugin.parser,
    });
    assert.equal(wasmParseCalls, 0, ".oadr.xml must bypass Option-A WASM parser");
    assert.equal(xmlTree.__isXmlCstFallback, true);
    assert.equal(xmlTree.rootNode.type, "oadrDistributeEvent");

    const dslText = `program "P1" {\n  event "E1" {\n    status: "active"\n  }\n}\n`;
    const dslTree = parseTreeWithXmlGuard({
      uri: "file:///program.oadr",
      text: dslText,
      plugin: oadrPlugin,
      parser: oadrPlugin.parser,
    });
    assert.equal(wasmParseCalls, 1, "declarative .oadr must use Option-A WASM parser");
    assert.equal(dslTree.__isXmlCstFallback, undefined);
    assert.equal(dslTree.rootNode.type, "Document");
  });

  it("routes multi-format extensions (.oscal, .xtce, .feb) starting with '<' to Option-B XML CST without touching JSON/KVN/DSL", () => {
    let wasmParseCalls = 0;
    const makeMultiPlugin = (id: string, extensions: string[]): LanguagePlugin => ({
      id,
      name: id,
      extensions,
      languageDef: { name: id, rules: { Root: () => id } } as any,
      parser: {
        parse(text: string) {
          wasmParseCalls++;
          return {
            rootPtr: 99,
            rootNode: {
              id: 99,
              type: "Root",
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: text.length },
              startIndex: 0,
              endIndex: text.length,
              hasError: () => false,
              isMissing: false,
              children: [],
            },
            delete() {},
          };
        },
      } as any,
    });

    const oscalPlugin = makeMultiPlugin("oscal", [".oscal", ".oscal.json", ".oscal.xml"]);
    const oscalXml = parseTreeWithXmlGuard({
      uri: "file:///ssp.oscal",
      text: `<system-security-plan id="ssp-1"></system-security-plan>`,
      plugin: oscalPlugin,
      parser: oscalPlugin.parser,
    });
    assert.equal(wasmParseCalls, 0);
    assert.equal(oscalXml.__isXmlCstFallback, true);
    assert.equal(oscalXml.rootNode.type, "system-security-plan");

    const oscalJson = parseTreeWithXmlGuard({
      uri: "file:///ssp.oscal",
      text: `{"system-security-plan":{"uuid":"1"}}`,
      plugin: oscalPlugin,
      parser: oscalPlugin.parser,
    });
    assert.equal(wasmParseCalls, 1);
    assert.equal(oscalJson.__isXmlCstFallback, undefined);

    const febioPlugin = makeMultiPlugin("febio", [".feb", ".scn"]);
    const febioXml = parseTreeWithXmlGuard({
      uri: "file:///model.feb",
      text: `<febio_spec version="4.0"></febio_spec>`,
      plugin: febioPlugin,
      parser: febioPlugin.parser,
    });
    assert.equal(wasmParseCalls, 1);
    assert.equal(febioXml.__isXmlCstFallback, true);

    const febioDsl = parseTreeWithXmlGuard({
      uri: "file:///model.feb",
      text: `material m1 type=neo-Hookean\n`,
      plugin: febioPlugin,
      parser: febioPlugin.parser,
    });
    assert.equal(wasmParseCalls, 2);
    assert.equal(febioDsl.__isXmlCstFallback, undefined);

    const ccsdsPlugin = makeMultiPlugin("ccsds", [".oem", ".xtce"]);
    const xtceXml = parseTreeWithXmlGuard({
      uri: "file:///sat.xtce",
      text: `<SpaceSystem name="Sat"></SpaceSystem>`,
      plugin: ccsdsPlugin,
      parser: ccsdsPlugin.parser,
    });
    assert.equal(wasmParseCalls, 2);
    assert.equal(xtceXml.__isXmlCstFallback, true);

    const oemKvn = parseTreeWithXmlGuard({
      uri: "file:///orbit.oem",
      text: `CCSDS_OEM_VERS = 3.0\n`,
      plugin: ccsdsPlugin,
      parser: ccsdsPlugin.parser,
    });
    assert.equal(wasmParseCalls, 3);
    assert.equal(oemKvn.__isXmlCstFallback, undefined);
  });
});
