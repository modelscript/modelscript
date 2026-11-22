---
title: "GridLAB-D Distribution & Transactive Energy Models (.glm)"
description: "The @modelscript/gridlabd package provides native parsing, static diagnostics, DAE lowering, OpenDSS projection, LSP support, and TGG synchronization for GridLAB-D (.glm) distribution feeder models."
---

# GridLAB-D Distribution & Transactive Energy Models (`.glm`)

The `@modelscript/gridlabd` package (`languages/gridlabd`) provides native support for **GridLAB-D** (`.glm`) distribution power system and transactive energy models. It parses hierarchical `object` blocks, complex phasor values, and physical units, lowers feeders into `DAEBuilder`, and projects circuits to **OpenDSS (`.dss`)**.

---

## Supported File Formats

| Extension | Format               | Description                                                                                                                                            |
| :-------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.glm`    | GridLAB-D Model File | Clock/module directives, `powerflow` objects (`node`, `load`, `overhead_line`, `transformer`, `regulator`, `triplex_meter`, `inverter`), and schedules |

---

## Capabilities

- **GLM Grammar & Unit-Aware Parser (`parser/gridlabd-parser.ts`)**: Parses `.glm` modules, classes, nested objects, complex phasor quantities (`parseGlmComplex`), voltages (`parseGlmVoltageV`), active/reactive power (`parseGlmPowerW`), and line lengths (`parseGlmLengthMiles`).
- **Static Diagnostics (`lintGridlabd`)**: Validates syntax and structural integrity (`GLM1002`), unresolved parent/from/to node references, swing bus presence, and electrical parameter sanity.
- **DAE Arena Lowering (`lowerGridlabdToDae`)**: Lowers GridLAB-D `powerflow` nodes, branches, transformers, and DER inverters into linear-memory `DAEBuilder` equations.
- **OpenDSS Projection (`projectGridlabdToOpenDss`)**: Exports `.glm` distribution feeders into OpenDSS `.dss` circuit scripts.
- **Rich LSP & TGG Support (`lsp.ts`, `indexing.ts`, `tgg/`)**: Provides document symbols (`getGridlabdDocumentSymbols`), hover documentation (`getGridlabdHover`), completions (`getGridlabdCompletions`), workspace indexing, and bidirectional TGG synchronization.

---

## Programmatic TypeScript API

```typescript
import { lintGridlabd, lowerGridlabdToDae, parseGridlabd, projectGridlabdToOpenDss } from "@modelscript/gridlabd";

const model = parseGridlabd(sourceText);
const diagnostics = lintGridlabd(model);
const dae = lowerGridlabdToDae(model);
const dssScript = projectGridlabdToOpenDss(model);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="gridlabd" />
