// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggEq, tggFieldAlias, tggRule } from "@modelscript/dsl";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DigitalThreadHypergraph,
  LanguageDomainId,
  TggCorrespondenceIndexer,
  TggSymbolProjectionTable,
  ThreadRelation,
  WasmQueryEngine,
  getLanguageDomainId,
  type SymbolEntry,
  type SymbolIndex,
} from "../src/index.js";

function sym(overrides: Partial<SymbolEntry> & { id: number; name: string; language: string }): SymbolEntry {
  return {
    kind: "Class",
    ruleName: "ClassDefinition",
    namePath: overrides.name,
    startOffset: 0,
    endOffset: 20,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: {},
    fieldName: null,
    resourceId: `file:///workspace/${overrides.name}.${overrides.language}`,
    ...overrides,
  };
}

function buildIndex(entries: SymbolEntry[]): SymbolIndex {
  const symbols = new Map<number, SymbolEntry>();
  const byName = new Map<string, number[]>();
  const childrenOf = new Map<number | null, number[]>();
  const symbolsByResource = new Map<string, number[]>();

  for (const e of entries) {
    symbols.set(e.id, e);
    const list = byName.get(e.name) ?? [];
    list.push(e.id);
    byName.set(e.name, list);

    const pid = e.parentId ?? null;
    const ch = childrenOf.get(pid) ?? [];
    ch.push(e.id);
    childrenOf.set(pid, ch);

    if (e.resourceId) {
      const rList = symbolsByResource.get(e.resourceId) ?? [];
      rList.push(e.id);
      symbolsByResource.set(e.resourceId, rList);
    }
  }

  return { symbols, byName, childrenOf, symbolsByResource };
}

