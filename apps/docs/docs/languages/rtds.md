---
title: "RTDS RSCAD Real-Time Digital Simulator Drafts (.dft, .rtds)"
description: "The @modelscript/rtds package provides native parsing, clean-room EMT component catalogs, static diagnostics, DAE lowering, ATP-EMTP projection, and TGG synchronization for RTDS RSCAD (.dft, .rtds) drafts."
---

# RTDS RSCAD Real-Time Digital Simulator Drafts (`.dft`, `.rtds`)

The `@modelscript/rtds` package (`languages/rtds`) provides native support for **RTDS Technologies RSCAD** real-time electromagnetic transient (EMT) hardware-in-the-loop draft files (`.dft`, `.rtds`). It parses subsystem components, control blocks, and time-step settings, lowers circuits into `DAEBuilder`, and projects drafts to **ATP-EMTP (`.atp`)**.

---

## Supported File Formats

| Extension | Format           | Description                                                                                                   |
| :-------- | :--------------- | :------------------------------------------------------------------------------------------------------------ |
| `.dft`    | RSCAD Draft File | Real-time EMT power network and control schematic hierarchy, time-step configuration, and component instances |
| `.rtds`   | RTDS Case File   | Textual RTDS/RSCAD circuit and subsystem definitions                                                          |

---

## Capabilities

- **RSCAD Draft Parser (`parseRtdsDraft`)**: Parses RSCAD draft headers, simulation time steps (`dt`), power-system apparatus, and control blocks into a typed `RtdsDraft` AST.
- **Clean-Room EMT Library & WASM Loader (`catalog/`)**: Provides clean-room RTDS component schemas (`getRtdsSchemasFromLibraries`, `lookupRtdsModelSchema`) and WASM EMT kernel instantiation (`instantiateRtdsWasmModel`).
- **Static Diagnostics (`lintRtdsDraft`)**: Validates draft syntax and time-step constraints (`RTDS1001`, `RTDS1002`), unresolved or duplicate component/node references (`RTDS2001`, `RTDS2002`), electrical rating checks (`RTDS3001`), and real-time subsystem partitioning advisories (`RTDS4001`).
- **DAE Arena Lowering (`lowerRtdsToDae`)**: Lowers RTDS EMT circuits and control blocks into linear-memory `DAEBuilder` equations with schema parameter defaults (`resolveRtdsSchemaParamDefaults`).
- **ATP-EMTP Projection (`projectRtdsToAtp`)**: Exports RTDS draft networks directly into ATP-EMTP `.atp` card decks.
- **LSP, Indexing & TGG (`indexRtdsDocument`, `getRtdsDocumentSymbols`, `tgg/`)**: Provides workspace indexing, LSP symbols/diagnostics, and bidirectional TGG synchronization.

---

## Programmatic TypeScript API

```typescript
import { lintRtdsDraft, lowerRtdsToDae, parseRtdsDraft, projectRtdsToAtp } from "@modelscript/rtds";

const draft = parseRtdsDraft(sourceText);
const diagnostics = lintRtdsDraft(draft);
const dae = lowerRtdsToDae(draft);
const atpDeck = projectRtdsToAtp(draft);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="rtds" />
