// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test, { describe } from "node:test";
import {
  LanguageDomainId,
  makePolyglotSymbolId,
  QueryEngine,
  type QueryDB,
  type QueryHooks,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../src/index.js";

function createMockPolyglotWorkspace(): SymbolIndex {
  const symbols = new Map<SymbolId, SymbolEntry>();
  const byName = new Map<string, SymbolId[]>();
  const childrenOf = new Map<SymbolId | null, SymbolId[]>();

  const add = (entry: SymbolEntry) => {
    symbols.set(entry.id, entry);
    const existingNames = byName.get(entry.name) || [];
    existingNames.push(entry.id);
    byName.set(entry.name, existingNames);

    const parentKey = entry.parentId ?? null;
    const existingChildren = childrenOf.get(parentKey) || [];
    existingChildren.push(entry.id);
    childrenOf.set(parentKey, existingChildren);
  };

  // 1. Modelica symbols (Domain 0x01)
  const mDroneId = makePolyglotSymbolId(LanguageDomainId.Modelica, 10);
  add({
    id: mDroneId,
    name: "DroneAeroDynamics",
    kind: "Class",
    ruleName: "modelica_class",
    namePath: "name",
    startByte: 0,
    endByte: 500,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: { qualifiedName: "Aviation.DroneAeroDynamics", type: "ModelicaModel" },
  });

  const mSpeedVarId = makePolyglotSymbolId(LanguageDomainId.Modelica, 11);
  add({
    id: mSpeedVarId,
    name: "airspeed",
    kind: "Variable",
    ruleName: "modelica_variable",
    namePath: "name",
    startByte: 50,
    endByte: 100,
    parentId: mDroneId,
    exports: [],
    inherits: [],
    metadata: { type: "Modelica.SIunits.Velocity", unit: "m/s" },
  });

  // 2. SysML v2 symbols (Domain 0x02)
  const sControllerId = makePolyglotSymbolId(LanguageDomainId.SysML2, 20);
  add({
    id: sControllerId,
    name: "FlightController",
    kind: "Definition",
    ruleName: "sysml_part",
    namePath: "name",
    startByte: 0,
    endByte: 600,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: { twin: "CAD::AirframeAssembly" },
  });

  // 3. STEP CAD symbols (Domain 0x03)
  const cadAirframeId = makePolyglotSymbolId(LanguageDomainId.STEP_CAD, 30);
  add({
    id: cadAirframeId,
    name: "AirframeAssembly",
    kind: "Product",
    ruleName: "cad_product",
    namePath: "name",
    startByte: 0,
    endByte: 400,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: {
      volume: 45000.0,
      surfaceArea: 2100.0,
      massKg: 1.25,
    },
  });

  // 4. FEA symbols (Domain 0x07)
  const feaMeshId = makePolyglotSymbolId(LanguageDomainId.FEA, 40);
  add({
    id: feaMeshId,
    name: "WingStressMesh",
    kind: "Mesh",
    ruleName: "fea_mesh",
    namePath: "name",
    startByte: 0,
    endByte: 350,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: { elementCount: 65000 },
  });

  return { symbols, byName, childrenOf };
}

describe("Milestone 3.2: Fine-Grained Salsa Cross-Domain Invalidation & Version Vectors", () => {
  test("CAD edit does not invalidate Modelica DAE or SysML v2 requirement queries", () => {
    const index = createMockPolyglotWorkspace();

    let daeExecCount = 0;
    let sysmlExecCount = 0;
    let cadMeshExecCount = 0;

    const queryHooks = new Map<string, QueryHooks>();

    // Modelica query
    queryHooks.set("modelica_class", {
      daeEquations: (db: QueryDB, entry: SymbolEntry) => {
        daeExecCount++;
        const sym = db.symbol(entry.id);
        const children = db.childrenOf(entry.id);
        return {
          model: sym?.name,
          equations: [`der(${children[0]?.name}) = -0.5 * rho * cd * ${children[0]?.name}^2`],
        };
      },
    });

    // SysML v2 query
    queryHooks.set("sysml_part", {
      verifyConstraints: (db: QueryDB, entry: SymbolEntry) => {
        sysmlExecCount++;
        const sym = db.symbol(entry.id);
        return {
          component: sym?.name,
          status: "verified",
          maxCurrentAmps: 35.0,
        };
      },
    });

    // STEP CAD query
    queryHooks.set("cad_product", {
      tessellateMesh: (db: QueryDB, entry: SymbolEntry) => {
        cadMeshExecCount++;
        const sym = db.symbol(entry.id);
        return {
          assembly: sym?.name,
          triangles: 12400,
          volume: sym?.metadata?.volume,
        };
      },
    });

    const engine = new QueryEngine(index, queryHooks);
    const mDroneId = engine.resolvePolyglotSymbol("DroneAeroDynamics")!;
    const sControllerId = engine.resolvePolyglotSymbol("FlightController")!;
    const cadAirframeId = engine.resolvePolyglotSymbol("AirframeAssembly")!;

    // Step 1: Initial query executions
    const dae1 = engine.query("daeEquations", mDroneId);
    const sysml1 = engine.query("verifyConstraints", sControllerId);
    const cad1 = engine.query("tessellateMesh", cadAirframeId);

    assert.strictEqual(daeExecCount, 1, "Modelica DAE should execute once");
    assert.strictEqual(sysmlExecCount, 1, "SysML should execute once");
    assert.strictEqual(cadMeshExecCount, 1, "CAD mesh should execute once");
    assert.ok(dae1 !== undefined);
    assert.ok(sysml1 !== undefined);
    assert.ok(cad1 !== undefined);

    // Step 2: Invalidate STEP CAD symbol (e.g. engineer tweaked CAD geometry)
    engine.invalidate([cadAirframeId]);

    // Verify domain revision moved ONLY for STEP_CAD
    assert.strictEqual(engine.getDomainRevision(LanguageDomainId.STEP_CAD), 1);
    assert.strictEqual(engine.getDomainRevision(LanguageDomainId.Modelica), 0);
    assert.strictEqual(engine.getDomainRevision(LanguageDomainId.SysML2), 0);

    // Step 3: Re-query Modelica DAE -> MUST RETURN FROM CACHE (Zero re-computation)
    const dae2 = engine.query("daeEquations", mDroneId);
    assert.strictEqual(daeExecCount, 1, "Modelica DAE must NOT re-execute on CAD invalidation");
    assert.deepStrictEqual(dae2, dae1);

    // Step 4: Re-query SysML v2 -> MUST RETURN FROM CACHE
    const sysml2 = engine.query("verifyConstraints", sControllerId);
    assert.strictEqual(sysmlExecCount, 1, "SysML requirements must NOT re-execute on CAD invalidation");
    assert.deepStrictEqual(sysml2, sysml1);

    // Step 5: Re-query STEP CAD -> MUST RE-EXECUTE
    const cad2 = engine.query("tessellateMesh", cadAirframeId);
    assert.strictEqual(cadMeshExecCount, 2, "STEP CAD mesh query MUST re-execute after CAD invalidation");
    assert.deepStrictEqual(cad2, cad1);

    // Step 6: Invalidate Modelica model -> CAD and SysML remain cached, Modelica re-executes
    engine.invalidate([mDroneId]);
    assert.strictEqual(engine.getDomainRevision(LanguageDomainId.Modelica), 1);
    assert.strictEqual(engine.getDomainRevision(LanguageDomainId.STEP_CAD), 1);

    const cad3 = engine.query("tessellateMesh", cadAirframeId);
    assert.strictEqual(cadMeshExecCount, 2, "CAD mesh must stay cached when Modelica changes");
    assert.deepStrictEqual(cad3, cad1);

    const dae3 = engine.query("daeEquations", mDroneId);
    assert.strictEqual(daeExecCount, 2, "Modelica DAE must re-execute when Modelica changes");
    assert.deepStrictEqual(dae3, dae1);
  });

  test("cross-domain coupled query triggers early cut-off (backdating) on non-semantic CAD changes", () => {
    const index = createMockPolyglotWorkspace();

    let daeExecCount = 0;
    let cadMassExecCount = 0;
    let couplingExecCount = 0;

    let cadMassValue = 1.25;

    const queryHooks = new Map<string, QueryHooks>();

    queryHooks.set("modelica_class", {
      daeEquations: (db: QueryDB, entry: SymbolEntry) => {
        daeExecCount++;
        db.symbol(entry.id);
        return { equations: ["F_thrust = m * a"] };
      },

      aeroCadCoupling: (db: QueryDB, entry: SymbolEntry) => {
        couplingExecCount++;
        const dae = db.query("daeEquations", entry.id) as any;
        const cadId = db.resolvePolyglotSymbol("AirframeAssembly")!;
        const cad = db.query("cadMassProps", cadId) as any;
        return {
          equations: dae.equations,
          massKg: cad.massKg,
        };
      },
    });

    queryHooks.set("cad_product", {
      cadMassProps: (db: QueryDB, entry: SymbolEntry) => {
        cadMassExecCount++;
        db.symbol(entry.id);
        return { massKg: cadMassValue };
      },
    });

    const engine = new QueryEngine(index, queryHooks);
    const mDroneId = engine.resolvePolyglotSymbol("DroneAeroDynamics")!;
    const cadAirframeId = engine.resolvePolyglotSymbol("AirframeAssembly")!;

    // Initial execution
    const coupled1 = engine.query("aeroCadCoupling", mDroneId) as any;
    assert.strictEqual(couplingExecCount, 1);
    assert.strictEqual(daeExecCount, 1);
    assert.strictEqual(cadMassExecCount, 1);
    assert.strictEqual(coupled1.massKg, 1.25);

    // Case A: Non-semantic CAD edit (e.g. color/layer changed, but massKg is unchanged at 1.25)
    engine.invalidate([cadAirframeId]);

    // Query coupled result: cadMassProps re-executes, sees identical mass, early cutoff backdates!
    // Therefore aeroCadCoupling does NOT re-execute!
    const coupled2 = engine.query("aeroCadCoupling", mDroneId) as any;
    assert.strictEqual(cadMassExecCount, 2, "cadMassProps re-executes due to CAD invalidation");
    assert.strictEqual(daeExecCount, 1, "daeEquations was never invalidated");
    assert.strictEqual(couplingExecCount, 1, "aeroCadCoupling backdated due to identical mass value (early cut-off)");
    assert.strictEqual(coupled2.massKg, 1.25);

    // Case B: Semantic CAD edit (mass changes from 1.25 to 1.85 kg)
    cadMassValue = 1.85;
    engine.invalidate([cadAirframeId]);

    const coupled3 = engine.query("aeroCadCoupling", mDroneId) as any;
    assert.strictEqual(cadMassExecCount, 3, "cadMassProps re-executes with new mass");
    assert.strictEqual(daeExecCount, 1, "daeEquations STILL remains cached from revision 0");
    assert.strictEqual(couplingExecCount, 2, "aeroCadCoupling re-executes because dependency value actually changed");
    assert.strictEqual(coupled3.massKg, 1.85);
  });

  test("per-language version vectors isolate revisions across all 8 domains", () => {
    const index = createMockPolyglotWorkspace();
    const engine = new QueryEngine(index, new Map());
    const db = engine.toQueryDB();

    // All domains start at revision 0
    const allDomains = [
      LanguageDomainId.Modelica,
      LanguageDomainId.SysML2,
      LanguageDomainId.STEP_CAD,
      LanguageDomainId.OpenSCAD,
      LanguageDomainId.FEA,
      LanguageDomainId.CFD,
      LanguageDomainId.OWL2,
      LanguageDomainId.CSV,
    ];

    for (const d of allDomains) {
      assert.strictEqual(db.getDomainRevision!(d), 0);
      assert.strictEqual(db.hasDomainChanged!(d, 0), false);
    }

    // Invalidate FEA domain
    engine.invalidateDomain(LanguageDomainId.FEA);

    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.FEA), 1);
    assert.strictEqual(db.hasDomainChanged!(LanguageDomainId.FEA, 0), true);
    assert.strictEqual(db.hasDomainChanged!(LanguageDomainId.FEA, 1), false);

    // All other 7 domains are completely unaffected
    for (const d of allDomains) {
      if (d === LanguageDomainId.FEA) continue;
      assert.strictEqual(db.getDomainRevision!(d), 0, `Domain ${LanguageDomainId[d]} must stay at revision 0`);
      assert.strictEqual(db.hasDomainChanged!(d, 0), false);
    }

    // Invalidate STEP_CAD
    engine.invalidateDomain(LanguageDomainId.STEP_CAD);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.STEP_CAD), 1);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.Modelica), 0);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.FEA), 1);

    // Increment STEP_CAD again
    engine.invalidateDomain(LanguageDomainId.STEP_CAD);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.STEP_CAD), 2);
    assert.strictEqual(db.hasDomainChanged!(LanguageDomainId.STEP_CAD, 1), true);
    assert.strictEqual(db.hasDomainChanged!(LanguageDomainId.STEP_CAD, 2), false);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.Modelica), 0);
  });

  test("direct domain revision dependency tracking invalidates queries on domain bump", () => {
    const index = createMockPolyglotWorkspace();

    let cadWatcherExecCount = 0;
    const queryHooks = new Map<string, QueryHooks>();

    queryHooks.set("modelica_class", {
      cadWatcher: (db: QueryDB, entry: SymbolEntry) => {
        cadWatcherExecCount++;
        // Explicitly inspect STEP_CAD domain revision
        const cadRev = db.getDomainRevision!(LanguageDomainId.STEP_CAD);
        return { entryName: entry.name, cadRev };
      },
    });

    const engine = new QueryEngine(index, queryHooks);
    const mDroneId = engine.resolvePolyglotSymbol("DroneAeroDynamics")!;

    // Initial run
    const res1 = engine.query("cadWatcher", mDroneId) as any;
    assert.strictEqual(cadWatcherExecCount, 1);
    assert.strictEqual(res1.cadRev, 0);

    // Invalidate Modelica domain -> cadWatcher depends on STEP_CAD domain, not Modelica domain
    engine.incrementDomainRevision(LanguageDomainId.Modelica);
    const res2 = engine.query("cadWatcher", mDroneId) as any;
    assert.strictEqual(cadWatcherExecCount, 1, "Query should skip re-execution when unrelated domain changes");
    assert.strictEqual(res2.cadRev, 0);

    // Invalidate STEP_CAD domain directly
    engine.invalidateDomain(LanguageDomainId.STEP_CAD);
    const res3 = engine.query("cadWatcher", mDroneId) as any;
    assert.strictEqual(cadWatcherExecCount, 2, "Query MUST re-execute when tracked domain revision increments");
    assert.strictEqual(res3.cadRev, 1);
  });

  test("swapIndex with localized domain change preserves other domain query memos", () => {
    const index = createMockPolyglotWorkspace();

    let daeExecCount = 0;
    let cadExecCount = 0;

    const queryHooks = new Map<string, QueryHooks>();
    queryHooks.set("modelica_class", {
      dae: (db: QueryDB, entry: SymbolEntry) => {
        daeExecCount++;
        return { name: db.symbol(entry.id)?.name };
      },
    });
    queryHooks.set("cad_product", {
      mesh: (db: QueryDB, entry: SymbolEntry) => {
        cadExecCount++;
        return { name: db.symbol(entry.id)?.name };
      },
    });

    const engine = new QueryEngine(index, queryHooks);
    const mDroneId = engine.resolvePolyglotSymbol("DroneAeroDynamics")!;
    const cadAirframeId = engine.resolvePolyglotSymbol("AirframeAssembly")!;

    // Warm caches
    engine.query("dae", mDroneId);
    engine.query("mesh", cadAirframeId);
    assert.strictEqual(daeExecCount, 1);
    assert.strictEqual(cadExecCount, 1);

    // Clone index and add a new SysML2 part
    const newSymbols = new Map(index.symbols);
    const newByName = new Map(index.byName);
    const newChildrenOf = new Map(index.childrenOf);

    const sNewBatteryId = makePolyglotSymbolId(LanguageDomainId.SysML2, 99);
    newSymbols.set(sNewBatteryId, {
      id: sNewBatteryId,
      name: "LiPoBattery",
      kind: "Definition",
      ruleName: "sysml_part",
      namePath: "name",
      startByte: 0,
      endByte: 100,
      parentId: null,
      exports: [],
      inherits: [],
    });

    const newIndex: SymbolIndex = {
      symbols: newSymbols,
      byName: newByName,
      childrenOf: newChildrenOf,
    };

    // Swap index with only SysML2 symbol marked changed
    engine.swapIndex(newIndex, new Set([sNewBatteryId]));

    // Query Modelica DAE and STEP CAD mesh -> both must be 100% cache hits
    engine.query("dae", mDroneId);
    engine.query("mesh", cadAirframeId);
    assert.strictEqual(daeExecCount, 1, "Modelica DAE query must survive swapIndex when only SysML changes");
    assert.strictEqual(cadExecCount, 1, "CAD mesh query must survive swapIndex when only SysML changes");

    // Memo lookup directly
    const daeMemo = engine.getMemoFor("dae", mDroneId);
    assert.ok(daeMemo !== undefined);
    assert.strictEqual(daeMemo?.changed_at, 0);
  });
});
