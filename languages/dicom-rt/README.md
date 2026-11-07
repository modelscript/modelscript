<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/dicom-rt

DICOM-RT (`RTPLAN`, `RTSTRUCT`, `RTDOSE`) radiation oncology treatment planning, clinical dosimetry (`DVH`, `BED`, `EQD2`, Conformity Index, Homogeneity Index), linear accelerator MLC/gantry kinematics, and cross-language projections (`@modelscript/scad` & `@modelscript/sysml2`) for ModelScript. Features a unified DICOM-RT XML, PS3.18 JSON, and declarative DSL parser (`parseDicomRt`), multi-file workspace indexing (`DicomRtWorkspaceIndex`), an ICRU 83 & Linear-Quadratic radiobiological dosimetry evaluator (`evaluateDicomRtDosimetry`, `computeBiologicallyEffectiveDose`, `computeEqd2`), direct linear-memory `DAEBuilder` lowering (`lowerDicomRtToDae`), 10 AAPM TG-142 / QUANTEC clinical safety lint rules (`M9201`–`M9210`, `lintDicomRtDocument`, `DicomRtErrorCode`), OpenSCAD 3D CSG and SysML v2 projections (`dicomRtToScad`, `dicomRtToSysML2`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **DICOM-RT XML, PS3.18 JSON & Declarative DSL Parser (`parseDicomRt`)**: Parses clinical radiation therapy structures (`RTSTRUCT`), multi-beam IMRT/VMAT/proton control points and multileaf collimator apertures (`RTPLAN`), and cumulative dose-volume histograms (`RTDOSE`) with exact source ranges.
- **Clinical Safety & Physics Linter (`M9201`–`M9210`, `lintDicomRtDocument`)**: Enforces AAPM TG-142 / TG-263 and QUANTEC radiotherapy safety rules including target volume presence, MLC leaf collision/gap checks, leaf motor speed limits, gantry-couch collision hazard zones, OAR dose tolerances, and PTV prescription coverage.
- **Radiobiological & Dosimetric Evaluation (`evaluateDicomRtDosimetry`, `computeBiologicallyEffectiveDose`, `computeEqd2`)**: Computes $D_{98\%}$, $D_{95\%}$, $D_{50\%}$, $D_{2\%}$, $V_{20\text{Gy}}$, RTOG/Paddick Conformity Index ($\text{CI}$), ICRU 83 Homogeneity Index ($\text{HI} = (D_{2\%} - D_{98\%}) / D_{50\%}$), Biologically Effective Dose ($\text{BED} = n d (1 + d / (\alpha/\beta))$), and Equivalent Dose in 2 Gy fractions ($\text{EQD}_2$).
- **Linear-Memory `DAEBuilder` Lowering (`lowerDicomRtToDae`)**: Lowers linac gantry/collimator angle trajectories, MLC aperture area, dose rate delivery kinetics, and Linear-Quadratic (LQ) cell survival ODEs directly into `DAEBuilder`.
- **3D OpenSCAD & SysML v2 Projections (`dicomRtToScad`, `dicomRtToSysML2`)**: Exports `RTSTRUCT` anatomical contour slices and treatment beam cones to OpenSCAD 3D geometry and clinical dose prescriptions to SysML v2 `requirement def` and `verification def` models.

---

## Package Structure

| Path                     | Description                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/index.ts`           | Primary package entry point and public API re-exports                                                  |
| `src/language.ts`        | `dicomRtLanguage` definition, compiler actions, and MCP tool (`dicom_rt_verify_dvh`)                   |
| `src/types.ts`           | Core data structures for `RTSTRUCT`, `RTPLAN`, `RTDOSE`, DVH curves, and diagnostics                   |
| `src/parser/`            | `parseDicomRt` unified DICOM-RT XML, DICOM PS3.18 JSON, and declarative DSL parser                     |
| `src/lints/`             | `DicomRtErrorCode` and `lintDicomRtDocument` AAPM/QUANTEC radiotherapy safety linter (`M9201`–`M9210`) |
| `src/dosimetry/`         | `evaluateDicomRtDosimetry`, `computeBiologicallyEffectiveDose`, and `computeEqd2`                      |
| `src/dae/`               | `lowerDicomRtToDae` linear-memory `DAEBuilder` lowering for linac delivery and LQ survival ODEs        |
| `src/projections/`       | `dicomRtToScad` and `dicomRtToSysML2` cross-language projections to OpenSCAD 3D CSG and SysML v2       |
| `src/workspace-index.ts` | `DicomRtWorkspaceIndex` multi-file workspace symbol indexer (`IWorkspaceIndex`)                        |
| `src/lsp.ts`             | Language Server Protocol validation, symbols, hover cards, completions, and definitions                |

---

## Pre-Flight Semantic Lint Rules (`M9201`–`M9210`)

| Code    | Rule                                     | Severity  | Description                                                                                |
| ------- | ---------------------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `M9201` | `dicom-rt-missing-target-volume`         | `error`   | Plan contains no target ROI (`PTV`, `CTV`, or `GTV`).                                      |
| `M9202` | `dicom-rt-mlc-leaf-overlap`              | `error`   | MLC leaf pair violates minimum physical gap (`bankB_mm - bankA_mm < 0.5` mm).              |
| `M9203` | `dicom-rt-mlc-speed-exceeded`            | `error`   | MLC leaf travel speed between consecutive control points exceeds `25.0` mm/s motor limit.  |
| `M9204` | `dicom-rt-gantry-couch-collision`        | `error`   | Non-coplanar couch angle (`> 15` deg) with lateral/posterior gantry enters collision zone. |
| `M9205` | `dicom-rt-oar-dose-constraint-violated`  | `error`   | Organ-at-Risk (`ORGAN`) DVH exceeds its `maxDoseLimitGy` or `meanDoseLimitGy` constraint.  |
| `M9206` | `dicom-rt-non-monotonic-cum-meterset`    | `error`   | Control point `cumulativeMetersetWeight` is non-monotonic or does not span `0.0` to `1.0`. |
| `M9207` | `dicom-rt-unclosed-roi-contour`          | `error`   | `CLOSED_PLANAR` contour slice has fewer than 3 vertices.                                   |
| `M9208` | `dicom-rt-unresolved-frame-of-reference` | `error`   | `structFrameOfReferenceUid` or `doseFrameOfReferenceUid` mismatches `frameOfReferenceUid`. |
| `M9209` | `dicom-rt-invalid-beam-meterset`         | `error`   | `TREATMENT` beam has `metersetMu <= 0` or `energyMeV <= 0`.                                |
| `M9210` | `dicom-rt-ptv-underdosage`               | `warning` | Target `PTV` DVH $D_{95\%}$ is less than $95\%$ of `prescribedDoseGy`.                     |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx dicom-rt`)

