// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, language, tggDefaultVal, tggEq, tggRule } from "@modelscript/dsl";
import * as childProcess from "child_process";
import expect from "expect";
import * as fs from "fs";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const polyglotTestDsl = language({
  name: "PolyglotWasmTest",
  rules: {
    Model: ($: any) => $["Item"],
    Item: () => "item",
  },
  polyglot: {
    languages: ["modelica", "sysml2"],
    rules: [
      tggRule({
        name: "ItemToComponent",
        source: ($, v) => $.Item({ name: v("itemName") }),
        target: ($, v) => $.Component({ name: v("itemName") }),
        where: (v) => [tggEq(v("itemName"), v("itemName")), tggDefaultVal(v("kind"), "model")],
      }),
    ],
  },
});

describe("AssemblyScript Correspondence Index & Polyglot Arena WASM Tests", () => {
  let tmpDir: string;
  let wasmExports: any;
  let wasmMemory: WebAssembly.Memory;

  beforeAll(async () => {
    const result = buildParser(polyglotTestDsl as any);
    tmpDir = path.join(__dirname, "scratch_correspondence_build");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const filePath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "pipe" },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
    wasmMemory = memory;
    const imports = {
      env: { memory: memory, abort: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have correspondence index WASM exports", () => {
    expect(wasmExports.createCorrespondenceIndex).toBeDefined();
    expect(wasmExports.corr_addLink).toBeDefined();
    expect(wasmExports.corr_findBySource).toBeDefined();
    expect(wasmExports.corr_findByTarget).toBeDefined();
    expect(wasmExports.corr_markStale).toBeDefined();
    expect(wasmExports.corr_reset).toBeDefined();
    expect(wasmExports.corr_setComplement).toBeDefined();
    expect(wasmExports.corr_getComplement).toBeDefined();
    expect(wasmExports.corr_getParentSlot).toBeDefined();
    expect(wasmExports.corr_setParentSlot).toBeDefined();
    expect(wasmExports.corr_markStaleCascading).toBeDefined();
  });

  it("should perform correspondence index link and lookup operations via WASM exports", () => {
    const corrPtr = wasmExports.createCorrespondenceIndex(64);
    expect(corrPtr).toBeGreaterThan(0);

    const slot1 = wasmExports.corr_addLink(corrPtr, 101, 201, 0, 1, 10);
    const slot2 = wasmExports.corr_addLink(corrPtr, 102, 202, 1, 1, 10);

    expect(wasmExports.corr_findBySource(corrPtr, 101)).toBe(201);
    expect(wasmExports.corr_findBySource(corrPtr, 102)).toBe(202);
    expect(wasmExports.corr_findByTarget(corrPtr, 201)).toBe(101);
    expect(wasmExports.corr_findByTarget(corrPtr, 202)).toBe(102);

    expect(wasmExports.corr_findBySource(corrPtr, 999)).toBe(0);
    expect(wasmExports.corr_findByTarget(corrPtr, 999)).toBe(0);

    // Complement pointer preservation
    expect(wasmExports.corr_getComplement(corrPtr, slot1)).toBe(0);
    wasmExports.corr_setComplement(corrPtr, slot1, 0xcafe);
    expect(wasmExports.corr_getComplement(corrPtr, slot1)).toBe(0xcafe);

    // Parent slot & cascading invalidation
    expect(wasmExports.corr_getParentSlot(corrPtr, slot2) >>> 0).toBe(0xffffffff);
    wasmExports.corr_setParentSlot(corrPtr, slot2, slot1);
    expect(wasmExports.corr_getParentSlot(corrPtr, slot2)).toBe(slot1);

    const cascadeCount = wasmExports.corr_markStaleCascading(corrPtr, slot1);
    expect(cascadeCount).toBe(2);

    wasmExports.corr_markStale(corrPtr, 101);
    wasmExports.corr_reset(corrPtr);
    expect(wasmExports.corr_findBySource(corrPtr, 101)).toBe(0);
  });

  it("should have polyglot arena WASM exports with linear string interning", () => {
    expect(wasmExports.createPolyglotArena).toBeDefined();
    expect(wasmExports.polyglot_getStringPool).toBeDefined();
    expect(wasmExports.polyglot_internString).toBeDefined();
    expect(wasmExports.polyglot_getStringOffset).toBeDefined();
    expect(wasmExports.polyglot_getStringLength).toBeDefined();

    const arenaPtr = wasmExports.createPolyglotArena();
    expect(arenaPtr).toBeGreaterThan(0);

    const poolPtr = wasmExports.polyglot_getStringPool(arenaPtr);
    expect(poolPtr).toBeGreaterThan(0);

    // Write a test string into memory buffer and intern it
    const testStr = "modelica_component_resistance";
    const strBytes = new TextEncoder().encode(testStr);
    const memOffset = 1024 * 64; // arbitrary safe scratch offset in first page
    const memArray = new Uint8Array(wasmMemory.buffer);
    memArray.set(strBytes, memOffset);

    const strId1 = wasmExports.polyglot_internString(arenaPtr, memOffset, strBytes.length);
    expect(strId1).toBeGreaterThan(0);

    // Interning same string returns identical stringId
    const strId2 = wasmExports.polyglot_internString(arenaPtr, memOffset, strBytes.length);
    expect(strId2).toBe(strId1);

    expect(wasmExports.polyglot_getStringLength(arenaPtr, strId1)).toBe(strBytes.length);
    expect(wasmExports.polyglot_getStringOffset(arenaPtr, strId1)).toBeGreaterThan(0);
  });

  it("should have TGG dispatch functions exported in WASM", () => {
    expect(wasmExports.tgg_forward_dispatch).toBeDefined();
    expect(wasmExports.tgg_backward_dispatch).toBeDefined();
    expect(wasmExports.tgg_propagate_all_stale).toBeDefined();
  });
});
