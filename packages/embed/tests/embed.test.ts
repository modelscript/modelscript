// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  CanvasContextPool,
  compressEmbedPayload,
  decompressEmbedPayload,
  getLaunchUrl,
  validateSymbolBinaryHeader,
  wrapWithSymbolBinaryHeader,
  type UniversalEmbedPayload,
} from "../src/index.js";

async function runTests() {
  console.log("Running @modelscript/embed unit tests...");

  // 1. Test single-file payload compression & decompression
  const singleFilePayload: UniversalEmbedPayload = {
    v: 1,
    lang: "modelica",
    code: "model Test\n  Real x;\nequation\n  der(x) = -x;\nend Test;",
    view: "diagram",
    anchor: {
      elementId: "x",
      kind: "component",
      line: 2,
    },
  };

  const token = compressEmbedPayload(singleFilePayload);
  assert.ok(typeof token === "string" && token.length > 0, "Token should be non-empty string");

  const decompressed = decompressEmbedPayload(`m=${token}`);
  assert.ok(decompressed !== null, "Decompressed payload should not be null");
  assert.strictEqual(decompressed.code, singleFilePayload.code);
  assert.strictEqual(decompressed.lang, "modelica");
  assert.strictEqual(decompressed.anchor?.elementId, "x");
  assert.strictEqual(decompressed.anchor?.line, 2);

  // 2. Test routing: single-file -> Morsel Playground
  const launch1 = getLaunchUrl(singleFilePayload);
  assert.strictEqual(launch1.target, "playground");
  assert.ok(launch1.url.startsWith("/playground#m="));

  // 3. Test routing: multi-file -> Full IDE
  const multiFilePayload: UniversalEmbedPayload = {
    v: 1,
    lang: "modelica",
    code: "package MyPkg ... end MyPkg;",
    isMultiFile: true,
    artifactId: "42",
    anchor: {
      elementId: "SubComponentA",
    },
  };

  const launch2 = getLaunchUrl(multiFilePayload);
  assert.strictEqual(launch2.target, "ide");
  assert.strictEqual(launch2.url, "/vscode/workbench/#memfs:artifact-42&anchor=SubComponentA");

  // 4. Test polyglot dialect support
  const stepPayload: UniversalEmbedPayload = {
    v: 1,
    lang: "step",
    code: "ISO-10303-21; ... END-ISO-10303-21;",
    view: "cad",
    anchor: {
      elementId: "SOLID_BODY_1",
      kind: "cad-node",
    },
  };
  const stepToken = compressEmbedPayload(stepPayload);
  const decompressedStep = decompressEmbedPayload(stepToken);
  assert.strictEqual(decompressedStep?.lang, "step");
  assert.strictEqual(decompressedStep?.view, "cad");
  // 5. Test MSYM Binary Header validation & wrapping
  const dummyPayload = new TextEncoder().encode("DUMMY_SYMBOL_DATA");
  const wrapped = wrapWithSymbolBinaryHeader(dummyPayload, 1);
  const validResult = validateSymbolBinaryHeader(wrapped);
  assert.strictEqual(validResult.valid, true, "Valid MSYM header should pass");
  assert.strictEqual(validResult.schemaVersion, 1);
  assert.strictEqual(validResult.dialect, 1);

  // Corrupted magic bytes test
  const corrupted = wrapped.slice(0);
  new Uint8Array(corrupted)[0] = 0x58; // 'X' instead of 'M'
  const invalidResult = validateSymbolBinaryHeader(corrupted);
  assert.strictEqual(invalidResult.valid, false, "Corrupted magic bytes should fail");

  // Server-wrapped Big-Endian buffer test
  const serverHeader = Buffer.alloc(16);
  serverHeader.write("MSYM", 0, 4, "ascii");
  serverHeader.writeUInt16BE(1, 4);
  serverHeader.writeUInt16BE(1, 6);
  serverHeader.writeUInt32BE(0, 8);
  serverHeader.writeUInt32BE(dummyPayload.length, 12);
  const serverBuffer = Buffer.concat([serverHeader, Buffer.from(dummyPayload)]);
  const serverSlice = serverBuffer.buffer.slice(
    serverBuffer.byteOffset,
    serverBuffer.byteOffset + serverBuffer.byteLength,
  );
  const serverResult = validateSymbolBinaryHeader(serverSlice);
  assert.strictEqual(serverResult.valid, true, "Server-wrapped MSYM header should pass validation");
  assert.strictEqual(serverResult.schemaVersion, 1);
  assert.strictEqual(serverResult.dialect, 1);

  // 6. Test CanvasContextPool LRU eviction and sleep transitions
  const pool = new CanvasContextPool(3); // limit of 3
  const sleepLog: string[] = [];
  const wakeLog: string[] = [];

  const sub1 = {
    id: "viewer-1",
    onSleep: () => sleepLog.push("viewer-1"),
    onWake: () => wakeLog.push("viewer-1"),
    captureSnapshot: () => "data:image/webp;base64,SNAP1",
  };
  const sub2 = {
    id: "viewer-2",
    onSleep: () => sleepLog.push("viewer-2"),
    onWake: () => wakeLog.push("viewer-2"),
    captureSnapshot: () => "data:image/webp;base64,SNAP2",
  };
  const sub3 = {
    id: "viewer-3",
    onSleep: () => sleepLog.push("viewer-3"),
    onWake: () => wakeLog.push("viewer-3"),
  };
  const sub4 = {
    id: "viewer-4",
    onSleep: () => sleepLog.push("viewer-4"),
    onWake: () => wakeLog.push("viewer-4"),
  };

  pool.requestActive(sub1);
  pool.requestActive(sub2);
  pool.requestActive(sub3);
  assert.strictEqual(pool.getActiveCount(), 3);
  assert.strictEqual(pool.isActive("viewer-1"), true);
  assert.strictEqual(pool.isActive("viewer-2"), true);
  assert.strictEqual(pool.isActive("viewer-3"), true);

  // Re-requesting active viewer-1 marks it MRU: order is now [viewer-2, viewer-3, viewer-1]
  pool.requestActive(sub1);

  // Request 4th viewer: viewer-2 should be evicted (put to sleep)
  pool.requestActive(sub4);
  assert.strictEqual(pool.getActiveCount(), 3);
  assert.strictEqual(pool.isActive("viewer-2"), false);
  assert.strictEqual(pool.isActive("viewer-4"), true);
  assert.deepStrictEqual(sleepLog, ["viewer-2"]);
  assert.strictEqual(pool.getSnapshot("viewer-2"), "data:image/webp;base64,SNAP2");

  // Release viewer-3: count drops to 2
  pool.release("viewer-3");
  assert.strictEqual(pool.getActiveCount(), 2);
  assert.strictEqual(pool.isActive("viewer-3"), false);

  // 7. Test expanded polyglot dialects & morselId / embedToken payload fields
  const gensysPayload: UniversalEmbedPayload = {
    v: 1,
    lang: "gensys",
    code: "## GENSYS Vehicle Model",
    view: "diagram",
    morselId: "morsel-abc123def456",
    embedToken: "signed.token.123",
  };
  const gensysToken = compressEmbedPayload(gensysPayload);
  const decompressedGensys = decompressEmbedPayload(gensysToken);
  assert.strictEqual(decompressedGensys?.lang, "gensys");
  assert.strictEqual(decompressedGensys?.morselId, "morsel-abc123def456");
  assert.strictEqual(decompressedGensys?.embedToken, "signed.token.123");

  console.log("✓ All @modelscript/embed unit tests passed successfully!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
