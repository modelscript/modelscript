---
title: SBOL3 Synthetic Biology Genetic Circuits (.sbol, .ttl, .rdf)
description: Native WebAssembly parsing, Sequence Ontology (SO) and Systems Biology Ontology (SBO) genetic circuit verification, Hill-function ODE simulation, DAEBuilder lowering, and SBML / Modelica projections for SBOL 3.x.
---

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

`@modelscript/sbol` parses hierarchical `sbol:Component` definitions, `sbol:SubComponent` instances, `sbol:SequenceConstraint` ordering rules (`precedes`, `sameOrientationAs`, `oppositeOrientationAs`), and regulatory `sbol:Interaction` graphs:

| Ontology Term         | Identifier    | Biological Role                                                    | Mathematical Lowering                                            |
| :-------------------- | :------------ | :----------------------------------------------------------------- | :--------------------------------------------------------------- |
| Promoter              | `SO:0000167`  | Transcriptional initiation site regulated by transcription factors | Basal rate $\alpha_{0,i}$ + inducible Hill fractional activation |
| Ribosome Binding Site | `SO:0000139`  | Translational initiation sequence (Shine-Dalgarno / Kozak)         | Translational gain multiplier on mRNA expression                 |
| Coding Sequence (CDS) | `SO:0000316`  | Open reading frame encoding a protein or reporter species $P_i$    | Continuous state variable $[P_i](t)$ in `DAEBuilder`             |
| Terminator            | `SO:0000141`  | Hairpin transcriptional termination boundary                       | Transcriptional unit boundary verification                       |
| Stimulation           | `SBO:0000170` | Transcriptional activation by activator $A$ (`SBO:0000459`)        | Cooperative activation term $[A]^n / (K_A^n + [A]^n)$            |
| Inhibition            | `SBO:0000169` | Transcriptional repression by repressor $R$ (`SBO:0000020`)        | Cooperative repression term $K_R^m / (K_R^m + [R]^m)$            |

### 2. Hill-Function Genetic Circuit ODE Solver

For every transcriptional unit ending in a coding sequence $P_i$ regulated by a set of transcriptional activators $\mathcal{A}_i$ and repressors $\mathcal{R}_i$, `@modelscript/sbol` synthesizes coupled mRNA and protein concentration ODEs using cooperative Hill kinetics:

$$\frac{d[P_i]}{dt} = \alpha_{0,i} + \alpha_i \left(\prod_{A \in \mathcal{A}_i} \frac{[A]^{n_A}}{K_A^{n_A} + [A]^{n_A}}\right) \left(\prod_{R \in \mathcal{R}_i} \frac{K_R^{m_R}}{K_R^{m_R} + [R]^{m_R}}\right) - \gamma_i [P_i]$$

where:

- $\alpha_{0,i}$ is the basal (leaky) promoter expression rate ($\text{nM}\cdot\text{min}^{-1}$),
- $\alpha_i$ is the maximum regulated synthesis rate ($\text{nM}\cdot\text{min}^{-1}$),
- $K_A, K_R$ are the half-maximal dissociation constants ($\text{nM}$),
- $n_A, m_R$ are the Hill cooperativity coefficients, and
- $\gamma_i = \gamma_{\text{deg},i} + \mu$ is the combined proteolytic degradation and cell-growth dilution rate ($\text{min}^{-1}$).

This formulation directly supports multistable genetic toggle switches (Gardner et al.), three-node repressilator ring oscillators (Elowitz & Leibler), and AND/NAND logic gates.

### 3. DAE Lowering & SBML / Modelica Projection

- **`DAEBuilder` Linear Memory Lowering**: Registers each expressed protein/RNA species as a continuous state variable (`VarType.Real`, `Variability.Continuous`) and lowers its basal, Hill-activation, Hill-repression, and dilution parameters (`Variability.Parameter`) and rate equations into `@modelscript/runtime`'s `DAEBuilder` arena.
- **SBML Level 3 & Modelica 3.x Export**: Projects genetic circuits into SBML Level 3 Core (`sbolToSbml`) with `SBO` annotations and into equation-based Modelica 3.x models (`sbolToModelica`).

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

# Inspect transcriptional units and simulate Hill-function ODE trajectories
msx domain sbol inspect GeneticToggleSwitch.sbol
```

---

## Programmatic TypeScript SDK

```typescript
import { parseSbolModel, simulateSbolCircuit, lowerSbolToDae, sbolToSbml, sbolToModelica } from "@modelscript/sbol";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseSbolModel(sbolXmlSource);

// Simulate cooperative Hill kinetics over 300 minutes
const trajectory = simulateSbolCircuit(model, 300.0, 0.5);

// Lower into the WebAssembly DAEBuilder arena or project to SBML / Modelica
const builder = new DAEBuilder();
lowerSbolToDae(model, builder);
const sbmlXml = sbolToSbml(model);
const modelicaCode = sbolToModelica(model);
```
