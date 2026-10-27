---
title: MSC Adams Multibody Dynamics & Mechanism Simulation
description: Native compiler support for MSC Adams (.adm, .cmd) mechanism decks, 3D kinematics, Grübler mobility analysis, and bidirectional SIMPACK/Modelica projections in ModelScript.
---

# MSC Adams Multibody Dynamics

ModelScript features comprehensive, native support for **MSC Adams** (`.adm`, `.cmd`), the classic industrial standard for mechanical systems simulation and multibody dynamics (MBD). Engineers can parse legacy Adams View command files and solver datasets, perform Grübler-Kutzbach spatial mobility analysis, evaluate 3D joint constraint residuals, and project mechanisms to modern SIMPACK and Modelica formats.

---

## Capabilities & Supported Formats

| Format                      | Extension | Description                                                                                                                                                           |
| :-------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adams Solver Dataset**    | `.adm`    | Numerical dataset specifying rigid parts (`PART`), marker frames (`MARKER`), kinematic joints (`JOINT`), force elements (`SPRINGDAMPER`, `BUSHING`), and constraints. |
| **Adams View Command File** | `.cmd`    | Interactive parametric command scripts defining mechanism geometry, design variables, and simulation runs.                                                            |

### Key Architectural Features

- **Lexer & Parser:**
  - Robust deck ingestion supporting scientific notation (`1.5D-03`), inline comments (`!`), line continuations (`...`), and block cards.
  - Lossless serialization back to standardized `.adm` solver format via `serializeAdams()`.
- **Spatial 3D Kinematics:**
  - Full evaluation of Euler 3-1-3 and Tait-Bryan 1-2-3 rotation matrices.
  - Analytical joint constraint formulation for standard spatial joint primitives (Revolute, Spherical, Prismatic, Cylindrical, Planar, Universal).
- **Grübler-Kutzbach Mobility Analysis:**
  - Calculates mechanism degrees of freedom ($M = 6(n - 1) - \sum c_i$).
  - Identifies redundant kinematic constraints and overconstrained multi-loop linkages.
- **Multibody Linters (`M7301`–`M7310`):**
  - Flags missing ground parts, dangling marker references, unphysical inertia tensors violating the triangle inequality ($I_{xx} + I_{yy} \ge I_{zz}$), massless moving parts, and negative spring/damping parameters.
- **Cross-Domain Projections:**
  - **SIMPACK MBD:** Maps parts, markers, and spatial joints to SIMPACK `.spck` XML models.
  - **Modelica MultiBody:** Synthesizes standard `Modelica.Mechanics.MultiBody` parts and joint components.

---

## Command Line Interface (`msx adams`)

```bash
msx adams <action> [files...] [options]
```

| Action            | Description                                                                    | Key Options                                                     |
| :---------------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **`lint`**        | Runs structural validation, inertia verification, and kinematic sanity checks. | —                                                               |
| **`mobility`**    | Evaluates spatial degrees of freedom and overconstrained loops.                | —                                                               |
| **`to-simpack`**  | Projects Adams mechanism to SIMPACK XML (`.spck`).                             | `--out=<file.spck>`                                             |
| **`to-modelica`** | Projects Adams mechanism to `Modelica.Mechanics.MultiBody`.                    | `--out=<file.mo>`                                               |
| **`simulate`**    | Lowers to a DAE and integrates it in time.                                     | `--stop-time`, `--step`, `--stabilization=baumgarte\|algebraic` |

### Examples

```bash
# Calculate mechanism spatial degrees of freedom
msx adams mobility FourBarLinkage.adm

# Validate inertia tensors and marker references
msx adams lint LandingGear.adm

# Convert Adams dataset into SIMPACK XML format
msx adams to-simpack RobotArm.adm --out=RobotArm.spck

# Compute mechanism mobility (degrees of freedom)
msx adams mobility ExcavatorMechanism.adm
```

---

## Multibody Linters & Diagnostic Rules

<LintRules lang="adams" />
