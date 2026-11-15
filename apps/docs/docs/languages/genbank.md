---
title: GenBank & FASTA Nucleotide Sequences (.gb, .fasta)
description: Compiler reference for NCBI GenBank (.gb, .gbk) and FASTA (.fasta, .fa) annotated genomic sequences, 6-frame ORF discovery, restriction digestion, CAI, and SBOL3/Modelica projections.
---

# GenBank & FASTA Nucleotide Sequences (`.gb`, `.gbk`, `.fasta`, `.fa`)

`@modelscript/genbank` (`languages/genbank`) provides native WebAssembly GLR parsing, NCBI genetic code translation verification, 6-frame Open Reading Frame (ORF) discovery, restriction endonuclease digestion mapping, Codon Adaptation Index ($\text{CAI}$) calculation, `DAEBuilder` transcriptional/translational lowering, and SBOL3 / Modelica projections for **NCBI GenBank** and **FASTA** plasmid, viral, and genomic sequence files.

---

## Supported Extensions & Standards

| Extension                 | Format                 | Description                                                                                           |
| :------------------------ | :--------------------- | :---------------------------------------------------------------------------------------------------- |
| `.gb`, `.gbk`, `.genbank` | NCBI GenBank Flat File | Annotated nucleotide sequence record (`LOCUS`, `DEFINITION`, `ACCESSION`, `FEATURES`, `ORIGIN`, `//`) |
| `.fasta`, `.fa`, `.fna`   | FASTA Sequence         | Multi-sequence nucleotide or peptide FASTA records (`>header`)                                        |

---

## Governing Mathematical Formulation

### 1. GC Content, Primer Melting Temperature ($T_m$) & Codon Adaptation Index ($\text{CAI}$)

Given a nucleotide sequence $S = s_1 s_2 \dots s_L \in \{\text{A}, \text{C}, \text{G}, \text{T/U}\}^L$, the GC fraction $f_{\text{GC}}$ measures the proportion of guanine and cytosine bases, and the salt-adjusted Marmur-Doty / SantaLucia melting temperature $T_m$ ($[\text{Na}^+] = 50\text{ mM}$) estimates the temperature at which half of the DNA duplex denatures:

$$
f_{\text{GC}} = \frac{N_{\text{G}} + N_{\text{C}}}{L}, \qquad
T_m = \begin{cases}
  2(N_{\text{A}} + N_{\text{T}}) + 4(N_{\text{G}} + N_{\text{C}}) & \text{if } L < 14, \\
  64.9 + 41.0 \left(\dfrac{N_{\text{G}} + N_{\text{C}} - 16.4}{L}\right) & \text{if } L \ge 14.
\end{cases}
$$

| Symbol                                                   | Meaning                                                             | Units / Domain                     |
| :------------------------------------------------------- | :------------------------------------------------------------------ | :--------------------------------- |
| $f_{\text{GC}}$                                          | Guanine-cytosine base fraction                                      | Dimensionless, $\in [0, 1]$        |
| $T_m$                                                    | DNA primer/oligonucleotide melting temperature                      | $^\circ\text{C}$                   |
| $L$                                                      | Total nucleotide sequence length                                    | $\text{nt}$ (positive integer)     |
| $N_{\text{A}}, N_{\text{T}}, N_{\text{G}}, N_{\text{C}}$ | Counts of adenine, thymine (or uracil), guanine, and cytosine bases | Non-negative integers ($\sum = L$) |

For a coding sequence (`CDS`) of $K$ sense codons $c_1, \dots, c_K$, Sharp & Li's **Codon Adaptation Index ($\text{CAI}$)** measures codon usage bias toward highly expressed host genes as the geometric mean of relative adaptiveness weights $w_k$:

$$
w_k = \frac{f(c_k)}{\max_{c \in \text{Syn}(a_k)} f(c)}, \qquad \text{CAI} = \left(\prod_{k=1}^K w_k\right)^{1/K} = \exp\!\left(\frac{1}{K} \sum_{k=1}^K \ln w_k\right) \in (0, 1]
$$

| Symbol            | Meaning                                                                 | Units / Domain              |
| :---------------- | :---------------------------------------------------------------------- | :-------------------------- |
| $w_k$             | Relative adaptiveness weight of codon $c_k$ at position $k$             | Dimensionless, $\in (0, 1]$ |
| $f(c_k)$          | Reference usage frequency of codon $c_k$ in highly expressed host genes | Dimensionless ($> 0$)       |
| $\text{Syn}(a_k)$ | Set of synonymous codons encoding amino acid $a_k$                      | Finite codon set            |
| $K$               | Number of sense codons in the `CDS`                                     | Positive integer            |
| $\text{CAI}$      | Codon Adaptation Index                                                  | Dimensionless, $\in (0, 1]$ |

