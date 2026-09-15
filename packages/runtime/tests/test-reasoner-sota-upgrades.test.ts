// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  WasmOntologyReasoner,
  WasmOntologyStore,
  absorbGCIs,
  computeRcc8Relation,
  type CadBoundingBox,
  type OWL2Axiom,
  type SHACLNodeShape,
} from "../src/wasm_ontology.js";

async function runTests() {
  console.log("=================================================");
  console.log("Running SOTA Reasoner Upgrade Tests");
  console.log("=================================================\n");

  // -------------------------------------------------------------------------
  // Test 1: SOTA Consistency Checks - Asymmetric, Irreflexive, Disjoint Properties
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing SOTA Object Property Characteristics & Conflicts...");
  {
    // Asymmetric property conflict
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "AsymmetricObjectProperty", propertyIri: "ex:parentOf" },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:parentOf", subjectIri: "ex:Alice", objectIri: "ex:Bob" },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:parentOf", subjectIri: "ex:Bob", objectIri: "ex:Alice" },
    ]);
    const res = reasoner.checkConsistency();
    assert.strictEqual(res.isConsistent, false, "Asymmetric violation should be detected");
    assert.ok(
      res.conflictingAxioms?.some((a) => a.type === "AsymmetricObjectProperty"),
      "Should identify AsymmetricObjectProperty in conflict",
    );
  }

  {
    // Irreflexive property conflict
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "IrreflexiveObjectProperty", propertyIri: "ex:strictlyPrecedes" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:strictlyPrecedes",
        subjectIri: "ex:Task1",
        objectIri: "ex:Task1",
      },
    ]);
    const res = reasoner.checkConsistency();
    assert.strictEqual(res.isConsistent, false, "Irreflexive violation should be detected");
    assert.ok(
      res.conflictingAxioms?.some((a) => a.type === "IrreflexiveObjectProperty"),
      "Should identify IrreflexiveObjectProperty in conflict",
    );
  }

  {
    // Disjoint object properties conflict
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "DisjointObjectProperties", propertyIris: ["ex:partOf", "ex:connectedTo"] },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:partOf", subjectIri: "ex:Motor", objectIri: "ex:Chassis" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:connectedTo",
        subjectIri: "ex:Motor",
        objectIri: "ex:Chassis",
      },
    ]);
    const res = reasoner.checkConsistency();
    assert.strictEqual(res.isConsistent, false, "Disjoint object properties violation should be detected");
    assert.ok(
      res.conflictingAxioms?.some((a) => a.type === "DisjointObjectProperties"),
      "Should identify DisjointObjectProperties in conflict",
    );
  }
  console.log("✔ SOTA Object Property constraints passed.\n");

  // -------------------------------------------------------------------------
  // Test 2: Quantitative & Datatype Reasoning (D)
  // -------------------------------------------------------------------------
  console.log("[Test 2] Testing Quantitative & Datatype Reasoning (D)...");
  {
    // Functional Data Property conflict
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "FunctionalDataProperty", propertyIri: "ex:serialNumber" },
      { type: "DataPropertyAssertion", propertyIri: "ex:serialNumber", subjectIri: "ex:Drone1", value: "SN-001" },
      { type: "DataPropertyAssertion", propertyIri: "ex:serialNumber", subjectIri: "ex:Drone1", value: "SN-002" },
    ]);
    const res = reasoner.checkConsistency();
    assert.strictEqual(res.isConsistent, false, "Functional data property violation should be detected");
  }

  {
    // Quantitative numeric interval contradiction (voltage > 24 AND voltage < 12)
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      {
        type: "DataPropertyAssertion",
        propertyIri: "ex:operatingVoltage",
        subjectIri: "ex:Drone1",
        value: "24",
        op: ">",
      },
      {
        type: "DataPropertyAssertion",
        propertyIri: "ex:operatingVoltage",
        subjectIri: "ex:Drone1",
        value: "12",
        op: "<",
      },
    ]);
    const res = reasoner.checkConsistency();
    assert.strictEqual(res.isConsistent, false, "Contradictory interval (V > 24 and V < 12) should be inconsistent");
    assert.ok(res.conflictingAxioms && res.conflictingAxioms.length >= 2, "Conflicting assertions returned");
  }

  {
    // Consistent quantitative interval (voltage >= 12 and voltage <= 24, with actual value 18)
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      {
        type: "DataPropertyAssertion",
        propertyIri: "ex:operatingVoltage",
        subjectIri: "ex:Drone1",
        value: "12",
        op: ">=",
      },
      {
        type: "DataPropertyAssertion",
        propertyIri: "ex:operatingVoltage",
        subjectIri: "ex:Drone1",
        value: "24",
        op: "<=",
      },
      { type: "DataPropertyAssertion", propertyIri: "ex:operatingVoltage", subjectIri: "ex:Drone1", value: "18" },
    ]);
    const res = reasoner.checkConsistency();
    assert.strictEqual(res.isConsistent, true, "Consistent range [12, 24] with value 18 should be consistent");
  }
  console.log("✔ Quantitative & Datatype Reasoning (D) passed.\n");

  // -------------------------------------------------------------------------
  // Test 3: SHACL Core & Logical Constraints (sh:or, sh:and, sh:not, sh:xone)
  // -------------------------------------------------------------------------
  console.log("[Test 3] Testing SHACL Core & Logical Constraints Validation...");
  {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Drone" },
      { type: "ClassDeclaration", iri: "ex:Sensor" },
      { type: "ClassDeclaration", iri: "ex:Motor" },

      { type: "IndividualDeclaration", iri: "ex:drone1" },
      { type: "ClassAssertion", individualIri: "ex:drone1", classIri: "ex:Drone" },

      // Object assertions
      { type: "IndividualDeclaration", iri: "ex:lidar1" },
      { type: "ClassAssertion", individualIri: "ex:lidar1", classIri: "ex:Sensor" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasPayload",
        subjectIri: "ex:drone1",
        objectIri: "ex:lidar1",
      },

      // Data assertions
      { type: "DataPropertyAssertion", propertyIri: "ex:batteryPercentage", subjectIri: "ex:drone1", value: "85" },
      { type: "DataPropertyAssertion", propertyIri: "ex:modelCode", subjectIri: "ex:drone1", value: "DRN-2026-X" },
    ]);

    const shapes: SHACLNodeShape[] = [
      {
        targetClass: "ex:Drone",
        propertyShapes: [
          // 1. Min/Max count and Class checking
          {
            path: "ex:hasPayload",
            minCount: 1,
            maxCount: 2,
            class: "ex:Sensor",
          },
          // 2. Numeric range checking
          {
            path: "ex:batteryPercentage",
            minInclusive: 0,
            maxInclusive: 100,
          },
          // 3. Pattern checking
          {
            path: "ex:modelCode",
            pattern: "^DRN-[0-9]{4}-[A-Z]$",
          },
          // 4. Logical: sh:or (either high battery >= 80 OR emergency reserve)
          {
            path: "ex:batteryPercentage",
            or: [
              { path: "ex:batteryPercentage", minInclusive: 80 },
              { path: "ex:batteryPercentage", maxInclusive: 20 },
            ],
          },
          // 5. Logical: sh:not (must NOT be a motor)
          {
            path: "ex:hasPayload",
            not: {
              path: "ex:hasPayload",
              class: "ex:Motor",
            },
          },
          // 6. Logical: sh:xone (exactly one must match)
          {
            path: "ex:batteryPercentage",
            xone: [
              { path: "ex:batteryPercentage", minInclusive: 80 },
              { path: "ex:batteryPercentage", maxInclusive: 50 },
            ],
          },
        ],
      },
    ];

    const violations = reasoner.validateShacl(shapes);
    assert.strictEqual(
      violations.length,
      0,
      `Expected 0 violations on valid drone, got: ${violations.map((v) => v.message).join("; ")}`,
    );
  }

  {
    // Test SHACL violations detection
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Drone" },
      { type: "IndividualDeclaration", iri: "ex:brokenDrone" },
      { type: "ClassAssertion", individualIri: "ex:brokenDrone", classIri: "ex:Drone" },
      {
        type: "DataPropertyAssertion",
        propertyIri: "ex:batteryPercentage",
        subjectIri: "ex:brokenDrone",
        value: "120",
      }, // violates maxInclusive 100
      {
        type: "DataPropertyAssertion",
        propertyIri: "ex:modelCode",
        subjectIri: "ex:brokenDrone",
        value: "INVALID-CODE",
      }, // violates pattern
    ]);

    const shapes: SHACLNodeShape[] = [
      {
        targetClass: "ex:Drone",
        propertyShapes: [
          { path: "ex:hasPayload", minCount: 1 }, // missing payload
          { path: "ex:batteryPercentage", maxInclusive: 100 },
          { path: "ex:modelCode", pattern: "^DRN-[0-9]{4}-[A-Z]$" },
        ],
      },
    ];

    const violations = reasoner.validateShacl(shapes);
    assert.strictEqual(violations.length, 3, `Expected 3 violations, got ${violations.length}`);
    assert.ok(violations.some((v) => v.constraintComponent === "sh:MinCountConstraintComponent"));
    assert.ok(violations.some((v) => v.constraintComponent === "sh:MaxInclusiveConstraintComponent"));
    assert.ok(violations.some((v) => v.constraintComponent === "sh:PatternConstraintComponent"));
  }
  console.log("✔ SHACL Core & Logical Constraints validation passed.\n");

  // -------------------------------------------------------------------------
  // Test 4: STEP CAD RCC-8 3D Spatial Bounding Envelope Projections
  // -------------------------------------------------------------------------
  console.log("[Test 4] Testing STEP CAD RCC-8 Spatial Relations & Envelope Projections...");
  {
    // DC: Disconnected
    const bDC1: CadBoundingBox = { id: "box1", min: [0, 0, 0], max: [1, 1, 1] };
    const bDC2: CadBoundingBox = { id: "box2", min: [5, 5, 5], max: [6, 6, 6] };
    assert.strictEqual(computeRcc8Relation(bDC1, bDC2), "rcc:DC");

    // EC: Externally Connected (touching at face x = 1)
    const bEC1: CadBoundingBox = { id: "box1", min: [0, 0, 0], max: [1, 1, 1] };
    const bEC2: CadBoundingBox = { id: "box2", min: [1, 0, 0], max: [2, 1, 1] };
    assert.strictEqual(computeRcc8Relation(bEC1, bEC2), "rcc:EC");

    // PO: Partial Overlap
    const bPO1: CadBoundingBox = { id: "box1", min: [0, 0, 0], max: [2, 2, 2] };
    const bPO2: CadBoundingBox = { id: "box2", min: [1, 1, 1], max: [3, 3, 3] };
    assert.strictEqual(computeRcc8Relation(bPO1, bPO2), "rcc:PO");

    // EQ: Equal
    const bEQ1: CadBoundingBox = { id: "box1", min: [0, 0, 0], max: [2, 2, 2] };
    const bEQ2: CadBoundingBox = { id: "box2", min: [0, 0, 0], max: [2, 2, 2] };
    assert.strictEqual(computeRcc8Relation(bEQ1, bEQ2), "rcc:EQ");

    // TPP: Tangential Proper Part (inside, touching boundary)
    const bTPP1: CadBoundingBox = { id: "box_inner", min: [0, 0, 0], max: [1, 1, 1] };
    const bTPP2: CadBoundingBox = { id: "box_outer", min: [0, 0, 0], max: [2, 2, 2] };
    assert.strictEqual(computeRcc8Relation(bTPP1, bTPP2), "rcc:TPP");
    assert.strictEqual(computeRcc8Relation(bTPP2, bTPP1), "rcc:TPPi");

    // NTPP: Non-Tangential Proper Part (strictly interior)
    const bNTPP1: CadBoundingBox = { id: "box_inner", min: [0.2, 0.2, 0.2], max: [0.8, 0.8, 0.8] };
    const bNTPP2: CadBoundingBox = { id: "box_outer", min: [0, 0, 0], max: [1, 1, 1] };
    assert.strictEqual(computeRcc8Relation(bNTPP1, bNTPP2), "rcc:NTPP");
    assert.strictEqual(computeRcc8Relation(bNTPP2, bNTPP1), "rcc:NTPPi");

    // End-to-end projection into WasmOntologyStore & reasoner
    const store = new WasmOntologyStore();
    const boxes: CadBoundingBox[] = [
      { id: "fuselage", min: [0, 0, 0], max: [10, 4, 4] },
      { id: "battery_pack", min: [1, 1, 1], max: [3, 3, 3] }, // NTPP inside fuselage
      { id: "left_rotor", min: [10, 0, 0], max: [12, 2, 2] }, // EC touching fuselage at x=10
    ];
    store.projectCadEnvelopes(boxes);

    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(store.axioms);
    reasoner.classify();

    assert.strictEqual(reasoner.status, "ready");
    // Verify spatial relations query
    const edgesNTPP = store.axioms.filter(
      (a) =>
        a.type === "ObjectPropertyAssertion" &&
        a.propertyIri === "rcc:NTPP" &&
        a.subjectIri === "cad:battery_pack" &&
        a.objectIri === "cad:fuselage",
    );
    assert.strictEqual(edgesNTPP.length, 1, "Battery pack should be NTPP inside fuselage");

    const edgesEC = store.axioms.filter(
      (a) =>
        a.type === "ObjectPropertyAssertion" &&
        a.propertyIri === "rcc:EC" &&
        a.subjectIri === "cad:fuselage" &&
        a.objectIri === "cad:left_rotor",
    );
    assert.strictEqual(edgesEC.length, 1, "Left rotor should be EC touching fuselage");
  }
  console.log("✔ STEP CAD RCC-8 3D Spatial Bounding Envelope projections passed.\n");

  // -------------------------------------------------------------------------
  // Test 5: GCI Absorption Preprocessor
  // -------------------------------------------------------------------------
  console.log("[Test 5] Testing GCI Absorption Preprocessor...");
  {
    const rawAxioms: OWL2Axiom[] = [
      { type: "SubClassOf", subClassIri: "ex:A", superClassIri: "ex:A" }, // tautology
      { type: "SubClassOf", subClassIri: "ex:A", superClassIri: "owl:Thing" }, // redundant
      { type: "SubClassOf", subClassIri: "owl:Nothing", superClassIri: "ex:B" }, // redundant
      { type: "SubClassOf", subClassIri: "ex:Sub", superClassIri: "ex:Super" }, // retain
      { type: "EquivalentClasses", classIris: ["ex:A", "ex:A"] }, // redundant single
      { type: "EquivalentClasses", classIris: ["ex:A", "ex:B", "ex:A"] }, // deduplicate
    ];

    const absorbed = absorbGCIs(rawAxioms);
    assert.strictEqual(absorbed.length, 2, `Expected 2 non-trivial axioms, got ${absorbed.length}`);
    assert.strictEqual(absorbed[0]?.type, "SubClassOf");
    assert.strictEqual((absorbed[0] as any).subClassIri, "ex:Sub");
    assert.strictEqual(absorbed[1]?.type, "EquivalentClasses");
    assert.deepStrictEqual((absorbed[1] as any).classIris, ["ex:A", "ex:B"]);
  }
  console.log("✔ GCI Absorption Preprocessor passed.\n");

  console.log("=================================================");
  console.log("ALL SOTA REASONER UPGRADE TESTS PASSED!");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
