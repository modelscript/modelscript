// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { WasmOntologyReasoner } from "@modelscript/runtime";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  Owl2ErrorCode,
  createOWL2QueryEngine,
  createOWL2WorkspaceIndex,
  expandOwl2Iri,
  extractOwl2Prefixes,
  getOwl2ErrorByRule,
  getOwl2ErrorCodeDef,
  lintOwl2Document,
  lowerCstToAxioms,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(wasmPath);

function parseFss(src: string): any {
  const tree = parser.parse(src);
  assert.ok(tree?.rootNode, "Expected parser to return a CST rootNode");
  return tree.rootNode;
}

describe("OWL 2 Error Code Registry", () => {
  it("defines unique 1-to-1 numeric codes across O1xxx-O6xxx", () => {
    const entries = Object.values(Owl2ErrorCode);
    assert.ok(entries.length >= 24, `Expected at least 24 error codes, got ${entries.length}`);

    const seenCodes = new Set<number>();
    const seenRules = new Set<string>();
    for (const def of entries) {
      assert.ok(!seenCodes.has(def.code), `Duplicate numeric code ${def.code}`);
      assert.ok(!seenRules.has(def.rule), `Duplicate rule name ${def.rule}`);
      seenCodes.add(def.code);
      seenRules.add(def.rule);

      assert.strictEqual(getOwl2ErrorCodeDef(def.code), def);
      assert.strictEqual(getOwl2ErrorByRule(def.rule), def);
    }
  });
});

