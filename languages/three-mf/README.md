<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/three-mf

3MF Consortium (`.3mf` — 3D Manufacturing Format) Patient-Specific Surgical Guides, Osteotomy Cutting Blocks, CranioMaxilloFacial (CMF) / Orthopaedic Lattice Implants, and Watertight 2-Manifold Additive Manufacturing verification package for ModelScript. Features a 3MF Core Specification 1.2.3 XML & surgical extension parser (`parseThreeMf`), multi-file workspace indexing (`ThreeMfWorkspaceIndex`), an Euler-Poincaré 2-manifold mesh & signed divergence volume analyzer (`verifyMeshTopology`), direct linear-memory `DAEBuilder` lowering (`lowerThreeMfToDae`), 10 additive manufacturing & ISO 10993 clinical safety lint rules (`M9701`–`M9710`, `lintThreeMfDocument`, `ThreeMfErrorCode`), ISO 10303-21 STEP AP242 and OpenSCAD 3D CSG projections (`threeMfToStep`, `threeMfToScad`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **3MF 1.2.3 Core & Surgical Extension Parser (`parseThreeMf`)**: Parses `<model>` packages (`unit`, `<metadata>`, `<resources>` `<basematerials>`, `<object>` `<mesh>` `<vertices>` / `<triangles>` and `<components>`, `<build>` `<item>` $4 \times 3$ affine transforms) and patient-specific `<surgicalguide>` annotations (osteotomy cutting planes, drill sleeve K-wire axes, minimum wall thickness, and cannula clearance).
- **2-Manifold Mesh Topology & Signed Volume Verifier (`verifyMeshTopology`)**: Verifies watertight half-edge pairing (every undirected edge shared by exactly $2$ triangles with opposite orientation), computes the Euler-Poincaré characteristic $\chi = V - E + F$ and topological genus $g = 1 - \chi / 2$, and integrates exact signed volume $V = \frac{1}{6} \sum \mathbf{v}_0 \cdot (\mathbf{v}_1 \times \mathbf{v}_2)$ and surface area.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerThreeMfToDae`)**: Lowers Laser Powder Bed Fusion (LPBF / Ti-6Al-4V) / SLA layerwise thermal accumulation and curing shrinkage ODEs directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **10 Additive Manufacturing & Surgical Guide Lint Rules (`M9701`–`M9710`, `lintThreeMfDocument`)**: Static verification of watertight 2-manifold edges, non-degenerate triangles, positive signed volume (outward normals), `<build><item>` object references, minimum surgical guide wall thickness ($\ge 0.8\text{ mm}$), osteotomy/drill axis normalization, ISO 10993 / USP Class VI biocompatible materials, non-singular item transforms ($\det(\mathbf{M}) > 0$), vertex index bounds, and duplicate object IDs.
- **ISO 10303-21 STEP AP242 & OpenSCAD 3D CSG Projections (`threeMfToStep`, `threeMfToScad`)**: Exports 3MF surgical guides and implants to STEP AP242 (`@modelscript/step`) faceted B-Rep solids and OpenSCAD (`@modelscript/scad`) `polyhedron()` scripts with drill trajectory cylinders.

---

## Package Structure

| Path                       | Description                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                               |
| `src/language.ts`          | `threeMfLanguage` definition, compiler actions, and MCP tool (`three_mf_verify_guide`)               |
| `src/types.ts`             | `ThreeMfDocument`, `ThreeMfObject`, `ThreeMfMesh`, `ThreeMfSurgicalGuideSpec`, `MeshTopologySummary` |
| `src/parser/index.ts`      | `parseThreeMf` 3MF Core 1.2.3 XML and surgical guide metadata parser                                 |
| `src/lints/rules.ts`       | `ThreeMfErrorCode` and `lintThreeMfDocument` 2-manifold & ISO 10993 linter (`M9701`–`M9710`)         |
| `src/lints/index.ts`       | Linter barrel exports                                                                                |
| `src/solvers/index.ts`     | `verifyMeshTopology` Euler-Poincaré 2-manifold edge, genus, signed volume, and surface area analyzer |
| `src/dae/index.ts`         | `lowerThreeMfToDae` LPBF/SLA additive thermal build ODE lowering into `DAEBuilder` linear memory     |
| `src/projections/index.ts` | `threeMfToStep` and `threeMfToScad` translators to STEP AP242 CAD and OpenSCAD 3D CSG                |
| `src/workspace-index.ts`   | `ThreeMfWorkspaceIndex` implementing `IWorkspaceIndex` across `.3mf` files                           |
| `src/lsp.ts`               | LSP validation, document symbols, mesh topology hover cards, completion, and definition providers    |

---

## Pre-Flight Semantic Lint Rules (`M9701`–`M9710`)

| Code    | Rule                                      | Severity | Description                                                                                                              |
| ------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `M9701` | `three-mf-non-manifold-edge`              | `error`  | Mesh is not a closed watertight 2-manifold (contains open boundary edges or edges shared by $> 2$ triangles).            |
| `M9702` | `three-mf-degenerate-triangle`            | `error`  | Triangle references duplicate vertex indices ($v_1 = v_2$) or has collinear vertices (zero area).                        |
| `M9703` | `three-mf-negative-mesh-volume`           | `error`  | Mesh has non-positive signed volume ($V \le 0$), indicating inverted inward-pointing triangle winding normals.           |
| `M9704` | `three-mf-unresolved-build-object`        | `error`  | `<build><item objectid="..."/>` or `<component objectid="..."/>` references an undeclared `<object>`.                    |
| `M9705` | `three-mf-wall-thickness-violation`       | `error`  | Surgical guide wall thickness (`minWallThicknessMm`) or cannula clearance is below the $0.8\text{ mm}$ safety threshold. |
| `M9706` | `three-mf-invalid-osteotomy-guide-axis`   | `error`  | Surgical guide osteotomy cutting plane normal or drill sleeve axis vector has zero length.                               |
| `M9707` | `three-mf-missing-biocompatible-material` | `error`  | Surgical guide or implant object lacks an ISO 10993 / USP Class VI / ASTM F136 Ti-6Al-4V biocompatible material.         |
| `M9708` | `three-mf-singular-item-transform`        | `error`  | `<item transform="..."/>` $4 \times 3$ affine matrix has non-positive determinant ($\det(\mathbf{M}) \le 0$).            |
| `M9709` | `three-mf-out-of-bounds-vertex-index`     | `error`  | Triangle vertex index (`v1`, `v2`, or `v3`) is outside $[0, V - 1]$.                                                     |
| `M9710` | `three-mf-duplicate-object-id`            | `error`  | Duplicate `<object id="..."/>` declared within `<resources>`.                                                            |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx three-mf`)

