<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/usd

Alliance for OpenUSD (`.usd`, `.usda`, `.usdz`) digital twin scene description, `UsdPhysics` articulated robotics kinematics & dynamics engine, 64-byte aligned package archiver, semantic linter (`USD_*`), and linear WebAssembly `DAEBuilder` lowering for ModelScript.

---

## Core Capabilities

- **ASCII OpenUSD Parser & Scene Graph (`parseUsd`)**: Streaming parser for `.usda` stage headers, stage metadata (`defaultPrim`, `metersPerUnit`, `upAxis`), prim blocks (`def`, `over`, `class`), nested hierarchies, typed attributes, and relationships.
- **`UsdPhysics` Articulated Lowering (`lowerUsdToDae`)**: Lowers `PhysicsRigidBodyAPI`, `PhysicsMassAPI`, and kinematic joints (`PhysicsRevoluteJoint`, `PhysicsPrismaticJoint`, `PhysicsFixedJoint`) directly into ModelScript's `DAEBuilder` linear WebAssembly memory arena for simulation.
- **7 `USD_*` Pre-flight Semantic Linter Rules (`lintUsdStage`)**: Validates prim path syntax, detects dangling joint parent/child relationship targets, enforces positive mass and inertia constraints, and checks joint angle/translation limits.
- **Language Server Protocol (`UsdLspService`)**: Full language intelligence including document symbols outline hierarchy (`/Stage/Link/Mesh`), hover documentation for OpenUSD/UsdPhysics schemas, and diagnostic publishing.
- **64-Byte Aligned USDZ Archiver (`createUsdzArchive`)**: Generates uncompressed ZIP archives with strict 64-byte payload offsets conforming to the Alliance for OpenUSD and Apple AR Quick Look / Vision Pro specifications.
