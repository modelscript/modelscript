# SBOL3 Synthetic Biology Genetic Circuits (`.sbol`, `.ttl`, `.rdf`)

`@modelscript/sbol` (`languages/sbol`) provides native WebAssembly parsing, Sequence Ontology (`SO`) and Systems Biology Ontology (`SBO`) genetic circuit verification, Hill-function transcriptional activation/repression ODE simulation, `DAEBuilder` lowering, and SBML / Modelica projections for **Synthetic Biology Open Language (SBOL 3.x)** genetic designs.

---

## Supported Extensions & Standards

| Extension               | Format       | Description                                                                                                      |
| :---------------------- | :----------- | :--------------------------------------------------------------------------------------------------------------- |
| `.sbol`, `.rdf`, `.xml` | SBOL RDF/XML | Standard RDF/XML serialization of `sbol:Component`, `sbol:Sequence`, `sbol:SubComponent`, and `sbol:Interaction` |
| `.ttl`                  | SBOL3 Turtle | Compact RDF Turtle representation of SBOL3 genetic circuits and sequence constraints                             |

---

## Key Capabilities

### 1. Genetic Parts, Sequence Constraints & Interactions

- Parses `Component` definitions typed with Sequence Ontology (`SO`) roles:
  - **Promoter (`SO:0000167`)**, **RBS (`SO:0000139`)**, **CDS (`SO:0000316`)**, **Terminator (`SO:0000141`)**, and **Engineered Region (`SO:0000804`)**.
- Extracts `Interaction` and `Participation` graphs typed with Systems Biology Ontology (`SBO`) terms:
  - **Genetic Production (`SBO:0000589`)**, **Transcriptional Stimulation (`SBO:0000170`)**, **Transcriptional Inhibition (`SBO:0000169`)**, and **Degradation (`SBO:0000179`)**.

### 2. Hill-Function Genetic Circuit ODE Solver

- Automatically synthesizes and integrates coupled mRNA and protein concentration ODEs using cooperative Hill kinetics:
  $$\frac{d[P_i]}{dt} = \alpha_{0,i} + \alpha_i \frac{[A]^n}{K_A^n + [A]^n} \cdot \frac{K_R^m}{K_R^m + [R]^m} - \gamma_i [P_i]$$
  supporting toggle switches, repressilators, and inducible biosensors.

### 3. DAE Lowering & SBML / Modelica Projection

- Lowers synthetic genetic circuit dynamics into `@modelscript/runtime`'s `DAEBuilder` arena and exports to **SBML Level 3** (`sbolToSbml`) and **Modelica 3.x** (`sbolToModelica`).

---

## Pre-Flight Diagnostics

<LintRules lang="sbol" />

---

## CLI Usage

```bash
# Validate SO/SBO ontology roles, transcriptional unit ordering, and sequence encoding
msx lint GeneticToggleSwitch.sbol

# Parse and inspect SBOL3 RDF/XML or Turtle circuits
msx parse GeneticToggleSwitch.sbol
```
