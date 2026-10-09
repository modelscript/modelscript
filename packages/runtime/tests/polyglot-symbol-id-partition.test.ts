// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  getLanguageDomainId,
  getLocalSymbolSeq,
  getSymbolDomain,
  LanguageDomainId,
  makePolyglotSymbolId,
  type SymbolEntry,
  type SymbolIndex,
  UnifiedWorkspace,
} from "../src/index.js";

describe("Polyglot SymbolId Partitioning and Collision-Free Merging", () => {
  test("makePolyglotSymbolId, getSymbolDomain, and getLocalSymbolSeq work as expected", () => {
    const modelicaId = makePolyglotSymbolId(LanguageDomainId.Modelica, 42);
    assert.equal(getSymbolDomain(modelicaId), LanguageDomainId.Modelica);
    assert.equal(getLocalSymbolSeq(modelicaId), 42);

    const sysmlId = makePolyglotSymbolId(LanguageDomainId.SysML2, 100);
    assert.equal(getSymbolDomain(sysmlId), LanguageDomainId.SysML2);
    assert.equal(getLocalSymbolSeq(sysmlId), 100);

    const stepId = makePolyglotSymbolId(LanguageDomainId.STEP_CAD, 9999);
    assert.equal(getSymbolDomain(stepId), LanguageDomainId.STEP_CAD);
    assert.equal(getLocalSymbolSeq(stepId), 9999);

    assert.notEqual(modelicaId, sysmlId);
    assert.notEqual(sysmlId, stepId);
  });

  test("getLanguageDomainId maps engineering domain strings to domain IDs", () => {
    assert.equal(getLanguageDomainId("modelica"), LanguageDomainId.Modelica);
    assert.equal(getLanguageDomainId("sysml2"), LanguageDomainId.SysML2);
    assert.equal(getLanguageDomainId("step"), LanguageDomainId.STEP_CAD);
    assert.equal(getLanguageDomainId("cad"), LanguageDomainId.STEP_CAD);
    assert.equal(getLanguageDomainId("owl2"), LanguageDomainId.OWL2);
    assert.equal(getLanguageDomainId("ssp"), LanguageDomainId.SSP);
    assert.equal(getLanguageDomainId("cfd"), LanguageDomainId.CFD);
    assert.equal(getLanguageDomainId("fea"), LanguageDomainId.FEA);
    assert.equal(getLanguageDomainId("scad"), LanguageDomainId.SCAD);
    assert.equal(getLanguageDomainId("csv"), LanguageDomainId.CSV);
    assert.equal(getLanguageDomainId("unknown"), LanguageDomainId.Default);
  });

  test("UnifiedWorkspace detects and resolves colliding IDs across workspaces", () => {
    const ws = new UnifiedWorkspace();

    // Both sub-workspaces have id: 1
    const modelicaEntry: SymbolEntry = {
      id: 1,
      name: "ChassisModel",
      kind: "Class",
      ruleName: "class_definition",
      namePath: "name",
      startByte: 0,
      endByte: 100,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {},
      fieldName: null,
    };

    const sysmlEntry: SymbolEntry = {
      id: 1, // Collides with modelicaEntry!
      name: "ChassisPart",
      kind: "PartDef",
      ruleName: "part_def",
      namePath: "name",
      startByte: 0,
      endByte: 100,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {},
      fieldName: null,
    };

    const wsM: any = {
      toUnified: (): SymbolIndex => ({
        symbols: new Map([[1, modelicaEntry]]),
        byName: new Map([["ChassisModel", [1]]]),
        childrenOf: new Map([[null, [1]]]),
      }),
    };

    const wsS: any = {
      toUnified: (): SymbolIndex => ({
        symbols: new Map([[1, sysmlEntry]]),
        byName: new Map([["ChassisPart", [1]]]),
        childrenOf: new Map([[null, [1]]]),
      }),
    };

    ws.registerWorkspace("modelica", wsM);
    ws.registerWorkspace("sysml2", wsS);

    const merged = ws.toSymbolIndex();

    // Both symbols must exist (size 2, NOT 1)
    assert.equal(merged.symbols.size, 2, "Merged symbols must not clobber colliding IDs");

    // First workspace kept id: 1
    assert.ok(merged.symbols.has(1));
    assert.equal(merged.symbols.get(1)?.name, "ChassisModel");
    assert.equal(merged.symbols.get(1)?.language, "modelica");

    // Second workspace remapped colliding id: 1 to SysML2 domain partitioned ID
    const expectedSysmlId = makePolyglotSymbolId(LanguageDomainId.SysML2, 1);
    assert.ok(merged.symbols.has(expectedSysmlId));
    assert.equal(merged.symbols.get(expectedSysmlId)?.name, "ChassisPart");
    assert.equal(merged.symbols.get(expectedSysmlId)?.language, "sysml2");

    // Lookups in byName and childrenOf must also be remapped
    assert.deepEqual(merged.byName.get("ChassisModel"), [1]);
    assert.deepEqual(merged.byName.get("ChassisPart"), [expectedSysmlId]);
    assert.deepEqual(merged.childrenOf.get(null), [1, expectedSysmlId]);
  });

  test("UnifiedWorkspace with domainPartitioning=true partitions all domain symbols", () => {
    const ws = new UnifiedWorkspace();
    ws.domainPartitioning = true;

    const entryM: SymbolEntry = {
      id: 10,
      name: "Inverter",
      kind: "Class",
      ruleName: "class_definition",
      namePath: "name",
      startByte: 0,
      endByte: 50,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {},
      fieldName: null,
    };

    const entryS: SymbolEntry = {
      id: 20,
      name: "InverterDef",
      kind: "PartDef",
      ruleName: "part_def",
      namePath: "name",
      startByte: 0,
      endByte: 50,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {},
      fieldName: null,
    };

    const wsM: any = {
      toUnified: (): SymbolIndex => ({
        symbols: new Map([[10, entryM]]),
        byName: new Map([["Inverter", [10]]]),
        childrenOf: new Map([[null, [10]]]),
      }),
    };

    const wsS: any = {
      toUnified: (): SymbolIndex => ({
        symbols: new Map([[20, entryS]]),
        byName: new Map([["InverterDef", [20]]]),
        childrenOf: new Map([[null, [20]]]),
      }),
    };

    ws.registerWorkspace("modelica", wsM);
    ws.registerWorkspace("sysml2", wsS);

    const merged = ws.toSymbolIndex();
    assert.equal(merged.symbols.size, 2);

    const partitionedMId = makePolyglotSymbolId(LanguageDomainId.Modelica, 10);
    const partitionedSId = makePolyglotSymbolId(LanguageDomainId.SysML2, 20);

    assert.ok(merged.symbols.has(partitionedMId));
    assert.ok(merged.symbols.has(partitionedSId));

    assert.equal(getSymbolDomain(partitionedMId), LanguageDomainId.Modelica);
    assert.equal(getSymbolDomain(partitionedSId), LanguageDomainId.SysML2);

    assert.deepEqual(merged.byName.get("Inverter"), [partitionedMId]);
    assert.deepEqual(merged.byName.get("InverterDef"), [partitionedSId]);
  });
});
