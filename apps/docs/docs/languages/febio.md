---
title: FEBio & SOFA Soft-Tissue Biomechanics (.feb, .scn)
description: Native WebAssembly parsing, hyperelastic and biphasic poroelastic material stability verification, element Jacobian volume positivity checking, Cauchy stress evaluation, DAEBuilder lowering, and CalculiX / Modelica projections for FEBio and SOFA.
---

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

`@modelscript/febio` parses and evaluates soft-tissue strain energy density functions $W(\mathbf{C})$ over the right Cauchy-Green deformation tensor $\mathbf{C} = \mathbf{F}^\top \mathbf{F}$, principal stretches $(\lambda_1, \lambda_2, \lambda_3)$, and volume ratio $J = \det \mathbf{F} = \lambda_1 \lambda_2 \lambda_3$:

| Constitutive Law        | Strain Energy Density $W(\lambda_1, \lambda_2, \lambda_3, J)$                                                                                                               | Stability & Physical Constraints                                              |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| **Neo-Hookean**         | $W = \frac{\mu}{2}(I_1 - 3) - \mu \ln J + \frac{\lambda}{2}(\ln J)^2$                                                                                                       | $\mu > 0, \quad K = \lambda + \frac{2}{3}\mu > 0$                             |
| **Mooney-Rivlin**       | $W = C_1(\tilde{I}_1 - 3) + C_2(\tilde{I}_2 - 3) + \frac{K}{2}(\ln J)^2$                                                                                                    | $C_1 + C_2 > 0, \quad K > 0$                                                  |
| **Ogden ($N$-term)**    | $W = \sum_{p=1}^N \frac{\mu_p}{\alpha_p}\left(\tilde{\lambda}_1^{\alpha_p} + \tilde{\lambda}_2^{\alpha_p} + \tilde{\lambda}_3^{\alpha_p} - 3\right) + \frac{K}{2}(J - 1)^2$ | **Drucker stability**: $\sum_{p=1}^N \mu_p \alpha_p > 0$                      |
| **Holmes-Mow Biphasic** | $W_s(I_1, I_2, J) + \text{Darcy interstitial fluid flux } \mathbf{w} = -k(J) \nabla p$                                                                                      | Hydraulic permeability $k_0 > 0$, solid volume fraction $\phi_0^s \in (0, 1)$ |

### 2. Cauchy Stress Solver & Mesh Jacobian Verification

- Evaluates principal Cauchy stresses $\sigma_i = \frac{\lambda_i}{J} \frac{\partial W}{\partial \lambda_i}$ and verifies **3D tetrahedral/hexahedral element orientation** ($\det \mathbf{J}_e > 0$) across all mesh elements to prevent inverted or zero-volume elements prior to non-linear Newton-Raphson equilibrium iterations:
  $$\det \mathbf{J}_{\text{tet}} = \det \begin{bmatrix} \mathbf{x}_2 - \mathbf{x}_1 & \mathbf{x}_3 - \mathbf{x}_1 & \mathbf{x}_4 - \mathbf{x}_1 \end{bmatrix} > 0$$

### 3. CalculiX FEA, Modelica & DAE Lowering

- **CalculiX / Abaqus `.inp` & Modelica Export**: Projects FEBio meshes, node/element sets, boundary conditions, and hyperelastic material cards directly into **CalculiX- / Abaqus-compatible `.inp`** decks (`febioToCalculixInp`) and **Modelica 3.x** Kelvin-Voigt viscoelastic compliance models (`febioToModelica`).
- **`DAEBuilder` Arena Lowering**: Lowers lumped viscoelastic deformation and biphasic interstitial pore-pressure relaxation ODEs into `@modelscript/runtime`'s `DAEBuilder` arena (`lowerFebioToDae`).

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

# Project FEBio mesh and materials to CalculiX- / Abaqus-compatible .inp, Modelica, or DAE
msx febio to-inp LiverHyperelastic.feb > LiverHyperelastic.inp
msx febio to-modelica LiverHyperelastic.feb > LiverHyperelastic.mo
msx febio to-dae LiverHyperelastic.feb
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseFebioModel,
  solveHyperelasticMechanics,
  lowerFebioToDae,
  febioToCalculixInp,
  febioToModelica,
} from "@modelscript/febio";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseFebioModel(febXmlSource);
const mechanics = solveHyperelasticMechanics(model, 1.25); // 25% uniaxial stretch

const builder = new DAEBuilder();
lowerFebioToDae(model, builder);
const calculixInp = febioToCalculixInp(model);
const modelicaCode = febioToModelica(model);
```
