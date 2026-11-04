<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/dicom-rt

DICOM-RT (`RTPLAN`, `RTSTRUCT`, `RTDOSE`) radiation oncology treatment planning, clinical dosimetry (`DVH`, `BED`, `EQD2`, Conformity Index, Homogeneity Index), linear accelerator MLC/gantry kinematics, and cross-language projections (`@modelscript/scad` & `@modelscript/sysml2`) for ModelScript.

---

## Core Capabilities

- **DICOM-RT XML & PS3.18 JSON Parser**: Parses clinical radiation therapy structures (`RTSTRUCT`), multi-beam IMRT/VMAT/proton control points and multileaf collimator apertures (`RTPLAN`), and cumulative dose-volume histograms (`RTDOSE`) with exact source ranges.
- **Clinical Safety & Physics Linter (`M9201`–`M9210`)**: Enforces AAPM TG-142 / TG-263 and QUANTEC radiotherapy safety rules including target volume presence, MLC leaf collision/gap checks, leaf motor speed limits, gantry-couch collision hazard zones, OAR dose tolerances, and PTV prescription coverage.
- **Radiobiological & Dosimetric Evaluation**: Computes $D_{98\%}$, $D_{95\%}$, $D_{50\%}$, $D_{2\%}$, $V_{20\text{Gy}}$, RTOG/Paddick Conformity Index ($\text{CI}$), ICRU 83 Homogeneity Index ($\text{HI} = (D_{2\%} - D_{98\%}) / D_{50\%}$), Biologically Effective Dose ($\text{BED} = n d (1 + d / (\alpha/\beta))$), and Equivalent Dose in 2 Gy fractions ($\text{EQD}_2$).
- **Linear-Memory DAE Lowering**: Lowers linac gantry/collimator angle trajectories, MLC aperture area, dose rate delivery kinetics, and Linear-Quadratic (LQ) cell survival ODEs directly into `DAEBuilder`.
- **3D OpenSCAD & SysML v2 Projections**: Exports `RTSTRUCT` anatomical contour slices and treatment beam cones to OpenSCAD 3D geometry and clinical dose prescriptions to SysML v2 `requirement def` and `verification def` models.

---

## Diagnostic Rules (`M9201`–`M9210`)

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

## Package Structure

| Path                     | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                         |
| `src/language.ts`        | DICOM-RT language definition and action registrations                         |
| `src/types.ts`           | Core data structures for `RTSTRUCT`, `RTPLAN`, `RTDOSE`, and diagnostics      |
| `src/parser/`            | Unified DICOM-RT XML, DICOM PS3.18 JSON, and declarative DSL parser           |
| `src/lints/`             | Clinical radiotherapy physics and QUANTEC safety linter (`M9201`–`M9210`)     |
| `src/dosimetry/`         | DVH interpolation, ICRU 83 HI/CI indices, and LQ radiobiology (`BED`, `EQD2`) |
| `src/dae/`               | Linear-memory `DAEBuilder` lowering for linac delivery and LQ survival ODEs   |
| `src/projections/`       | Cross-language projections to OpenSCAD 3D CSG and SysML v2 requirements       |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer (`IWorkspaceIndex`)                       |
| `src/lsp.ts`             | Language Server Protocol validation, symbols, hover cards, and completions    |
