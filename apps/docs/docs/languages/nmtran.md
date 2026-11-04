# NONMEM NMTRAN Pharmacometrics & PK/PD (`.ctl`, `.mod`)

`@modelscript/nmtran` (`languages/nmtran`) provides native WebAssembly GLR parsing, `ADVAN1`–`ADVAN13` compartmental pharmacokinetic/pharmacodynamic (PK/PD) solving, multi-dose (`AMT`, `RATE`, `II`, `ADDL`) exposure calculation ($\text{AUC}$, $C_{\max}$, $T_{\max}$, $t_{1/2}$), `DAEBuilder` lowering, and SBML / Modelica projections for **NONMEM NMTRAN** clinical trial and population pharmacometrics control streams.

---

## Supported Extensions & Standards

| Extension | Format                | Description                                                                                                                               |
| :-------- | :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `.ctl`    | NMTRAN Control Stream | NONMEM control file (`$PROBLEM`, `$INPUT`, `$DATA`, `$SUBROUTINES`, `$PK`, `$DES`, `$ERROR`, `$THETA`, `$OMEGA`, `$SIGMA`, `$ESTIMATION`) |
| `.mod`    | PsN / NONMEM Model    | Perl-speaks-NONMEM (PsN) and Pirana pharmacometric model file                                                                             |

---

## Key Capabilities

### 1. Standard PREDPP Compartmental Library (`ADVAN`) & General ODEs (`$DES`)

- Parses `$SUBROUTINES` (`ADVAN1` 1-compartment IV bolus, `ADVAN2` 1-compartment oral first-order absorption, `ADVAN3`/`ADVAN4` 2-compartment, `ADVAN11`/`ADVAN12` 3-compartment, and `ADVAN6`/`ADVAN13` general non-linear differential equations `$DES` with `DADT(i)`).
- Evaluates typical parameter transformations in `$PK` (e.g., `CL = THETA(1) * EXP(ETA(1))`, `V = THETA(2)`) and proportional/additive residual error models in `$ERROR`.

### 2. Multi-Dose Regimen Simulation & Exposure Metrics

- Simulates intravenous bolus, zero-order infusion, and extravascular oral dosing regimens (`II` inter-dose interval, `ADDL` additional doses) and automatically computes clinical exposure metrics:
  $$\text{AUC}_{0\to t} = \int_0^t C_p(\tau)\,d\tau, \qquad t_{1/2} = \frac{\ln 2}{k_e}, \qquad C_{\max}, \quad T_{\max}$$

### 3. DAE Lowering & Modelica / SBML Projection

- Lowers PK/PD compartmental differential equations into `@modelscript/runtime`'s `DAEBuilder` arena and projects them into **Modelica 3.x** (`nmtranToModelica`) and **SBML** (`nmtranToSbml`).

---

## Pre-Flight Diagnostics

<LintRules lang="nmtran" />

---

## CLI Usage

```bash
# Validate THETA bounds, OMEGA/SIGMA variance positivity, and ADVAN parametrization
msx lint TwoCompOralPK.ctl

# Parse and inspect NMTRAN control stream blocks
msx parse TwoCompOralPK.ctl
```
