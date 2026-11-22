---
title: "LAS Well Log ASCII Standard (.las)"
description: "The @modelscript/las package provides native parsing, IndexedDataset conversion, Modelica table export, and structural diagnostics for CWLS LAS 2.0/3.0 well log ASCII files."
---

# LAS Well Log ASCII Standard (`.las`)

The `@modelscript/las` package (`languages/las`) provides native **Pre-Alpha** support for **CWLS Log ASCII Standard (LAS)** well-logging files (`.las`). It parses well header, curve information, parameter, and ASCII log data sections into typed structures, converts logs to and from `IndexedDataset`, and exports curve tables to Modelica.

---

## Supported File Formats

| Extension | Format              | Description                                                                                                                       |
| :-------- | :------------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| `.las`    | CWLS Well Log ASCII | Structured petrophysical well-log sections (`~V` Version, `~W` Well, `~C` Curve, `~P` Parameter, `~O` Other, `~A` ASCII Log Data) |

---

## Capabilities

- **LAS Document Parser (`parseLas`)**: Parses version, well metadata, curve mnemonics/units, parameter blocks, null sentinel values, and tabular depth/time-indexed ASCII log curves.
- **Dataset Interoperability (`lasToDataset`, `datasetToLas`)**: Converts parsed `.las` well logs bidirectionally into ModelScript `IndexedDataset` structures for visualization, statistical processing, and subsurface workflows.
- **Modelica Export (`parseLasToModelica`)**: Projects well-log curves into Modelica lookup table packages for coupled wellbore and reservoir DAE simulations.
- **Structural Diagnostics (`lintLas`)**: Validates required sections, version metadata, curve-column alignment, and numeric data integrity (`LAS1001`–`LAS1007`).

---

## Programmatic TypeScript API

```typescript
import { datasetToLas, lasToDataset, lintLas, parseLas, parseLasToModelica } from "@modelscript/las";

const doc = parseLas(sourceText);
const diagnostics = lintLas(sourceText);
const dataset = lasToDataset(doc);
const modelicaPkg = parseLasToModelica(sourceText, "WellLogData");
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="las" />
