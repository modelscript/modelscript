---
title: "FITS 4.0 (.fits)"
description: "NASA/IAU Flexible Image Transport System HDU & WCS astrometry"
---

# FITS 4.0 (`.fits`)

**Package:** `@modelscript/fits` · **Maturity:** `Beta` · **Extensions:** `.fits`

NASA/IAU **Flexible Image Transport System (FITS 4.0)** language package for ModelScript (**Beta** tier).

## Capabilities

- **WASM GLR Parser (`src/language.ts`)**: Declarative `@modelscript/dsl` grammar for 80-character FITS header keyword cards (`SIMPLE`, `BITPIX`, `NAXIS`, `NAXISn`, `EXTEND`, `XTENSION`, `PCOUNT`, `GCOUNT`, `BSCALE`, `BZERO`, `TFIELDS`, `TTYPE`, `TFORM`, `CRVAL`, `CRPIX`, `CDELT`, `CTYPE`, `CD1_1`–`CD2_2`, `HISTORY`, `COMMENT`, `END`).
- **2880-Byte Binary HDU Codec (`src/parser/binary-hdu.ts`)**: Full big-endian encode/decode for Primary HDUs, `IMAGE` extensions, `TABLE` (ASCII) extensions, and `BINTABLE` (binary) extensions across `BITPIX` $\in \{8, 16, 32, 64, -32, -64\}$ with `BSCALE`/`BZERO` physical value scaling.
- **Lints & Diagnostics (`src/errors.ts`, `src/lints/`)**: `FITS1001`–`FITS5006` covering card length, non-ASCII characters, missing `SIMPLE`/`END`, invalid `BITPIX`, `NAXIS` mismatch, 2880-byte alignment, `XTENSION` without `EXTEND = T`, duplicate mandatory keywords, and incomplete WCS definitions.
- **WCS Astrometry & Photometry (`src/solver/`)**: Calabretta & Greisen (2002) forward/inverse celestial spherical projections (`TAN` gnomonic, `SIN` orthographic, `ARC` zenithal equidistant), great-circle angular separation, sigma-clipped image statistics, circular aperture photometry, and Planck blackbody / magnitude calibration.
- **Linear Memory DAE Lowering (`src/dae/`)**: Photometric flux calibration and Beer-Lambert radiative transfer equations lowered directly to `DAEBuilder`.
- **Projections (`src/projections/`)**: Export to CSV, JSON metadata, CCSDS cross-link metadata, and SVG image/WCS reticle previews.
- **Cleanroom Standard Library (`src/catalog/`, `assets/fits-std-lib/`)**: FITS 4.0 mandatory and WCS keyword schemas with SVG icons and AssemblyScript WASM runtime kernel.
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Multi-file indexing, diagnostics, document symbols, hover documentation, and keyword completions.

## Commands

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint FITS 4.0 models
msx lint model.fits

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/fits test
```
