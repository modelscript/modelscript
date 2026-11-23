---
title: "RINEX v2 (.obs)"
description: "GNSS OBS/NAV Keplerian ephemeris, 3D pseudorange fix & skyplot viewer"
---

# RINEX v2 (`.obs`)

**Package:** `@modelscript/rinex` · **Maturity:** `Beta` · **Extensions:** `.obs`

**Maturity:** Beta · **Extensions:** `.obs`, `.nav`, `.rnx`, `.24o`, `.24n`, `.25o`, `.25n`, `.o`, `.n` · **Docs:** [modelscript.org/languages/rinex](https://modelscript.org/languages/rinex)

Native **RINEX v2 (Receiver Independent Exchange Format, Gurtner et al. 1989)** GNSS/GPS observation (`OBS`) and navigation (`NAV`) compiler, ICD-GPS-200 broadcast Keplerian orbit propagator, Gauss-Newton weighted least-squares 3D receiver position & DOP solver, direct linear-memory `DAEBuilder` lowering, domain linter (`RNX1001`–`RNX5006`), polyglot projections (NMEA 0183, CCSDS OEM, CSV), and interactive SVG polar skyplot & residual viewer for ModelScript.

---

## Core Capabilities

- **WASM GLR Grammar & Fixed-Column RINEX v2 Parser (`rinexLanguage`, `parseRinex`, `parseRinexObs`, `parseRinexNav`)**:
  - Formal `@modelscript/dsl` grammar compiled to native WebAssembly (`dist/parser.wasm`)
  - Full 60-character data + 20-character label header parsing (`RINEX VERSION / TYPE`, `PGM / RUN BY / DATE`, `MARKER NAME`, `APPROX POSITION XYZ`, `ANTENNA: DELTA H/E/N`, `# / TYPES OF OBSERV`, `TIME OF FIRST OBS`, `ION ALPHA`, `ION BETA`, `END OF HEADER`)
  - Multi-epoch observation blocks (handling continuation lines, LLI, signal strength indicators) and 8-line GPS broadcast Keplerian ephemeris records (including Fortran `D` exponents)
- **ICD-GPS-200 Orbit Propagator & Gauss-Newton 3D Fix Solver (`computeSatelliteEcef`, `solveReceiverPosition`, `solveRinexEpoch`)**:
  - Broadcast Keplerian ephemeris propagation to WGS-84 ECEF $(X_s, Y_s, Z_s)$ with harmonic perturbations ($C_{uc}, C_{us}, C_{rc}, C_{rs}, C_{ic}, C_{is}$) and relativistic clock correction $\Delta t_r = F_{\text{rel}} e \sqrt{A} \sin E_k$
  - Weighted least-squares Gauss-Newton 3D fix $(X, Y, Z, c\delta t)$ from $\ge 4$ pseudoranges with Sagnac Earth-rotation compensation, WGS-84 geodetic conversion, and GDOP/PDOP/HDOP/VDOP/TDOP computation
- **Direct Continuous DAE Arena Lowering (`rinexToDae`, `lowerRinexToDae`)**:
  - Lowers nonlinear pseudorange observation equations $\sqrt{(X_{s,i} - x)^2 + (Y_{s,i} - y)^2 + (Z_{s,i} - z)^2} + c\delta t = P_i + c\Delta t_{sv,i}$ directly into `@modelscript/runtime`'s `DAEBuilder`
- **GNSS Domain Linter (`lintRinex`, `RinexErrorCode`)**:
  - Diagnostics `RNX1001`–`RNX5006` validating syntax, required headers, RINEX version, satellite geometry ($< 4$ satellites), PRN validity, monotonic epochs, pseudorange bounds ($15{,}000\text{–}35{,}000\,\text{km}$), and orbital eccentricity ($e \ge 1$)
- **Polyglot Projections (`rinexToNmea`, `rinexToCcsdsOem`, `rinexToCsv`)**:
  - Exports fixes and orbits to NMEA 0183 (`$GPGGA`/`$GPGSA`), CCSDS Orbit Ephemeris Message (`CCSDS_OEM_VERS = 2.0`), and tabular CSV
- **Interactive SVG Polar Skyplot & React Panel (`renderRinexSkyplotSvg`, `RinexPanel`)**:
  - Renders a pure SVG polar GNSS constellation skyplot (elevation rings, azimuth compass, PRN markers) paired with a pseudorange residual bar chart inside `@modelscript/design-tokens/panel`

---

## Package Structure

| Path                                 | Description                                                                                   |
| :----------------------------------- | :-------------------------------------------------------------------------------------------- |
| `src/index.ts`                       | Public package exports                                                                        |
| `src/language.ts`                    | `rinexLanguage` WASM GLR grammar & UI panel registration                                      |
| `src/types.ts`                       | Core RINEX v2 OBS, NAV, ECEF, DOP, and solution interfaces                                    |
| `src/errors.ts`                      | `RinexErrorCode` (`RNX1001`–`RNX5006`) diagnostic definitions                                 |
| `src/parser/index.ts`                | Fixed-column RINEX v2 OBS & NAV parser                                                        |
| `src/lints/index.ts`                 | `lintRinex` semantic and physical bounds linter                                               |
| `src/solver/index.ts`                | ICD-GPS-200 Keplerian ECEF propagator, Gauss-Newton 3D fix, WGS-84 & DOP solver               |
| `src/dae/index.ts`                   | `lowerRinexToDae` & `rinexToDae` linear-memory DAE arena lowering                             |
| `src/projections/index.ts`           | `rinexToNmea`, `rinexToCcsdsOem`, and `rinexToCsv` projections                                |
| `src/diagram/index.ts`               | `renderRinexSkyplotSvg` polar skyplot + residual bar chart generator                          |
| `src/ui/RinexPanel.tsx`              | Interactive React viewer panel using `@modelscript/design-tokens/panel`                       |
| `src/catalog/rinex-std-schemas.ts`   | Cleanroom RINEX observation types (`C1`, `P1`, `P2`, `L1`, `L2`, `D1`, `S1`) & WGS-84 schemas |
| `assets/rinex-std-lib/src/models.ts` | Cleanroom AssemblyScript WASM runtime for GNSS constants & range kernels                      |
| `src/indexing.ts`                    | Declarative `UnifiedWorkspace` symbol indexing                                                |
| `src/lsp.ts`                         | `validateRinex`, `getRinexDocumentSymbols`, `getRinexHover`, `getRinexCompletions`            |

---

## CLI & Toolchain Integration

```bash
# Validate and lint RINEX v2 files
msx lint sample.obs

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/rinex test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="rinex" />
