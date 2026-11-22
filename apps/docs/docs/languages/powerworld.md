---
title: "PowerWorld Simulator AUX & IEEE CDF (.aux, .cdf)"
description: "The @modelscript/powerworld package provides native parsing for PowerWorld .aux and IEEE Common Data Format (.cdf) power-flow cases, clean-room dynamic model catalogs, PSS/E RAW projection, and DAE lowering."
---

# PowerWorld Simulator AUX & IEEE CDF (`.aux`, `.cdf`)

The `@modelscript/powerworld` package (`languages/powerworld`) provides native support for **PowerWorld Simulator** Auxiliary (`.aux`) files and **IEEE Common Data Format (CDF)** (`.cdf`) power-flow cases. It combines a native grammar parser, clean-room standard dynamic model schemas with WASM execution loaders, static electrical diagnostics, **PSS/E `.raw`** projection, and linear-memory `DAEBuilder` lowering.

---

## Supported File Formats

| Extension | Format                    | Description                                                                                                              |
| :-------- | :------------------------ | :----------------------------------------------------------------------------------------------------------------------- |
| `.aux`    | PowerWorld Auxiliary File | Declarative `DATA (...)` blocks for buses, generators, branches, loads, shunts, areas, contingencies, and dynamic models |
| `.cdf`    | IEEE Common Data Format   | Classic IEEE bus/branch power-flow interchange card deck (`BUS DATA FOLLOWS`, `BRANCH DATA FOLLOWS`)                     |

---

## Capabilities

- **AUX & IEEE CDF Parsers (`parsePowerWorldAux`, `parseIeeeCdf`, `projectToIeeeCdf`)**: Parses PowerWorld `.aux` data/script sections and IEEE CDF card decks into a unified `PowerWorldAuxModel`, with round-trip IEEE CDF export.
- **Clean-Room Dynamic Model Catalog & WASM Loader (`catalog/`)**: Includes clean-room schemas (`buildPowerWorldCleanroomSchemas`, `lookupPowerWorldModelSchema`), SVG block diagram synthesis (`generatePowerWorldBlockSvg`), and WASM model instantiation (`instantiatePowerWorldWasmModel`).
- **Static Diagnostics (`lintPowerWorldAux`)**: Validates bus/branch/generator topology, slack bus presence, impedance sanity, and voltage/reactive limits.
- **DAE Arena Lowering (`lowerPowerWorldToDae`)**: Lowers AC power-flow nodal balance equations and dynamic generator/exciter/governor models into `DAEBuilder`.
- **PSS/E RAW Projection (`projectPowerWorldToPsseRaw`)**: Exports PowerWorld `.aux` / `.cdf` cases directly to Siemens PTI PSS/E `.raw` format.
- **LSP, Indexing & TGG (`lsp.ts`, `indexing.ts`, `tgg/`)**: Provides completions (`getPowerWorldCompletions`), document symbols (`getPowerWorldDocumentSymbols`), diagnostics, workspace indexing, and bidirectional TGG synchronization.

---

## Programmatic TypeScript API

```typescript
import {
  lintPowerWorldAux,
  lowerPowerWorldToDae,
  parseIeeeCdf,
  parsePowerWorldAux,
  projectPowerWorldToPsseRaw,
} from "@modelscript/powerworld";

const model = parsePowerWorldAux(auxSourceText);
const diagnostics = lintPowerWorldAux(model);
const dae = lowerPowerWorldToDae(model);
const psseRaw = projectPowerWorldToPsseRaw(model, 100.0);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="powerworld" />
