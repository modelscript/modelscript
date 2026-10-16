# OWL2 Ontology (`.owl`, `.owl2`, `.ofn`, `.ttl`)

`@modelscript/owl2` (`languages/owl2`) brings formal ontological engineering, Description Logic ($\mathcal{SROIQ}(\mathcal{D})$) reasoning, and SPARQL / Leapfrog Triejoin graph querying directly into the ModelScript compiler.

---

## Supported Extensions & Formats

| Extension               | Format                                                             |
| :---------------------- | :----------------------------------------------------------------- |
| `.owl`, `.owl2`, `.ofn` | W3C OWL 2 Functional-Style Syntax (`Prefix(...)`, `Ontology(...)`) |
| `.ttl`                  | RDF Turtle / Ontological Triple Assertions                         |

---

## OWL 2 DL Axiom & Class Expression Lowering

`lowerCstToAxioms(tree, sourceText)` (`languages/owl2/src/cst-lowering.ts`) lowers the linear-memory CST into an arena-backed `OntologyStore` supporting over 35 OWL 2 DL axiom and class expression constructs:

| Category                                | Supported OWL 2 Functional-Style Constructs                                                                                                                                                                                        |
| :-------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Declarations**                        | `Declaration(Class(...))`, `Declaration(ObjectProperty(...))`, `Declaration(DataProperty(...))`, `Declaration(NamedIndividual(...))`                                                                                               |
| **Class Axioms**                        | `SubClassOf`, `EquivalentClasses`, `DisjointClasses`                                                                                                                                                                               |
| **Boolean & Nominal Class Expressions** | `ObjectIntersectionOf`, `ObjectUnionOf`, `ObjectComplementOf`, `ObjectOneOf`                                                                                                                                                       |
| **Object Property Restrictions**        | `ObjectSomeValuesFrom`, `ObjectAllValuesFrom`, `ObjectHasSelf`, `ObjectHasValue`, `ObjectMinCardinality`, `ObjectMaxCardinality`, `ObjectExactCardinality`                                                                         |
| **Data Property Restrictions**          | `DataSomeValuesFrom`, `DataAllValuesFrom`, `DataMinCardinality`, `DataMaxCardinality`, `DataExactCardinality`                                                                                                                      |
| **Property Hierarchy & Inversion**      | `SubObjectPropertyOf`, `SubDataPropertyOf`, `InverseObjectProperties`, `DisjointObjectProperties`                                                                                                                                  |
| **Property Domains & Ranges**           | `ObjectPropertyDomain`, `ObjectPropertyRange`, `DataPropertyDomain`, `DataPropertyRange`                                                                                                                                           |
| **Property Characteristics**            | `FunctionalObjectProperty`, `InverseFunctionalObjectProperty`, `ReflexiveObjectProperty`, `IrreflexiveObjectProperty`, `SymmetricObjectProperty`, `AsymmetricObjectProperty`, `TransitiveObjectProperty`, `FunctionalDataProperty` |
| **ABox Individual Assertions**          | `ClassAssertion`, `ObjectPropertyAssertion`, `DataPropertyAssertion`, `NegativeObjectPropertyAssertion`, `NegativeDataPropertyAssertion`, `SameIndividual`, `DifferentIndividuals`                                                 |

```lisp
Prefix(:=<http://example.org/spacecraft#>)
Ontology(<http://example.org/spacecraft>
  Declaration(Class(:Thruster))
  Declaration(Class(:Actuator))
  Declaration(ObjectProperty(:mountedOn))
  Declaration(DataProperty(:nominalThrustN))
  SubClassOf(:Thruster :Actuator)
  SubClassOf(:Thruster ObjectSomeValuesFrom(:mountedOn :ReactionControlPod))
  ClassAssertion(:Thruster :RCS_Thruster_A1)
  DataPropertyAssertion(:nominalThrustN :RCS_Thruster_A1 "22.0"^^xsd:double)
)
```

---

## Description Logic Tableau Reasoner & Leapfrog Triejoin

