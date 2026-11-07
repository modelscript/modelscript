<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/febio

FEBio (`.feb` v2.5 / v3.0 / v4.0) & SOFA Framework (`.scn`) Nonlinear Soft-Tissue Biomechanics, Hyperelasticity (`Neo-Hookean`, `Mooney-Rivlin`, `Ogden`, `Holzapfel-Gasser-Ogden`), Biphasic Poroelasticity, and Real-Time Surgical Deformable Physics language package for ModelScript. Features a unified FEBio `.feb` & SOFA `.scn` XML parser (`parseFebio`), multi-file workspace indexing (`FebioWorkspaceIndex`), 3D tetrahedral/hexahedral Jacobian and hyperelastic Cauchy stress solver (`computeElementJacobianDeterminant`, `solveHyperelasticMechanics`), direct linear-memory `DAEBuilder` lowering (`lowerFebioToDae`), 10 continuum biomechanics lint rules (`M9401`–`M9410`, `lintFebioDocument`, `FebioErrorCode`), CalculiX/Abaqus `.inp` and Modelica 3.x projections (`febioToCalculixInp`, `febioToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **FEBio 2.5 / 3.0 / 4.0 `.feb` & SOFA `.scn` Parser (`parseFebio`)**: Parses `<febio_spec>` documents (`<Module>`, `<Control>`, `<Material>`, `<Mesh>` / `<Geometry>` `<Nodes>`, `<Elements>` (`tet4`, `hex8`), `<NodeSet>`, `<Surface>`, `<MeshDomains>`, `<Boundary>`, `<Loads>`, `<Contact>`) and SOFA Framework `<Node>` scene hierarchies (`<MechanicalObject>`, `<TetrahedronFEMForceField>`, `<FixedConstraint>`, `<UniformMass>`).
- **Hyperelastic & Biphasic Continuum Mechanics Solver (`solveHyperelasticMechanics`, `computeElementJacobianDeterminant`)**: Evaluates 3D element isoparametric Jacobian determinants $\det(\mathbf{J})$, principal stretches $(\lambda_1, \lambda_2, \lambda_3)$, strain energy density $W(I_1, I_2, J)$, Cauchy and von Mises stress fields ($\sigma_{vm}$), and biphasic interstitial fluid pressure dissipation $\tau_p = H_A k / L^2$.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerFebioToDae`)**: Lowers nodal viscoelastic displacement/velocity states, hyperelastic restoring forces, and biphasic interstitial pore pressure ODEs directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **10 Continuum Biomechanics & Mesh Quality Lint Rules (`M9401`–`M9410`, `lintFebioDocument`)**: Static verification of thermodynamic material constants ($E > 0$, $-1 < \nu < 0.5$, $c_1 + c_2 > 0$), inverted element Jacobians ($\det(\mathbf{J}) \le 0$), node/set/surface references, unconstrained rigid-body modes, biphasic permeability ($k > 0$, $\phi^s \in (0, 1)$), time-step controls, material ID bindings, contact penalties, SOFA `<MechanicalObject>` state containers, and duplicate entity IDs.
- **CalculiX / Abaqus `.inp` & Modelica 3.x Projections (`febioToCalculixInp`, `febioToModelica`)**: Translates FEBio/SOFA models into CalculiX/Abaqus `.inp` finite element decks (`@modelscript/fea`) and lumped viscoelastic/poroelastic Modelica 3.x models.

---

## Package Structure

| Path                       | Description                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                                |
| `src/language.ts`          | `febioLanguage` definition and compiler actions                                                       |
| `src/types.ts`             | `FebioDocument`, `FebioMaterial`, `FebioNode`, `FebioElement`, `FebioBoundaryCondition`, `SofaNode`   |
| `src/parser/index.ts`      | `parseFebio` unified FEBio `.feb` (v2.5–v4.0) and SOFA `.scn` XML parser                              |
| `src/lints/rules.ts`       | `FebioErrorCode`, `lintFebioDocument` (`M9401`–`M9410`), and `computeElementJacobianDeterminant`      |
| `src/lints/index.ts`       | Linter barrel exports                                                                                 |
| `src/solvers/index.ts`     | `solveHyperelasticMechanics` hyperelastic Cauchy/von Mises stress and biphasic consolidation solver   |
| `src/dae/index.ts`         | `lowerFebioToDae` direct lowering of viscoelastic and biphasic states into `DAEBuilder` linear memory |
| `src/projections/index.ts` | `febioToCalculixInp` and `febioToModelica` cross-language translators                                 |
| `src/workspace-index.ts`   | `FebioWorkspaceIndex` implementing `IWorkspaceIndex` across `.feb` and `.scn` files                   |
| `src/lsp.ts`               | LSP validation, document symbols, hover, completion, and definition providers                         |

