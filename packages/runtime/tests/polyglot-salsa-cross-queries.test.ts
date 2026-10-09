// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test, { describe } from "node:test";
import {
  LanguageDomainId,
  makePolyglotSymbolId,
  QueryEngine,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../src/index.js";

function createMockPolyglotSymbolIndex(): SymbolIndex {
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
  const mResistorId = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
  add({
    id: mResistorId,
    name: "Resistor",
    kind: "Class",
    ruleName: "class_definition",
    namePath: "name",
    startByte: 0,
    endByte: 100,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: { qualifiedName: "Modelica.Electrical.Analog.Basic.Resistor", type: "ModelicaClass" },
  });

  const mTorqueVarId = makePolyglotSymbolId(LanguageDomainId.Modelica, 2);
  add({
    id: mTorqueVarId,
    name: "tau",
    kind: "Variable",
    ruleName: "component_declaration",
    namePath: "name",
    startByte: 110,
    endByte: 150,
    parentId: mResistorId,
    exports: [],
    inherits: [],
    metadata: { type: "Modelica.SIunits.Torque", unit: "N.m", variability: "continuous" },
  });

  const mMassVarId = makePolyglotSymbolId(LanguageDomainId.Modelica, 3);
  add({
    id: mMassVarId,
    name: "m",
    kind: "Variable",
    ruleName: "component_declaration",
    namePath: "name",
    startByte: 160,
    endByte: 200,
    parentId: mResistorId,
    exports: [],
    inherits: [],
    metadata: { type: "Modelica.SIunits.Mass", unit: "kg", variability: "parameter" },
  });

  // 2. SysML v2 symbols (Domain 0x02)
  const sPkgId = makePolyglotSymbolId(LanguageDomainId.SysML2, 1);
  add({
    id: sPkgId,
    name: "DroneArchitecture",
    kind: "Package",
    ruleName: "PackageDefinition",
    namePath: "name",
    startByte: 0,
    endByte: 500,
    parentId: null,
    exports: [],
    inherits: [],
  });

  const sChassisId = makePolyglotSymbolId(LanguageDomainId.SysML2, 2);
  add({
    id: sChassisId,
    name: "Chassis",
    kind: "Definition",
    ruleName: "PartDefinition",
    namePath: "name",
    startByte: 50,
    endByte: 250,
    parentId: sPkgId,
    exports: [],
    inherits: [],
    metadata: {
      twin: "CAD::DroneFrame",
      counterpart: "Modelica::Resistor",
    },
  });

  const sTorqueAttrId = makePolyglotSymbolId(LanguageDomainId.SysML2, 3);
  add({
    id: sTorqueAttrId,
    name: "maxTorque",
    kind: "Attribute",
    ruleName: "AttributeDefinition",
    namePath: "name",
    startByte: 100,
    endByte: 140,
    parentId: sChassisId,
    exports: [],
    inherits: [],
    metadata: { type: "ISQ::TorqueValue", unit: "N*m" },
  });

  const sMassAttrId = makePolyglotSymbolId(LanguageDomainId.SysML2, 4);
  add({
    id: sMassAttrId,
    name: "totalMass",
    kind: "Attribute",
    ruleName: "AttributeDefinition",
    namePath: "name",
    startByte: 150,
    endByte: 190,
    parentId: sChassisId,
    exports: [],
    inherits: [],
    metadata: { type: "ISQ::MassValue", unit: "kg" },
  });

  // 3. STEP CAD symbols (Domain 0x03)
  const cFrameId = makePolyglotSymbolId(LanguageDomainId.STEP_CAD, 1);
  add({
    id: cFrameId,
    name: "DroneFrame",
    kind: "Product",
    ruleName: "StepProduct",
    namePath: "name",
    startByte: 0,
    endByte: 300,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: {
      surfaceArea: 1420.5,
      volume: 38500.0,
      crossDomainBinding: "SysML2::DroneArchitecture::Chassis",
    },
  });

  const cArmId = makePolyglotSymbolId(LanguageDomainId.STEP_CAD, 2);
  add({
    id: cArmId,
    name: "SolidArm",
    kind: "Shape",
    ruleName: "StepShape",
    namePath: "name",
    startByte: 100,
    endByte: 250,
    parentId: cFrameId,
    exports: [],
    inherits: [],
    metadata: { surfaceArea: 350.2, volume: 8200.0 },
  });

  // 4. FEA symbols (Domain 0x07)
  const feaMeshId = makePolyglotSymbolId(LanguageDomainId.FEA, 1);
  add({
    id: feaMeshId,
    name: "ChassisStructuralMesh",
    kind: "Mesh",
    ruleName: "FeaMesh",
    namePath: "name",
    startByte: 0,
    endByte: 200,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: { elementCount: 42500, nodeCount: 15300 },
  });

  return {
    symbols,
    byName,
    childrenOf,
  };
}

describe("Milestone 3: Polyglot Salsa Cross-Language Query Hooks & Invalidation", () => {
  test("resolvePolyglotSymbol resolves cross-domain FQNs, paths, and domain prefixes", () => {
    const index = createMockPolyglotSymbolIndex();
    const engine = new QueryEngine(index, new Map());
    const db = engine.toQueryDB();

    // 1. Dotted path inside SysML v2
    const chassisId = db.resolvePolyglotSymbol("DroneArchitecture.Chassis");
    assert.ok(chassisId !== null);
    const chassis = db.symbol(chassisId!);
    assert.strictEqual(chassis?.name, "Chassis");

    // 2. Coloned path with domain prefix
    const chassisColoned = db.resolvePolyglotSymbol("SysML2::DroneArchitecture::Chassis");
    assert.strictEqual(chassisColoned, chassisId);

    // 3. STEP CAD product lookup with prefix
    const frameId = db.resolvePolyglotSymbol("CAD::DroneFrame");
    assert.ok(frameId !== null);
    const frame = db.symbol(frameId!);
    assert.strictEqual(frame?.name, "DroneFrame");

    // 4. Qualified name match for Modelica
    const resistorId = db.resolvePolyglotSymbol("Modelica.Electrical.Analog.Basic.Resistor");
    assert.ok(resistorId !== null);
    const resistor = db.symbol(resistorId!);
    assert.strictEqual(resistor?.name, "Resistor");

    // 5. Target domain parameter filtering
    const sChassis = db.resolvePolyglotSymbol("Chassis", LanguageDomainId.SysML2);
    assert.strictEqual(sChassis, chassisId);

    // 6. Non-existent symbol returns null
    const nonExistent = db.resolvePolyglotSymbol("NonExistent::Path::Class");
    assert.strictEqual(nonExistent, null);
  });

  test("crossDomainBinding discovers digital thread counterpart twins across domains", () => {
    const index = createMockPolyglotSymbolIndex();
    const engine = new QueryEngine(index, new Map());
    const db = engine.toQueryDB();

    const chassisId = db.resolvePolyglotSymbol("DroneArchitecture.Chassis")!;
    const frameId = db.resolvePolyglotSymbol("DroneFrame")!;

    // Chassis links to CAD::DroneFrame via metadata.twin
    const chassisTwins = db.crossDomainBinding(chassisId);
    assert.ok(chassisTwins.includes(frameId), "Chassis should bind to DroneFrame CAD model");

    // Frame links back to SysML2 Chassis via metadata.crossDomainBinding
    const frameTwins = db.crossDomainBinding(frameId);
    assert.ok(frameTwins.includes(chassisId), "DroneFrame should bind back to SysML2 Chassis");

    // Correspondence slot mapping
    const slotMap = new Map<SymbolId, number>();
    slotMap.set(chassisId, 42);
    slotMap.set(frameId, 42);
    engine.setCorrespondenceIndex({}, slotMap);

    const slotTwins = db.crossDomainBinding(chassisId);
    assert.ok(slotTwins.includes(frameId));
  });

  test("physicalQuantityParity verifies dimensional and unit compatibility", () => {
    const index = createMockPolyglotSymbolIndex();
    const engine = new QueryEngine(index, new Map());
    const db = engine.toQueryDB();

    const mTorqueId = db.resolvePolyglotSymbol("tau")!;
    const mMassId = db.resolvePolyglotSymbol("m")!;
    const sTorqueId = db.resolvePolyglotSymbol("maxTorque")!;
    const sMassId = db.resolvePolyglotSymbol("totalMass")!;

    // Torque parity (N.m vs N*m)
    const torqueParity = db.physicalQuantityParity(mTorqueId, sTorqueId);
    assert.strictEqual(torqueParity.compatible, true, "Torque units N.m and N*m must be compatible");

    // Mass parity (kg vs kg)
    const massParity = db.physicalQuantityParity(mMassId, sMassId);
    assert.strictEqual(massParity.compatible, true, "Mass units kg and kg must be compatible");

    // Dimensional mismatch: Torque vs Mass
    const mismatchParity = db.physicalQuantityParity(mTorqueId, sMassId);
    assert.strictEqual(mismatchParity.compatible, false, "Torque and Mass must not be compatible");
    assert.ok(mismatchParity.reason?.includes("Unit mismatch"), "Should provide explanatory reason");
  });

  test("geometricShapeBinding couples STEP CAD solid B-Reps to FEA structural meshes", () => {
    const index = createMockPolyglotSymbolIndex();
    const engine = new QueryEngine(index, new Map());
    const db = engine.toQueryDB();

    const cadId = db.resolvePolyglotSymbol("DroneFrame")!;
    const feaId = db.resolvePolyglotSymbol("ChassisStructuralMesh")!;

    const binding = db.geometricShapeBinding(cadId, feaId);
    assert.strictEqual(binding.bound, true);
    assert.strictEqual(binding.shapeName, "DroneFrame");
    assert.strictEqual(binding.surfaceArea, 1420.5);
    assert.strictEqual(binding.volume, 38500.0);
    assert.strictEqual(binding.meshElementCount, 42500);
  });

  test("domainRevisions enable fine-grained cross-language incremental invalidation", () => {
    const index = createMockPolyglotSymbolIndex();
    const engine = new QueryEngine(index, new Map());
    const db = engine.toQueryDB();

    // Initial domain revisions are 0
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.Modelica), 0);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.STEP_CAD), 0);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.SysML2), 0);

    // Invalidate STEP CAD symbol
    const cadId = db.resolvePolyglotSymbol("DroneFrame")!;
    engine.invalidate([cadId]);

    // Only STEP_CAD revision advances; Modelica and SysML2 stay at 0
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.STEP_CAD), 1);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.Modelica), 0);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.SysML2), 0);

    // Invalidate SysML2 domain directly
    engine.invalidateDomain(LanguageDomainId.SysML2);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.SysML2), 1);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.Modelica), 0);
    assert.strictEqual(db.getDomainRevision!(LanguageDomainId.STEP_CAD), 1);
  });
});
