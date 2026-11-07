<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/usd

OpenUSD (`.usda`, `.usdc`, `.usdz`) 3D scene description, `UsdPhysics` rigid-body dynamics, and spatial simulation language package for ModelScript. Features a zero-regex OpenUSD ASCII (`.usda`) parser (`parseUsd`), multi-file workspace indexing (`UsdWorkspaceIndex`), direct linear-memory `DAEBuilder` lowering (`lowerUsdToDae`), 6 `UsdPhysics` and stage integrity lint rules (`USD1002`–`USD1007`, `lintUsdStage`), CSG and multi-body assembly exporters (`compileToUsd`, `compileToUsdz`, `compileAssemblyToUsd`, `compileAssemblyToUsdz`, `createUsdzArchive`), and Language Server Protocol (LSP) services (`UsdLspService`).

---

## Core Capabilities

- **Zero-Regex OpenUSD `.usda` Parser (`parseUsd`)**: Parses OpenUSD stage metadata (`defaultPrim`, `upAxis`, `metersPerUnit`, `timeCodesPerSecond`, `startTimeCode`, `endTimeCode`), hierarchical prim trees (`def`, `over`, `class` for `Xform`, `Scope`, `Mesh`, `Cube`, `Sphere`, `Cylinder`, `Capsule`, `Cone`, `PhysicsScene`, `PhysicsRevoluteJoint`, `PhysicsPrismaticJoint`, `PhysicsFixedJoint`, `PhysicsSphericalJoint`, `Material`, `Shader`), applied API schemas (`PhysicsRigidBodyAPI`, `PhysicsMassAPI`, `PhysicsCollisionAPI`, `PhysicsDriveAPI`), typed attributes (`double3`, `float3`, `quatf`, `matrix4d`, `point3f[]`, `int[]`), and `rel` relationships (`physics:body0`, `physics:body1`, `material:binding`).
- **`UsdPhysics` Linear-Memory `DAEBuilder` Lowering (`lowerUsdToDae`)**: Lowers `PhysicsScene` gravitational vectors, `PhysicsRigidBodyAPI` 6-DOF translational/rotational states, `PhysicsMassAPI` mass and principal inertia tensors, and `PhysicsRevoluteJoint` / `PhysicsPrismaticJoint` constraint and `PhysicsDriveAPI` PD actuator dynamics directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **Stage & `UsdPhysics` Semantic Linter (`USD1002`–`USD1007`, `lintUsdStage`)**: Static verification of relationship target paths (`</World/...>`), stage `upAxis` compliance (`'Y'` or `'Z'`), strictly positive rigid-body mass, non-negative principal inertia components, joint limit ordering (`physics:lowerLimit <= physics:upperLimit`), and valid joint axis tokens (`'X'`, `'Y'`, `'Z'`).
- **CSG, Mesh & `.usdz` Archive Compilation (`compileToUsd`, `compileToUsdz`, `compileAssemblyToUsd`, `compileAssemblyToUsdz`, `createUsdzArchive`)**: Compiles `@modelscript/cad` CSG solid primitives and kinematic assemblies into OpenUSD `.usda` stages and uncompressed 64-byte-aligned `.usdz` archives ready for NVIDIA Omniverse, Isaac Sim, and Apple VisionOS.
- **Multi-File Workspace Indexing & LSP (`UsdWorkspaceIndex`, `UsdLspService`)**: Implements `IWorkspaceIndex` across `.usda`, `.usd`, and `.usdz` files with hierarchical SdfPath symbol lookup (`</World/Robot/Base>`), hover cards, completions, and go-to-definition.

---

## Package Structure

