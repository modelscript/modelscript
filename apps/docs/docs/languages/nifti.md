---
title: NIfTI & NRRD Volumetric Medical Imaging (.nii, .nrrd, .nhdr)
description: Native WebAssembly parsing, 4x4 qform quaternion and sform affine RAS coordinate validation, Marching Tetrahedra 3D iso-surface mesh extraction, DAEBuilder lowering, and ISO 10303-21 STEP / OpenSCAD projections for NIfTI and NRRD volumes.
---

# NIfTI & NRRD Volumetric Medical Imaging (`.nii`, `.nrrd`, `.nhdr`)

`@modelscript/nifti` (`languages/nifti`) provides native WebAssembly parsing, $4 \times 4$ `qform` quaternion and `sform` affine **Right-Anterior-Superior (RAS)** coordinate transformation validation, anatomical segmentation labelmap volume calculation, **Marching Tetrahedra** 3D iso-surface mesh extraction, `DAEBuilder` lowering, and ISO 10303-21 STEP / OpenSCAD projections for **NIfTI-1 / NIfTI-2** and **NRRD (Nearly Raw Raster Data)** medical imaging volumes.

---

## Supported Extensions & Standards

| Extension        | Format                | Description                                                                                                              |
| :--------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `.nii`           | NIfTI-1 / NIfTI-2     | Neuroimaging & clinical volumetric format encoding 3D/4D voxel grids, `pixdim` spacings, and `qform`/`sform` RAS affines |
| `.nrrd`, `.nhdr` | Teem / 3D Slicer NRRD | Nearly Raw Raster Data header/volume with `space directions`, `space origin`, and anatomical segmentation labelmaps      |

---

## Key Capabilities

### 1. Voxel-to-RAS Affine Geometry & Orientation Auditing

`@modelscript/nifti` parses voxel dimensions $(N_i, N_j, N_k, N_t)$, millimeter spacings $(\Delta i, \Delta j, \Delta k) = (\text{pixdim}[1], \text{pixdim}[2], \text{pixdim}[3])$, unit quaternion parameters $(b, c, d)$ with $a = \sqrt{\max(0, 1 - (b^2 + c^2 + d^2))}$ and `qfac` $q \in \{-1, +1\}$, and $4 \times 4$ `sform` homogeneous transformation matrices:

$$\begin{bmatrix} x_{\text{RAS}} \\ y_{\text{RAS}} \\ z_{\text{RAS}} \end{bmatrix} = \mathbf{R}(a, b, c, d) \begin{bmatrix} \Delta i \cdot i \\ \Delta j \cdot j \\ q \cdot \Delta k \cdot k \end{bmatrix} + \begin{bmatrix} q_{\text{offset},x} \\ q_{\text{offset},y} \\ q_{\text{offset},z} \end{bmatrix}$$

Pre-flight diagnostics verify:

- Non-singular affine determinant ($\lvert \det(\mathbf{M}_{3\times 3}) \rvert > 10^{-9}$) so voxels map bijectively to physical space,
- Consistency of radiological vs. neurological left-right handedness ($\text{sign}(\det \mathbf{M}_{\text{qform}}) = \text{sign}(\det \mathbf{M}_{\text{sform}})$),
- Isotropic/sub-millimeter slice spacing limits for surgical navigation and stereotactic radiosurgery.

### 2. Segmentation Labelmaps & Marching Tetrahedra Iso-Surfacing

- Computes exact organ and tumor ROI volumes $V_{\text{ROI}} = N_{\text{voxels}} \cdot \lvert \det(\mathbf{M}_{3\times 3}) \rvert$ ($\text{mm}^3$ and $\text{cm}^3$), physical RAS centroids, and axis-aligned bounding boxes.
- Decomposes each cubic voxel into 6 Kuhn tetrahedra and extracts a watertight, manifold-consistent 3D triangular surface mesh at any threshold $I_{\text{iso}}$ via linear edge interpolation (`extractIsoSurfaceMesh`):
  $$\mathbf{p}_{ab} = \mathbf{p}_a + \frac{I_{\text{iso}} - I_a}{I_b - I_a}\left(\mathbf{p}_b - \mathbf{p}_a\right)$$

### 3. CAD Reconstruction (STEP AP242, OpenSCAD & DAE Lowering)

- Projects extracted anatomical iso-surfaces directly into **ISO 10303-21 STEP** B-Rep faceted shells (`niftiToStep`), **OpenSCAD** `polyhedron(...)` CSG modules (`niftiToScad`), and `@modelscript/runtime`'s `DAEBuilder` arena (`lowerNiftiToDae`).

---

## Pre-Flight Diagnostics

<LintRules lang="nifti" />

---

## CLI Usage

```bash
# Inspect NIfTI/NRRD dimensions, voxel spacings, and RAS affine transforms
msx nifti inspect BrainAtlas.nii

# Validate qform/sform affine non-singularity and handedness consistency
msx nifti validate BrainAtlas.nii

# Extract 3D iso-surface mesh and ROI volumes from segmentation volume
msx nifti mesh BrainAtlas.nii

# Export reconstructed anatomical geometry to ISO 10303-21 STEP, OpenSCAD, or DAE
msx nifti to-step BrainAtlas.nii > BrainAtlas.stp
msx nifti to-scad BrainAtlas.nii > BrainAtlas.scad
msx nifti to-dae BrainAtlas.nii
```

---

## Programmatic TypeScript SDK

```typescript
import { parseNiftiModel, extractIsoSurfaceMesh, lowerNiftiToDae, niftiToStep, niftiToScad } from "@modelscript/nifti";
import { DAEBuilder } from "@modelscript/runtime";

const volume = parseNiftiModel(nrrdSource);
const mesh = extractIsoSurfaceMesh(volume, 0.5);

const builder = new DAEBuilder();
lowerNiftiToDae(volume, builder);
const stepData = niftiToStep(volume);
const scadCode = niftiToScad(volume);
```
