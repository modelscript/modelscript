<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/sbol

Synthetic Biology Open Language (SBOL3 RDF/XML & Turtle) genetic circuit design, Sequence Ontology (SO) feature verification, and transcriptional regulatory network modeling package (`.sbol`, `.ttl`) for ModelScript. Features a zero-regex SBOL3 XML/RDF and Turtle parser & serializer (`parseSbol`, `serializeSbol`), multi-file workspace indexing (`SbolWorkspaceIndex`), a deterministic RK4 Hill-function transcriptional activation/repression ODE solver (`solveGeneticCircuit`), direct linear-memory `DAEBuilder` lowering (`lowerSbolToDae`), 10 pre-flight genetic circuit & ontology lint rules (`M9501`–`M9510`, `lintSbol`), Modelica 3.x and SBML Level 3 projections (`sbolToModelica`, `sbolToSbmlXml`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex SBOL3 RDF/XML & Turtle Parser (`parseSbol`, `serializeSbol`)**: Character-by-character scanner supporting both SBOL3 RDF/XML (`<sbol:Component>`, `<sbol:Sequence>`, `<sbol:SubComponent>`, `<sbol:SequenceFeature>`, `<sbol:Range>`, `<sbol:Constraint>`, `<sbol:Interaction>`, `<sbol:Participation>`) and concise SBOL3 Turtle (`.ttl`) syntax with automatic Sequence Ontology (`SO:0000167` promoter, `SO:0000139` RBS, `SO:0000316` CDS, `SO:0000141` terminator, `SO:0000804` engineered region) and Systems Biology Ontology (`SBO:0000169` inhibition, `SBO:0000170` stimulation, `SBO:0000589` genetic production, `SBO:0000179` degradation) normalization.
- **Deterministic RK4 Hill-Function Genetic Circuit Solver (`solveGeneticCircuit`)**: Synthesizes and integrates coupled transcriptional regulatory ODEs across synthetic genetic circuits such as the Elowitz-Leibler Repressilator and Collins Toggle Switch:
  $$\frac{d[P_i]}{dt} = \alpha_{0,i} + \alpha_i \prod_{a \in \text{Act}(i)} \frac{[P_a]^{n_a}}{K_a^{n_a} + [P_a]^{n_a}} \prod_{r \in \text{Rep}(i)} \frac{K_r^{n_r}}{K_r^{n_r} + [P_r]^{n_r}} - \gamma_i [P_i]$$
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerSbolToDae`)**: Compiles protein concentration state variables ($P_i$), basal and maximal transcription rates ($\alpha_{0,i}, \alpha_i$), Hill cooperativity factors ($K, n$), synthesis fluxes ($v_{\text{synth},i}$), and first-order degradation terms directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Genetic Circuit & Sequence Ontology Lint Rules (`M9501`–`M9510`, `lintSbol`)**: Static verification of IUPAC nucleotide alphabets, sequence feature coordinate bounds, CDS triplet codon lengths and start/stop codons, unresolved `SubComponent` references, transcriptional unit ordering (terminator upstream of promoter without CDS), dangling interaction participants, missing SBO participation roles, circular `SubComponent` containment hierarchies, duplicate `displayId` declarations, and bacterial CDS units missing upstream ribosome binding sites (`SO:0000139`).
- **Modelica 3.x & SBML Level 3 Projections (`sbolToModelica`, `sbolToSbmlXml`)**: Synthesizes standalone Modelica 3.x ODE models and SBML Level 3 Version 2 biochemical reaction networks from SBOL3 genetic circuit topologies.
- **Multi-File Workspace Indexing & LSP (`SbolWorkspaceIndex`, `getSbolHover`, `provideSbolCompletions`)**: Implements `IWorkspaceIndex` across `.sbol` and `.ttl` files with component/sequence/interaction hover cards, ontology completions, and AST writeback.

---

## Package Structure

| Path                                    | Description                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                                |
| `src/language.ts`                       | `sbolLanguage` definition and LSP actions (`lint_sbol`, `sbol_simulate`, `sbol_to_dae`, `sbol_to_modelica`)           |
| `src/types.ts`                          | `SbolDocument`, `SbolComponent`, `SbolSequence`, `SbolFeature`, `SbolSubComponent`, `SbolInteraction`, and SO/SBO IDs |
| `src/errors.ts`                         | `SbolErrorCode` diagnostic registry (`M9501`–`M9510`)                                                                 |
| `src/parser/sbol-parser.ts`             | `parseSbol` and `serializeSbol` zero-regex SBOL3 RDF/XML & Turtle parser and serializer                               |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                                 |
| `src/lints/sbol-linter.ts`              | `lintSbol` genetic circuit, Sequence Ontology, and SBO interaction diagnostic engine                                  |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                                 |
| `src/solvers/genetic-circuit-solver.ts` | `solveGeneticCircuit` RK4 Hill-function transcriptional regulatory network ODE solver                                 |
| `src/solvers/index.ts`                  | Solver barrel exports                                                                                                 |
| `src/dae/sbol-to-dae.ts`                | `lowerSbolToDae` direct lowering of Hill regulatory ODEs into `DAEBuilder` linear memory                              |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                           |
| `src/projections/sbol-projections.ts`   | `sbolToModelica` and `sbolToSbmlXml` translators to Modelica 3.x and SBML Level 3                                     |
| `src/projections/index.ts`              | Projections barrel exports                                                                                            |
| `src/workspace-index.ts`                | `SbolWorkspaceIndex` implementing `IWorkspaceIndex` across `.sbol` and `.ttl` files                                   |
| `src/lsp.ts`                            | LSP validation, document symbols, hover, completion, and action handlers                                              |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                 | Severity  | Description                                                                                                             |
| ------- | ------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `M9501` | `invalid-nucleotide-sequence`        | `error`   | Sequence `'seqId'` contains characters outside the IUPAC nucleic acid alphabet (`'A, C, G, T, U, N'`).                  |
| `M9502` | `sequence-range-out-of-bounds`       | `error`   | Feature `'featureId'` location `'[start..end]'` exceeds sequence `'seqId'` length `'seqLength'`.                        |
| `M9503` | `cds-length-not-multiple-of-three`   | `warning` | Coding sequence (CDS) `'cdsId'` nucleotide length (`'length'`) is not divisible by 3 or lacks a valid start/stop codon. |
| `M9504` | `unresolved-subcomponent-reference`  | `error`   | `SubComponent` `'subId'` in `'compId'` references undefined `Component` `'instanceOf'`.                                 |
| `M9505` | `invalid-transcriptional-unit-order` | `error`   | Engineered region `'compId'` places terminator `'termId'` upstream of promoter `'promId'` without an intervening CDS.   |
| `M9506` | `dangling-interaction-participant`   | `error`   | Interaction `'intId'` participant references undefined component `'participantId'`.                                     |
| `M9507` | `missing-interaction-role`           | `warning` | Participant `'participantId'` in interaction `'intId'` lacks a Systems Biology Ontology (SBO) role.                     |
| `M9508` | `circular-component-hierarchy`       | `error`   | `SubComponent` hierarchy contains a circular containment reference involving `'compId'`.                                |
| `M9509` | `duplicate-display-id`               | `error`   | `displayId` `'id'` is declared multiple times within the `'namespace'` namespace.                                       |
| `M9510` | `missing-cds-ribosome-binding-site`  | `warning` | Bacterial transcriptional unit `'compId'` contains CDS `'cdsId'` without an upstream RBS (`'SO:0000139'`).              |

---

## Programmatic Usage

```typescript
import {
  lintSbol,
  lowerSbolToDae,
  parseSbol,
  sbolToModelica,
  sbolToSbmlXml,
  solveGeneticCircuit,
} from "@modelscript/sbol";

const repressilatorTtl = `
@prefix sbol: <http://sbols.org/v3#> .
@prefix SO: <https://identifiers.org/SO:> .
@prefix SBO: <https://identifiers.org/SBO:> .
@prefix : <http://modelscript.org/sbol/repressilator#> .

:TetR a sbol:Component ; sbol:displayId "TetR" ; sbol:role SO:0000316 ; sbol:initialConcentration 2.0 .
:cI   a sbol:Component ; sbol:displayId "cI"   ; sbol:role SO:0000316 ; sbol:initialConcentration 0.1 .
:LacI a sbol:Component ; sbol:displayId "LacI" ; sbol:role SO:0000316 ; sbol:initialConcentration 0.5 .

:rep_TetR_cI a sbol:Interaction ;
  sbol:displayId "rep_TetR_cI" ;
  sbol:type SBO:0000169 ;
  sbol:K 1.0 ; sbol:n 3.0 ; sbol:alpha 12.0 ;
  sbol:hasParticipation [ sbol:participant :TetR ; sbol:role SBO:0000020 ] ;
  sbol:hasParticipation [ sbol:participant :cI   ; sbol:role SBO:0000642 ] .

:rep_cI_LacI a sbol:Interaction ;
  sbol:displayId "rep_cI_LacI" ;
  sbol:type SBO:0000169 ;
  sbol:K 1.0 ; sbol:n 3.0 ; sbol:alpha 12.0 ;
  sbol:hasParticipation [ sbol:participant :cI   ; sbol:role SBO:0000020 ] ;
  sbol:hasParticipation [ sbol:participant :LacI ; sbol:role SBO:0000642 ] .

:rep_LacI_TetR a sbol:Interaction ;
  sbol:displayId "rep_LacI_TetR" ;
  sbol:type SBO:0000169 ;
  sbol:K 1.0 ; sbol:n 3.0 ; sbol:alpha 12.0 ;
  sbol:hasParticipation [ sbol:participant :LacI ; sbol:role SBO:0000020 ] ;
  sbol:hasParticipation [ sbol:participant :TetR ; sbol:role SBO:0000642 ] .
`;

const doc = parseSbol(repressilatorTtl, "repressilator.ttl");
const diagnostics = lintSbol(doc);
const sim = solveGeneticCircuit(doc, { duration: 40.0, timeStep: 0.05 });
const dae = lowerSbolToDae(doc);
const modelicaCode = sbolToModelica(doc, "Repressilator");
const sbmlXml = sbolToSbmlXml(doc, "Repressilator");
```

---

## Scripts

| Command             | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                   |
| `npm test`          | Run SBOL3 XML/Turtle parser, linter, Hill ODE solver, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                           |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                            |
| `npm run clean`     | Remove `dist/` build artifacts                                                  |
