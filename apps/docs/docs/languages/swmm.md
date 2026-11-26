---
title: "EPA SWMM Stormwater & Urban Hydrology (.inp)"
description: "@modelscript/swmm provides zero-regex parsing, 1D Saint-Venant dynamic wave hydraulic routing, DAE lowering, and Modelica projection for US EPA SWMM 5.x."
---

# EPA SWMM Stormwater & Urban Hydrology (`.inp`)

`@modelscript/swmm` (`languages/swmm`) provides zero-regex parsing, 1D Saint-Venant dynamic wave hydraulic routing, DAE lowering, and Modelica 3.x projection for **US EPA Stormwater Management Model (SWMM 5.x)** urban drainage, sewer collection, and flood mitigation networks.

---

## Supported Extensions & Standards

| Extension | Format              | Description                                                                                                      |
| :-------- | :------------------ | :--------------------------------------------------------------------------------------------------------------- |
| `.inp`    | EPA SWMM Input File | Industry-standard stormwater network deck (junctions, conduits, outfalls, subcatchments, pumps, weirs, orifices) |

---

## Key Capabilities

### 1. 1D Saint-Venant Dynamic Wave Routing

- Models open-channel and pressurized sewer hydraulics via the one-dimensional **Saint-Venant equations of unsteady flow**:
  - **Conservation of Mass (Continuity)** (balances local cross-sectional storage change and axial discharge gradient against lateral inflow):
    $$\frac{\partial A}{\partial t} + \frac{\partial Q}{\partial x} = q_{\text{lateral}}$$
  - **Conservation of Momentum** (balances fluid acceleration and convective momentum flux against pressure/gravity head gradients and frictional resistance):
    $$\frac{\partial Q}{\partial t} + \frac{\partial}{\partial x} \left( \frac{Q^2}{A} \right) + g A \frac{\partial H}{\partial x} + g A S_f = 0$$
- Uses **Manning's open-channel equation** to relate discharge to friction slope $S_f$ via conduit roughness and hydraulic radius:
  $$Q = \frac{k_m}{n} A R_h^{2/3} S_f^{1/2} \quad \implies \quad S_f = \frac{n^2 Q |Q|}{k_m^2 A^2 R_h^{4/3}}$$

  | Symbol               | Meaning                                                 | Units / Domain                                            |
  | :------------------- | :------------------------------------------------------ | :-------------------------------------------------------- |
  | $t, x$               | Time and longitudinal distance along conduit            | $\text{s}$, $\text{m}$                                    |
  | $A$                  | Wetted cross-sectional flow area                        | $\text{m}^2$, $> 0$                                       |
  | $Q$                  | Volumetric flow rate (discharge)                        | $\text{m}^3/\text{s}$                                     |
  | $q_{\text{lateral}}$ | Lateral inflow per unit conduit length                  | $\text{m}^2/\text{s}$                                     |
  | $g$                  | Gravitational acceleration ($9.81\text{ m/s}^2$)        | $\text{m/s}^2$                                            |
  | $H$                  | Hydraulic head ($z + d$, invert elevation plus depth)   | $\text{m}$                                                |
  | $S_f$                | Friction slope (energy grade line slope)                | dimensionless                                             |
  | $n$                  | Manning roughness coefficient                           | $\text{s/m}^{1/3}$ (or US equiv.), $> 0$                  |
  | $k_m$                | Unit conversion factor ($1.0$ SI, $1.486$ US customary) | $\text{m}^{1/3}/\text{s}$ (or $\text{ft}^{1/3}/\text{s}$) |
  | $R_h$                | Hydraulic radius ($A / P_{\text{wetted}}$)              | $\text{m}$, $> 0$                                         |

### 2. Node & Link Hydraulic Structures

- **Junctions & Storage Units**: Enforces continuous water-surface elevation mass conservation at each node by balancing net link inflows, external runoff/dry-weather inflows, and surface flooding losses:
  $$A_{\text{node}} \frac{dH_i}{dt} = \sum Q_{\text{in}} - \sum Q_{\text{out}} + Q_{\text{inflow}} - Q_{\text{flood}}$$

  | Symbol                          | Meaning                                              | Units / Domain                 |
  | :------------------------------ | :--------------------------------------------------- | :----------------------------- |
  | $A_{\text{node}}$               | Effective nodal surface plan area                    | $\text{m}^2$, $> 0$            |
  | $H_i$                           | Hydraulic head (water surface elevation) at node $i$ | $\text{m}$                     |
  | $Q_{\text{in}}, Q_{\text{out}}$ | Incoming and outgoing conduit/regulator flows        | $\text{m}^3/\text{s}$, $\ge 0$ |
  | $Q_{\text{inflow}}$             | External subcatchment runoff and dry-weather inflow  | $\text{m}^3/\text{s}$, $\ge 0$ |
  | $Q_{\text{flood}}$              | Surface ponding or street flooding overflow rate     | $\text{m}^3/\text{s}$, $\ge 0$ |

- **Conduits**: Circular, rectangular, trapezoidal, and irregular natural river cross-sections with entrance/exit minor head loss coefficients.
- **Outfalls**: Free, normal, tidal, and fixed water elevation boundary conditions.
- **Regulators**: Orifices, transverse/side-flow weirs, and variable-speed lift pumps.

### 3. Direct DAE Lowering

- Compiles the entire stormwater collection network into `@modelscript/runtime`'s `DAEBuilder` struct-of-arrays linear memory arena.
- Enables co-simulation of municipal drinking water networks ([`@modelscript/epanet`](./epanet.md)) and drainage networks within the same computational arena.

### 4. Real-Time Control (RTC), Pollutant Washoff, GIS Ingestion & EPA NetDMR

- **Real-Time Control (`rtc`) & Pollutant Washoff (`quality`)**: Simulates dynamic weir/orifice/pump PID and rule-based flood gates alongside exponential land-use pollutant buildup and runoff washoff (TSS, TP, TN).
- **GIS Ingestion (`from-gis`), Network Diff (`diff`) & EPA NetDMR Export**: Ingests GeoJSON conduits, manholes, and subcatchments (`gis-ingestor.ts`), computes topological stormwater diffs, and exports US EPA NPDES NetDMR CSO/SSO overflow monitoring tables (`netdmr-exporter.ts`).

### 5. Bidirectional Modelica 3.x Projection

- Projects SWMM nodes and channels into `Modelica.Fluid` open-channel tanks, flow conduits, and boundary reservoirs.

---

## Pre-Flight Diagnostics

The SWMM linter verifies network graph integrity and hydraulic feasibility before simulation:

<LintRules lang="swmm" />

---

## CLI Usage

```bash
# Inspect junctions, conduits, outfalls, and subcatchments
msx swmm inspect UrbanDrainage.inp
msx swmm summary UrbanDrainage.inp

# Run pre-flight semantic diagnostics
msx swmm lint UrbanDrainage.inp

# Route hydraulic flow, simulate Real-Time Control (RTC), and evaluate pollutant water quality
msx swmm route-flow UrbanDrainage.inp
msx swmm rtc UrbanDrainage.inp
msx swmm quality UrbanDrainage.inp

# Compare two SWMM network revisions or build a SWMM .inp deck from GeoJSON GIS layers
msx swmm diff Baseline.inp Proposed.inp
msx swmm from-gis conduits.geojson --manholes=manholes.geojson --out=UrbanDrainage.inp

# Lower network topology into ModelScript linear DAE arena or Modelica 3.x
msx swmm to-dae UrbanDrainage.inp
msx swmm to-modelica UrbanDrainage.inp -o StormwaterNetwork.mo
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="swmm" />
