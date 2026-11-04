<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/genbank

GenBank (`.gb`, `.gbk`) and FASTA (`.fasta`, `.fa`) genomic sequence analysis, plasmid map engineering, restriction endonuclease digestion, 6-frame Open Reading Frame (ORF) discovery, and Codon Adaptation Index (CAI) translational modeling package for ModelScript. Features a zero-regex character-by-character GenBank & FASTA parser and serializer (`parseGenbank`, `parseFasta`, `serializeGenbank`, `serializeFasta`), multi-file workspace indexing (`GenbankWorkspaceIndex`), a biophysics & sequence analysis solver (`analyzeGenbankSequence`), direct linear-memory `DAEBuilder` lowering (`lowerGenbankToDae`), 10 pre-flight sequence & NCBI Table 11 CDS translation lint rules (`M9351`–`M9360`, `lintGenbank`), Modelica 3.x and SBOL3 RDF/XML projections (`genbankToModelica`, `genbankToSbolXml`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex GenBank & FASTA Parser (`parseGenbank`, `parseFasta`, `serializeGenbank`, `serializeFasta`)**: Character-by-character scanner supporting multi-record GenBank flat files (`LOCUS`, `DEFINITION`, `ACCESSION`, `VERSION`, `KEYWORDS`, `SOURCE`, `ORGANISM`, `FEATURES`, `ORIGIN`, `//`) with `CDS`, `promoter`, `RBS`, `terminator`, `rep_origin`, `misc_feature`, `complement(start..end)`, `join(...)`, `/gene`, `/product`, `/translation`, `/codon_start`, and multi-record FASTA (`>id description`).
- **Biophysics, 6-Frame ORF, Restriction Digest & CAI Solver (`analyzeGenbankSequence`)**:
  - Computes GC/AT content, oligonucleotide & long-duplex melting temperature ($T_m$), and anhydrous single-stranded & double-stranded DNA molecular weights (Da).
  - Performs 6-frame Open Reading Frame (`+1, +2, +3, -1, -2, -3`) discovery and NCBI Table 11 translation across sense and reverse-complement strands.
  - Maps restriction endonuclease cleavage sites and computes linear/circular digestion fragment size distributions for `EcoRI`, `BamHI`, `HindIII`, `XbaI`, `SpeI`, `PstI`, `NotI`, and Golden Gate Type IIS `BsaI`.
  - Evaluates Sharp & Li (1987) Codon Adaptation Index ($\text{CAI} = \left(\prod_{k=1}^{L} w_k\right)^{1/L}$) against _E. coli_ highly expressed reference genes.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerGenbankToDae`)**: Compiles plasmid copy numbers ($N_{\text{copy}}$), mRNA concentrations ($[\text{mRNA}_i]$), protein concentrations ($[\text{Protein}_i]$), promoter-dependent transcription rates ($k_{\text{tx},i}$), CAI-weighted translation rates ($k_{\text{tl},i}$), and degradation terms directly into ModelScript's zero-GC WebAssembly `DAEBuilder` arena:
  $$\frac{d[\text{mRNA}_i]}{dt} = k_{\text{tx},i} N_{\text{copy}} - \gamma_{m,i} [\text{mRNA}_i], \qquad \frac{d[\text{Protein}_i]}{dt} = k_{\text{tl},i} [\text{mRNA}_i] - \gamma_{p,i} [\text{Protein}_i]$$
- **10 Pre-Flight Genomic Sequence & CDS Translation Lint Rules (`M9351`–`M9360`, `lintGenbank`)**: Static verification of `LOCUS` vs `ORIGIN` base-pair counts, IUPAC nucleotide/protein alphabets, feature coordinate bounds, sense & complement `CDS` start/stop codons (`ATG`/`GTG`/`TTG` and `TAA`/`TAG`/`TGA`), internal premature stop codons, NCBI Genetic Code Table 11 `/translation` verification, empty `ORIGIN` blocks, inverted non-circular feature spans, and duplicate `LOCUS`/FASTA identifiers.
- **Modelica 3.x & SBOL3 Projections (`genbankToModelica`, `genbankToSbolXml`)**: Synthesizes standalone Modelica 3.x transcription/translation ODE models and SBOL3 RDF/XML component hierarchies annotated with Sequence Ontology (`SO:0000167`, `SO:0000139`, `SO:0000316`, `SO:0000141`, `SO:0000296`) roles.
- **Multi-File Workspace Indexing & LSP (`GenbankWorkspaceIndex`, `getGenbankHover`, `provideGenbankCompletions`)**: Implements `IWorkspaceIndex` across `.gb`, `.gbk`, `.fasta`, and `.fa` files with locus/feature hover cards, restriction site completions, and AST writeback.

---

## Package Structure

| Path                                     | Description                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                                                |
| `src/language.ts`                        | `genbankLanguage` definition and LSP actions (`lint_genbank`, `genbank_analyze`, `genbank_to_dae`, `genbank_to_sbol`) |
| `src/types.ts`                           | `GenbankDocument`, `GenbankRecord`, `GenbankFeature`, `GenbankLocation`, `OrfPrediction`, `SequenceAnalysisResult`    |
| `src/errors.ts`                          | `GenbankErrorCode` diagnostic registry (`M9351`–`M9360`)                                                              |
| `src/parser/genbank-parser.ts`           | `parseGenbank`, `parseFasta`, `serializeGenbank`, `serializeFasta` zero-regex parser and serializer                   |
| `src/parser/index.ts`                    | Parser barrel exports                                                                                                 |
| `src/lints/genbank-linter.ts`            | `lintGenbank` genomic sequence, feature bounds, and NCBI Table 11 CDS translation diagnostic engine                   |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                 |
| `src/solvers/sequence-solver.ts`         | `analyzeGenbankSequence` GC/$T_m$/MW, 6-frame ORF finder, restriction digest mapper, and CAI calculator               |
| `src/solvers/index.ts`                   | Solver barrel exports                                                                                                 |
| `src/dae/genbank-to-dae.ts`              | `lowerGenbankToDae` direct lowering of mRNA/protein expression ODEs into `DAEBuilder` linear memory                   |
| `src/dae/index.ts`                       | DAE lowering barrel exports                                                                                           |
| `src/projections/genbank-projections.ts` | `genbankToModelica` and `genbankToSbolXml` translators to Modelica 3.x and SBOL3 RDF/XML                              |
| `src/projections/index.ts`               | Projections barrel exports                                                                                            |
| `src/workspace-index.ts`                 | `GenbankWorkspaceIndex` implementing `IWorkspaceIndex` across `.gb`, `.gbk`, `.fasta`, and `.fa` files                |
| `src/lsp.ts`                             | LSP validation, document symbols, hover, completion, and action handlers                                              |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                             | Severity  | Description                                                                                                                 |
| ------- | -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `M9351` | `locus-length-mismatch`          | `error`   | `LOCUS` `'locus'` declares length `'declaredLength'` bp, but `ORIGIN` sequence has `'actualLength'` bp.                     |
| `M9352` | `invalid-sequence-character`     | `error`   | Sequence `'locus'` contains non-IUPAC character `'invalidChar'` at position `'position'`.                                   |
| `M9353` | `feature-location-out-of-bounds` | `error`   | Feature `'featureName'` location `'[start..end]'` is out of bounds for sequence `'locus'` of length `'seqLength'` bp.       |
| `M9354` | `cds-missing-start-codon`        | `warning` | Coding sequence (`CDS`) `'cdsName'` begins with `'actualCodon'` instead of a valid start codon (`'ATG'`, `'GTG'`, `'TTG'`). |
| `M9355` | `cds-missing-stop-codon`         | `warning` | Coding sequence (`CDS`) `'cdsName'` ends with `'actualCodon'` instead of a valid stop codon (`'TAA'`, `'TAG'`, `'TGA'`).    |
| `M9356` | `cds-internal-premature-stop`    | `error`   | Coding sequence (`CDS`) `'cdsName'` contains an internal premature stop codon `'stopCodon'` at codon `'codonIndex'`.        |
| `M9357` | `cds-translation-mismatch`       | `error`   | Coding sequence (`CDS`) `'cdsName'` `/translation` qualifier `'actualTranslation'` does not match `'expectedTranslation'`.  |
| `M9358` | `empty-genbank-origin`           | `error`   | GenBank record `'locus'` has an empty or missing `ORIGIN` nucleotide sequence.                                              |
| `M9359` | `inverted-feature-span`          | `error`   | Feature `'featureName'` in non-circular sequence `'locus'` has inverted span `'[start..end]'` (`'start > end'`).            |
| `M9360` | `duplicate-locus-identifier`     | `error`   | `LOCUS` or FASTA identifier `'locus'` is declared multiple times in the document.                                           |

---

## Programmatic Usage

```typescript
import {
  analyzeGenbankSequence,
  genbankToModelica,
  genbankToSbolXml,
  lintGenbank,
  lowerGenbankToDae,
  parseGenbank,
} from "@modelscript/genbank";

const plasmidGb = `LOCUS       pGFP_Expr                 90 bp    ds-DNA  circular SYN 04-NOV-2026
DEFINITION  Synthetic GFP expression cassette with EcoRI/BamHI cloning sites.
ACCESSION   pGFP_Expr
VERSION     pGFP_Expr.1
FEATURES             Location/Qualifiers
     promoter        1..12
                     /label="pConst"
     RBS             13..24
                     /label="rbs_B0034"
     CDS             25..72
                     /gene="gfp_mini"
                     /product="Mini GFP reporter"
                     /codon_start=1
                     /translation="MSKGEELFTGVVPIL"
     terminator      73..90
                     /label="term_B0015"
ORIGIN
        1 gaattcttga caaagaggag aaatatgtct aaaggtgaag aactgttcac cggtgttgtt
       61 ccgatcctgt aaggatccaa gctttctaga
//`;

const doc = parseGenbank(plasmidGb, "pGFP_Expr.gb");
const diagnostics = lintGenbank(doc);
const analysis = analyzeGenbankSequence(doc);
const dae = lowerGenbankToDae(doc);
const modelicaCode = genbankToModelica(doc, "pGFP_Expr");
const sbolXml = genbankToSbolXml(doc);
```

---

## Scripts

| Command             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                       |
| `npm test`          | Run GenBank/FASTA parser, linter, ORF/restriction solver, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                |
| `npm run clean`     | Remove `dist/` build artifacts                                                      |