### 2. Transcriptional & Translational Gene Expression ODEs

Each annotated `CDS` $i$ driven by an upstream `promoter` and ribosome binding site (`RBS`) is lowered into coupled mRNA ($m_i$) and protein ($p_i$) dynamical equations. In plain English, mRNA accumulates from leaky plus Hill-regulated transcription and decays by degradation, while protein is translated at a $\text{CAI}$-weighted rate from mRNA and decays by degradation and cell-growth dilution:

$$
\frac{dm_i}{dt} = \alpha_{0,i} + \alpha_i \frac{u_i^{n_i}}{K_i^{n_i} + u_i^{n_i}} - \gamma_{m,i}\, m_i, \qquad
\frac{dp_i}{dt} = k_{\text{tl},i}(\text{CAI}_i)\, m_i - (\gamma_{p,i} + \mu)\, p_i
$$

| Symbol                          | Meaning                                                          | Units / Domain                                                       |
| :------------------------------ | :--------------------------------------------------------------- | :------------------------------------------------------------------- |
| $m_i, p_i$                      | mRNA and protein concentrations for coding sequence $i$          | $\text{mol}\cdot\text{L}^{-1}$ or $\text{nM}$ ($\mathbb{R}_{\ge 0}$) |
| $t$                             | Simulation time                                                  | $\text{s}$ (or $\text{min}$), $t \ge 0$                              |
| $\alpha_{0,i}, \alpha_i$        | Basal (leaky) and maximal regulated transcription rates          | $\text{conc}\cdot\text{s}^{-1}$ ($\ge 0$)                            |
| $u_i$                           | Upstream transcription factor / regulator concentration          | $\text{conc}$ ($\ge 0$)                                              |
| $K_i, n_i$                      | Hill half-activation constant and Hill cooperativity coefficient | $\text{conc}$ ($> 0$), dimensionless ($> 0$)                         |
| $\gamma_{m,i}, \gamma_{p,i}$    | First-order mRNA and protein degradation rate constants          | $\text{s}^{-1}$ ($\ge 0$)                                            |
| $k_{\text{tl},i}(\text{CAI}_i)$ | $\text{CAI}_i$-scaled translation rate constant                  | $\text{s}^{-1}$ ($\ge 0$)                                            |
| $\mu$                           | Specific cell growth (dilution) rate                             | $\text{s}^{-1}$ ($\ge 0$)                                            |

---

## `DAEBuilder` Arena Lowering & Cross-Language Projections

- **Direct `DAEBuilder` Lowering (`lowerGenbankToDae`)**: Emits mRNA and protein concentrations, promoter Hill kinetics, and $\text{CAI}$-weighted translation rates directly into `@modelscript/runtime`'s `DAEBuilder` arena.
- **SBOL3 Genetic Circuit Projection (`genbankToSbol`)**: Maps GenBank `FEATURES` (`promoter`, `RBS`, `CDS`, `terminator`, `rep_origin`) to Sequence Ontology (`SO:0000167`, `SO:0000139`, `SO:0000316`, `SO:0000141`) `SubComponent` hierarchies in [SBOL3](./sbol.md).
- **Modelica 3.x Projection (`genbankToModelica`)**: Generates synthetic biology ODE blocks in [Modelica](./modelica.md).

---

## Pre-Flight Diagnostics

<LintRules lang="genbank" />

---

## CLI Usage

```bash
# Validate LOCUS length consistency, CDS frame divisibility, and translations
msx lint pUC19_Plasmid.gb

# Parse and inspect GenBank or FASTA records
msx parse pUC19_Plasmid.gb

# Run 6-frame ORF discovery, restriction digestion, and CAI analysis
msx domain genbank inspect pUC19_Plasmid.gb
```

---

## Programmatic TypeScript SDK

```typescript
import {
  analyzeSequence,
  genbankToModelica,
  genbankToSbol,
  lintGenbank,
  lowerGenbankToDae,
  parseGenbank,
} from "@modelscript/genbank";

const record = parseGenbank(gbText);
const diagnostics = lintGenbank(record);
const analysis = analyzeSequence(record);
const dae = lowerGenbankToDae(record);
const sbolDoc = genbankToSbol(record);
const moCode = genbankToModelica(record);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="genbank" />
