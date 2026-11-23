---
title: "SEG-Y (.sgy)"
description: "Geophysical seismic EBCDIC/IBM-float codec, NMO & FFT solver"
---

# SEG-Y (`.sgy`)

**Package:** `@modelscript/segy` · **Maturity:** `Beta` · **Extensions:** `.sgy`

SEG-Y Rev 0 / Rev 1 (Society of Exploration Geophysicists Seismic Data Format, 1975 / 2002) compiler, binary/textual codec, seismic signal processing solver, DAE lowering engine, cleanroom standard library, and LSP services for ModelScript.

## Features

- **WASM GLR Textual Header Parser** (`src/language.ts`): Declarative `@modelscript/dsl` grammar for 40-card 80-byte SEG-Y textual reel headers (`C 1`–`C40`, `CLIENT`, `LINE`, `AREA`, `SAMPLE INTERVAL`, `TRACE LENGTH`, `FORMAT`, `REV`, `END TEXTUAL HEADER`).
- **Full Binary SEG-Y Rev 0 / Rev 1 Codec** (`src/parser/`):
  - Bidirectional ASCII ↔ EBCDIC (IBM CP037) textual reel header codec with automatic encoding detection.
  - 3200-byte textual reel header, 400-byte big-endian binary reel header, optional extended textual headers, and 240-byte trace headers.
  - Exact IBM System/360 32-bit hexadecimal float ↔ IEEE-754 float32 codec (`format=1`), plus `int32` (`2`), `int16` (`3`), IEEE `float32` (`5`), and `int8` (`8`).
- **Domain Linter** (`src/errors.ts`, `src/lints/`): Diagnostics `SEGY1001`–`SEGY5006` for stream/syntax errors, truncated headers, unsupported sample format codes, invalid measurement systems, non-positive sample intervals/counts, trace sample mismatches, duplicate/non-monotonic trace sequence numbers, and NaN/Inf amplitudes.
- **Seismic Signal Processing Solver** (`src/solver/`): Ricker/Ormsby/Klauder wavelet synthesis, Normal Moveout (NMO) traveltime & trace flattening, radix-2 Cooley-Tukey FFT amplitude/phase spectrum, zero-phase bandpass filtering, and RMS/AGC trace gain.
- **DAE Lowering** (`src/dae/`): Direct linear-memory lowering of 1D acoustic wave propagation and convolutional seismic reflection models into `@modelscript/runtime`'s `DAEBuilder`.
- **Projections** (`src/projections/`): Export to CSV, human-readable ASCII trace dumps, and LAS 2.0 well-tie logs.
- **Cleanroom Standard Library** (`assets/segy-std-lib/`): SEG-Y Rev 0/Rev 1 header field schemas (`JobID`, `SampleIntervalUs`, `SampleFormatCode`, `Inline3D`, `Crossline3D`, `CDP`, `OffsetM`) and standard seismic wavelets (`Ricker`, `Ormsby`, `Klauder`) with AssemblyScript WASM runtime.
- **Unified Indexing & LSP** (`src/indexing.ts`, `src/lsp.ts`): Workspace symbol indexing, diagnostics, document symbols, hover, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint SEG-Y models
msx lint model.sgy

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/segy test
```
