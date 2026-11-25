// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  assembleDaeCausalTrace,
  assembleSmtCausalTrace,
  BinOp,
  Causality,
  ConstraintTheoryOracle,
  DAEBuilder,
  DigitalThreadHypergraph,
  eliminateArenaAliases,
  EqKind,
  initBltWasm,
  InteropTrait,
  LanguageDomainId,
  makePolyglotSymbolId,
  performBltTransformationArena,
  PolyglotDaeInliner,
  PolyglotEngine,
  projectTraceToLspRelatedInfo,
  SemanticTheoryCoordinator,
  type SymbolEntry,
  type SymbolIndex,
  TggCorrespondenceIndexer,
  TggPicDispatcher,
  TggSymbolProjectionTable,
  ThreadDomain,
  ThreadRelation,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert";
import { describe, it } from "node:test";
import { createModelicaInteropLibrary } from "../../../languages/modelica/src/interop.js";
import { createReqifInteropLibrary } from "../../../languages/reqif/src/interop.js";
import { createSpiceInteropLibrary, getSpiceDomainId } from "../../../languages/spice/src/interop.js";
import { createSysml2InteropLibrary } from "../../../languages/sysml2/src/interop.js";
import { createVerilogAInteropLibrary, getVerilogADomainId } from "../../../languages/verilog-a/src/interop.js";

