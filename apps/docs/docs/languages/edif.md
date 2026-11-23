---
title: "EDIF 2.0.0 (.edf)"
description: "Electronic Design Interchange Format hierarchical netlists"
---

# EDIF 2.0.0 (`.edf`)

**Package:** `@modelscript/edif` · **Maturity:** `Beta` · **Extensions:** `.edf`

**EDIF 2.0.0 (Electronic Design Interchange Format, EIA-548 / IEC 61690-1, 1983)** compiler, linter, hierarchical netlist flattener, DC/logic solver, DAE lowering engine, and LSP support for ModelScript.

## Maturity Tier

**Beta** (`modelscript.tier = "beta"`).

## Capabilities

- **Native WASM GLR Parser (`src/language.ts`, `dist/parser.wasm`)**: Declarative `@modelscript/dsl` grammar covering EDIF 2.0.0 S-expressions (`edif`, `edifVersion`, `edifLevel`, `keywordMap`, `status`, `external`, `library`, `technology`, `cell`, `cellType`, `view`, `viewType`, `interface`, `port`, `direction`, `contents`, `instance`, `viewRef`, `cellRef`, `libraryRef`, `net`, `joined`, `portRef`, `instanceRef`, `property`, `design`, `rename`).
- **Static Analysis & Lints (`src/errors.ts`, `src/lints/index.ts`)**: `EDIF1001`–`EDIF5006` diagnostics covering syntax errors, version validation, duplicate libraries/cells/instances/nets/ports, unresolved references, floating nets, shorted output drivers, missing top-level `design`, and circular hierarchy.
- **Hierarchical Netlist Flattener & DC/Logic Solver (`src/solver/`)**: Expands hierarchical EDIF netlists from the top-level `design`, solves resistive/passive DC circuits via Modified Nodal Analysis (MNA), and evaluates combinational/sequential digital logic (`AND2`, `OR2`, `NAND2`, `NOR2`, `INV`, `XOR2`, `DFF`).
- **Linear-Memory DAE Lowering (`src/dae/`)**: Lowers EDIF electrical netlists (KCL node equations, passive branch constitutive laws, and gate models) directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections (`src/projections/`)**: Exports EDIF netlists to standard SPICE netlists (`edifToSpice`) and Modelica models (`edifToModelica`).
- **Cleanroom Standard Library (`@modelscript/edif-std-lib`)**: Zero-I/O bundle with AssemblyScript WASM runtime and parametric SVG block icons for 12 standard EDIF `GENERIC` cells (`RES`, `CAP`, `IND`, `GND`, `VCC`, `AND2`, `OR2`, `NAND2`, `NOR2`, `INV`, `XOR2`, `DFF`).
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Document symbols, hover cards, diagnostics, completions, and go-to-definition for `.edf`, `.edif`, and `.edn` files.

## Quick Start

```ts
import {
  parseEdif,
  lintEdif,
  flattenEdifNetlist,
  solveEdifDc,
  evaluateEdifLogic,
  edifToDae,
  edifToSpice,
  edifToModelica,
} from "@modelscript/edif";

const doc = parseEdif(edifSource);
const diagnostics = lintEdif(doc);
const flat = flattenEdifNetlist(doc);
const dc = solveEdifDc(flat);
const dae = edifToDae(doc);
const spice = edifToSpice(doc);
const modelica = edifToModelica(doc);
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint EDIF 2.0.0 models
msx lint model.edf

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/edif test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="edif" />