`@modelscript/owl2` includes an in-memory **$\mathcal{SROIQ}(\mathcal{D})$ Tableau Reasoner** (`TableauReasoner` in `languages/owl2/src/reasoner/`) and a worst-case optimal **Leapfrog Triejoin** engine (`executeBGP` in `languages/owl2/src/query/leapfrog.ts`):

1. **Consistency & Satisfiability Checking**: Detects unsatisfiable classes (`DisjointClasses` violations, cardinality contradictions, irreflexive/asymmetric cycles, negative property assertion conflicts) and surfaces exact source diagnostics (`OWL2001`–`OWL2005`).
2. **Justification & Explanation Tracing**: Computes minimal unsatisfiability justifications (`explain_inference`) explaining why a class or individual violates ontology axioms.
3. **SPARQL & Multi-Way BGP Joins**: Evaluates conjunctive Basic Graph Patterns (BGPs) in $O(\text{AGM bound})$ worst-case optimal time without materializing intermediate Cartesian products.

---

## Interactive 2D Ontology Diagram & Bidirectional Writeback

`languages/owl2/src/diagram/` provides an interactive 2D graph visualization and editing surface for OWL 2 ontologies:

- **Visual Graph Projection**: Renders `Class` nodes, `NamedIndividual` instances, `SubClassOf` inheritance hierarchies, and `ObjectPropertyDomain`/`ObjectPropertyRange` directed edges.
- **Bidirectional CST Writeback (`owl2Language.writeback`)**: Adding/deleting nodes or edges in the diagram (`add_node`, `delete_node`, `add_edge`, `delete_edge`, `rename_node`, `update_parameter`) patches the Functional-Style `.owl` source text directly—inserting or removing `Declaration(...)`, `SubClassOf(...)`, or `DataPropertyAssertion(...)` axioms in place.

---

## Dedicated `owl2-mcp` Server Tools

The `@modelscript/owl2` MCP server (`languages/owl2/src/mcp/server.ts`) exposes five specialized tools to AI agents:

| MCP Tool                      | Description                                                                                                                                                                         |
| :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate_system_consistency` | Parses an OWL 2 Functional Syntax ontology, runs the $\mathcal{SROIQ}$ Tableau Reasoner, and returns consistency status, unsatisfiable classes, and inferred `SubClassOf` hierarchy |
| `query_ontology_sparql`       | Executes a SPARQL `SELECT` `WHERE` query over the ontology's inferred RDF triple graph                                                                                              |
| `query_ontology_bgp`          | Evaluates a conjunctive Basic Graph Pattern (BGP) using the worst-case optimal Leapfrog Triejoin algorithm                                                                          |
| `explain_inference`           | Computes formal axiomatic justifications explaining why an entailment holds or why a class is unsatisfiable                                                                         |
| `trace_fault_propagation`     | Traces transitive fault propagation (`TransitiveObjectProperty` / causal links) from a starting component individual across the system topology                                     |

---

## Polyglot TGG Rules

`@modelscript/owl2` defines 5 bidirectional Triple Graph Grammar (TGG) rules in `languages/owl2/src/language.ts`:

| Rule Name                            | Source (`owl2`)                  | Target Language | Target Construct            |
| :----------------------------------- | :------------------------------- | :-------------- | :-------------------------- |
| `OWL2ClassToSysML2Part`              | `Declaration` (`Class`)          | `sysml2`        | `PartDef`                   |
| `OWL2SubClassToSysML2Specialization` | `SubClassOf`                     | `sysml2`        | `Specialization` (`:>`)     |
| `OWL2ObjectPropertyToSysML2Port`     | `Declaration` (`ObjectProperty`) | `sysml2`        | `PortUsage`                 |
| `OWL2DataPropertyToSysML2Attribute`  | `Declaration` (`DataProperty`)   | `sysml2`        | `AttributeUsage`            |
| `OWL2ClassToModelicaModel`           | `Declaration` (`Class`)          | `modelica`      | `ClassDefinition` (`model`) |
