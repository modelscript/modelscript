---
title: "JEDEC JESD3 (.jed)"
description: "PAL/GAL fuse-maps, Boolean SOP extractor & fuse-matrix grid viewer"
---

# JEDEC JESD3 (`.jed`)

**Package:** `@modelscript/jedec` · **Maturity:** `Beta` · **Extensions:** `.jed`

**Maturity:** Beta · **Extensions:** `.jed`, `.jedec`, `.pld` · **Docs:** [modelscript.org/languages/jedec](https://modelscript.org/languages/jedec)

Native **JEDEC Standard 3 (JESD3)** Programmable Logic Device (PLD) fuse-map and test-vector compiler, PAL/GAL sum-of-products Boolean extractor, logic simulator, HDL projector, and interactive fuse-matrix visualizer for ModelScript. Supports classic 1980s bipolar and electrically erasable PLDs (`PAL16L8`, `PAL16R8`, `GAL16V8`, `GAL22V10`), exact 16-bit JESD3 fuse (`C`) and ETX transmission checksum verification, direct linear-memory `DAEBuilder` lowering, synthesizable Verilog-2001 / VHDL-93 projections, and a React + SVG PAL/GAL fuse-matrix panel (`JedecPanel`).

---

## Core Capabilities

- **WASM GLR & JESD3 Fuse-Map Parser (`jedecLanguage`, `parseJedec`, `serializeJedec`, `computeJedecFuseChecksum`)**: Parses JESD3 fields (`QP`, `QF`, `QV`, `F`, `L`, `G`, `N`, `C`, `V`, `X`), `*` delimiters, and optional STX (`0x02`) / ETX (`0x03`) + 4-hex transmission checksum framing.
- **PAL/GAL Boolean Extractor & Test-Vector Simulator (`extractJedecEquations`, `simulateJedecVectors`, `computeFuseUtilization`)**: Reconstructs sum-of-products (SOP) Boolean equations from the PAL16L8 / GAL16V8 AND-OR fuse array and evaluates JESD3 `V` test vectors (`0`, `1`, `C`, `H`, `L`, `X`, `Z`, `N`) against extracted outputs.
- **Direct Boolean DAE Arena Lowering (`lowerJedecToDae`)**: Lowers PLD input pins, product terms, and Boolean output equations directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory representation.
- **Synthesizable HDL Projections (`jedecToVerilog`, `jedecToVhdl`)**: Projects extracted fuse-map Boolean logic to synthesizable Verilog-2001 modules and VHDL-93 entity/architecture pairs.
- **JESD3 Diagnostic Linter (`lintJedec`, `JedecErrorCode`)**: Comprehensive validation (`JED1001`–`JED5006`) covering missing `*` delimiters, mandatory `QF` fuse count, 16-bit `C` fuse checksum mismatch, 16-bit ETX transmission checksum mismatch, out-of-bounds `L` fuse addresses, invalid `F` default states, `V` vector length vs `QP` pin count mismatches, vector counts exceeding `QV`, and overlapping fuse writes.
- **Interactive Fuse-Matrix Viewer (`renderJedecFuseMatrixSvg`, `JedecPanel`)**: Renders intact (`0`) vs blown (`1`) fuse cells across product terms and input columns in pure SVG, integrated into an interactive React panel with Fuse Matrix, Boolean Equations, Test Vectors, and Lints tabs.

---

## Package Structure

| Path                    | Description                                                                                    |
| :---------------------- | :--------------------------------------------------------------------------------------------- |
| `src/index.ts`          | Public package exports                                                                         |
| `src/language.ts`       | `jedecLanguage` WASM GLR grammar, file extensions (`.jed`, `.jedec`), and UI panel metadata    |
| `src/types.ts`          | Core JESD3 document, fuse-map, test-vector, device-profile, and solver interfaces              |
| `src/errors.ts`         | `JedecErrorCode` (`JED1001`–`JED5006`) diagnostic definitions                                  |
| `src/parser/`           | `parseJedec`, `serializeJedec`, `computeJedecFuseChecksum`, `computeJedecTransmissionChecksum` |
| `src/lints/index.ts`    | `lintJedec` structural, checksum, bounds, and test-vector linter                               |
| `src/solver/`           | PAL/GAL device profiles, SOP Boolean extractor, and JESD3 `V` test-vector simulator            |
| `src/dae/`              | `lowerJedecToDae` direct Boolean DAE arena lowering                                            |
| `src/projections/`      | `jedecToVerilog` and `jedecToVhdl` synthesizable HDL projections                               |
| `src/diagram/`          | `renderJedecFuseMatrixSvg` pure SVG fuse-matrix grid renderer                                  |
| `src/ui/JedecPanel.tsx` | Interactive React panel using `@modelscript/design-tokens/panel`                               |
| `src/catalog/`          | Cleanroom PLD & JESD3 stdlib schemas and zero-I/O registry adapter                             |
| `src/indexing.ts`       | UnifiedWorkspace symbol indexing (`jedecIndexing`)                                             |
| `src/lsp.ts`            | Diagnostics, document symbols, hover docs, and completions                                     |

---

## CLI & Toolchain Integration

```bash
# Validate and lint JEDEC JESD3 files
msx lint sample.jed

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/jedec test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="jedec" />
