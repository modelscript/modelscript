// SPDX-License-Identifier: AGPL-3.0-or-later
import { tggEq, tggInvertible, tggRewriteRule, tggRule } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import { ConstraintTheoryOracle } from "../src/formal/oracles/constraint_oracle.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";
import { maskCommentsPreservingOffsets, parseModelicaCst } from "../src/interop/cst-polyglot-adapters.js";
import { PolyglotTransformer } from "../src/interop/polyglot-transformer.js";
import { COORDINATOR_SCENARIOS } from "../src/interop/polyglot_coordinator_factory.js";
import { runDigitalThreadAssertionLoop } from "../src/interop/semantic_coordinator_pipeline.js";
import { TggCorrespondenceIndexer, TggSymbolProjectionTable } from "../src/interop/tgg-correspondence-indexer.js";
import { solveWhereConstraints } from "../src/interop/tgg-pattern-interpreter.js";
import { DigitalThreadHypergraph } from "../src/interop/thread_hypergraph.js";
import { WasmPolyglotKernelBridge } from "../src/interop/wasm-polyglot-bridge.js";
import { WasmQueryEngine } from "../src/workspace/query_engine.js";

const makePolyglotSymbolId = (domain: number, localId: number): number => (((domain & 0x7f) << 24) | localId) >>> 0;

