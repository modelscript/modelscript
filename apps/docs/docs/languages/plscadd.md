---
title: "PLS-CADD Overhead Transmission Line Design (.pol, .loa, .plscadd)"
description: "The @modelscript/plscadd package provides native parsing, catenary sag-tension & span impedance calculations, static diagnostics, DAE lowering, and TGG synchronization for PLS-CADD overhead line models."
---

# PLS-CADD Overhead Transmission Line Design (`.pol`, `.loa`, `.plscadd`)

The `@modelscript/plscadd` package (`languages/plscadd`) provides native support for **PLS-CADD** overhead transmission line structural and electrical design files (`.pol`, `.loa`, `.plscadd`). It parses tower/pole structures, conductor spans, and weather load cases, computes parabolic sag-tension and span impedance, and lowers transmission line parameters into `DAEBuilder`.

---

## Supported File Formats

| Extension  | Format              | Description                                                                                        |
| :--------- | :------------------ | :------------------------------------------------------------------------------------------------- |
| `.pol`     | PLS-POLE Structure  | Transmission pole/tower coordinates, attachment elevations, and structural geometry                |
| `.loa`     | PLS-CADD Load Case  | Weather, ice, wind, and conductor temperature loading criteria                                     |
| `.plscadd` | PLS-CADD Line Model | Overhead line corridor definition combining structures, conductor sets, spans, and clearance rules |

---

## Capabilities

- **Line & Structure Parser (`parsePlsCadd`)**: Parses structure coordinates, conductor specifications, ruling spans, and weather load cases, alongside built-in clean-room conductor/structure schemas (`registerBuiltInPlsCaddLibrarySync`).
- **Mechanical & Electrical Span Physics (`computeSpanLengthM`, `computeParabolicSagM`, `computeSpanImpedanceOhms`)**: Evaluates 3D span lengths, parabolic conductor sag under tension/weight loading, and positive-sequence span series impedance.
- **Static Diagnostics (`lintPlsCadd`)**: Validates syntax (`PLSCADD1001`), duplicate/missing structure references (`PLSCADD2001`, `PLSCADD2002`), sag/tension/rating limits (`PLSCADD3001`), and ground-clearance/structural checks (`PLSCADD4001`, `PLSCADD4002`).
- **DAE Arena Lowering (`lowerPlsCaddToDae`)**: Lowers overhead line span impedances, thermal ampacity, and sag-clearance constraints into `DAEBuilder` with default schema parameter resolution (`resolvePlsCaddSchemaParamDefaults`).
- **LSP, Indexing & TGG (`indexPlsCaddDocument`, `getPlsCaddDocumentSymbols`, `tgg/`)**: Provides workspace indexing, LSP symbols/diagnostics, and bidirectional TGG rules.

---

## Programmatic TypeScript API

```typescript
import { computeParabolicSagM, lintPlsCadd, lowerPlsCaddToDae, parsePlsCadd } from "@modelscript/plscadd";

const model = parsePlsCadd(sourceText);
const diagnostics = lintPlsCadd(model);
const dae = lowerPlsCaddToDae(model);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="plscadd" />
