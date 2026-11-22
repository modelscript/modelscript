// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { getDefaultWasmExports } from "../src/dae/wasm_dae.js";
import { Causality, DAEBuilder, ExprKind, VarType, Variability, WasmStringPool } from "../src/index.js";

const require = createRequire(import.meta.url);
// Dynamic specifier avoids introducing a static @modelscript/runtime -> @modelscript/modelica cycle in Nx's project graph.
const MODELICA_WASM_SPEC = ["@modelscript", "modelica", "parser.wasm"].join("/");

describe("WASM Linear Arena — Multi-File & Long-Session Robustness", () => {
  it("evicts per-document arenas, recycles chunks without side-table leakage, and tracks live doc memory", async () => {
    const modelicaWasmPath = require.resolve(MODELICA_WASM_SPEC);
    const { facade } = await createWasmParser(modelicaWasmPath);
    const exp = facade.exports;

    const baselineMem = exp.arena_getMemoryUsage();

    // Allocate nodes in document 1 and attach sparse side-table metadata
    exp.setAllocDocument(1);
    const node1 = exp.allocAstNode(1, 0, 5, 0);
    exp.ast_setNodeFlag(node1, 0x1234);
    exp.ast_setLiteralInt(node1, 42);
    assert.equal(exp.ast_hasNodeFlag(node1, 0x1234), 1);

    const afterDoc1Mem = exp.arena_getMemoryUsage();
    assert.ok(
      afterDoc1Mem > baselineMem,
      `Expected arena_getMemoryUsage to include doc1 chunk (${afterDoc1Mem} > ${baselineMem})`,
    );

    // Evict document 1 — live memory should drop back to baseline
    exp.setAllocDocument(0);
    exp.evictDocumentArena(1);
    const afterEvictMem = exp.arena_getMemoryUsage();
    assert.equal(afterEvictMem, baselineMem, "Expected arena_getMemoryUsage to decrease after evictDocumentArena");

    // Allocate in document 2 — should recycle document 1's chunk cleanly with ZERO stale side-table flags
    exp.setAllocDocument(2);
    const node2 = exp.allocAstNode(1, 0, 5, 0);
    assert.equal(node2, node1, "Expected recycled chunk to hand out the same physical slot");
    assert.equal(exp.ast_hasNodeFlag(node2, 0x1234), 0, "Recycled node must not inherit stale nodeFlags");
    exp.setAllocDocument(0);
    exp.evictDocumentArena(2);
  });

  it("handles interleaved multi-file parseIncremental without clobbering the shared input buffer", async () => {
    const modelicaWasmPath = require.resolve(MODELICA_WASM_SPEC);
    const { facade } = await createWasmParser(modelicaWasmPath);

    const srcA = "model FileA\n  Real x = 1.0;\nend FileA;\n";
    const srcB = "model FileB\n  parameter Integer k = 999;\n  Real y = k;\nend FileB;\n";

    const rootA = facade.parse(srcA, 0, 0, 0, "file:///a.mo");
    assert.ok(rootA > 0, "FileA initial parse should succeed");
    facade.uriSourceCode.set("file:///a.mo", srcA);

    // Interleave a parse of FileB, overwriting the single WASM input buffer
    const rootB = facade.parse(srcB, 0, 0, 0, "file:///b.mo");
    assert.ok(rootB > 0, "FileB parse should succeed");
    facade.uriSourceCode.set("file:///b.mo", srcB);

    // Now incrementally edit FileA ("1.0" -> "2.5") without manually reloading FileA first
    const idx = srcA.indexOf("1.0");
    const updatedA = srcA.slice(0, idx) + "2.5" + srcA.slice(idx + 3);
    const newRootA = facade.parseIncremental("2.5", idx, 3, updatedA.length, "file:///a.mo");
    assert.ok(newRootA > 0, "FileA incremental parse after FileB should succeed");

    // Verify FileA's parsed text is intact and not corrupted with FileB's bytes
    const errorsA = facade.getDiagnostics(newRootA, updatedA).filter((d: { severity: number }) => d.severity === 1);
    assert.equal(
      errorsA.length,
      0,
      `Expected 0 syntax errors in FileA after interleaved edit, got: ${JSON.stringify(errorsA)}`,
    );

    facade.removeDocument("file:///a.mo");
    facade.removeDocument("file:///b.mo");
  });

  it("bounds WASM heap growth across 100 DAEBuilder create/reset/dispose cycles", () => {
    const wasm = getDefaultWasmExports();
    assert.ok(wasm && wasm.memory, "Default WASM runtime exports should be available");

    // Warm up allocator
    for (let i = 0; i < 10; i++) {
      const dae = new DAEBuilder(wasm, `Warm_${i}`);
      for (let v = 0; v < 50; v++) {
        dae.addVariable(`x_${v}`, VarType.Real, Variability.Continuous, Causality.Local, v);
      }
      dae.free();
    }
    const bytesAfterWarmup = wasm.memory.buffer.byteLength;

    // Run 100 create + populate + dispose cycles
    for (let i = 0; i < 100; i++) {
      const dae = new DAEBuilder(wasm, `Model_${i}`);
      for (let v = 0; v < 80; v++) {
        const nameId = dae.interner.intern(`var_${i}_${v}`);
        dae.addVariable(nameId, VarType.Real, Variability.Continuous, Causality.Local, v);
        dae.addRealLiteral(v * 1.5);
      }
      assert.equal(dae.getExprKind(0), ExprKind.RealLiteral);
      if (typeof (dae.interner as WasmStringPool).dispose === "function") {
        (dae.interner as WasmStringPool).dispose();
      }
      dae.free();
    }

    const bytesAfterStress = wasm.memory.buffer.byteLength;
    const growthMB = (bytesAfterStress - bytesAfterWarmup) / (1024 * 1024);
    assert.ok(
      growthMB < 4,
      `Expected bounded WASM heap growth across 100 DAEBuilder cycles (< 4 MB), got ${growthMB.toFixed(2)} MB`,
    );
  });
});