describe("TGG Engine Review Regressions (P0/P1/P2)", () => {
  it("WasmCorrespondenceBridge executes O(|subtree|) multi-level cascading invalidation and safe >2048B complement alloc in live WASM", () => {
    const bridge = new WasmPolyglotKernelBridge();
    assert.strictEqual(bridge.isWasmCorrespondenceAvailable(), true);

    const corr = bridge.createCorrespondenceBridge(64);
    assert.ok(corr, "Should instantiate live WASM CorrespondenceIndex");

    // 3-level hierarchy: root -> child -> grandchild
    const rootSlot = corr.addLink(100, 200, 1);
    const childSlot = corr.addLinkWithParent(101, 201, rootSlot, 2);
    const grandChildSlot = corr.addLinkWithParent(102, 202, childSlot, 3);
    const unrelatedSlot = corr.addLink(999, 1999, 1);

    assert.strictEqual(corr.findBySource(100), 200);
    assert.strictEqual(corr.findByTarget(202), 102);

    // Cascading invalidation must mark root, child, and grandchild (3 slots), leaving unrelatedSlot clean
    const count = corr.markStaleCascading(rootSlot);
    assert.strictEqual(count, 3);

    const staleSlots = corr.drainStaleSlots();
    assert.deepStrictEqual(
      staleSlots.sort((a, b) => a - b),
      [rootSlot, childSlot, grandChildSlot].sort((a, b) => a - b),
    );
    assert.ok(!staleSlots.includes(unrelatedSlot));
    assert.deepStrictEqual(corr.drainStaleSlots(), []);

    // P0 heap overflow regression: freeing a 2048B complement must NOT be handed back for a 4096B request
    const ptr2048 = corr.allocComplement(2048);
    assert.ok(ptr2048 > 0);
    corr.freeComplement(ptr2048);
    const ptr4096 = corr.allocComplement(4096);
    assert.ok(ptr4096 > 0);
    assert.notStrictEqual(ptr4096, ptr2048, "4096B allocation must bypass the 2048B freelist class");

    // Retraction removes both forward and reverse mappings
    assert.strictEqual(corr.retractBySource(101), 201);
    assert.strictEqual(corr.findBySource(101), 0);
    assert.strictEqual(corr.findByTarget(201), 0);

    corr.reset();
  });

  it("WasmQueryEngine supports 93+ language domains in memoKey() and maps SymbolId to hypergraph slot on invalidate()", () => {
    const symA = makePolyglotSymbolId(85, 10);
    const symB = makePolyglotSymbolId(93, 10);
    const index: any = {
      symbols: new Map([
        [symA, { id: symA, name: "Turbine", kind: "class", parentId: null, startOffset: 0, endOffset: 10 }],
        [symB, { id: symB, name: "Turbine", kind: "class", parentId: null, startOffset: 0, endOffset: 10 }],
      ]),
      byName: new Map([["Turbine", [symA, symB]]]),
      childrenOf: new Map([[0, [symA, symB]]]),
    };

    const engine = new WasmQueryEngine(index);
    const keyA = engine.memoKey("resolveType", symA);
    const keyB = engine.memoKey("resolveType", symB);
    assert.notStrictEqual(keyA, keyB, "Domains 85 and 93 must produce distinct memoKeys");
    assert.ok(Number.isSafeInteger(keyA) && Number.isSafeInteger(keyB));

    // Attach DigitalThreadHypergraph and verify invalidate() marks the mapped slot (0), not raw SymbolId
    const hg = new DigitalThreadHypergraph();
    const slot0 = hg.createThread(5001);
    const slot1 = hg.createThread(5002);
    hg.bindDomainNode(slot0, 0, symA);
    hg.bindDomainNode(slot0, 1, symB);

    const slotMap = new Map<number, number>([
      [symA, slot0],
      [symB, slot0],
    ]);
    const slotsBySymbol = new Map<number, Set<number>>([
      [symA, new Set([slot0])],
      [symB, new Set([slot0])],
    ]);
    engine.setCorrespondenceIndex(hg, slotMap, slotsBySymbol);

    engine.invalidate(new Set([symA]));
    assert.strictEqual(hg.isStale(slot0), true, "Mapped slot0 should be marked stale");
    assert.strictEqual(hg.isStale(slot1), false, "Unrelated slot1 must remain clean");
  });

  it("PolyglotTransformer.applyInPlaceDPO detects Identification Violations and Dangling Edges on { source, target } connections", () => {
    const transformer = new PolyglotTransformer();

    // 1. Identification Condition: preserve + delete mapping to the same host component
    const idViolationRule = tggRewriteRule("IdentifyConflict")
      .inPlace("modelica", (ctx) => {
        ctx.preserve("Resistor", { name: "__var_r" });
        ctx.delete("Resistor", { name: "__var_r" });
      })
      .build();

    const container1: any = {
      name: "Circuit",
      kind: "model",
      components: [{ name: "R1", typeSpecifier: "Resistor" }],
      connections: [],
    };
    const res1 = transformer.applyInPlaceDPO(idViolationRule, container1, { r: "R1" });
    assert.strictEqual(res1.success, false);
    assert.strictEqual(res1.status, "IDENTIFICATION_VIOLATION");

    // 2. Dangling Edge Condition on standard PolyglotNode { source, target } connections
    const danglingRule = tggRewriteRule("DeleteR1")
      .inPlace("modelica", (ctx) => {
        ctx.delete("Resistor", { name: "__var_r" });
      })
      .build();

    const container2: any = {
      name: "Circuit",
      kind: "model",
      components: [
        { name: "R1", typeSpecifier: "Resistor" },
        { name: "C1", typeSpecifier: "Capacitor" },
      ],
      connections: [{ source: "R1.n", target: "C1.p" }],
    };
    const res2 = transformer.applyInPlaceDPO(danglingRule, container2, { r: "R1" });
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.status, "DANGLING_EDGE_VIOLATION");
  });

  it("WasmPolyglotKernelBridge cancels added + updated + removed cleanly and tgg-pattern-interpreter handles -2^2 and fixpoint chains", () => {
    const bridge = new WasmPolyglotKernelBridge(null);
    const node = { id: "X1", kind: "Part", name: "X1" };
    const consolidated = bridge.consolidateDeltas({
      added: [node],
      updated: [node],
      removed: ["X1"],
    });
    assert.strictEqual(consolidated.added.length, 0);
    assert.strictEqual(consolidated.updated.length, 0);
    assert.strictEqual(consolidated.removed.length, 0);

    // Fixpoint chain of 4 dependent equalities in reverse order + unary minus exponentiation precedence
    const rule = tggRule({
      name: "ChainRule",
      source: ($, v) => $.Src({ a: v("a") }),
      target: ($, v) => $.Tgt({ d: v("d") }),
      where: (v) => [
        tggEq(v("c"), v("d")),
        tggEq(v("b"), v("c")),
        tggEq(v("a"), v("b")),
        tggInvertible("negSq = -a^2", "a = negSq"),
      ],
    });
    const env: Record<string, any> = { a: 2 };
    solveWhereConstraints(
      rule.where!((n: string) => `__var_${n}`),
      env,
      "forward",
    );
    assert.strictEqual(env["d"], 2, "4-step reverse equality chain must converge via fixpoint");
    assert.strictEqual(env["negSq"], -4, "-2^2 must evaluate to -4 (unary minus looser than ^)");
  });

  it("CST adapters preserve single-quoted identifiers and distinguish String bindings from descriptions", () => {
    const src = `model M\n  parameter String label = "hello";\n  Real 'a//b' = 1.0; // trailing comment\nend M;`;
    const masked = maskCommentsPreservingOffsets(src);
    assert.ok(masked.includes("'a//b'"), "Single-quoted identifier containing // must not be masked");
    assert.ok(!masked.includes("trailing comment"), "Real line comment must be masked");

    const cst = parseModelicaCst(src);
    const labelComp = cst.components.find((c) => c.name === "label");
    assert.ok(labelComp, "Should parse parameter String label");
    assert.strictEqual(labelComp.bindingExpr, '"hello"');
    assert.strictEqual(labelComp.description, undefined);
  });

  it("Phase 3: TggCorrespondenceIndexer mirrors links to WASM CorrespondenceIndex and PolyglotTransformer dispatches attached WASM TGG modules", () => {
    const table = new TggSymbolProjectionTable();
    table.registerRule(
      tggRule({
        name: "PartToClass",
        sourceLang: "sysml2",
        targetLang: "modelica",
        source: ($, v) => $.PartDefinition({ name: v("n") }),
        target: ($, v) => $.ClassDefinition({ name: v("n") }),
      }),
    );
    table.registerRule(
      tggRule({
        name: "AttrToComp",
        sourceLang: "sysml2",
        targetLang: "modelica",
        context: {
          source: ($) => $.PartDefinition({}),
          target: ($) => $.ClassDefinition({}),
        },
        source: ($, v) => $.AttributeUsage({ name: v("n") }),
        target: ($, v) => $.ComponentDeclaration({ name: v("n") }),
      }),
    );
    const indexer = new TggCorrespondenceIndexer(table);
    const sysmlId = makePolyglotSymbolId(1, 10);
    const moId = makePolyglotSymbolId(2, 20);
    const sysmlAttrId = makePolyglotSymbolId(1, 11);
    const moParamId = makePolyglotSymbolId(2, 21);

    const index = {
      symbols: new Map<number, any>([
        [
          sysmlId,
          {
            id: sysmlId,
            name: "Motor",
            kind: "Class",
            ruleName: "PartDefinition",
            language: "sysml2",
            parentId: null,
            resourceId: "a.sysml",
            metadata: {},
          },
        ],
        [
          moId,
          {
            id: moId,
            name: "Motor",
            kind: "Class",
            ruleName: "ClassDefinition",
            language: "modelica",
            parentId: null,
            resourceId: "a.mo",
            metadata: {},
          },
        ],
        [
          sysmlAttrId,
          {
            id: sysmlAttrId,
            name: "R",
            kind: "Field",
            ruleName: "AttributeUsage",
            language: "sysml2",
            parentId: sysmlId,
            resourceId: "a.sysml",
            metadata: {},
          },
        ],
        [
          moParamId,
          {
            id: moParamId,
            name: "R",
            kind: "Field",
            ruleName: "ComponentDeclaration",
            language: "modelica",
            parentId: moId,
            resourceId: "a.mo",
            metadata: {},
          },
        ],
      ]),
      byName: new Map<string, number[]>([
        ["Motor", [sysmlId, moId]],
        ["R", [sysmlAttrId, moParamId]],
      ]),
      childrenOf: new Map<number | null, number[]>([
        [null, [sysmlId, moId]],
        [sysmlId, [sysmlAttrId]],
        [moId, [moParamId]],
      ]),
      symbolsByResource: new Map<string, number[]>(),
    } as any;

    indexer.syncIndex(index, 1);
    const wasmCorr = indexer.getWasmCorrespondenceBridge();
    assert.ok(wasmCorr, "TggCorrespondenceIndexer should hydrate WasmCorrespondenceBridge");
    const rootTarget = wasmCorr.findBySource(sysmlId) || wasmCorr.findByTarget(sysmlId);
    assert.strictEqual(rootTarget, moId, "Root link should be mirrored into WASM CorrespondenceIndex");
    const childTarget = wasmCorr.findBySource(sysmlAttrId) || wasmCorr.findByTarget(sysmlAttrId);
    assert.strictEqual(childTarget, moParamId, "Child link should be mirrored into WASM CorrespondenceIndex");
    const staleSlots = indexer.markSymbolStaleCascading(sysmlId);
    assert.ok(staleSlots.length >= 2, "markSymbolStaleCascading should mark both parent and child stale in WASM");

    // Verify PolyglotTransformer WASM dispatch attachment
    const transformer = new PolyglotTransformer();
    assert.strictEqual(transformer.hasWasmTggModule(), false);
    const calls: string[] = [];
    transformer.attachWasmTggModule(
      {
        tgg_forward_dispatch: (hash, srcId, corrPtr) => {
          calls.push(`fwd:${hash}:${srcId}:${corrPtr}`);
          return 777;
        },
        tgg_retract_dispatch: (hash, srcId, corrPtr) => {
          calls.push(`ret:${hash}:${srcId}:${corrPtr}`);
          return 1;
        },
        tgg_propagate_all_stale: (corrPtr, _pool, dir) => {
          calls.push(`prop:${corrPtr}:${dir}`);
          return 2;
        },
      },
      { corrBridge: wasmCorr, arenaPtr: 42, stringPoolPtr: 99 },
    );
    assert.strictEqual(transformer.hasWasmTggModule(), true);
    assert.strictEqual(transformer.dispatchWasmForward(123, sysmlId), 777);
    assert.strictEqual(transformer.propagateWasmStale(1), 2);
    assert.strictEqual(transformer.dispatchWasmRetract(123, sysmlId), 1);
    assert.deepStrictEqual(calls, [
      `fwd:123:${sysmlId}:${wasmCorr.ptr}`,
      `prop:${wasmCorr.ptr}:1`,
      `ret:123:${sysmlId}:${wasmCorr.ptr}`,
    ]);
  });

  it("Phase 4: COORDINATOR_SCENARIOS is modularized and semantic_coordinator_pipeline preserves per-requirement packages and SAT conflicts", () => {
    assert.strictEqual(COORDINATOR_SCENARIOS.length, 3, "All 3 curated scenarios must remain exported");
    const robotics = COORDINATOR_SCENARIOS.find((s) => s.id === "robotics-gdt-tolerance");
    assert.ok(robotics, "robotics-gdt-tolerance scenario must be present");
    const defaults = robotics.panes.map((p) => p.defaultCode) as [string, string, string, string];
    const presetRes = robotics.presets[1]!.apply(defaults);
    assert.ok(presetRes.codes[3].includes("0.028"), "STEP preset update via splitTopLevelCommaList should update #12");

    // Verify runDigitalThreadAssertionLoop preserves satRes.conflict even when prior conflicts exist
    // and uses each requirement's own packageName
    const coord = new SemanticTheoryCoordinator();
    coord.registerOracle(new ConstraintTheoryOracle());
    const hg = new DigitalThreadHypergraph();
    const slot = hg.createThread(5001, 1);
    const conflicts: any[] = [
      { literals: [], explanation: "Prior domain warning", culpritEntities: ["x"], theoryName: "CAE" },
    ];
    const loopRes = runDigitalThreadAssertionLoop({
      coordinator: coord,
      hypergraph: hg,
      threadSlot: slot,
      panes: [{ lang: "sysml2", namespaceFqn: "SysML2::DefaultPkg" }],
      codes: [""],
      sysmlReqs: [
        {
          requirementName: "ReqA",
          packageName: "PkgA",
          subjectName: "SubA",
          targetAttribute: "mass",
          operator: "<=",
          limitValue: 5.0,
        },
        {
          requirementName: "ReqB",
          packageName: "PkgB",
          subjectName: "SubB",
          targetAttribute: "mass",
          operator: "<=",
          limitValue: 10.0,
        },
      ],
      directiveLinks: [],
      variableLinks: [{ canonicalFqn: "SysML2::PkgB::SubB.mass", valueFormatted: "25.0 kg" }],
      conflicts,
      paneDiagnostics: [[]],
      lintSyntaxForLang: () => [],
    });
    assert.strictEqual(loopRes.isSat, false, "PkgB.mass == 25.0 violates <= 10.0");
    assert.strictEqual(
      conflicts.length,
      2,
      "satRes.conflict must be preserved alongside existing conflicts rather than silently dropped",
    );
  });
});
