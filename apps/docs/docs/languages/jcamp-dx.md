---
title: "JCAMP-DX (.jdx)"
description: "IUPAC IR/NMR/MS ASDF/DIFDUP spectroscopy & interactive spectrum viewer"
---

# JCAMP-DX (`.jdx`)

**Package:** `@modelscript/jcamp-dx` · **Maturity:** `Beta` · **Extensions:** `.jdx`

**Maturity:** Beta · **Extensions:** `.jdx`, `.dx`, `.jcamp` · **Docs:** [modelscript.org/languages/jcamp-dx](https://modelscript.org/languages/jcamp-dx)

Native **JCAMP-DX (Joint Committee on Atomic and Molecular Physical Data — Data Exchange, IUPAC 1988)** analytical spectroscopy language package (`.jdx`, `.dx`, `.jcamp`) for ModelScript. Features a WebAssembly GLR parser, full ASDF/DIFDUP compression codec (AFFN, PAC, SQZ, DIF, DUP, and DIFDUP checkpoint verification), Beer-Lambert & Savitzky-Golay spectroscopy solver, direct linear-memory `DAEBuilder` lowering of Lorentzian/Gaussian absorption line shapes, domain diagnostics (`JDX1001`–`JDX5006`), cleanroom IUPAC spectroscopy standard library, pure SVG spectrum renderer, and an interactive React viewer/editor panel.

---

## Core Capabilities

- **WASM GLR Parser & ASDF/DIFDUP Codec (`parseJcampDx`, `decodeXyData`, `encodeAsdf`)**: Parses JCAMP-DX 4.24/5.01/6.00 Labeled Data Records (`##TITLE=`, `##JCAMP-DX=`, `##DATA TYPE=`, `##XYDATA=(X++(Y..Y))`, `##PEAK TABLE=(XY..XY)`, `##END=`, `$$` comments) and decodes/encodes AFFN, PAC, SQZ (`@A-Ia-i`), DIF (`%J-Rj-r`), DUP (`S-Zs`), and DIFDUP with strict checkpoint verification.
- **Spectroscopy Solver (`transmittanceToAbsorbance`, `absorbanceToTransmittance`, `findSpectralPeaks`, `integrateBand`, `savitzkyGolaySmooth`)**: Beer-Lambert $A = -\log_{10} T$ conversion, topographic-prominence peak detection, trapezoidal band integration, and Savitzky-Golay polynomial smoothing.
- **Direct DAE Arena Lowering (`lowerJcampDxToDae`, `jcampDxToDae`)**: Lowers Beer-Lambert transmittance/absorbance and Lorentzian/Gaussian absorption line-shape models directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Spectroscopy Linter (`lintJcampDx`, `JcampDxErrorCode`)**: Validates mandatory LDRs, `##NPOINTS` parity, DIFDUP checkpoint continuity, positive scaling factors, X-range bounds, and physical transmittance limits (`JDX1001`–`JDX5006`).
- **Interactive SVG & React Panel (`renderJcampDxSpectrumSvg`, `JcampDxPanel`)**: Renders wavenumber/ppm-reversed IR & NMR plots, stick-plot mass spectra, peak callouts, and live Absorbance/Transmittance toggling.

---

## Package Structure

| Path                                  | Description                                                                       |
| :------------------------------------ | :-------------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                            |
| `src/language.ts`                     | `jcampDxLanguage` DSL grammar, file extensions, and UI panel registration         |
| `src/types.ts`                        | Core TypeScript interfaces (`JcampDocument`, `JcampBlock`, `JcampLdr`)            |
| `src/errors.ts`                       | `JcampDxErrorCode` diagnostic definitions (`JDX1001`–`JDX5006`)                   |
| `src/parser/asdf.ts`                  | ASDF encoder/decoder (AFFN, PAC, SQZ, DIF, DUP, DIFDUP + checkpoint verification) |
| `src/parser/jcamp-parser.ts`          | JCAMP-DX LDR & compound block parser (`parseJcampDx`, `serializeJcampDx`)         |
| `src/lints/index.ts`                  | `lintJcampDx` domain diagnostic validator                                         |
| `src/solver/spectroscopy.ts`          | Beer-Lambert, peak finder, trapezoidal integration, Savitzky-Golay smoothing      |
| `src/dae/lowering.ts`                 | Direct `IDaeBuilder` lowering of Beer-Lambert & Lorentzian/Gaussian line shapes   |
| `src/projections/index.ts`            | CSV and JSON spectrum projections                                                 |
| `src/catalog/jcamp-dx-std-schemas.ts` | Cleanroom IUPAC spectroscopy types & IR functional-group absorption bands         |
| `src/diagram/spectrum-svg.ts`         | Pure SVG IR/NMR/MS/UV-Vis/Raman spectrum renderer                                 |
| `src/ui/JcampDxPanel.tsx`             | Interactive React spectrum viewer & metadata/peak/lint inspector                  |
| `src/indexing.ts`                     | UnifiedWorkspace symbol indexing                                                  |
| `src/lsp.ts`                          | LSP diagnostics, document symbols, hover, and completions                         |

---

## CLI & Toolchain Integration

```bash
# Validate and lint JCAMP-DX files
msx lint sample.jdx

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/jcamp-dx test
```
