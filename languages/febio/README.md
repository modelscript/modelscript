<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/febio

FEBio 3.x / 4.x (`.feb`) and SOFA Framework (`.scn`) soft-tissue biomechanics, hyperelastic continuum mechanics, biphasic poroelasticity, and real-time surgical simulation language package for ModelScript.

---

## Core Capabilities

- **FEBio 3.x/4.x & SOFA `.scn` Parser**: Parses `<febio_spec>` XML models (materials, nodes, `tet4`/`hex8` elements, node sets, surfaces, solid domains, boundary conditions, loads, contact interfaces, time steppers) and SOFA Framework `<Node>` surgical scene graphs (`<MechanicalObject>`, `<TetrahedronFEMForceField>`, `<MassSpringForceField>`, `<FixedConstraint>`).
- **Biomechanics & Mesh Quality Linter (`M9401`–`M9410`)**: Validates hyperelastic/elastic material constants, element Jacobian determinants ($\det(\mathbf{J}) > 0$), connectivity references, rigid-body constraints, biphasic permeability and porosity bounds, time-stepper parameters, contact penalties, and SOFA state containers.
- **Hyperelastic & Biphasic Mechanics Solver**: Evaluates neo-Hookean and Mooney-Rivlin strain energy density $W = C_1(I_1 - 3) + C_2(I_2 - 3) + \frac{K}{2}(J - 1)^2$, principal Cauchy stresses $\boldsymbol{\sigma}$, von Mises stresses, Darcy interstitial fluid flux, and nodal displacements.
- **Linear-Memory DAE Lowering & Cross-Domain Projections**: Lowers tissue constitutive laws and nodal kinematics into ModelScript's `DAEBuilder` arena and projects models to CalculiX- / Abaqus-compatible (`.inp`) and Modelica 3.x (`.mo`).
- **LSP & Workspace Index Integration**: Provides document symbols, constitutive hover cards, completions, go-to-definition, and multi-file symbol indexing via `FebioWorkspaceIndex`.

---

## Package Structure

| Path                     | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                               |
| `src/language.ts`        | FEBio & SOFA language definition (`.feb`, `.scn`) and registered actions            |
| `src/types.ts`           | Domain types for FEBio meshes, materials, BCs, contacts, and SOFA scenes            |
| `src/parser/`            | FEBio 3.x/4.x XML, SOFA `.scn` XML, and biomechanics DSL parser                     |
| `src/lints/`             | Biomechanics, mesh Jacobian, and SOFA scene graph semantic linter (`M9401`–`M9410`) |
| `src/solver/`            | Hyperelastic / Mooney-Rivlin solver and linear-memory `DAEBuilder` lowering         |
| `src/projections/`       | Projections to CalculiX `.inp` and Modelica 3.x biomechanics models                 |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer (`FebioWorkspaceIndex`)                         |
| `src/lsp.ts`             | Language Server Protocol diagnostics, hover, completion, and symbol service         |
