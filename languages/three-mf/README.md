<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/three-mf

ISO/ASTM 52915 3MF Medical/Healthcare Extension (`.3mf`) language package for patient-specific 3D surgical cutting guides, osteotomy jigs, and cranio-maxillofacial / orthopedic implants in ModelScript.

---

## Core Capabilities

- **ISO/ASTM 52915 3MF & Medical Extension Parser**: Parses 3MF `<model>` XML documents including `<basematerials>`, `<object>`, `<mesh>` (`<vertices>`, `<triangles>`), `<build>` (`<item>`), and `<medical:SurgicalGuide>` metadata (osteotomy cutting planes, drill sleeves/cannulas, wall thickness).
- **2-Manifold Topology & Clinical Linter (`M9701`–`M9710`)**: Validates watertight 2-manifold edges, non-degenerate triangles, positive signed mesh volume, build item references, minimum additive manufacturing wall thickness ($\ge 0.8\text{ mm}$), osteotomy/drill axis vectors, USP Class VI / ISO 10993 biocompatible materials, and $4 \times 3$ affine build transforms.
- **Computational Geometry & Topology Engine**: Computes Euler characteristic ($\chi = V - E + F$), topological genus, exact divergence-theorem signed volume, surface area, axis-aligned bounding box (AABB), and edge-manifold classification.
- **DAE Lowering & CAD Projections**: Lowers 3MF mesh and surgical guide parameters into `DAEBuilder`, and exports meshes to ISO 10303-21 STEP AP242 (`threeMfToStep`) and OpenSCAD `polyhedron` (`threeMfToScad`).
- **LSP & Workspace Index Integration**: Provides topology and biocompatibility hover cards, symbol indexing, completions, and diagnostics.

---

## Package Structure

| Path                     | Description                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                             |
| `src/language.ts`        | 3MF language definition and actions                                               |
| `src/types.ts`           | Domain types for 3MF meshes, materials, build items, and surgical guides          |
| `src/parser/`            | ISO/ASTM 52915 3MF XML and Medical Extension parser                               |
| `src/lints/`             | Manifold mesh topology and clinical safety linters (`M9701`–`M9710`)              |
| `src/topology/`          | Mesh topology analyzer (`verifyMeshTopology`) and `DAEBuilder` lowering           |
| `src/projections/`       | Projections to ISO 10303-21 STEP (`threeMfToStep`) and OpenSCAD (`threeMfToScad`) |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer (`ThreeMfWorkspaceIndex`)                     |
| `src/lsp.ts`             | Language Server Protocol diagnostics, symbols, hover, and completions             |
