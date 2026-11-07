<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/topas

TOPAS (`.topas`, `.txt` — Tool for Particle Simulation) & Geant4 Medical Physics, Proton / Carbon-Ion Hadron Therapy Beamline Geometry, Bethe-Bloch / Bortfeld Bragg Peak Depth-Dose, and Radiation Transport language package for ModelScript. Features a zero-regex TOPAS typed parameter file parser (`parseTopas`), multi-file workspace indexing (`TopasWorkspaceIndex`), an analytical Bethe-Bloch & Bortfeld Bragg peak depth-dose and LET solver (`computeBraggPeakDepthDose`), direct linear-memory `DAEBuilder` lowering (`lowerTopasToDae`), 10 Geant4/TOPAS geometry and beam physics lint rules (`M9601`–`M9610`, `lintTopasDocument`, `TopasErrorCode`), OpenSCAD 3D CSG and Modelica 3.x projections (`topasToScad`, `topasToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex TOPAS Parameter File Parser (`parseTopas`)**: Parses TOPAS typed parameter assignments (`d:` double with unit, `i:` integer, `b:` boolean, `s:` string, `u:` unitless, `dv:` double vector, `iv:` integer vector, `sv:` string vector), `includeFile = ...` directives, `change` overrides, and groups parameters into `Ge/` geometry components (`TsBox`, `TsCylinder`, `TsSphere`, `Group`), `So/` particle sources, `Sc/` dose/fluence/LET scorers, `Ma/` materials, `Ph/` physics lists, and `Tf/` time features.
- **Bethe-Bloch & Bortfeld Bragg Peak Depth-Dose Solver (`computeBraggPeakDepthDose`)**: Computes continuous-slowing-down approximation (CSDA) range $R_0 = \alpha E_0^p$ scaled by material mass density and stopping power ratio, evaluates the depth-dose curve $D(z)$ (Gy/MU), $R_{90}$, $R_{80}$ distal fall-off, peak-to-entrance dose ratio, full-width at half-maximum ($\text{FWHM}$), and dose-averaged Linear Energy Transfer ($\text{LET}_d$ in $\text{keV}/\mu\text{m}$).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerTopasToDae`)**: Lowers beamline gantry/nozzle time-feature (`Tf/`) scanning magnet trajectories, continuous energy loss $\frac{dE}{dz} = -S(E)$, and scorer dose accumulation kinetics directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **10 TOPAS & Geant4 Geometry / Physics Lint Rules (`M9601`–`M9610`, `lintTopasDocument`)**: Static verification of TOPAS type prefixes (`d:`, `i:`, `b:`, `s:`, `u:`, `dv:`, `iv:`, `sv:`), parent volume hierarchy resolution, strictly positive solid dimensions (`HLX, HLY, HLZ > 0`, `RMin < RMax`), child-in-parent bounding box containment, Geant4/NIST material names (`G4_WATER`, `G4_AIR`, `G4_Pb`, etc.), positive `BeamEnergy` ($\text{MeV}$), circular `includeFile` chains, scorer `Component`/`Quantity` bindings, vector parameter count tokens, and duplicate parameter assignments.
- **OpenSCAD 3D CSG & Modelica 3.x Projections (`topasToScad`, `topasToModelica`)**: Translates TOPAS `Ge/` beamline nozzles, range shifters, brass apertures, and water phantoms into OpenSCAD (`@modelscript/scad`) 3D CSG hierarchies and Modelica 3.x dosimetry models.

---

## Package Structure

| Path                       | Description                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                              |
| `src/language.ts`          | `topasLanguage` definition and compiler actions                                                     |
| `src/types.ts`             | `TopasDocument`, `TopasParameter`, `TopasGeometryComponent`, `TopasBeamSource`, `BraggPeakResult`   |
| `src/parser/index.ts`      | `parseTopas` zero-regex TOPAS typed parameter file parser                                           |
| `src/lints/rules.ts`       | `TopasErrorCode` and `lintTopasDocument` Geant4/TOPAS linter (`M9601`–`M9610`)                      |
| `src/lints/index.ts`       | Linter barrel exports                                                                               |
| `src/solvers/index.ts`     | `computeBraggPeakDepthDose` Bethe-Bloch / Bortfeld Bragg peak depth-dose and $\text{LET}_d$ solver  |
| `src/dae/index.ts`         | `lowerTopasToDae` direct lowering of stopping-power and scorer ODEs into `DAEBuilder` linear memory |
| `src/projections/index.ts` | `topasToScad` and `topasToModelica` cross-language translators                                      |
| `src/workspace-index.ts`   | `TopasWorkspaceIndex` implementing `IWorkspaceIndex` across `.topas` and `.txt` parameter files     |
| `src/lsp.ts`               | LSP validation, document symbols, parameter hover cards, completion, and definition providers       |

