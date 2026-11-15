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

For every transcriptional unit ending in a coding sequence $P_i$ regulated by a set of transcriptional activators $\mathcal{A}_i$ and repressors $\mathcal{R}_i$, `@modelscript/sbol` synthesizes coupled mRNA and protein concentration ODEs using cooperative Hill kinetics, balancing basal and regulated synthesis against first-order degradation and growth dilution:

$$\frac{d[P_i]}{dt} = \alpha_{0,i} + \alpha_i \left(\prod_{A \in \mathcal{A}_i} \frac{[A]^{n_A}}{K_A^{n_A} + [A]^{n_A}}\right) \left(\prod_{R \in \mathcal{R}_i} \frac{K_R^{m_R}}{K_R^{m_R} + [R]^{m_R}}\right) - \gamma_i [P_i]$$

| Symbol                         | Meaning                                                                                        | Units / Domain                           |
| :----------------------------- | :--------------------------------------------------------------------------------------------- | :--------------------------------------- |
| $[P_i]$                        | Concentration of expressed protein or reporter species $i$                                     | $\text{nM}$, $\ge 0$                     |
| $t$                            | Simulation time                                                                                | $\text{min}$, $\ge 0$                    |
| $\alpha_{0,i}$                 | Basal (leaky) promoter expression rate                                                         | $\text{nM}\cdot\text{min}^{-1}$, $\ge 0$ |
| $\alpha_i$                     | Maximum regulated synthesis rate                                                               | $\text{nM}\cdot\text{min}^{-1}$, $\ge 0$ |
| $\mathcal{A}_i, \mathcal{R}_i$ | Sets of transcriptional activators and repressors for $P_i$                                    | finite species sets                      |
| $[A], [R]$                     | Concentrations of activator $A$ and repressor $R$                                              | $\text{nM}$, $\ge 0$                     |
| $K_A, K_R$                     | Half-maximal dissociation constants for $A$ and $R$                                            | $\text{nM}$, $> 0$                       |
| $n_A, m_R$                     | Hill cooperativity coefficients for $A$ and $R$                                                | dimensionless, $> 0$                     |
| $\gamma_i$                     | Combined proteolytic degradation and cell-growth dilution rate ($\gamma_{\text{deg},i} + \mu$) | $\text{min}^{-1}$, $> 0$                 |

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

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="sbol" />
