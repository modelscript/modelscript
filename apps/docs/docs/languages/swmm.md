---
title: "EPA SWMM Stormwater & Urban Hydrology (.inp)"
description: "@modelscript/swmm (languages/swmm) provides zero-regex parsing, 1D Saint-Venant dynamic wave hydraulic routing, DAE lowering, and Modelica 3.x projection for US EPA Stormwater Management Model (SWM..."
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
  - **Conservation of Mass (Continuity)**:
    $$\frac{\partial A}{\partial t} + \frac{\partial Q}{\partial x} = q_{\text{lateral}}$$
  - **Conservation of Momentum**:
    $$\frac{\partial Q}{\partial t} + \frac{\partial}{\partial x} \left( \frac{Q^2}{A} \right) + g A \frac{\partial H}{\partial x} + g A S_f = 0$$
    where $H = z + d$ is hydraulic head, $S_f$ is friction slope, and $S_0$ is conduit bed slope.
- Uses **Manning's open-channel equation** for friction slope:
  $$Q = \frac{k_m}{n} A R_h^{2/3} S_f^{1/2} \quad \implies \quad S_f = \frac{n^2 Q |Q|}{k_m^2 A^2 R_h^{4/3}}$$
  where $n$ is Manning roughness, $A$ is flow cross-sectional area, and $R_h = A / P_{\text{wetted}}$ is hydraulic radius.

### 2. Node & Link Hydraulic Structures

- **Junctions & Storage Units**: Continuous water stage mass conservation:
  $$A_{\text{node}} \frac{dH_i}{dt} = \sum Q_{\text{in}} - \sum Q_{\text{out}} + Q_{\text{inflow}} - Q_{\text{flood}}$$
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

