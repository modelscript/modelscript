<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cad

ModelScript 3D Mechanical CAD (MCAD) and Electronic CAD (ECAD) engine — parametric Constructive Solid Geometry (CSG), OpenCascade (`opencascade.js`) and Manifold B-Rep kernel integration, ISO 10303-21 STEP AP214/AP242 serialization and import, static and reachability-certified dynamic clearance verification, GD&T tolerance stack-up analysis, parameter inversion, and full PCB Gerber/Autorouter/DRC workflows.

---

## Architecture & Capabilities

### 1. Parametric CSG Primitives, Transforms & Boolean Operations

- **Primitives (`src/primitives.ts`)**: `box`, `cylinder`, `sphere`, `torus`, `polyhedron`, `linearExtrude`, `fillet`, `chamfer`, and boundary patch tagging (`tagPatch`) for downstream FEA/CFD boundary condition binding (`fixed_support`, `pressure_load`, `inlet`, `outlet`, `wall`).
- **Affine Transforms (`src/transforms.ts`)**: `translate`, `rotate`, `scale`, `mirror`, 4×4 homogeneous matrix composition (`mat4Multiply`), and CST byte-range provenance tracking (`SolidSourceMetadata`, `TransformOffsetRange`) so interactive 3D viewport gizmos can patch source files directly.
- **Boolean Operations (`src/booleans.ts`, `src/csg-bsp.ts`)**: High-level `union`, `subtract`, and `intersect` combinators backed by both exact B-Rep evaluation and an in-memory 3D Binary Space Partitioning (`CsgBspNode`) polygon clipping kernel with analytical volume, surface area, centroid, and inertia tensor computation (`computeMeshVolumeAndArea`).
- **Assemblies (`src/assembly.ts`)**: Hierarchical multi-part assembly definitions (`assembly`, `part`) with physical material metadata and kinematic joint bindings.

### 2. OpenCascade B-Rep Kernel, Manifold CSG & Mesh Export

- **OpenCascade Worker (`src/worker.ts`)**: `CSGWorker` executes exact B-Rep boolean operations, fillets, chamfers, and topological face/edge extraction in a dedicated WebWorker via `opencascade.js`.
- **Manifold Worker (`src/manifold-worker.ts`)**: `ManifoldWorker` provides guaranteed-watertight manifold triangle mesh evaluation (`ManifoldSurfaceMesh`).
- **STEP ISO 10303-21 Serialization & Deserialization (`src/step-compiler.ts`, `occt-import-js`)**:
  - `compileToStep(solid)` and `compileAssemblyToStep(assembly)` emit standards-compliant ISO 10303-21 STEP (AP214 / AP242) B-Rep entities (`MANIFOLD_SOLID_BREP`, `ADVANCED_FACE`, `B_SPLINE_SURFACE`, `PRODUCT_DEFINITION_SHAPE`, and color/material styling).
  - Supports STEP B-Rep deserialization and triangulated STL / glTF 2.0 / GLB mesh export for 3D web visualization and tetrahedral meshing.

### 3. Spatial Clearance, Swept-Volume Reachability & GD&T Verification

- **Static Assembly Clearance (`src/clearance.ts`)**: Computes tight axis-aligned bounding boxes (`computeSolidAABB`, `transformAABB`), minimum Euclidean part-to-part separation (`computeAABBDistance`, `computeAABBClosestPoints`), projected aerodynamic frontal area (`computeProjectedFrontalArea`), and assembly-wide clearance violation reports (`verifyAssemblyClearance`).
- **Reachability-Certified Dynamic Clearance (`src/dynamic-clearance.ts`)**: `DynamicClearanceVerifier` couples continuous-time simulation trajectories and zonotope/interval reachability flowpipes (`TrajectoryStepEnclosure`, `DynamicTransformBinding`, `DynamicDeformationBinding`) with 3D geometry to certify that moving multibody links and thermo-elastic deformations never collide or breach minimum safety clearances over an entire operational envelope.
- **Dynamic GD&T & Tolerance Stack-Up (`src/tolerance-stack.ts`)**: `ToleranceStackVerifier` performs 1D/3D worst-case, Root-Sum-Square (RSS), and Monte Carlo Geometric Dimensioning and Tolerancing (GD&T) stack-up analysis (`DimensionTolerance`, `OperationalEnvironment`), accounting for thermal expansion ($\alpha \Delta T$) and structural deflection contributors.

### 4. Parameter Inversion, Kinematics & Large-Assembly Rendering

- **Inverse Kinematics & Parameter Inversion (`src/parameter-inversion.ts`, `src/rom_load_pipeline.ts`)**:
  - `ParameterInversionEngine` solves constrained inverse design problems—computing the exact CAD geometric parameter updates (`ParameterInversionUpdate`, `CertifiedInversionResult`) required to satisfy target mass, frontal area, or stress safety guards (`SafeRegionGuard`).
  - `RomLoadPipeline` maps peak transient loads from 1D Modelica simulations (`TransientPeakLoad`) onto 3D tagged CAD boundary patches (`FeaBoundaryCondition`).
