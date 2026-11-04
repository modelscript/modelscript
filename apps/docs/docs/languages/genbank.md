# GenBank & FASTA Nucleotide Sequences (`.gb`, `.gbk`, `.fasta`, `.fa`)

`@modelscript/genbank` (`languages/genbank`) provides native WebAssembly GLR parsing, NCBI genetic code translation verification, 6-frame Open Reading Frame (ORF) discovery, restriction endonuclease digestion mapping, Codon Adaptation Index ($\text{CAI}$) calculation, `DAEBuilder` transcriptional/translational lowering, and SBOL3 / Modelica projections for **NCBI GenBank** and **FASTA** plasmid, viral, and genomic sequence files.

---

## Supported Extensions & Standards

| Extension                 | Format                 | Description                                                                                           |
| :------------------------ | :--------------------- | :---------------------------------------------------------------------------------------------------- |
| `.gb`, `.gbk`, `.genbank` | NCBI GenBank Flat File | Annotated nucleotide sequence record (`LOCUS`, `DEFINITION`, `ACCESSION`, `FEATURES`, `ORIGIN`, `//`) |
| `.fasta`, `.fa`, `.fna`   | FASTA Sequence         | Multi-sequence nucleotide or peptide FASTA records (`>header`)                                        |

---

## Key Capabilities

### 1. Annotated Feature Tables & Location Operators

- Parses `LOCUS` topology (`linear` / `circular`), molecular type (`DNA`, `RNA`, `mRNA`), and `FEATURES` annotations (`CDS`, `promoter`, `RBS`, `terminator`, `gene`, `rep_origin`, `misc_feature`) with `complement(...)`, `join(...)`, and `/translation` qualifiers.

### 2. Sequence Analysis, ORFs, Restriction Maps & CAI

- **6-Frame ORF Finder**: Identifies start (`ATG`, `GTG`, `TTG`) to stop (`TAA`, `TAG`, `TGA`) open reading frames across forward and reverse-complement strands.
- **Restriction Enzyme Mapper**: Computes cleavage coordinates and fragment lengths for common Type II endonucleases (`EcoRI`, `BamHI`, `HindIII`, `NotI`, `XbaI`, `SpeI`, `PstI`, `BsaI`).
- **GC Content, Melting Temperature ($T_m$) & CAI**: Evaluates GC fraction, primer $T_m$, and _E. coli_ / mammalian codon usage bias.

### 3. SBOL3, Modelica & DAE Lowering

- Projects annotated `CDS`, `promoter`, `RBS`, and `terminator` features into **SBOL3** genetic circuit components (`genbankToSbol`), **Modelica 3.x** gene expression ODEs (`genbankToModelica`), and `@modelscript/runtime`'s `DAEBuilder`.

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
```
