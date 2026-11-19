// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggCompute, tggEq, tggInvertible, tggNot, tggRule } from "@modelscript/dsl";
import { compileTGGRules, planTGGRules } from "@modelscript/dsl/codegen/compile_tgg.js";
import { compileWcojMatcher, planWcojPattern } from "@modelscript/dsl/codegen/rewriting/compile_wcoj";
import { registerNodeDomain, runCPA } from "@modelscript/dsl/codegen/rewriting/cpa";
import assert from "node:assert";
import { describe, it } from "node:test";
import { getDefaultWasmExports, setCachedWasmExports } from "../src/dae/wasm_dae.js";
import { PolyglotTransformer } from "../src/interop/polyglot-transformer.js";
import { registerNodeNameKey, solveWhereConstraints } from "../src/interop/tgg-pattern-interpreter.js";
import { ThreadDomain } from "../src/interop/thread_hypergraph.js";
import { alignPorts1DWasm, compactTsm1DWasm, routeOrthogonalAStarWasm } from "../src/solvers/wasm_cad_diagram.js";

describe("TGG Engine Bugfix Regressions", () => {
  it("should auto-invert omitted backwardExpr and evaluate scientific notation safely in solveWhereConstraints", () => {
    const constraints = [tggInvertible("tgtVal = 2 * srcVal + 10"), tggCompute("scaled", "1e-3 * tgtVal + sqrt(16)")];

    const fwdEnv: Record<string, any> = { srcVal: 5 };
    solveWhereConstraints(constraints, fwdEnv, "forward");
    assert.strictEqual(fwdEnv.tgtVal, 20);
    assert.strictEqual(fwdEnv.scaled, 4.02);

    const bwdEnv: Record<string, any> = { tgtVal: 20 };
    solveWhereConstraints(constraints, bwdEnv, "backward");
    assert.strictEqual(bwdEnv.srcVal, 5);
  });

  it("should assign collision-free hypergraph slots for non-numeric and same-digit thread IDs", () => {
    const transformer = new PolyglotTransformer();
    transformer.registerThread("root:Chassis", {
      modelica: { name: "Chassis", id: 10 },
      sysml2: { name: "ChassisDef", id: 20 },
    });
    transformer.registerThread("var:mass", {
      modelica: { name: "mass", id: 11 },
      sysml2: { name: "massAttr", id: 21 },
    });
    transformer.registerThread("bus:1", {
      modelica: { name: "Bus1", id: 12 },
      psse: { name: "PSSE_Bus1", id: 32 },
    });
    transformer.registerThread("gen:1", {
      modelica: { name: "Gen1", id: 13 },
      psse: { name: "PSSE_Gen1", id: 33 },
    });

    const hg = transformer.getHypergraph();
    assert.strictEqual(hg.getThreadCount(), 4);
    const tChassis = hg.findThreadByDomainNode(ThreadDomain.Modelica, 10);
    const tMass = hg.findThreadByDomainNode(ThreadDomain.Modelica, 11);
    const tBus1 = hg.findThreadByDomainNode(ThreadDomain.Modelica, 12);
    const tGen1 = hg.findThreadByDomainNode(ThreadDomain.Modelica, 13);
    assert.ok(tChassis !== undefined && tMass !== undefined && tChassis !== tMass);
    assert.ok(tBus1 !== undefined && tGen1 !== undefined && tBus1 !== tGen1);
  });

  it("should preserve metadata on propagate, retract all multi-projection rules, and prefix Math.* in AS codegen", () => {
    const rules = [
      tggRule({
        name: "ModelToSysML",
        sourceLang: "modelica",
        targetLang: "sysml2",
        source: ($, v) => $.Block({ name: v("n"), val: v("x") }),
        target: ($, v) => $.PartDef({ name: v("n"), val: v("y") }),
        where: (v) => [tggInvertible("y = sqrt(x) + ln(x)", "x = exp(y)")],
      }),
      tggRule({
        name: "ModelToFMI",
        sourceLang: "modelica",
        targetLang: "fmi3",
        source: ($, v) => $.Block({ name: v("n") }),
        target: ($, v) => $.FmiModel({ name: v("n") }),
        where: (v) => [tggEq(v("n"), v("n"))],
      }),
    ];

    const compiled = compileTGGRules(rules);
    assert.ok(compiled.sourceCode.includes("corr.clearStale(slot);"));
    assert.ok(!compiled.sourceCode.includes("corr.addLink(sourceNodeId, targetNodeId, 0, CORR_FLAG_SYNCED, 0);"));
    assert.ok(compiled.sourceCode.includes("retracted += tgg_retract_ModelToSysML(sourceNodeId, corr, arena);"));
    assert.ok(compiled.sourceCode.includes("retracted += tgg_retract_ModelToFMI(sourceNodeId, corr, arena);"));
    assert.ok(compiled.sourceCode.includes("Math.sqrt("));
    assert.ok(compiled.sourceCode.includes("Math.log("));
  });

  it("should recognize structured TGGPattern objects in CPA NAC disjointness checks", () => {
    const r1 = tggRule({
      name: "RuleA",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) => $.Port({ name: v("n") }),
      target: ($, v) => $.SysMLPort({ name: v("n") }),
      where: () => [tggNot({ nodeType: "SpecialPort", bindings: {} })],
    });
    const r2 = tggRule({
      name: "RuleB",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) => $.Port({ name: v("n"), kind: "SpecialPort" }),
      target: ($, v) => $.SysMLSpecialPort({ name: v("n") }),
      where: () => [],
    });

    const report = runCPA([r1, r2]);
    assert.strictEqual(report.conflicts.filter((c) => c.kind === "overlap").length, 0);
  });

  it("should support dynamic N-domain hypergraph bindings beyond 18 domains for all 93+ languages", () => {
    const transformer = new PolyglotTransformer();
    transformer.registerThread("circuit:R1", {
      modelica: { name: "R1", id: 101 },
      spice: { name: "R1", id: 201 },
      "verilog-a": { name: "R1_va", id: 301 },
      sbml: { name: "R1_rxn", id: 401 },
    });

    const hg = transformer.getHypergraph();
    const spiceId = hg.getDomainId("spice");
    const vaId = hg.getDomainId("verilog-a");
    const sbmlId = hg.getDomainId("sbml");

    assert.ok(spiceId !== undefined && spiceId >= 18);
    assert.ok(vaId !== undefined && vaId >= 18 && vaId !== spiceId);
    assert.ok(sbmlId !== undefined && sbmlId >= 18 && sbmlId !== vaId);
    assert.strictEqual(hg.findThreadByDomainNode(spiceId!, 201), hg.findThreadByDomainNode(sbmlId!, 401));
    const rec = hg.getRecord(0);
    assert.strictEqual(rec?.domainNodes[spiceId!], 201);
    assert.strictEqual(rec?.domainNodes[vaId!], 301);
    assert.strictEqual(rec?.domainNodes[sbmlId!], 401);
  });

  it("should enforce TGGRuleOptions.context prerequisites during projectGraph and synchronizeGraph", () => {
    const circuitRule = tggRule({
      name: "CircuitToSubckt",
      sourceLang: "modelica",
      targetLang: "spice",
      source: ($, v) => $.ElectricalCircuit({ name: v("cktName") }),
      target: ($, v) => $.SpiceSubckt({ name: v("cktName") }),
      where: (v) => [tggEq(v("cktName"), v("cktName"))],
    });

    const resistorInCircuitRule = tggRule({
      name: "ResistorInCircuitToSpice",
      sourceLang: "modelica",
      targetLang: "spice",
      context: {
        source: ($, v) => $.ElectricalCircuit({ name: v("parentName") }),
        target: ($, v) => $.SpiceSubckt({ name: v("parentName") }),
      },
      source: ($, v) => $.Resistor({ name: v("rName"), R: v("rVal") }),
      target: ($, v) => $.SpiceResistor({ name: v("rName"), ohms: v("rVal"), subckt: v("parentName") }),
      where: (v) => [tggEq(v("rName"), v("rName")), tggEq(v("rVal"), v("rVal"))],
    });

    const transformer = new PolyglotTransformer({ rules: [circuitRule, resistorInCircuitRule] });
    const projected = transformer.projectGraph(
      {
        kind: "ElectricalCircuit",
        name: "Filter",
        children: [{ kind: "Resistor", name: "R1", properties: { name: "R1", R: 100 } }],
      },
      "modelica",
      "spice",
    );

    const child = (projected.children as any[])[0];
    assert.strictEqual(child.kind, "SpiceResistor");
    assert.strictEqual(child.properties.subckt, "Filter");
    assert.strictEqual(child.properties.ohms, 100);

    // Without matching context, the context-guarded rule should not fire
    const noCtx = transformer.evaluateRuleForward(
      { kind: "Resistor", name: "R_orphan", properties: { name: "R_orphan", R: 50 } },
      "spice",
      "orphan:R",
      { kind: "ThermalSystem", name: "Heater" },
    );
    assert.strictEqual(noCtx, null);
  });

  it("should evaluate path, mapList, exprMap, and physicalPort constraints in solveWhereConstraints", () => {
    const constraints = [
      { kind: "path" as const, args: ["__var_root", "ports/0/name", "__var_portName"] },
      { kind: "mapList" as const, args: ["__var_srcPins", "__var_tgtPins"] },
      { kind: "exprMap" as const, args: ["__var_srcExpr", "__var_tgtExpr", "modelica-sysml2"] },
      { kind: "physicalPort" as const, args: ["__var_vAcross", "__var_tgtAcross", "electrical"] },
    ];
    const env: Record<string, any> = {
      root: { ports: [{ name: "p_in" }] },
      srcPins: ["a", "b"],
      srcExpr: "der(x) = -k * x",
      vAcross: 24,
    };
    solveWhereConstraints(constraints, env, "forward");
    assert.strictEqual(env.portName, "p_in");
    assert.deepStrictEqual(env.tgtPins, ["a", "b"]);
    assert.strictEqual(env.tgtExpr, "der(x) = -k * x");
    assert.strictEqual(env.tgtAcross, 24);
  });

  it("should satisfy GetPut and PutGet lens laws across randomized inputs with tggInvertible and tggComplement", () => {
    const rule = tggRule({
      name: "ThermalSensorLens",
      sourceLang: "modelica",
      targetLang: "sysml2",
      source: ($, v) =>
        $.ThermalSensor({
          name: v("sName"),
          tempK: v("tk"),
          tolerance: v("tol"),
          calibrationNote: v("note"),
        }),
      target: ($, v) =>
        $.SensorBlock({
          name: v("sName"),
          tempC: v("tc"),
          tolerance: v("tol"),
        }),
      where: (v) => [
        tggEq(v("sName"), v("sName")),
        tggInvertible("tc = tk - 273.15", "tk = tc + 273.15"),
        tggEq(v("tol"), v("tol")),
        tggComplement("calibrationNote"),
      ],
    });

    const transformer = new PolyglotTransformer({ rules: [rule] });

    // Deterministic LCG PRNG for reproducible property-based fuzzing
    let seed = 0x517cc1b7;
    const nextRand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let i = 0; i < 50; i++) {
      const sName = `Sensor_${i}_${Math.floor(nextRand() * 1000)}`;
      const tk = 200 + nextRand() * 500;
      const tol = 0.001 + nextRand() * 0.1;
      const note = `cal-${Math.floor(nextRand() * 99999)}`;

      const srcAst = {
        kind: "ThermalSensor",
        name: sName,
        properties: { name: sName, tempK: tk, tolerance: tol, calibrationNote: note },
      };

      // Forward (Get)
      const fwd = transformer.evaluateRuleForward(srcAst, "sysml2", `lens:${i}`);
      assert.ok(fwd, `Forward evaluation failed at iteration ${i}`);
      const fwdTempC = (fwd!.targetNode.properties as Record<string, any>).tempC;
      assert.ok(Math.abs(fwdTempC - (tk - 273.15)) < 1e-9);

      // GetPut: Backward(Forward(s)) === s (with complement restored)
      const bwdGetPut = transformer.evaluateRuleBackward(fwd!.targetNode, "modelica", {
        threadId: `lens:${i}`,
      });
      assert.ok(bwdGetPut, `GetPut backward evaluation failed at iteration ${i}`);
      const bwdProps = bwdGetPut!.sourceNode.properties as Record<string, any>;
      assert.strictEqual(bwdProps.name, sName);
      assert.ok(Math.abs(bwdProps.tempK - tk) < 1e-9);
      assert.ok(Math.abs(bwdProps.tolerance - tol) < 1e-9);
      assert.strictEqual(bwdGetPut!.complement.calibrationNote, note);

      // PutGet: Forward(Backward(t')) === t'
      const perturbedTc = fwdTempC + (nextRand() - 0.5) * 40;
      const perturbedTgt = {
        kind: "SensorBlock",
        name: sName,
        properties: { name: sName, tempC: perturbedTc, tolerance: tol },
      };
      const bwdPut = transformer.evaluateRuleBackward(perturbedTgt, "modelica", {
        threadId: `lens:${i}`,
        strategy: "target-wins",
      });
      assert.ok(bwdPut, `PutGet backward evaluation failed at iteration ${i}`);
      const fwdPutGet = transformer.evaluateRuleForward(bwdPut!.sourceNode, "sysml2", `lens:${i}`);
      assert.ok(fwdPutGet, `PutGet forward evaluation failed at iteration ${i}`);
      const putGetTempC = (fwdPutGet!.targetNode.properties as Record<string, any>).tempC;
      assert.ok(Math.abs(putGetTempC - perturbedTc) < 1e-9);
    }
  });

  it("should share CompiledTGGPlan IR, stream syncSymbolDeltas, support dynamic CPA/name registries, and compile 4-edge WCOJ plans", () => {
    registerNodeDomain("CustomFmuBlock", "fmi3");
    registerNodeNameKey("customFmuId");

    const fmuRule = tggRule({
      name: "FmuToSysml",
      source: ($, v) => $.CustomFmuBlock({ customFmuId: v("fid"), gain: v("g") }),
      target: ($, v) => $.PartUsage({ name: v("fid"), gain: v("g") }),
      where: (v) => [tggEq(v("fid"), v("fid")), tggEq(v("g"), v("g"))],
    });

    const cpa = runCPA([fmuRule], { nodeDomainMap: { PartUsage: "sysml2" } });
    assert.strictEqual(cpa.hasConflicts, false);

    const plan = planTGGRules([fmuRule], { syntaxTypes: { CustomFmuBlock: 101, PartUsage: 202 } });
    assert.strictEqual(plan.rules.length, 1);
    assert.strictEqual(plan.rules[0]!.sourceTypeId, 101);
    assert.strictEqual(plan.rules[0]!.targetTypeId, 202);

    const transformer = new PolyglotTransformer({ plan });
    const delta1 = transformer.syncSymbolDeltas(
      {
        added: [{ kind: "CustomFmuBlock", name: "F1", properties: { customFmuId: "FMU_1", gain: 2.5 } }],
      },
      "sysml2",
    );
    assert.strictEqual(delta1.applied, 1);
    assert.strictEqual(delta1.targets[0]!.name, "FMU_1");

    const delta2 = transformer.syncSymbolDeltas({ removed: ["CustomFmuBlock:F1"] }, "sysml2");
    assert.strictEqual(delta2.retracted, 1);

    // 4-edge k-variable WCOJ plan
    const kPlan = planWcojPattern({
      name: "QuadJoin",
      variables: ["a", "b", "c", "d"],
      edges: [
        { fromVar: "a", toVar: "b", edgeType: "E1" },
        { fromVar: "b", toVar: "c", edgeType: "E2" },
        { fromVar: "c", toVar: "d", edgeType: "E3" },
        { fromVar: "d", toVar: "a", edgeType: "E4" },
      ],
    });
    const kCode = compileWcojMatcher(kPlan);
    assert.ok(kCode.includes("iter4Ptr"));
    assert.ok(kCode.includes("leapfrog_intersect_2(iter1Ptr, iter4Ptr, resultZSetPtr)"));
  });

  it("reuses and pins WASM scratch buffers across repeated A*, TSM compaction, and port alignment calls", () => {
    const prevWasm = getDefaultWasmExports();
    const memory = new WebAssembly.Memory({ initial: 2 });
    let nextOffset = 64;
    let newCount = 0;
    const pinned = new Set<number>();
    const unpinned: number[] = [];

    const mockWasm = {
      memory,
      __new: (size: number) => {
        newCount++;
        const ptr = nextOffset;
        nextOffset += (size + 7) & ~7 || 8;
        return ptr;
      },
      __pin: (ptr: number) => {
        pinned.add(ptr);
        return ptr;
      },
      __unpin: (ptr: number) => {
        pinned.delete(ptr);
        unpinned.push(ptr);
      },
      diagram_route_orthogonal_astar: (
        _c: number,
        _r: number,
        sx: number,
        sy: number,
        ex: number,
        ey: number,
        _sd: number,
        _bp: number,
        _cp: number,
        _g: number,
        _gs: number,
        _p: number,
        _cl: number,
        _hs: number,
        _hp: number,
        outPtr: number,
      ) => {
        const view = new Int32Array(memory.buffer, outPtr, 4);
        view[0] = sx;
        view[1] = sy;
        view[2] = ex;
        view[3] = ey;
        return 2;
      },
      diagram_tsm_compact_1d: (n: number, coordsPtr: number, outPtr: number) => {
        const inp = new Int32Array(memory.buffer, coordsPtr, n);
        const out = new Int32Array(memory.buffer, outPtr, n);
        for (let i = 0; i < n; i++) out[i] = inp[i]!;
        return n > 0 ? out[n - 1]! : 0;
      },
      diagram_port_align_1d: (
        n: number,
        targetsPtr: number,
        _s: number,
        _min: number,
        _max: number,
        outPtr: number,
      ) => {
        const inp = new Float64Array(memory.buffer, targetsPtr, n);
        const out = new Float64Array(memory.buffer, outPtr, n);
        out.set(inp);
      },
    };

    try {
      setCachedWasmExports(mockWasm);

      const grid = new Uint8Array(16);
      routeOrthogonalAStarWasm({ cols: 4, rows: 4, startX: 0, startY: 0, endX: 3, endY: 3, grid });
      const allocsAfterFirstAStar = newCount;
      assert.strictEqual(allocsAfterFirstAStar, 7);

      // Same-size and smaller calls must trigger ZERO new allocations
      routeOrthogonalAStarWasm({ cols: 4, rows: 4, startX: 1, startY: 1, endX: 2, endY: 2, grid });
      routeOrthogonalAStarWasm({ cols: 2, rows: 2, startX: 0, startY: 0, endX: 1, endY: 1, grid: new Uint8Array(4) });
      assert.strictEqual(newCount, allocsAfterFirstAStar, "Expected 0 allocations on same/smaller A* calls");

      compactTsm1DWasm(new Int32Array([0, 20, 40]));
      alignPorts1DWasm(new Float64Array([10, 20]), 5, 0, 100);
      const afterWarmup = newCount;
      compactTsm1DWasm(new Int32Array([5, 15, 25]));
      alignPorts1DWasm(new Float64Array([15, 25]), 5, 0, 100);
      assert.strictEqual(newCount, afterWarmup, "Expected 0 allocations on repeated TSM/port alignment calls");

      // Growing grid must unpin replaced scratch pointers before re-allocating
      routeOrthogonalAStarWasm({ cols: 6, rows: 6, startX: 0, startY: 0, endX: 5, endY: 5, grid: new Uint8Array(36) });
      assert.ok(unpinned.length >= 6, `Expected replaced scratch buffers to be unpinned, got ${unpinned.length}`);
      assert.ok(pinned.size >= 7, "Expected active scratch buffers to remain pinned");
    } finally {
      setCachedWasmExports(prevWasm);
    }
  });

  it("WasmPolyglotKernelBridge consolidates DBSP Z-Set deltas via WASM exports and falls back to exact TS parity", async () => {
    const { PolyglotTransformer, WasmPolyglotKernelBridge } = await import("../src/index.js");

    // 1. Mock linear-memory WASM DBSP Z-Set exports
    const heaps = new Map<number, Array<{ id: number; weight: number }>>();
    const consolidated = new Map<number, Array<{ id: number; weight: number }>>();
    let nextPtr = 1;
    const mockWasm = {
      createZSet: () => {
        const ptr = nextPtr++;
        heaps.set(ptr, []);
        return ptr;
      },
      zset_add: (ptr: number, id: number, weight: number) => {
        heaps.get(ptr)!.push({ id, weight });
      },
      zset_consolidate: (ptr: number) => {
        const map = new Map<number, number>();
        for (const item of heaps.get(ptr)!) {
          map.set(item.id, (map.get(item.id) ?? 0) + item.weight);
        }
        const surviving = Array.from(map.entries())
          .filter(([, w]) => w !== 0)
          .map(([id, weight]) => ({ id, weight }));
        consolidated.set(ptr, surviving);
        return surviving.length;
      },
      zset_count: (ptr: number) => consolidated.get(ptr)?.length ?? 0,
      zset_getElement: (ptr: number, idx: number) => consolidated.get(ptr)![idx]!.id,
      zset_getWeight: (ptr: number, idx: number) => consolidated.get(ptr)![idx]!.weight,
    };

    const sampleDeltas = {
      added: [
        { id: "Motor", kind: "model", name: "Motor" },
        { id: "TempSensor", kind: "model", name: "TempSensor" },
      ],
      removed: ["TempSensor", "LegacyValve"],
    };

    const wasmBridge = new WasmPolyglotKernelBridge(mockWasm);
    const wasmRes = wasmBridge.consolidateDeltas(sampleDeltas);
    assert.strictEqual(wasmRes.usedWasmZSet, true);
    assert.strictEqual(wasmRes.cancelledCount, 2, "TempSensor (+1/-1) should cancel out inside Z-Set");
    assert.deepStrictEqual(
      wasmRes.added.map((n) => n.name),
      ["Motor"],
    );
    assert.deepStrictEqual(wasmRes.removed, ["LegacyValve"]);

    // 2. Compare against pure-TS fallback parity
    const tsBridge = new WasmPolyglotKernelBridge(null);
    const tsRes = tsBridge.consolidateDeltas(sampleDeltas);
    assert.strictEqual(tsRes.usedWasmZSet, false);
    assert.strictEqual(tsRes.cancelledCount, 2);
    assert.deepStrictEqual(
      tsRes.added.map((n) => n.name),
      wasmRes.added.map((n) => n.name),
    );
    assert.deepStrictEqual(tsRes.removed, wasmRes.removed);
    void PolyglotTransformer;
  });

  it("WasmPolyglotKernelBridge auto-hydrates real compiled AssemblyScript DBSP Z-Set exports by default", async () => {
    const { WasmPolyglotKernelBridge, setCachedWasmExports } = await import("../src/index.js");
    const prevGlobal = (globalThis as { __modelscript_wasm_exports__?: unknown }).__modelscript_wasm_exports__;
    setCachedWasmExports(null);
    delete (globalThis as { __modelscript_wasm_exports__?: unknown }).__modelscript_wasm_exports__;
    try {
      const bridge = new WasmPolyglotKernelBridge();
      assert.strictEqual(
        bridge.isWasmZSetAvailable(),
        true,
        "Expected compiled build/release.wasm to expose DBSP Z-Set exports via getDefaultWasmExports()",
      );
      const res = bridge.consolidateDeltas({
        added: [
          { id: "Pump", kind: "model", name: "Pump" },
          { id: "Transient", kind: "model", name: "Transient" },
        ],
        updated: [{ id: "Valve", kind: "model", name: "Valve" }],
        removed: ["Transient", "OldPipe"],
      });
      assert.strictEqual(res.usedWasmZSet, true);
      assert.strictEqual(res.cancelledCount, 2);
      assert.deepStrictEqual(
        res.added.map((n) => n.name),
        ["Pump"],
      );
      assert.deepStrictEqual(
        res.updated.map((n) => n.name),
        ["Valve"],
      );
      assert.deepStrictEqual(res.removed, ["OldPipe"]);
    } finally {
      setCachedWasmExports(prevGlobal ?? null);
    }
  });
});
