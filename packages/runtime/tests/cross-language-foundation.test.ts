// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LanguageDomainId,
  PolyglotTransformer,
  UnifiedWorkspace,
  WasmQueryEngine,
  WorkspaceTypeRegistry,
  checkPortPlugCompatibility,
  extractCrossLanguageLinks,
  extractPortSignature,
  getLanguageDomainId,
  getSemanticRole,
  isMemberLikeSymbol,
  isNamespaceLikeSymbol,
  isPortDefinitionSymbol,
  isPortLikeSymbol,
  isRelationshipOrImportSymbol,
  isTypeLikeSymbol,
  normalizeQualifiedName,
  splitQualifiedPath,
  stripConjugationPrefix,
  symbolEntryToPolyglotNode,
  type SymbolEntry,
  type SymbolIndex,
} from "../src/index.js";

function makeEntry(overrides: Partial<SymbolEntry> & { id: number; name: string }): SymbolEntry {
  return {
    kind: "Class",
    parentId: null,
    startOffset: 0,
    endOffset: 10,
    language: "modelica",
    ...overrides,
  };
}

function buildMiniIndex(entries: SymbolEntry[]): SymbolIndex {
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

function makePortLookupDb(index: SymbolIndex) {
  return {
    symbol: (id: number) => index.symbols.get(id),
    childrenOf: (id: number | null) =>
      (index.childrenOf.get(id) ?? []).map((cid) => index.symbols.get(cid)).filter((e): e is SymbolEntry => Boolean(e)),
    byName: (name: string) =>
      (index.byName.get(name) ?? []).map((id) => index.symbols.get(id)).filter((e): e is SymbolEntry => Boolean(e)),
  };
}

describe("Cross-Language Foundation Helpers", () => {
  it("classifies semantic roles consistently across Modelica, SysML2, PSS/E, and PSCAD", () => {
    const moPkg = makeEntry({ id: 1, name: "Electrical", kind: "Package", ruleName: "Package", language: "modelica" });
    const moPin = makeEntry({
      id: 2,
      name: "Pin",
      kind: "Class",
      metadata: { classPrefixes: "connector" },
      language: "modelica",
    });
    const sysDef = makeEntry({
      id: 3,
      name: "Motor",
      kind: "Definition",
      ruleName: "PartDefinition",
      language: "sysml2",
    });
    const sysPortDef = makeEntry({
      id: 4,
      name: "DrivePort",
      kind: "Definition",
      ruleName: "PortDefinition",
      language: "sysml2",
    });
    const sysPortUse = makeEntry({ id: 5, name: "p", kind: "Usage", ruleName: "PortUsage", language: "sysml2" });
    const sysPartUse = makeEntry({ id: 6, name: "motor", kind: "Usage", ruleName: "PartUsage", language: "sysml2" });
    const sysTyping = makeEntry({
      id: 7,
      name: "Motor",
      kind: "Reference",
      ruleName: "OwnedFeatureTyping",
      language: "sysml2",
    });
    const importEdge = makeEntry({
      id: 8,
      name: "Electrical.*",
      kind: "Import",
      ruleName: "Import",
      language: "sysml2",
    });
    const psseGen = makeEntry({
      id: 9,
      name: "GENROU_1",
      kind: "Component",
      ruleName: "psse_dyr_record",
      language: "psse",
    });
    const pscadComp = makeEntry({
      id: 10,
      name: "VSC_Bridge",
      kind: "Class",
      ruleName: "pscad_component",
      language: "pscad",
    });

    assert.equal(getSemanticRole(moPkg), "namespace");
    assert.equal(isNamespaceLikeSymbol(moPkg), true);
    assert.equal(isTypeLikeSymbol(moPkg), true);

    assert.equal(getSemanticRole(moPin), "port");
    assert.equal(isPortDefinitionSymbol(moPin), true);
    assert.equal(isTypeLikeSymbol(moPin), true);
    assert.equal(isMemberLikeSymbol(moPin), false);

    assert.equal(getSemanticRole(sysDef), "type");
    assert.equal(isTypeLikeSymbol(sysDef), true);

    assert.equal(isPortDefinitionSymbol(sysPortDef), true);
    assert.equal(isPortLikeSymbol(sysPortDef), true);
    assert.equal(isTypeLikeSymbol(sysPortDef), true);

    assert.equal(isPortDefinitionSymbol(sysPortUse), false);
    assert.equal(isPortLikeSymbol(sysPortUse), true);
    assert.equal(isMemberLikeSymbol(sysPortUse), true);
    assert.equal(isTypeLikeSymbol(sysPortUse), false);

    assert.equal(isMemberLikeSymbol(sysPartUse), true);
    assert.equal(isTypeLikeSymbol(sysPartUse), false);

    assert.equal(isRelationshipOrImportSymbol(sysTyping), true);
    assert.equal(isRelationshipOrImportSymbol(importEdge), true);
    assert.equal(isTypeLikeSymbol(sysTyping), false);

    assert.equal(isMemberLikeSymbol(psseGen), true);
    assert.equal(isTypeLikeSymbol(pscadComp), true);
  });

  it("splits and normalizes qualified paths while preserving quoted Modelica identifiers", () => {
    assert.deepEqual(splitQualifiedPath("Modelica::Electrical::Analog::'v.pos'"), [
      "Modelica",
      "Electrical",
      "Analog",
      "'v.pos'",
    ]);
    assert.deepEqual(splitQualifiedPath("~DriveSystem.Ports.SpinPort"), ["DriveSystem", "Ports", "SpinPort"]);
    assert.equal(normalizeQualifiedName("DriveSystem::MotorBlock", "modelica"), "DriveSystem.MotorBlock");
    assert.equal(normalizeQualifiedName("Electrical.Machines.DC", "sysml2"), "Electrical::Machines::DC");
    assert.deepEqual(stripConjugationPrefix("~DrivePort"), { isConjugated: true, cleanPath: "DrivePort" });
  });

  it("checks cross-language port plug compatibility including conjugation and flow balance", () => {
    const entries: SymbolEntry[] = [
      // Modelica Pin { v (Real), flow i (Real) }
      makeEntry({ id: 1, name: "Pin", kind: "Class", metadata: { classPrefixes: "connector" }, language: "modelica" }),
      makeEntry({
        id: 2,
        name: "v",
        kind: "Component",
        parentId: 1,
        metadata: { typeSpecifier: "Real" },
        language: "modelica",
      }),
      makeEntry({
        id: 3,
        name: "i",
        kind: "Component",
        parentId: 1,
        metadata: { typeSpecifier: "Real", isFlow: true },
        language: "modelica",
      }),
      // SysML2 PortDef { out attribute v : Real; attribute i : Real; } vs compatible flow PinPort { attribute v : ScalarValues::Real; attribute i : ScalarValues::Real (isFlow); }
      makeEntry({ id: 10, name: "SysPin", kind: "Definition", ruleName: "PortDefinition", language: "sysml2" }),
      makeEntry({
        id: 11,
        name: "v",
        kind: "Usage",
        ruleName: "AttributeUsage",
        parentId: 10,
        metadata: { typeSpecifier: "ScalarValues::Real" },
        language: "sysml2",
      }),
      makeEntry({
        id: 12,
        name: "i",
        kind: "Usage",
        ruleName: "AttributeUsage",
        parentId: 10,
        metadata: { typeSpecifier: "ScalarValues::Real", isFlow: true },
        language: "sysml2",
      }),
      // Incompatible port missing flow on i
      makeEntry({ id: 20, name: "BadSysPin", kind: "Definition", ruleName: "PortDefinition", language: "sysml2" }),
      makeEntry({
        id: 21,
        name: "v",
        kind: "Usage",
        ruleName: "AttributeUsage",
        parentId: 20,
        metadata: { typeSpecifier: "ScalarValues::Real" },
        language: "sysml2",
      }),
      makeEntry({
        id: 22,
        name: "i",
        kind: "Usage",
        ruleName: "AttributeUsage",
        parentId: 20,
        metadata: { typeSpecifier: "ScalarValues::Real" },
        language: "sysml2",
      }),
      // Signal ports (in vs out + conjugation)
      makeEntry({ id: 30, name: "OutSig", kind: "Definition", ruleName: "PortDefinition", language: "sysml2" }),
      makeEntry({
        id: 31,
        name: "u",
        kind: "Usage",
        ruleName: "AttributeUsage",
        parentId: 30,
        metadata: { typeSpecifier: "ScalarValues::Real", direction: "out" },
        language: "sysml2",
      }),
      makeEntry({ id: 32, name: "uOut", kind: "Usage", ruleName: "PortUsage", language: "sysml2" }),
      makeEntry({
        id: 33,
        name: "OutSig",
        kind: "Reference",
        ruleName: "OwnedFeatureTyping",
        parentId: 32,
        language: "sysml2",
      }),
      makeEntry({ id: 34, name: "uConj", kind: "Usage", ruleName: "PortUsage", language: "sysml2" }),
      makeEntry({
        id: 35,
        name: "~OutSig",
        kind: "Reference",
        ruleName: "ConjugatedPortTyping",
        parentId: 34,
        language: "sysml2",
      }),
    ];

    const db = makePortLookupDb(buildMiniIndex(entries));
    const registry = new WorkspaceTypeRegistry();

    const sigMo = extractPortSignature(db, entries[0], { registry });
    const sigSys = extractPortSignature(db, entries[3], { registry });
    const sigBad = extractPortSignature(db, entries[6], { registry });
    const sigOut = extractPortSignature(db, entries[11], { registry });
    const sigConj = extractPortSignature(db, entries[13], { registry });

    assert.ok(sigMo && sigSys && sigBad && sigOut && sigConj);
    assert.equal(checkPortPlugCompatibility(sigMo, sigSys, registry).compatible, true);

    const flowErr = checkPortPlugCompatibility(sigMo, sigBad, registry);
    assert.equal(flowErr.compatible, false);
    assert.match(flowErr.reason ?? "", /flow polarity mismatch/i);

    assert.equal(checkPortPlugCompatibility(sigOut, sigConj, registry).compatible, true);
    const sameDirErr = checkPortPlugCompatibility(sigOut, sigOut, registry);
    assert.equal(sameDirErr.compatible, false);
    assert.match(sameDirErr.reason ?? "", /direction mismatch/i);
  });

  it("populates symbolsByResource, recognizes PSSE domain, and broadcasts updateQueryEngines", () => {
    assert.equal(getLanguageDomainId("psse"), LanguageDomainId.PSSE);

    const uw = new UnifiedWorkspace();
    let updatedCall: { resCount: number; uri: unknown; names: Set<string> | undefined } | null = null;
    const fakeEngine = {
      updateIndex: (
        idx: SymbolIndex,
        uri?: string,
        _changedIds?: Set<number>,
        _structIds?: Set<number>,
        changedNames?: Set<string>,
      ) => {
        updatedCall = {
          resCount: idx.symbolsByResource?.get("file:///a.mo")?.length ?? 0,
          uri,
          names: changedNames,
        };
      },
    } as unknown as WasmQueryEngine;
    uw.registerQueryEngine("sysml2", fakeEngine);

    const idxA = buildMiniIndex([
      makeEntry({
        id: 1,
        name: "MotorPkg",
        kind: "Package",
        ruleName: "Package",
        resourceId: "file:///a.mo",
        language: "modelica",
      }),
    ]);
    uw.registerWorkspace("modelica", { getIndex: () => idxA });
    uw.updateQueryEngines("file:///a.mo", new Set([1]), new Set([1]), new Set(["MotorPkg"]));

    const merged = uw.getIndex();
    assert.ok(merged.symbolsByResource instanceof Map);
    const resIds = merged.symbolsByResource!.get("file:///a.mo") ?? [];
    assert.equal(resIds.length, 1);
    assert.ok(updatedCall !== null);
    assert.equal(updatedCall!.uri, "file:///a.mo");
    assert.equal(updatedCall!.resCount, 1);
    assert.equal(updatedCall!.names?.has("MotorPkg"), true);
  });

  it("validates TGG correspondence and extracts cross-language links cleanly", () => {
    const entries: SymbolEntry[] = [
      makeEntry({
        id: 1,
        name: "DriveModel",
        kind: "Class",
        resourceId: "file:///drive.mo",
        language: "modelica",
        startOffset: 0,
      }),
      makeEntry({
        id: 2,
        name: "m",
        kind: "Component",
        parentId: 1,
        resourceId: "file:///drive.mo",
        metadata: { typeSpecifier: "Real", variability: "parameter", value: 12 },
        language: "modelica",
        startOffset: 25,
      }),
      makeEntry({
        id: 3,
        name: "spin",
        kind: "Component",
        parentId: 1,
        resourceId: "file:///drive.mo",
        metadata: { isPort: true, typeSpecifier: "Flange", direction: "out" },
        language: "modelica",
        startOffset: 50,
      }),
      makeEntry({
        id: 10,
        name: "DrivePart",
        kind: "Definition",
        ruleName: "PartDefinition",
        resourceId: "file:///drive.sysml",
        metadata: { implements: "Modelica::DriveModel" },
        language: "sysml2",
        startOffset: 0,
      }),
      makeEntry({
        id: 11,
        name: "m",
        kind: "Usage",
        ruleName: "AttributeUsage",
        parentId: 10,
        resourceId: "file:///drive.sysml",
        metadata: { typeSpecifier: "ScalarValues::String" },
        language: "sysml2",
        startOffset: 25,
      }),
    ];

    const index = buildMiniIndex(entries);
    const db = makePortLookupDb(index);

    const links = extractCrossLanguageLinks({
      uri: "file:///drive.sysml",
      language: "sysml2",
      index,
      text: "part def DrivePart {\n  attribute m : String;\n}\n",
    });
    assert.ok(links.some((l) => l.relationKind === "implements" && l.targetEntry?.id === 1));

    const transformer = new PolyglotTransformer();
    const srcNode = symbolEntryToPolyglotNode(db, entries[0]!);
    const tgtNode = symbolEntryToPolyglotNode(db, entries[3]!);

    const diags = transformer.validateCorrespondence(srcNode, tgtNode, "modelica", "sysml2");
    assert.ok(
      diags.some((d) => d.code === "CONFORMANCE_MISSING_PORT" && d.severity === "warning" && d.expectedName === "spin"),
    );
    assert.ok(
      diags.some((d) => d.code === "CONFORMANCE_PARAM_MISMATCH" && d.severity === "warning" && d.expectedName === "m"),
    );

    const missingDiags = transformer.validateCorrespondence(srcNode, null, "modelica", "sysml2");
    assert.equal(missingDiags[0]?.code, "CONFORMANCE_UNRESOLVED_TARGET");
    assert.equal(missingDiags[0]?.severity, "error");
  });
});
