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

- Parses hierarchical CSG beamline components (`TsBox`, `TsCylinder`, `TsSphere`, `TsRangeModulator`, `TsPropeller`, `TsMultiLeafCollimator`, water phantoms, and patient CT volumes), particle sources (`Proton`, `Carbon12`, `Electron`, `Photon`), and `DoseToMedium` / `LETd` scorers.

### 2. Analytical Bortfeld Bragg Peak & Range Calculation

- Computes the continuous-slowing-down range $R_0 = \alpha E_0^p$ in water ($\alpha \approx 0.0022\text{ cm}\cdot\text{MeV}^{-p}$, $p \approx 1.77$ for protons), distal $80\%$ dose falloff ($R_{80}$), peak-to-plateau ratio, and full depth-dose curves $D(z)$ (`computeBraggPeakDepthDose`).

### 3. 3D Nozzle CSG & Modelica Projections

- Projects TOPAS/GATE treatment nozzles and water phantoms into **OpenSCAD** 3D CSG geometry (`topasToScad`) and **Modelica** beamline dosimetry models (`topasToModelica`).

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

# Project treatment nozzle and phantom geometry to OpenSCAD or Modelica
msx topas to-scad ProtonNozzle.topas > ProtonNozzle.scad
msx topas to-modelica ProtonNozzle.topas > ProtonNozzle.mo
```
