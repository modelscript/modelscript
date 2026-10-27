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

- Translates architectural thermal zones and building envelopes into continuous energy balance DAEs:
  $$C_{z,i} \frac{dT_{z,i}}{dt} = \sum_{j} \dot{Q}_{\text{cond},ij} + \sum_{k} \dot{Q}_{\text{conv},ik} + \dot{Q}_{\text{solar}} + \dot{Q}_{\text{internal}} + \dot{Q}_{\text{HVAC}}$$
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
