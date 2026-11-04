<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/nifti

NIfTI-1/2 (`.nii`) and Nearly Raw Raster Data (`.nrrd`, `.nhdr`) volumetric medical imaging, RAS spatial coordinate transforms, segmentation isosurface mesh extraction, and compartmental pharmacokinetic/diffusion DAE lowering package for ModelScript.

---

## Core Capabilities

- **NIfTI-1/2 & NRRD Multi-Format Parser**: Supports 348-byte binary NIfTI-1 headers and voxel payloads, NRRD (`.nrrd`, `.nhdr`) headers with inline voxel grids, XML/JSON NIfTI header representations, and volumetric imaging DSL declarations.
- **Neuroimaging & Volumetric Linter (`M9501`–`M9510`)**: Validates volume dimensions (`dim[0..7]`), positive voxel spacing (`pixdim`), non-singular $4 \times 4$ `sform` affine matrices, unit quaternion normalization (`quatern_b/c/d`), `qform`/`sform` coordinate handedness consistency, intensity scaling (`scl_slope`), voxel datatypes, payload length, non-empty segmentation masks, and anisotropic slice-gap ratios.
- **RAS World Coordinate Transform & Isosurface Extraction**: Evaluates $\mathbf{x}_{\text{RAS}} = \mathbf{A}[i, j, k, 1]^\top$ via `sform` affine or `qform` quaternion transforms, extracts watertight surface triangulations and tetrahedral volume measures from 3D voxel grids, and computes anatomical label statistics.
- **Compartmental Voxel DAE Lowering & CAD Projections**: Lowers anatomical ROI tracer/diffusion equations into ModelScript's `DAEBuilder` arena and projects segmented organ meshes to OpenSCAD (`.scad`) `polyhedron` and ISO 10303-21 STEP AP242 (`.stp`) B-Rep geometry.
- **LSP & Workspace Index Integration**: Provides volumetric header hover cards, anatomical label symbols, completions, go-to-definition, and multi-file indexing via `NiftiWorkspaceIndex`.

---

## Package Structure

| Path                     | Description                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                             |
| `src/language.ts`        | NIfTI & NRRD language definition (`.nii`, `.nrrd`, `.nhdr`) and actions           |
| `src/types.ts`           | Domain types for NIfTI headers, quaternions, affines, labels, and voxel grids     |
| `src/parser/`            | 348-byte binary NIfTI-1, NRRD/NHDR, XML/JSON, and volumetric DSL parser           |
| `src/lints/`             | Volumetric geometry, affine/quaternion, and segmentation linter (`M9501`–`M9510`) |
| `src/mesh/`              | RAS coordinate transforms, isosurface mesh extraction, and `DAEBuilder` lowering  |
| `src/projections/`       | Projections to OpenSCAD (`.scad`) `polyhedron` and STEP AP242 (`.stp`)            |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer (`NiftiWorkspaceIndex`)                       |
| `src/lsp.ts`             | Language Server Protocol diagnostics, hover, completion, and symbol service       |
