---
title: NMTRAN / NONMEM-Compatible Pharmacometrics & PK/PD (.ctl, .mod)
description: Native WebAssembly GLR parsing, ADVAN1-ADVAN13 compartmental PK/PD solving, multi-dose exposure calculation (AUC, Cmax, Tmax, t1/2), DAEBuilder lowering, and SBML / Modelica projections for NMTRAN control streams.
---

# NMTRAN / NONMEM-Compatible Pharmacometrics & PK/PD (`.ctl`, `.mod`)

`@modelscript/nmtran` (`languages/nmtran`) provides native WebAssembly GLR parsing, `ADVAN1`–`ADVAN13` compartmental pharmacokinetic/pharmacodynamic (PK/PD) solving, multi-dose (`AMT`, `RATE`, `II`, `ADDL`) exposure calculation ($\text{AUC}$, $C_{\max}$, $T_{\max}$, $t_{1/2}$), `DAEBuilder` lowering, and SBML / Modelica projections for **NMTRAN / NONMEM-compatible** clinical trial and population pharmacometrics control streams.

---

## Supported Extensions & Standards

| Extension | Format                | Description                                                                                                                                          |
| :-------- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ctl`    | NMTRAN Control Stream | NONMEM-compatible control file (`$PROBLEM`, `$INPUT`, `$DATA`, `$SUBROUTINES`, `$PK`, `$DES`, `$ERROR`, `$THETA`, `$OMEGA`, `$SIGMA`, `$ESTIMATION`) |
| `.mod`    | PsN / NONMEM Model    | PsN- and Pirana-compatible pharmacometric model file                                                                                                 |

---

## Key Capabilities

### 1. Standard PREDPP Compartmental Library (`ADVAN`) & General ODEs (`$DES`)

`@modelscript/nmtran` parses `$SUBROUTINES` declarations (`ADVAN` + `TRANS` parameterizations) and general differential equations (`$DES`):

| Subroutine            | Compartments                  | Route & Kinetics                                            | Governing System                                                                                                   |
| :-------------------- | :---------------------------- | :---------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| `ADVAN1`              | 1 (Central)                   | IV Bolus / Infusion (`TRANS1`: $K$, `TRANS2`: $CL, V$)      | $\frac{dA_1}{dt} = R_{\text{inf}}(t) - \frac{CL}{V} A_1$                                                           |
| `ADVAN2`              | 2 (Depot + Central)           | Extravascular 1st-Order Absorption ($K_a, CL, V$)           | $\frac{dA_1}{dt} = -K_a A_1, \quad \frac{dA_2}{dt} = K_a A_1 - \frac{CL}{V} A_2$                                   |
| `ADVAN3` / `ADVAN4`   | 2–3 (Central + Peripheral)    | Two-compartment IV / Oral ($CL, V_1, Q, V_2, K_a$)          | Coupled central-peripheral distribution exchange $Q(A_1/V_1 - A_2/V_2)$                                            |
| `ADVAN11` / `ADVAN12` | 3–4 (Central + 2 Peripherals) | Three-compartment IV / Oral ($CL, V_1, Q_2, V_2, Q_3, V_3$) | Deep-tissue distribution kinetics                                                                                  |
| `ADVAN6` / `ADVAN13`  | $N$ User-Defined              | General Non-Linear ODEs (`$DES` with `DADT(i)`)             | Target-Mediated Drug Disposition (TMDD), Michaelis-Menten clearance $V_{\max} C / (K_m + C)$, indirect response PD |

### 2. Population Mixed-Effects (`$THETA`, `$OMEGA`, `$SIGMA`) & Exposure Metrics

- Evaluates non-linear mixed-effects (NLME) individual parameter relationships in `$PK` and residual error structures in `$ERROR`:
  $$\theta_{i,k} = \theta_{\text{pop},k} \cdot \exp(\eta_{i,k}), \qquad \boldsymbol{\eta}_i \sim \mathcal{N}(\mathbf{0}, \boldsymbol{\Omega}), \qquad Y_{ij} = F_{ij}(1 + \varepsilon_{1,ij}) + \varepsilon_{2,ij}, \qquad \boldsymbol{\varepsilon}_{ij} \sim \mathcal{N}(\mathbf{0}, \boldsymbol{\Sigma})$$
- Simulates single-dose and steady-state multi-dose regimens (`AMT`, zero-order infusion `RATE`, inter-dose interval `II`, additional doses `ADDL`) and computes non-compartmental clinical exposure metrics via trapezoidal integration:
  $$\text{AUC}_{0\to t} = \int_0^t C_p(\tau)\,d\tau, \qquad t_{1/2,\beta} = \frac{\ln 2}{\lambda_z}, \qquad C_{\max} = \max_{t} C_p(t), \qquad T_{\max} = \arg\max_{t} C_p(t)$$

### 3. DAE Lowering & Modelica / SBML Projection

- Lowers PK/PD compartmental differential equations into `@modelscript/runtime`'s `DAEBuilder` arena and projects them into **Modelica 3.x** (`nmtranToModelica`) and **SBML** (`nmtranToSbml`).

---

## Pre-Flight Diagnostics

<LintRules lang="nmtran" />

---

## CLI Usage

```bash
# Validate THETA bounds (lower <= init <= upper), OMEGA/SIGMA variance positivity, and ADVAN parametrization
msx lint TwoCompOralPK.ctl

# Parse and inspect NMTRAN control stream blocks
msx parse TwoCompOralPK.ctl

# Simulate PK/PD concentration-time profiles and exposure metrics (AUC, Cmax, Tmax, t1/2)
msx domain nmtran inspect TwoCompOralPK.ctl
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseNmtranModel,
  simulateNmtranPkPd,
  lowerNmtranToDae,
  nmtranToModelica,
  nmtranToSbml,
} from "@modelscript/nmtran";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseNmtranModel(ctlSource);
const result = simulateNmtranPkPd(model, { endTimeHours: 72, dtHours: 0.25 });

const builder = new DAEBuilder();
lowerNmtranToDae(model, builder);
const modelicaCode = nmtranToModelica(model);
const sbmlXml = nmtranToSbml(model);
```

---

## Trademarks & Disclaimers

NONMEM is a registered trademark of ICON plc. PsN and Pirana are trademarks or software products of their respective authors and Certara, L.P. Reference to these marks is strictly for nominative identification of control stream format compatibility and data interchange. ModelScript is an independent open-core project not affiliated with or endorsed by these entities.
