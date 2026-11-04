# FEBio & SOFA Soft-Tissue Biomechanics (`.feb`, `.scn`)

`@modelscript/febio` (`languages/febio`) provides native WebAssembly parsing, hyperelastic and biphasic poroelastic material stability verification, element Jacobian volume positivity checking, non-linear strain-energy and Cauchy stress evaluation, `DAEBuilder` lowering, and CalculiX `.inp` / Modelica projections for **FEBio (`febio_spec` 3.0 / 4.0)** soft-tissue biomechanics and **SOFA Framework (`.scn`)** real-time surgical simulation scenes.

---

## Supported Extensions & Standards

| Extension | Format              | Description                                                                                                          |
| :-------- | :------------------ | :------------------------------------------------------------------------------------------------------------------- |
| `.feb`    | FEBio Specification | XML specification of `Material`, `Mesh` / `Geometry`, `Boundary`, `Loads`, `Contact`, and `Step` blocks              |
| `.scn`    | SOFA Scene Graph    | Simulation Open Framework Architecture (`Node`, `MechanicalObject`, `TetrahedronFEMForceField`, `CollisionPipeline`) |

---

## Key Capabilities

### 1. Hyperelastic, Viscoelastic & Biphasic Constitutive Models

- Parses and evaluates soft-tissue strain energy density functions $W(\mathbf{C})$ across biological constitutive laws:
  - **Neo-Hookean & Mooney-Rivlin**: $W = C_1(I_1 - 3) + C_2(I_2 - 3) + \frac{1}{2}K(\ln J)^2$
  - **Ogden Hyperelastic**: $W = \sum_{p=1}^N \frac{\mu_p}{\alpha_p}\left(\lambda_1^{\alpha_p} + \lambda_2^{\alpha_p} + \lambda_3^{\alpha_p} - 3\right)$
  - **Holmes-Mow & Biphasic Poroelastic**: Articular cartilage fluid-solid mixture hydraulic permeability $k$ and interstitial fluid pressure.
- Enforces **Drucker stability** ($\mu_p \alpha_p > 0$), positive bulk/shear moduli, and positive element Jacobians ($\det \mathbf{J} > 0$).

### 2. CalculiX FEA, Modelica & DAE Lowering

- Solves Principal stretches, Cauchy stresses, and strain energy densities (`solveHyperelasticMechanics`), exports to **CalculiX / Abaqus `.inp`** (`febioToCalculixInp`) and **Modelica** (`febioToModelica`), and lowers lumped compliance dynamics into `DAEBuilder`.

---

## Pre-Flight Diagnostics

<LintRules lang="febio" />

---

## CLI Usage

```bash
# Inspect FEBio materials, mesh nodes/elements, and boundary conditions
msx febio inspect LiverHyperelastic.feb

# Validate Drucker hyperelastic stability and element Jacobian determinants
msx febio validate LiverHyperelastic.feb

# Solve hyperelastic strain energy and Cauchy stress response
msx febio solve LiverHyperelastic.feb

# Project FEBio mesh and materials to CalculiX/Abaqus .inp or Modelica
msx febio to-inp LiverHyperelastic.feb > LiverHyperelastic.inp
msx febio to-modelica LiverHyperelastic.feb > LiverHyperelastic.mo
```
