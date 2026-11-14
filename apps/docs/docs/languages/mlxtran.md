---
title: MLXTRAN / Monolix-Compatible Pharmacometrics & PK/PD (.mlxtran)
description: Native WebAssembly GLR parsing, compartmental PK/PD ODE and macro solving (AUC, Cmax, Tmax, t1/2), DAEBuilder lowering, and Modelica 3.x projections for Monolix MLXTRAN longitudinal models.
---

# MLXTRAN / Monolix-Compatible Pharmacometrics & PK/PD (`.mlxtran`)

`@modelscript/mlxtran` (`languages/mlxtran`) provides native WebAssembly GLR parsing, multi-compartment pharmacokinetic/pharmacodynamic (PK/PD) ODE and PK-macro solving ($\text{AUC}$, $C_{\max}$, $T_{\max}$, $t_{1/2}$), `DAEBuilder` linear-memory lowering, and **Modelica 3.x** projections for **Monolix MLXTRAN** longitudinal pharmacometric models.

---

## Supported Extensions & Standards

| Extension  | Format                   | Description                                                                                                             |
| :--------- | :----------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `.mlxtran` | MLXTRAN Structural Model | Monolix-compatible longitudinal model (`[LONGITUDINAL]`, `input = {...}`, `PK:`, `EQUATION:`, `ddt_<state>`, `OUTPUT:`) |

---

## Key Capabilities

### 1. Structural Sections, PK Macros & Differential Equations (`EQUATION:`)

`@modelscript/mlxtran` parses `[LONGITUDINAL]` blocks with `input = {...}` parameter declarations, `PK:` compartmental macro statements (`compartment`, `absorption`, `depot`, `elimination`, `transfer`), `EQUATION:` differential equations (`ddt_<state>`), and `OUTPUT:` declarations:

$$\frac{dA_d}{dt} = -k_a A_d, \qquad \frac{dA_c}{dt} = k_a A_d - \frac{CL}{V} A_c - \frac{Q}{V} A_c + \frac{Q}{V_2} A_p, \qquad \frac{dA_p}{dt} = \frac{Q}{V} A_c - \frac{Q}{V_2} A_p$$

### 2. Deterministic PK Simulation & Non-Compartmental Analysis (NCA)

- Integrates 1- and 2-compartment oral/IV dosing models (`solveMlxtranPk`) and computes trapezoidal exposure metrics:
  $$\text{AUC}_{0\to t} = \int_0^t C_c(\tau)\,d\tau, \qquad C_{\max} = \max_t C_c(t), \qquad T_{\max} = \arg\max_t C_c(t), \qquad t_{1/2} = \frac{\ln 2}{k_{10}}$$

### 3. DAE Arena Lowering & Modelica Projection

- Lowers MLXTRAN parameters, compartmental transfers, and `ddt_*` ODEs directly into `@modelscript/runtime`'s `DAEBuilder` arena (`lowerMlxtranToDae`) and projects models into **Modelica 3.x** (`mlxtranToModelica`).

---

## Pre-Flight Diagnostics

<LintRules lang="mlxtran" />

---

## CLI Usage

```bash
# Lint an MLXTRAN structural model for undeclared parameters, mass leaks, and missing OUTPUT blocks
msx lint TwoCompOral.mlxtran

# Parse and inspect the MLXTRAN concrete syntax tree
msx parse TwoCompOral.mlxtran

# Run domain inspection and PK simulation via the unified domain router
msx domain mlxtran inspect TwoCompOral.mlxtran
msx domain mlxtran simulate TwoCompOral.mlxtran
```

---

## Programmatic TypeScript SDK

```typescript
import { parseMlxtran, lintMlxtran, solveMlxtranPk, lowerMlxtranToDae, mlxtranToModelica } from "@modelscript/mlxtran";
import { DAEBuilder } from "@modelscript/runtime";

const doc = parseMlxtran(mlxtranSource);
const diagnostics = lintMlxtran(doc);
const result = solveMlxtranPk(doc, { tEnd: 24, dt: 0.05, dose: 100 });

const builder = new DAEBuilder();
lowerMlxtranToDae(doc, builder);
const modelicaCode = mlxtranToModelica(doc);
```

---

## Trademarks & Disclaimers

Monolix® and Lixoft® are registered trademarks of Lixoft SAS / Simulations Plus, Inc. Reference to these marks is strictly for nominative identification of MLXTRAN file format compatibility. ModelScript is an independent open-core project not affiliated with or endorsed by these entities.