describe("End-to-End Hybrid Simulation & 4-Language Pilot Interop (Workstreams A & D)", () => {
  it("coordinates all 4 pilot SymbolInteropLibraries (ReqIF, SysML v2, Modelica, SPICE) in one PolyglotEngine", () => {
    const engine = new PolyglotEngine();
    engine.interopRegistry
      .register(createReqifInteropLibrary())
      .register(createSysml2InteropLibrary())
      .register(createModelicaInteropLibrary())
      .register(createSpiceInteropLibrary());

    const reqSym = makePolyglotSymbolId(LanguageDomainId.ReqIF, 1);
    const sysmlSym = makePolyglotSymbolId(LanguageDomainId.SysML2, 1);
    const sysmlPortSym = makePolyglotSymbolId(LanguageDomainId.SysML2, 2);
    const moSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
    const moPinSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 2);
    const moParamSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 3);
    const spiceSym = makePolyglotSymbolId(getSpiceDomainId(), 1);

    const entries: SymbolEntry[] = [
      {
        id: reqSym,
        name: "REQ_TAU_1S",
        kind: "SpecObject",
        ruleName: "spec_object",
        namePath: "name",
        startOffset: 0,
        endOffset: 10,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: { threshold: 1.0, unit: "s", relations: [{ target: "RCFilter", relation: "refines" }] },
        fieldName: null,
      },
      {
        id: sysmlSym,
        name: "RCFilter",
        kind: "PartDefinition",
        ruleName: "part_definition",
        namePath: "name",
        startOffset: 0,
        endOffset: 20,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: { requirements: [{ target: "REQ_TAU_1S", relation: "satisfies" }] },
        fieldName: null,
      },
      {
        id: sysmlPortSym,
        name: "vin",
        kind: "PortUsage",
        ruleName: "port_usage",
        namePath: "name",
        startOffset: 10,
        endOffset: 18,
        parentId: sysmlSym,
        exports: [],
        inherits: [],
        metadata: { featureType: "VoltagePort", direction: "in" },
        fieldName: null,
      },
      {
        id: moSym,
        name: "RCStage",
        kind: "Model",
        ruleName: "class_definition",
        namePath: "name",
        startOffset: 0,
        endOffset: 30,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: {},
        fieldName: null,
      },
      {
        id: moPinSym,
        name: "p",
        kind: "Component",
        ruleName: "component_clause",
        namePath: "name",
        startOffset: 5,
        endOffset: 12,
        parentId: moSym,
        exports: [],
        inherits: [],
        metadata: { typeSpecifier: "Pin", isConnector: true },
        fieldName: null,
      },
      {
        id: moParamSym,
        name: "C",
        kind: "Component",
        ruleName: "component_clause",
        namePath: "name",
        startOffset: 13,
        endOffset: 25,
        parentId: moSym,
        exports: [],
        inherits: [],
        metadata: { typeSpecifier: "Real", variability: "parameter", value: 1e-3, unit: "F" },
        fieldName: null,
      },
      {
        id: spiceSym,
        name: "R1",
        kind: "Resistor",
        ruleName: "resistor",
        namePath: "name",
        startOffset: 0,
        endOffset: 12,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: { deviceType: "R", R: 1000.0 },
        fieldName: null,
      },
    ];

    const index: SymbolIndex = {
      symbols: new Map(entries.map((e) => [e.id, e])),
      byName: new Map(entries.map((e) => [e.name, [e.id]])),
      childrenOf: new Map([
        [null, [reqSym, sysmlSym, moSym, spiceSym]],
        [sysmlSym, [sysmlPortSym]],
        [moSym, [moPinSym, moParamSym]],
      ]),
    };

    assert.strictEqual(
      engine.interopRegistry.hasTraits(reqSym, InteropTrait.HasRequirements | InteropTrait.HasParameters, index),
      true,
    );
    assert.strictEqual(
      engine.interopRegistry.hasTraits(sysmlSym, InteropTrait.HasPorts | InteropTrait.HasRequirements, index),
      true,
    );
    assert.strictEqual(
      engine.interopRegistry.hasTraits(moSym, InteropTrait.HasPorts | InteropTrait.HasParameters, index),
      true,
    );
    assert.strictEqual(
      engine.interopRegistry.hasTraits(spiceSym, InteropTrait.HasPorts | InteropTrait.LowerableDAE, index),
      true,
    );
    engine.dispose();
  });

  it("simulates a hybrid Modelica + Inlined SPICE RC circuit and matches exact analytical trajectory (RMSE < 1e-3)", async () => {
    await initBltWasm();
    const engine = new PolyglotEngine();
    engine.interopRegistry.register(createSpiceInteropLibrary());

    const spiceDomain = getSpiceDomainId();
    const spiceResistorSym = makePolyglotSymbolId(spiceDomain, 10);
    const modelicaHostSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 20);

    const dae = new DAEBuilder();
    const inliner = new PolyglotDaeInliner(engine.interopRegistry);
    const ref = (v: number) => dae.addName(dae.getVarNameId(v));

    // Host Modelica: 5V DC source + Capacitor (C = 1e-3 F, initial v = 0V)
    const srcVp = dae.addVariable("src.p.v", VarType.Real, Variability.Continuous, Causality.Local, 5.0);
    const srcIp = dae.addVariable("src.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addEquation(EqKind.Simple, ref(srcVp), dae.addRealLiteral(5.0));

    const capVp = dae.addVariable("cap.p.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const capIp = dae.addVariable("cap.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    // C * der(cap.p.v) = cap.p.i
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-3), dae.addDerExpr(ref(capVp))),
      ref(capIp),
    );

    // Inline SPICE resistor R = 1000 Ohm directly into the same DAEBuilder arena (tau = R*C = 1.0 s)
    const spiceR = inliner.inlineComponent(spiceResistorSym, dae, "r_spice", new Map([["R", 1000.0]]));
    inliner.bindPorts(
      dae,
      { portName: "p", portType: "Pin", potentialVarId: srcVp, flowVarId: srcIp },
      spiceR.portsByName.get("p")!,
      modelicaHostSym,
    );
    inliner.bindPorts(
      dae,
      spiceR.portsByName.get("n")!,
      { portName: "p", portType: "Pin", potentialVarId: capVp, flowVarId: capIp },
      modelicaHostSym,
    );

    // Global alias elimination across Modelica/SPICE boundary, then full numerical simulation
    eliminateArenaAliases(dae);
    const sim = simulateArena(dae, {
      startTime: 0.0,
      stopTime: 3.0,
      stepSize: 0.01,
    });

    const times = sim.t;
    const capCol = sim.states.indexOf("cap.p.v");
    assert.ok(times.length > 50, `Expected >50 simulation time steps, got ${times.length}`);
    assert.ok(capCol >= 0, `Expected 'cap.p.v' in states=${JSON.stringify(sim.states)}`);

    // Compute RMSE against exact analytical solution v_C(t) = 5 * (1 - exp(-t))
    let sumSqErr = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!;
      const exact = 5.0 * (1.0 - Math.exp(-t));
      const err = sim.y[i]![capCol]! - exact;
      sumSqErr += err * err;
    }
    const rmse = Math.sqrt(sumSqErr / times.length);
    assert.ok(rmse < 1e-3, `Hybrid Modelica+SPICE RC trajectory RMSE=${rmse.toExponential(3)} exceeded 1e-3`);

    engine.dispose();
  });

  it("implicitly aligns 4 differently-named classes (REQ_CURR_10MA <-> InputFilterSpec <-> BuckInputStage <-> R_1K) via import/extends/satisfy, simulates, and traces violations", async () => {
    await initBltWasm();
    const spiceDomain = getSpiceDomainId();
    const engine = new PolyglotEngine();
    engine.interopRegistry
      .register(createReqifInteropLibrary())
      .register(createSysml2InteropLibrary())
      .register(createModelicaInteropLibrary())
      .register(createSpiceInteropLibrary());

    // 4 completely different symbol names across 4 languages — ZERO twin annotations
    const reqId = makePolyglotSymbolId(LanguageDomainId.ReqIF, 1);
    const sysmlPkgId = makePolyglotSymbolId(LanguageDomainId.SysML2, 1);
    const sysmlPartId = makePolyglotSymbolId(LanguageDomainId.SysML2, 2);
    const sysmlSatisfyId = makePolyglotSymbolId(LanguageDomainId.SysML2, 3);
    const moModelId = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
    const moExtendsId = makePolyglotSymbolId(LanguageDomainId.Modelica, 2);
    const moImportId = makePolyglotSymbolId(LanguageDomainId.Modelica, 3);
    const moCompId = makePolyglotSymbolId(LanguageDomainId.Modelica, 4);
    const spiceSubcktId = makePolyglotSymbolId(spiceDomain, 1);

    const mk = (
      id: number,
      name: string,
      kind: string,
      ruleName: string,
      language: string,
      parentId: number | null,
      resourceId: string,
      metadata: Record<string, unknown> = {},
    ): SymbolEntry => ({
      id,
      name,
      kind,
      ruleName,
      namePath: "name",
      startOffset: 0,
      endOffset: 20,
      parentId,
      exports: [],
      inherits: [],
      metadata,
      fieldName: null,
      resourceId,
      language,
    });

    const entries: SymbolEntry[] = [
      // 1. reqs/power_reqs.reqif
      mk(
        reqId,
        "REQ_CURR_10MA",
        "RequirementDefinition",
        "reqif_requirement",
        "reqif",
        null,
        "file:///reqs/power_reqs.reqif",
        {
          threshold: 0.01,
          unit: "A",
        },
      ),
      // 2. arch/input_filter.sysml
      mk(sysmlPkgId, "PowerArch", "Package", "Package", "sysml2", null, "file:///arch/input_filter.sysml"),
      mk(
        sysmlPartId,
        "InputFilterSpec",
        "PartDefinition",
        "PartDefinition",
        "sysml2",
        sysmlPkgId,
        "file:///arch/input_filter.sysml",
      ),
      mk(
        sysmlSatisfyId,
        "REQ_CURR_10MA",
        "Satisfy",
        "SatisfyRequirementUsage",
        "sysml2",
        sysmlPartId,
        "file:///arch/input_filter.sysml",
        {
          target: "REQ_CURR_10MA",
        },
      ),
      // 3. sim/buck_stage.mo (extends PowerArch.InputFilterSpec + import R_1K + R_1K r_load)
      mk(moModelId, "BuckInputStage", "Class", "class_definition", "modelica", null, "file:///sim/buck_stage.mo"),
      mk(
        moExtendsId,
        "PowerArch.InputFilterSpec",
        "Extends",
        "extends_clause",
        "modelica",
        moModelId,
        "file:///sim/buck_stage.mo",
      ),
      mk(moImportId, "R_1K", "Import", "import_clause", "modelica", moModelId, "file:///sim/buck_stage.mo"),
      mk(moCompId, "r_load", "Component", "component_clause", "modelica", moModelId, "file:///sim/buck_stage.mo", {
        typeSpecifier: "R_1K",
      }),
      // 4. circuits/r_1k.cir
      mk(spiceSubcktId, "R_1K", "Subckt", "subckt_def", "spice", null, "file:///circuits/r_1k.cir", {
        deviceType: "R",
        R: 1000.0,
      }),
    ];

    const index: SymbolIndex = {
      symbols: new Map(entries.map((e) => [e.id, e])),
      byName: new Map(),
      childrenOf: new Map(),
    };
    for (const e of entries) {
      const b = index.byName.get(e.name) ?? [];
      b.push(e.id);
      index.byName.set(e.name, b);
      const k = index.childrenOf.get(e.parentId) ?? [];
      k.push(e.id);
      index.childrenOf.set(e.parentId, k);
    }

    // Register declarative TGG rules (no name-matching required for Pass 1 native references!)
    const projectionTable = new TggSymbolProjectionTable({ interopRegistry: engine.interopRegistry });
    projectionTable.registerPolyglotConfig("sysml2", {
      rules: [
        {
          name: "SysMLPartToModelicaModel",
          sourceLang: "sysml2",
          targetLang: "modelica",
          source: () => ({ nodeType: "PartDefinition", bindings: {} }),
          target: () => ({ nodeType: "class_definition", bindings: {} }),
        },
        {
          name: "ReqIFToSysMLReq",
          sourceLang: "reqif",
          targetLang: "sysml2",
          source: () => ({ nodeType: "reqif_requirement", bindings: {} }),
          target: () => ({ nodeType: "RequirementDefinition", bindings: {} }),
        },
      ],
    });
    projectionTable.registerPolyglotConfig("spice", {
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

    // Run TggCorrespondenceIndexer — Pass 1 aligns all 4 files purely from extends/satisfy/import/typing
    const hg = new DigitalThreadHypergraph();
    const indexer = new TggCorrespondenceIndexer(projectionTable, hg);
    indexer.syncIndex(index, 1);

    // 1. Verify BuckInputStage --DerivesFrom--> InputFilterSpec (via `extends PowerArch.InputFilterSpec`)
    const moSlots = hg.findSlotsByDomainNode(ThreadDomain.Modelica, moModelId);
    assert.ok(moSlots.length >= 1, `Expected BuckInputStage to be aligned in hypergraph, got ${moSlots.length} slots`);
    const derivesSlot = moSlots.find((s) => {
      const rec = hg.getRecord(s);
      return rec?.relation === ThreadRelation.DerivesFrom && rec.domainNodes[ThreadDomain.SysML2] === sysmlPartId;
    });
    assert.ok(derivesSlot !== undefined, "Expected BuckInputStage --DerivesFrom--> InputFilterSpec via extends");

    // 2. Verify InputFilterSpec --Satisfies--> REQ_CURR_10MA (via `satisfy REQ_CURR_10MA`)
    const sysmlSlots = hg.findSlotsByDomainNode(ThreadDomain.SysML2, sysmlPartId);
    const satisfiesSlot = sysmlSlots.find((s) => {
      const rec = hg.getRecord(s);
      return rec?.relation === ThreadRelation.Satisfies && rec.domainNodes[ThreadDomain.Requirements] === reqId;
    });
    assert.ok(satisfiesSlot !== undefined, "Expected InputFilterSpec --Satisfies--> REQ_CURR_10MA via satisfy");

    // 3. Verify transitive blast radius from Modelica BuckInputStage reaches both SysML2 InputFilterSpec AND ReqIF REQ_CURR_10MA
    const blast = hg.computeBlastRadius(ThreadDomain.Modelica, moModelId);
    const impactedIds = new Set(blast.impactedNodes.map((n) => n.nodeId));
    assert.ok(impactedIds.has(sysmlPartId), "Expected blast radius to reach SysML2 InputFilterSpec");
    assert.ok(impactedIds.has(reqId), "Expected transitive blast radius to reach ReqIF REQ_CURR_10MA");

    // ── A. STATIC ANALYSIS ACROSS FILES & LANGUAGES ────────────────────
    // A1. Cross-language signature projection via SymbolInteropLibrary + typeMaps + WASM PIC
    projectionTable.registerPolyglotConfig("spice", {
      typeMaps: { modelica: { ElectricalNode: "Pin" } },
      rules: [],
    });
    const spiceEntry = index.symbols.get(spiceSubcktId)!;
    const projectedSig = projectionTable.projectForeignSignature(spiceEntry, index, "modelica");
    assert.strictEqual(projectedSig.matchedRule?.ruleName, "SpiceSubcktToModelicaModel");
    assert.ok(projectedSig.members.some((m) => m.name === "p" && m.projectedType === "Pin" && m.role === "port"));
    assert.ok(projectedSig.members.some((m) => m.name === "R" && m.unit === "Ohm" && m.role === "parameter"));
    const picStats = projectionTable.getPicStats();
    assert.ok(picStats.monoHits + picStats.polyHits + picStats.megaHits > 0, "Expected PIC dispatch activity");

    // A2. Transitive blast-radius staleness across Modelica -> SysML2 -> ReqIF
    const staleMarked = hg.markBlastRadiusStale(ThreadDomain.Modelica, moModelId);
    assert.ok(staleMarked >= 2, `Expected >=2 stale threads marked across domains, got ${staleMarked}`);
    assert.strictEqual(hg.isStale(derivesSlot!), true);
    assert.strictEqual(hg.isStale(satisfiesSlot!), true);

    // Helper to build & lower the hybrid Modelica + Inlined SPICE RC circuit for any resistance R
    const buildHybridCircuit = (resistanceOhm: number) => {
      const dae = new DAEBuilder();
      const inliner = new PolyglotDaeInliner(engine.interopRegistry);
      const ref = (v: number) => dae.addName(dae.getVarNameId(v));
      const srcVp = dae.addVariable("src.p.v", VarType.Real, Variability.Continuous, Causality.Local, 5.0);
      const srcIp = dae.addVariable("src.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      dae.addEquation(EqKind.Simple, ref(srcVp), dae.addRealLiteral(5.0));
      const capVp = dae.addVariable("cap.p.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const capIp = dae.addVariable("cap.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      dae.addEquation(
        EqKind.Simple,
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-3), dae.addDerExpr(ref(capVp))),
        ref(capIp),
      );
      const rLoad = inliner.inlineComponent(spiceSubcktId, dae, "r_load", new Map([["R", resistanceOhm]]), index);
      inliner.bindPorts(
        dae,
        { portName: "p", portType: "Pin", potentialVarId: srcVp, flowVarId: srcIp },
        rLoad.portsByName.get("p")!,
        moModelId,
      );
      inliner.bindPorts(
        dae,
        rLoad.portsByName.get("n")!,
        { portName: "p", portType: "Pin", potentialVarId: capVp, flowVarId: capIp },
        moModelId,
      );
      return { dae, inliner, rLoad };
    };

    // A3. Structural BLT static analysis across Modelica/SPICE boundary
    const compliant = buildHybridCircuit(1000.0);
    assert.strictEqual(compliant.dae.getVarCount(), 8);
    assert.strictEqual(compliant.dae.getEqCount(), 8);
    assert.strictEqual(compliant.dae.getEqOriginSymbol(compliant.rLoad.eqRange[0]), spiceSubcktId);
    eliminateArenaAliases(compliant.dae);
    const blt = performBltTransformationArena(compliant.dae);
    assert.ok(
      blt.sortedEquations.length > 0 && blt.blocks.length > 0,
      "Expected nonsingular BLT across Modelica+SPICE",
    );

    // ── B. HYBRID SIMULATION (COMPLIANT R=1000 vs. VIOLATING R=200) ───
    const simOk = simulateArena(compliant.dae, { startTime: 0, stopTime: 1.0, stepSize: 0.01 });
    const capColOk = simOk.states.indexOf("cap.p.v");
    let sumSqOk = 0;
    for (let i = 0; i < simOk.t.length; i++) {
      const err = simOk.y[i]![capColOk]! - 5.0 * (1.0 - Math.exp(-simOk.t[i]! / 1.0));
      sumSqOk += err * err;
    }
    assert.ok(Math.sqrt(sumSqOk / simOk.t.length) < 1e-3, "Compliant R=1000 Ohm trajectory RMSE < 1e-3");
    const peakCurrentOk = 5.0 / 1000.0; // 5 mA <= 10 mA

    const violating = buildHybridCircuit(200.0);
    assert.strictEqual(violating.dae.getEqOriginSymbol(violating.rLoad.eqRange[0]), spiceSubcktId);
    eliminateArenaAliases(violating.dae);
    const simBad = simulateArena(violating.dae, { startTime: 0, stopTime: 0.5, stepSize: 0.01 });
    const capColBad = simBad.states.indexOf("cap.p.v");
    let sumSqBad = 0;
    for (let i = 0; i < simBad.t.length; i++) {
      const err = simBad.y[i]![capColBad]! - 5.0 * (1.0 - Math.exp(-simBad.t[i]! / 0.2));
      sumSqBad += err * err;
    }
    assert.ok(Math.sqrt(sumSqBad / simBad.t.length) < 1e-3, "Violating R=200 Ohm trajectory RMSE < 1e-3");
    const peakCurrentBad = 5.0 / 200.0; // 25 mA > 10 mA

    // ── C. FORMAL VERIFICATION (NELSON-OPPEN SMT SAT / UNSAT + TRACE) ─
    // C1. Compliant design (R=1000 -> I_peak=0.005A <= 0.010A): SMT proves SAT
    const satCoord = new SemanticTheoryCoordinator();
    satCoord.registerOracle(new ConstraintTheoryOracle());
    satCoord.assertLiteral({
      predicate: "bound",
      args: ["i_peak", "<=", 0.01],
      domain: "constraint",
      originSymbolId: reqId,
    });
    satCoord.assertLiteral({
      predicate: "bound",
      args: ["i_peak", ">=", peakCurrentOk],
      domain: "constraint",
      originSymbolId: spiceSubcktId,
    });
    satCoord.assertLiteral({
      predicate: "bound",
      args: ["i_peak", "<=", peakCurrentOk],
      domain: "constraint",
      originSymbolId: spiceSubcktId,
    });
    const satResult = satCoord.checkSat();
    assert.strictEqual(satResult.isSat, true, "Compliant R=1000 Ohm design must satisfy REQ_CURR_10MA (SAT)");

    // C2. Violating design (R=200 -> I_peak=0.025A > 0.010A): SMT proves UNSAT with ConflictClause
    const unsatCoord = new SemanticTheoryCoordinator();
    unsatCoord.registerOracle(new ConstraintTheoryOracle());
    unsatCoord.assertLiteral({
      predicate: "bound",
      args: ["i_peak", "<=", 0.01],
      domain: "constraint",
      originSymbolId: reqId,
    });
    unsatCoord.assertLiteral({
      predicate: "bound",
      args: ["i_peak", ">=", peakCurrentBad],
      domain: "constraint",
      originSymbolId: spiceSubcktId,
    });
    const unsatResult = unsatCoord.checkSat();
    assert.strictEqual(unsatResult.isSat, false, "Violating R=200 Ohm design must fail REQ_CURR_10MA (UNSAT)");
    assert.ok(unsatResult.conflict, "Expected SMT ConflictClause on UNSAT");

    // C3. Synthesize unified 4-language causal trace (SPICE -> Modelica -> SysML2 -> ReqIF)
    const smtDiag = assembleSmtCausalTrace({
      code: "MS_FORMAL_REQ_VIOLATION",
      conflict: {
        ...unsatResult.conflict,
        culpritSymbolIds: [spiceSubcktId, moModelId, sysmlPartId, reqId],
      },
      threadSlot: derivesSlot,
      hypergraph: hg,
      symbolSource: index,
    });
    const smtRelated = projectTraceToLspRelatedInfo(smtDiag);
    const tracedUris = new Set(smtRelated.map((r) => r.location.uri));
    assert.ok(tracedUris.has("file:///circuits/r_1k.cir"), "Trace must link SPICE r_1k.cir");
    assert.ok(tracedUris.has("file:///sim/buck_stage.mo"), "Trace must link Modelica buck_stage.mo");
    assert.ok(tracedUris.has("file:///arch/input_filter.sysml"), "Trace must link SysML2 input_filter.sysml");
    assert.ok(tracedUris.has("file:///reqs/power_reqs.reqif"), "Trace must link ReqIF power_reqs.reqif");

    // Also verify DAE-level causal trace directly from the inlined SPICE equation WITHOUT passing rootThreadDomain
    // (must auto-resolve SPICE domain and walk transitively: r_1k.cir -> buck_stage.mo -> input_filter.sysml -> power_reqs.reqif)
    const daeDiag = assembleDaeCausalTrace({
      code: "MS_REQ_VIOLATED",
      summary: "Peak current 25mA exceeds REQ_CURR_10MA (10mA)",
      eqId: violating.rLoad.eqRange[0],
      originMap: violating.inliner.originMap,
      symbolSource: index,
      hypergraph: hg,
    });
    assert.strictEqual(daeDiag.frames[0]?.symbolId, spiceSubcktId);
    assert.strictEqual(daeDiag.frames[0]?.uri, "file:///circuits/r_1k.cir");
    const daeUris = new Set(daeDiag.frames.map((f) => f.uri));
    assert.ok(daeUris.has("file:///sim/buck_stage.mo"), "Transitive DAE trace must reach Modelica buck_stage.mo");
    assert.ok(
      daeUris.has("file:///arch/input_filter.sysml"),
      "Transitive DAE trace must reach SysML2 input_filter.sysml",
    );
    assert.ok(daeUris.has("file:///reqs/power_reqs.reqif"), "Transitive DAE trace must reach ReqIF power_reqs.reqif");

    engine.dispose();
  });

  it("Variation 1: 3-language 3-way electrical junction (Modelica + SPICE + Verilog-A) via bindPortJunction matches exact Thevenin RC curve", async () => {
    await initBltWasm();
    const engine = new PolyglotEngine();
    engine.interopRegistry.register(createSpiceInteropLibrary()).register(createVerilogAInteropLibrary());

    const spiceSym = makePolyglotSymbolId(getSpiceDomainId(), 101);
    const verilogASym = makePolyglotSymbolId(getVerilogADomainId(), 202);
    const modelicaSym = makePolyglotSymbolId(LanguageDomainId.Modelica, 303);

    const dae = new DAEBuilder();
    const inliner = new PolyglotDaeInliner(engine.interopRegistry);
    const ref = (v: number) => dae.addName(dae.getVarNameId(v));

    // Modelica 10V DC source + ground + 1 mF capacitor
    const srcVp = dae.addVariable("src.p.v", VarType.Real, Variability.Continuous, Causality.Local, 10.0);
    const srcIp = dae.addVariable("src.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addEquation(EqKind.Simple, ref(srcVp), dae.addRealLiteral(10.0));

    const capVp = dae.addVariable("cap.p.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const capIp = dae.addVariable("cap.p.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addEquation(
      EqKind.Simple,
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-3), dae.addDerExpr(ref(capVp))),
      ref(capIp),
    );

    // Inline SPICE series resistor R1 = 1000 Ohm AND Verilog-A shunt conductance G = 1e-3 S (R2 = 1000 Ohm) to ground
    const rSeries = inliner.inlineComponent(spiceSym, dae, "r_spice", new Map([["R", 1000.0]]));
    const gShunt = inliner.inlineComponent(verilogASym, dae, "g_va", new Map([["G", 1e-3]]));

    // Source.p <-> r_spice.p
    inliner.bindPorts(
      dae,
      { portName: "p", portType: "Pin", potentialVarId: srcVp, flowVarId: srcIp },
      rSeries.portsByName.get("p")!,
      modelicaSym,
    );
    // 3-way KCL junction: r_spice.n + cap.p + g_va.p (2 potential eqs + 1 3-way KCL eq!)
    inliner.bindPortJunction(
      dae,
      [
        rSeries.portsByName.get("n")!,
        { portName: "p", portType: "Pin", potentialVarId: capVp, flowVarId: capIp },
        gShunt.portsByName.get("p")!,
      ],
      modelicaSym,
    );
    // Ground g_va.n (v = 0)
    dae.addEquation(EqKind.Simple, ref(gShunt.portsByName.get("n")!.potentialVarId!), dae.addRealLiteral(0.0));

    // Verify distinct originSymbolIds across all 3 languages in one DAEBuilder
    assert.strictEqual(dae.getEqOriginSymbol(rSeries.eqRange[0]), spiceSym);
    assert.strictEqual(dae.getEqOriginSymbol(gShunt.eqRange[0]), verilogASym);

    eliminateArenaAliases(dae);
    const blt = performBltTransformationArena(dae);
    assert.ok(blt.sortedEquations.length > 0 && blt.blocks.length > 0);

    // Thevenin equivalent: V_th = 5.0 V, R_th = 500 Ohm, C = 1e-3 F => tau = 0.5 s => v_C(t) = 5*(1 - exp(-2*t))
    const sim = simulateArena(dae, { startTime: 0, stopTime: 2.0, stepSize: 0.01 });
    const capCol = sim.states.indexOf("cap.p.v");
    assert.ok(capCol >= 0);
    let sumSq = 0;
    for (let i = 0; i < sim.t.length; i++) {
      const exact = 5.0 * (1.0 - Math.exp(-sim.t[i]! / 0.5));
      const err = sim.y[i]![capCol]! - exact;
      sumSq += err * err;
    }
    const rmse = Math.sqrt(sumSq / sim.t.length);
    assert.ok(rmse < 1e-3, `3-language 3-way junction RMSE=${rmse.toExponential(3)} exceeded 1e-3`);

    engine.dispose();
  });

  it("Variation 2: WASM PIC megaGrow resize & polymorphic FIFO eviction stress test in strict diff mode", () => {
    const pic = new TggPicDispatcher<number>({ initialCapacity: 16, mode: "diff" });
    assert.strictEqual(pic.isWasmActive(), true);

    // Register 100 distinct rules (forces 3 megaGrow resizes: 16 -> 32 -> 64 -> 128)
    const expected = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const kind = `RuleKind_${i}`;
      const id = pic.register(LanguageDomainId.SysML2, kind, LanguageDomainId.Modelica, i);
      expected.set(kind, id);
    }

    // Lookup all 100 rules twice (exercises mega lookup + poly eviction + mono promotion) in strict WASM-vs-TS diff mode
    for (let round = 0; round < 2; round++) {
      for (const [kind, id] of expected.entries()) {
        assert.strictEqual(pic.lookupRuleId(LanguageDomainId.SysML2, kind, LanguageDomainId.Modelica), id);
      }
    }

    // Overwrite an existing hot rule and verify mono/poly/mega coherence in diff mode
    const updatedId = pic.register(LanguageDomainId.SysML2, "RuleKind_99", LanguageDomainId.Modelica, 999);
    assert.strictEqual(pic.lookupRuleId(LanguageDomainId.SysML2, "RuleKind_99", LanguageDomainId.Modelica), updatedId);
    assert.strictEqual(pic.lookup(LanguageDomainId.SysML2, "RuleKind_99", LanguageDomainId.Modelica), 999);
    pic.dispose();
  });
});
