import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, repeat, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "HashmapTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) => seq("model", $.Identifier, ";", "end", ";"),
    Identifier: ($: any) => /[a-zA-Z_][a-zA-Z0-9_]*/,
  },
  extras: ($: any) => [/\s+/],
});

describe("AssemblyScript Unmanaged Hashmap WASM Tests (Jest Integration)", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = path.join(__dirname, "scratch_hashmap_build");
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(dsl as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    // Create entrypoint file that exports all wrapper functions for WebAssembly
    const harnessTs = path.join(tmpDir, "hashmap_harness.ts");
    const outWasm = path.join(tmpDir, "hashmap_harness.wasm");

    const code = `
    import {
      UnmanagedSet64,
      UnmanagedMap64,
      UnmanagedMap64To64,
      createSet64,
      releaseSet64,
      createMap64,
      releaseMap64,
      createMap64To64,
      releaseMap64To64
    } from "./hashmap";

    export function testSetOps(key: u64): boolean {
      let ptr = createSet64();
      let set = changetype<UnmanagedSet64>(ptr);
      set.add(key);
      let found = set.has(key);
      set.release();
      return found;
    }

    export function testSetResize(count: u32): u32 {
      let ptr = createSet64();
      let set = changetype<UnmanagedSet64>(ptr);
      for (let i: u32 = 1; i <= count; i++) {
        set.add(i as u64);
      }
      let cap = set.capacity;
      set.release();
      return cap;
    }

    export function testMapOps(key: u64, val: u32): u32 {
      let ptr = createMap64();
      let map = changetype<UnmanagedMap64>(ptr);
      map.set(key, val);
      let res = map.get(key);
      map.release();
      return res;
    }

    export function testMap64To64Ops(key: u64, val: u64): u64 {
      let ptr = createMap64To64();
      let map = changetype<UnmanagedMap64To64>(ptr);
      map.set(key, val);
      let res = map.get(key);
      map.release();
      return res;
    }

    export function testPoolRecycling(): boolean {
      let ptr1 = createMap64();
      let map1 = changetype<UnmanagedMap64>(ptr1);
      map1.set(12345, 999);
      map1.release();

      let ptr2 = createMap64();
      let map2 = changetype<UnmanagedMap64>(ptr2);
      let staleVal = map2.get(12345);
      map2.release();

      return ptr1 === ptr2 && staleVal === 0;
    }
    `;

    fs.writeFileSync(harnessTs, code);

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const ascCmd = `${ascPath} ${harnessTs} -o ${outWasm} --exportRuntime --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasmBuffer = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    const instance = await WebAssembly.instantiate(wasmModule, {
      env: {
        abort: (msg: any, file: any, line: any, col: any) => {
          console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`);
        },
      },
    });

    wasmExports = instance.exports;
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("UnmanagedSet64 should add and verify 64-bit keys", () => {
    const result = wasmExports.testSetOps(9876543210n);
    expect(Boolean(result)).toBe(true);
  });

  test("UnmanagedSet64 should expand capacity when load factor threshold is crossed", () => {
    const capacity = wasmExports.testSetResize(25);
    expect(capacity).toBeGreaterThan(16);
  });

  test("UnmanagedMap64 should insert and retrieve u32 values", () => {
    const val = wasmExports.testMapOps(123456n, 777);
    expect(val).toBe(777);
  });

  test("UnmanagedMap64To64 should insert and retrieve u64 values", () => {
    const val = wasmExports.testMap64To64Ops(0x1122334455667788n, 0x8877665544332211n);
    expect(BigInt.asUintN(64, val)).toBe(0x8877665544332211n);
  });

  test("LIFO object pool should reuse instances cleanly without memory contamination", () => {
    const success = wasmExports.testPoolRecycling();
    expect(Boolean(success)).toBe(true);
  });
});