```bash
# Lint a DICOM-RT treatment plan (M9201-M9210)
npx msx dicom-rt lint prostate_vmat.rtplan

# Evaluate clinical DVH metrics (D98, D95, D2, HI, CI, BED, EQD2)
npx msx dicom-rt dosimetry prostate_vmat.rtplan

# Lower linac kinematics & LQ survival ODEs to DAE or project to OpenSCAD / SysML v2
npx msx dicom-rt to-dae prostate_vmat.rtplan
npx msx dicom-rt to-scad prostate_vmat.rtplan
npx msx dicom-rt to-sysml2 prostate_vmat.rtplan
```

### Programmatic API

```typescript
import {
  computeBiologicallyEffectiveDose,
  computeEqd2,
  dicomRtToScad,
  dicomRtToSysML2,
  evaluateDicomRtDosimetry,
  lintDicomRtDocument,
  lowerDicomRtToDae,
  parseDicomRt,
} from "@modelscript/dicom-rt";

// 1. Parse DICOM-RT treatment plan and run AAPM/QUANTEC safety lints (M9201-M9210)
const doc = parseDicomRt(rtPlanSource, "prostate_vmat.rtplan");
const diagnostics = lintDicomRtDocument(doc);

// 2. Evaluate ICRU 83 DVH indices (D95, HI, CI) and Linear-Quadratic BED / EQD2
const dosimetry = evaluateDicomRtDosimetry(doc);
const bedGy = computeBiologicallyEffectiveDose(39, 2.0, 1.5);
const eqd2Gy = computeEqd2(39, 2.0, 1.5);
console.log(`PTV D95: ${dosimetry.ptvMetrics[0]?.d95Gy} Gy, BED: ${bedGy.toFixed(1)} Gy`);

// 3. Lower to WebAssembly DAEBuilder or export to OpenSCAD (.scad) and SysML v2 (.sysml)
const dae = lowerDicomRtToDae(doc);
const scadCode = dicomRtToScad(doc);
const sysmlCode = dicomRtToSysML2(doc);
```

---

## Scripts

| Command             | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                              |
| `npm test`          | Run DICOM-RT parser, AAPM/QUANTEC linter, DVH/BED dosimetry, and DAE tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                      |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                       |
| `npm run clean`     | Remove `dist/` build artifacts                                             |

---

## License

`AGPL-3.0-or-later`
