// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildSemanticTagTable, getNodeSemanticTags, nodeHasSemanticTag, SemanticCstTag } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  assembleDaeCausalTrace,
  assembleSmtCausalTrace,
  BinOp,
  CapabilityViolationError,
  Causality,
  compileTggRuleBytecode,
  createIndexBackedInteropLibrary,
  createMemoryViews,
  DAEBuilder,
  defaultUnboxedExternalFunctions,
  DigitalThreadHypergraph,
  eliminateArenaAliases,
  ensureMemoryCapacity,
  EqKind,
  evaluateArenaRuntime,
  executeTggBytecode,
  freezeSymbolIndex,
  getDomainLanguageName,
  getLanguageDomainId,
  initBltWasm,
  InteropTrait,
  LanguageDomainId,
  makePolyglotSymbolId,
  performBltTransformationArena,
  PolyglotDaeInliner,
  PolyglotEngine,
  projectTraceToLspRelatedInfo,
  ProvenanceGraph,
  registerDefaultInteropLibraries,
  registerLanguageDomain,
  type SymbolEntry,
  type SymbolIndex,
  SymbolInteropRegistry,
  TggPicDispatcher,
  TggSymbolProjectionTable,
  ThreadDomain,
  UnboxedExternalFunctionRegistry,
  UnifiedWorkspace,
  Variability,
  VarType,
} from "../src/index.js";

function makeSymbol(
  id: number,
  name: string,
  kind: string,
  parentId: number | null = null,
  resourceId = "file:///test.mo",
  metadata: Record<string, unknown> = {},
): SymbolEntry {
  return {
    id,
    name,
    kind,
    ruleName: kind.toLowerCase(),
    namePath: "name",
    startOffset: 10,
    endOffset: 40,
    parentId,
    exports: [],
    inherits: [],
    metadata,
    fieldName: null,
    resourceId,
  };
}

function makeIndex(entries: SymbolEntry[]): SymbolIndex {
  const symbols = new Map<number, SymbolEntry>();
  const byName = new Map<string, number[]>();
  const childrenOf = new Map<number | null, number[]>();
  for (const e of entries) {
    symbols.set(e.id, e);
    const list = byName.get(e.name) ?? [];
    list.push(e.id);
    byName.set(e.name, list);
    const kids = childrenOf.get(e.parentId) ?? [];
    kids.push(e.id);
    childrenOf.set(e.parentId, kids);
  }
  return { symbols, byName, childrenOf };
}

