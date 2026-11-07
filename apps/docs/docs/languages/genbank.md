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

Given a nucleotide sequence $S = s_1 s_2 \dots s_L \in \{\text{A}, \text{C}, \text{G}, \text{T/U}\}^L$, the GC fraction $f_{\text{GC}}$ and salt-adjusted Marmur-Doty / SantaLucia melting temperature $T_m$ ($[\text{Na}^+] = 50\text{ mM}$) are:

$$
f_{\text{GC}} = \frac{N_{\text{G}} + N_{\text{C}}}{L}, \qquad
T_m = \begin{cases}
  2(N_{\text{A}} + N_{\text{T}}) + 4(N_{\text{G}} + N_{\text{C}}) & \text{if } L < 14, \\
  64.9 + 41.0 \left(\dfrac{N_{\text{G}} + N_{\text{C}} - 16.4}{L}\right) & \text{if } L \ge 14.
\end{cases}
$$

For a coding sequence (`CDS`) of $K$ sense codons $c_1, \dots, c_K$, let $f(c_k)$ be the reference frequency of codon $c_k$ in highly expressed host genes and $\max_{c \in \text{Syn}(a_k)} f(c)$ be the maximum frequency among synonymous codons encoding amino acid $a_k$. Sharp & Li's **Codon Adaptation Index ($\text{CAI}$)** is the geometric mean of relative adaptiveness weights $w_k$:

$$
w_k = \frac{f(c_k)}{\max_{c \in \text{Syn}(a_k)} f(c)}, \qquad \text{CAI} = \left(\prod_{k=1}^K w_k\right)^{1/K} = \exp\!\left(\frac{1}{K} \sum_{k=1}^K \ln w_k\right) \in (0, 1]
$$

### 2. Transcriptional & Translational Gene Expression ODEs

Each annotated `CDS` $i$ driven by an upstream `promoter` and ribosome binding site (`RBS`) is lowered into coupled mRNA ($m_i$) and protein ($p_i$) dynamical equations with Hill regulatory activation/repression and ribosome elongation rate scaled by $\text{CAI}_i$:

$$
\frac{dm_i}{dt} = \alpha_{0,i} + \alpha_i \frac{u_i^{n_i}}{K_i^{n_i} + u_i^{n_i}} - \gamma_{m,i}\, m_i, \qquad
\frac{dp_i}{dt} = k_{\text{tl},i}(\text{CAI}_i)\, m_i - (\gamma_{p,i} + \mu)\, p_i
$$

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
