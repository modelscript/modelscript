---
title: TOPAS & GATE Proton & Hadrontherapy Monte Carlo (.topas, .mac)
description: Native WebAssembly GLR parsing, Geant4 geometry hierarchy and bounding-box containment verification, Bortfeld (1997) analytical Bragg peak depth-dose evaluation, DAEBuilder lowering, and OpenSCAD / Modelica projections for TOPAS and GATE.
---

# TOPAS & GATE Proton & Hadrontherapy Monte Carlo (`.topas`, `.mac`)

`@modelscript/topas` (`languages/topas`) provides native WebAssembly GLR parsing, Geant4 geometry hierarchy and parent-child bounding-box containment verification, **Bortfeld (1997) analytical Bragg peak depth-dose** and Spread-Out Bragg Peak (SOBP) evaluation, `DAEBuilder` lowering, and OpenSCAD / Modelica projections for **TOPAS (Tool for Particle Simulation)** and **GATE** proton, carbon-ion, and flash radiotherapy beamline configurations.

---

## Supported Extensions & Standards

| Extension        | Format               | Description                                                                                                                                             |
| :--------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.topas`, `.txt` | TOPAS Parameter File | Typed Geant4 parameter system (`s:` string, `d:` double with units, `i:` integer, `b:` boolean, `dv:`/`sv:` vectors) for `Ge/`, `So/`, `Sc/`, and `Ph/` |
| `.mac`           | GATE / Geant4 Macro  | Command-stream macro (`/gate/world/daughters/...`, `/gate/source/...`, `/gate/actor/...`) for medical physics Monte Carlo                               |

---

## Key Capabilities

### 1. Typed Geometry (`Ge/`), Beam Sources (`So/`) & Dose Scorers (`Sc/`)

- Parses hierarchical Geant4 CSG beamline components (`TsBox`, `TsCylinder`, `TsSphere`, `TsRangeModulator`, `TsPropeller`, `TsMultiLeafCollimator`, `TsAperture`, water phantoms, and patient CT volumes), particle sources (`Proton`, `Carbon12`, `Electron`, `Photon`), physics lists (`Ph/Default/Modules`), and `DoseToMedium` / `LETd` / `Fluence` scorers.
- Verifies parent-child spatial containment so every child component bounding box $[x_c \pm \Delta x_c, y_c \pm \Delta y_c, z_c \pm \Delta z_c]$ lies strictly inside its parent volume `Ge/<Comp>/Parent` without geometric overlap.

### 2. Analytical Bortfeld (1997) Bragg Peak & Range Calculation

`@modelscript/topas` evaluates the **Bragg-Kleeman range-energy relation** and **Bortfeld's (1997)** analytical depth-dose equation for proton and heavy-ion beams in water/tissue:

$$R_0 = \alpha \, E_0^p, \qquad \sigma_{\text{mono}}^2 = \alpha_{\sigma} R_0^{3 - 2/p}, \qquad \sigma^2 = \sigma_{\text{mono}}^2 + \sigma_E^2 \left(\alpha p E_0^{p-1}\right)^2$$

where $\alpha \approx 0.0022\text{ cm}\cdot\text{MeV}^{-p}$ and $p \approx 1.77$ for protons in water ($\rho = 1.0\text{ g/cm}^3$). Along depth $z$, the absorbed dose $D(z)$ is computed from the Gaussian range-straggling variable $\zeta = (R_0 - z)/\sigma$, computing:

- Continuous-slowing-down range $R_0$ ($\text{mm}$),
- Distal $80\%$ dose falloff depth $R_{80}$ and $90\%\text{–}10\%$ distal penumbra,
- Entrance-to-Bragg-peak dose ratio and dose-averaged Linear Energy Transfer ($\text{LET}_d$).

### 3. 3D Nozzle CSG, Modelica & DAE Lowering

- **OpenSCAD 3D Nozzle CSG (`topasToScad`)**: Projects treatment nozzle collimators, range modulators, ionization chambers, and water phantoms into parameterized 3D OpenSCAD CSG assemblies.
- **Modelica & `DAEBuilder` Lowering**: Projects beamline energy-degradation and target heating dynamics into **Modelica 3.x** (`topasToModelica`) and `@modelscript/runtime`'s `DAEBuilder` arena (`lowerTopasToDae`).

---

## Pre-Flight Diagnostics

<LintRules lang="topas" />

---

## CLI Usage

```bash
# Inspect TOPAS/GATE geometry components, beam sources, and scorers
msx topas inspect ProtonNozzle.topas

# Validate parent-child bounding box containment, materials, and beam energy
msx topas validate ProtonNozzle.topas

# Compute analytical Bortfeld Bragg peak range (R0, R80) and depth-dose curve
msx topas bragg-peak ProtonNozzle.topas

# Project treatment nozzle and phantom geometry to OpenSCAD, Modelica, or DAE
msx topas to-scad ProtonNozzle.topas > ProtonNozzle.scad
msx topas to-modelica ProtonNozzle.topas > ProtonNozzle.mo
msx topas to-dae ProtonNozzle.topas
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseTopasModel,
  computeBraggPeakDepthDose,
  lowerTopasToDae,
  topasToScad,
  topasToModelica,
} from "@modelscript/topas";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseTopasModel(topasSource);
const bragg = computeBraggPeakDepthDose(model);

const builder = new DAEBuilder();
lowerTopasToDae(model, builder);
const scadCode = topasToScad(model);
const modelicaCode = topasToModelica(model);
```
