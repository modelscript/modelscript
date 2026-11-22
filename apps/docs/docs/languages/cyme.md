---
title: "CYME Distribution Network Models (.sxst, .cyme)"
description: "The @modelscript/cyme package provides native parsing, static diagnostics, DAE lowering, OpenDSS projection, and TGG synchronization for Eaton CYME (.sxst, .cyme) distribution feeder models."
---

# CYME Distribution Network Models (`.sxst`, `.cyme`)

The `@modelscript/cyme` package (`languages/cyme`) provides native support for **Eaton CYME** distribution power network files (`.sxst`, `.cyme`). It enables multi-phase distribution feeder parsing, pre-flight topological linting, linear-memory `DAEBuilder` lowering, and projection to **OpenDSS (`.dss`)**.

---

## Supported File Formats

| Extension | Format                  | Description                                                                                                              |
| :-------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `.sxst`   | CYME Self-Contained XML | Distribution feeder topology, nodes, overhead/underground sections, transformers, regulators, and spot/distributed loads |
| `.cyme`   | CYME Network File       | Textual CYME network definitions and equipment catalog references                                                        |

---

## Capabilities

- **Network Parser & Clean-Room Catalog (`parseCyme`, `catalog/`)**: Parses CYME nodes, feeder sections, transformers, switches, capacitors, and spot loads, resolving standard equipment parameter defaults via `resolveCymeSchemaParamDefaults`.
- **Static Diagnostics (`lintCymeNetwork`)**: Validates feeder structure (`CYME1001`), duplicate or dangling node/section references (`CYME2001`, `CYME2002`), electrical rating/impedance bounds (`CYME3001`, `CYME3002`), and radiality/source advisories (`CYME4001`).
- **DAE Arena Lowering (`lowerCymeToDae`)**: Lowers distribution feeder buses, branch admittances, and load injections into `DAEBuilder` for power-flow and dynamic analysis.
- **OpenDSS Projection (`projectCymeToOpenDss`)**: Converts CYME distribution feeders directly into OpenDSS `.dss` circuit scripts.
- **LSP, Indexing & TGG (`indexCymeDocument`, `getCymeDocumentSymbols`, `tgg/`)**: Provides full LSP symbols, diagnostics, workspace indexing, and bidirectional TGG rules.

---

## Programmatic TypeScript API

```typescript
import { lintCymeNetwork, lowerCymeToDae, parseCyme, projectCymeToOpenDss } from "@modelscript/cyme";

const network = parseCyme(sourceText);
const diagnostics = lintCymeNetwork(network);
const dae = lowerCymeToDae(network);
const dssScript = projectCymeToOpenDss(network);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="cyme" />
