// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { WasmOntologyReasoner } from "@modelscript/runtime";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  lintOwl2Document,
  lowerCstToAxioms,
  Owl2TableauReasoner,
  parseOwlXmlToAxioms,
  parseTurtleToOwl2Axioms,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(wasmPath);

describe("OWL 2 Grammar Upgrades & SubPropertyChainOf Parity", () => {
  it("parses annotations, hyphenated IRIs, escaped strings, ObjectInverseOf, EquivalentObjectProperties, and HasKey", () => {
    const src = `
Prefix(: = <http://example.org/sys#>)
Prefix(rdfs: = <http://www.w3.org/2000/01/rdf-schema#>)
Ontology(<http://example.org/sys> <http://example.org/sys/v1>
  Annotation(rdfs:label "Cyber-Physical \\"System\\" Ontology"@en)
  Declaration(AnnotationProperty(rdfs:label))
  Declaration(Class(:sub-system))
  Declaration(ObjectProperty(:has-part))
  Declaration(ObjectProperty(:part-of))
  Declaration(ObjectProperty(:contains))
  Declaration(DataProperty(:serial-id))
  AnnotationAssertion(rdfs:label :sub-system "Sub-system component"@en)
  EquivalentObjectProperties(:has-part :contains)
  SubObjectPropertyOf(ObjectInverseOf(:has-part) :part-of)
  HasKey(:sub-system () (:serial-id))
)
`.trim();

    const tree = parser.parse(src);
    assert.ok(tree?.rootNode);
    const hasErr =
      typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : Boolean(tree.rootNode.hasError);
    assert.equal(hasErr, false, "Expected clean GLR parse with 0 syntax errors");

    const axioms = lowerCstToAxioms(tree.rootNode, src);
    assert.ok(axioms.some((a) => a.type === "ClassDeclaration" && a.iri === ":sub-system"));
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "SubObjectPropertyOf" && a.subPropertyIri === ":has-part" && a.superPropertyIri === ":contains",
      ),
    );
    assert.ok(
      axioms.some(
        (a) =>
          a.type === "SubObjectPropertyOf" && a.subPropertyIri === ":contains" && a.superPropertyIri === ":has-part",
      ),
    );
  });

  it("lowers SubPropertyChainOf from FSS, Turtle, and OWL/XML into both WasmOntologyReasoner and Owl2TableauReasoner", () => {
    const fss = `
Prefix(: = <http://example.org/fam#>)
Ontology(
  SubObjectPropertyOf(ObjectPropertyChain(:hasParent :hasBrother) :hasUncle)
  ObjectPropertyAssertion(:hasParent :alice :bob)
  ObjectPropertyAssertion(:hasBrother :bob :charlie)
)
`.trim();

    const ttl = `
@prefix : <http://example.org/fam#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
:hasUncle owl:propertyChainAxiom ( :hasParent :hasBrother ) .
:alice :hasParent :bob .
:bob :hasBrother :charlie .
`.trim();

    const owx = `
<Ontology xmlns="http://www.w3.org/2002/07/owl#">
  <Prefix name="" IRI="http://example.org/fam#"/>
  <SubObjectPropertyOf>
    <ObjectPropertyChain>
      <ObjectProperty abbreviatedIRI=":hasParent"/>
      <ObjectProperty abbreviatedIRI=":hasBrother"/>
    </ObjectPropertyChain>
    <ObjectProperty abbreviatedIRI=":hasUncle"/>
  </SubObjectPropertyOf>
  <ObjectPropertyAssertion>
    <ObjectProperty abbreviatedIRI=":hasParent"/>
    <NamedIndividual abbreviatedIRI=":alice"/>
    <NamedIndividual abbreviatedIRI=":bob"/>
  </ObjectPropertyAssertion>
  <ObjectPropertyAssertion>
    <ObjectProperty abbreviatedIRI=":hasBrother"/>
    <NamedIndividual abbreviatedIRI=":bob"/>
    <NamedIndividual abbreviatedIRI=":charlie"/>
  </ObjectPropertyAssertion>
</Ontology>
`.trim();

    const fssAxioms = lowerCstToAxioms(parser.parse(fss).rootNode, fss);
    const ttlAxioms = parseTurtleToOwl2Axioms(ttl);
    const owxAxioms = parseOwlXmlToAxioms(owx);

    for (const [label, axioms] of [
      ["FSS", fssAxioms],
      ["Turtle", ttlAxioms],
      ["OWL/XML", owxAxioms],
    ] as const) {
      assert.ok(
        axioms.some(
          (a) =>
            a.type === "SubPropertyChainOf" && a.superPropertyIri === ":hasUncle" && a.subPropertyChain.length === 2,
        ),
        `${label} should emit canonical SubPropertyChainOf`,
      );

      const wasmReasoner = new WasmOntologyReasoner();
      wasmReasoner.loadOntology(axioms);
      wasmReasoner.classify();
      const reachable = wasmReasoner.evaluatePropertyPath(":hasUncle", "direct", ":alice");
      assert.ok(
        reachable.includes(":charlie"),
        `${label}: WasmOntologyReasoner should infer :hasUncle(:alice, :charlie)`,
      );

      const tableauReasoner = new Owl2TableauReasoner(axioms);
      assert.equal(
        tableauReasoner.hasRoleRelationship(":hasUncle", ":alice", ":charlie"),
        true,
        `${label}: Owl2TableauReasoner should infer :hasUncle(:alice, :charlie)`,
      );
    }
  });

  it("supports annotated axioms, Turtle @base relative IRIs, and SROIQ(D) tableau linting in lintOwl2Document", () => {
    const annotatedFss = `
Prefix(: = <http://example.org/ont#>)
Prefix(rdfs: = <http://www.w3.org/2000/01/rdf-schema#>)
Ontology(
  Declaration(Class(:BadClass))
  Declaration(ObjectProperty(:p))
  SubClassOf(Annotation(rdfs:comment "Annotated GCI") :BadClass ObjectMinCardinality(2 :p))
  SubClassOf(:BadClass ObjectMaxCardinality(1 :p))
)
`.trim();
    const tree = parser.parse(annotatedFss);
    const hasErr =
      typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : Boolean(tree.rootNode.hasError);
    assert.equal(hasErr, false, "Expected annotated SubClassOf to parse cleanly");

    const diags = lintOwl2Document(tree.rootNode as any, annotatedFss);
    assert.ok(
      diags.some((d) => d.code === 5003 && d.iri === ":BadClass"),
      "Expected SROIQ(D) tableau pass in lintOwl2Document to flag :BadClass as O5003 unsatisfiable",
    );

    const ttlBase = `
@base <http://example.org/base/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
<Motor> a owl:Class .
<ServoMotor> a owl:Class ; <http://www.w3.org/2000/01/rdf-schema#subClassOf> <Motor> .
`;
    const ttlAxioms = parseTurtleToOwl2Axioms(ttlBase);
    assert.ok(
      ttlAxioms.some(
        (a) =>
          a.type === "SubClassOf" &&
          (a.subClassIri === ":ServoMotor" || a.subClassIri === "http://example.org/base/ServoMotor") &&
          (a.superClassIri === ":Motor" || a.superClassIri === "http://example.org/base/Motor"),
      ),
      "Expected Turtle @base to resolve relative IRIs",
    );
  });
});