describe("GraalVM-Inspired Polyglot Interop Suite (Workstreams A–F)", () => {
  it("Workstream A: Dynamic 8-bit domain registry & trait-based SymbolInteropProtocol", () => {
    const spiceDomain = registerLanguageDomain("spice");
    const verilogADomain = registerLanguageDomain("verilog-a");
    assert.ok(spiceDomain >= 0x20 && spiceDomain <= 0xff);
    assert.notStrictEqual(spiceDomain, verilogADomain);
    assert.strictEqual(getLanguageDomainId("spice"), spiceDomain);
    assert.strictEqual(getDomainLanguageName(spiceDomain), "spice");
    // Well-known domains remain unchanged
    assert.strictEqual(getLanguageDomainId("modelica"), LanguageDomainId.Modelica);

    const resistorId = makePolyglotSymbolId(spiceDomain, 1);
    const pinPId = makePolyglotSymbolId(spiceDomain, 2);
    const paramRId = makePolyglotSymbolId(spiceDomain, 3);
    const index = makeIndex([
      makeSymbol(resistorId, "R1", "Subckt", null, "file:///rc.cir", {
        bounds: [0, 0, 0, 10, 5, 2],
        requirements: [{ target: "REQ-001", relation: "satisfies" }],
      }),
      makeSymbol(pinPId, "p", "Pin", resistorId, "file:///rc.cir", {
        type: "ElectricalNode",
        direction: "inout",
        isFlow: true,
      }),
      makeSymbol(paramRId, "R", "Parameter", resistorId, "file:///rc.cir", {
        type: "Real",
        value: "100.0",
        unit: "Ohm",
      }),
    ]);

    const registry = new SymbolInteropRegistry();
    registry.register(createIndexBackedInteropLibrary(spiceDomain, "spice"));

    const traits = registry.getTraits(resistorId, index);
    assert.ok((traits & InteropTrait.HasPorts) !== 0);
    assert.ok((traits & InteropTrait.HasParameters) !== 0);
    assert.ok((traits & InteropTrait.HasGeometry) !== 0);
    assert.ok((traits & InteropTrait.HasRequirements) !== 0);

    const streamedPorts: string[] = [];
    registry.getForSymbol(resistorId)!.readPorts!(
      resistorId,
      (name, portType) => streamedPorts.push(`${name}:${portType}`),
      index,
    );
    assert.deepStrictEqual(streamedPorts, ["p:ElectricalNode"]);

    const bounds = new Float64Array(6);
    assert.strictEqual(registry.getForSymbol(resistorId)!.readGeometryBounds!(resistorId, bounds, index), true);
    assert.deepStrictEqual(Array.from(bounds), [0, 0, 0, 10, 5, 2]);

    // Legacy PolyglotNode compatibility bridge still works lazily
    const dto = registry.materializePolyglotNode(resistorId, index);
    assert.strictEqual(dto?.name, "R1");
    assert.strictEqual(dto?.ports?.length, 1);
    assert.strictEqual(dto?.attributes?.length, 1);
  });

  it("Workstream B: Standard Semantic CST Tags (O(1) kindId table + default inference)", () => {
    const table = buildSemanticTagTable(
      ["stored_definition", "class_definition", "connect_clause", "port_usage", "custom_node"],
      { custom_node: SemanticCstTag.Geometry | SemanticCstTag.Declaration },
    );

    assert.strictEqual(nodeHasSemanticTag({ type: "class_definition", kindId: 1 }, SemanticCstTag.Scope, table), true);
    assert.strictEqual(
      nodeHasSemanticTag({ type: "connect_clause", kindId: 2 }, SemanticCstTag.Connection, table),
      true,
    );
    assert.strictEqual(nodeHasSemanticTag({ type: "port_usage", kindId: 3 }, SemanticCstTag.Port, table), true);
    assert.strictEqual(
      getNodeSemanticTags({ type: "custom_node", kindId: 4 }, table),
      SemanticCstTag.Geometry | SemanticCstTag.Declaration,
    );
  });

  it("Workstream C: Polymorphic Inline Cache (PIC) for TGG dispatch (mono -> poly -> mega + WASM diff parity)", async () => {
    const pic = new TggPicDispatcher<{ name: string }>({ mode: "ts" });
    const r0 = pic.register(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica, { name: "PartToModel" });
    const r1 = pic.register(LanguageDomainId.SysML2, "port_usage", LanguageDomainId.Modelica, {
      name: "PortToConnector",
    });
    const r2 = pic.register(LanguageDomainId.ReqIF, "spec_object", LanguageDomainId.SysML2, {
      name: "ReqToRequirement",
    });

    // First lookup hits megamorphic table and promotes to mono + poly
    assert.strictEqual(pic.lookupRuleId(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica), r0);
    // Repeated lookups hit monomorphic fast path
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(
        pic.lookup(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica)?.name,
        "PartToModel",
      );
    }
    // Second & third shapes hit mega then poly
    assert.strictEqual(pic.lookupRuleId(LanguageDomainId.SysML2, "port_usage", LanguageDomainId.Modelica), r1);
    assert.strictEqual(pic.lookupRuleId(LanguageDomainId.ReqIF, "spec_object", LanguageDomainId.SysML2), r2);
    // Re-lookup r0 hits polymorphic cache line (not mega!)
    assert.strictEqual(pic.lookupRuleId(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica), r0);
    // Miss returns -1
    assert.strictEqual(pic.lookupRuleId(LanguageDomainId.STEP_CAD, "unknown", LanguageDomainId.Modelica), -1);

    const stats = pic.getStats();
    assert.strictEqual(stats.monoHits, 10);
    assert.strictEqual(stats.polyHits, 1);
    assert.strictEqual(stats.megaHits, 3);
    assert.strictEqual(stats.misses, 1);
    pic.dispose();

    // Hydrate runtime WASM module and verify WASM linear-memory PIC in strict diff mode
    const wasmPic = new TggPicDispatcher<{ name: string }>({ mode: "diff" });
    assert.strictEqual(wasmPic.isWasmActive(), true);
    const w0 = wasmPic.register(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica, {
      name: "PartToModel",
    });
    const w1 = wasmPic.register(LanguageDomainId.ReqIF, "spec_object", LanguageDomainId.SysML2, { name: "ReqToReq" });
    assert.strictEqual(wasmPic.lookupRuleId(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica), w0);
    assert.strictEqual(wasmPic.lookupRuleId(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica), w0);
    assert.strictEqual(wasmPic.lookupRuleId(LanguageDomainId.ReqIF, "spec_object", LanguageDomainId.SysML2), w1);
    assert.strictEqual(wasmPic.lookupRuleId(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica), w0);
    assert.strictEqual(wasmPic.lookupRuleId(LanguageDomainId.STEP_CAD, "missing", LanguageDomainId.Modelica), -1);
    const wasmStats = wasmPic.getStats();
    assert.strictEqual(wasmStats.usedWasm, true);
    assert.strictEqual(wasmStats.monoHits, 1);
    assert.strictEqual(wasmStats.polyHits, 1);
    assert.strictEqual(wasmStats.megaHits, 2);
    assert.strictEqual(wasmStats.misses, 1);
    wasmPic.dispose();
  });

  it("Workstream D: Cross-Language DAE Inlining (Modelica + SPICE) & Unboxed External FFI", () => {
    const spiceDomain = registerLanguageDomain("spice");
    const spiceResistorSym = makePolyglotSymbolId(spiceDomain, 42);
    const modelicaHostSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 7);

    const registry = new SymbolInteropRegistry();
    registry.register({
      domainId: spiceDomain,
      languageId: "spice",
      getTraits: () => InteropTrait.HasPorts | InteropTrait.HasParameters | InteropTrait.LowerableDAE,
      lowerToDAE(_symId, dae, prefix, overrides) {
        const R = overrides?.get("R") ?? 100.0;
        const vP = dae.addVariable(`${prefix}.p.v`, VarType.Real, Variability.Continuous, Causality.Local, 0);
        const iP = dae.addVariable(`${prefix}.p.i`, VarType.Real, Variability.Continuous, Causality.Local, 0);
        const vN = dae.addVariable(`${prefix}.n.v`, VarType.Real, Variability.Continuous, Causality.Local, 0);
        const iN = dae.addVariable(`${prefix}.n.i`, VarType.Real, Variability.Continuous, Causality.Local, 0);

        // Ohm's law: vP - vN = R * iP
        const dv = dae.addBinaryExpr(BinOp.Sub, dae.addName(vP), dae.addName(vN));
        const rTimesI = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(R), dae.addName(iP));
        dae.addEquation(EqKind.Simple, dv, rTimesI);
        // KCL inside 2-pin resistor: iP + iN = 0
        const iSum = dae.addBinaryExpr(BinOp.Add, dae.addName(iP), dae.addName(iN));
        dae.addEquation(EqKind.Simple, iSum, dae.addRealLiteral(0));

        return {
          prefix,
          addedVars: 4,
          addedEqs: 2,
          ports: [
            { portName: "p", portType: "Pin", potentialVarId: vP, flowVarId: iP },
            { portName: "n", portType: "Pin", potentialVarId: vN, flowVarId: iN },
          ],
        };
      },
    });

    const dae = new DAEBuilder();
    const inliner = new PolyglotDaeInliner(registry);

    // Host Modelica source pin
    const hostVp = dae.addVariable("src.p.v", VarType.Real, Variability.Continuous, Causality.Local, 5.0);
    const hostIp = dae.addVariable("src.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    inliner.originMap.setVarOrigin(hostVp, modelicaHostSym);

    assert.strictEqual(inliner.canInline(spiceResistorSym), true);
    const handle = inliner.inlineComponent(spiceResistorSym, dae, "r_spice", new Map([["R", 250.0]]));
    assert.strictEqual(handle.varRange[1] - handle.varRange[0], 4);
    assert.strictEqual(handle.eqRange[1] - handle.eqRange[0], 2);

    // Bind Modelica host port to inlined SPICE port (emits v equality + i conservation)
    const boundEqs = inliner.bindPorts(
      dae,
      { portName: "p", portType: "Pin", potentialVarId: hostVp, flowVarId: hostIp },
      handle.portsByName.get("p")!,
      modelicaHostSym,
    );
    assert.strictEqual(boundEqs.length, 2);
    assert.strictEqual(inliner.originMap.getEqOrigin(handle.eqRange[0]), spiceResistorSym);
    assert.strictEqual(inliner.originMap.getEqOrigin(boundEqs[0]!), modelicaHostSym);

    // Unboxed external FFI (zero-allocation linear-memory scratch call)
    const extFns = new UnboxedExternalFunctionRegistry();
    const diodeId = extFns.register("spice_diode_i", (mem, argsOff, _argCount, outOff) => {
      const vd = mem[argsOff]!;
      const isat = mem[argsOff + 1]!;
      mem[outOff] = isat * (Math.exp(vd / 0.02585) - 1);
      return 0;
    });
    const current = extFns.invokeScalar2(diodeId, 0.02585, 1e-12);
    assert.ok(Math.abs(current - 1e-12 * (Math.E - 1)) < 1e-18);

    dae.free?.();
  });

  it("Workstream E: PolyglotEngine vs. PolyglotContext isolation & capabilities", () => {
    const stdlibSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
    const frozenMsl = freezeSymbolIndex(
      "MSL",
      "4.0.0",
      makeIndex([makeSymbol(stdlibSym, "Resistor", "Model", null, "file:///msl/Resistor.mo")]),
    );

    const engine = new PolyglotEngine().registerFrozenLibrary(frozenMsl);
    const ctxA = engine.createContext({
      contextId: "tenant-A",
      capabilities: {
        allowExternalSolvers: false,
        allowFileSystemRead: ["/workspace/a/"],
        maxWasmMemoryPages: 512,
        enabledDomains: new Set([LanguageDomainId.Modelica]),
      },
    });
    const ctxB = engine.createContext({ contextId: "tenant-B" });

    // Both share frozen MSL zero-copy
    assert.strictEqual(ctxA.getSymbol(stdlibSym)?.name, "Resistor");
    assert.strictEqual(ctxB.getSymbol(stdlibSym)?.name, "Resistor");

    // Context-local edit in B is invisible to A
    const customSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 99);
    ctxB.upsertSymbol(makeSymbol(customSym, "MyCircuit", "Model", null, "file:///b/MyCircuit.mo"));
    assert.strictEqual(ctxB.getSymbol(customSym)?.name, "MyCircuit");
    assert.strictEqual(ctxA.getSymbol(customSym), undefined);

    // Capability enforcement in A
    assert.throws(() => ctxA.assertExternalSolversAllowed(), CapabilityViolationError);
    assert.throws(() => ctxA.assertFileReadAllowed("/etc/passwd"), CapabilityViolationError);
    assert.doesNotThrow(() => ctxA.assertFileReadAllowed("/workspace/a/model.mo"));
    assert.throws(() => ctxA.assertWasmMemoryAllowed(1024), CapabilityViolationError);
    assert.throws(() => ctxA.assertDomainAllowed(LanguageDomainId.SysML2), CapabilityViolationError);

    ctxA.dispose();
    ctxB.dispose();
    engine.dispose();
  });

  it("Workstream F: Unified Cross-Language Causal Traces (DAE + SMT -> LSP relatedInformation)", async () => {
    const reqSym = makePolyglotSymbolId(LanguageDomainId.ReqIF, 1);
    const sysmlSym = makePolyglotSymbolId(LanguageDomainId.SysML2, 2);
    const moSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 3);

    const index = makeIndex([
      makeSymbol(reqSym, "REQ_MAX_CURRENT", "Requirement", null, "file:///reqs/power.reqif"),
      makeSymbol(sysmlSym, "PowerStage", "PartDef", null, "file:///arch/power.sysml"),
      makeSymbol(moSym, "BuckConverter", "Model", null, "file:///sim/buck.mo"),
    ]);

    const hg = new DigitalThreadHypergraph();
    const slot = hg.createThread(5001);
    hg.bindDomainNode(slot, ThreadDomain.Requirements, reqSym);
    hg.bindDomainNode(slot, ThreadDomain.SysML2, sysmlSym);
    hg.bindDomainNode(slot, ThreadDomain.Modelica, moSym);

    const prov = new ProvenanceGraph();
    prov.addEntity({ id: "ent:req", type: "Requirement", label: "REQ_MAX_CURRENT", attributes: { symbolId: reqSym } });
    prov.addEntity({
      id: "ent:mo",
      type: "Model",
      label: "BuckConverter",
      wasDerivedFrom: ["ent:req"],
      attributes: { symbolId: moSym },
    });

    const smtDiag = assembleSmtCausalTrace({
      code: "MS_CONFLICT_001",
      conflict: {
        theoryName: "ConstraintTheoryOracle",
        literals: [],
        culpritEntities: ["BuckConverter.I_L"],
        explanation: "Peak inductor current exceeds REQ_MAX_CURRENT (12A > 10A)",
      },
      threadSlot: slot,
      hypergraph: hg,
      symbolSource: index,
      provenance: prov,
      rootProvenanceEntityId: "ent:mo",
    });

    assert.strictEqual(smtDiag.frames.length, 3);
    const langs = smtDiag.frames.map((f) => f.languageId);
    assert.ok(langs.includes("reqif"));
    assert.ok(langs.includes("sysml2"));
    assert.ok(langs.includes("modelica"));

    const related = projectTraceToLspRelatedInfo(smtDiag);
    assert.strictEqual(related.length, 3);
    assert.ok(related.some((r) => r.location.uri === "file:///reqs/power.reqif"));

    // Also test DAE causal trace
    const inliner = new PolyglotDaeInliner(new SymbolInteropRegistry());
    inliner.originMap.setEqOrigin(7, moSym);
    const daeDiag = assembleDaeCausalTrace({
      code: "MS_BLT_SINGULAR",
      summary: "Structurally singular equation block",
      eqId: 7,
      originMap: inliner.originMap,
      symbolSource: index,
      hypergraph: hg,
      rootThreadDomain: ThreadDomain.Modelica,
    });
    assert.strictEqual(daeDiag.frames.length, 3);
    assert.strictEqual(daeDiag.frames[0]?.role, "inlined_dae");
  });

  it("Integration: TggSymbolProjectionTable uses WASM PIC fast path & SymbolInteropRegistry streaming", () => {
    const spiceDomain = registerLanguageDomain("spice");
    const spiceSymId = makePolyglotSymbolId(spiceDomain, 77);
    const interopRegistry = new SymbolInteropRegistry().register({
      domainId: spiceDomain,
      languageId: "spice",
      getTraits: () => InteropTrait.HasPorts | InteropTrait.HasParameters,
      readPorts(_symId, sink) {
        sink("vin", "ElectricalNode", "in", false, false);
        sink("vout", "ElectricalNode", "out", false, false);
      },
      readParameters(_symId, sink) {
        sink("R", "Real", "1000", "Ohm", false);
      },
    });

    const table = new TggSymbolProjectionTable({ interopRegistry });
    table.registerPolyglotConfig("spice", {
      typeMaps: { modelica: { ElectricalNode: "Pin" } },
      rules: [
        {
          name: "SpiceSubcktToModelicaModel",
          sourceLang: "spice",
          targetLang: "modelica",
          source: () => ({ nodeType: "subckt_def", bindings: {} }),
          target: () => ({ nodeType: "class_definition", bindings: {} }),
        },
      ],
    });

    const candidate: SymbolEntry = {
      ...makeSymbol(spiceSymId, "LowPassFilter", "subckt_def", null, "file:///lpf.cir"),
      language: "spice",
    };
    const index = makeIndex([candidate]);

    // Repeated cross-language projections hit the PIC fast path
    for (let i = 0; i < 5; i++) {
      const rule = table.canResolveAs("modelica", candidate);
      assert.strictEqual(rule?.ruleName, "SpiceSubcktToModelicaModel");
    }
    const stats = table.getPicStats();
    assert.ok(stats.monoHits >= 4, `Expected >=4 monomorphic PIC hits, got ${stats.monoHits}`);

    // Foreign signature projection streams ports & parameters via SymbolInteropLibrary even with 0 child SymbolEntries
    const sig = table.projectForeignSignature(candidate, index, "modelica");
    assert.strictEqual(sig.members.length, 3);
    assert.strictEqual(sig.members[0]?.name, "vin");
    assert.strictEqual(sig.members[0]?.projectedType, "Pin");
    assert.strictEqual(sig.members[0]?.role, "port");
    assert.strictEqual(sig.members[2]?.name, "R");
    assert.strictEqual(sig.members[2]?.role, "parameter");
    assert.strictEqual(sig.members[2]?.unit, "Ohm");
  });

  it("Integration: Global alias elimination & BLT across Modelica + Inlined SPICE RC circuit", async () => {
    await initBltWasm();
    const spiceDomain = registerLanguageDomain("spice");
    const spiceResistorSym = makePolyglotSymbolId(spiceDomain, 101);
    const modelicaCircuitSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 202);

    const registry = registerDefaultInteropLibraries(new SymbolInteropRegistry());
    // Override SPICE domain with LowerableDAE resistor implementation
    registry.register({
      domainId: spiceDomain,
      languageId: "spice",
      getTraits: () => InteropTrait.HasPorts | InteropTrait.HasParameters | InteropTrait.LowerableDAE,
      lowerToDAE(_symId, dae, prefix, overrides) {
        const R = overrides?.get("R") ?? 1000.0;
        const vP = dae.addVariable(`${prefix}.p.v`, VarType.Real, Variability.Continuous, Causality.Local, 0);
        const iP = dae.addVariable(`${prefix}.p.i`, VarType.Real, Variability.Continuous, Causality.Local, 0);
        const vN = dae.addVariable(`${prefix}.n.v`, VarType.Real, Variability.Continuous, Causality.Local, 0);
        const iN = dae.addVariable(`${prefix}.n.i`, VarType.Real, Variability.Continuous, Causality.Local, 0);

        const ref = (v: number) => dae.addName(dae.getVarNameId(v));
        // Ohm's law: vP - vN = R * iP
        dae.addEquation(
          EqKind.Simple,
          dae.addBinaryExpr(BinOp.Sub, ref(vP), ref(vN)),
          dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(R), ref(iP)),
        );
        // KCL inside resistor: iP + iN = 0
        dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Add, ref(iP), ref(iN)), dae.addRealLiteral(0));

        return {
          prefix,
          addedVars: 4,
          addedEqs: 2,
          ports: [
            { portName: "p", portType: "Pin", potentialVarId: vP, flowVarId: iP },
            { portName: "n", portType: "Pin", potentialVarId: vN, flowVarId: iN },
          ],
        };
      },
    });

    const dae = new DAEBuilder();
    const inliner = new PolyglotDaeInliner(registry);
    const ref = (v: number) => dae.addName(dae.getVarNameId(v));

    // Host Modelica DC Source (5V) + Capacitor (C = 1e-3 F)
    const srcVp = dae.addVariable("src.p.v", VarType.Real, Variability.Continuous, Causality.Local, 5.0);
    const srcIp = dae.addVariable("src.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addEquation(EqKind.Simple, ref(srcVp), dae.addRealLiteral(5.0));

    const capVp = dae.addVariable("cap.p.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const capIp = dae.addVariable("cap.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    // Capacitor constitutive equation: C * der(cap.p.v) = cap.p.i
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-3), dae.addDerExpr(ref(capVp))),
      ref(capIp),
    );

    // Inline foreign SPICE resistor directly into the same DAE arena
    const spiceR = inliner.inlineComponent(spiceResistorSym, dae, "r_spice", new Map([["R", 1000.0]]));
    // Bind Modelica source.p <-> SPICE r_spice.p and SPICE r_spice.n <-> Modelica cap.p
    inliner.bindPorts(
      dae,
      { portName: "p", portType: "Pin", potentialVarId: srcVp, flowVarId: srcIp },
      spiceR.portsByName.get("p")!,
      modelicaCircuitSym,
    );
    inliner.bindPorts(
      dae,
      spiceR.portsByName.get("n")!,
      { portName: "p", portType: "Pin", potentialVarId: capVp, flowVarId: capIp },
      modelicaCircuitSym,
    );

    // Total balanced square system: 8 vars (src.p.v/i, cap.p.v/i, r_spice.{p,n}.{v,i}) & 8 eqs
    assert.strictEqual(dae.getVarCount(), 8);
    assert.strictEqual(dae.getEqCount(), 8);

    // Run global alias elimination + BLT across the Modelica/SPICE boundary
    eliminateArenaAliases(dae);
    const blt = performBltTransformationArena(dae);
    assert.ok(blt.sortedEquations.length > 0, "Expected causally sorted equations across Modelica+SPICE boundary");
    assert.ok(blt.blocks.length > 0, "Expected causally sorted BLT blocks across Modelica+SPICE boundary");

    // Verify PolyglotContext.toSymbolIndex() merges frozen engine libs + mutable overlay cleanly
    const engine = new PolyglotEngine({ interopRegistry: registry });
    const frozenLib = freezeSymbolIndex(
      "StdLib",
      "1.0",
      makeIndex([makeSymbol(modelicaCircuitSym, "BaseCircuit", "Model", null, "file:///std.mo")]),
    );
    engine.registerFrozenLibrary(frozenLib);
    const ctx = engine.createContext({ contextId: "hybrid-sim" });
    ctx.upsertSymbol(makeSymbol(spiceResistorSym, "R_1k", "Subckt", null, "file:///r1k.cir"));
    const merged = ctx.toSymbolIndex();
    assert.strictEqual(merged.symbols.size, 2);
    assert.ok(merged.symbols.has(modelicaCircuitSym));
    assert.ok(merged.symbols.has(spiceResistorSym));
    ctx.dispose();
    engine.dispose();
  });

  it("Integration: AOT TGG rule bytecode & 10,000-symbol PIC dispatch throughput", () => {
    const bytecode = compileTggRuleBytecode({
      requiredTraits: InteropTrait.HasPorts | InteropTrait.HasParameters,
      copyParams: ["R", "C"],
      mapPorts: ["p", "n"],
      relationId: 0,
    });

    const passRes = executeTggBytecode(bytecode, InteropTrait.HasPorts | InteropTrait.HasParameters);
    assert.strictEqual(passRes.matched, true);
    assert.strictEqual(passRes.copiedParams, 2);
    assert.strictEqual(passRes.mappedPorts, 2);
    assert.strictEqual(passRes.linked, true);

    const failRes = executeTggBytecode(bytecode, InteropTrait.HasPorts);
    assert.strictEqual(failRes.matched, false);

    // 10,000-symbol dispatch through WASM PIC
    const pic = new TggPicDispatcher<Uint32Array>({ mode: "auto" });
    pic.register(LanguageDomainId.SysML2, "part_def", LanguageDomainId.Modelica, bytecode);
    pic.register(LanguageDomainId.SysML2, "port_usage", LanguageDomainId.Modelica, bytecode);
    let hits = 0;
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const kind = i % 10 === 0 ? "port_usage" : "part_def";
      if (pic.lookupRuleId(LanguageDomainId.SysML2, kind, LanguageDomainId.Modelica) >= 0) hits++;
    }
    const elapsedMs = performance.now() - t0;
    assert.strictEqual(hits, 10_000);
    const stats = pic.getStats();
    assert.ok(stats.monoHits + stats.polyHits >= 9_998, `Expected >=99.98% PIC hit rate, got ${JSON.stringify(stats)}`);
    assert.ok(elapsedMs < 200, `10k PIC lookups took ${elapsedMs.toFixed(1)}ms`);
    pic.dispose();
  });

  it("Integration: Unboxed external FFI in evaluateArenaRuntime, UnifiedWorkspace frozen mount & maxMemoryPages", () => {
    // 1. Register unboxed external function and invoke directly through evaluateArenaRuntime (ExprKind.Call)
    defaultUnboxedExternalFunctions.register("polyglot_quad", (mem, argsOff, _n, outOff) => {
      const x = mem[argsOff]!;
      const k = mem[argsOff + 1]!;
      mem[outOff] = k * x * x + 1.0;
      return 0;
    });
    const dae = new DAEBuilder();
    const xVar = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 3.0);
    dae.setVarOriginSymbol(xVar, makePolyglotSymbolId(LanguageDomainId.Modelica, 55));
    assert.strictEqual(dae.getVarOriginSymbol(xVar), makePolyglotSymbolId(LanguageDomainId.Modelica, 55));

    const callExpr = dae.addCallExpr("polyglot_quad", [dae.addNameExpr("x"), dae.addRealLiteral(2.0)]);
    const env = new Float64Array(dae.interner.size + 8);
    env[dae.getVarNameId(xVar)] = 3.0;
    const result = evaluateArenaRuntime(dae, callExpr, env);
    assert.strictEqual(result, 19.0); // 2 * 3^2 + 1

    // 2. UnifiedWorkspace mounts FrozenLibrarySnapshot zero-copy
    const stdSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 501);
    const frozen = freezeSymbolIndex(
      "MSL-Pilot",
      "4.0.0",
      makeIndex([makeSymbol(stdSym, "Capacitor", "Model", null, "file:///msl/Capacitor.mo")]),
    );
    const ws = new UnifiedWorkspace();
    ws.mountFrozenLibrary(frozen);
    assert.strictEqual(ws.getIndex().symbols.get(stdSym)?.name, "Capacitor");
    assert.strictEqual(ws.unmountFrozenLibrary("MSL-Pilot"), true);
    assert.strictEqual(ws.getIndex().symbols.get(stdSym), undefined);

    // 3. ensureMemoryCapacity enforces maxMemoryPages capability cap
    const mem = new WebAssembly.Memory({ initial: 1, maximum: 8 });
    const views = createMemoryViews(mem);
    assert.throws(() => ensureMemoryCapacity(views, 4 * 65536, 2), RangeError);
    assert.doesNotThrow(() => ensureMemoryCapacity(views, 2 * 65536, 2));
  });
});