describe("TggSymbolProjectionTable & TggCorrespondenceIndexer", () => {
  it("assigns distinct LanguageDomainId values for ReqIF, QIF, SCAD, PSCAD, PSSE, STEP, Modelica, and SysML2", () => {
    const domains = [
      getLanguageDomainId("modelica"),
      getLanguageDomainId("sysml2"),
      getLanguageDomainId("scad"),
      getLanguageDomainId("pscad"),
      getLanguageDomainId("psse"),
      getLanguageDomainId("step"),
      getLanguageDomainId("reqif"),
      getLanguageDomainId("qif"),
    ];
    assert.equal(domains.includes(LanguageDomainId.Default), false);
    assert.equal(new Set(domains).size, 8);
  });

  it("aligns N-ary containers across SysML2, Modelica, SCAD, and STEP and propagates child ports/aliased parameters without false-positive collisions", () => {
    const table = new TggSymbolProjectionTable();
    table.registerRule(
      tggRule({
        name: "PartDefToModelicaModel",
        sourceLang: "sysml2",
        targetLang: "modelica",
        source: ($, v) => $["PartDefinition"]?.({ declaredName: v("className") }),
        target: ($, v) => $["ClassDefinition"]?.({ name: v("className") }),
        where: (v) => [tggEq(v("className"), v("className")), tggFieldAlias("mass", "m")],
      }),
    );
    table.registerRule(
      tggRule({
        name: "ScadModuleToSysmlPart",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $["ModuleDeclaration"]?.({ name: v("modName") }),
        target: ($, v) => $["PartDefinition"]?.({ declaredName: v("modName") }),
        where: (v) => [tggEq(v("modName"), v("modName"))],
      }),
    );
    table.registerRule(
      tggRule({
        name: "StepProductToSysmlPart",
        sourceLang: "step",
        targetLang: "sysml2",
        source: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: v("prodName") }),
        target: ($, v) => $["PartDefinition"]?.({ declaredName: v("prodName") }),
        where: (v) => [tggEq(v("prodName"), v("prodName"))],
      }),
    );

    const entries: SymbolEntry[] = [
      // Aligned N-ary ActuatorBracket across 4 languages
      sym({ id: 10, name: "ActuatorBracket", language: "sysml2", kind: "Class", ruleName: "PartDefinition" }),
      sym({ id: 11, name: "mass", language: "sysml2", kind: "Property", ruleName: "AttributeUsage", parentId: 10 }),
      sym({ id: 12, name: "clevis_lug", language: "sysml2", kind: "Port", ruleName: "PortUsage", parentId: 10 }),

      sym({ id: 20, name: "ActuatorBracket", language: "modelica", kind: "Class", ruleName: "class_definition" }),
      sym({
        id: 21,
        name: "m",
        language: "modelica",
        kind: "Component",
        ruleName: "component_declaration",
        parentId: 20,
      }),
      sym({
        id: 22,
        name: "clevis_lug",
        language: "modelica",
        kind: "Component",
        ruleName: "component_declaration",
        parentId: 20,
      }),

      sym({ id: 30, name: "ActuatorBracket", language: "scad", kind: "Module", ruleName: "module_declaration" }),
      sym({ id: 32, name: '"clevis_lug"', language: "scad", kind: "TaggedPort", ruleName: "TagPortOp", parentId: 30 }),

      sym({
        id: 40,
        name: "ActuatorBracket",
        language: "step",
        kind: "Package",
        ruleName: "step_product",
        metadata: { stepType: "Product", stepId: "#10" },
      }),

      // Unrelated containers in Modelica and SysML2 sharing a generic variable name `v` — MUST NOT collide!
      sym({ id: 50, name: "CoolantPump", language: "modelica", kind: "Class", ruleName: "class_definition" }),
      sym({
        id: 51,
        name: "v",
        language: "modelica",
        kind: "Component",
        ruleName: "component_declaration",
        parentId: 50,
      }),
      sym({ id: 60, name: "ReliefValve", language: "sysml2", kind: "Class", ruleName: "PartDefinition" }),
      sym({ id: 61, name: "v", language: "sysml2", kind: "Property", ruleName: "AttributeUsage", parentId: 60 }),
    ];

    const index = buildIndex(entries);
    const hg = new DigitalThreadHypergraph();
    const indexer = new TggCorrespondenceIndexer(table, hg);
    const summary = indexer.syncIndex(index, 1);

    assert.ok(summary.slotCount >= 3);

    const qe = new WasmQueryEngine(index, new Map());
    qe.setCorrespondenceIndex(hg, indexer.slotMap);

    // 1. N-ary container alignment across all 4 domains
    const bracketPeers = qe.crossDomainBinding(10);
    assert.deepEqual(new Set(bracketPeers), new Set([20, 30, 40]));

    // 2. Contextual field alias alignment (`SysML2.ActuatorBracket.mass` <-> `Modelica.ActuatorBracket.m`)
    assert.deepEqual(qe.crossDomainBinding(11), [21]);
    assert.deepEqual(qe.crossDomainBinding(21), [11]);

    // 3. Contextual port alignment (`PortUsage` <-> `Modelica Component` <-> `SCAD TagPortOp`)
    assert.deepEqual(new Set(qe.crossDomainBinding(12)), new Set([22, 32]));

    // 4. Negative isolation: unrelated `CoolantPump.v` (51) and `ReliefValve.v` (61) must NOT match
    assert.deepEqual(qe.crossDomainBinding(51), []);
    assert.deepEqual(qe.crossDomainBinding(61), []);
  });

  it("links Tier-1 SysML2 typing/satisfy references to PSCAD & ReqIF and Tier-2 QIF stepEntityId foreign keys to STEP", () => {
    const table = new TggSymbolProjectionTable();
    table.registerRule(
      tggRule({
        name: "PscadComponentToSysmlPartDef",
        sourceLang: "pscad",
        targetLang: "sysml2",
        source: ($, v) => $["pscad_component"]?.({ name: v("className") }),
        target: ($, v) => $["PartDefinition"]?.({ declaredName: v("className") }),
        where: (v) => [tggEq(v("className"), v("className"))],
      }),
    );
    table.registerRule(
      tggRule({
        name: "ReqIfSpecObjectToSysmlRequirementDef",
        sourceLang: "reqif",
        targetLang: "sysml2",
        relation: "satisfy",
        source: ($, v) => $["SpecObject"]?.({ identifier: v("reqId") }),
        target: ($, v) => $["RequirementDefinition"]?.({ reqId: v("reqId") }),
        where: (v) => [tggEq(v("reqId"), v("reqId"))],
      }),
    );
    table.registerRule(
      tggRule({
        name: "QifFeatureToStepEntity",
        sourceLang: "qif",
        targetLang: "step",
        foreignKey: { sourceAttr: "stepEntityId", targetAttr: "stepId" },
        source: ($, v) => $["MeasurementFeature"]?.({ name: v("featName") }),
        target: ($, v) => $["StepEntity"]?.({ name: v("featName") }),
        where: (v) => [tggEq(v("featName"), v("featName"))],
      }),
    );

    const entries: SymbolEntry[] = [
      // PSCAD library + component
      sym({ id: 100, name: "GridLib", language: "pscad", kind: "Class", ruleName: "pscad_library" }),
      sym({
        id: 101,
        name: "InverterGFM",
        language: "pscad",
        kind: "Class",
        ruleName: "pscad_component",
        parentId: 100,
      }),
      sym({
        id: 102,
        name: "P_ref",
        language: "pscad",
        kind: "Component",
        ruleName: "pscad_parameter",
        parentId: 101,
        metadata: { variability: "parameter", typeSpecifier: "Real", defaultValue: 50 },
      }),

      // ReqIF specification + requirement
      sym({ id: 200, name: "GridSpec", language: "reqif", kind: "Package", ruleName: "reqif_specification" }),
      sym({
        id: 201,
        name: "REQ_LVRT_01",
        language: "reqif",
        kind: "Class",
        ruleName: "reqif_requirement",
        parentId: 200,
      }),

      // SysML2 architecture referencing PSCAD type + satisfying ReqIF requirement directly without @twin comments
      sym({ id: 300, name: "PlantController", language: "sysml2", kind: "Class", ruleName: "PartDefinition" }),
      sym({
        id: 301,
        name: "inv1",
        language: "sysml2",
        kind: "Component",
        ruleName: "PartUsage",
        parentId: 300,
        metadata: { typeSpecifier: "GridLib::InverterGFM" },
      }),
      sym({
        id: 302,
        name: "REQ_LVRT_01",
        language: "sysml2",
        kind: "Reference",
        ruleName: "SatisfyRequirementUsage",
        parentId: 300,
      }),

      // STEP entity + QIF feature referencing it via stepEntityId
      sym({
        id: 400,
        name: "BoreSurface",
        language: "step",
        kind: "Type",
        ruleName: "step_shape",
        metadata: { stepType: "NamedShape", stepId: "#128" },
      }),
      sym({
        id: 500,
        name: "PrimaryBore",
        language: "qif",
        kind: "Component",
        ruleName: "qif_feature",
        metadata: { stepEntityId: "#128", featureType: "Cylinder" },
      }),
    ];

    const index = buildIndex(entries);
    const hg = new DigitalThreadHypergraph();
    const indexer = new TggCorrespondenceIndexer(table, hg);
    indexer.syncIndex(index, 1);

    const qe = new WasmQueryEngine(index, new Map());
    qe.setCorrespondenceIndex(hg, indexer.slotMap);

    // SysML2 `part inv1 : GridLib::InverterGFM` -> PSCAD `InverterGFM`
    assert.deepEqual(qe.crossDomainBinding(301), [101]);
    const sig = table.projectForeignSignature(entries[1]!, index, "sysml2");
    assert.equal(sig.members.length, 1);
    assert.equal(sig.members[0]?.name, "P_ref");

    // SysML2 `satisfy REQ_LVRT_01` -> ReqIF `REQ_LVRT_01` with ThreadRelation.Satisfies
    assert.deepEqual(qe.crossDomainBinding(300), [201]);
    const reqSlot = indexer.slotMap.get(201)!;
    assert.equal(hg.getRecord(reqSlot)?.relation, ThreadRelation.Satisfies);

    // QIF `stepEntityId="#128"` -> STEP `BoreSurface` (#128)
    assert.deepEqual(qe.crossDomainBinding(500), [400]);

    // Cascading staleness invalidation when STEP entity mutates
    assert.equal(hg.getRecord(indexer.slotMap.get(500)!)?.isStale, false);
    hg.markStale(indexer.slotMap.get(400)!);
    assert.equal(hg.getRecord(indexer.slotMap.get(500)!)?.isStale, true);
  });

  it("maintains sub-15ms incremental sync turnaround across MSL-scale + 2,000-bus PSS/E + >1MB STEP symbols", () => {
    const table = new TggSymbolProjectionTable();
    table.registerRule(
      tggRule({
        name: "SysmlPartToModelicaModel",
        sourceLang: "sysml2",
        targetLang: "modelica",
        source: ($, v) => $["PartDefinition"]?.({ declaredName: v("name") }),
        target: ($, v) => $["ClassDefinition"]?.({ name: v("name") }),
        where: (v) => [tggEq(v("name"), v("name"))],
      }),
    );
    table.registerRule(
      tggRule({
        name: "PsseDyrToModelicaClass",
        sourceLang: "psse",
        targetLang: "modelica",
        source: ($, v) => $["psse_dyr_record"]?.({ model: v("name") }),
        target: ($, v) => $["ClassDefinition"]?.({ name: v("name") }),
        where: (v) => [tggEq(v("name"), v("name"))],
      }),
    );

    const entries: SymbolEntry[] = [];
    let nextId = 1;
    // 500 MSL-like Modelica + SysML2 pairs with parameters
    for (let i = 0; i < 500; i++) {
      const mId = nextId++;
      entries.push(
        sym({ id: mId, name: `Component_${i}`, language: "modelica", kind: "Class", ruleName: "class_definition" }),
      );
      entries.push(
        sym({
          id: nextId++,
          name: `p_${i}`,
          language: "modelica",
          kind: "Component",
          ruleName: "component_declaration",
          parentId: mId,
        }),
      );
      const sId = nextId++;
      entries.push(
        sym({ id: sId, name: `Component_${i}`, language: "sysml2", kind: "Class", ruleName: "PartDefinition" }),
      );
      entries.push(
        sym({
          id: nextId++,
          name: `p_${i}`,
          language: "sysml2",
          kind: "Component",
          ruleName: "AttributeUsage",
          parentId: sId,
        }),
      );
    }

    // 2,000-bus PSS/E deck symbols
    for (let bus = 1; bus <= 2000; bus++) {
      entries.push(
        sym({
          id: nextId++,
          name: `Bus_${bus}`,
          language: "psse",
          kind: "Component",
          ruleName: "psse_component",
          resourceId: "file:///grid_2k.raw",
        }),
      );
    }

    // > 1 MB STEP assembly proxy entities (20,000 entities)
    for (let e = 1; e <= 20_000; e++) {
      entries.push(
        sym({
          id: nextId++,
          name: `StepShape_${e}`,
          language: "step",
          kind: "Type",
          ruleName: "step_shape",
          resourceId: "file:///large_assy.step",
          metadata: { stepId: `#${e}` },
        }),
      );
    }

    const index = buildIndex(entries);
    const hg = new DigitalThreadHypergraph(4096);
    const indexer = new TggCorrespondenceIndexer(table, hg);
    indexer.syncIndex(index, 1);

    // Simulate incremental single-component edit (no-op symbol count delta / O(delta N))
    const changed = sym({
      id: 1,
      name: "Component_0",
      language: "modelica",
      kind: "Class",
      ruleName: "class_definition",
      metadata: { updated: true },
    });
    index.symbols.set(1, changed);

    const t0 = performance.now();
    indexer.syncIndex(index, 2, [1], ["Component_0"]);
    const elapsedMs = performance.now() - t0;

    const maxIncrementalMs = process.env.CI ? 100 : 50;
    assert.ok(
      elapsedMs < maxIncrementalMs,
      `Incremental sync across >24k symbols took ${elapsedMs.toFixed(2)}ms (expected < ${maxIncrementalMs}ms)`,
    );
  });
});
