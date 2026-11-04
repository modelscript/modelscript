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

- Parses voxel dimensions $(N_x, N_y, N_z, N_t)$, millimeter spacings $(\Delta x, \Delta y, \Delta z)$, unit quaternion parameters $(b, c, d)$ with `qfac` $\in \{-1, +1\}$, and $4 \times 4$ `sform` homogeneous transformation matrices $\mathbf{T}_{\text{voxel}\to\text{RAS}}$.
- Detects singular affine matrices ($\det(\mathbf{M}_{3\times 3}) = 0$), left-right radiological/neurological handedness mismatches between `qform` and `sform`, and anisotropic slice gaps.

### 2. Segmentation Labelmaps & Marching Tetrahedra Iso-Surfacing

- Extracts organ and tumor volumes ($\text{mm}^3$ / $\text{cm}^3$), bounding boxes, and centroids for segmented ROIs, and triangulates watertight 3D surface meshes (`extractIsoSurfaceMesh`).

### 3. CAD Reconstruction (STEP AP242 & OpenSCAD)

- Projects extracted anatomical iso-surfaces directly into **ISO 10303-21 STEP** B-Rep shells (`niftiToStep`) and **OpenSCAD** `polyhedron(...)` CSG modules (`niftiToScad`) for patient-specific implant and surgical guide design.

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

# Export reconstructed anatomical geometry to ISO 10303-21 STEP or OpenSCAD
msx nifti to-step BrainAtlas.nii > BrainAtlas.stp
msx nifti to-scad BrainAtlas.nii > BrainAtlas.scad
```
