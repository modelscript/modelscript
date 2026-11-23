---
title: "MDL Molfile / SDF (.mol)"
description: "V2000/V3000/SDF molecular graphs, SSSR rings & UFF energy"
---

# MDL Molfile / SDF (`.mol`)

**Package:** `@modelscript/molfile` · **Maturity:** `Beta` · **Extensions:** `.mol`

MDL Molfile (V2000 / V3000) & Structure-Data File (SDF) Chemical Structure Format (1979–1980s) for ModelScript.

## Features

- **Native WASM GLR Parser (`@modelscript/dsl`)**: Formal DSL grammar for MDL V2000 header/counts/atom/bond/property blocks (`M  CHG`, `M  ISO`, `M  RAD`, `M  END`), V3000 extended CTAB (`M  V30 BEGIN CTAB`/`ATOM`/`BOND`/`END CTAB`), and multi-record SDF (`> <TAG>` data items and `$$$$` delimiters).
- **Chemical Structure Lints (`MOL1001`–`MOL5006`)**: Validates syntax, `M  END` termination, atom/bond counts line parity, out-of-range bond indices, self-loop & duplicate bonds, unknown elements, bond order/stereo flags, formal charges, and atomic valence bounds.
- **Molecular Graph, 3D Geometry & Force-Field Analyzer**: Computes Hill molecular formula, IUPAC molecular weight, exact monoisotopic mass, implicit hydrogens, SSSR ring perception, 3D bond lengths/angles/dihedrals, and UFF/harmonic bond-stretch force-field energy.
- **Linear-Memory DAE Lowering**: Compiles harmonic molecular mechanics bond-stretch equations directly into `@modelscript/runtime` `DAEBuilder`.
- **Cross-Language Projections**: Projects Molfile/SDF records to canonical SMILES and Protein Data Bank (PDB) formats.
- **Cleanroom Standard Library**: Zero-I/O AssemblyScript WASM runtime and periodic table / canonical molecule schemas (Water, Ethanol, Benzene, Aspirin, Caffeine).
- **Indexing & LSP**: Full workspace indexing, diagnostics, document symbols, hover tooltips, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint MDL Molfile / SDF models
msx lint model.mol

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/molfile test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="molfile" />
