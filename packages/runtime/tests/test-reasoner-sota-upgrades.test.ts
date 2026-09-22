// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  ParallelOntologyReasoner,
  WasmOntologyReasoner,
  WasmOntologyStore,
  absorbGCIs,
  computeRcc8Relation,
  type CadBoundingBox,
  type OWL2Axiom,
  type SHACLNodeShape,
} from "../src/index.js";

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

  // -------------------------------------------------------------------------
  // Test 6: Qualified Number Restrictions (Q)
  // -------------------------------------------------------------------------
  console.log("[Test 6] Testing Qualified Number Restrictions (Q)...");
  {
    const baseAxioms: OWL2Axiom[] = [
      { type: "ClassDeclaration", iri: "ex:Drone" },
      { type: "ClassDeclaration", iri: "ex:Rotor" },
      { type: "ClassDeclaration", iri: "ex:Payload" },
      {
        type: "QualifiedCardinality",
        classIri: "ex:Drone",
        propertyIri: "ex:hasComponent",
        fillerClassIri: "ex:Rotor",
        cardinalityType: "max",
        count: 2,
      },
      { type: "IndividualDeclaration", iri: "ex:drone1" },
      { type: "ClassAssertion", individualIri: "ex:drone1", classIri: "ex:Drone" },

      // 2 rotors + 1 payload: valid since only 2 are rotors
      { type: "IndividualDeclaration", iri: "ex:rotor1" },
      { type: "ClassAssertion", individualIri: "ex:rotor1", classIri: "ex:Rotor" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasComponent",
        subjectIri: "ex:drone1",
        objectIri: "ex:rotor1",
      },

      { type: "IndividualDeclaration", iri: "ex:rotor2" },
      { type: "ClassAssertion", individualIri: "ex:rotor2", classIri: "ex:Rotor" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasComponent",
        subjectIri: "ex:drone1",
        objectIri: "ex:rotor2",
      },

      { type: "IndividualDeclaration", iri: "ex:camera1" },
      { type: "ClassAssertion", individualIri: "ex:camera1", classIri: "ex:Payload" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasComponent",
        subjectIri: "ex:drone1",
        objectIri: "ex:camera1",
      },
    ];

    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(baseAxioms);

    const res1 = reasoner.checkConsistency();
    assert.strictEqual(res1.isConsistent, true, "Drone with 2 rotors and 1 camera should satisfy max 2 rotors");

    // Add a 3rd distinct rotor -> should trigger inconsistency
    const axiomsWith3Rotors: OWL2Axiom[] = [
      ...baseAxioms,
      { type: "IndividualDeclaration", iri: "ex:rotor3" },
      { type: "ClassAssertion", individualIri: "ex:rotor3", classIri: "ex:Rotor" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasComponent",
        subjectIri: "ex:drone1",
        objectIri: "ex:rotor3",
      },
    ];
    reasoner.loadOntology(axiomsWith3Rotors);

    const res2 = reasoner.checkConsistency();
    assert.strictEqual(res2.isConsistent, false, "Drone with 3 distinct rotors should violate max 2 rotors");
    assert.ok(res2.conflictingAxioms?.some((a) => a.type === "QualifiedCardinality"));

    // Now unify rotor2 and rotor3 with SameIndividual -> distinct count becomes 2 -> consistent!
    const axiomsWithSameIndividual: OWL2Axiom[] = [
      ...axiomsWith3Rotors,
      { type: "SameIndividual", individualIris: ["ex:rotor2", "ex:rotor3"] },
    ];
    reasoner.loadOntology(axiomsWithSameIndividual);
    const res3 = reasoner.checkConsistency();
    assert.strictEqual(
      res3.isConsistent,
      true,
      "Drone with 3 rotor references where 2 are SameIndividual should satisfy max 2",
    );
  }
  console.log("✔ Qualified Number Restrictions (Q) passed.\n");

  // -------------------------------------------------------------------------
  // Test 7: Complex Sub-Property Chains (R)
  // -------------------------------------------------------------------------
  console.log("[Test 7] Testing Complex Sub-Property Chains (R)...");
  {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:hasSubsystem" },
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:hasDevice" },
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:containsDevice" },
      {
        type: "SubPropertyChainOf",
        subPropertyChain: ["ex:hasSubsystem", "ex:hasDevice"],
        superPropertyIri: "ex:containsDevice",
      },
      // 3-hop chain
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:step1" },
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:step2" },
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:step3" },
      { type: "ObjectPropertyDeclaration", propertyIri: "ex:superChain" },
      {
        type: "SubPropertyChainOf",
        subPropertyChain: ["ex:step1", "ex:step2", "ex:step3"],
        superPropertyIri: "ex:superChain",
      },

      // Assertions for 2-hop
      { type: "IndividualDeclaration", iri: "ex:Satellite" },
      { type: "IndividualDeclaration", iri: "ex:PowerSystem" },
      { type: "IndividualDeclaration", iri: "ex:SolarPanel" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasSubsystem",
        subjectIri: "ex:Satellite",
        objectIri: "ex:PowerSystem",
      },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasDevice",
        subjectIri: "ex:PowerSystem",
        objectIri: "ex:SolarPanel",
      },

      // Assertions for 3-hop: A -> B -> C -> D
      { type: "IndividualDeclaration", iri: "ex:nodeA" },
      { type: "IndividualDeclaration", iri: "ex:nodeB" },
      { type: "IndividualDeclaration", iri: "ex:nodeC" },
      { type: "IndividualDeclaration", iri: "ex:nodeD" },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:step1", subjectIri: "ex:nodeA", objectIri: "ex:nodeB" },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:step2", subjectIri: "ex:nodeB", objectIri: "ex:nodeC" },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:step3", subjectIri: "ex:nodeC", objectIri: "ex:nodeD" },
    ]);

    reasoner.classify();

    // Query inferred property values for 2-hop chain
    const q2 = reasoner.query({ type: "property-values", iri: "ex:containsDevice" });
    assert.ok(
      q2.pairs?.some((p) => p.subject === "ex:Satellite" && p.object === "ex:SolarPanel"),
      "ex:containsDevice should be inferred between ex:Satellite and ex:SolarPanel via 2-hop chain",
    );

    // Query inferred property values for 3-hop chain
    const q3 = reasoner.query({ type: "property-values", iri: "ex:superChain" });
    assert.ok(
      q3.pairs?.some((p) => p.subject === "ex:nodeA" && p.object === "ex:nodeD"),
      "ex:superChain should be inferred between ex:nodeA and ex:nodeD via 3-hop chain",
    );
  }
  console.log("✔ Complex Sub-Property Chains (R) passed.\n");

  // -------------------------------------------------------------------------
  // Test 8: Multivariate Linear Inequality Theory Solving (D)
  // -------------------------------------------------------------------------
  console.log("[Test 8] Testing Multivariate Linear Inequality Theory Solving (D)...");
  {
    // Constraint: 1.0 * ex:width - 2.0 * ex:margin <= 300
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Component" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:width" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:margin" },
      {
        type: "LinearConstraint",
        subjectIri: "ex:comp1",
        terms: [
          { propertyIri: "ex:width", coefficient: 1.0 },
          { propertyIri: "ex:margin", coefficient: -2.0 },
        ],
        op: "<=",
        bound: 300,
      },
      { type: "IndividualDeclaration", iri: "ex:comp1" },
      { type: "ClassAssertion", individualIri: "ex:comp1", classIri: "ex:Component" },
      // width = 350, margin = 50 => 1.0 * 350 - 2.0 * 50 = 250 <= 300 -> Consistent
      { type: "DataPropertyAssertion", propertyIri: "ex:width", subjectIri: "ex:comp1", value: "350" },
      { type: "DataPropertyAssertion", propertyIri: "ex:margin", subjectIri: "ex:comp1", value: "50" },
    ]);

    const res1 = reasoner.checkConsistency();
    assert.strictEqual(res1.isConsistent, true, "comp1 with 350 - 100 = 250 <= 300 should be consistent");

    // Now update width to 500 => 500 - 100 = 400 > 300 -> Inconsistent
    const reasoner2 = new WasmOntologyReasoner();
    reasoner2.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Component" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:width" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:margin" },
      {
        type: "LinearConstraint",
        subjectIri: "ex:comp2",
        terms: [
          { propertyIri: "ex:width", coefficient: 1.0 },
          { propertyIri: "ex:margin", coefficient: -2.0 },
        ],
        op: "<=",
        bound: 300,
      },
      { type: "IndividualDeclaration", iri: "ex:comp2" },
      { type: "ClassAssertion", individualIri: "ex:comp2", classIri: "ex:Component" },
      { type: "DataPropertyAssertion", propertyIri: "ex:width", subjectIri: "ex:comp2", value: "500" },
      { type: "DataPropertyAssertion", propertyIri: "ex:margin", subjectIri: "ex:comp2", value: "50" },
    ]);

    const res2 = reasoner2.checkConsistency();
    assert.strictEqual(res2.isConsistent, false, "comp2 with 500 - 100 = 400 > 300 should trigger linear conflict");
    assert.ok(res2.conflictingAxioms?.some((a) => a.type === "LinearConstraint"));
  }
  console.log("✔ Multivariate Linear Inequality Theory Solving (D) passed.\n");

  // -------------------------------------------------------------------------
  // Test 9: SHACL-SPARQL Graph Pattern Constraints
  // -------------------------------------------------------------------------
  console.log("[Test 9] Testing SHACL-SPARQL Graph Pattern Constraints...");
  {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Circuit" },
      { type: "IndividualDeclaration", iri: "ex:validCircuit" },
      { type: "ClassAssertion", individualIri: "ex:validCircuit", classIri: "ex:Circuit" },
      { type: "IndividualDeclaration", iri: "ex:groundPin" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "ex:hasGround",
        subjectIri: "ex:validCircuit",
        objectIri: "ex:groundPin",
      },

      { type: "IndividualDeclaration", iri: "ex:ungroundedCircuit" },
      { type: "ClassAssertion", individualIri: "ex:ungroundedCircuit", classIri: "ex:Circuit" },
    ]);

    // Shape requiring a connection to ground via SPARQL query
    const shapes: SHACLNodeShape[] = [
      {
        targetClass: "ex:Circuit",
        propertyShapes: [
          {
            path: "ex:hasGround",
            sparql: {
              select: {
                patterns: [{ subject: "?this", predicate: "ex:hasGround", object: "?g" }],
              },
              expectEmpty: false, // Must have a match
              message: "Circuit must be connected to ground.",
            },
          },
        ],
      },
    ];

    const violations = reasoner.validateShacl(shapes);
    assert.strictEqual(violations.length, 1, `Expected 1 violation for ungroundedCircuit, got ${violations.length}`);
    assert.strictEqual(violations[0]?.focusNode, "ex:ungroundedCircuit");
    assert.strictEqual(violations[0]?.constraintComponent, "sh:SPARQLConstraintComponent");
    assert.strictEqual(violations[0]?.message, "Circuit must be connected to ground.");
  }
  console.log("✔ SHACL-SPARQL Graph Pattern Constraints passed.\n");

  // -------------------------------------------------------------------------
  // Test 10: Parallel Multi-Module Reasoning (ParallelOntologyReasoner)
  // -------------------------------------------------------------------------
  console.log("[Test 10] Testing Parallel Multi-Module Reasoning...");
  {
    const parallelReasoner = new ParallelOntologyReasoner({ concurrency: 2 });

    const modules = [
      {
        name: "ElectricalSubsystem",
        axioms: [
          { type: "ClassDeclaration", iri: "ex:PowerSupply" } as const,
          { type: "ClassDeclaration", iri: "ex:Battery" } as const,
          { type: "SubClassOf", subClassIri: "ex:Battery", superClassIri: "ex:PowerSupply" } as const,
          { type: "IndividualDeclaration", iri: "ex:lipo1" } as const,
          { type: "ClassAssertion", individualIri: "ex:lipo1", classIri: "ex:Battery" } as const,
        ],
      },
      {
        name: "MechanicalSubsystem",
        axioms: [
          { type: "ClassDeclaration", iri: "ex:Frame" } as const,
          { type: "ClassDeclaration", iri: "ex:CarbonFiberFrame" } as const,
          { type: "SubClassOf", subClassIri: "ex:CarbonFiberFrame", superClassIri: "ex:Frame" } as const,
          { type: "IndividualDeclaration", iri: "ex:cf1" } as const,
          { type: "ClassAssertion", individualIri: "ex:cf1", classIri: "ex:CarbonFiberFrame" } as const,
        ],
      },
      {
        name: "FaultySubsystem",
        axioms: [
          { type: "ClassDeclaration", iri: "ex:Active" } as const,
          { type: "ClassDeclaration", iri: "ex:Inactive" } as const,
          { type: "DisjointClasses", classIris: ["ex:Active", "ex:Inactive"] } as const,
          { type: "IndividualDeclaration", iri: "ex:badNode" } as const,
          { type: "ClassAssertion", individualIri: "ex:badNode", classIri: "ex:Active" } as const,
          { type: "ClassAssertion", individualIri: "ex:badNode", classIri: "ex:Inactive" } as const,
        ],
      },
    ];

    const results = await parallelReasoner.classifyAll(modules);
    assert.strictEqual(results.size, 3, "All 3 modules should be classified");

    const elec = results.get("ElectricalSubsystem");
    assert.ok(elec);
    assert.strictEqual(elec.consistency.isConsistent, true);
    assert.ok(elec.taxonomy.some((t) => t.iri === "ex:Battery"));

    const mech = results.get("MechanicalSubsystem");
    assert.ok(mech);
    assert.strictEqual(mech.consistency.isConsistent, true);

    const faulty = results.get("FaultySubsystem");
    assert.ok(faulty);
    assert.strictEqual(faulty.consistency.isConsistent, false);

    const summary = parallelReasoner.mergeResults(results);
    assert.strictEqual(summary.isConsistent, false);
    assert.deepStrictEqual(summary.inconsistentModules, ["FaultySubsystem"]);
    assert.strictEqual(summary.totalAxioms, 5 + 5 + 6);
  }
  console.log("✔ Parallel Multi-Module Reasoning passed.\n");

  // -------------------------------------------------------------------------
  // Test 11: TBox Nominals (O / ObjectOneOf)
  // -------------------------------------------------------------------------
  console.log("[Test 11] Testing TBox Nominals (O / ObjectOneOf)...");
  {
    // 1. Singleton Nominal: SpecialSensor = { theCalibratedSensor }
    const reasoner1 = new WasmOntologyReasoner();
    reasoner1.loadOntology([
      { type: "ClassDeclaration", iri: "ex:SpecialSensor" },
      { type: "IndividualDeclaration", iri: "ex:theCalibratedSensor" },
      {
        type: "ObjectOneOf",
        classIri: "ex:SpecialSensor",
        individualIris: ["ex:theCalibratedSensor"],
      },
      { type: "IndividualDeclaration", iri: "ex:sensorX" },
      { type: "ClassAssertion", individualIri: "ex:sensorX", classIri: "ex:SpecialSensor" },
    ]);
    reasoner1.classify();
    assert.strictEqual(reasoner1.status, "ready");
    // sensorX should be unified with theCalibratedSensor
    const group1 = (reasoner1 as any).sameIndividualGroups.get("ex:sensorX");
    assert.ok(group1?.has("ex:theCalibratedSensor"), "sensorX must be unified with singleton nominal");

    // 2. Negative Elimination (Unit Resolution):
    // Status = { Ready, Busy, Offline }
    // droneStatus is DifferentFrom Ready and Busy -> must be Offline!
    const reasoner2 = new WasmOntologyReasoner();
    reasoner2.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Status" },
      { type: "IndividualDeclaration", iri: "ex:Ready" },
      { type: "IndividualDeclaration", iri: "ex:Busy" },
      { type: "IndividualDeclaration", iri: "ex:Offline" },
      {
        type: "ObjectOneOf",
        classIri: "ex:Status",
        individualIris: ["ex:Ready", "ex:Busy", "ex:Offline"],
      },
      { type: "IndividualDeclaration", iri: "ex:droneStatus" },
      { type: "ClassAssertion", individualIri: "ex:droneStatus", classIri: "ex:Status" },
      {
        type: "DifferentIndividuals",
        individualIris: ["ex:droneStatus", "ex:Ready"],
      },
      {
        type: "DifferentIndividuals",
        individualIris: ["ex:droneStatus", "ex:Busy"],
      },
    ]);
    reasoner2.classify();
    assert.strictEqual(reasoner2.status, "ready");
    const group2 = (reasoner2 as any).sameIndividualGroups.get("ex:droneStatus");
    assert.ok(group2?.has("ex:Offline"), "droneStatus must resolve to ex:Offline via negative elimination");

    // 3. Contradiction: DifferentFrom ALL nominals
    const reasoner3 = new WasmOntologyReasoner();
    reasoner3.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Status" },
      { type: "IndividualDeclaration", iri: "ex:Ready" },
      { type: "IndividualDeclaration", iri: "ex:Busy" },
      {
        type: "ObjectOneOf",
        classIri: "ex:Status",
        individualIris: ["ex:Ready", "ex:Busy"],
      },
      { type: "IndividualDeclaration", iri: "ex:badStatus" },
      { type: "ClassAssertion", individualIri: "ex:badStatus", classIri: "ex:Status" },
      {
        type: "DifferentIndividuals",
        individualIris: ["ex:badStatus", "ex:Ready"],
      },
      {
        type: "DifferentIndividuals",
        individualIris: ["ex:badStatus", "ex:Busy"],
      },
    ]);
    const res3 = reasoner3.checkConsistency();
    assert.strictEqual(res3.isConsistent, false, "Individual different from all nominals must trigger conflict");
    assert.ok(res3.conflictingAxioms?.some((a) => a.type === "ObjectOneOf"));
  }
  console.log("✔ TBox Nominals (O / ObjectOneOf) passed.\n");

  // -------------------------------------------------------------------------
  // Test 12: SHACL-AF Constructive Inferencing (sh:rule)
  // -------------------------------------------------------------------------
  console.log("[Test 12] Testing SHACL-AF Constructive Rules (sh:rule)...");
  {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Drone" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:batteryLevel" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:isFlightReady" },
      { type: "IndividualDeclaration", iri: "ex:droneAlpha" },
      { type: "ClassAssertion", individualIri: "ex:droneAlpha", classIri: "ex:Drone" },
      { type: "DataPropertyAssertion", propertyIri: "ex:batteryLevel", subjectIri: "ex:droneAlpha", value: "95" },
    ]);

    const shapes: SHACLNodeShape[] = [
      {
        targetClass: "ex:Drone",
        propertyShapes: [],
        rules: [
          {
            type: "TripleRule",
            targetClass: "ex:Drone",
            predicate: "ex:isFlightReady",
            object: "true",
            condition: {
              path: "ex:batteryLevel",
              minInclusive: 80,
            },
          },
        ],
      },
    ];

    const result = reasoner.executeShaclRules(shapes);
    assert.strictEqual(result.materializedAxioms.length, 1, "Should materialize 1 new triple assertion");
    assert.strictEqual(result.materializedAxioms[0]?.type, "DataPropertyAssertion");

    // Verify reasoner now has the materialized property
    const values = (reasoner as any).getPropertyValues("ex:droneAlpha", "ex:isFlightReady");
    assert.deepStrictEqual(values, ["true"]);
  }
  console.log("✔ SHACL-AF Constructive Rules (sh:rule) passed.\n");

  // -------------------------------------------------------------------------
  // Test 13: SWRL Rule Engine & Built-In Mathematical Functions
  // -------------------------------------------------------------------------
  console.log("[Test 13] Testing SWRL Rule Engine & swrlb Built-ins...");
  {
    // Rule: Motor(?m) ^ voltage(?m, ?v) ^ current(?m, ?i) ^ swrlb:multiply(?p, ?v, ?i) -> power(?m, ?p)
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Motor" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:voltage" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:current" },
      { type: "DataPropertyDeclaration", propertyIri: "ex:power" },
      {
        type: "SwrlRule",
        ruleIri: "ex:CalculateMotorPower",
        body: [
          { type: "ClassAtom", classIri: "ex:Motor", argument: "?m" },
          { type: "DataPropertyAtom", propertyIri: "ex:voltage", argument1: "?m", argument2: "?v" },
          { type: "DataPropertyAtom", propertyIri: "ex:current", argument1: "?m", argument2: "?i" },
          { type: "BuiltInAtom", builtInIri: "swrlb:multiply", arguments: ["?p", "?v", "?i"] },
        ],
        head: [{ type: "DataPropertyAtom", propertyIri: "ex:power", argument1: "?m", argument2: "?p" }],
      },
      { type: "IndividualDeclaration", iri: "ex:motor1" },
      { type: "ClassAssertion", individualIri: "ex:motor1", classIri: "ex:Motor" },
      { type: "DataPropertyAssertion", propertyIri: "ex:voltage", subjectIri: "ex:motor1", value: "24" },
      { type: "DataPropertyAssertion", propertyIri: "ex:current", subjectIri: "ex:motor1", value: "5" },
    ]);

    reasoner.classify();

    // Verify 24 * 5 = 120 power was inferred!
    const powerVals = (reasoner as any).getPropertyValues("ex:motor1", "ex:power");
    assert.deepStrictEqual(powerVals, ["120"], "SWRL rule should infer ex:power = 120");
  }
  console.log("✔ SWRL Rule Engine & swrlb Built-ins passed.\n");

  // -------------------------------------------------------------------------
  // Test 14: Cost-Based Conjunctive Join Optimization in queryBgp
  // -------------------------------------------------------------------------
  console.log("[Test 14] Testing Cost-Based Conjunctive Join Optimization in queryBgp...");
  {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "ex:Aircraft" },
      { type: "ClassDeclaration", iri: "ex:Wing" },
      { type: "IndividualDeclaration", iri: "ex:plane1" },
      { type: "ClassAssertion", individualIri: "ex:plane1", classIri: "ex:Aircraft" },
      { type: "IndividualDeclaration", iri: "ex:wingL" },
      { type: "ClassAssertion", individualIri: "ex:wingL", classIri: "ex:Wing" },
      { type: "ObjectPropertyAssertion", propertyIri: "ex:hasWing", subjectIri: "ex:plane1", objectIri: "ex:wingL" },
      { type: "DataPropertyAssertion", propertyIri: "ex:span", subjectIri: "ex:wingL", value: "35.5" },
    ]);

    // Query finding wings of aircraft and their spans
    const qRes = reasoner.queryBgp({
      patterns: [
        { subject: "?plane", predicate: "rdf:type", object: "ex:Aircraft" },
        { subject: "?plane", predicate: "ex:hasWing", object: "?w" },
        { subject: "?w", predicate: "ex:span", object: "?s" },
      ],
    });

    assert.strictEqual(qRes.bindings.length, 1);
    assert.strictEqual(qRes.bindings[0]?.["?plane"], "ex:plane1");
    assert.strictEqual(qRes.bindings[0]?.["?w"], "ex:wingL");
    assert.strictEqual(qRes.bindings[0]?.["?s"], "35.5");
  }
  console.log("✔ Cost-Based Conjunctive Join Optimization in queryBgp passed.\n");

  // -------------------------------------------------------------------------
  // Test 15: Automated bot-Locality Modularization & Parallel Partitioning
  // -------------------------------------------------------------------------
  console.log("[Test 15] Testing Automated bot-Locality Modularization & Parallel Partitioning...");
  {
    const monolithicAxioms: OWL2Axiom[] = [
      // Domain 1: Power
      { type: "ClassDeclaration", iri: "ex:PowerSource" },
      { type: "ClassDeclaration", iri: "ex:Battery" },
      { type: "SubClassOf", subClassIri: "ex:Battery", superClassIri: "ex:PowerSource" },
      { type: "IndividualDeclaration", iri: "ex:b1" },
      { type: "ClassAssertion", individualIri: "ex:b1", classIri: "ex:Battery" },

      // Domain 2: Propulsion
      { type: "ClassDeclaration", iri: "ex:Actuator" },
      { type: "ClassDeclaration", iri: "ex:Motor" },
      { type: "SubClassOf", subClassIri: "ex:Motor", superClassIri: "ex:Actuator" },
      { type: "IndividualDeclaration", iri: "ex:m1" },
      { type: "ClassAssertion", individualIri: "ex:m1", classIri: "ex:Motor" },
    ];

    // Automatically partition monolithic ontology using bot-locality
    const modules = ParallelOntologyReasoner.partitionByLocality(monolithicAxioms, 2);
    assert.strictEqual(modules.length, 2, "Should create 2 locality modules");

    const parallelReasoner = new ParallelOntologyReasoner({ concurrency: 2 });
    const results = await parallelReasoner.classifyAll(modules);
    assert.strictEqual(results.size, 2);

    const merged = parallelReasoner.mergeResults(results);
    assert.strictEqual(merged.isConsistent, true);
    assert.ok(merged.totalTaxonomyNodes >= 4);
  }
  console.log("✔ Automated bot-Locality Modularization & Parallel Partitioning passed.\n");

  console.log("=================================================");
  console.log("ALL SOTA REASONER UPGRADE TESTS PASSED!");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