```bash
# Lint a 3MF surgical guide or orthopaedic implant model (M9701-M9710)
npx msx three-mf lint mandibular_osteotomy_guide.3mf

# Verify watertight 2-manifold mesh topology, Euler characteristic, and signed volume
npx msx three-mf topology mandibular_osteotomy_guide.3mf

# Lower additive build thermal ODEs to DAE or project to STEP AP242 (.step) / OpenSCAD (.scad)
npx msx three-mf to-dae mandibular_osteotomy_guide.3mf
npx msx three-mf to-step mandibular_osteotomy_guide.3mf
npx msx three-mf to-scad mandibular_osteotomy_guide.3mf
```

### Programmatic API

```typescript
import {
  lintThreeMfDocument,
  lowerThreeMfToDae,
  parseThreeMf,
  threeMfToScad,
  threeMfToStep,
  verifyMeshTopology,
} from "@modelscript/three-mf";

// 1. Parse 3MF 1.2.3 XML and run 2-manifold & ISO 10993 surgical guide lints (M9701-M9710)
const doc = parseThreeMf(threeMfXml, "mandibular_guide.3mf");
const diagnostics = lintThreeMfDocument(doc);

// 2. Verify Euler-Poincaré 2-manifold watertightness and signed volume
const topo = verifyMeshTopology(doc);
console.log(`Watertight: ${topo.allWatertight}, Total Volume: ${topo.totalVolumeMm3.toFixed(1)} mm^3`);

// 3. Lower to WebAssembly DAEBuilder or export to STEP AP242 (.step) and OpenSCAD (.scad)
const dae = lowerThreeMfToDae(doc);
const stepSolid = threeMfToStep(doc);
const scadCode = threeMfToScad(doc);
```

---

## Scripts

| Command             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                       |
| `npm test`          | Run 3MF parser, 2-manifold topology analyzer, surgical guide linter, and STEP tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                |
| `npm run clean`     | Remove `dist/` build artifacts                                                      |

---

## License

`AGPL-3.0-or-later`
