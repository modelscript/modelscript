// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSTTree } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { cadComponentsCache, diagramPreviewSvgCache } from "../src/handlers/diagramHandler.js";
import { iconCache } from "../src/handlers/treeHandler.js";
import type { LSPBridge } from "../src/lsp-bridge.js";
import { DiagramService } from "../src/services/diagram-service.js";
import { DocumentManager } from "../src/services/document-manager.js";
import type { ParserService } from "../src/services/parser-service.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

function createMockConnection(): Connection {
  return {
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    },
    sendNotification: () => {},
    sendDiagnostics: () => {},
    sendRequest: () => Promise.resolve(undefined),
  } as unknown as Connection;
}

function createMockDocuments(initial: TextDocument[] = []): {
  docs: TextDocuments<TextDocument>;
  map: Map<string, TextDocument>;
} {
  const map = new Map<string, TextDocument>();
  for (const d of initial) map.set(d.uri, d);
  const docs = {
    get: (uri: string) => map.get(uri),
    all: () => Array.from(map.values()),
  } as unknown as TextDocuments<TextDocument>;
  return { docs, map };
}

describe("LSP cache bounds, disposal, and PositionIndex caching", () => {
  it("ValidationService.disposeDocument cleans up documentLSPBridges and daeVerificationCache", () => {
    const conn = createMockConnection();
    const { docs } = createMockDocuments();
    const docMgr = new DocumentManager(
      docs,
      () => ({ getText: () => null, getNode: () => null }) as unknown as CSTTree,
    );
    const wsMgr = new WorkspaceManager(docMgr);
    const parserSvc = {} as unknown as ParserService;
    const valSvc = new ValidationService(conn, docMgr, wsMgr, parserSvc);

    const uri = "file:///workspace/TestModel.mo";
    const otherUri = "file:///workspace/OtherModel.mo";
    const dummyBridge = {} as unknown as LSPBridge;

    valSvc.documentLSPBridges.set(uri, dummyBridge);
    valSvc.documentLSPBridges.set(otherUri, dummyBridge);

    const internalDaeCache = (
      valSvc as unknown as { daeVerificationCache: Map<string, { fingerprint: string; record: unknown }> }
    ).daeVerificationCache;
    internalDaeCache.set(`${uri}#TestModel`, { fingerprint: "fp1", record: {} });
    internalDaeCache.set(`${otherUri}#OtherModel`, { fingerprint: "fp2", record: {} });

    valSvc.disposeDocument(uri);

    assert.equal(valSvc.documentLSPBridges.has(uri), false);
    assert.equal(valSvc.documentLSPBridges.has(otherUri), true);
    assert.equal(internalDaeCache.has(`${uri}#TestModel`), false);
    assert.equal(internalDaeCache.has(`${otherUri}#OtherModel`), true);
  });

  it("DiagramService manages diagramCache, wires invalidation without globalThis, deletes per-URI, and enforces max size", () => {
    const conn = createMockConnection();
    const { docs } = createMockDocuments();
    const docMgr = new DocumentManager(
      docs,
      () => ({ getText: () => null, getNode: () => null }) as unknown as CSTTree,
    );
    const wsMgr = new WorkspaceManager(docMgr);
    const valSvc = new ValidationService(conn, docMgr, wsMgr);
    const diagramSvc = new DiagramService(conn, docMgr, wsMgr, valSvc);

    const cache = diagramSvc.getDiagramCache();

    const uriA = "file:///workspace/A.mo";
    const uriB = "file:///workspace/B.mo";
    cache.set(`${uriA}|A|All`, { version: "v1", data: { nodes: [] } });
    cache.set(`pscad:${uriA}:Main`, { version: "v1", data: { nodes: [] } });
    cache.set(`${uriB}|B|All`, { version: "v1", data: { nodes: [] } });

    diagramSvc.deleteCacheForUri(uriA);
    assert.equal(cache.has(`${uriA}|A|All`), false);
    assert.equal(cache.has(`pscad:${uriA}:Main`), false);
    assert.equal(cache.has(`${uriB}|B|All`), true);

    // Clearing via DiagramService (or ValidationService dependency-load hook) clears the owned cache directly
    diagramSvc.clearCache();
    assert.equal(cache.size, 0);

    // Verify bounded cache insertion via private helper
    const setEntry = (
      diagramSvc as unknown as {
        setDiagramCacheEntry: (k: string, v: { version: string; data: null }) => void;
      }
    ).setDiagramCacheEntry.bind(diagramSvc);
    for (let i = 0; i < 250; i++) {
      setEntry(`file:///m${i}.mo|M${i}|All`, { version: "v1", data: null });
    }
    assert.equal(cache.size, 200);
    assert.equal(cache.has("file:///m0.mo|M0|All"), false);
    assert.equal(cache.has("file:///m249.mo|M249|All"), true);
  });

  it("WorkspaceManager.disposeDocument cleans up threadMetadataMap entries for closed URI", () => {
    const { docs } = createMockDocuments();
    const docMgr = new DocumentManager(
      docs,
      () => ({ getText: () => null, getNode: () => null }) as unknown as CSTTree,
    );
    const wsMgr = new WorkspaceManager(docMgr);

    const uri = "file:///workspace/Sys.sysml";
    const otherUri = "file:///workspace/Other.sysml";
    wsMgr.threadMetadataMap.set("slot1:Sys", {
      uri,
      elementName: "Sys",
      domain: "sysml2",
      slot: 1,
    });
    wsMgr.threadMetadataMap.set("slot2:Other", {
      uri: otherUri,
      elementName: "Other",
      domain: "sysml2",
      slot: 2,
    });

    wsMgr.disposeDocument(uri);

    assert.equal(wsMgr.threadMetadataMap.has("slot1:Sys"), false);
    assert.equal(wsMgr.threadMetadataMap.has("slot2:Other"), true);
  });

  it("DocumentManager.getLineIndexForDoc caches PositionIndex per document version and tree text", () => {
    const uri = "file:///workspace/Cached.mo";
    const docV1 = TextDocument.create(uri, "modelica", 1, "model A\n  Real x;\nend A;\n");
    const { docs, map } = createMockDocuments([docV1]);
    const docMgr = new DocumentManager(
      docs,
      () => ({ getText: () => null, getNode: () => null }) as unknown as CSTTree,
    );

    // Open document with a DocumentTreeEntry
    docMgr.documentTrees.set(uri, { text: docV1.getText(), tree: null });
    const idx1 = docMgr.getLineIndexForDoc(uri);
    const idx2 = docMgr.getLineIndexForDoc(uri);
    assert.ok(idx1 !== null);
    assert.strictEqual(idx1, idx2);

    // Updating document version invalidates cached PositionIndex
    const docV2 = TextDocument.create(uri, "modelica", 2, "model A\n  Real x;\n  Real y;\nend A;\n");
    map.set(uri, docV2);
    const idx3 = docMgr.getLineIndexForDoc(uri);
    assert.ok(idx3 !== null);
    assert.notStrictEqual(idx3, idx1);
    assert.strictEqual(docMgr.getLineIndexForDoc(uri), idx3);

    // Closed document falls back to documentTrees/lazyLibTrees and caches by text
    map.delete(uri);
    const closedIdx1 = docMgr.getLineIndexForDoc(uri);
    const closedIdx2 = docMgr.getLineIndexForDoc(uri);
    assert.ok(closedIdx1 !== null);
    assert.strictEqual(closedIdx1, closedIdx2);
  });

  it("Handler caches enforce size bounds", () => {
    cadComponentsCache.clear();
    for (let i = 0; i < 230; i++) {
      cadComponentsCache.set(`file:///cad${i}.mo`, { version: "v1", data: [] });
    }
    assert.equal(cadComponentsCache.size, 200);
    cadComponentsCache.clear();

    diagramPreviewSvgCache.clear();
    for (let i = 0; i < 280; i++) {
      diagramPreviewSvgCache.set(`k${i}`, { svg: "<svg/>", nodeCount: 1, edgeCount: 0 });
    }
    assert.equal(diagramPreviewSvgCache.size, 250);
    diagramPreviewSvgCache.clear();

    iconCache.clear();
    for (let i = 0; i < 550; i++) {
      iconCache.set(`Modelica.Pkg.C${i}`, "<svg/>");
    }
    assert.equal(iconCache.size, 500);
    iconCache.clear();
  });
});
