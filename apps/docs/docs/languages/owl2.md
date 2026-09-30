# OWL2 Ontologies & Taxonomies

ModelScript supports the W3C **OWL 2 Web Ontology Language (OWL2)** Functional-Style Syntax under `languages/owl2/`.

---

## Why Ontologies in Engineering Compilers?

Complex engineering enterprises face severe vocabulary mismatch: electrical, software, and mechanical teams often use different names for the same subsystem, or contradictory definitions for redundancy and safety classifications.

By incorporating OWL2 directly into the compiler:

- Engineering taxonomies are formally parsed into the SymbolIndex.
- Description Logic (DL) reasoning verifies concept subsumption and disjointness at compile time.
- System architectures are checked against domain ontologies before simulation begins.

---

## Example OWL2 Ontology

```owl
Prefix(:=<http://modelscript.org/ontologies/aerospace#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)

Ontology(<http://modelscript.org/ontologies/aerospace>
  Declaration(Class(:FlightCriticalSystem))
  Declaration(Class(:Actuator))
  Declaration(Class(:DualRedundantActuator))

  SubClassOf(:DualRedundantActuator :Actuator)
  SubClassOf(:DualRedundantActuator :FlightCriticalSystem)

  DisjointClasses(:SinglePointFailureComponent :FlightCriticalSystem)
)
```

---

## Reasoning with `OntologyTheoryOracle`

The `OntologyTheoryOracle` in `@modelscript/runtime/formal` connects OWL2 axioms into Nelson-Oppen theory combination:

- **Subsumption**: Verifies whether a declared component instance $A$ satisfies concept requirement $C$ ($A \sqsubseteq C$).
- **Disjointness**: Identifies architectural violations where a single component mistakenly inherits from mutually disjoint classes.
