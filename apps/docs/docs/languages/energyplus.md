---
title: "EnergyPlus Building Simulation (.idf, .epjson)"
description: "@modelscript/energyplus provides native compilation, thermal lumped-capacitance DAE lowering, and bidirectional TGG sync for DOE EnergyPlus HVAC models."
---

# EnergyPlus Building Simulation (`.idf`, `.epjson`)

`@modelscript/energyplus` (`languages/energyplus`) provides compiler, thermal lumped-capacitance DAE lowering, and bidirectional TGG synchronization for **US Department of Energy (DOE) EnergyPlus** building energy and HVAC models.

---

## Supported Extensions & Standards

| Extension | Format                     | Description                                                          |
| :-------- | :------------------------- | :------------------------------------------------------------------- |
| `.idf`    | EnergyPlus Input Data File | Industry-standard comma/semicolon delimited building simulation deck |
| `.epjson` | EnergyPlus JSON Schema     | Structured JSON schema representation of EnergyPlus models           |

---

## Key Capabilities

### 1. Lumped-Capacitance Multi-Zone Thermal DAEs

- Translates architectural thermal zones and building envelopes into continuous energy balance DAEs, where the rate of change of zone air thermal energy equals the sum of conductive, convective, solar, internal, and HVAC heat transfer rates:
  $$C_{z,i} \frac{dT_{z,i}}{dt} = \sum_{j} \dot{Q}_{\text{cond},ij} + \sum_{k} \dot{Q}_{\text{conv},ik} + \dot{Q}_{\text{solar}} + \dot{Q}_{\text{internal}} + \dot{Q}_{\text{HVAC}}$$

  | Symbol                      | Meaning                                                       | Units / Domain                       |
  | :-------------------------- | :------------------------------------------------------------ | :----------------------------------- |
  | $C_{z,i}$                   | Effective thermal capacitance of thermal zone $i$             | $\text{J}\cdot\text{K}^{-1}$ ($> 0$) |
  | $T_{z,i}$                   | Dry-bulb air temperature of zone $i$                          | $\text{K}$ (or $^\circ\text{C}$)     |
  | $t$                         | Simulation time                                               | $\text{s}$                           |
  | $\dot{Q}_{\text{cond},ij}$  | Conductive heat transfer rate from adjacent zone/surface $j$  | $\text{W}$                           |
  | $\dot{Q}_{\text{conv},ik}$  | Convective heat transfer rate from interior surface $k$       | $\text{W}$                           |
  | $\dot{Q}_{\text{solar}}$    | Transmitted solar radiation heat gain                         | $\text{W}$ ($\ge 0$)                 |
  | $\dot{Q}_{\text{internal}}$ | Internal sensible heat gains (lighting, occupants, equipment) | $\text{W}$ ($\ge 0$)                 |
  | $\dot{Q}_{\text{HVAC}}$     | Net heating or cooling rate supplied by the HVAC system       | $\text{W}$                           |

- **Envelope Conduction**: Multi-layer wall, floor, and roof constructions with layer-resolved thermal conductivity $k$, density $\rho$, and specific heat $c_p$.
- **Window & Fenestration Optics**: U-factor, Solar Heat Gain Coefficient (SHGC), and visible transmittance shading calculations.
- **Internal Loads**: Schedules for lighting, occupancy sensible/latent heat release, and plug-load equipment dissipation.

### 2. Direct DAE Lowering

- Compiles building geometry and HVAC schedules directly into `@modelscript/runtime`'s `DAEBuilder` linear memory arena, enabling co-simulation with dynamic grid power models ([`@modelscript/pscad`](./pscad.md)) and district energy networks.

### 3. Bidirectional Triple Graph Grammar (TGG) Sync

- Implements bidirectional TGG rules (`energyplus-sync.ts`) synchronizing EnergyPlus thermal zones with:
  - **Modelica (`Modelica.Thermal` / IBPSA Buildings)**: Automatic translation into acausal thermal components and fluid loops.
  - **STEP CAD (ISO 10303)**: Validates physical geometric volume and boundary surface areas against 3D architectural CAD envelopes.

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="energyplus" />

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="energyplus" />

---

## CLI Usage

```bash
# Lint an EnergyPlus building model deck
msx energyplus lint CommercialOffice.idf

# Lower thermal zones to ModelScript linear memory DAE arena
msx energyplus to-dae CommercialOffice.idf --out=office.dae.json

# Project into standard Modelica IBPSA Buildings library components
msx energyplus to-modelica CommercialOffice.idf -o BuildingThermalModel.mo
```