describe("OWL 2 Complete CST Lowering & Prefix Unification", () => {
  it("lowers all 27 OWL 2 Functional-Style Syntax axiom types", () => {
    const src = `
Prefix(: = <http://example.org/ont#>)
Ontology(
  Declaration(Class(:Person))
  Declaration(Class(:Parent))
  Declaration(ObjectProperty(:hasChild))
  Declaration(ObjectProperty(:hasDescendant))
  Declaration(ObjectProperty(:hasSSNObject))
  Declaration(ObjectProperty(:knows))
  Declaration(DataProperty(:hasAge))
  Declaration(DataProperty(:hasYears))
  Declaration(NamedIndividual(:alice))
  Declaration(NamedIndividual(:bob))
  Declaration(NamedIndividual(:charlie))

  SubClassOf(:Parent :Person)
  SubClassOf(:Parent ObjectSomeValuesFrom(:hasChild :Person))
  SubClassOf(:Person DataSomeValuesFrom(:hasAge xsd:integer))
  SubObjectPropertyOf(:hasChild :hasDescendant)
  SubDataPropertyOf(:hasAge :hasYears)
  ObjectPropertyDomain(:hasChild :Parent)
  ObjectPropertyRange(:hasChild :Person)
  DataPropertyDomain(:hasAge :Person)
  DataPropertyRange(:hasAge xsd:integer)
  InverseFunctionalObjectProperty(:hasSSNObject)
  ReflexiveObjectProperty(:knows)
  NegativeObjectPropertyAssertion(:hasChild :bob :alice)
  NegativeDataPropertyAssertion(:hasAge :alice "999")
  DifferentIndividuals(:alice :bob :charlie)
)
`.trim();

    const root = parseFss(src);
    const axioms = lowerCstToAxioms(root, src);

    assert.ok(
      axioms.some(
        (a) =>
          a.type === "ObjectSomeValuesFrom" &&
          a.subClassIri === ":Parent" &&
          a.propertyIri === ":hasChild" &&
          a.fillerClassIri === ":Person",
      ),
      "Expected ObjectSomeValuesFrom with subClassIri :Parent",
    );
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "DataSomeValuesFrom" &&
          a.subClassIri === ":Person" &&
          a.propertyIri === ":hasAge" &&
          a.dataRange === "xsd:integer",
      ),
      "Expected DataSomeValuesFrom with subClassIri :Person",
    );
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "SubObjectPropertyOf" &&
          a.subPropertyIri === ":hasChild" &&
          a.superPropertyIri === ":hasDescendant",
      ),
      "Expected SubObjectPropertyOf(:hasChild :hasDescendant)",
    );
    assert.ok(
      axioms.some(
        (a) => a.type === "SubDataPropertyOf" && a.subPropertyIri === ":hasAge" && a.superPropertyIri === ":hasYears",
      ),
      "Expected SubDataPropertyOf(:hasAge :hasYears)",
    );
    assert.ok(
      axioms.some(
        (a) => a.type === "ObjectPropertyDomain" && a.propertyIri === ":hasChild" && a.domainIri === ":Parent",
      ),
      "Expected ObjectPropertyDomain(:hasChild :Parent)",
    );
    assert.ok(
      axioms.some((a) => a.type === "ObjectPropertyRange" && a.propertyIri === ":hasChild" && a.rangeIri === ":Person"),
      "Expected ObjectPropertyRange(:hasChild :Person)",
    );
    assert.ok(
      axioms.some((a) => a.type === "DataPropertyDomain" && a.propertyIri === ":hasAge" && a.domainIri === ":Person"),
      "Expected DataPropertyDomain(:hasAge :Person)",
    );
    assert.ok(
      axioms.some((a) => a.type === "DataPropertyRange" && a.propertyIri === ":hasAge" && a.rangeIri === "xsd:integer"),
      "Expected DataPropertyRange(:hasAge xsd:integer)",
    );
    assert.ok(
      axioms.some((a) => a.type === "InverseFunctionalObjectProperty" && a.propertyIri === ":hasSSNObject"),
      "Expected InverseFunctionalObjectProperty(:hasSSNObject)",
    );
    assert.ok(
      axioms.some((a) => a.type === "ReflexiveObjectProperty" && a.propertyIri === ":knows"),
      "Expected ReflexiveObjectProperty(:knows)",
    );
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "NegativeObjectPropertyAssertion" &&
          a.propertyIri === ":hasChild" &&
          a.subjectIri === ":bob" &&
          a.objectIri === ":alice",
      ),
      "Expected NegativeObjectPropertyAssertion(:hasChild :bob :alice)",
    );
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "NegativeDataPropertyAssertion" &&
          a.propertyIri === ":hasAge" &&
          a.subjectIri === ":alice" &&
          a.value === "999",
      ),
      "Expected NegativeDataPropertyAssertion(:hasAge :alice '999')",
    );
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "DifferentIndividuals" &&
          a.individualIris.includes(":alice") &&
          a.individualIris.includes(":bob") &&
          a.individualIris.includes(":charlie"),
      ),
      "Expected DifferentIndividuals(:alice :bob :charlie)",
    );
  });

  it("unifies full IRIs and abbreviated IRIs sharing a declared prefix and supports expandPrefixes", () => {
    const src = `
Prefix(: = <http://example.org/vehicles#>)
Ontology(
  Declaration(Class(:Vehicle))
  Declaration(Class(<http://example.org/vehicles#Car>))
  Declaration(Class(:SportsCar))
  SubClassOf(<http://example.org/vehicles#Car> :Vehicle)
  SubClassOf(:SportsCar <http://example.org/vehicles#Car>)
)
`.trim();

    const root = parseFss(src);
    const prefixes = extractOwl2Prefixes(root, src);
    assert.strictEqual(prefixes.get(":"), "http://example.org/vehicles#");
    assert.strictEqual(expandOwl2Iri(":Car", prefixes), "http://example.org/vehicles#Car");

    // Default compact unification: <http://example.org/vehicles#Car> unifies to :Car
    const compacted = lowerCstToAxioms(root, src);
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(compacted);
    reasoner.classify();
    assert.strictEqual(reasoner.isSubClassOf(":SportsCar", ":Vehicle").holds, true);

    // Expanded mode: :Car expands to http://example.org/vehicles#Car
    const expanded = lowerCstToAxioms(root, src, { expandPrefixes: true });
    assert.ok(expanded.some((a) => a.type === "ClassDeclaration" && a.iri === "http://example.org/vehicles#Vehicle"));
    const reasonerExp = new WasmOntologyReasoner();
    reasonerExp.loadOntology(expanded);
    reasonerExp.classify();
    assert.strictEqual(
      reasonerExp.isSubClassOf("http://example.org/vehicles#SportsCar", "http://example.org/vehicles#Vehicle").holds,
      true,
    );
  });

  it("propagates SubObjectPropertyOf, Domain/Range, and InverseFunctionalObjectProperty in reasoner", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:Parent))
  Declaration(Class(:Person))
  Declaration(ObjectProperty(:hasMother))
  Declaration(ObjectProperty(:hasParent))
  Declaration(ObjectProperty(:hasBadge))
  Declaration(NamedIndividual(:alice))
  Declaration(NamedIndividual(:mary))
  SubObjectPropertyOf(:hasMother :hasParent)
  ObjectPropertyDomain(:hasParent :Person)
  ObjectPropertyRange(:hasParent :Parent)
  InverseFunctionalObjectProperty(:hasBadge)
  ObjectPropertyAssertion(:hasMother :alice :mary)
)
`.trim();

    const root = parseFss(src);
    const axioms = lowerCstToAxioms(root, src);
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(axioms);
    reasoner.classify();

    const aliceTypes = reasoner.getIndividualTypes(":alice");
    const maryTypes = reasoner.getIndividualTypes(":mary");
    assert.ok(aliceTypes.includes(":Person"), "Domain of super-property :hasParent should infer :alice is :Person");
    assert.ok(maryTypes.includes(":Parent"), "Range of super-property :hasParent should infer :mary is :Parent");
  });
});

describe("OWL 2 Linter Rules (O1xxx - O6xxx)", () => {
  it("detects O1002 undeclared prefix, O1003 duplicate prefix, O1004 invalid IRI, and O1005 insufficient arity", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Prefix(: = <http://example.org/dup#>)
Prefix(bad: = <not a valid iri>)
Ontology(
  Declaration(Class(undecl:MyClass))
  DisjointClasses(:OnlyOne)
  EquivalentClasses(:Single)
  SameIndividual(:solo)
  ObjectOneOf()
)
`.trim();

    const root = parseFss(src);
    const diags = lintOwl2Document(root, src, { checkUndeclaredEntities: false });
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(codes.has(Owl2ErrorCode.UNDECLARED_PREFIX.code), "Expected O1002 undeclared-prefix");
    assert.ok(codes.has(Owl2ErrorCode.DUPLICATE_PREFIX.code), "Expected O1003 duplicate-prefix");
    assert.ok(codes.has(Owl2ErrorCode.INVALID_IRI.code), "Expected O1004 invalid-iri");
    assert.ok(codes.has(Owl2ErrorCode.INSUFFICIENT_ARITY.code), "Expected O1005 insufficient-arity");
  });

  it("detects O2001 undeclared entity, O2002 duplicate declaration, and O2003 reserved vocabulary declaration", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:Car))
  Declaration(Class(:Car))
  Declaration(Class(owl:Thing))
  SubClassOf(:Car :UndeclaredVehicle)
)
`.trim();

    const root = parseFss(src);
    const diags = lintOwl2Document(root, src);
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(codes.has(Owl2ErrorCode.UNDECLARED_ENTITY.code), "Expected O2001 undeclared-entity");
    assert.ok(codes.has(Owl2ErrorCode.DUPLICATE_DECLARATION.code), "Expected O2002 duplicate-declaration");
    assert.ok(
      codes.has(Owl2ErrorCode.RESERVED_VOCABULARY_DECLARATION.code),
      "Expected O2003 reserved-vocabulary-declaration",
    );
  });

  it("detects O3001 illegal property punning, O3002/O3003 wrong property kind, O3004 datatype as class, O3005 invalid datatype, and O3006 literal mismatch", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:Person))
  Declaration(ObjectProperty(:pPunned))
  Declaration(DataProperty(:pPunned))
  Declaration(ObjectProperty(:objProp))
  Declaration(DataProperty(:age))
  Declaration(NamedIndividual(:john))

  SubClassOf(:Person ObjectSomeValuesFrom(:age :Person))
  SubClassOf(:Person DataSomeValuesFrom(:objProp xsd:integer))
  SubClassOf(:Person xsd:integer)
  DataPropertyRange(:age :Person)
  DataPropertyRange(:age xsd:integer)
  DataPropertyAssertion(:age :john "notAnInteger")
)
`.trim();

    const root = parseFss(src);
    const diags = lintOwl2Document(root, src);
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(codes.has(Owl2ErrorCode.ILLEGAL_PROPERTY_PUNNING.code), "Expected O3001 illegal-property-punning");
    assert.ok(codes.has(Owl2ErrorCode.EXPECTED_OBJECT_PROPERTY.code), "Expected O3002 expected-object-property");
    assert.ok(codes.has(Owl2ErrorCode.EXPECTED_DATA_PROPERTY.code), "Expected O3003 expected-data-property");
    assert.ok(codes.has(Owl2ErrorCode.EXPECTED_CLASS_EXPRESSION.code), "Expected O3004 expected-class-expression");
    assert.ok(codes.has(Owl2ErrorCode.INVALID_DATATYPE.code), "Expected O3005 invalid-datatype");
    assert.ok(codes.has(Owl2ErrorCode.DATATYPE_LITERAL_MISMATCH.code), "Expected O3006 datatype-literal-mismatch");
  });

  it("detects O4001 non-simple property restriction, O4002 contradictory characteristics, O4003/O4004 cycles, and O4005 self-referential axioms", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:Node))
  Declaration(Class(:A))
  Declaration(Class(:B))
  Declaration(ObjectProperty(:hasAncestor))
  Declaration(ObjectProperty(:hasRelative))
  Declaration(ObjectProperty(:rel))

  TransitiveObjectProperty(:hasAncestor)
  SubObjectPropertyOf(:hasAncestor :hasRelative)
  SubObjectPropertyOf(:hasRelative :hasAncestor)

  SubClassOf(:Node ObjectMinCardinality(2 :hasRelative :Node))
  SymmetricObjectProperty(:rel)
  AsymmetricObjectProperty(:rel)

  SubClassOf(:A :B)
  SubClassOf(:B :A)
  SubClassOf(:A :A)
)
`.trim();

    const root = parseFss(src);
    const diags = lintOwl2Document(root, src);
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(
      codes.has(Owl2ErrorCode.NON_SIMPLE_PROPERTY_RESTRICTION.code),
      "Expected O4001 non-simple-property-restriction on super-property of transitive property",
    );
    assert.ok(
      codes.has(Owl2ErrorCode.CONTRADICTORY_PROPERTY_CHARACTERISTICS.code),
      "Expected O4002 contradictory-property-characteristics",
    );
    assert.ok(codes.has(Owl2ErrorCode.PROPERTY_HIERARCHY_CYCLE.code), "Expected O4003 property-hierarchy-cycle");
    assert.ok(codes.has(Owl2ErrorCode.CLASS_HIERARCHY_CYCLE.code), "Expected O4004 class-hierarchy-cycle");
    assert.ok(codes.has(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM.code), "Expected O4005 self-referential-axiom");
  });

  it("detects O5001 functional clash, O5002 negative assertion clash, O5003 unsatisfiable class, and O5004 ontology inconsistency", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:Cat))
  Declaration(Class(:Dog))
  Declaration(Class(:CatDog))
  Declaration(ObjectProperty(:hasBestFriend))
  Declaration(NamedIndividual(:a))
  Declaration(NamedIndividual(:b))
  Declaration(NamedIndividual(:c))

  DisjointClasses(:Cat :Dog)
  SubClassOf(:CatDog :Cat)
  SubClassOf(:CatDog :Dog)

  FunctionalObjectProperty(:hasBestFriend)
  ObjectPropertyAssertion(:hasBestFriend :a :b)
  ObjectPropertyAssertion(:hasBestFriend :a :c)
  DifferentIndividuals(:b :c)

  NegativeObjectPropertyAssertion(:hasBestFriend :a :b)
)
`.trim();

    const root = parseFss(src);
    const diags = lintOwl2Document(root, src);
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(codes.has(Owl2ErrorCode.FUNCTIONAL_PROPERTY_CLASH.code), "Expected O5001 functional-property-clash");
    assert.ok(codes.has(Owl2ErrorCode.NEGATIVE_ASSERTION_CLASH.code), "Expected O5002 negative-assertion-clash");
    assert.ok(codes.has(Owl2ErrorCode.UNSATISFIABLE_CLASS.code), "Expected O5003 unsatisfiable-class for :CatDog");
    assert.ok(codes.has(Owl2ErrorCode.ONTOLOGY_INCONSISTENT.code), "Expected O5004 ontology-inconsistent");
  });

  it("detects O6001 OWL 2 EL profile violations when profile is EL", () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:A))
  Declaration(Class(:B))
  Declaration(ObjectProperty(:p))
  SubClassOf(:A ObjectAllValuesFrom(:p :B))
  FunctionalObjectProperty(:p)
)
`.trim();

    const root = parseFss(src);
    const diags = lintOwl2Document(root, src, { profile: "EL" });
    const elDiags = diags.filter((d) => d.code === Owl2ErrorCode.PROFILE_EL_VIOLATION.code);
    assert.strictEqual(elDiags.length, 2, "Expected 2 O6001 OWL 2 EL violations");
  });

  it("integrates with Salsa QueryEngine via createOWL2WorkspaceIndex and runAllLintsAsync", async () => {
    const src = `
Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:A))
  Declaration(Class(:B))
  Declaration(Class(:AB))
  DisjointClasses(:A :B)
  SubClassOf(:AB :A)
  SubClassOf(:AB :B)
)
`.trim();

    const root = parseFss(src);
    const ws = createOWL2WorkspaceIndex();
    ws.register("file:///test.owl", () => root);
    const engine = createOWL2QueryEngine(ws.toUnifiedPartial());
    const diags = await engine.runAllLintsAsync("file:///test.owl");

    assert.ok(
      diags.some((d: any) => d.code === "O5003" || d.rule === "unsatisfiable-class"),
      "Expected Salsa QueryEngine runAllLintsAsync to surface O5003 unsatisfiable-class",
    );
  });
});
