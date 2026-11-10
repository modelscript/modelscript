// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { registerMiscEndpoints } from "../src/handlers/miscEndpoints.js";
import { LSPBridge, PositionIndex } from "../src/lsp-bridge.js";

test("LSPBridge: constructor argument disambiguation", () => {
  const dummyIndex: any = { symbols: new Map(), byName: new Map(), childrenOf: new Map() };
  const dummyEngine: any = { query: () => null };
  const sampleText = "line 0\nline 1\nline 2\n";
  const pos = new PositionIndex(sampleText);
  const uri = "file:///test.mo";
  const env: any = { documentLSPBridges: new Map() };

  // 1. 4-arg signature: (index, engine, positions, uri)
  const bridge4 = new LSPBridge(dummyIndex, dummyEngine, pos, uri);
  assert.strictEqual(bridge4.positions, pos);
  assert.strictEqual(bridge4.getDocumentUri(), uri);
  assert.strictEqual(typeof bridge4.positions.positionToCharOffset, "function");
  assert.strictEqual(bridge4.positions.positionToCharOffset(1, 0), 7);

  // 2. 5-arg signature: (index, engine, positions, uri, env)
  const bridge5 = new LSPBridge(dummyIndex, dummyEngine, pos, uri, env);
  assert.strictEqual(bridge5.positions, pos);
  assert.strictEqual(bridge5.getDocumentUri(), uri);
  assert.strictEqual(bridge5.getEnv(), env);
  assert.strictEqual(typeof bridge5.positions.positionToCharOffset, "function");
  assert.strictEqual(bridge5.positions.positionToCharOffset(2, 0), 14);

  // 3. Legacy 5-arg signature: (index, engine, resolver, positions, uri)
  const dummyResolver = { resolve: () => null };
  const legacyBridge5 = new LSPBridge(dummyIndex, dummyEngine, dummyResolver, pos, uri);
  assert.strictEqual(legacyBridge5.positions, pos);
  assert.strictEqual(legacyBridge5.getDocumentUri(), uri);
  assert.strictEqual(typeof legacyBridge5.positions.positionToCharOffset, "function");

  // 4. Legacy 6-arg signature: (index, engine, resolver, positions, uri, env)
  const legacyBridge6 = new LSPBridge(dummyIndex, dummyEngine, dummyResolver, pos, uri, env);
  assert.strictEqual(legacyBridge6.positions, pos);
  assert.strictEqual(legacyBridge6.getDocumentUri(), uri);
  assert.strictEqual(legacyBridge6.getEnv(), env);

  // 5. Fallback when positions is omitted or invalid
  const fallbackBridge = new LSPBridge(dummyIndex, dummyEngine);
  assert.ok(fallbackBridge.positions instanceof PositionIndex);
  assert.strictEqual(typeof fallbackBridge.positions.positionToCharOffset, "function");
  assert.strictEqual(fallbackBridge.positions.positionToCharOffset(0, 0), 0);
});

test("LSP Notification: modelscript/visibleRanges", async () => {
  const notifications = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: () => {},
    onNotification: (method: string, handler: (...args: any[]) => any) => {
      notifications.set(method, handler);
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const documentViewports = new Map<string, { startOffset: number; endOffset: number }>();
  const documentLSPBridges = new Map<string, LSPBridge>();
  const uri = "file:///model.mo";
  const docText = "model M\n  Real x;\nequation\n  x = 1.0;\nend M;\n";
  const posIndex = new PositionIndex(docText);

  // Create bridge using the standard 5-argument constructor as in validation-service.ts
  const bridge = new LSPBridge(
    { symbols: new Map(), byName: new Map(), childrenOf: new Map() } as any,
    { query: () => null } as any,
    posIndex,
    uri,
    { documentLSPBridges },
  );
  documentLSPBridges.set(uri, bridge);

  const mockContext: any = {
    connection: mockConnection,
    validationService: {
      documentViewports,
      documentLSPBridges,
    },
    documentManager: {
      getLineIndexForDoc: (u: string) => (u === uri ? posIndex : null),
    },
    parserService: {
      getParser: () => undefined,
    },
    workspaceManager: {
      hypergraph: {
        recordTheorySat: () => {},
        getDomainNode: () => undefined,
      },
      threadMetadataMap: new Map(),
    },
  };

  registerMiscEndpoints(mockContext);

  const handler = notifications.get("modelscript/visibleRanges");
  assert.ok(handler, "modelscript/visibleRanges notification must be registered");

  // 1. Should successfully calculate viewport byte offsets from line ranges
  handler({
    uri,
    ranges: [{ startLine: 1, endLine: 3 }],
  });

  const vp = documentViewports.get(uri);
  assert.ok(vp, "Viewport must be stored in documentViewports");
  const expectedStart = posIndex.positionToCharOffset(1, 0);
  const expectedEnd = posIndex.positionToCharOffset(4, 0); // end of line 3
  assert.strictEqual(vp?.startOffset, expectedStart);
  assert.strictEqual(vp?.endOffset, expectedEnd);

  // 2. Empty ranges should delete from documentViewports
  handler({
    uri,
    ranges: [],
  });
  assert.strictEqual(documentViewports.has(uri), false);

  // 3. Fallback when bridge is not yet registered (uses documentManager)
  documentLSPBridges.delete(uri);
  handler({
    uri,
    ranges: [{ startLine: 0, endLine: 2 }],
  });
  const vpFallback = documentViewports.get(uri);
  assert.ok(vpFallback, "Viewport should be stored using fallback documentManager");
  assert.strictEqual(vpFallback?.startOffset, posIndex.positionToCharOffset(0, 0));

  // 4. When neither bridge nor documentManager has positions, it should safely do nothing without throwing
  assert.doesNotThrow(() => {
    handler({
      uri: "file:///unknown.mo",
      ranges: [{ startLine: 0, endLine: 5 }],
    });
  });
});
