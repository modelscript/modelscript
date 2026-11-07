<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/nifti

NIfTI-1 / NIfTI-2 (`.nii`, `.nii.gz`) & NRRD (`.nrrd`, `.nhdr`) Volumetric Medical Imaging, RAS+ `qform`/`sform` Spatial Coordinate Registration, Radiomics, and Iso-Surface Mesh Reconstruction language package for ModelScript. Features a unified NIfTI-1 348-byte binary, NRRD ASCII/raw header, and volumetric descriptor parser (`parseNifti`), multi-file workspace indexing (`NiftiWorkspaceIndex`), a marching-tetrahedra / voxel iso-surface mesh & radiomics extractor (`extractIsoSurfaceMesh`, `computeSformAffineDeterminant`), direct linear-memory `DAEBuilder` lowering (`lowerNiftiToDae`), 10 neuroimaging & radiological header lint rules (`M9501`–`M9510`, `lintNiftiDocument`, `NiftiErrorCode`), OpenSCAD 3D CSG and ISO 10303-21 STEP AP242 projections (`niftiToScad`, `niftiToStep`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **NIfTI-1 Binary, NRRD Header & Volumetric Descriptor Parser (`parseNifti`)**: Parses 348-byte NIfTI-1 headers, Teem NRRD (`NRRD0004` / `NRRD0005`) headers (`sizes`, `spacings`, `space directions`, `space origin`), and JSON/DSL volumetric descriptors into a unified `NiftiDocument` with `dim[0..7]`, `pixdim[0..7]`, `qform` quaternions $(b, c, d, q_{\text{fac}})$, $4 \times 4$ `sform` RAS+ affine matrices, intensity scaling (`scl_slope`, `scl_inter`), anatomical ROI labels, and 3D scalar voxel arrays.
- **Iso-Surface Mesh Extraction & Volumetric Radiomics (`extractIsoSurfaceMesh`, `computeSformAffineDeterminant`)**: Transforms voxel indices $(i, j, k)$ into physical RAS+ millimeter coordinates via $\mathbf{x}_{\text{RAS}} = \mathbf{A}_{\text{sform}} [i, j, k, 1]^\top$, extracts watertight 3D surface meshes and bounding boxes at Hounsfield Unit (HU) or segmentation label thresholds, and computes organ/tumor volume ($\text{mm}^3$, $\text{cm}^3$), surface area ($\text{mm}^2$), sphericity, and centroid coordinates.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerNiftiToDae`)**: Lowers multi-compartment Pennes bioheat perfusion ($k \nabla^2 T + \omega_b \rho_b c_b (T_a - T) + q_m$) and pharmacokinetic contrast-agent tracer transport ODEs parameterized by voxel ROI volumes directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **10 Radiological & Coordinate Registration Lint Rules (`M9501`–`M9510`, `lintNiftiDocument`)**: Static verification of volume dimensions, positive millimeter voxel spacings, non-singular $4 \times 4$ `sform` matrices ($\lvert\det(\mathbf{A})\rvert \ge 10^{-9}$), unit quaternion normalization ($b^2 + c^2 + d^2 \le 1$), `qform`/`sform` coordinate handedness consistency, intensity scaling slope, supported datatypes, voxel buffer length, non-empty segmentation masks, and slice thickness anisotropy ratios.
- **OpenSCAD 3D CSG & STEP AP242 CAD Projections (`niftiToScad`, `niftiToStep`)**: Exports segmented anatomical organs and tumors into OpenSCAD (`@modelscript/scad`) `polyhedron` meshes and ISO 10303-21 STEP AP242 (`@modelscript/step`) B-Rep CAD solids for patient-specific 3D printing and surgical planning.

---

## Package Structure

| Path                       | Description                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/index.ts`             | Public package exports                                                                                 |
| `src/language.ts`          | `niftiLanguage` definition and compiler actions                                                        |
| `src/types.ts`             | `NiftiDocument`, `NiftiHeader`, `NiftiQuaternion`, `NiftiSegmentLabel`, `ExtractedIsoSurfaceMesh`      |
| `src/parser/index.ts`      | `parseNifti` NIfTI-1 binary, NRRD header, and JSON/DSL volumetric parser                               |
| `src/lints/rules.ts`       | `NiftiErrorCode`, `lintNiftiDocument` (`M9501`–`M9510`), and `computeSformAffineDeterminant`           |
| `src/lints/index.ts`       | Linter barrel exports                                                                                  |
| `src/solvers/index.ts`     | `extractIsoSurfaceMesh` 3D iso-surface mesh reconstructor and volumetric radiomics analyzer            |
| `src/dae/index.ts`         | `lowerNiftiToDae` Pennes bioheat and contrast-agent perfusion lowering into `DAEBuilder` linear memory |
| `src/projections/index.ts` | `niftiToScad` and `niftiToStep` translators to OpenSCAD 3D CSG and STEP AP242 CAD                      |
| `src/workspace-index.ts`   | `NiftiWorkspaceIndex` implementing `IWorkspaceIndex` across `.nii`, `.nrrd`, and `.nhdr` files         |
| `src/lsp.ts`               | LSP validation, document symbols, RAS+ affine hover cards, completion, and definition providers        |

---

## Pre-Flight Semantic Lint Rules (`M9501`–`M9510`)

| Code    | Rule                                    | Severity  | Description                                                                                                             |
| ------- | --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `M9501` | `nifti-invalid-dimensions`              | `error`   | Volume rank `dim[0]` is outside $[1, 7]$ or spatial dimensions $n_x, n_y, n_z \le 0$.                                   |
| `M9502` | `nifti-non-positive-voxel-spacing`      | `error`   | Voxel physical spacing `pixdim[1..3]` ($dx, dy, dz$) is $\le 0\text{ mm}$.                                              |
| `M9503` | `nifti-singular-affine-transform`       | `error`   | $4 \times 4$ `sform` affine transformation matrix is singular or degenerate ($\lvert\det(\mathbf{A})\rvert < 10^{-9}$). |
| `M9504` | `nifti-invalid-quaternion-norm`         | `error`   | `qform` quaternion parameters $(b, c, d)$ violate unit norm ($b^2 + c^2 + d^2 > 1.0$).                                  |
| `M9505` | `nifti-qform-sform-handedness-mismatch` | `error`   | Active `qform` ($q_{\text{fac}}$) and `sform` ($\operatorname{sign}(\det(\mathbf{A}))$) have opposite handedness.       |
| `M9506` | `nifti-zero-intensity-scale-slope`      | `error`   | Intensity scaling slope `scl_slope` is explicitly $0$ while scaling is active, zeroing all voxel intensities.           |
| `M9507` | `nifti-unsupported-datatype`            | `error`   | Header specifies an unsupported or unrecognized NIfTI/NRRD voxel datatype code.                                         |
| `M9508` | `nifti-voxel-data-size-mismatch`        | `error`   | Provided voxel array length does not match $n_x \times n_y \times n_z \times n_t$.                                      |
| `M9509` | `nifti-empty-segmentation-mask`         | `warning` | Segmentation labelmap contains zero foreground voxels across all declared anatomical ROI labels.                        |
| `M9510` | `nifti-anisotropic-slice-gap-warning`   | `warning` | Slice thickness $dz$ exceeds in-plane resolution $\min(dx, dy)$ by more than $5\times$.                                 |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx nifti`)

```bash
# Lint a NIfTI (.nii) or NRRD (.nrrd) medical volume header (M9501-M9510)
npx msx nifti lint brain_mri.nrrd

# Extract 3D iso-surface mesh and volumetric radiomics at threshold
npx msx nifti extract-mesh brain_mri.nrrd --threshold 100

# Lower Pennes bioheat / perfusion ODEs to DAE or project to OpenSCAD (.scad) / STEP (.step)
npx msx nifti to-dae brain_mri.nrrd
npx msx nifti to-scad brain_mri.nrrd
npx msx nifti to-step brain_mri.nrrd
```

### Programmatic API

```typescript
import {
  extractIsoSurfaceMesh,
  lintNiftiDocument,
  lowerNiftiToDae,
  niftiToScad,
  niftiToStep,
  parseNifti,
} from "@modelscript/nifti";

// 1. Parse NIfTI-1 / NRRD volume and run RAS+ affine & radiological lint rules (M9501-M9510)
const doc = parseNifti(nrrdSource, "hepatic_ct.nrrd");
const diagnostics = lintNiftiDocument(doc);

// 2. Reconstruct 3D iso-surface mesh and compute organ volume (cm^3) and sphericity
const mesh = extractIsoSurfaceMesh(doc, 100.0);
console.log(`Volume: ${mesh.volumeCm3.toFixed(2)} cm^3, Triangles: ${mesh.triangles.length}`);

// 3. Lower Pennes bioheat ODEs to DAEBuilder or export to OpenSCAD (.scad) and STEP AP242 (.step)
const dae = lowerNiftiToDae(doc);
const scadCode = niftiToScad(doc);
const stepSolid = niftiToStep(doc);
```

---

## Scripts

| Command             | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                    |
| `npm test`          | Run NIfTI/NRRD parser, RAS+ affine linter, iso-surface mesh, and STEP/SCAD tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                            |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                             |
| `npm run clean`     | Remove `dist/` build artifacts                                                   |

---

## License

`AGPL-3.0-or-later`