---

## Pre-Flight Semantic Lint Rules (`M9601`–`M9610`)

| Code    | Rule                                    | Severity  | Description                                                                                                        |
| ------- | --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `M9601` | `topas-type-prefix-mismatch`            | `error`   | Parameter value does not match its declared TOPAS type prefix (`d:`, `i:`, `b:`, `s:`, `u:`, `dv:`, `iv:`, `sv:`). |
| `M9602` | `topas-unresolved-parent-component`     | `error`   | Geometry component `Ge/<Name>/Parent` references an undeclared parent volume.                                      |
| `M9603` | `topas-non-positive-geometry-dimension` | `error`   | `TsBox`, `TsCylinder`, or `TsSphere` half-length/radius is $\le 0$, or `RMin >= RMax`.                             |
| `M9604` | `topas-child-exceeds-parent-bounds`     | `error`   | Child geometry translation (`TransX/Y/Z`) plus half-length protrudes outside its parent volume bounding box.       |
| `M9605` | `topas-undefined-material`              | `error`   | `Ge/<Name>/Material` references a material not in the Geant4/NIST catalog or declared via `Ma/<Name>/...`.         |
| `M9606` | `topas-invalid-beam-energy`             | `error`   | Particle source `So/<Name>/BeamEnergy` is $\le 0\text{ MeV}$ or `BeamEnergySpread` is negative.                    |
| `M9607` | `topas-circular-include-file`           | `error`   | `includeFile` directive creates a self-referential or circular include chain.                                      |
| `M9608` | `topas-scorer-missing-component`        | `error`   | Scorer `Sc/<Name>/Component` or `Quantity` is missing or references an undeclared `Ge/` volume.                    |
| `M9609` | `topas-vector-length-mismatch`          | `error`   | Vector parameter (`dv:`, `iv:`, `sv:`) element count does not match its declared length prefix token.              |
| `M9610` | `topas-duplicate-parameter-assignment`  | `warning` | Identical parameter path is assigned multiple times in the same file without a `change` override prefix.           |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx topas`)

```bash
# Lint a TOPAS proton/carbon-ion therapy parameter file (M9601-M9610)
npx msx topas lint proton_nozzle.topas

# Compute Bethe-Bloch / Bortfeld Bragg peak depth-dose curve and LETd
npx msx topas bragg-peak proton_nozzle.topas

# Lower to DAE or project beamline & phantom geometry to OpenSCAD (.scad) / Modelica (.mo)
npx msx topas to-dae proton_nozzle.topas
npx msx topas to-scad proton_nozzle.topas
npx msx topas to-modelica proton_nozzle.topas
```

### Programmatic API

```typescript
import {
  computeBraggPeakDepthDose,
  lintTopasDocument,
  lowerTopasToDae,
  parseTopas,
  topasToModelica,
  topasToScad,
} from "@modelscript/topas";

// 1. Parse TOPAS parameter file and run Geant4/TOPAS geometry & physics lints (M9601-M9610)
const doc = parseTopas(topasSource, "proton_nozzle.topas");
const diagnostics = lintTopasDocument(doc);

// 2. Compute Bortfeld Bragg peak depth-dose curve (R0, R80, R90, FWHM, LETd)
const bragg = computeBraggPeakDepthDose(doc);
console.log(`Bragg Peak Depth: ${bragg.braggPeakDepthMm.toFixed(1)} mm, R80: ${bragg.r80Mm.toFixed(1)} mm`);

// 3. Lower to WebAssembly DAEBuilder or export to OpenSCAD 3D CSG and Modelica 3.x
const dae = lowerTopasToDae(doc);
const scadCode = topasToScad(doc);
const modelicaCode = topasToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                   |
| `npm test`          | Run TOPAS parser, Geant4 geometry linter, Bragg peak solver, and OpenSCAD tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                           |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                            |
| `npm run clean`     | Remove `dist/` build artifacts                                                  |

---

## License

`AGPL-3.0-or-later`
