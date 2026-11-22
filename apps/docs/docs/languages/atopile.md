---
title: "atopile Code-First Hardware Design (.ato)"
description: "The @modelscript/atopile package provides native parsing, hierarchical netlist elaboration, physical tolerance UQ, static diagnostics, and linear-memory DAE lowering for atopile (.ato) electronic hardware designs."
---

# atopile Code-First Hardware Design (`.ato`)

The `@modelscript/atopile` package (`languages/atopile`) provides native support for **atopile** (`.ato`) code-first electronic hardware and PCB design files. It compiles `.ato` modules, interfaces, electrical signals, and physical value tolerances directly into elaborated netlists, linear-memory `DAEBuilder` circuit equations, and Monte Carlo tolerance uncertainty analyses.

---

## Supported File Formats

| Extension | Format         | Description                                                                                                                         |
| :-------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `.ato`    | atopile Source | Declarative hardware modules, `component` and `interface` blocks, signal connections (`~`), and physical quantities with tolerances |

---

## Capabilities

- **Native Parser & Physical Value Algebra (`parseAtopile`, `parseAtoPhysicalValue`)**: Parses `.ato` modules, imports, assertions, signal nets, and physical quantities with SI prefixes and bilateral/percentage tolerances (e.g., `10kohm +/- 1%`, `3.3V +/- 50mV`).
- **Hierarchical Netlist Elaboration (`elaborateAtopile`, `elaborateAtopileProject`)**: Resolves cross-file module imports, instantiates hierarchical sub-modules, merges connected signal nets, and constructs a flat electrical netlist.
- **Linear-Memory DAE Lowering (`lowerAtopileToDAE`)**: Lowers elaborated passive and active circuit topologies directly into `DAEBuilder` Modified Nodal Analysis (MNA) equations for DC operating point, AC frequency response, and transient simulation.
- **Tolerance Uncertainty Quantification (`runAtopileToleranceUQ`)**: Propagates component manufacturing tolerances (`+/- %`) through the lowered circuit DAE to evaluate worst-case and statistical output bounds.
- **Static Diagnostics (`lintAtopile`)**: Validates syntax (`A1001`), unresolved module/signal references (`A2001`), duplicate declarations (`A2002`), and physical unit/constraint mismatches (`A3001`).
- **Workspace Indexing (`indexAtopileFile`)**: Indexes `.ato` modules, interfaces, and components into ModelScript's unified `WorkspaceIndex`.

---

## Programmatic TypeScript API

```typescript
import {
  elaborateAtopile,
  lintAtopile,
  lowerAtopileToDAE,
  parseAtopile,
  runAtopileToleranceUQ,
} from "@modelscript/atopile";

const atoFile = parseAtopile(sourceText);
const diagnostics = lintAtopile(atoFile);
const netlist = elaborateAtopile(atoFile);
const daeResult = lowerAtopileToDAE(atoFile);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="atopile" />
