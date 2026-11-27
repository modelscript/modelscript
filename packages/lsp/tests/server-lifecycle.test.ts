// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSTTree } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Connection, Diagnostic, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CadMetricsService } from "../src/services/cad-metrics-service.js";
import { DiagramService } from "../src/services/diagram-service.js";
import { DocumentManager } from "../src/services/document-manager.js";
import type { ParserService } from "../src/services/parser-service.js";
import {
  createDocumentLifecycleTimers,
  createFlattenArenaFromInstance,
  createOnDidChangeContentHandler,
  createOnDidCloseHandler,
  isCrossDomainPeer,
  simpleHash,
} from "../src/services/server-lifecycle.js";
import { ValidationService } from "../src/services/validation-service.js";
import type { WorkspaceManager } from "../src/services/workspace-manager.js";

function createMockConnection(sentDiagnostics: Array<{ uri: string; diagnostics: Diagnostic[] }> = []): Connection {
  return {
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    },
    sendNotification: () => {},
    sendDiagnostics: (params: { uri: string; diagnostics: Diagnostic[] }) => {
      sentDiagnostics.push(params);
    },
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

function createMockParserService(removedUris: string[] = []): ParserService {
  return {
    getParserForUri: () => undefined,
    isParserReady: () => false,
    getParser: () => undefined,
    getFacade: () => ({
      removeDocument: (uri: string) => {
        removedUris.push(uri);
      },
    }),
  } as unknown as ParserService;
}

function createMockWorkspaceManager(disposedUris: string[] = []): WorkspaceManager {
  return {
    globalModelicaQueryEngine: null,
    getThreadsForUri: () => [],
    findAlignedElementsBySlot: () => [],
    disposeDocument: (uri: string) => {
      disposedUris.push(uri);
    },
    hypergraph: {
      markStale: () => {},
    },
    unifiedWorkspace: {
      setDocumentTree: () => {},
      getDocument: () => undefined,
    },
  } as unknown as WorkspaceManager;
}

describe("server-lifecycle shared helpers", () => {
  it("simpleHash computes deterministic unsigned 32-bit DJB2 hashes", () => {
    assert.equal(simpleHash(""), 5381);
    assert.equal(simpleHash("hello"), 261238937);
    assert.equal(
      simpleHash("Modelica.Blocks.Continuous.Integrator"),
      simpleHash("Modelica.Blocks.Continuous.Integrator"),
    );
    assert.notEqual(simpleHash("ModelA"), simpleHash("ModelB"));
    assert.ok(simpleHash("unicode-\u2603-test") >= 0);
  });

  it("createFlattenArenaFromInstance validates class name and query engine presence", () => {
    const wsMgr = createMockWorkspaceManager();
    const flatten = createFlattenArenaFromInstance(wsMgr);

    assert.throws(() => flatten({ id: 1 }), /Class instance has no name/);
    assert.throws(() => flatten({ id: 1, name: "TestModel" }), /Query engine not initialized/);
  });

  it("isCrossDomainPeer identifies cross-domain language pairs", () => {
    assert.equal(isCrossDomainPeer("modelica", "sysml2"), true);
    assert.equal(isCrossDomainPeer("sysml", "modelica"), true);
    assert.equal(isCrossDomainPeer("psse", "pscad"), true);
    assert.equal(isCrossDomainPeer("pscad", "psse"), true);
    assert.equal(isCrossDomainPeer("modelica", "csv"), false);
  });

  it("createOnDidCloseHandler clears timers, disposes services, removes trees, and revalidates peers", () => {
    const closedUri = "file:///workspace/Closed.mo";
    const sameLangDoc = TextDocument.create(
      "file:///workspace/SameLang.mo",
      "modelica",
      1,
      "model SameLang end SameLang;",
    );
    const peerLangDoc = TextDocument.create("file:///workspace/Peer.sysml", "sysml2", 1, "package Peer {}");
    const unrelatedDoc = TextDocument.create("file:///workspace/Data.csv", "csv", 1, "a,b\n1,2\n");
    const closedDoc = TextDocument.create(closedUri, "modelica", 1, "model Closed end Closed;");

    const sentDiagnostics: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
    const removedFacadeUris: string[] = [];
    const disposedWsUris: string[] = [];
    const conn = createMockConnection(sentDiagnostics);
    const { docs } = createMockDocuments([sameLangDoc, peerLangDoc, unrelatedDoc]);
    const docMgr = new DocumentManager(
      docs,
      () => ({ getText: () => null, getNode: () => null }) as unknown as CSTTree,
    );
    const wsMgr = createMockWorkspaceManager(disposedWsUris);
    const parserSvc = createMockParserService(removedFacadeUris);
    const valSvc = new ValidationService(conn, docMgr, wsMgr, parserSvc);
    const diagramSvc = new DiagramService(conn, docMgr, wsMgr);
    const cadMetricsSvc = new CadMetricsService();
    const timers = createDocumentLifecycleTimers();

    // Seed timers and caches
    let timerFired = false;
    timers.activeSemanticTimers.set(
      closedUri,
      setTimeout(() => {
        timerFired = true;
      }, 5000),
    );
    timers.activeSyntaxDebounceTimers.set(
      closedUri,
      setTimeout(() => {
        timerFired = true;
      }, 5000),
    );
    timers.activeShortDebounceTimers.set(
      closedUri,
      setTimeout(() => {
        timerFired = true;
      }, 5000),
    );
    timers.lastSyntaxErrorsCount.set(closedUri, 3);

    let treeDeleted = false;
    let treeFacadeRemoved = false;
    docMgr.documentTrees.set(closedUri, {
      text: closedDoc.getText(),
      tree: {
        delete: () => {
          treeDeleted = true;
        },
        facade: {
          removeDocument: () => {
            treeFacadeRemoved = true;
          },
        },
      } as unknown as NonNullable<ReturnType<typeof docMgr.documentTrees.get>>["tree"],
    });

    diagramSvc.getDiagramCache().set(`${closedUri}|Closed|All`, { version: "1", data: {} });

    const revalidatedUris: string[] = [];
    valSvc.validateTextDocument = async (doc: TextDocument) => {
      revalidatedUris.push(doc.uri);
    };

    const onDidClose = createOnDidCloseHandler({
      connection: conn,
      documents: docs,
      documentManager: docMgr,
      workspaceManager: wsMgr,
      parserService: parserSvc,
      validationService: valSvc,
      diagramService: diagramSvc,
      cadMetricsService: cadMetricsSvc,
      timers,
    });

    onDidClose({ document: closedDoc });

    assert.equal(timerFired, false);
    assert.equal(timers.activeSemanticTimers.has(closedUri), false);
    assert.equal(timers.activeSyntaxDebounceTimers.has(closedUri), false);
    assert.equal(timers.activeShortDebounceTimers.has(closedUri), false);
    assert.equal(timers.lastSyntaxErrorsCount.has(closedUri), false);
    assert.equal(treeDeleted, true);
    assert.equal(treeFacadeRemoved, true);
    assert.equal(docMgr.documentTrees.has(closedUri), false);
    assert.equal(diagramSvc.getDiagramCache().has(`${closedUri}|Closed|All`), false);
    assert.deepEqual(disposedWsUris, [closedUri]);
    assert.deepEqual(removedFacadeUris, [closedUri]);
    assert.deepEqual(sentDiagnostics, [{ uri: closedUri, diagnostics: [] }]);
    assert.deepEqual(revalidatedUris.sort(), [peerLangDoc.uri, sameLangDoc.uri].sort());
  });

  it("createOnDidChangeContentHandler debounces Tier 3 validation by debounceMs and cancels stale revisions", async () => {
    const uri = "file:///workspace/Debounce.mo";
    const docV1 = TextDocument.create(uri, "modelica", 1, "model D Real x; end D;");
    const docV2 = TextDocument.create(uri, "modelica", 2, "model D Real x = 1; end D;");

    const conn = createMockConnection();
    const { docs, map } = createMockDocuments([docV1]);
    const docMgr = new DocumentManager(
      docs,
      () => ({ getText: () => null, getNode: () => null }) as unknown as CSTTree,
    );
    const wsMgr = createMockWorkspaceManager();
    const parserSvc = createMockParserService();
    const valSvc = new ValidationService(conn, docMgr, wsMgr, parserSvc);
    const timers = createDocumentLifecycleTimers();

    // Stub Tier 2 diagram sync so it does not run heavy work
    valSvc.syncDocumentForDiagram = async () => false;

    const validatedVersions: number[] = [];
    valSvc.validateTextDocument = async (doc: TextDocument) => {
      validatedVersions.push(doc.version);
    };

    const onDidChangeContent = createOnDidChangeContentHandler({
      connection: conn,
      documents: docs,
      documentManager: docMgr,
      workspaceManager: wsMgr,
      parserService: parserSvc,
      validationService: valSvc,
      timers,
      debounceMs: 40,
    });

    onDidChangeContent({ document: docV1 });
    assert.equal(valSvc.documentRevisions.get(uri), 1);

    // Rapid second edit before 40ms elapses should cancel v1 and schedule v2
    await new Promise((r) => setTimeout(r, 15));
    map.set(uri, docV2);
    onDidChangeContent({ document: docV2 });
    assert.equal(valSvc.documentRevisions.get(uri), 2);

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 80));

    assert.deepEqual(validatedVersions, [2]);
    assert.equal(valSvc.activeValidationTimers.has(uri), false);

    // Clean up any remaining Tier 2 timer
    const shortTimer = timers.activeShortDebounceTimers.get(uri);
    if (shortTimer) clearTimeout(shortTimer);
  });
});