---

## Pre-Flight Semantic Lint Rules (`M9401`–`M9410`)

| Code    | Rule                                   | Severity  | Description                                                                                                                   |
| ------- | -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `M9401` | `febio-invalid-material-constant`      | `error`   | Non-physical elastic or hyperelastic constant ($E \le 0$, $\nu \le -1$ or $\nu \ge 0.5$, $\rho \le 0$, or $c_1 + c_2 \le 0$). |
| `M9402` | `febio-inverted-element-jacobian`      | `error`   | `tet4` or `hex8` element has non-positive isoparametric Jacobian determinant ($\det(\mathbf{J}) \le 0$).                      |
| `M9403` | `febio-unresolved-node-or-set`         | `error`   | Element, boundary condition, or load references an undeclared node ID, `<NodeSet>`, or `<Surface>`.                           |
| `M9404` | `febio-unconstrained-rigid-body`       | `warning` | Model defines no fixed or prescribed displacement boundary conditions to constrain rigid-body translation/rotation.           |
| `M9405` | `febio-invalid-biphasic-permeability`  | `error`   | Biphasic/poroelastic material specifies hydraulic permeability $k \le 0$ or solid volume fraction $\phi^s \notin (0, 1)$.     |
| `M9406` | `febio-invalid-time-stepper`           | `error`   | `<Control>` section specifies `time_steps <= 0` or `step_size <= 0`.                                                          |
| `M9407` | `febio-unresolved-material-id`         | `error`   | `<SolidDomain>` or element block references an undeclared `mat` material ID.                                                  |
| `M9408` | `febio-contact-penalty-invalid`        | `error`   | `<Contact>` interface specifies non-positive penalty factor ($\le 0$) or references an empty surface.                         |
| `M9409` | `febio-sofa-missing-mechanical-object` | `error`   | SOFA `.scn` `<Node>` containing a force field or mass component lacks a `<MechanicalObject>` state container.                 |
| `M9410` | `febio-duplicate-entity-id`            | `error`   | Duplicate node, element, or material ID declared in `<febio_spec>`.                                                           |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx febio`)

```bash
# Lint an FEBio (.feb) or SOFA (.scn) biomechanics model (M9401-M9410)
npx msx febio lint arterial_wall.feb

# Solve hyperelastic Cauchy/von Mises stress and biphasic pore pressure
npx msx febio solve arterial_wall.feb --stretch 1.25

# Lower to DAE or project to CalculiX/Abaqus (.inp) and Modelica (.mo)
npx msx febio to-dae arterial_wall.feb
npx msx febio to-calculix arterial_wall.feb
npx msx febio to-modelica arterial_wall.feb
```

### Programmatic API

```typescript
import {
  febioToCalculixInp,
  febioToModelica,
  lintFebioDocument,
  lowerFebioToDae,
  parseFebio,
  solveHyperelasticMechanics,
} from "@modelscript/febio";

// 1. Parse FEBio 4.0 .feb XML (or SOFA .scn) and run biomechanics lints (M9401-M9410)
const doc = parseFebio(febXml, "arterial_wall.feb");
const diagnostics = lintFebioDocument(doc);

// 2. Solve hyperelastic stress-stretch response and mesh Jacobian quality
const mechanics = solveHyperelasticMechanics(doc, 1.25);
console.log(`Max von Mises stress: ${mechanics.maxVonMisesStressKPa.toFixed(2)} kPa`);

// 3. Lower to WebAssembly DAEBuilder or project to CalculiX .inp and Modelica 3.x
const dae = lowerFebioToDae(doc);
const calculixInp = febioToCalculixInp(doc);
const modelicaCode = febioToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                   |
| `npm test`          | Run FEBio/SOFA parser, Jacobian/hyperelastic linter, solver, and CalculiX tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                           |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                            |
| `npm run clean`     | Remove `dist/` build artifacts                                                  |

---

## License

`AGPL-3.0-or-later`