| Path                       | Description                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                                            |
| `src/language.ts`          | `usdLanguage` definition and LSP/compiler bindings                                                                |
| `src/parser/usd-parser.ts` | `parseUsd` recursive-descent `.usda` parser for stage metadata, prim hierarchies, schemas, attributes, and `rel`s |
| `src/lints/usd-lints.ts`   | `lintUsdStage` semantic and `UsdPhysics` diagnostic engine (`USD1002`–`USD1007`)                                  |
| `src/dae/usd-dae.ts`       | `lowerUsdToDae` direct lowering of `UsdPhysics` rigid bodies, joints, and drives into `DAEBuilder` linear memory  |
| `src/usd-exporter.ts`      | `compileToUsd`, `compileToUsdz`, `compileAssemblyToUsd`, `compileAssemblyToUsdz`, and `createUsdzArchive`         |
| `src/workspace-index.ts`   | `UsdWorkspaceIndex` implementing `IWorkspaceIndex` across `.usda` and `.usd` workspace stages                     |
| `src/lsp.ts`               | `UsdLspService` providing diagnostics, SdfPath document symbols, hover, completion, and definition providers      |

---

## Pre-Flight Semantic Lint Rules (`USD1002`–`USD1007`)

| Code      | Severity | Description                                                                                                          |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `USD1002` | `error`  | Relationship (`rel physics:body0`, `rel physics:body1`, `rel material:binding`) targets a non-existent prim SdfPath. |
| `USD1003` | `error`  | Invalid stage `upAxis` metadata — OpenUSD requires `'Y'` or `'Z'`.                                                   |
| `USD1004` | `error`  | `PhysicsMassAPI` specifies non-positive `physics:mass` ($\le 0$).                                                    |
| `USD1005` | `error`  | `PhysicsMassAPI` specifies negative principal inertia component in `physics:diagonalInertia` ($< 0$).                |
| `USD1006` | `error`  | Joint specifies inverted limits where `physics:lowerLimit > physics:upperLimit`.                                     |
| `USD1007` | `error`  | Joint specifies invalid `physics:axis` token (must be `'X'`, `'Y'`, or `'Z'`).                                       |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx`)

```bash
# Lint an OpenUSD stage or inspect hierarchy
npx msx lint robot_arm.usda
npx msx inspect robot_arm.usda

# Lower UsdPhysics rigid-body & joint dynamics to DAE and simulate
npx msx flatten robot_arm.usda
npx msx simulate robot_arm.usda --stop-time 5.0
```

### Programmatic API

```typescript
import { compileToUsd, compileToUsdz, lintUsdStage, lowerUsdToDae, parseUsd } from "@modelscript/usd";

const usdaSource = `#usda 1.0
(
    defaultPrim = "World"
    upAxis = "Z"
    metersPerUnit = 1.0
)

def Xform "World"
{
    def PhysicsScene "PhysicsScene"
    {
        vector3f physics:gravityDirection = (0, 0, -1)
        float physics:gravityMagnitude = 9.81
    }

    def Cube "Base" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:kinematicEnabled = true
        float physics:mass = 5.0
    }

    def Cylinder "Pendulum" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        float physics:mass = 1.2
        float3 physics:diagonalInertia = (0.05, 0.05, 0.01)
    }

    def PhysicsRevoluteJoint "Hinge"
    {
        uniform token physics:axis = "Y"
        rel physics:body0 = </World/Base>
        rel physics:body1 = </World/Pendulum>
        float physics:lowerLimit = -90.0
        float physics:upperLimit = 90.0
    }
}
`;

// 1. Parse OpenUSD ASCII stage and run UsdPhysics semantic lints (USD1002-USD1007)
const stage = parseUsd(usdaSource);
const diagnostics = lintUsdStage(stage);

// 2. Lower UsdPhysics rigid bodies and joints directly to WebAssembly DAEBuilder
const dae = lowerUsdToDae(stage);
console.log("Lowered DAE states and equations:", dae.getStats());
```

---

## Scripts

| Command             | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                           |
| `npm test`          | Run OpenUSD `.usda` parser, `UsdPhysics` linter, DAE, and `.usdz` tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                   |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                    |
| `npm run clean`     | Remove `dist/` build artifacts                                          |

---

## License

`AGPL-3.0-or-later`