- **Kinematics & Animation (`src/kinematics.ts`, `src/animation-controller.ts`, `src/binding-writer.js`)**: Unit quaternion algebra (`quaternionSlerp`, `quaternionFromEuler`, `composeTransformMatrix`), cubic Hermite trajectory interpolation (`hermiteInterpolate`), `AnimationController` for synchronized 6-DOF multibody playback, and `patchModelicaCadAnnotation` for round-trip Modelica CAD annotation persistence.
- **Large-Assembly BVH, Instancing & Level of Detail (`src/bvh.ts`, `src/instancing.ts`, `src/lod.ts`)**:
  - `AssemblyBVH`: Hierarchical Bounding Volume Hierarchy for fast raycasting (`RaycastHit`) and 6-plane camera frustum culling.
  - `AssemblyClusteringEngine` & `InstanceBatchBuffer`: Automatic geometric deduplication and GPU instanced draw-call batching.
  - `selectLoDTier` & `generateBoxProxyMesh`: Screen-space diameter Level-of-Detail (LoD) switching.

### 5. Electronic CAD (ECAD) Engine (`@modelscript/cad/ecad`)

Located under `src/ecad/`, the ECAD subsystem provides complete printed circuit board (PCB) inspection, routing, and verification:

- **RS-274X Gerber Parser (`src/ecad/gerber.ts`)**: Parses standard Gerber RS-274X / X2 aperture definitions (`%ADD...*%`), macro primitives, linear/circular interpolation traces, region fills (`G36`/`G37`), and Excellon NC drill files.
- **PCB Netlist & Ratsnest (`src/ecad/netlist.ts`)**: Extracts component footprints, pads, nets, and minimum spanning tree ratsnest connectivity.
- **Interactive & A\* Autorouter (`src/ecad/engine/router.ts`)**: `PCBRouter` supports grid-based obstacle-avoiding A\* trace routing, interactive push-and-shove / walkaround modes, via insertion, and configurable track width/clearance rules (`RoutingRules`).
- **Design Rule Checking (`src/ecad/engine/drc.ts`)**: `runDRC` verifies copper-to-copper clearance, minimum trace width, annular ring width, drill-to-drill spacing, board edge keepouts, and unrouted net completeness (`DRCResult`, `DRCViolation`).
- **2D/3D PCB Stackup Renderer (`src/ecad/engine/renderer.ts`)**: `PCBRenderer` renders multi-layer copper (`F.Cu`, `B.Cu`, inner planes), solder mask, silkscreen, pads, vias, ratsnest lines, and DRC markers to SVG and 3D WebGL viewports.

---

## Usage

```typescript
import {
  assembly,
  box,
  compileAssemblyToStep,
  cylinder,
  DynamicClearanceVerifier,
  part,
  subtract,
  ToleranceStackVerifier,
  translate,
  verifyAssemblyClearance,
} from "@modelscript/cad";
import { PCBRouter, parseGerber, runDRC } from "@modelscript/cad/ecad";

// 1. Construct parametric CSG geometry and export to ISO 10303-21 STEP
const plate = box({ width: 120, height: 80, depth: 10, name: "BasePlate" });
const bore = translate(cylinder({ radius: 12, height: 14 }), [0, 0, -2]);
const machinedPlate = subtract(plate, bore);

const droneAssembly = assembly("DroneFrame", [part("Base", machinedPlate, { material: "Al-7075-T6", density: 2810 })]);
const stepText = compileAssemblyToStep(droneAssembly);

// 2. Verify static & dynamic clearance and GD&T tolerance stack-up
const clearanceReport = verifyAssemblyClearance(droneAssembly, [
  { partA: "Base", partB: "MotorMount", minDistance: 2.0 },
]);
const stackVerifier = new ToleranceStackVerifier();
const stackResult = stackVerifier.analyze({
  nominalGap: 1.5,
  minAllowedGap: 0.25,
  contributors: [
    { name: "HousingLength", nominal: 50.0, plusTol: 0.1, minusTol: 0.1, direction: 1, cte: 23e-6 },
    { name: "ShaftLength", nominal: 48.5, plusTol: 0.08, minusTol: 0.08, direction: -1, cte: 12e-6 },
  ],
  environment: { deltaTemperatureK: 65 },
});

// 3. Parse Gerber layer and run PCB Design Rule Check (DRC)
const topCopper = parseGerber(gerberSourceText);
const drcReport = runDRC({ traces: topCopper.traces, pads: topCopper.pads, vias: [] });
```

---

## Scripts

```bash
# Build TypeScript declarations and ES modules
npm run build --workspace=@modelscript/cad

# Run unit tests (CSG, STEP, clearance, tolerance stack-up, Gerber, DRC)
npm run test --workspace=@modelscript/cad

# Typecheck and lint
npm run typecheck --workspace=@modelscript/cad
npm run lint --workspace=@modelscript/cad
```
